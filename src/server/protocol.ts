/**
 * Web UI 线上协议 —— 服务端与浏览器**共用**的类型与消息名。
 *
 * 约束（重要）：本文件**不得** import 任何 node 内置模块，也不得 import `src/core`。
 * 它会被 Vite 打进浏览器 bundle —— 一旦带上 node 依赖，前端直接构建失败。
 * 因此这里声明的 `WirePoint` / `WireObstacle` 是核心类型的**结构镜像**，
 * 而不是对核心类型的重导出。
 *
 * 镜像会不会漂移？由 `boards.ts` 顶部的编译期断言兜住：
 * 真实类型一旦新增成员而镜像没跟上，`npm run typecheck` 立刻报错。
 *
 * 权威状态**只有一个来源**：`MatchEngine`。本文件只描述「线上怎么传」。
 */

// ============================================================================
// 几何镜像
// ============================================================================

export interface WirePoint {
  x: number;
  y: number;
}

/** `src/obstacle/Obstacle.ts` 的 `Obstacle` 联合的结构镜像 */
export type WireObstacle =
  | { type: 'segment'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'rectangle'; xmin: number; xmax: number; ymin: number; ymax: number }
  | { type: 'circle'; center: [number, number]; radius: number }
  | { type: 'polygon'; vertices: [number, number][] };

