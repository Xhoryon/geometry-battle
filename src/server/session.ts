/**
 * MatchSession —— Web UI 的**唯一**比赛状态持有者。
 *
 * 职责边界（三条，缺一条就会退化成「第二个引擎」）：
 *
 *   1. **持有**：整个进程里只有一个 `MatchEngine` 存活，就是这里的 `setup.getEngine()`。
 *   2. **直通**：每个命令都是对引擎（或 `MatchSetupUI`，终端裁判台共用的那一层）的一次调用，
 *      本文件里**没有任何**命中 / 先手 / 击杀 / 胜负 / 僵持的计算。
 *      连「从槽位上传 → 校验 → 开赛」这条链路也直接复用 `MatchSetupUI`，
 *      免得终端与 Web 各有一份实现而慢慢分叉。
 *   3. **投影**：把引擎状态经 `boards.ts` 投影出去，并按变化推送。
 *
 * 串行化：`MatchEngine` 不可重入（一轮计算中途改状态会让审计对不上）。
 * 因此同一时刻只允许一条命令在跑，**忙的时候直接拒绝**而不是排队 ——
 * 排队会让裁判点了按钮却不知道发生了什么，拒绝 + 人话错误才说得清。
 */

import * as path from 'path';
import { MatchEngine, MatchOptions } from '../core/Match';
import { MatchSetupUI } from '../ui/MatchSetupUI';
import { persistArtifacts } from '../core/Logs';
import { downsampleTrajectory } from '../ui/TrajectoryAnimator';
import { RuntimeCheck, checkRuntime } from '../submission/Runtime';
import { TeamSlot } from '../submission/Slot';
import { inspectPackage } from '../submission/Package';
import { isBundledAlgorithm, judgeBoard, runToEndBlocker, spectatorBoard, snapshotDigest, teamBoard } from './boards';
import { readPackageFile, writeUploadedPackage } from './upload';
import {
  CommandResult,
  JudgeBoard,
  SettingsView,
  SpectatorBoard,
  TeamBoard,
  TRAJECTORY_ANIMATION_MS,
  TRAJECTORY_MAX_POINTS,
  Topic,
  TrajectoryPayload,
  WireDifficulty,
  teamOfTopic,
} from './protocol';

/** ticker 周期：足够让「计算中」的状态在长耗时里也能被看见 */
const TICK_MS = 100;

export type SessionEvent =
  | { kind: 'board' }
  | { kind: 'trajectory'; trajectory: TrajectoryPayload };

export interface SessionOptions {
  slotRoot: string;
  artifactRoot: string;
  sandboxRoot?: string;
  seed?: number;
  pointCount?: number;
  difficulty?: WireDifficulty;
  /**
   * 锦标赛模式（V1.2 §二），默认**开**。
   *
   * 打开时：出厂 starter / 测试算法不算就绪，正式 UI 也不提供任何内置算法选项 ——
   * 一场正规比赛必须跑在**真实上传**的包上。
   * 关掉它只用于开发自测（仍然不绕过任何校验）。
   */
  tournamentMode?: boolean;
}

const BUSY: CommandResult = { ok: false, errors: ['上一条命令尚未完成，请稍候'] };

export class MatchSession {
  private setup: MatchSetupUI;
  private engine: MatchEngine;
  private settings: SettingsView;
  private readonly opts: SessionOptions;

  private trajectories = new Map<string, TrajectoryPayload>();
  private currentTrajectory: { id: string; round: number } | null = null;

