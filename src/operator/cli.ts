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
 *   上传 → Preflight → 开始比赛 →（每轮）PRE-REVEAL 板 → 选择 Shooter → 锁定 →
 *   REVEAL 板 → 裁判 START → 计算 → 结算 → 下一轮 → 胜者 → 落盘
 *
 * V1.1 三段式：REVEAL 与 START 是两个独立事件，中间可以停任意久；
 * 在裁判按下 START 之前，参赛代码一行都不会执行（规范 §14/§15/§17/§18）。
 *
 * 不需要：修改 JSON、DevTools、monkey patch、内部状态注入。
 *
 * 用法:
 *   npx ts-node src/operator/cli.ts --a <pkgA> --b <pkgB> [选项]
 *
 * 选项:
 *   --seed <n>            指定地图种子
 *   --points <6..10>      双方点数（默认 8）
 *   --difficulty <lvl>    easy | medium | hard（默认 medium）
 *   --artifacts <dir>     产物目录（默认 ./artifacts）
 *   --timeout <ms>        单次计算超时（默认 2000）
 *   --auto                无人值守：自动选择每队第一个存活点
 *   --replay <dir>        只读回放已落盘的比赛（不重跑算法）
 */

import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { MatchEngine } from '../core/Match';
import { loadReplay, persistArtifacts } from '../core/Logs';
import { MatchSetupUI } from '../ui/MatchSetupUI';
import { AudienceScreenUI } from '../ui/AudienceScreenUI';
import { JudgeControllerUI, TeamControllerUI } from '../ui/TeamControllerUI';

interface CliOptions {
  a?: string;
  b?: string;
  seed?: number;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
  artifacts: string;
  timeout: number;
  auto: boolean;
  replay?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    points: 8,
    difficulty: 'medium',
    artifacts: path.join(process.cwd(), 'artifacts'),
    timeout: 2000,
    auto: false,
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
      case '--timeout': opts.timeout = Number(next()); break;
      case '--auto': opts.auto = true; break;
      case '--replay': opts.replay = path.resolve(next()); break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Geometry Battle 操作台