export interface WireField {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// ============================================================================
// 枚举镜像
// ============================================================================

/** `src/core/Match.ts` 的 `MatchPhase` 的结构镜像 */
export type WirePhase =
  | 'SETUP'
  | 'UPLOAD_A'
  | 'UPLOAD_B'
  | 'PREFLIGHT'
  | 'READY'
  | 'PUBLIC'
  | 'REVEAL'
  | 'COUNTDOWN'
  | 'COMPUTING'
  | 'ROUND_RESULT'
  | 'MATCH_END';

/** `MatchLog['endReason']` 的结构镜像 */
export type WireEndReason =
  | 'ELIMINATION'
  | 'MUTUAL_ELIMINATION'
  | 'STALEMATE'
  | 'HARD_ROUND_LIMIT'
  | 'NONE';

export type WireTeam = 'A' | 'B';
export type WireWinner = 'A' | 'B' | 'draw';
export type WireDifficulty = 'easy' | 'medium' | 'hard';

// ============================================================================
// board —— 浏览器看到的全部状态
// ============================================================================

export interface ComputeCell {
  state: 'idle' | 'running' | 'done' | 'error';
  /** 引擎给出的单侧耗时（ms）；未产出为 null */
  timeMs: number | null;
  /** 引擎给出的错误码（TIMEOUT / CRASH / INVALID_*）；无错为 null */
  errorCode: string | null;
}

export interface ArenaPointView {
  id: string;
  team: WireTeam;
  position: WirePoint;
  alive: boolean;
}

export interface ArenaView {
  field: WireField;
  obstacles: WireObstacle[];
  emitters: { A: { id: string; position: WirePoint }; B: { id: string; position: WirePoint } } | null;
  points: ArenaPointView[];
}

export interface RoundSummaryView {
  round: number;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  /** 本轮实际执行了攻击的队伍，按执行顺序 */
  attacksExecuted: WireTeam[];
  killed: string[];
  aliveAfter: { A: number; B: number };
  /** 引擎给出的人话错误（§27 Error UX）；无错为空 */
  errors: string[];
}

/**
 * **观众板** —— 逐字段白名单。
 *
 * 这里没有的字段，浏览器**根本收不到**。因此「大屏不泄漏开发者诊断」
 * 是结构性事实，而不是一句需要人工维护的约定。
 *
 * 刻意**不含**：包哈希、包名、槽位目录、seed、审计、isolation、任何文件路径。
 */
export interface SpectatorBoard {
  matchId: string;
  round: number;
  phase: WirePhase;
  arena: ArenaView;
  alive: { A: number; B: number };
  /**
   * 轨迹**句柄**，不是轨迹本体。
   *
   * 轨迹是 board 里最大的载荷，绝不随 100ms ticker 反复发送：
   * 新轨迹只在产生时推送一次（`type:'trajectory'`），浏览器按 id 缓存。
   */
  trajectoryHandle: { id: string; round: number } | null;
  computes: { A: ComputeCell; B: ComputeCell };
  /**
   * 单方计算预算（ms）—— 冻结规则里的 500。
   *
   * 它本来就写在规则与选手手册里，是公开信息；放在板上是为了让
   * 「这一轮离超时还有多远」可被画出来 —— 这个比赛比的就是计算速度，
   * 而「0.31s / 500ms」比「0.31s」信息量大得多。
   */
  computeBudgetMs: number;
  lastRound: RoundSummaryView | null;
  /** 只有比赛真正结束才非 null —— 中途不得提前公布胜者 */
  verdict: { winner: WireWinner; endReason: WireEndReason } | null;
}

export interface SlotView {
  team: WireTeam;
  installed: boolean;
  status: string;
  hash: string | null;
  entry: string | null;
  preflightOk: boolean | null;
  files: number;
  totalBytes: number;
  errors: string[];
  /**
   * 该槽位**实际**所在的目录 —— 正式比赛里它属于运行期槽位根（`runs/slots`），
   * 而不是仓库里那份出厂 fixture（`algorithms/`）。
   *
   * 裁判据此当场判别「跑的是不是我投的那份算法」，不必去猜。
   */
  dir: string;
  /**
   * 算法包自报的名字（`manifest.name`）。
   *
   * 这是**防静默跑错算法**最直接的信号：裁判投的是「Team Rocket」而板上写着
   * 「Team Starter」，一眼就能看出来。不可用时为 null。
   */
  name: string | null;
  /**
   * 这份算法**怎么来的**：
   *   - `installed`   —— 经本平台安装流水线写入（有安装记录，`source` 是上传来源目录）
   *   - `unrecorded`  —— 槽位里有包但没有安装记录（出厂播种 / 手工放置）
   */
  origin: 'installed' | 'unrecorded';
  /** `origin === 'installed'` 时的上传来源目录；否则 null */
  source: string | null;
}

export interface SettingsView {
  seed: number;
  pointCount: number;
  difficulty: WireDifficulty;
}

export interface AuditEventView {
  at: string;
  seq: number;
  type: string;
  team?: WireTeam;
}

export interface AuditView {
  events: number;
  byType: { type: string; count: number }[];
  recent: AuditEventView[];
}

/**
 * 裁判可执行的动作。
 *
 * `enabled` 的判据必须**逐条来自引擎自己用的那个条件**（例：`startMatch()` 的真实判据是
 * 「双方已上传 + preflightDone」，那就读 `isPreflightPassed()`，**不许**拿
 * `phase === 'READY'` 这类代理量去猜 —— 那正是裁判台 V1.1 踩过的坑）。
 *
 * 即便 `enabled` 因 board 过期而失真，引擎仍会在命令执行时拒绝并给出人话错误 ——
 * `enabled` 只是提示，**权威永远是引擎**。
 */
export interface ActionView {
  key: string;
  label: string;
  enabled: boolean;
  hint: string;
}

/** **裁判板** —— 在观众板之上追加诊断。裁判看见诊断是刻意的。 */
export interface JudgeBoard extends SpectatorBoard {
  /**
   * 是否有命令正在执行（含后台推进整场比赛）。
   *
   * 这是**引擎外部**的真实状态：命令是串行的，忙时新命令会被拒绝。
   * 前端据此禁用按钮纯粹是为了不让人白点 —— 权威仍然是引擎的返回。
   */
  busy: boolean;
  /** 后台推进整场比赛时的最后一次失败说明；无失败为 null */
  lastError: string | null;
  settings: SettingsView;
  /** 当前生效的**运行期槽位根** —— 正式比赛的算法投递点（不是仓库里的 fixture） */
  slotRoot: string;
  slots: { A: SlotView; B: SlotView };
  packages: { A: { hash: string; name: string } | null; B: { hash: string; name: string } | null };
  runtime: { frozen: string; detected: string; ok: boolean; mismatches: string[] };
  audit: AuditView;
  artifactDir: string | null;
  actions: ActionView[];
}

// ============================================================================
// 轨迹
// ============================================================================

/**
 * 一条已判定轨迹的**降采样**副本。
 *
 * 浏览器只做 reveal 比例的逐帧揭示 —— **从不**重新求值函数。
 * 重新求值会画出一条穿过障碍物的曲线（真实轨迹在第一次接触障碍物或离开场地处
 * 就永久终止），现场看到的就是错的。
 */
export interface TrajectoryPayload {
  id: string;
  round: number;
  A: WirePoint[];
  B: WirePoint[];
  killed: string[];
  /** 建议的动画时长（ms）；浏览器可自行调速 */
  durationMs: number;
}

// ============================================================================
// WS 消息
// ============================================================================

export const WS_TOPICS = ['judge', 'spectator'] as const;
export type Topic = (typeof WS_TOPICS)[number];

export function isTopic(v: unknown): v is Topic {
  return typeof v === 'string' && (WS_TOPICS as readonly string[]).includes(v);
}

export type ServerMessage =
  | { type: 'hello'; topic: Topic; seq: number }
  | { type: 'board'; topic: Topic; seq: number; board: SpectatorBoard | JudgeBoard }
  | { type: 'trajectory'; topic: Topic; trajectory: TrajectoryPayload }
  | { type: 'pong' };

export type ClientMessage = { type: 'ping' };

// ============================================================================
// REST
// ============================================================================

export interface CommandResult {
  ok: boolean;
  errors: string[];
  detail?: Record<string, unknown>;
}

export const COMMAND_PATHS = {
  newMatch: '/api/judge/new-match',
  reset: '/api/judge/reset',
  install: '/api/judge/install',
  useSlot: '/api/judge/use-slot',
  preflight: '/api/judge/preflight',
  start: '/api/judge/start',
  reveal: '/api/judge/reveal',
  startRound: '/api/judge/start-round',
  compute: '/api/judge/compute',
  runToEnd: '/api/judge/run-to-end',
} as const;

export type CommandPath = (typeof COMMAND_PATHS)[keyof typeof COMMAND_PATHS];

/** 默认端口；占用时服务端会自动换端口并把实际端口写进 URL */
export const DEFAULT_PORT = 17800;

/** 轨迹动画的建议时长（ms） */
export const TRAJECTORY_ANIMATION_MS = 1100;

/** 轨迹降采样上限（与终端 `downsampleTrajectory` 的默认一致） */
export const TRAJECTORY_MAX_POINTS = 240;
