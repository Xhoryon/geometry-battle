/**
 * Match Controller - Orchestrates the entire match
 * Plan 2 Phase D: Full Match State Machine with real Runner
 */

import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { ASTNode, parseDSL, evaluateAST } from '../function/DSL';
import { validateShooter } from '../judge/Judge';
import { runAlgorithm, RoundStateForRunner, RunnerResult, DEFAULT_RUNNER_CONFIG } from '../runner/AlgorithmRunner';
import { generateMap, GeneratedMap, validateMap } from '../map/MapGenerator';
import { MatchLogger, AuditLogger, ReplayGenerator, MatchLog, RoundLog, computeFunctionHash, generateMatchId } from '../replay/ReplayLogger';

export type MatchPhase =
  | 'SETUP'
  | 'UPLOAD_A'
  | 'UPLOAD_B'
  | 'VALIDATING'
  | 'READY'
  | 'SELECT_SHOOTER'
  | 'LOCKED'
  | 'WAITING_JUDGE'
  | 'COUNTDOWN'
  | 'REVEAL'
  | 'COMPUTING'
  | 'SHOT'
  | 'ROUND_RESULT'
  | 'MATCH_END';

export interface MatchConfig {
  matchId: string;
  seed: number;
  teamAName: string;
  teamBName: string;
  teamAPackage: string | null;
  teamBPackage: string | null;
  teamAEntry: string | null;
  teamBEntry: string | null;
  teamAHash: string | null;
  teamBHash: string | null;
  map: GeneratedMap | null;
  timeoutMs: number;
}

export interface MatchState {
  phase: MatchPhase;
  config: MatchConfig;
  roundNumber: number;
  shooterA: { id: string; position: Point } | null;
  shooterB: { id: string; position: Point } | null;
  functionA: ASTNode | null;
  functionB: ASTNode | null;
  resultA: RunnerResult | null;
  resultB: RunnerResult | null;
  hitsA: string[];
  hitsB: string[];
  aliveA: number;
  aliveB: number;
  roundLogs: RoundLog[];
}

const DEFAULT_MATCH_CONFIG: Partial<MatchConfig> = {
  teamAPackage: null,
  teamBPackage: null,
  teamAEntry: null,
  teamBEntry: null,
  teamAHash: null,
  teamBHash: null,
  map: null,
  timeoutMs: DEFAULT_RUNNER_CONFIG.timeoutMs,
};

/**
 * Match Controller - 完整比赛控制器
 */
export class MatchController {
  private state: MatchState;
  private logger: MatchLogger | null = null;
  private audit: AuditLogger | null = null;
  private replay: ReplayGenerator;

  constructor(teamAName: string = 'Team A', teamBName: string = 'Team B', seed?: number) {
    const matchId = generateMatchId();
    const mapSeed = seed ?? Math.floor(Math.random() * 1000000);

    const config: MatchConfig = {
      matchId,
      seed: mapSeed,
      teamAName,
      teamBName,
      teamAPackage: null,
      teamBPackage: null,
      teamAEntry: null,
      teamBEntry: null,
      teamAHash: null,
      teamBHash: null,
      map: null,
      timeoutMs: DEFAULT_RUNNER_CONFIG.timeoutMs,
    };

    this.state = {
      phase: 'SETUP',
      config,
      roundNumber: 0,
      shooterA: null,
      shooterB: null,
      functionA: null,
      functionB: null,
      resultA: null,
      resultB: null,
      hitsA: [],
      hitsB: [],
      aliveA: 0,
      aliveB: 0,
      roundLogs: [],
    };

    this.replay = new ReplayGenerator();
  }

  getState(): MatchState {
    return { ...this.state };
  }

  getPhase(): MatchPhase {
    return this.state.phase;
  }

  // ========== Phase A: Submission ==========

