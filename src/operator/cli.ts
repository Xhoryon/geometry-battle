/**
 * Geometry Battle —— 正式操作台 (Operator Console)
 *
 * 修复的 Finding：
 *   P0-10 比赛只能靠手写 TS 脚本驱动
 *   P1-22 上传后从不 Preflight
 *   P1-23 缺少正式的裁判 START ROUND 入口
 *   P2-3  观众屏与真实引擎状态脱节
 *
 * Re-Gate Cycle 1 追加修复：
 *   P1-A  产物只在整场结束后一次性落盘 → 开赛后、每回合后、异常退出前都落盘
 *
 * 工作人员只用本入口即可完成一整场比赛：
 *   上传 → Preflight → 开始比赛 →（每轮）PUBLIC 板 → REVEAL 板 → 裁判 START →
 *   计算 → 结算 → 下一轮 → 终局 → 落盘
 *
 * Rule Revision 3 §5：每轮的 Shooter Selection 已删除，因此回合循环里
 * **不再有任何人工选点步骤**；发射锚点是整场固定的 Emitter。
 *
 * V1.1 三段式：REVEAL 与 START 是两个独立事件，中间可以停任意久；
 * 在裁判按下 START 之前，参赛代码一行都不会执行（规范 §14/§15/§17/§18）。
 *
 * 不需要：修改 JSON、DevTools、monkey patch、内部状态注入。
 *
 * 用法:
 *   npx ts-node src/operator/cli.ts [--a <pkgA>] [--b <pkgB>] [选项]
 *
 * 算法来源（规范 §2/§31/§32）：
 *   不给 --a/--b  → 直接使用固定槽位 algorithms/team-a|team-b 里的算法；
 *   给了 --a/--b  → 先按 staging → validate → preflight → hash → seal → replace
 *                   安装进槽位（坏包不会破坏现有槽位），再从槽位密封。
 *
 * 选项:
 *   --slots <dir>         算法槽位根目录（默认 <repo>/algorithms）
 *   --max-rounds <n>      操作台侧的兜底回合上限（默认 = 引擎的硬上限 60）。
 *                         **正式终止由引擎保证**：Stalemate / 硬上限 / 全灭都会
 *                         在引擎内收尾（Rule Revision 3 §16/§17），这个参数只是
 *                         防止操作台在异常情形下无限循环。
 *   --seed <n>            指定地图种子
 *   --points <6..10>      双方点数（默认 8）
 *   --difficulty <lvl>    easy | medium | hard（默认 medium）
 *   --artifacts <dir>     产物目录（默认 ./artifacts）
 *   --timeout <ms>        单次计算超时（默认 500，Rule Revision 3 §11）
 *   --auto                无人值守：跳过所有回车等待（不再有选点动作）
 *   --audience            观众模式：只输出观众屏，隐藏路径 / 哈希 / 诊断（§25）
 *   --replay <dir>        只读回放已落盘的比赛（不重跑算法）
 */

import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { MatchEngine, PLATFORM_ROOT } from '../core/Match';
import { COMPUTE_TIMEOUT_MS, HARD_ROUND_LIMIT, STALEMATE_NO_PROGRESS_LIMIT } from '../core/Rules';
import { loadReplay, persistArtifacts } from '../core/Logs';
import { MatchSetupUI } from '../ui/MatchSetupUI';
import { AudienceScreenUI } from '../ui/AudienceScreenUI';
import { JudgeControllerUI, TeamControllerUI } from '../ui/TeamControllerUI';