  npx ts-node src/operator/cli.ts --a <pkgA> --b <pkgB> [--seed n] [--points 8]
                                  [--difficulty medium] [--auto] [--artifacts dir]
  npx ts-node src/operator/cli.ts --replay <artifactDir>`);
}

/** 只读回放：不重新运行任何算法 */
function replayOnly(dir: string): void {
  const replay = loadReplay(path.join(dir, 'replay.json'));
  const screen = {
    renderFrame: (index: number) => {
      const frame = replay.frames[index];
      if (!frame) return;
      console.log(`\n── ROUND ${frame.round} ──`);
      console.log(`  Shooter A=${frame.shooterA?.id ?? '-'}  B=${frame.shooterB?.id ?? '-'}`);
      console.log(`  f_A(x) = ${frame.functionMathA ?? '(invalid)'}`);
      console.log(`  f_B(x) = ${frame.functionMathB ?? '(invalid)'}`);
      console.log(`  t_A=${frame.timerA?.toFixed(3) ?? '-'}ms  t_B=${frame.timerB?.toFixed(3) ?? '-'}ms  first=${frame.firstSolver}`);
      console.log(`  hits A=[${frame.hitsA.map((h) => h.id).join(',')}] B=[${frame.hitsB.map((h) => h.id).join(',')}]`);
      console.log(`  killed=[${frame.killed.join(',')}] cancelled A=${frame.cancelledA} B=${frame.cancelledB}`);
      console.log(`  alive after: ${frame.aliveAfter.map((p) => p.id).join(',') || '(none)'}`);
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
  if (!opts.a || !opts.b) {
    printHelp();
    process.exit(1);
  }

  const setup = new MatchSetupUI({
    seed: opts.seed,
    pointCount: opts.points,
    difficulty: opts.difficulty,
    artifactRoot: opts.artifacts,
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
    console.log('═══ 1. 上传与密封 ═══');
    const upA = setup.uploadTeamA(path.resolve(opts.a));
    if (!upA.success) throw new Error(`Team A 上传失败: ${upA.errors.join('; ')}`);
    const upB = setup.uploadTeamB(path.resolve(opts.b));
    if (!upB.success) throw new Error(`Team B 上传失败: ${upB.errors.join('; ')}`);
    console.log(`  A hash: ${upA.hash}`);
    console.log(`  B hash: ${upB.hash}`);

    console.log('\n═══ 2. Preflight（decoy 世界 —— 与比赛种子无关，不泄漏本轮任何信息）═══');
    const pre = await setup.preflight();
    console.log(`  decoy seed: ${pre.detail.decoySeed}   比赛 seed: ${opts.seed}`);
    console.log(`  ${pre.success ? '✓ PASSED' : '✕ FAILED'}`);
    if (!pre.success) throw new Error(`Preflight 失败: ${pre.errors.join('; ')}`);

    console.log('\n═══ 3. 开始比赛 ═══');
    const started = setup.startMatch();
    if (!started.success) throw new Error(`开始比赛失败: ${started.errors.join('; ')}`);
    console.log(setup.renderStatusTable());
    persistNow(engine); // 开赛后立即落盘一次：即使 0 回合也有审计轨迹（P1-A）

    while (engine.getWinner() === null) {
      // ---- 1. PRE-REVEAL：生成 public_state.json，算法进程不存在（规范 §14/§15）----
      const pre = engine.beginRound();
      console.log('\n' + audience.renderPreRevealBoard(engine.getSnapshot()));
      console.log(`  public_state.json  sha256 = ${pre.publicStateHash}`);

      for (const team of ['A', 'B'] as const) {
        const ctrl = controllers[team];
        const alive = ctrl.getAliveShooters();
        let choice: string;
        if (opts.auto) {
          choice = alive[0].id;
          console.log(`\nTeam ${team} 自动选择: ${choice}`);
        } else {
          console.log('\n' + ctrl.renderSelectionUI());
          choice = await ask(`Team ${team} 选择 Shooter (点 id): `);
        }
        const sel = ctrl.selectShooter(choice);
        if (!sel.success) throw new Error(`Team ${team} 选择失败: ${sel.error}`);
        const lock = ctrl.lockShooter();
        if (!lock.success) throw new Error(`Team ${team} 锁定失败: ${lock.error}`);
      }

      // ---- 2. REVEAL：双方 LOCK 之后才生成 reveal_state.json（规范 §3/§17）----
      const rev = engine.revealRound();
      console.log('\n' + audience.renderRevealBoard(engine.getSnapshot()));
      console.log(`  reveal_state.json  sha256 = ${rev.revealStateHash}`);
      console.log(`  roundStateHash              = ${rev.roundStateHash}`);

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
      console.log(`  A: ${result.shooterA}  t=${result.computeTimeMs.A?.toFixed(3) ?? '-'}ms  命中=[${result.hits.A.join(',')}]`);
      console.log(`  B: ${result.shooterB}  t=${result.computeTimeMs.B?.toFixed(3) ?? '-'}ms  命中=[${result.hits.B.join(',')}]`);
      console.log(`  击杀: [${result.killed.join(',')}]  取消: A=${result.cancelled.A} B=${result.cancelled.B}`);
      console.log(`  存活: A=${result.aliveAfter.A}  B=${result.aliveAfter.B}`);
      persistNow(engine); // 每回合落盘（P1-A）
    }

    const dir = engine.getArtifactDir();
    persistNow(engine);
    const summary = audience.getResultSummary();

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  WINNER: ${summary.winner.toUpperCase()}`);
    console.log(`  Rounds: ${summary.rounds}   Kills: A=${summary.totalKillsA} B=${summary.totalKillsB}`);
    console.log(`  Artifacts: ${dir}`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`\n回放: npx ts-node src/operator/cli.ts --replay ${dir}`);
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
