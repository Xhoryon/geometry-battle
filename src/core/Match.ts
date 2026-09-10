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
import { AlivePoint, RoundStateCore } from './RoundState';
import {
  PROTOCOL_VERSION,
  BuiltInputFile,
  PublicStatePoint,
  buildPublicState,
  buildRevealState,
  derivePreflightSeed,
  roundStateHash,
} from './InputProtocol';
import { COMPUTE_TIMEOUT_MS, MEMORY_LIMIT_MB, firingDomain } from './Rules';
import { generateMapOrNull, GeneratedMap } from '../map/MapGenerator';
import { ENTRY_FILENAME } from '../submission/Manifest';
import { checkRuntime, describeRuntime } from '../submission/Runtime';
import { SealedPackage, inspectPackage, sealPackage, verifySeal } from '../submission/Package';
import {
  DEFAULT_SLOT_ROOT,
  SlotState,
  StagedSlot,
  TeamSlot,
  commitSlot,
  discardSlot,
  readSlot,
  slotDir,
  stageSlot,
  writeSlotRecord,
} from '../submission/Slot';
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
  /** 固定算法槽位根目录（规范 §2/§41），默认 `<PLATFORM_ROOT>/algorithms` */
  slotRoot?: string;
}

export interface PointState {
  id: string;
  team: 'A' | 'B';
  position: Point;
  alive: boolean;
}

