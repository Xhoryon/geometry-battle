/**
 * MatchEngine —— 唯一的正式比赛路径 (Canonical Match Pipeline)
 *
 * 修复的 Finding：
 *   P0-1  selectShooter 里 dsl: '' 硬编码
 *   P0-4  存活数从不递减
 *   P0-5  validatePackage 从未调用
 *   P0-8  没有每回合全新沙箱
 *   P0-10 无正式操作入口（由 operator/CLI 调用本引擎）
 *   P0-11 Shooter 淘汰 / 攻击取消未实现
 *   P0-12 无条件进入 LOCKED 阶段
 *   P1-15 「先解者优先」只是无副作用的比较
 *   P1-16/17/18 日志与回放从未接通
 *   P1-21 B 先开火时判定错误
 *   P1-24 比赛结束前可能显示错误的获胜者
 *   P1-25 finishRound() 没有阶段守卫
 *   P2-19 死点仍可被选为 Shooter
 *
 * Re-Gate Cycle 1 追加修复：
 *   P0-B  沙箱 denyReadPaths 未覆盖双方源包目录与 artifactRoot
 *   P2-A  取消语义未独立编码（被取消的回合被记为 INVALID_*）
 *   P2-B  射击循环内的 Shooter 存活守卫位于击杀应用之前，恒不可达
 */

import * as path from 'path';
import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { CanonicalNode, hashNode, parseCanonicalDSL, toMathString } from './Ast';
import { validateAttackFunction } from './Validator';
import { judgeShot, ShotOutcome } from './Judge';
import { RoundMachine, RoundPhase } from './Round';
import { AlivePoint, RoundStateCore, computeStateHash } from './RoundState';
import {
  PublicStatePoint,
  buildPublicState,
  buildRevealState,
} from './InputProtocol';
import { COMPUTE_TIMEOUT_MS, MEMORY_LIMIT_MB, firingDomain } from './Rules';
import { generateMapOrNull, GeneratedMap } from '../map/MapGenerator';
import { SealedPackage, inspectPackage, sealPackage, verifySeal } from '../submission/Package';
import {
  runDuel,
  RunnerInput,
  RunnerOutcome,
  defaultSandboxRoot,
  IsolationReport,
} from '../runner/SandboxRunner';
import {
  AuditRecorder,
  MatchArtifacts,
  MatchLog,
  Replay,
  ReplayFrame,
  RoundLog,
  simplifyTrajectory,
} from './Logs';

/**
 * 平台自身代码根目录。
 *
 * 沙箱必须显式禁止读取它：`(allow file-read*)` 是默认放行的，只靠
 * `(deny file-read* (subpath "/Users"))` 只能挡住「装在 /Users 下」这一种
 * 情况 —— 如果平台被部署到 /tmp 或 /opt，算法就能直接读到 Judge 源码。
 */
export const PLATFORM_ROOT = path.resolve(__dirname, '..', '..');

export type MatchPhase =
  | 'SETUP'
  | 'UPLOAD_A'
  | 'UPLOAD_B'
  | 'PREFLIGHT'
  | 'READY'
  | 'SELECT_SHOOTER'
  | 'LOCKED'
  | 'WAITING_JUDGE'
  | 'COUNTDOWN'
  | 'REVEAL'
  | 'COMPUTING'
  | 'ROUND_RESULT'
  | 'MATCH_END';

export interface MatchOptions {
  matchId?: string;
  seed?: number;
  teamAName?: string;
  teamBName?: string;
  pointCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  timeoutMs?: number;
  memoryLimitMb?: number;
  sandboxRoot?: string;
  artifactRoot?: string;
}

export interface PointState {
  id: string;
  team: 'A' | 'B';
  position: Point;
  alive: boolean;
}

export interface RoundResult {
  round: number;
  stateHash: string;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  shooterA: string;
  shooterB: string;
  killed: string[];
  cancelled: { A: boolean; B: boolean };
  hits: { A: string[]; B: string[] };
  computeTimeMs: { A: number | null; B: number | null };
  aliveAfter: { A: number; B: number };
  winner: 'A' | 'B' | 'draw' | null;
  log: RoundLog;
  machinePhases: RoundPhase[];
}

export interface MatchSnapshot {
  matchId: string;
  phase: MatchPhase;
  round: number;
  seed: number;
  map: GeneratedMap | null;
  points: PointState[];
  shooters: { A: PointState | null; B: PointState | null };
  locked: { A: boolean; B: boolean };
  alive: { A: number; B: number };
  winner: 'A' | 'B' | 'draw' | null;
  packages: { A: { hash: string; name: string } | null; B: { hash: string; name: string } | null };
  isolation: IsolationReport | null;
  rounds: RoundLog[];
}

export class MatchEngineError extends Error {}

const TIE_EPS_MS = 0.05;

export class MatchEngine {
  readonly matchId: string;
  private phase: MatchPhase = 'SETUP';
  private roundNumber = 0;
  private seed: number;
  private pointCount: number;
  private difficulty: 'easy' | 'medium' | 'hard';
  private timeoutMs: number;
  private memoryLimitMb: number;
  private sandboxRoot: string;
  private artifactRoot: string;
  private teamAName: string;
  private teamBName: string;