  /**
   * 命令闸门。`MatchEngine` 不可重入，因此**同一时刻只允许一条命令在跑**。
   * 忙的时候直接拒绝而不是排队 —— 排队会让裁判点了按钮却不知道发生了什么。
   */
  private busy = false;
  /** 锦标赛模式（V1.2 §二） */
  private readonly tournamentMode: boolean;
  /** 后台推进整场比赛时最后一次失败的说明（供裁判台显示） */
  private lastError: string | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private lastDigest = '';
  /** 宿主 Runtime 探测 —— 要 spawn python，**每场只算一次**，绝不放进 board 投影 */
  private runtime: RuntimeCheck;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.settings = {
      seed: opts.seed ?? Math.floor(Math.random() * 1_000_000_000),
      pointCount: opts.pointCount ?? 8,
      difficulty: opts.difficulty ?? 'medium',
    };
    this.tournamentMode = opts.tournamentMode ?? true;
    this.setup = this.buildSetup(this.settings);
    this.engine = this.setup.getEngine();
    this.runtime = checkRuntime();
    this.lastDigest = this.digest();
    this.startTicker();
  }

  // ========================================================================
  // 生命周期
  // ========================================================================

  private buildSetup(s: SettingsView): MatchSetupUI {
    const o: MatchOptions = {
      seed: s.seed,
      pointCount: s.pointCount,
      difficulty: s.difficulty,
      artifactRoot: this.opts.artifactRoot,
      slotRoot: this.opts.slotRoot,
      ...(this.opts.sandboxRoot ? { sandboxRoot: this.opts.sandboxRoot } : {}),
    };
    return new MatchSetupUI(o);
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      // 纯读：ticker 只比较摘要，不改变任何状态。计算中途也要能读到
      // phase = COMPUTING —— 否则现场看不到「正在算」。
      const d = this.digest();
      if (d !== this.lastDigest) {
        this.lastDigest = d;
        this.emit({ kind: 'board' });
      }
    }, TICK_MS);
    // 不要让 ticker 拖住进程退出（测试里 close() 之后必须能收尾）
    this.ticker.unref?.();
  }

  close(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.listeners.clear();
  }

  private digest(): string {
    return snapshotDigest(this.engine.getSnapshot(), this.currentTrajectory?.id ?? null);
  }

  // ========================================================================
  // 订阅
  // ========================================================================

  onChange(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: SessionEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        // 一个订阅者出错不得影响其他人（更不得影响比赛）
      }
    }
  }

  // ========================================================================
  // board
  // ========================================================================

  getBoard(topic: Topic): SpectatorBoard | JudgeBoard | TeamBoard {
    const team = teamOfTopic(topic);
    if (team) return this.teamBoardFor(team);
    if (topic === 'judge') return judgeBoard(this.engine, this.judgeContext());
    return spectatorBoard(this.engine, this.currentTrajectory);
  }

  /** 本队包内的文件清单（读一次文件系统，不在每个 tick 上哈希） */
  private packageFiles(team: TeamSlot): { path: string; bytes: number }[] {
    const slot = this.setup.slotStates()[team];
    if (slot.status !== 'READY') return [];
    try {
      return inspectPackage(slot.dir).files.map((f) => ({ path: f.relPath, bytes: f.size }));
    } catch {
      return [];
    }
  }

  private teamBoardFor(team: TeamSlot): TeamBoard {
    return teamBoard(this.engine, team, {
      slot: this.setup.slotStates()[team],
      slotRoot: this.opts.slotRoot,
      files: this.packageFiles(team),
      busy: this.busy,
      lastError: this.lastError,
      tournamentMode: this.tournamentMode,
    });
  }

  /**
   * 队伍上传算法包（浏览器来的文件清单）。
   *
   * **走的是同一条安装流水线** —— staging → validate → preflight → hash → seal → replace。
   * 浏览器没有任何绕过校验的通道：这里只是把文件落到一个临时目录，然后交给
   * `setup.installAlgorithm()`。
   */
  uploadPackage(
    team: TeamSlot,
    files: { path: string; contentBase64: string }[]
  ): Promise<CommandResult> {
    return this.run(async () => {
      const staged = writeUploadedPackage(files);
      if (!staged.ok) return { ok: false, errors: staged.errors };

      // **先判后装**：此前是「装完再拒绝」，于是被拒的包其实已经落在槽位里了 ——
      // 拒绝只改了返回值，槽位状态照旧被污染。
      const blocked = this.tournamentRejection(team, inspectPackage(staged.dir).hash, '上传内容');
      if (blocked) return blocked;

      const r = await this.setup.installAlgorithm(team, staged.dir);
      return {
        ok: r.success,
        errors: r.errors,
        detail: { team, hash: r.hash, stage: r.detail?.stage, files: files.length },
      };
    });
  }

  /** 队伍选择本场 Emitter（只在 EMITTER_SELECT 阶段、且本方未锁定时可行） */
  selectEmitter(team: TeamSlot, pointId: string): Promise<CommandResult> {
    return this.run(async () => {
      const r = this.engine.selectEmitter(team, pointId);
      return { ok: r.ok, errors: r.error ? [r.error] : [], detail: { team, pointId } };
    });
  }

  /** 队伍锁定 Emitter —— 锁定后整场不可更换 */
  lockEmitter(team: TeamSlot): Promise<CommandResult> {
    return this.run(async () => {
      const r = this.engine.lockEmitter(team);
      return { ok: r.ok, errors: r.error ? [r.error] : [], detail: { team } };
    });
  }

  /** 读取本队包内的一个文件（只读浏览；严格限定在本队槽位内） */
  /**
   * 读回槽位内某个文件的源码。
   *
   * 参赛者端（`readOwnSource`）与裁判端（`readSlotSource`）走的是**同一条**
   * 读取路径 —— 同一套路径越界 / 符号链接 / 体积防护，不存在「裁判那条松一点」
   * 的第二套实现。两者只差一句「尚未就绪」的措辞。
   */
  private readSlotFile(
    team: TeamSlot,
    relPath: string,
    notReady: string
  ): { ok: boolean; errors: string[]; text?: string } {
    const slot = this.setup.slotStates()[team];
    if (slot.status !== 'READY') return { ok: false, errors: [notReady] };
    try {
      return { ok: true, errors: [], text: readPackageFile(slot.dir, relPath) };
    } catch (e) {
      return { ok: false, errors: [(e as Error).message] };
    }
  }

  /** 参赛者视角：只读**本队**的源码 */
  readOwnSource(team: TeamSlot, relPath: string): { ok: boolean; errors: string[]; text?: string } {
    return this.readSlotFile(team, relPath, '本队尚未安装算法包');
  }

  /**
   * 裁判 / 主办方视角：读**任一队**已安装的源码。
   *
   * V1.2 §一要求主办方能在网页上查看上传的算法源码 —— 这正是「投的是不是
   * 选手那份」最直接的核对手段（哈希对不了人眼，源码可以）。
   */
  readSlotSource(team: TeamSlot, relPath: string): { ok: boolean; errors: string[]; text?: string } {
    return this.readSlotFile(team, relPath, `Team ${team} 的槽位尚未就绪`);
  }

  private judgeContext() {
    return {
      slots: this.setup.slotStates(),
      slotRoot: this.opts.slotRoot,
      settings: this.settings,
      runtime: this.runtime,
      artifactDir: this.engine.getSnapshot().map ? this.engine.getArtifactDir() : null,
      trajectoryHandle: this.currentTrajectory,
      busy: this.busy,
      lastError: this.lastError,
      tournamentMode: this.tournamentMode,
      // 裁判板要带文件清单，主办方才能点开某个文件看源码（V1.2 §一）
      slotFiles: { A: this.packageFiles('A'), B: this.packageFiles('B') },
    };
  }

  getTrajectory(id: string): TrajectoryPayload | null {
    return this.trajectories.get(id) ?? null;
  }

  // ========================================================================
  // 命令
  // ========================================================================

  /**
   * 命令包装：串行化 + 忙时拒绝 + 统一收尾。
   *
   * 收尾固定做三件事：重算摘要、持久化产物、广播一次 board（哪怕摘要没变 ——
   * 命令带来了新的错误消息或槽位状态，那些不在摘要里）。
   */
  private run(fn: () => Promise<CommandResult>): Promise<CommandResult> {
    if (this.busy) return Promise.resolve({ ...BUSY });
    this.busy = true;
    return (async () => {
      try {
        const r = await fn();
        // 一次**成功**的命令必须清掉上一场留下的失败说明。
        // 不清的话，一次失败的 run-to-end 会让裁判台的红字一直挂到下一场
        // （`lastError` 此前只在 runToEnd 开头被重置）（Final Audit P2-5）。
        if (r.ok) this.lastError = null;
        return r;
      } catch (e) {
        // 引擎对「不该发生的顺序」会抛异常；这里翻成人话，不让它变成 500
        return { ok: false, errors: [(e as Error).message] };
      } finally {
        this.afterCommand();
      }
    })();
  }

  private afterCommand(): void {
    this.busy = false;
    this.persist();
    this.lastDigest = this.digest();
    this.emit({ kind: 'board' });
  }

  /** 产物落盘失败不中断比赛（与终端裁判台同一策略） */
  private persist(): void {
    try {
      if (this.engine.getSnapshot().map) {
        persistArtifacts(this.engine.getArtifactDir(), this.engine.getArtifacts());
      }
    } catch {
      /* 落盘失败不中断比赛 */
    }
  }

  /**
   * 开一场新比赛（Match Setup）。
   *
   * 前一场的产物在每次命令后已经落盘，这里只需换掉引擎 ——
   * 换新引擎而不是「重置旧引擎」，因为 `MatchEngine` 的 matchId 是只读的，
   * 而 matchId 是审计与回放的索引键。
   */
  newMatch(o: { seed?: number; pointCount?: number; difficulty?: WireDifficulty } = {}): Promise<CommandResult> {
    return this.run(async () => {
      this.persist();
      this.settings = {
        seed: o.seed ?? Math.floor(Math.random() * 1_000_000_000),
        pointCount: o.pointCount ?? this.settings.pointCount,
        difficulty: o.difficulty ?? this.settings.difficulty,
      };
      this.setup = this.buildSetup(this.settings);
      this.engine = this.setup.getEngine();
      this.trajectories.clear();
      this.currentTrajectory = null;
      return {
        ok: true,
        errors: [],
        detail: { matchId: this.engine.matchId, seed: this.settings.seed },
      };
    });
  }

  /**
   * 锦标赛模式的**执行门禁**（V1.2 §二）：平台自带的算法一律不许上场。
   *
   * 返回 `null` 表示放行；否则返回一条可以直接回给客户端的拒绝结果。
   *
   * 为什么必须是**执行时**的守卫，而不是只在 board 上把按钮变灰：
   * `enabled` 只是提示，一个直接的 `POST /api/judge/prepare` 根本不读它。
   * 此前正是如此 —— 服务端启动时会把 `algorithms/team-*` 播种进槽位，
   * 于是在「锦标赛模式」下打一场，跑的其实是出厂模板。
   */
  private tournamentRejection(team: TeamSlot, hash: string | null, where: string): CommandResult | null {
    if (!this.tournamentMode || !isBundledAlgorithm(hash)) return null;
    return {
      ok: false,
      errors: [
        `锦标赛模式：不接受平台自带算法（Team ${team}，${where}）—— ` +
          '请提交你们自己的算法包（参赛者页上传，或在 Advanced 里指定你们自己的目录）',
      ],
      detail: { team, hash, tournamentMode: true },
    };
  }

  /** Advanced / Replace Algorithm：把算法安装进固定槽位（不动本场比赛已密封的副本） */
  install(team: TeamSlot, sourceDir: string): Promise<CommandResult> {
    return this.run(async () => {
      const resolved = path.resolve(sourceDir);
      // **先判后装**：被拒的包一个字节都不该写进槽位
      let sourceHash: string | null = null;
      try {
        sourceHash = inspectPackage(resolved).hash;
      } catch {
        sourceHash = null; // 读不了就交给安装流水线去报它自己的错
      }
      const blocked = this.tournamentRejection(team, sourceHash, '安装来源');
      if (blocked) return blocked;

      const r = await this.setup.installAlgorithm(team, resolved);
      return {
        ok: r.success,
        errors: r.errors,
        detail: { team, hash: r.hash, stage: r.detail?.stage },
      };
    });
  }

  /** 正式主流程：把槽位里的算法密封进本场比赛 */
  useSlot(team: TeamSlot): Promise<CommandResult> {
    return this.run(async () => {
      // 槽位里躺着的若是平台自带算法，锦标赛模式下不许密封进本场
      const blocked = this.tournamentRejection(team, this.setup.slotStates()[team].hash, '槽位内');
      if (blocked) return blocked;

      const r = this.setup.uploadFromSlot(team);
      return { ok: r.success, errors: r.errors, detail: { team, hash: r.hash } };
    });
  }

  preflight(): Promise<CommandResult> {
    return this.run(async () => {
      const r = await this.setup.preflight();
      return { ok: r.success, errors: r.errors, detail: r.detail };
    });
  }

  startMatch(): Promise<CommandResult> {
    return this.run(async () => {
      // **不重复实现引擎的门禁**（`UPLOAD_B` + `preflightDone`）——
      // 直接把引擎的结论报出来。UI 若自己再猜一套，就会出现
      // 「校验通过了反而开不了赛」那类影子规则。
      const r = this.setup.startMatch();
      return { ok: r.success, errors: r.errors, detail: { matchId: this.engine.matchId } };
    });
  }

  /**
   * 裁判向导的 **ALGORITHM READY** 主步（V1.2 §三）：
   * 封装双方算法 → Preflight → 建赛。
   *
   * 三条底层动作（`use-slot-a/b` / `preflight` / `start`）仍然单独可用，
   * 但普通裁判只需要这一个 —— 底层动作移进 Advanced Controls（§三）。
   *
   * **不重复实现门禁**：每一步都直接调 `MatchSetupUI`，失败就把它的原话报出来。
   * 中途失败时停在失败的那一步；已经成功的步骤不回滚
   * （密封副本与槽位替换都是非破坏性的，重试安全）。
   */
  prepareMatch(): Promise<CommandResult> {
    return this.run(async () => {
      for (const team of ['A', 'B'] as const) {
        // 直接调 `uploadFromSlot` 会绕过 `useSlot()` 的锦标赛门禁 ——
        // 而 `prepare` 才是裁判向导的主按钮，也就是最容易绕过的那一条。这里补上。
        const blocked = this.tournamentRejection(team, this.setup.slotStates()[team].hash, '槽位内');
        if (blocked) return { ...blocked, detail: { ...blocked.detail, step: `use-slot-${team}` } };

        const r = this.setup.uploadFromSlot(team);
        if (!r.success) return { ok: false, errors: r.errors, detail: { step: `use-slot-${team}` } };
      }
      const pre = await this.setup.preflight();
      if (!pre.success) return { ok: false, errors: pre.errors, detail: { step: 'preflight' } };
      const started = this.setup.startMatch();
      if (!started.success) return { ok: false, errors: started.errors, detail: { step: 'start' } };
      return { ok: true, errors: [], detail: { step: 'done', matchId: this.engine.matchId } };
    });
  }

  /** 揭晓本轮：PUBLIC → REVEAL。此刻参赛代码仍未运行。 */
  reveal(): Promise<CommandResult> {
    return this.run(async () => {
      const r = this.engine.beginRound();
      const h = this.engine.revealRound();
      return { ok: true, errors: [], detail: { round: r.round, roundStateHash: h.roundStateHash } };
    });
  }

  /** START —— 唯一允许参赛代码运行的开关 */
  startRound(): Promise<CommandResult> {
    return this.run(async () => {
      const r = this.engine.judgeStartRound();
      return { ok: r.ok, errors: r.ok ? [] : [r.error ?? 'START 失败'] };
    });
  }

  compute(): Promise<CommandResult> {
    return this.run(async () => {
      const result = await this.engine.computeRound();
      const detail = this.captureTrajectory();
      return {
        ok: true,
        errors: [],
        detail: {
          ...detail,
          round: result.round,
          firstSolver: result.firstSolver,
          attacksExecuted: result.attacksExecuted,
          killed: result.killed,
          endReason: result.endReason,
        },
      };
    });
  }

  /**
   * 连续跑完余下回合 —— **后台任务**，立即返回。
   *
   * 为什么不阻塞在 HTTP 请求里：一场比赛最长可以到 60 轮，那是分钟级的请求。
   * 浏览器与 undici 都有请求超时，而且现场也不该「点一下然后转圈」——
   * 真正的进度是靠 WS 推的 board 看的。
   *
   * 终止由引擎保证（ELIMINATION / MUTUAL_ELIMINATION / STALEMATE / HARD_ROUND_LIMIT
   * 四者覆盖所有结束方式），因此这个循环**必然**收敛 ——
   * 这里不设第二个回合上限，否则就成了「UI 自己的一套规则」。
   */
  runToEnd(): Promise<CommandResult> {
    if (this.busy) return Promise.resolve({ ...BUSY });
    // 与 board 的 `enabled` 共用**同一个**判据函数（boards.ts 的 runToEndBlocker）。
    // 不满足就当场拒绝：绝不启动一个注定抛错的后台任务 —— 那会对外报 ok:true、
    // 却什么都不做，还留下一条粘住的 lastError（Final Re-Gate P2）。
    const blocker = runToEndBlocker(this.engine);
    if (blocker) return Promise.resolve({ ok: false, errors: [blocker] });
    this.busy = true;
    this.lastError = null;

    const task = (async (): Promise<void> => {
      try {
        while (this.engine.endReason() === 'NONE') {
          this.engine.beginRound();
          this.engine.revealRound();
          const started = this.engine.judgeStartRound();
          if (!started.ok) {
            this.lastError = started.error ?? 'START 失败';
            return;
          }
          await this.engine.computeRound();
          this.captureTrajectory();
          // 每轮都落盘：中途崩溃也不该丢掉已经打完的回合
          this.persist();
        }
      } catch (e) {
        this.lastError = (e as Error).message;
      } finally {
        this.busy = false;
        this.persist();
        this.lastDigest = this.digest();
        this.emit({ kind: 'board' });
      }
    })();

    void task;
    return Promise.resolve({ ok: true, errors: [], detail: { background: true } });
  }

  /**
   * 本轮结算后取一次轨迹并缓存。
   *
   * 轨迹来自 `ReplayFrame` —— 引擎**已判定、已截断**的结果，
   * 这里只做降采样，绝不重新求值函数（重新求值会画出穿过障碍物的曲线）。
   * 缓存后只在**产生时**推送一次，不随 ticker 重复广播。
   */
  private captureTrajectory(): { trajectoryId: string | null; round: number | null } {
    const frames = this.engine.getReplay().frames;
    const f = frames[frames.length - 1];
    if (!f) return { trajectoryId: null, round: null };
    const payload: TrajectoryPayload = {
      id: `${this.engine.matchId}:${f.round}`,
      round: f.round,
      A: downsampleTrajectory(f.trajectoryA, TRAJECTORY_MAX_POINTS),
      B: downsampleTrajectory(f.trajectoryB, TRAJECTORY_MAX_POINTS),
      killed: [...f.killed],
      durationMs: TRAJECTORY_ANIMATION_MS,
    };
    this.trajectories.set(payload.id, payload);
    // 只留最近 64 条，避免长比赛把内存撑起来（回放另有落盘产物）
    if (this.trajectories.size > 64) {
      const oldest = this.trajectories.keys().next().value;
      if (oldest !== undefined) this.trajectories.delete(oldest);
    }
    this.currentTrajectory = { id: payload.id, round: payload.round };
    this.emit({ kind: 'trajectory', trajectory: payload });
    return { trajectoryId: payload.id, round: payload.round };
  }

  /** 测试与演练用：直接拿引擎（**只读**用途，服务端代码不得借此绕过投影） */
  peekEngine(): MatchEngine {
    return this.engine;
  }
}