export interface RoundResult {
  round: number;
  /** 规范 §20 的三元哈希 —— V1.0 的单一 stateHash 已由它取代 */
  publicStateHash: string;
  revealStateHash: string;
  roundStateHash: string;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  shooterA: string;
  shooterB: string;
  killed: string[];
  /** 历史/兼容：规则修订后恒为 false，见 `RoundLog.cancelledA` 的说明（§11） */
  cancelled: { A: boolean; B: boolean };
  /** 本轮实际执行了攻击的队伍，按执行顺序（§12） */
  attacksExecuted: ('A' | 'B')[];
  /** 攻击执行瞬间该方 Shooter 是否存活（未攻击为 null）（§12） */
  shooterAliveAtAttack: { A: boolean | null; B: boolean | null };
  /** 本轮结算后双方同时归零（§8） */
  mutualElimination: boolean;
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

/**
 * 允许替换算法槽位的阶段（规范 §32）。
 *
 * 一旦进入选点/回合流程就冻结槽位：比赛中途换算法等于换了一场比赛，
 * 密封副本也早已与槽位脱钩，换与不换都会让审计对不上。
 */
const SLOT_INSTALL_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  'SETUP',
  'UPLOAD_A',
  'UPLOAD_B',
  'PREFLIGHT',
  'READY',
]);

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
  /** 固定算法槽位根目录（规范 §2） */
  private slotRoot: string;
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

  // ---- V1.1 三段式（规范 §3/§17/§18/§19/§25）----
  /** 本轮 public_state.json 的冻结字节（PRE-REVEAL 生成后不再变） */
  private pendingPublic: BuiltInputFile | null = null;
  /** 本轮 reveal_state.json 的冻结字节（双方 LOCK 后生成） */
  private pendingReveal: BuiltInputFile | null = null;
  private pendingRound = 0;
  private pendingHashes: {
    publicStateHash: string;
    revealStateHash: string;
    roundStateHash: string;
  } | null = null;
  /** 裁判是否已下达 START —— 唯一允许运行参赛代码的开关（规范 §14/§15） */
  private startGranted = false;

  constructor(opts: MatchOptions = {}) {
    this.matchId = opts.matchId ?? generateMatchId();
    this.seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);
    this.pointCount = opts.pointCount ?? 8;
    this.difficulty = opts.difficulty ?? 'medium';
    this.timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
    this.memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;
    this.sandboxRoot = opts.sandboxRoot ?? defaultSandboxRoot();
    this.artifactRoot = opts.artifactRoot ?? path.join(process.cwd(), 'artifacts');
    this.slotRoot = opts.slotRoot ?? path.join(PLATFORM_ROOT, DEFAULT_SLOT_ROOT);
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

  /** 两个槽位的当前状态（规范 §33 的 UI 数据源） */
  slotStates(): { A: SlotState; B: SlotState } {
    return { A: readSlot(this.slotRoot, 'A'), B: readSlot(this.slotRoot, 'B') };
  }

  /**
   * 把算法安装进固定槽位（规范 §31/§32）。
   *
   *     staging → validate → preflight → hash → seal → replace
   *
   * 失败时**现有槽位一个字节都不变**（规范 §32）：坏包不会破坏当前可用算法。
   * 每一步的失败都记 `SlotRejected` 审计事件并带上 stage，便于事后定位。
   *
   * preflight 走 decoy 世界（规范 §34/§35），对手固定为平台 `starter`：
   * 这样验证一队的算法不依赖另一队槽位是否已就绪，也不与正式比赛共用世界。
   */
  async installAlgorithm(
    team: TeamSlot,
    sourceDir: string
  ): Promise<{ ok: boolean; hash: string | null; errors: string[]; detail: Record<string, unknown> }> {
    if (!SLOT_INSTALL_PHASES.has(this.phase)) {
      const error = `当前阶段 ${this.phase} 不允许替换算法槽位（规范 §32：比赛中途冻结）`;
      this.audit.log('SlotRejected', { stage: 'phase', errors: [error] }, team);
      return { ok: false, hash: null, errors: [error], detail: { stage: 'phase' } };
    }

    // ---- staging + validate：只读源包、只写暂存目录 ----
    const staged = stageSlot({ slotRoot: this.slotRoot, team, sourceDir });
    if (!staged.ok) {
      this.audit.log('SlotRejected', { stage: 'validate', errors: staged.errors }, team);
      return { ok: false, hash: null, errors: staged.errors, detail: { stage: 'validate' } };
    }

    const detail: Record<string, unknown> = { stage: 'preflight', hash: staged.stage.hash, files: staged.stage.inspection.files.length };
    try {
      // ---- preflight：暂存副本真正跑一次（失败即丢弃暂存，槽位不动）----
      const pre = await this.preflightStaged(staged.stage, detail);
      if (!pre.ok) {
        discardSlot(staged.stage);
        this.audit.log('SlotRejected', { stage: 'preflight', errors: pre.errors, hash: staged.stage.hash }, team);
        return { ok: false, hash: null, errors: pre.errors, detail };
      }

      // ---- seal + replace：备份旧槽位 → 换上新的 → 复验 → 删除备份 ----
      const committed = commitSlot(staged.stage);
      if (!committed.ok) {
        discardSlot(staged.stage);
        this.audit.log('SlotRejected', { stage: 'replace', errors: committed.errors }, team);
        return { ok: false, hash: null, errors: committed.errors, detail };
      }
    } catch (e) {
      // 任何未预期的异常都不得留下暂存副本
      discardSlot(staged.stage);
      throw e;
    }

    const at = new Date().toISOString();
    writeSlotRecord(this.slotRoot, team, {
      schema_version: '1.1',
      team,
      hash: staged.stage.hash,
      entry: ENTRY_FILENAME,
      installed_at: at,
      source: path.resolve(sourceDir),
      preflight: { ok: true, at, matchId: this.slotPreflightMatchId(), error: null },
    });

    const dir = slotDir(this.slotRoot, team);
    this.audit.log('SlotInstalled', { slot: dir, hash: staged.stage.hash, files: staged.stage.inspection.files.length }, team);
    return { ok: true, hash: staged.stage.hash, errors: [], detail: { ...detail, slot: dir } };
  }

  private slotPreflightMatchId(): string {
    return `${this.matchId}-slot-preflight`;
  }

  /**
   * 槽位候选包的 decoy preflight（规范 §34/§35）。
   *
   * 对手固定为平台 starter，且只校验**被安装方**的输出 —— 平台对每一方
   * 的 DSL 都用该方自己的 Shooter 校验，用错点会误判 NOT_THROUGH_SHOOTER。
   */
  private async preflightStaged(
    stage: StagedSlot,
    detail: Record<string, unknown>
  ): Promise<{ ok: boolean; errors: string[] }> {
    const baselineDir = path.join(PLATFORM_ROOT, 'starter');
    const baseline = inspectPackage(baselineDir);
    if (!baseline.valid) {
      return { ok: false, errors: [`平台 starter 不可用: ${baseline.errors.join('; ')}`] };
    }

    const decoy = this.decoyMap();
    if (!decoy) return { ok: false, errors: ['无法生成 Preflight 地图'] };

    const matchId = this.slotPreflightMatchId();
    const input = this.buildRunnerInput({
      matchId,
      round: 0,
      map: decoy.map,
      idA: 'A1',
      idB: 'B1',
    });
    const stagedPkg = { packageDir: stage.stagingDir, entry: ENTRY_FILENAME };
    const basePkg = { packageDir: baselineDir, entry: ENTRY_FILENAME };

    const duel = await runDuel({
      matchId,
      roundNumber: 0,
      sandboxRoot: this.sandboxRoot,
      input,
      teamA: stage.team === 'A' ? stagedPkg : basePkg,
      teamB: stage.team === 'B' ? stagedPkg : basePkg,
      denyReadPaths: this.sandboxDenyReadPaths(),
      timeoutMs: this.timeoutMs,
      memoryLimitMb: this.memoryLimitMb,
    });

    const outcome = stage.team === 'A' ? duel.a : duel.b;
    const shooterPos = stage.team === 'A' ? decoy.map.teamA[0] : decoy.map.teamB[0];
    const check = this.validateOutcome(outcome, decoy.map, shooterPos, stage.team);

    detail.decoySeed = decoy.requestedSeed;
    detail.decoyMapSeed = decoy.map.seed;
    detail.matchSeed = this.seed;
    detail.success = outcome.success;
    detail.errorCode = outcome.errorCode;
    detail.computeTimeMs = outcome.computeTimeMs;
    detail.valid = check.ok;

    if (!outcome.success) return { ok: false, errors: [`算法无法正常运行: ${outcome.error}`] };
    if (!check.ok) return { ok: false, errors: [`算法输出不合法: ${check.errors.join('; ')}`] };
    return { ok: true, errors: [] };
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

    // decoy 世界（规范 §14/§15）：preflight 是参赛代码真正会跑的一个窗口，
    // 因此它绝不能拿比赛种子生成地图 —— 否则算法可以在 START 之前
    // 通过自己的运行环境反推出本轮障碍物。这里用与比赛无关的派生种子，
    // 且保证 decoy 种子（含地图生成器的实际用种）与比赛种子不同。
    const decoy = this.decoyMap();
    if (!decoy) {
      this.phase = 'UPLOAD_B';
      return { ok: false, errors: ['无法生成 Preflight 地图'], detail: {} };
    }
    const sampleMap = decoy.map;
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

    const detail: Record<string, unknown> = {
      decoySeed: decoy.requestedSeed,
      decoyMapSeed: sampleMap.seed,
      decoyMapHash: sampleMap.stateHash,
      matchSeed: this.seed,
    };
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
    // 审计证据：decoy 种子与实际比赛种子不同（规范 §14/§15）
    this.audit.log('Preflight', {
      ok: errors.length === 0,
      errors,
      decoySeed: decoy.requestedSeed,
      decoyMapSeed: sampleMap.seed,
      decoyMapHash: sampleMap.stateHash,
      matchSeed: this.seed,
    });
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
    // 规范 §5：把「双方环境完全相同」落成可审计的证据 —— 冻结清单 + 宿主实测差异。
    // 差异不阻断比赛（选手机器上可能没有 numpy），但会如实留在审计日志里。
    const runtime = checkRuntime();
    this.audit.log('RuntimeFrozen', {
      frozen: describeRuntime(),
      detected: runtime.detected,
      mismatches: runtime.mismatches,
    });
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

    // 状态机与真实人工操作一一对应：锁 → A_LOCKED / B_LOCKED → 双方锁 → WAITING_FOR_JUDGE
    this.ensureMachine().lockShooter(team);
    this.locked[team] = true;
    this.audit.log('ShooterLocked', { point: this.shooters[team]!.id }, team);

    if (this.locked.A && this.locked.B) {
      this.phase = 'LOCKED';
      this.audit.log('BothLocked', {});
    }
    return { ok: true, error: null };
  }

  // ========================================================================
  // 执行一轮 —— V1.1 三段式（规范 §3/§25）
  //   PRE-REVEAL (beginRound) → REVEAL (revealRound) → START (judgeStartRound)
  //   → COMPUTE (computeRound)
  // CLI 显式调用四段以便在 REVEAL 与 START 之间插入现场停顿（规范 §17）；
  // runRound() 保留为顺序调用四段的便捷 API。
  // ========================================================================

  /**
   * PRE-REVEAL：生成本轮 public_state.json 并冻结字节。
   *
   * 此时双方尚未选点，文件里没有任何隐藏信息（规范 §6/§7）；算法进程此刻
   * **不存在**（规范 §14/§15）。幂等：同一轮重复调用返回同一份字节。
   */
  beginRound(): { round: number; publicStateHash: string } {
    if (this.phase !== 'SELECT_SHOOTER' && this.phase !== 'LOCKED') {
      throw new MatchEngineError(`当前阶段 ${this.phase} 不能开始新一轮`);
    }
    if (!this.map) throw new MatchEngineError('比赛尚未开始');

    const round = this.roundNumber + 1;
    this.ensureMachine();

    if (this.pendingRound !== round) {
      this.pendingRound = round;
      this.pendingPublic = null;
      this.pendingReveal = null;
      this.pendingHashes = null;
      this.startGranted = false;
    }
    if (!this.pendingPublic) {
      this.pendingPublic = buildPublicState({
        matchId: this.matchId,
        round,
        points: this.publicPoints(),
      });
      this.audit.log('PublicStateGenerated', { round, publicStateHash: this.pendingPublic.sha256 });
    }
    return { round, publicStateHash: this.pendingPublic.sha256 };
  }

  /**
   * REVEAL：双方 LOCK 之后生成本轮 reveal_state.json，并绑定 public 的哈希
   * （规范 §8/§10）。揭盲是独立事件，可以停任意久（规范 §17）——
   * 此后 phase = REVEAL，参赛代码仍然没有运行。
   */
  revealRound(): { revealStateHash: string; roundStateHash: string } {
    if (this.pendingReveal && this.pendingHashes) {
      return {
        revealStateHash: this.pendingHashes.revealStateHash,
        roundStateHash: this.pendingHashes.roundStateHash,
      };
    }
    if (this.phase !== 'LOCKED') {
      throw new MatchEngineError(`当前阶段 ${this.phase} 不能揭盲（需双方 LOCK）`);
    }
    const shooterA = this.shooters.A;
    const shooterB = this.shooters.B;
    if (!shooterA || !shooterB) throw new MatchEngineError('缺少 Shooter');
    if (!this.map) throw new MatchEngineError('缺少地图');
    if (!this.pendingPublic) this.beginRound();

    this.ensureMachine().reveal(); // WAITING_FOR_JUDGE → REVEAL

    const round = this.pendingRound;
    const pub = this.pendingPublic!;
    this.pendingReveal = buildRevealState({
      matchId: this.matchId,
      round,
      publicStateSha256: pub.sha256,
      shooters: { A: shooterA.id, B: shooterB.id },
      obstacles: this.map.obstacles,
    });
    const hashes = {
      publicStateHash: pub.sha256,
      revealStateHash: this.pendingReveal.sha256,
      roundStateHash: roundStateHash(pub.sha256, this.pendingReveal.sha256),
    };
    this.pendingHashes = hashes;
    this.phase = 'REVEAL';
    this.audit.log('RevealStateGenerated', {
      round,
      ...hashes,
      shooters: { A: shooterA.id, B: shooterB.id },
      obstacleCount: this.map.obstacles.length,
    });
    return { revealStateHash: hashes.revealStateHash, roundStateHash: hashes.roundStateHash };
  }

  /**
   * START —— 唯一允许参赛代码运行的入口（规范 §14/§15/§25）。
   *
   * 幂等：重复调用返回成功。若调用时尚未揭盲（旧调用序「先 START 再 runRound」），
   * 按规范顺序补齐揭盲，而不是允许跳过它。
   */
  judgeStartRound(): { ok: boolean; error: string | null } {
    if (this.startGranted) return { ok: true, error: null };
    if (this.phase === 'LOCKED') {
      try {
        this.revealRound();
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    if (this.phase !== 'REVEAL') {
      return { ok: false, error: `当前阶段 ${this.phase} 不能 START ROUND（需双方 LOCK）` };
    }

    const machine = this.ensureMachine();
    machine.judgeStartRound(); // REVEAL → START_ROUND
    machine.startCountdown(); // START_ROUND → COUNTDOWN
    this.startGranted = true;
    this.phase = 'COUNTDOWN';
    this.audit.log('JudgeStartRound', { round: this.pendingRound, ...(this.pendingHashes ?? {}) });
    return { ok: true, error: null };
  }

  /** 便捷 API：按规范顺序走完一轮（PRE-REVEAL → REVEAL → START → COMPUTE） */
  async runRound(): Promise<RoundResult> {
    if (!this.map || !this.shooters.A || !this.shooters.B) throw new MatchEngineError('缺少地图或 Shooter');
    if (!this.packages.A || !this.packages.B) throw new MatchEngineError('缺少算法包');
    if (!this.pendingPublic) this.beginRound();
    if (this.phase === 'LOCKED') this.revealRound();
    const started = this.judgeStartRound();
    if (!started.ok) throw new MatchEngineError(started.error ?? 'START ROUND 失败');
    return this.computeRound();
  }

  /**
   * COMPUTE —— 把冻结的字节送进两个沙箱。
   *
   * `startGranted` 是硬门禁：没有 START 就没有参赛代码运行（规范 §14/§15）。
   * 本方法只读 `pendingPublic` / `pendingReveal` 的冻结字节，**不重新生成 JSON**
   * （规范 §19）—— 之后发生的任何击杀都只改变**实时结算状态**，
   * 不回写算法输入快照（规则修订 §7：Algorithm Input Snapshot ≠ Live Resolution State）。
   */
  async computeRound(): Promise<RoundResult> {
    if (!this.startGranted) {
      throw new MatchEngineError('START 尚未下达 —— START 前参赛代码绝不运行（规范 §14/§15）');
    }
    if (this.phase !== 'COUNTDOWN') {
      throw new MatchEngineError(`当前阶段 ${this.phase} 不能计算本轮`);
    }
    if (!this.pendingPublic || !this.pendingReveal || !this.pendingHashes) {
      throw new MatchEngineError('本轮输入字节缺失（未经过 PRE-REVEAL / REVEAL）');
    }
    if (!this.map || !this.shooters.A || !this.shooters.B) throw new MatchEngineError('缺少地图或 Shooter');
    if (!this.packages.A || !this.packages.B) throw new MatchEngineError('缺少算法包');

    const round = this.pendingRound;
    const hashes = this.pendingHashes;
    const machine = this.ensureMachine();

    // ---- RoundState（Judge 侧校验用）----
    const shooterA = this.shooters.A;
    const shooterB = this.shooters.B;
    const core = this.buildCore(round, shooterA, shooterB);

    // ---- 密封副本完整性（P0-6）----
    for (const team of ['A', 'B'] as const) {
      const sealed = this.packages[team]!;
      const verify = verifySeal(sealed);
      if (!verify.ok) {
        this.audit.log('PackageTampered', { errors: verify.errors }, team);
        throw new MatchEngineError(`${team} 算法包在比赛期间被篡改: ${verify.errors.join('; ')}`);
      }
    }

    // 倒计时以「计数归零」为终止条件，而不是阶段名 —— tickCountdown 归零后
    // 不再自行转换阶段（V1.1 把推进权交给宿主），用阶段名做条件会死循环。
    while (machine.getCountdown() !== null) machine.tickCountdown();
    machine.sendRoundState(); // COUNTDOWN → SEND_ROUND_STATE
    machine.startComputing('A'); // SEND_ROUND_STATE → A_COMPUTING
    machine.startComputing('B'); // A_COMPUTING → B_COMPUTING
    this.phase = 'COMPUTING';
    this.audit.log('RoundComputeStart', { round, ...hashes });

    // ---- 运行双方算法 ----
    // 一份**冻结的**字节，两个沙箱 —— 队别只经 --team argv 分化（规范 §11/§12/§19）
    const input: RunnerInput = {
      publicJson: this.pendingPublic.json,
      revealJson: this.pendingReveal.json,
    };
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
    });
    // 本轮**不再**有 onFirstResult 取消钩子：先手方击杀对方 Shooter 不再终止对方进程。
    // 双方的进程生命周期只由 valid result / timeout / crash / invalid output / 正常清理
    // 决定（V1.1 规则修订 §10），Shooter 死亡不再是 Runner termination signal。

    this.lastIsolation = duel.isolation;
    // 审计三件套（规范 §23）：两个 release 时刻与它们的偏差。
    // 计时**不**依赖 startSkew_ns，它只用来事后证明「同一个 GO 事件」确实近似同时。
    this.audit.log('RoundComputeEnd', {
      round,
      releaseA_ns: duel.releaseANs.toString(),
      releaseB_ns: duel.releaseBNs.toString(),
      startSkew_ns: duel.startSkewNs.toString(),
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
    const { shots, killed, shooterAliveAtAttack } = resolveOrderedShots({
      order,
      simultaneous,
      points: this.points,
      shooters: { A: shooterA, B: shooterB },
      ast: { A: finalA, B: finalB },
      obstacles: this.map.obstacles,
    });
    const killedSet = new Set(killed);
    // 实际执行了攻击的队伍，按执行顺序（规则修订 §12：必须能从日志明确证明
    // 「Shooter 在第二击前已死但第二击仍然执行」）。
    const attacksExecuted = order.filter((t) => shots[t] !== null);

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

    // 双方同归于尽：本轮结算完成后两队都归零 → MATCH DRAW，而不是因为
    // A 是 First Solver 就判 A 赢（V1.1 规则修订 §8）。
    const mutualElimination = aliveAfter.A === 0 && aliveAfter.B === 0;

    // cancelled 字段保留为**历史/兼容**语义（规则修订 §11/§23）：
    // 规则修订后「Shooter 被击杀 → 攻击取消」已不存在，这里只可能由运行器自身的
    // 显式取消（例如 READY 握手失败被 cancel()）置位，不再有先手击杀这条路径。
    // 新规则下 shot cancellation rate 恒为 0 by design；TIMEOUT / INVALID / CRASH
    // 绝不记作 cancellation（§23）。
    const cancelledA = outcomeA.errorCode === 'CANCELLED';
    const cancelledB = outcomeB.errorCode === 'CANCELLED';

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
      publicStateHash: hashes.publicStateHash,
      revealStateHash: hashes.revealStateHash,
      roundStateHash: hashes.roundStateHash,
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
      attacksExecuted,
      shooterAliveAtAttack,
      shooterAAliveAfterRound: shooterA.alive,
      shooterBAliveAfterRound: shooterB.alive,
      mutualElimination,
    };

    this.frames.push({
      round,
      phase: machine.getPhase(),
      publicStateHash: hashes.publicStateHash,
      revealStateHash: hashes.revealStateHash,
      roundStateHash: hashes.roundStateHash,
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
      cancelledA,
      cancelledB,
      firstSolver,
      attacksExecuted: [...attacksExecuted],
      shooterAliveAtAttack: { ...shooterAliveAtAttack },
      mutualElimination,
      aliveAfter: this.points.filter((p) => p.alive).map((p) => ({ id: p.id, team: p.team, position: p.position })),
    });

    this.rounds.push(log);
    this.roundNumber = round;
    this.audit.log('RoundResult', { round, firstSolver, aKills, bKills, aliveAfter, killed: [...killedSet] });

    // 重置本轮选择
    this.shooters = { A: null, B: null };
    this.locked = { A: false, B: false };
    // START 只对「本轮」有效：结算即收回授权，否则下一轮会在未 START 时开跑
    this.startGranted = false;
    // 本轮输入字节只服务本轮：结算后作废，下一轮必须重新生成（否则会拿到旧哈希）
    this.pendingPublic = null;
    this.pendingReveal = null;
    this.pendingHashes = null;

    const winner = this.getWinner();
    if (winner) {
      this.phase = 'MATCH_END';
      machine.matchEnd();
      if (mutualElimination) {
        this.audit.log('MutualElimination', { round, aliveAfter });
      }
      this.audit.log('MatchEnded', {
        winner,
        endReason: mutualElimination ? 'MUTUAL_ELIMINATION' : 'ELIMINATION',
      });
    } else {
      this.phase = 'SELECT_SHOOTER';
      machine.nextRound();
    }

    return {
      round,
      publicStateHash: hashes.publicStateHash,
      revealStateHash: hashes.revealStateHash,
      roundStateHash: hashes.roundStateHash,
      firstSolver,
      shooterA: shooterA.id,
      shooterB: shooterB.id,
      killed: [...killedSet],
      cancelled: { A: cancelledA, B: cancelledB },
      attacksExecuted,
      shooterAliveAtAttack,
      mutualElimination,
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

  /**
   * 结束原因（V1.1 规则修订 §8）。
   *
   * 双方同时归零必须判为平局：先手方清零对方、后手方凭已锁定的攻击权再清零先手方，
   * 这个局面在取消规则废止后才可能出现。**不得**因为谁是 First Solver 就自动判谁赢。
   */
  endReason(): MatchLog['endReason'] {
    const winner = this.getWinner();
    if (!winner) return 'NONE';
    if (winner !== 'draw') return 'ELIMINATION';
    // winner === 'draw' 有两个来源：双方同时归零，或点集为空。
    // 后者（points.length === 0）不是同归于尽，但也不属于 ELIMINATION 的语义，
    // 记 MUTUAL_ELIMINATION 会让审计误读 —— 用最后一轮记录的 mutualElimination 判定。
    const last = this.rounds[this.rounds.length - 1];
    return last?.mutualElimination ? 'MUTUAL_ELIMINATION' : 'NONE';
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
      protocolVersion: PROTOCOL_VERSION,
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
      endReason: this.endReason(),
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
    // slotRoot 一并拒绝：算法只应看到自己沙箱里的 app/ 副本，
    // 而不是对手槽位的源码（`--slots` 指向仓库外时尤其重要）。
    const paths = [this.sealedRoot, this.artifactRoot, PLATFORM_ROOT, this.slotRoot];
    for (const team of ['A', 'B'] as const) {
      const pkg = this.packages[team];
      if (pkg) paths.push(pkg.sourceDir);
    }
    return paths;
  }

  /**
   * 本轮 public_state 的点表：**完整名单含死点**（规范 §5），自然序 A1..An, B1..Bm。
   */
  private publicPoints(): PublicStatePoint[] {
    return this.points.map((p) => ({
      id: p.id,
      team: p.team,
      x: p.position.x,
      y: p.position.y,
      alive: p.alive,
    }));
  }

  /**
   * Preflight 的 decoy 世界（规范 §14/§15）。
   *
   * 种子由 `matchId` 派生（`derivePreflightSeed`），与操作员 `--seed` 无关。
   * 地图生成器为合法性可能微调种子，因此对**实际用种**也做撞车检查：
   * decoy 与比赛世界必须落在不同的种子上，否则 preflight 就变成本轮障碍物的预览。
   */
  private decoyMap(): { map: GeneratedMap; requestedSeed: number } | null {
    const gen = (seed: number) => generateMapOrNull({ seed, pointCount: this.pointCount, difficulty: this.difficulty });
    // 比赛世界的实际种子（startMatch 用同一份确定性生成，结果必然一致）
    const matchSeed = gen(this.seed)?.seed ?? this.seed;

    let seed = derivePreflightSeed(this.matchId);
    for (let attempt = 0; attempt < 8; attempt++, seed += 1) {
      if (seed === matchSeed) continue;
      const map = gen(seed);
      if (!map || map.seed === matchSeed) continue;
      return { map, requestedSeed: seed };
    }
    return null;
  }

  /**
   * 取本轮状态机；若不存在或属于上一轮则新建，并回放已经发生的人工操作。
   *
   * 回放锁定是必要的：`selectShooter` / `lockShooter` 可能先于 `beginRound()`
   * 被调用（脚本与测试的常规用法），此时机器还不存在。
   */
  private ensureMachine(): RoundMachine {
    const round = this.roundNumber + 1;
    if (this.machine && this.machine.roundNumber === round) return this.machine;

    const machine = new RoundMachine(round);
    machine.beginSelection();
    for (const team of ['A', 'B'] as const) {
      if (this.locked[team]) machine.lockShooter(team);
    }
    this.machine = machine;
    return machine;
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

/**
 * 取算法结果里的 DSL 文本。
 *
 * V1.1 起结果**只能**来自 `output/result.json`（规范 §24）：schema 与字段白名单
 * 已在 `parseResultFile()` 里严格校验过，这里只是把 AST 文本交给 DSL 解析器。
 * stdout 不再有解析回退路径 —— 「多输出以最后一次为准」的旧宽容语义已作废（规范 §29）。
 */
function extractDsl(outcome: RunnerOutcome): string | null {
  return outcome.dslText;
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
}

export interface OrderedShotResult {
  shots: Record<'A' | 'B', ShotOutcome | null>;
  killed: string[];
  /** 该队攻击执行**那一瞬间**其 Shooter 是否仍存活（未攻击则为 null） */
  shooterAliveAtAttack: Record<'A' | 'B', boolean | null>;
}

/**
 * 按先手顺序结算攻击（Plan V1 §23-§25 + V1.1 规则修订 §2/§3）。
 *
 * 语义要点：
 *   - **START 之后双方获得本轮独立且不可撤销的攻击权**（V1.1 规则修订 §2）。
 *     Shooter 是本轮攻击函数的数学发射锚点，**不要求存活到攻击执行瞬间**：
 *     Shooter 被先手方击杀不再删除后手方本轮的整个攻击。函数仍必须满足
 *     `f(x_shooter) = y_shooter`，锚点用的是 START 快照里的 Shooter（§3）。
 *   - 这里**没有**「Shooter 已死 → 跳过该方射击」的守卫，也**没有** cancelled
 *     出参 —— 取消语义在结构上就不存在，无法被悄悄重新引入（§11/§16）。
 *     攻击不执行的唯一原因是算法侧 TIMEOUT / INVALID / CRASH（§9/§10），
 *     而 `ast[team] === null` 正是这条路径。
 *   - 非并列时严格串行：先手方的击杀**立即生效**，后手方看到的敌方存活集合
 *     已经扣除先手方的战果（Live Resolution State，§7）。
 *   - 并列先手时双方同时开火：都基于同一个开战前快照，
 *     击杀在双方都结算完之后统一应用。
 */
export function resolveOrderedShots(input: OrderedShotInput): OrderedShotResult {
  const { order, simultaneous, points, shooters, ast, obstacles } = input;
  const shots: Record<'A' | 'B', ShotOutcome | null> = { A: null, B: null };
  const shooterAliveAtAttack: Record<'A' | 'B', boolean | null> = { A: null, B: null };
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
    // 在解析用哪份存活集合**之前**记录，才是「攻击执行瞬间」的真实状态。
    shooterAliveAtAttack[team] = shooter.alive;
    const enemies = (simultaneous ? snapshot : points.filter((p) => p.alive))
      .filter((p) => p.team !== team)
      .map((p) => ({ id: p.id, position: p.position }));
    const outcome = judgeShot(fn, shooter.position, team, enemies, obstacles);
    shots[team] = outcome;
    for (const id of outcome.killed) killedSet.add(id);
    if (!simultaneous) markDead(outcome.killed);
  }

  if (simultaneous) markDead(killedSet);
  return { shots, killed: [...killedSet], shooterAliveAtAttack };
}

export function generateMatchId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1e9).toString(36).toUpperCase();
  return `MATCH-${ts}-${rand}`;
}