interface CliOptions {
  /** 上传来源：给出则执行 §31 的 staging→…→replace，否则直接用槽位里的算法 */
  a?: string;
  b?: string;
  /** 固定算法槽位根目录（规范 §2/§41） */
  slots: string;
  /**
   * 最大回合数（操作台侧护栏，不改变引擎判定）。
   *
   * 两个都不绕障碍物的算法（例如出厂 starter）会互相打不到而**永久僵持**：
   * `getWinner()` 只有在某一方点数全灭时才有结论，僵持时返回 null。
   * 引擎保持这个语义不变（判定语义是冻结的），由操作台在达到上限时停下并报告未决。
   */
  maxRounds: number;
  seed?: number;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
  artifacts: string;
  timeout: number;
  auto: boolean;
  replay?: string;
  /**
   * 观众模式（Rule Revision 3 §25）。
   *
   * 只打印观众屏内容，**隐藏**开发者诊断：槽位绝对路径、包哈希、decoy seed、
   * 状态哈希、产物目录、内部错误细节。用于现场投影或对外直播。
   */
  audience: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    points: 8,
    difficulty: 'medium',
    artifacts: path.join(process.cwd(), 'artifacts'),
    slots: path.join(PLATFORM_ROOT, 'algorithms'),
    // 兜底上限默认与**引擎的硬上限**一致：正式终止条件在引擎里
    // （Rule Revision 3 §16/§17），这里只防操作台无限循环。
    maxRounds: HARD_ROUND_LIMIT,
    timeout: COMPUTE_TIMEOUT_MS,
    auto: false,
    audience: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--a': opts.a = next(); break;
      case '--b': opts.b = next(); break;
      case '--seed': opts.seed = Number(next()); break;
      case '--points': opts.points = Number(next()); break;
      case '--difficulty': opts.difficulty = next() as CliOptions['difficulty']; break;
      case '--artifacts': opts.artifacts = path.resolve(next()); break;
      case '--slots': opts.slots = path.resolve(next()); break;
      case '--max-rounds': opts.maxRounds = Number(next()); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--auto': opts.auto = true; break;
      case '--audience': opts.audience = true; break;
      case '--replay': opts.replay = path.resolve(next()); break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Geometry Battle 操作台

  npx ts-node src/operator/cli.ts [--a <pkgA>] [--b <pkgB>] [--slots <dir>]
                                  [--seed n] [--points 8] [--difficulty medium]
                                  [--max-rounds 60] [--auto] [--artifacts dir]
  npx ts-node src/operator/cli.ts --replay <artifactDir>