  uploadTeamA(packagePath: string, entry: string): { success: boolean; hash: string | null; errors: string[] } {
    if (this.state.phase !== 'SETUP' && this.state.phase !== 'UPLOAD_A') {
      return { success: false, hash: null, errors: ['Invalid phase'] };
    }

    const { computePackageHash } = require('../submission/AlgorithmSubmission');
    const hash = computePackageHash(packagePath);

    this.state.config.teamAPackage = packagePath;
    this.state.config.teamAEntry = entry;
    this.state.config.teamAHash = hash;
    this.state.phase = 'UPLOAD_A';

    this.audit?.log('AlgorithmUploaded', `Team A uploaded: ${hash}`, 'A');

    return { success: true, hash, errors: [] };
  }

  uploadTeamB(packagePath: string, entry: string): { success: boolean; hash: string | null; errors: string[] } {
    if (this.state.phase !== 'UPLOAD_A') {
      return { success: false, hash: null, errors: ['Upload Team A first'] };
    }

    const { computePackageHash } = require('../submission/AlgorithmSubmission');
    const hash = computePackageHash(packagePath);

    this.state.config.teamBPackage = packagePath;
    this.state.config.teamBEntry = entry;
    this.state.config.teamBHash = hash;
    this.state.phase = 'UPLOAD_B';

    this.audit?.log('AlgorithmUploaded', `Team B uploaded: ${hash}`, 'B');

    return { success: true, hash, errors: [] };
  }

  // ========== Phase B: Map ==========

  generateMap(pointCount: number = 8, difficulty: 'easy' | 'medium' | 'hard' = 'medium'): {
    success: boolean;
    map: GeneratedMap | null;
    errors: string[];
  } {
    if (this.state.phase !== 'UPLOAD_B') {
      return { success: false, map: null, errors: ['Upload both algorithms first'] };
    }

    const map = generateMap({
      seed: this.state.config.seed,
      pointCount,
      difficulty,
    });

    const validation = validateMap(map);
    if (!validation.valid) {
      return { success: false, map: null, errors: validation.errors };
    }

    this.state.config.map = map;
    this.state.aliveA = map.teamA.length;
    this.state.aliveB = map.teamB.length;

    this.state.phase = 'READY';

    this.audit?.log('MapGenerated', `Seed: ${map.seed}, Hash: ${map.stateHash}`);

    return { success: true, map, errors: [] };
  }

  // ========== Phase C: Shooter Selection ==========

  selectShooter(team: 'A' | 'B', shooterId: string): { success: boolean; error: string | null } {
    if (this.state.phase !== 'READY' && this.state.phase !== 'SELECT_SHOOTER') {
      return { success: false, error: 'Invalid phase' };
    }

    if (!this.state.config.map) {
      return { success: false, error: 'No map loaded' };
    }

    const map = this.state.config.map;
    const teamPoints = team === 'A' ? map.teamA : map.teamB;
    const idx = parseInt(shooterId.replace(team, '')) - 1;

    if (idx < 0 || idx >= teamPoints.length) {
      return { success: false, error: 'Invalid shooter ID' };
    }

    const position = teamPoints[idx];
    const shooterInfo = {
      id: `${team}${idx + 1}`,
      position,
      dsl: '', // DSL will be computed
    };

    // 验证 shooter
    const validation = validateShooter(shooterInfo, [], team === 'A' ? [-20, -4] : [4, 20]);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    if (team === 'A') {
      this.state.shooterA = { id: shooterInfo.id, position };
    } else {
      this.state.shooterB = { id: shooterInfo.id, position };
    }

    this.state.phase = 'LOCKED';
    this.audit?.log('ShooterSelected', `${shooterInfo.id} selected`, team);

    return { success: true, error: null };
  }

  // ========== Phase D: Judge Start ==========

  judgeStart(): boolean {
    if (this.state.phase !== 'LOCKED') {
      return false;
    }

    this.state.phase = 'WAITING_JUDGE';
    this.audit?.log('JudgeStartRound', `Round ${this.state.roundNumber + 1}`);
    return true;
  }

  // ========== Phase E: Compute ==========

