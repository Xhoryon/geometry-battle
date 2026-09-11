/**
 * board 投影 —— 把 `MatchEngine` 的真实状态投影成浏览器看得懂的两块板。
 *
 * 两条铁律：
 *
 *   1. **服务端不新增判定。** 本文件里没有一个关于命中 / 先手 / 击杀 / 胜负 / 僵持的
 *      计算 —— 每个字段都是引擎查询的拷贝。胜负、终止原因一律问 `MatchEngine`。
 *
 *   2. **观众板是逐字段白名单。** 没被拷贝的字段浏览器根本收不到，所以
 *      「大屏不泄漏诊断」是结构性事实，而不是一句要人工维护的约定。
 *
 * 注意 `snapshotDigest()` 刻意**只吃快照**（纯内存）：它每 100ms 被调用一次，
 * 不能去碰文件系统（`slotStates()` 会哈希算法包）。
 */

import * as path from 'path';
import { MatchEngine, MatchSnapshot, PLATFORM_ROOT } from '../core/Match';
import { COMPUTE_TIMEOUT_MS, FIELD, STALEMATE_NO_PROGRESS_LIMIT } from '../core/Rules';
import { Obstacle } from '../obstacle/Obstacle';
import { GeneratedMap } from '../map/MapGenerator';
import { SlotState, TeamSlot } from '../submission/Slot';
import { inspectPackage } from '../submission/Package';
import { explainError } from '../ui/JudgeConsole';
import { RuntimeCheck, describeRuntime } from '../submission/Runtime';
import type { MatchPhase } from '../core/Match';
import type { MatchLog } from '../core/Logs';
import type {
  ActionView,
  ArenaView,
  AuditView,
  ComputeCell,
  JudgeBoard,
  SettingsView,
  SlotView,
  SpectatorBoard,
  TeamBoard,
  WireDifficulty,
  WireEndReason,
  WireObstacle,
  WirePhase,
  WirePoint,
} from './protocol';

// ============================================================================
// 镜像漂移守卫（编译期）
//
// protocol.ts 是核心类型的**结构镜像**（它不能 import src/core，否则浏览器 bundle
// 会被拖进 node 依赖）。这里做双向覆盖断言：核心类型与镜像一旦不一致，
// `npm run typecheck` 立刻报错，而不是等到运行时发现字段丢了。
// ============================================================================

type _PhaseMirrorIsExact = [MatchPhase] extends [WirePhase] ? ([WirePhase] extends [MatchPhase] ? true : never) : never;
const _phaseMirror: _PhaseMirrorIsExact = true;

type _EndReasonMirrorIsExact = [MatchLog['endReason']] extends [WireEndReason]
  ? [WireEndReason] extends [MatchLog['endReason']]
    ? true
    : never
  : never;
const _endReasonMirror: _EndReasonMirrorIsExact = true;

type _ObstacleMirrorIsExact = [Obstacle] extends [WireObstacle]
  ? [WireObstacle] extends [Obstacle]
    ? true
    : never
  : never;
const _obstacleMirror: _ObstacleMirrorIsExact = true;

// 上面三个常量只用于编译期校验，运行时不参与任何逻辑。
export const MIRROR_GUARDS = { _phaseMirror, _endReasonMirror, _obstacleMirror };

// ============================================================================
// 快照摘要 —— ticker 的变更检测依据
// ============================================================================

/**
 * 把一个快照压成可比较的字符串。
 *
 * **纯内存、无 IO**：ticker 每 100ms 调用一次，任何文件系统访问都会变成
 * 每秒十次的哈希开销。因此它只看快照，不看槽位、不看审计。
 *
 * 涵盖所有「观众看得见的变化」：阶段、回合、存活数、各点存活位、
 * Emitter、地图是否已生成、最后一轮、终局判决。
 */
export function snapshotDigest(snap: MatchSnapshot, trajectoryId: string | null): string {
  const points = snap.points.map((p) => `${p.id}${p.alive ? '1' : '0'}`).join(',');
  const emitters = snap.emitters ? `${snap.emitters.A.id}->${snap.emitters.B.id}` : '-';
  const last = snap.rounds[snap.rounds.length - 1];
  return [
    snap.matchId,
    snap.phase,
    snap.round,
    snap.alive.A,
    snap.alive.B,
    points,
    emitters,
    snap.map ? `m${snap.map.obstacles.length}` : 'm-',
    last ? `r${last.round}` : 'r-',
    snap.phase === 'MATCH_END' ? `${snap.winner ?? 'draw'}` : '-',
    trajectoryId ?? '-',
  ].join('|');
}

