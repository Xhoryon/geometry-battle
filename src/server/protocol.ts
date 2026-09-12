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
  /** 双方各自选择本场的 Fixed Emitter 并锁定（V1.2） */
  | 'EMITTER_SELECT'
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
  /**
   * 包内文件清单（路径 + 字节数）—— **只有裁判板有**。
   *
   * 主办方要能在网页上核对选手交上来的到底是什么（V1.2 §一），
   * 因此裁判需要清单才能点开某一个文件看内容（内容走 `JUDGE_READ_PATHS.source`）。
   * 观众板是白名单，根本收不到这个字段。
   */
  fileList: { path: string; bytes: number }[];
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
  /**
   * Emitter 选择过程（V1.2 §一）。
   *
   * 裁判是**权威视角**：这里给出双方的完整状态（含各自选了哪个点、是否锁定），
   * 而不是像参赛者板那样按队别裁剪。观众板里**没有**这个字段。
   */
  emitterSelection: {
    A: { locked: boolean; selected: { id: string; x: number; y: number } | null };
    B: { locked: boolean; selected: { id: string; x: number; y: number } | null };
    revealed: boolean;
  };
  /**
   * 本场的两个参赛者令牌（V1.2 Final RC Audit 的 P1 修复）。
   *
   * 裁判台据此渲染 `/team/a#t=...` 可复制链接 —— 队伍面的唯一入口。
   * **只在裁判板里**：参赛者板与观众板都没有这个字段。
   *
   * 令牌形如 43 字符的 base64url 串；`judge` 令牌本身**不回显**（组织者的 URL 里已有）。
   */
  teamTokens: { A: string; B: string };
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

export const WS_TOPICS = ['judge', 'spectator', 'team-a', 'team-b'] as const;

/**
 * 令牌无效时服务端给客户端的 WS 关闭码（V1.2 Final RC Audit 的 P1 修复）。
 *
 * 为什么需要它：浏览器**读不到** WS 握手失败时的 HTTP 状态 —— 那只会表现成
 * `onclose` 的 **1006**，与「服务没起来」完全同形。而前端的重连是无上限退避，
 * 于是换场之后队伍页会带着过期令牌永久狂刷，现场只看到一句「未连接」。
 * 用一个应用自定义码把「令牌不对」明确说出来，前端才能停下来给出人话。
 *
 * 放在 `protocol.ts`（而不是 `ws.ts`）是因为**前端也要用**，而 `ws.ts` 依赖
 * node 的 `ws`/`http`，浏览器侧 import 不了。
 */
export const WS_INVALID_TOKEN = 4401;
export type Topic = (typeof WS_TOPICS)[number];

/** topic → 它代表的队伍（只有 team-* 有值） */
export function teamOfTopic(topic: Topic): WireTeam | null {
  if (topic === 'team-a') return 'A';
  if (topic === 'team-b') return 'B';
  return null;
}

export function isTopic(v: unknown): v is Topic {
  return typeof v === 'string' && (WS_TOPICS as readonly string[]).includes(v);
}

export type ServerMessage =
  | { type: 'hello'; topic: Topic; seq: number }
  | { type: 'board'; topic: Topic; seq: number; board: SpectatorBoard | JudgeBoard | TeamBoard }
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

/** 参赛者端的一个候选点（本队自己的初始点） */
export interface CandidateView {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

/**
 * **参赛者板** —— 按队别裁剪的白名单投影。
 *
 * 三条硬规则：
 *   1. 只含**本队**的槽位与源码；对方的东西一个字段都不给；
 *   2. **双方锁定之前不暴露对方的 Emitter 选择** —— `opponent.selected` 恒为 null，
 *      只给出 `opponent.locked` 这一个布尔；
 *   3. `actions[].enabled` 的判据**逐条来自引擎自己的前置条件**，
 *      前端不得再写一套（`buildActions` 是唯一来源）。
 */
export interface TeamBoard {
  team: WireTeam;
  matchId: string;
  round: number;
  phase: WirePhase;
  /** 本队算法槽位 */
  slot: SlotView;
  /** 本队算法是否已就绪（上传 + Preflight 通过） */
  packageReady: boolean;
  /** 本队可选的 Emitter 候选点（自己的初始点） */
  candidates: CandidateView[];
  /** 本队自己的选择 */
  own: { selected: string | null; locked: boolean };
  /** 对方：锁定前只知道「锁没锁」 */
  opponent: { locked: boolean; selected: string | null };
  /** 双方是否都已锁定（此后锚点对所有人公开） */
  revealed: boolean;
  /** 双方锁定后公开的锚点坐标；未公开时为 null */
  emitters: {
    A: { id: string; x: number; y: number };
    B: { id: string; x: number; y: number };
  } | null;
  /** 本队可执行的动作（服务端权威判据） */
  actions: ActionView[];
  /** 本队包内的文件清单（只读浏览用；不含内容） */
  files: { path: string; bytes: number }[];
  busy: boolean;
  lastError: string | null;
  /** 锦标赛模式：禁用一切内置/测试算法，必须使用真实上传的包 */
  tournamentMode: boolean;
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
  prepare: '/api/judge/prepare',
} as const;

/**
 * 裁判端**只读**路径（GET）。
 *
 * `source` 让主办方在网页上查看**任一队**已安装的算法源码 ——
 * 参赛者端那份 `/api/team/source` 是按队别裁剪的，裁判要的是权威视角：
 * 两个队都能看，这样才能核对「选手交上来的到底是什么」。
 */
export const JUDGE_READ_PATHS = {
  source: '/api/judge/source',
} as const;

/**
 * 参赛者端命令。
 *
 * 队别由请求体给出，但**光有队别不够**：调用方还必须出示那一队的访问令牌
 * （`X-GB-Token` 请求头），且令牌解析出的队伍必须与 `team` **一致** ——
 * 否则 401。没有令牌校验时，「队别」只是一句自称（见 `src/server/tokens.ts`）。
 */
export const TEAM_COMMAND_PATHS = {
  upload: '/api/team/upload',
  selectEmitter: '/api/team/select-emitter',
  lockEmitter: '/api/team/lock-emitter',
} as const;

export type TeamCommandPath = (typeof TEAM_COMMAND_PATHS)[keyof typeof TEAM_COMMAND_PATHS];

export type CommandPath = (typeof COMMAND_PATHS)[keyof typeof COMMAND_PATHS];

/**
 * 一次上传的字节上限（算法包，未压缩的原始内容）。
 *
 * 放在这里（而不是 `upload.ts`）是因为**前端也要用**：`web/src/api/zip.ts` 在浏览器里
 * 解包，必须用同一个预算给自己的解压过程封顶，否则一个 deflate 炸弹能把标签页打死。
 * `upload.ts` 依赖 node 的 `fs`/`os`，浏览器 import 不了。
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** 默认端口；占用时服务端会自动换端口并把实际端口写进 URL */
export const DEFAULT_PORT = 17800;

/** 轨迹动画的建议时长（ms） */
export const TRAJECTORY_ANIMATION_MS = 1100;

/** 轨迹降采样上限（与终端 `downsampleTrajectory` 的默认一致） */
export const TRAJECTORY_MAX_POINTS = 240;