  不给 --a/--b 时直接使用固定槽位 algorithms/team-a|team-b 中的算法。`);
}

/** 只读回放：不重新运行任何算法 */
function replayOnly(dir: string): void {
  const replay = loadReplay(path.join(dir, 'replay.json'));
  const screen = {
    renderFrame: (index: number) => {
      const frame = replay.frames[index];
      if (!frame) return;
      console.log(`\n── ROUND ${frame.round} ──`);
      console.log(
        `  Emitter A=${frame.emitters?.A.id ?? '-'}  B=${frame.emitters?.B.id ?? '-'}  (fixed for the match)`
      );
      console.log(`  f_A(x) = ${frame.functionMathA ?? '(invalid)'}`);
      console.log(`  f_B(x) = ${frame.functionMathB ?? '(invalid)'}`);
      console.log(`  t_A=${frame.timerA?.toFixed(3) ?? '-'}ms  t_B=${frame.timerB?.toFixed(3) ?? '-'}ms  first=${frame.firstSolver}`);
      console.log(`  hits A=[${frame.hitsA.map((h) => h.id).join(',')}] B=[${frame.hitsB.map((h) => h.id).join(',')}]`);
      console.log(`  killed=[${frame.killed.join(',')}]`);
      console.log(`  attacks executed: [${frame.attacksExecuted.join(' -> ')}]`);
      if (frame.mutualElimination) console.log('  *** MUTUAL ELIMINATION — both teams at zero ***');
      if (frame.endReason === 'STALEMATE') console.log('  *** STALEMATE — no progress within the limit ***');
      if (frame.endReason === 'HARD_ROUND_LIMIT') console.log('  *** HARD ROUND LIMIT reached ***');
      if (frame.cancelledA || frame.cancelledB) {
        console.log(`  runner cancelled (historical field): A=${frame.cancelledA} B=${frame.cancelledB}`);
      }
      console.log(`  alive combat points after: ${frame.aliveAfter.map((p) => p.id).join(',') || '(none)'}`);
      console.log(`  no-progress streak: ${frame.noProgressStreak}`);
    },
  };
  console.log(`═══ REPLAY ${replay.matchId} — winner ${replay.winner.toUpperCase()} (${replay.frames.length} rounds) ═══`);
  for (let i = 0; i < replay.frames.length; i++) screen.renderFrame(i);
  console.log('\n（回放为只读记录，未重新运行任何算法）');
}

/**
 * 落盘当前产物（Re-Gate Cycle 1 P1-A）。
 *
 * 早期版本只在整场比赛结束后调用一次 persistArtifacts，任何中止
 * （算法导致的崩溃、操作员 Ctrl-C、进程被杀）都会丢掉全部日志 ——
 * 而最需要日志的恰恰是异常场景。现在每个回合结束即落盘。
 * 落盘失败不中断比赛（产物是审计证据，不是比赛流程的一环）。
 */
function persistNow(engine: MatchEngine): void {
  try {
    persistArtifacts(engine.getArtifactDir(), engine.getArtifacts());
  } catch (e) {
    console.error(`  ⚠ 产物落盘失败（比赛继续）: ${(e as Error).message}`);
  }
}

/** 供顶层 catch 使用的引擎引用：异常退出前也要把已有产物落盘 */
let activeEngine: MatchEngine | null = null;

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.replay) {
    replayOnly(opts.replay);
    return;
  }
  const setup = new MatchSetupUI({
    seed: opts.seed,
    pointCount: opts.points,
    difficulty: opts.difficulty,
    artifactRoot: opts.artifacts,
    slotRoot: opts.slots,
    timeoutMs: opts.timeout,
  });
  const engine: MatchEngine = setup.getEngine();
  activeEngine = engine;
  const audience = new AudienceScreenUI(engine);
  const judge = new JudgeControllerUI(engine);
  const controllers = {
    A: new TeamControllerUI(engine, 'A'),
    B: new TeamControllerUI(engine, 'B'),
  };

  const rl = readline.createInterface({ input, output });
  const ask = async (q: string) => (await rl.question(q)).trim();

  try {
    if (!opts.audience) {
      // 观众模式（§25）不显示槽位面板（含绝对路径）与 Runtime 诊断
      console.log('═══ 0. 固定算法槽位（规范 §2/§33）═══');
      console.log(setup.renderSlotPanel());
      console.log(setup.renderRuntimePanel());
    }

    // ---- 上传：staging → validate → preflight → hash → seal → replace（§31/§32）----
    let installedAny = false;
    for (const team of ['A', 'B'] as const) {
      const src = team === 'A' ? opts.a : opts.b;
      if (!src) continue;
      if (!opts.audience) console.log(`\n安装 Team ${team} ← ${path.resolve(src)}`);
      if (!opts.audience) console.log('  staging → validate → preflight → hash → seal → replace');
      const inst = await setup.installAlgorithm(team, path.resolve(src));
      if (!inst.success) {
        // 非破坏性：安装失败时槽位仍是安装前那一份
        throw new Error(`Team ${team} 算法安装失败（槽位未改动）: ${inst.errors.join('; ')}`);
      }
      installedAny = true;
      if (!opts.audience) console.log(`  ✓ 槽位已替换  hash=${inst.hash}  decoySeed=${inst.detail.decoySeed}`);
    }
    if (installedAny && !opts.audience) console.log('\n' + setup.renderSlotPanel());

    console.log('\n═══ 1. 上传与密封（从槽位密封副本）═══');
    const upA = setup.uploadFromSlot('A');
    if (!upA.success) throw new Error(`Team A 上传失败: ${upA.errors.join('; ')}`);
    const upB = setup.uploadFromSlot('B');
    if (!upB.success) throw new Error(`Team B 上传失败: ${upB.errors.join('; ')}`);
    if (!opts.audience) {
      console.log(`  A hash: ${upA.hash}`);
      console.log(`  B hash: ${upB.hash}`);
    }

    if (!opts.audience) console.log('\n═══ 2. Preflight（decoy 世界 —— 与比赛种子无关，不泄漏本轮任何信息）═══');
    const pre = await setup.preflight();
    if (!opts.audience) {
      console.log(`  decoy seed: ${pre.detail.decoySeed}   比赛 seed: ${opts.seed}`);
      console.log(`  ${pre.success ? '✓ PASSED' : '✕ FAILED'}`);
    }
    if (!pre.success) throw new Error(`Preflight 失败: ${pre.errors.join('; ')}`);

    if (!opts.audience) console.log('\n═══ 3. 开始比赛 ═══');
    const started = setup.startMatch();
    if (!started.success) throw new Error(`开始比赛失败: ${started.errors.join('; ')}`);
    if (!opts.audience) console.log(setup.renderStatusTable());
    persistNow(engine); // 开赛后立即落盘一次：即使 0 回合也有审计轨迹（P1-A）

    let played = 0;
    let stalemate = false;
    // 终止条件来自**引擎**：全灭 / 同归于尽 / Stalemate / 硬上限
    // （Rule Revision 3 §17）。`getWinner()` 只在有点数归零时给结论，
    // 因此必须同时看 `endReason()` —— 否则 Stalemate 判和之后循环不会退出。
    while (engine.getWinner() === null && engine.endReason() === 'NONE') {
      if (played >= opts.maxRounds) {
        stalemate = true;
        break;
      }
      played++;
      // ---- 1. PUBLIC：生成 public_state.json，算法进程不存在（规范 §14/§15）----
      const pre = engine.beginRound();
      console.log('\n' + audience.renderPreRevealBoard(engine.getSnapshot()));
      if (!opts.audience) console.log(`  public_state.json  sha256 = ${pre.publicStateHash}`);

      // Rule Revision 3 §5：这里曾经是「双方轮流选择 Shooter 并锁定」。
      // 那一步已从正式流程删除 —— 发射锚点是整场固定的 Emitter。

      // ---- 2. REVEAL：生成 reveal_state.json（规范 §3/§17）----
      const rev = engine.revealRound();
      const snapReveal = engine.getSnapshot();
      console.log('\n' + audience.renderRevealBoard(snapReveal));
      // 观众屏主体：把真实几何画出来（障碍物已揭盲，Emitter 是常量）
      console.log('\n' + audience.renderArenaBoard({
        obstacles: snapReveal.map?.obstacles ?? [],
        emitters: snapReveal.emitters,
        points: snapReveal.points.map((pt) => ({
          id: pt.id, team: pt.team, position: pt.position, alive: pt.alive,
        })),
      }, `ROUND ${snapReveal.round + 1} — ARENA`));
      if (!opts.audience) {
        console.log(`  reveal_state.json  sha256 = ${rev.revealStateHash}`);
        console.log(`  roundStateHash              = ${rev.roundStateHash}`);
      }

      // ---- 3. START：真实门禁，此刻之前算法一行都没跑（规范 §18）----
      console.log('\n' + judge.renderWaitingForStart());
      if (!opts.auto) await ask('裁判确认 —— 按回车 START（此刻之前算法未运行）...');
      const startedRound = judge.startRound();
      if (!startedRound.success) throw new Error(`START ROUND 失败: ${startedRound.error}`);
      console.log('  ▶ START!  TEAM A COMPUTING… / TEAM B COMPUTING…');

      const result = await engine.computeRound();
      console.log(`\n── ROUND ${result.round} RESULT ──`);
      console.log(`  roundStateHash: ${result.roundStateHash.substring(0, 16)}…`);
      console.log(`  先解: ${result.firstSolver}`);
      console.log(`  A: emitter ${result.emitterA}  t=${result.computeTimeMs.A?.toFixed(3) ?? '-'}ms  命中=[${result.hits.A.join(',')}]`);
      console.log(`  B: emitter ${result.emitterB}  t=${result.computeTimeMs.B?.toFixed(3) ?? '-'}ms  命中=[${result.hits.B.join(',')}]`);
      console.log(`  击杀: [${result.killed.join(',')}]`);
      // 攻击权在 START 时已锁定，而发射锚点是固定 Emitter —— 它不会死，
      // 所以这里没有「开火时 Shooter 还在不在」这个问题（Rule Revision 3 §8）。
      console.log(`  实际开火: [${result.attacksExecuted.join(' -> ')}]`);
      if (result.mutualElimination) console.log('  *** 同归于尽 —— 双方同时归零，判平局 ***');
      if (result.cancelled.A || result.cancelled.B) {
        console.log(`  运行器取消（历史字段）: A=${result.cancelled.A} B=${result.cancelled.B}`);
      }
      console.log(`  存活战斗点: A=${result.aliveAfter.A}  B=${result.aliveAfter.B}（不含 Emitter）`);
      console.log(`  连续零击杀: ${result.log.noProgressStreak} / ${STALEMATE_NO_PROGRESS_LIMIT}`);

      // §27 Error UX：把 TIMEOUT / INVALID / CRASH 明确说出来，
      // 而不是让裁判从「有一方没开火」去反推。
      const status = audience.renderRoundStatus(result);
      if (status) console.log(status);

      // 结算后的竞技场：叠加本轮轨迹与被击杀的点
      const frame = engine.getReplay().frames[engine.getReplay().frames.length - 1];
      const snapAfter = engine.getSnapshot();
      console.log('\n' + audience.renderArenaBoard({
        obstacles: snapAfter.map?.obstacles ?? [],
        emitters: snapAfter.emitters,
        points: snapAfter.points.map((pt) => ({
          id: pt.id, team: pt.team, position: pt.position, alive: pt.alive,
        })),
        trajectoryA: frame?.trajectoryA ?? [],
        trajectoryB: frame?.trajectoryB ?? [],
        killed: result.killed,
      }, `ROUND ${result.round} — RESOLUTION`));
      persistNow(engine); // 每回合落盘（P1-A）
    }

    const dir = engine.getArtifactDir();
    persistNow(engine);
    const summary = audience.getResultSummary();

    const endReason = engine.endReason();
    console.log('\n═══════════════════════════════════════════════════');
    if (stalemate) {
      // 只有「操作台兜底上限」先于引擎终止条件触发时才会走到这里。
      console.log(`  UNDECIDED（操作台兜底上限 ${opts.maxRounds} 回合，双方僵持）`);
      console.log('  产物已完整落盘，可由裁判按赛事规则裁定。');
    } else {
      console.log(`  WINNER: ${summary.winner.toUpperCase()}`);
      console.log(`  END REASON: ${endReason}`);
    }
    console.log(`  Rounds: ${summary.rounds}   Kills: A=${summary.totalKillsA} B=${summary.totalKillsB}`);
    console.log('═══════════════════════════════════════════════════');
    if (!opts.audience) {
      // 观众屏不显示产物路径与回放命令（§25：隐藏文件系统路径与开发者诊断）
      console.log(`  Artifacts: ${dir}`);
      console.log(`\n回放: npx ts-node src/operator/cli.ts --replay ${dir}`);
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(`\n操作台错误: ${(e as Error).message}`);
  // 异常退出前也必须留下已有产物（P1-A）
  if (activeEngine) persistNow(activeEngine);
  process.exit(1);
});