// ============================================================================
// 投影
// ============================================================================

function toWirePoint(p: { x: number; y: number }): WirePoint {
  return { x: p.x, y: p.y };
}

function toWireObstacles(obstacles: readonly Obstacle[]): WireObstacle[] {
  return obstacles.map((o) => {
    switch (o.type) {
      case 'segment':
        return { type: 'segment' as const, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
      case 'rectangle':
        return { type: 'rectangle' as const, xmin: o.xmin, xmax: o.xmax, ymin: o.ymin, ymax: o.ymax };
      case 'circle':
        return { type: 'circle' as const, center: [o.center[0], o.center[1]] as [number, number], radius: o.radius };
      case 'polygon':
        return { type: 'polygon' as const, vertices: o.vertices.map((v) => [v[0], v[1]] as [number, number]) };
    }
  });
}

function buildArena(snap: MatchSnapshot, map: GeneratedMap | null): ArenaView {
  return {
    field: { xMin: FIELD.xMin, xMax: FIELD.xMax, yMin: FIELD.yMin, yMax: FIELD.yMax },
    obstacles: toWireObstacles(map?.obstacles ?? []),
    emitters: snap.emitters
      ? {
          A: { id: snap.emitters.A.id, position: toWirePoint(snap.emitters.A.position) },
          B: { id: snap.emitters.B.id, position: toWirePoint(snap.emitters.B.position) },
        }
      : null,
    points: snap.points.map((p) => ({
      id: p.id,
      team: p.team,
      position: toWirePoint(p.position),
      alive: p.alive,
    })),
  };
}

/**
 * 双方的计算状态格。
 *
 * 判据全部来自引擎已经产出的东西：本轮 `RoundLog` 的 `aErrorCode` / `bErrorCode`
 * 与 `attacksExecuted`。**不**在这里判断谁先解出、谁命中。
 */
function buildComputes(snap: MatchSnapshot): { A: ComputeCell; B: ComputeCell } {
  const running = snap.phase === 'COMPUTING';
  const last = snap.rounds[snap.rounds.length - 1];
  const cell = (team: TeamSlot): ComputeCell => {
    if (running) return { state: 'running', timeMs: null, errorCode: null };
    if (!last) return { state: 'idle', timeMs: null, errorCode: null };
    const code = team === 'A' ? last.aErrorCode : last.bErrorCode;
    const timeMs = team === 'A' ? last.aTimeMs : last.bTimeMs;
    if (code) return { state: 'error', timeMs, errorCode: code };
    const ran = last.attacksExecuted.includes(team);
    return { state: ran ? 'done' : 'idle', timeMs, errorCode: null };
  };
  return { A: cell('A'), B: cell('B') };
}

/** 本轮人话错误（§27 Error UX）—— 复用终端裁判台的翻译表，不另写一套 */
function roundErrors(last: MatchLog['rounds'][number]): string[] {
  const out: string[] = [];
  for (const team of ['A', 'B'] as const) {
    const code = team === 'A' ? last.aErrorCode : last.bErrorCode;
    const ran = last.attacksExecuted.includes(team);
    const msg = explainError(code, ran);
    if (msg) out.push(`Team ${team}: ${msg}`);
  }
  return out;
}

/**
 * **观众板** —— 逐字段构造。这个函数是「大屏不泄漏」唯一的执行点：
 * 在这里加字段 = 在大屏上加字段，所以加之前先问一句「观众该看见吗」。
 */
export function spectatorBoard(
  engine: MatchEngine,
  trajectoryHandle: { id: string; round: number } | null
): SpectatorBoard {
  const snap = engine.getSnapshot();
  const last = snap.rounds[snap.rounds.length - 1];
  /**
   * 本轮**真正阵亡**的点。
   *
   * 刻意不用 `[...last.aHits, ...last.bHits]`（终端裁判台那行用的是它）：
   * `aHits` 是**命中**列表，不是击杀列表 —— 双方同时开火时，后手方可能命中一个
   * 已被对手击杀的点，于是 hits 里会出现一个并非本队击杀的目标。
   * 权威来源是 `ReplayFrame.killed`（引擎结算时定死的那个集合）。
   */
  const frameKilled = ((): string[] => {
    const frames = engine.getReplay().frames;
    return frames.length > 0 ? [...frames[frames.length - 1].killed] : [];
  })();
  return {
    matchId: snap.matchId,
    round: snap.round,
    phase: snap.phase,
    arena: buildArena(snap, snap.map),
    alive: { A: snap.alive.A, B: snap.alive.B },
    trajectoryHandle,
    computes: buildComputes(snap),
    // 冻结规则值。Web 服务端没有覆盖 timeoutMs 的入口（与终端裁判台一致），
    // 因此这里用常量是准确的。
    computeBudgetMs: COMPUTE_TIMEOUT_MS,
    lastRound: last
      ? {
          round: last.round,
          firstSolver: last.firstSolver,
          attacksExecuted: [...last.attacksExecuted],
          killed: frameKilled,
          aliveAfter: { A: last.aliveAAfter, B: last.aliveBAfter },
          errors: roundErrors(last),
        }
      : null,
    // 只有比赛真正结束才公布判决 —— 中途 `getWinner()` 可能已是 'A'/'B'，
    // 那是「当前存活态势」，不是「比赛结果」。
    verdict:
      snap.phase === 'MATCH_END'
        ? { winner: engine.getMatchLog().winner, endReason: engine.endReason() }
        : null,
  };
}

// ============================================================================
// 裁判板 —— 在观众板之上追加诊断
// ============================================================================

function slotView(state: SlotState): SlotView {
  const record = state.record;
  return {
    team: state.team,
    installed: state.status === 'READY',
    status: state.status,
    hash: state.hash,
    entry: state.entry,
    preflightOk: record?.preflight ? Boolean(record.preflight.ok) : null,
    files: state.files,
    totalBytes: state.totalBytes,
    errors: [...state.errors],
    // —— 防「静默跑错算法」的三个判据：**实际目录**、**算法名**、**来源** ——
    // 只给哈希是不够的：裁判手上没有「我投的那份包哈希是多少」，
    // 而算法名与目录是他一眼能对的。这三项在观众板上都不存在（白名单）。
    dir: state.dir,
    name: state.manifest?.name ?? null,
    origin: record ? 'installed' : 'unrecorded',
    source: record?.source ?? null,
  };
}

/**
 * 「出厂 fixture」的包哈希集合 —— `starter/` 与仓库里的 `algorithms/team-*`。
 *
 * 锦标赛模式用它把「内置/测试算法」挡在门外（V1.2 §二）：
 * 槽位里放着的若是出厂 starter，就**不算 READY**，队伍必须真的上传自己的包。
 * 哈希是包内容的函数，因此改名/改路径都绕不过去。
 */
let factoryHashCache: Set<string> | null = null;
function factoryHashes(): Set<string> {
  if (factoryHashCache) return factoryHashCache;
  const out = new Set<string>();
  const roots = [path.join(PLATFORM_ROOT, 'starter'), path.join(PLATFORM_ROOT, 'algorithms', 'team-a'), path.join(PLATFORM_ROOT, 'algorithms', 'team-b')];
  for (const r of roots) {
    try {
      const insp = inspectPackage(r);
      if (insp.hash) out.add(insp.hash);
    } catch {
      /* 目录不存在就跳过 */
    }
  }
  factoryHashCache = out;
  return out;
}

/** 这个包哈希是不是出厂 fixture（=`starter` 或其副本） */
export function isFactoryPackage(hash: string | null): boolean {
  return hash !== null && factoryHashes().has(hash);
}

function auditView(engine: MatchEngine): AuditView {
  const log = engine.getArtifacts().auditLog;
  const counts = new Map<string, number>();
  for (const e of log.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return {
    events: log.events.length,
    byType: [...counts.entries()].sort().map(([type, count]) => ({ type, count })),
    // 只带最近 50 条：裁判看的是「刚刚发生了什么」，不是归档
    recent: log.events.slice(-50).map((e) => ({ at: e.at, seq: e.seq, type: e.type, team: e.team })),
  };
}

/**
 * 「连续跑完余下回合」的**唯一**前置条件判定。
 *
 * board 的 `enabled` 与 `MatchSession.runToEnd()` 的守卫**必须**调它 ——
 * 分头写两份判据就会出现「UI 说能跑、后台一跑就抛」：本轮之前正是如此
 * （board 只排除 COMPUTING，于是 COUNTDOWN 下按钮可点，而循环第一句
 * `beginRound()` 必然抛错，留下一条粘住的红色错误）。
 *
 * 判据逐条抄自 `beginRound()` 自己用的条件（`MatchEngine.beginRound()`：
 * 只允许 `phase === 'READY' | 'PUBLIC' | 'REVEAL'`）—— 后台循环的第一句就是它。
 * V1.2 之后开赛前的正常阶段是 `READY`（Emitter 已锁定），必须一并接受。
 *
 * 返回 `null` 表示可以推进；否则返回一句**人话**说明为什么不能。
 */
export function runToEndBlocker(engine: MatchEngine): string | null {
  const snap = engine.getSnapshot();
  if (engine.endReason() !== 'NONE') return '比赛已经结束';
  if (!snap.map) return '比赛尚未开始 —— 先执行「开始比赛」';
  if (snap.phase !== 'READY' && snap.phase !== 'PUBLIC' && snap.phase !== 'REVEAL') {
    return `当前阶段 ${snap.phase} 不能连续推进 —— 请先「结算本轮」`;
  }
  return null;
}

export interface JudgeBoardContext {
  slots: { A: SlotState; B: SlotState };
  /** 当前生效的运行期槽位根（正式投递点） */
  slotRoot: string;
  settings: SettingsView;
  runtime: RuntimeCheck;
  artifactDir: string | null;
  trajectoryHandle: { id: string; round: number } | null;
  busy: boolean;
  lastError: string | null;
  /** 锦标赛模式（V1.2 §二）：内置 / 测试算法不算就绪 */
  tournamentMode?: boolean;
}

/**
 * 裁判可执行动作。
 *
 * `enabled` 的判据**逐条抄自引擎自己用的那个条件**，并且只读引擎已经公开的状态：
 *
 *   - `start`     ← `MatchEngine.startMatch()` 的真实判据：
 *                    phase === 'UPLOAD_B' + 双方包已上传 + `isPreflightPassed()`
 *   - `preflight` ← `MatchEngine.preflight()`：phase === 'UPLOAD_B' + 双方包已上传
 *   - `reveal` / `startRound` ← `beginRound()`：phase ∈ {PUBLIC, REVEAL} + 有地图
 *   - `compute`   ← `computeRound()`：phase === 'COUNTDOWN'
 *   - `runToEnd`  ← 有地图且比赛未终止
 *   - `useSlot`   ← `upload()`：A 需 SETUP、B 需 UPLOAD_A，且槽位 READY
 *                    （锦标赛模式下还要**不是出厂模板包**，见 `isFactoryPackage`）
 *   - `prepare`   ← 上面三条的组合：封装双方 → Preflight → 建赛
 *   - `install` / `newMatch` ← 不做前置判断，直接交给引擎（它的拒绝消息本身就是答案）
 *
 * 这里**不许**出现「用阶段名去猜另一个状态」的代理量 —— 那正是 V1.1 裁判台
 * 用 `phase === 'READY'` 猜「能否开赛」而翻车的根因。
 *
 * 即便 `enabled` 因 board 过期而失真，引擎仍会在执行时拒绝并给出人话错误；
 * `enabled` 只是提示，**权威永远是引擎**。
 */
export interface ActionOptions {
  /**
   * 锦标赛模式（V1.2 §二）：内置 / 测试算法一律不算就绪。
   *
   * 正式 UI 不得暴露 `solver-fast` / `solver-hybrid` / `solver-optimizer`，
   * 也不得让「出厂 starter 还躺在槽位里」被当成可开赛状态 ——
   * 那等于让一场正规比赛跑起来的是模板代码。
   */
  tournamentMode?: boolean;
}

export function buildActions(
  engine: MatchEngine,
  slots: { A: SlotState; B: SlotState },
  busy = false,
  opts: ActionOptions = {}
): ActionView[] {
  const snap = engine.getSnapshot();
  const phase = snap.phase;
  const bothPackages = Boolean(snap.packages.A && snap.packages.B);
  const preflightPassed = engine.isPreflightPassed();
  const hasMap = Boolean(snap.map);
  const terminal = engine.endReason() !== 'NONE';
  const tournament = Boolean(opts.tournamentMode);
  /** 就绪 = 槽位可用 **且**（非锦标赛模式 或 装的是真实上传的包） */
  const ready = (t: TeamSlot): boolean =>
    slots[t].status === 'READY' && (!tournament || !isFactoryPackage(slots[t].hash));
  const factoryHint = (t: TeamSlot): string =>
    tournament && isFactoryPackage(slots[t].hash)
      ? '锦标赛模式：槽位里是出厂模板算法，必须上传并安装真实算法包'
      : '';

  /** 使用槽位：A 需 SETUP、B 需 UPLOAD_A —— 抄自 `upload()` 自己的阶段检查 */
  const useSlot = (team: TeamSlot): ActionView => {
    const phaseOk = team === 'A' ? phase === 'SETUP' : phase === 'UPLOAD_A';
    return {
      key: `use-slot-${team.toLowerCase()}`,
      label: `使用槽位算法（Team ${team}）`,
      enabled: phaseOk && ready(team) && !busy,
      hint: !ready(team)
        ? factoryHint(team) || `槽位 ${team} 尚不可用（${slots[team].status}）`
        : !phaseOk
          ? `当前阶段 ${phase} 不允许载入 Team ${team}`
          : '把槽位里的算法密封进本场比赛',
    };
  };

  /** 忙时一律不可点：命令是串行的，点了也只会被拒 */
  const gate = (ok: boolean): boolean => ok && !busy;

  const bothReady = ready('A') && ready('B');
  const canPrepare = phase === 'SETUP' || phase === 'UPLOAD_A' || phase === 'UPLOAD_B';

  return [
    {
      // 裁判向导的 **ALGORITHM READY** 主步：一次做完
      // 「封装双方算法 → Preflight → 建赛」。三条底层动作仍然逐条列在下面
      // （Advanced Controls 用），但普通裁判只需要这一个。
      key: 'prepare',
      label: '开始比赛筹备（封装双方算法 → 校验 → 建赛）',
      enabled: gate(canPrepare && bothReady && !hasMap),
      hint: !bothReady
        ? `需要双方算法都已就绪${tournament ? '（锦标赛模式：必须上传真实算法包）' : ''}`
        : !canPrepare
          ? `当前阶段 ${phase} 不能筹备`
          : '封装密封副本 → 沙箱 Preflight → 生成地图（随后进入 Emitter 选择）',
    },
    useSlot('A'),
    useSlot('B'),
    {
      key: 'preflight',
      label: '校验双方算法（Preflight）',
      enabled: gate(phase === 'UPLOAD_B' && bothPackages),
      hint: '在沙箱里真跑一次，确认算法能产出合法函数',
    },
    {
      key: 'start',
      label: '开始比赛（进入第一轮）',
      enabled: gate(phase === 'UPLOAD_B' && bothPackages && preflightPassed),
      hint: preflightPassed ? '生成地图并进入第一轮' : '需先通过 Preflight',
    },
    {
      key: 'reveal',
      label: '揭晓本轮（REVEAL）',
      enabled: gate(!terminal && hasMap && (phase === 'PUBLIC' || phase === 'REVEAL')),
      hint: '公开本轮障碍物 —— 此刻参赛代码仍未运行',
    },
    {
      key: 'start-round',
      label: 'START（此刻之前参赛代码一行都没跑）',
      enabled: gate(!terminal && hasMap && (phase === 'PUBLIC' || phase === 'REVEAL')),
      hint: '唯一允许参赛代码运行的开关',
    },
    {
      key: 'compute',
      label: '结算本轮（播放轨迹动画）',
      enabled: gate(phase === 'COUNTDOWN'),
      hint: '运行双方算法并结算本轮',
    },
    {
      key: 'run-to-end',
      label: '连续跑完余下回合',
      // 与 `MatchSession.runToEnd()` 的守卫共用同一个判据函数 —— 两处分开写
      // 就会出现「UI 说能跑、后台一跑就抛」（Final Audit P2-3 / Re-Gate）。
      enabled: gate(runToEndBlocker(engine) === null),
      hint: '后台推进到比赛终止，期间可继续观看',
    },
    {
      key: 'reset',
      label: hasMap ? '结束本场并重置' : '重置比赛',
      enabled: gate(true),
      hint: '回到初始状态，准备下一场',
    },
  ];
}

export function judgeBoard(engine: MatchEngine, ctx: JudgeBoardContext): JudgeBoard {
  const base = spectatorBoard(engine, ctx.trajectoryHandle);
  const check = ctx.runtime;
  return {
    ...base,
    busy: ctx.busy,
    lastError: ctx.lastError,
    settings: ctx.settings,
    slotRoot: ctx.slotRoot,
    slots: { A: slotView(ctx.slots.A), B: slotView(ctx.slots.B) },
    packages: {
      A: engine.getSnapshot().packages.A,
      B: engine.getSnapshot().packages.B,
    },
    runtime: {
      frozen: describeRuntime(),
      detected: check.detected.python ?? '未知',
      ok: check.ok,
      mismatches: [...check.mismatches],
    },
    audit: auditView(engine),
    artifactDir: ctx.artifactDir,
    actions: buildActions(engine, ctx.slots, ctx.busy, { tournamentMode: ctx.tournamentMode }),
  };
}

/** 兜底：把任意难度字符串收敛到协议联合 */
export function toDifficulty(v: unknown, fallback: WireDifficulty = 'medium'): WireDifficulty {
  return v === 'easy' || v === 'medium' || v === 'hard' ? v : fallback;
}

export { STALEMATE_NO_PROGRESS_LIMIT };

// ============================================================================
// 参赛者板（V1.2 §一）
// ============================================================================

export interface TeamBoardContext {
  /** 本队槽位状态（只传本队的） */
  slot: SlotState;
  /** 当前生效的运行期槽位根 */
  slotRoot: string;
  /** 本队包内的文件清单（由 session 读一次后传入，避免 board 每次 tick 都哈希一遍） */
  files: { path: string; bytes: number }[];
  busy: boolean;
  lastError: string | null;
  tournamentMode: boolean;
}

/**
 * 参赛者板。
 *
 * **两条白名单纪律**（与观众板同源，但这里按队别裁剪）：
 *   1. 只投影**本队**的槽位；对手的包名、哈希、目录、源码一个字段都没有；
 *   2. 双方锁定之前，**对方的 Emitter 选择恒为 null** —— 只暴露 `locked` 这一个布尔。
 *
 * `actions[].enabled` 的判据逐条抄自引擎自己的前置条件
 * （`selectEmitter()` 要求 `phase === 'EMITTER_SELECT'` 且本方未锁定；
 * `lockEmitter()` 另外要求本方**已经选过**），不做任何影子判断。
 */
export function teamBoard(
  engine: MatchEngine,
  team: TeamSlot,
  ctx: TeamBoardContext
): TeamBoard {
  const snap = engine.getSnapshot();
  const sel = snap.emitterSelection;
  const mine = sel[team];
  const theirs = sel[team === 'A' ? 'B' : 'A'];
  const tournament = ctx.tournamentMode;

  const isFactory = isFactoryPackage(ctx.slot.hash);
  const packageReady =
    ctx.slot.status === 'READY' && (!tournament || !isFactory);

  const phase = snap.phase;
  const canSelect = phase === 'EMITTER_SELECT' && !mine.locked && !ctx.busy;
  const canLock = phase === 'EMITTER_SELECT' && !mine.locked && mine.selected !== null && !ctx.busy;

  const actions: ActionView[] = [
    {
      key: 'select-emitter',
      label: '选择本场 Emitter',
      enabled: canSelect,
      hint: mine.locked
        ? '已锁定，整场不可更换'
        : phase !== 'EMITTER_SELECT'
          ? `当前阶段 ${phase} 不能选择 Emitter`
          : '从自己的初始点里选一个作为本场的发射锚点',
    },
    {
      key: 'lock-emitter',
      label: '锁定 Emitter',
      enabled: canLock,
      hint: mine.locked
        ? '已锁定'
        : mine.selected === null
          ? '请先选择 Emitter'
          : '锁定后整场不可更换；双方都锁定后锚点公开',
    },
  ];

  return {
    team,
    matchId: engine.matchId,
    round: snap.round,
    phase,
    slot: slotView(ctx.slot),
    packageReady,
    candidates: engine.emitterCandidates(team).map((p) => ({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      alive: p.alive,
    })),
    own: { selected: mine.selected?.id ?? null, locked: mine.locked },
    // 对方的选择在双方锁定之前**不投影**（不是前端隐藏，是根本不发）
    opponent: {
      locked: theirs.locked,
      selected: sel.revealed ? (theirs.selected?.id ?? null) : null,
    },
    revealed: sel.revealed,
    emitters: snap.emitters
      ? {
          A: { id: snap.emitters.A.id, x: snap.emitters.A.position.x, y: snap.emitters.A.position.y },
          B: { id: snap.emitters.B.id, x: snap.emitters.B.position.x, y: snap.emitters.B.position.y },
        }
      : null,
    actions,
    files: ctx.files,
    busy: ctx.busy,
    lastError: ctx.lastError,
    tournamentMode: tournament,
  };
}