  private map: GeneratedMap | null = null;
  private points: PointState[] = [];
  private shooters: { A: PointState | null; B: PointState | null } = { A: null, B: null };
  private locked: { A: boolean; B: boolean } = { A: false, B: false };

  private packages: { A: SealedPackage | null; B: SealedPackage | null } = { A: null, B: null };
  private preflightDone = false;

  private rounds: RoundLog[] = [];
  private frames: ReplayFrame[] = [];
  private audit: AuditRecorder;
  private machine: RoundMachine | null = null;
  private lastIsolation: IsolationReport | null = null;
  private startedAt = new Date();

  constructor(opts: MatchOptions = {}) {
    this.matchId = opts.matchId ?? generateMatchId();
    this.seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);
    this.pointCount = opts.pointCount ?? 8;
    this.difficulty = opts.difficulty ?? 'medium';
    this.timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
    this.memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;
    this.sandboxRoot = opts.sandboxRoot ?? defaultSandboxRoot();
    this.artifactRoot = opts.artifactRoot ?? path.join(process.cwd(), 'artifacts');
    this.teamAName = opts.teamAName ?? 'Team A';
    this.teamBName = opts.teamBName ?? 'Team B';
    this.audit = new AuditRecorder(this.matchId);
    this.audit.log('MatchCreated', { seed: this.seed, pointCount: this.pointCount });
  }

  // ========================================================================
  // 上传与预检
  // ========================================================================

  /** 上传并密封算法包（P0-5 / P0-6） */
  upload(team: 'A' | 'B', packageDir: string): { ok: boolean; hash: string | null; errors: string[] } {
    if (team === 'A' && this.phase !== 'SETUP') {
      return { ok: false, hash: null, errors: [`当前阶段 ${this.phase} 不允许上传 Team A`] };
    }
    if (team === 'B' && this.phase !== 'UPLOAD_A') {
      return { ok: false, hash: null, errors: [`当前阶段 ${this.phase} 不允许上传 Team B（请先上传 Team A）`] };
    }

    const inspection = inspectPackage(packageDir);
    if (!inspection.valid) {
      this.audit.log('PackageRejected', { errors: inspection.errors }, team);
      return { ok: false, hash: null, errors: inspection.errors };
    }

    const { sealed, errors } = sealPackage({
      team,
      sourceDir: packageDir,
      sealRoot: this.sealedRoot,
      matchId: this.matchId,
    });
    if (!sealed) {
      this.audit.log('PackageRejected', { errors }, team);
      return { ok: false, hash: null, errors };
    }

    this.packages[team] = sealed;
    this.phase = team === 'A' ? 'UPLOAD_A' : 'UPLOAD_B';
    this.audit.log('PackageSealed', { hash: sealed.hash, files: sealed.files.length, entry: sealed.entry }, team);
    return { ok: true, hash: sealed.hash, errors: [] };
  }

  /**
   * Preflight：在真正的沙箱里跑一次算法，确认能产出合法 DSL（P2-14）。
   */
  async preflight(): Promise<{ ok: boolean; errors: string[]; detail: Record<string, unknown> }> {
    if (this.phase !== 'UPLOAD_B') {
      return { ok: false, errors: [`当前阶段 ${this.phase} 不能执行 Preflight`], detail: {} };
    }
    const a = this.packages.A;
    const b = this.packages.B;
    if (!a || !b) return { ok: false, errors: ['双方算法包尚未上传'], detail: {} };

    this.phase = 'PREFLIGHT';
    const errors: string[] = [];

    const sampleMap = generateMapOrNull({ seed: this.seed, pointCount: this.pointCount, difficulty: this.difficulty });
    if (!sampleMap) {
      this.phase = 'UPLOAD_B';
      return { ok: false, errors: ['无法生成 Preflight 地图'], detail: {} };
    }
    // preflight 同样走两阶段协议 —— 既是冒烟测试，也是新契约的端到端自检
    const input = this.buildRunnerInput({
      matchId: `${this.matchId}-preflight`,
      round: 0,
      map: sampleMap,
      idA: 'A1',
      idB: 'B1',
    });

    const duel = await runDuel({
      matchId: `${this.matchId}-preflight`,
      roundNumber: 0,
      sandboxRoot: this.sandboxRoot,
      input,
      teamA: { packageDir: a.sealedDir, entry: a.entry },
      teamB: { packageDir: b.sealedDir, entry: b.entry },
      denyReadPaths: this.sandboxDenyReadPaths(),
      timeoutMs: this.timeoutMs,
      memoryLimitMb: this.memoryLimitMb,
    });

    const detail: Record<string, unknown> = {};
    for (const [team, outcome] of [['A', duel.a], ['B', duel.b]] as const) {
      // 每支队伍必须按自己的 Shooter 点校验 —— 用错点会误判 NOT_THROUGH_SHOOTER
      const shooterPos = team === 'A' ? sampleMap.teamA[0] : sampleMap.teamB[0];
      const check = this.validateOutcome(outcome, sampleMap, shooterPos, team);
      detail[team] = {
        success: outcome.success,
        errorCode: outcome.errorCode,
        computeTimeMs: outcome.computeTimeMs,
        valid: check.ok,
        errors: check.errors,
      };
      if (!outcome.success) errors.push(`${team} 算法无法正常运行: ${outcome.error}`);
      else if (!check.ok) errors.push(`${team} 算法输出不合法: ${check.errors.join('; ')}`);
    }

    this.preflightDone = errors.length === 0;
    this.audit.log('Preflight', { ok: errors.length === 0, errors });
    this.phase = 'UPLOAD_B';
    return { ok: errors.length === 0, errors, detail };
  }

  // ========================================================================
  // 开始比赛
  // ========================================================================

  startMatch(): { ok: boolean; errors: string[] } {
    if (this.phase !== 'UPLOAD_B') {
      return { ok: false, errors: [`当前阶段 ${this.phase} 不能开始比赛`] };
    }
    if (!this.packages.A || !this.packages.B) {
      return { ok: false, errors: ['双方算法包尚未上传'] };
    }
    if (!this.preflightDone) {
      return { ok: false, errors: ['Preflight 尚未通过，不允许开始比赛'] };
    }

    const map = generateMapOrNull({ seed: this.seed, pointCount: this.pointCount, difficulty: this.difficulty });
    if (!map) {
      return { ok: false, errors: [`seed=${this.seed} 无法生成合法地图`] };
    }

    this.map = map;
    this.seed = map.seed; // 记录实际使用的种子
    this.points = [
      ...map.teamA.map((p, i): PointState => ({ id: `A${i + 1}`, team: 'A', position: p, alive: true })),
      ...map.teamB.map((p, i): PointState => ({ id: `B${i + 1}`, team: 'B', position: p, alive: true })),
    ];
    this.phase = 'SELECT_SHOOTER';
    this.roundNumber = 0;
    this.startedAt = new Date();
    this.audit.log('MatchStarted', { seed: map.seed, mapHash: map.stateHash, points: map.teamA.length });
    return { ok: true, errors: [] };
  }

  // ========================================================================
  // Shooter 选择
  // ========================================================================

  selectShooter(team: 'A' | 'B', pointId: string): { ok: boolean; error: string | null } {
    if (this.phase !== 'SELECT_SHOOTER' && this.phase !== 'LOCKED') {
      return { ok: false, error: `当前阶段 ${this.phase} 不允许选择 Shooter` };
    }
    if (this.locked[team]) {
      return { ok: false, error: `${team} 已经锁定，Lock 后不可修改` };
    }

    const point = this.points.find((p) => p.id === pointId);
    if (!point) return { ok: false, error: `未知的点: ${pointId}` };
    if (point.team !== team) return { ok: false, error: `${pointId} 不属于 ${team}` };
    if (!point.alive) return { ok: false, error: `${pointId} 已被击杀，死点不可选择` };
    if (this.shooters[team]) return { ok: false, error: `${team} 本轮已选择 Shooter` };

    this.shooters[team] = point;
    this.audit.log('ShooterSelected', { point: pointId, position: point.position }, team);
    return { ok: true, error: null };
  }

  lockShooter(team: 'A' | 'B'): { ok: boolean; error: string | null } {
    if (!this.shooters[team]) return { ok: false, error: `${team} 尚未选择 Shooter` };
    if (this.locked[team]) return { ok: false, error: `${team} 已经锁定` };

    this.locked[team] = true;
    this.audit.log('ShooterLocked', { point: this.shooters[team]!.id }, team);

    if (this.locked.A && this.locked.B) {
      this.phase = 'LOCKED';
      this.audit.log('BothLocked', {});
    }
    return { ok: true, error: null };
  }

  /** 裁判开始本轮 —— 双方 READY 不会自动触发（Plan V1 §27 / Gate §19） */
  judgeStartRound(): { ok: boolean; error: string | null } {
    if (this.phase !== 'LOCKED') {
      return { ok: false, error: `当前阶段 ${this.phase} 不能 START ROUND（需双方 LOCK）` };
    }
    this.audit.log('JudgeStartRound', { round: this.roundNumber + 1 });
    return { ok: true, error: null };
  }

  // ========================================================================
  // 执行一轮
  // ========================================================================

  async runRound(): Promise<RoundResult> {
    if (this.phase !== 'LOCKED') throw new MatchEngineError(`当前阶段 ${this.phase} 不能运行 Round`);
    if (!this.map || !this.shooters.A || !this.shooters.B) throw new MatchEngineError('缺少地图或 Shooter');
    if (!this.packages.A || !this.packages.B) throw new MatchEngineError('缺少算法包');

    const round = this.roundNumber + 1;
    const machine = new RoundMachine(round);
    this.machine = machine;

    machine.beginSelection();
    machine.lockShooter('A');
    machine.lockShooter('B');
    machine.judgeStartRound();
    machine.startCountdown();
    while (machine.getPhase() === 'COUNTDOWN') {
      this.phase = 'COUNTDOWN';
      machine.tickCountdown();
    }
    this.phase = 'REVEAL';
    machine.reveal();
    machine.sendRoundState();

    // ---- RoundState：双方字节级一致（仅 team_id 不同）----
    const shooterA = this.shooters.A;
    const shooterB = this.shooters.B;
    const core = this.buildCore(round, shooterA, shooterB);
    const stateHash = computeStateHash(core);

    // ---- 密封副本完整性（P0-6）----
    for (const team of ['A', 'B'] as const) {
      const sealed = this.packages[team]!;
      const verify = verifySeal(sealed);
      if (!verify.ok) {
        this.audit.log('PackageTampered', { errors: verify.errors }, team);
        throw new MatchEngineError(`${team} 算法包在比赛期间被篡改: ${verify.errors.join('; ')}`);
      }
    }

    machine.startComputing('A');
    machine.startComputing('B');
    this.phase = 'COMPUTING';
    this.audit.log('RoundComputeStart', { round, stateHash });

    // ---- 运行双方算法 ----
    const cancelled: { A: boolean; B: boolean } = { A: false, B: false };
    // 一份字节，两个沙箱 —— 队别只经 --team argv 分化（规范 §11/§12）
    const input = this.buildRunnerInput({
      matchId: this.matchId,
      round,
      map: this.map!,
      idA: shooterA.id,
      idB: shooterB.id,
    });
    const duel = await runDuel({
      matchId: this.matchId,
      roundNumber: round,
      sandboxRoot: this.sandboxRoot,
      input,
      teamA: {
        packageDir: this.packages.A.sealedDir,
        entry: this.packages.A.entry,
      },
      teamB: {
        packageDir: this.packages.B.sealedDir,
        entry: this.packages.B.entry,
      },
      denyReadPaths: this.sandboxDenyReadPaths(),
      timeoutMs: this.timeoutMs,
      memoryLimitMb: this.memoryLimitMb,
      onFirstResult: (team, outcome) => {
        // 先手立即结算；若击杀了对方 Shooter 则立即取消对方进程（Plan V1 §25）
        if (!outcome.success) return false;
        const parsed = parseCanonicalDSL(outcome.stdout ? extractDsl(outcome) ?? '' : '');
        if (!parsed.ok || !parsed.ast) return false;
        const check = this.validateAst(parsed.ast, team, core);
        if (!check.ok) return false;

        const enemies = this.aliveEnemies(team);
        const preview = judgeShot(parsed.ast, this.shooters[team]!.position, team, enemies, this.map!.obstacles);
        const killedEnemyShooter = preview.hits.includes(this.shooters[team === 'A' ? 'B' : 'A']!.id);
        if (killedEnemyShooter) {
          const other = team === 'A' ? 'B' : 'A';
          cancelled[other] = true;
          this.audit.log('ShotCancelled', { reason: 'shooter eliminated by first solver', round }, other);
          return true;
        }
        return false;
      },
    });

    this.lastIsolation = duel.isolation;
    this.audit.log('RoundComputeEnd', {
      round,
      releaseSkewUs: duel.releaseSkewUs,
      readySkewMs: duel.readySkewMs,
      isolation: duel.isolation,
    });

    // ---- 结算 ----
    const outcomeA = duel.a;
    const outcomeB = duel.b;

    const validA = outcomeA.success && !outcomeA.cancelled;
    const validB = outcomeB.success && !outcomeB.cancelled;

    const astA = validA ? this.tryParseAst(outcomeA) : null;
    const astB = validB ? this.tryParseAst(outcomeB) : null;

    const checkA = astA ? this.validateAst(astA, 'A', core) : { ok: false, errors: [] as string[] };
    const checkB = astB ? this.validateAst(astB, 'B', core) : { ok: false, errors: [] as string[] };

    const finalA = astA && checkA.ok ? astA : null;
    const finalB = astB && checkB.ok ? astB : null;

    // 先手顺序：按相对同一个 release 时刻的耗时（P1-15）
    const tA = validA ? outcomeA.computeTimeMs : null;
    const tB = validB ? outcomeB.computeTimeMs : null;
    let firstSolver: 'A' | 'B' | 'tie' | 'none' = 'none';
    let order: ('A' | 'B')[] = [];

    if (finalA && finalB && tA !== null && tB !== null) {
      if (Math.abs(tA - tB) <= TIE_EPS_MS) {
        firstSolver = 'tie';
        order = ['A', 'B'];
      } else if (tA < tB) {
        firstSolver = 'A';
        order = ['A', 'B'];
      } else {
        firstSolver = 'B';
        order = ['B', 'A'];
      }
    } else if (finalA) {
      firstSolver = 'A';
      order = ['A'];
    } else if (finalB) {
      firstSolver = 'B';
      order = ['B'];
    }

    // 按顺序结算攻击（纯函数，见 resolveOrderedShots）
    const simultaneous = firstSolver === 'tie';
    // 必须在结算**之前**取快照：resolveOrderedShots 会就地修改 alive 标记
    const snapshot = this.points.filter((p) => p.alive);
    const { shots, killed } = resolveOrderedShots({
      order,
      simultaneous,
      points: this.points,
      shooters: { A: shooterA, B: shooterB },
      ast: { A: finalA, B: finalB },
      obstacles: this.map.obstacles,
      cancelled,
      onCancelled: (team, reason) => this.audit.log('ShotCancelled', { reason, round }, team),
    });
    const killedSet = new Set(killed);

    // 阶段推进（无解时走 noSolution，不伪造 FIRST_SOLUTION）
    if (finalA || finalB) {
      machine.firstSolution();
      machine.firstShot();
      machine.checkShooter();
      if (order.length > 1) machine.secondSolution();
      machine.secondShot();
      machine.roundResult();
    } else {
      machine.noSolution();
    }

    const aliveAfter = {
      A: this.points.filter((p) => p.team === 'A' && p.alive).length,
      B: this.points.filter((p) => p.team === 'B' && p.alive).length,
    };

    const aKills = shots.A ? shots.A.killed.filter((id) => id.startsWith('B')).length : 0;
    const bKills = shots.B ? shots.B.killed.filter((id) => id.startsWith('A')).length : 0;

    // 取消是独立语义，不能与「算法非法」共用同一个 result 码（P2-A）
    const cancelledA = cancelled.A || outcomeA.errorCode === 'CANCELLED';
    const cancelledB = cancelled.B || outcomeB.errorCode === 'CANCELLED';

    // 运行器成功、但输出构不成合法函数时，运行器自身没有错误码 —— 补一个与回合
    // 结果一致的诊断码，避免出现「result = INVALID_A 但 aErrorCode = null」
    // （Re-Gate Cycle 2 审计 D-3）。失败/取消路径保持运行器自己的错误码。
    const errorCodeFor = (
      outcome: RunnerOutcome,
      final: CanonicalNode | null
    ): RunnerOutcome['errorCode'] =>
      outcome.errorCode ?? (outcome.success && !final ? 'INVALID_DSL' : null);

    const log: RoundLog = {
      round,
      stateHash,
      mapSeed: this.map.seed,
      mapHash: this.map.stateHash,
      shooterA: shooterA.id,
      shooterB: shooterB.id,
      aTimeMs: tA,
      bTimeMs: tB,
      aFunction: finalA ? JSON.stringify(finalA) : null,
      bFunction: finalB ? JSON.stringify(finalB) : null,
      aFunctionMath: finalA ? toMathString(finalA) : null,
      bFunctionMath: finalB ? toMathString(finalB) : null,
      aFunctionHash: finalA ? hashNode(finalA) : null,
      bFunctionHash: finalB ? hashNode(finalB) : null,
      aHits: shots.A?.hits ?? [],
      bHits: shots.B?.hits ?? [],
      aKills,
      bKills,
      aBlocked: Boolean(shots.A?.blocked),
      bBlocked: Boolean(shots.B?.blocked),
      cancelledA,
      cancelledB,
      aErrorCode: errorCodeFor(outcomeA, finalA),
      bErrorCode: errorCodeFor(outcomeB, finalB),
      aliveAAfter: aliveAfter.A,
      aliveBAfter: aliveAfter.B,
      result: deriveRoundResult(outcomeA, outcomeB, finalA, finalB, cancelledA, cancelledB),
      firstSolver,
    };

    this.frames.push({
      round,
      phase: machine.getPhase(),
      stateHash,
      obstacles: this.map.obstacles,
      // 必须是「本轮开战前仍存活」的点，而不是全体名单 ——
      // 否则回放里第 N 轮会把前几轮已阵亡的点画成活的（P1-16）。
      aliveBefore: snapshot.map((p) => ({ id: p.id, team: p.team, position: p.position })),
      shooterA: { id: shooterA.id, position: shooterA.position },
      shooterB: { id: shooterB.id, position: shooterB.position },
      functionA: finalA,
      functionB: finalB,
      functionMathA: finalA ? toMathString(finalA) : null,
      functionMathB: finalB ? toMathString(finalB) : null,
      trajectoryA: simplifyTrajectory(shots.A?.trajectory ?? []),
      trajectoryB: simplifyTrajectory(shots.B?.trajectory ?? []),
      hitsA: (shots.A?.hitDetails ?? []).map((h) => ({ id: h.id, at: h.at })),
      hitsB: (shots.B?.hitDetails ?? []).map((h) => ({ id: h.id, at: h.at })),
      killed: [...killedSet],
      blockedA: shots.A?.blocked ? shots.A.blocked.at : null,
      blockedB: shots.B?.blocked ? shots.B.blocked.at : null,
      timerA: tA,
      timerB: tB,
      cancelledA: cancelled.A,
      cancelledB: cancelled.B,
      firstSolver,
      aliveAfter: this.points.filter((p) => p.alive).map((p) => ({ id: p.id, team: p.team, position: p.position })),
    });

    this.rounds.push(log);
    this.roundNumber = round;
    this.audit.log('RoundResult', { round, firstSolver, aKills, bKills, aliveAfter, killed: [...killedSet] });

    // 重置本轮选择
    this.shooters = { A: null, B: null };
    this.locked = { A: false, B: false };

    const winner = this.getWinner();
    if (winner) {
      this.phase = 'MATCH_END';
      machine.matchEnd();
      this.audit.log('MatchEnded', { winner });
    } else {
      this.phase = 'SELECT_SHOOTER';
      machine.nextRound();
    }

    return {
      round,
      stateHash,
      firstSolver,
      shooterA: shooterA.id,
      shooterB: shooterB.id,
      killed: [...killedSet],
      cancelled,
      hits: { A: shots.A?.hits ?? [], B: shots.B?.hits ?? [] },
      computeTimeMs: { A: tA, B: tB },
      aliveAfter,
      winner,
      log,
      machinePhases: machine.visitedPhases(),
    };
  }

  // ========================================================================
  // 查询
  // ========================================================================

  getWinner(): 'A' | 'B' | 'draw' | null {
    if (this.points.length === 0) return null;
    const a = this.points.filter((p) => p.team === 'A' && p.alive).length;
    const b = this.points.filter((p) => p.team === 'B' && p.alive).length;
    if (a === 0 && b === 0) return 'draw';
    if (a === 0) return 'B';
    if (b === 0) return 'A';
    return null;
  }

  getSnapshot(): MatchSnapshot {
    return {
      matchId: this.matchId,
      phase: this.phase,
      round: this.roundNumber,
      seed: this.seed,
      map: this.map,
      points: this.points.map((p) => ({ ...p })),
      shooters: {
        A: this.shooters.A ? { ...this.shooters.A } : null,
        B: this.shooters.B ? { ...this.shooters.B } : null,
      },
      locked: { ...this.locked },
      alive: {
        A: this.points.filter((p) => p.team === 'A' && p.alive).length,
        B: this.points.filter((p) => p.team === 'B' && p.alive).length,
      },
      winner: this.getWinner(),
      packages: {
        A: this.packages.A ? { hash: this.packages.A.hash, name: this.packages.A.manifest.name } : null,
        B: this.packages.B ? { hash: this.packages.B.hash, name: this.packages.B.manifest.name } : null,
      },
      isolation: this.lastIsolation,
      rounds: [...this.rounds],
    };
  }

  getMatchLog(): MatchLog {
    return {
      schemaVersion: 1,
      matchId: this.matchId,
      seed: this.seed,
      pointCount: this.pointCount,
      difficulty: this.difficulty,
      teamAName: this.teamAName,
      teamBName: this.teamBName,
      teamAPackageHash: this.packages.A?.hash ?? null,
      teamBPackageHash: this.packages.B?.hash ?? null,
      startTime: this.startedAt.toISOString(),
      endTime: new Date().toISOString(),
      winner: this.getWinner() ?? 'draw',
      rounds: [...this.rounds],
      finalAlive: {
        A: this.points.filter((p) => p.team === 'A' && p.alive).length,
        B: this.points.filter((p) => p.team === 'B' && p.alive).length,
      },
    };
  }

  getReplay(): Replay {
    return {
      schemaVersion: 1,
      matchId: this.matchId,
      seed: this.seed,
      teamAName: this.teamAName,
      teamBName: this.teamBName,
      winner: this.getWinner() ?? 'draw',
      frames: [...this.frames],
    };
  }

  getArtifacts(): MatchArtifacts {
    return { matchLog: this.getMatchLog(), auditLog: this.audit.snapshot(), replay: this.getReplay() };
  }

  getArtifactDir(): string {
    return path.join(this.artifactRoot, 'matches', this.matchId);
  }

  /**
   * 密封包根目录。沙箱必须显式禁止读取它 —— 否则当 artifactRoot 落在
   * /Users 之外（例如操作员指定 --artifacts /tmp/...）时，对手的密封包
   * 会落在 `(allow file-read*)` 的默认放行范围内。
   */
  get sealedRoot(): string {
    return path.join(this.artifactRoot, 'sealed');
  }

  // ========================================================================
  // 内部
  // ========================================================================

  /**
   * 沙箱必须拒绝读取的路径集合（P0-7 / Re-Gate Cycle 1 P0-B）。
   *
   * 早期版本只拒绝 `[sealedRoot, PLATFORM_ROOT]`，于是当双方源包位于
   * sealedRoot 之外（正是 CLI 的常规用法 `--a <dir> --b <dir>`）时，
   * 算法进程可以直接读取**对手的源码**；`artifactRoot` 换目录时，
   * **上一场比赛的密封包与 match.json** 也可读。
   * 现在把双方源包目录与整个 artifactRoot 一并拒绝。
   * （`/private/tmp`、`/private/var/tmp` 由 SandboxRunner 无条件拒绝。）
   */
  private sandboxDenyReadPaths(): string[] {
    const paths = [this.sealedRoot, this.artifactRoot, PLATFORM_ROOT];
    for (const team of ['A', 'B'] as const) {
      const pkg = this.packages[team];
      if (pkg) paths.push(pkg.sourceDir);
    }
    return paths;
  }

  private aliveEnemies(team: 'A' | 'B'): { id: string; position: Point }[] {
    return this.points
      .filter((p) => p.alive && p.team !== team)
      .map((p) => ({ id: p.id, position: p.position }));
  }

  private buildCore(round: number, shooterA: PointState, shooterB: PointState): RoundStateCore {
    return this.buildCoreFor(this.map!, round, shooterA.position, shooterB.position, shooterA.id, shooterB.id);
  }

  /**
   * 构造本轮的两阶段输入字节（V1.1 规范 §4-§10）。
   *
   * 只产出**字节**，不落盘 —— 落盘是 `prepareSandbox` 的事，两份字节
   * 由 `runDuel` 分别写进两个沙箱，因此对 A/B 必然逐字节相同（规范 §11）。
   *
   * `round === 0` 是 preflight 的 decoy 世界：点集取自地图本身、全部存活，
   * 障碍物与 seed 也都是 decoy 的（规范 §14/§15）。
   */
  private buildRunnerInput(o: {
    matchId: string;
    round: number;
    map: GeneratedMap;
    idA: string;
    idB: string;
  }): RunnerInput {
    const points: PublicStatePoint[] =
      o.round === 0
        ? [
            ...o.map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, x: p.x, y: p.y, alive: true })),
            ...o.map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, x: p.x, y: p.y, alive: true })),
          ]
        : // 正式回合：**完整名单含死点**（规范 §5），死点 alive=false
          this.points.map((p) => ({
            id: p.id,
            team: p.team,
            x: p.position.x,
            y: p.position.y,
            alive: p.alive,
          }));

    const publicState = buildPublicState({ matchId: o.matchId, round: o.round, points });
    const revealState = buildRevealState({
      matchId: o.matchId,
      round: o.round,
      publicStateSha256: publicState.sha256,
      shooters: { A: o.idA, B: o.idB },
      obstacles: o.map.obstacles,
    });
    return { publicJson: publicState.json, revealJson: revealState.json };
  }

  private buildCoreFor(
    map: GeneratedMap,
    round: number,
    posA: Point,
    posB: Point,
    idA = 'A1',
    idB = 'B1'
  ): RoundStateCore {
    const alive: AlivePoint[] = round === 0
      ? [
          ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, position: p })),
          ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, position: p })),
        ]
      : this.points.filter((p) => p.alive).map((p) => ({ id: p.id, team: p.team, position: p.position }));

    return {
      round,
      mapSeed: map.seed,
      mapHash: map.stateHash,
      obstacles: map.obstacles,
      points: alive,
      shooters: { A: { id: idA, position: posA }, B: { id: idB, position: posB } },
      teamAXRange: [-20, -4],
      teamBXRange: [4, 20],
    };
  }

  private tryParseAst(outcome: RunnerOutcome): CanonicalNode | null {
    return this.parseAstDetailed(outcome).ast;
  }

  /**
   * 解析算法输出，并保留失败原因。
   *
   * 早期实现把解析失败一律压成「输出不是合法 DSL」，于是「深度超限」这类关键
   * 诊断在集成层被抹平：删掉 AST 深度守卫后集成回归仍会通过（因为随后必然被
   * Shooter 校验拒绝，文案同样是「输出不合法」）。诊断必须如实透出
   * （Re-Gate Cycle 2 审计 D-2）。
   */
  private parseAstDetailed(outcome: RunnerOutcome): { ast: CanonicalNode | null; reason: string } {
    const dsl = extractDsl(outcome);
    if (!dsl) return { ast: null, reason: '输出中找不到 dsl / function / f 字段' };
    const parsed = parseCanonicalDSL(dsl);
    if (parsed.ok && parsed.ast) return { ast: parsed.ast, reason: '' };
    const detail = parsed.issues.map((i) => `${i.code}: ${i.message}`).join('; ');
    return { ast: null, reason: detail || '输出不是合法 DSL' };
  }

  private validateOutcome(
    outcome: RunnerOutcome,
    map: GeneratedMap,
    shooterPos: Point,
    team: 'A' | 'B'
  ): { ok: boolean; errors: string[] } {
    if (!outcome.success) return { ok: false, errors: [outcome.error ?? 'unknown'] };
    const { ast, reason } = this.parseAstDetailed(outcome);
    if (!ast) return { ok: false, errors: [`输出不是合法 DSL: ${reason}`] };
    const core = this.buildCoreFor(map, 0, shooterPos, shooterPos);
    return this.validateAst(ast, team, core);
  }

  /** 完整函数校验（结构 + 数值 + 经过 Shooter） */
  private validateAst(ast: CanonicalNode, team: 'A' | 'B', core: RoundStateCore): { ok: boolean; errors: string[] } {
    const shooter = core.shooters[team];
    const domain = firingDomain(shooter.position.x, team);
    const result = validateAttackFunction(ast, domain, shooter.position);
    return { ok: result.valid, errors: result.issues.map((i) => `${i.code}: ${i.message}`) };
  }
}