  async executeCompute(): Promise<{
    success: boolean;
    resultA: RunnerResult | null;
    resultB: RunnerResult | null;
  }> {
    if (this.state.phase !== 'WAITING_JUDGE') {
      return { success: false, resultA: null, resultB: null };
    }

    if (!this.state.config.map || !this.state.shooterA || !this.state.shooterB) {
      return { success: false, resultA: null, resultB: null };
    }

    this.state.phase = 'COUNTDOWN';
    this.state.roundNumber++;

    // 构建 Round State
    const roundStateA: RoundStateForRunner = {
      round: this.state.roundNumber,
      teamId: 'A',
      shooters: [{ id: this.state.shooterA.id, position: this.state.shooterA.position }],
      enemies: this.state.config.map.teamB.map((p, i) => ({ id: `B${i + 1}`, position: p })),
      obstacles: this.state.config.map.obstacles,
      teamAXRange: [-20, -4],
      teamBXRange: [4, 20],
    };

    const roundStateB: RoundStateForRunner = {
      round: this.state.roundNumber,
      teamId: 'B',
      shooters: [{ id: this.state.shooterB.id, position: this.state.shooterB.position }],
      enemies: this.state.config.map.teamA.map((p, i) => ({ id: `A${i + 1}`, position: p })),
      obstacles: this.state.config.map.obstacles,
      teamAXRange: [-20, -4],
      teamBXRange: [4, 20],
    };

    this.state.phase = 'COMPUTING';

    // 并行执行两个算法
    const [resultA, resultB] = await Promise.all([
      runAlgorithm(
        this.state.config.teamAPackage!,
        this.state.config.teamAEntry!,
        roundStateA,
        { timeoutMs: this.state.config.timeoutMs, memoryLimitMb: 512 }
      ),
      runAlgorithm(
        this.state.config.teamBPackage!,
        this.state.config.teamBEntry!,
        roundStateB,
        { timeoutMs: this.state.config.timeoutMs, memoryLimitMb: 512 }
      ),
    ]);

    this.state.resultA = resultA;
    this.state.resultB = resultB;

    // 解析 DSL
    if (resultA.success && resultA.dsl) {
      const ast = parseDSL(resultA.dsl);
      this.state.functionA = ast.ast;
    }
    if (resultB.success && resultB.dsl) {
      const ast = parseDSL(resultB.dsl);
      this.state.functionB = ast.ast;
    }

    return { success: true, resultA, resultB };
  }

  // ========== Phase F: Shot Execution ==========

  executeShots(): {
    hitsA: string[];
    hitsB: string[];
    killedA: string[];
    killedB: string[];
    winner: 'A' | 'B' | 'draw';
  } {
    if (this.state.phase !== 'COMPUTING') {
      return { hitsA: [], hitsB: [], killedA: [], killedB: [], winner: 'draw' };
    }

    const hitsA: string[] = [];
    const hitsB: string[] = [];
    const killedA: string[] = [];
    const killedB: string[] = [];

    // 计算 A 的攻击轨迹
    if (this.state.functionA && this.state.shooterA) {
      const trajectory = this.computeTrajectory(this.state.functionA, this.state.shooterA.position.x, 20);
      // 检查与 B 点的碰撞
      for (let i = 0; i < this.state.config.map!.teamB.length; i++) {
        const bp = this.state.config.map!.teamB[i];
        if (this.pointOnTrajectory(trajectory, bp, 0.3)) {
          hitsA.push(`B${i + 1}`);
        }
      }
    }

    // 计算 B 的攻击轨迹
    if (this.state.functionB && this.state.shooterB) {
      const trajectory = this.computeTrajectory(this.state.functionB, this.state.shooterB.position.x, -20);
      // 检查与 A 点的碰撞
      for (let i = 0; i < this.state.config.map!.teamA.length; i++) {
        const ap = this.state.config.map!.teamA[i];
        if (this.pointOnTrajectory(trajectory, ap, 0.3)) {
          hitsB.push(`A${i + 1}`);
        }
      }
    }

    this.state.hitsA = hitsA;
    this.state.hitsB = hitsB;

    // 确定胜利者
    let winner: 'A' | 'B' | 'draw' = 'draw';
    if (this.state.resultA?.error || this.state.resultB?.error) {
      if (this.state.resultA?.error && !this.state.resultB?.error) {
        winner = 'B';
      } else if (this.state.resultB?.error && !this.state.resultA?.error) {
        winner = 'A';
      }
    } else {
      const timeA = this.state.resultA?.computeTimeMs ?? Infinity;
      const timeB = this.state.resultB?.computeTimeMs ?? Infinity;
      if (timeA < timeB) winner = 'A';
      else if (timeB < timeA) winner = 'B';
    }

    this.state.phase = 'ROUND_RESULT';
    return { hitsA, hitsB, killedA, killedB, winner };
  }