// ============================================================================
// 辅助
// ============================================================================

function extractDsl(outcome: RunnerOutcome): string | null {
  const text = outcome.stdout.trim();
  if (!text) return null;
  const tryOne = (s: string): string | null => {
    try {
      const obj = JSON.parse(s);
      const dsl = obj?.dsl ?? obj?.function ?? obj?.f ?? null;
      if (dsl === null || dsl === undefined) return null;
      return typeof dsl === 'string' ? dsl : JSON.stringify(dsl);
    } catch {
      return null;
    }
  };
  const whole = tryOne(text);
  if (whole) return whole;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = tryOne(lines[i]);
    if (p) return p;
  }
  return null;
}

/**
 * 回合结果码。
 *
 * 取消优先（Re-Gate Cycle 1 P2-A）：Shooter 被先手方击杀导致攻击被取消，
 * 与「算法输出非法」是完全不同的原因，必须有独立的 result 码 ——
 * 否则计分、复盘、审计都会把「被取消」误读成「算法非法」。
 */
function deriveRoundResult(
  a: RunnerOutcome,
  b: RunnerOutcome,
  finalA: CanonicalNode | null,
  finalB: CanonicalNode | null,
  cancelledA: boolean,
  cancelledB: boolean
): RoundLog['result'] {
  if (cancelledA !== cancelledB) return cancelledA ? 'CANCELLED_A' : 'CANCELLED_B';
  if (finalA && finalB) return 'COMPLETE';
  if (!finalA && !finalB) return 'TECHNICAL_INVALID';
  if (!finalA) return a.errorCode === 'TIMEOUT' ? 'TIMEOUT_A' : 'INVALID_A';
  return b.errorCode === 'TIMEOUT' ? 'TIMEOUT_B' : 'INVALID_B';
}

export interface OrderedShotInput {
  /** 射击顺序；并列先手时仍是 ['A','B']，但 simultaneous=true */
  order: ('A' | 'B')[];
  /** 并列先手：双方同时开火，都基于开战前快照，击杀在双方都结算后统一应用 */
  simultaneous: boolean;
  /** 会被就地修改 alive 标记 */
  points: PointState[];
  shooters: { A: PointState; B: PointState };
  ast: { A: CanonicalNode | null; B: CanonicalNode | null };
  obstacles: Obstacle[];
  /** 被取消的队伍会被置为 true */
  cancelled: { A: boolean; B: boolean };
  onCancelled?: (team: 'A' | 'B', reason: string) => void;
}

export interface OrderedShotResult {
  shots: Record<'A' | 'B', ShotOutcome | null>;
  killed: string[];
}

/**
 * 按先手顺序结算攻击（Plan V1 §23-§25）。
 *
 * 语义要点（Re-Gate Cycle 1 P2-B）：
 *   - 非并列时严格串行：**先手方的击杀立即生效**，因此后手方的
 *     `shooter.alive` 守卫是可达的。早期实现把守卫放在循环内、
 *     把击杀应用放在循环之后，守卫恒为真，取消只能靠进程 kill。
 *   - 并列先手时双方同时开火：都基于同一个开战前快照，
 *     击杀在双方都结算完之后统一应用。
 */