  private computeTrajectory(fn: ASTNode, xStart: number, xEnd: number): Point[] {
    const points: Point[] = [];
    const step = xEnd > xStart ? 0.1 : -0.1;
    for (let x = xStart; (xEnd > xStart ? x <= xEnd : x >= xEnd); x += step) {
      const y = evaluateAST(fn, x);
      if (!isFinite(y)) break;
      points.push({ x, y });
    }
    return points;
  }

  private pointOnTrajectory(trajectory: Point[], target: Point, radius: number): boolean {
    for (const p of trajectory) {
      const dist = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
      if (dist < radius) return true;
    }
    return false;
  }

  // ========== Phase G: Round End ==========

  finishRound(): RoundLog {
    const log: RoundLog = {
      round: this.state.roundNumber,
      stateHash: this.state.config.map?.stateHash ?? '',
      shooterA: this.state.shooterA?.id ?? '',
      shooterB: this.state.shooterB?.id ?? '',
      aTimeMs: this.state.resultA?.computeTimeMs ?? 0,
      bTimeMs: this.state.resultB?.computeTimeMs ?? 0,
      aFunction: this.state.resultA?.dsl ?? '',
      bFunction: this.state.resultB?.dsl ?? '',
      aFunctionHash: this.state.functionA ? computeFunctionHash(this.state.functionA) : '',
      bFunctionHash: this.state.functionB ? computeFunctionHash(this.state.functionB) : '',
      aHits: this.state.hitsA,
      bHits: this.state.hitsB,
      aKills: this.state.hitsB.length,
      bKills: this.state.hitsA.length,
      result: 'COMPLETE',
    };

    this.state.roundLogs.push(log);

    // 重置 shooter
    this.state.shooterA = null;
    this.state.shooterB = null;
    this.state.functionA = null;
    this.state.functionB = null;
    this.state.resultA = null;
    this.state.resultB = null;
    this.state.hitsA = [];
    this.state.hitsB = [];

    // 检查是否结束
    if (this.state.aliveA <= 0 || this.state.aliveB <= 0) {
      this.state.phase = 'MATCH_END';
    } else {
      this.state.phase = 'READY';
    }

    return log;
  }

  // ========== Match End ==========

  getWinner(): 'A' | 'B' | 'draw' {
    if (this.state.aliveA <= 0) return 'B';
    if (this.state.aliveB <= 0) return 'A';
    return 'draw';
  }

  getMatchLog(): MatchLog | null {
    return this.logger?.endMatch(this.getWinner()) ?? null;
  }

  getAuditLog(): string {
    return this.audit?.toJson() ?? '{}';
  }

  getReplay(): string {
    return this.replay.toJson();
  }

  // ========== Start Logging ==========

  startLogging(): void {
    this.logger = new MatchLogger(
      this.state.config.matchId,
      this.state.config.seed,
      this.state.config.teamAHash ?? '',
      this.state.config.teamBHash ?? ''
    );
    this.audit = new AuditLogger(this.state.config.matchId);
    this.audit.log('MatchStarted', `Match ${this.state.config.matchId} started`);
  }
}