export function resolveOrderedShots(input: OrderedShotInput): OrderedShotResult {
  const { order, simultaneous, points, shooters, ast, obstacles, cancelled } = input;
  const shots: Record<'A' | 'B', ShotOutcome | null> = { A: null, B: null };
  const killedSet = new Set<string>();
  const snapshot = points.filter((p) => p.alive);

  const markDead = (ids: Iterable<string>): void => {
    for (const id of ids) {
      const p = points.find((x) => x.id === id);
      if (p) p.alive = false;
    }
  };

  for (const team of order) {
    const fn = ast[team];
    if (!fn) continue;
    const shooter = shooters[team];
    if (!shooter.alive) {
      // 后手方 Shooter 已被先手方击杀 —— 攻击取消
      cancelled[team] = true;
      input.onCancelled?.(team, 'shooter eliminated before its shot');
      continue;
    }
    const enemies = (simultaneous ? snapshot : points.filter((p) => p.alive))
      .filter((p) => p.team !== team)
      .map((p) => ({ id: p.id, position: p.position }));
    const outcome = judgeShot(fn, shooter.position, team, enemies, obstacles);
    shots[team] = outcome;
    for (const id of outcome.killed) killedSet.add(id);
    if (!simultaneous) markDead(outcome.killed);
  }

  if (simultaneous) markDead(killedSet);
  return { shots, killed: [...killedSet] };
}

export function generateMatchId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1e9).toString(36).toUpperCase();
  return `MATCH-${ts}-${rand}`;
}
