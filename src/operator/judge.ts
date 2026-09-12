/**
 * Geometry Battle —— 裁判台（Judge Console）
 *
 * Rule Revision 3 §24/§25/§33 的正式赛事入口。
 *
 * 为什么它不是「开发 CLI」：
 *   - **不需要传任何参数就能开一场正规比赛**：算法从**运行期槽位**
 *     `runs/slots/team-a|team-b` 取（首次启动会从仓库自带的 canonical 槽位
 *     `algorithms/` 播种一次），种子自动生成；
 *   - 交互式菜单驱动，裁判按编号动作，不需要记命令行 flag、不需要点 id、
 *     不需要知道文件路径；
 *   - 链路上每个动作都在控制台板上列出来（载入 / 校验 / 揭晓 / START /
 *     结算 / 终局 / 回放 / 审计 / 重置），走完一场可以**直接开下一场**；
 *   - 观众屏（`--spectator`）不会出现任何开发者诊断。
 *
 * 用法：
 *   npm run judge                          # 交互式，用固定槽位里的算法
 *   npm run judge -- --a <dir> --b <dir>   # 开赛前安装（替换槽位）
 *   npm run judge -- --auto                # 无人值守跑完一整场（演练/CI）
 *   npm run judge -- --spectator           # 现场大屏模式（简洁）
 *
 * 与 `cli.ts` 的关系：`cli.ts` 是底层操作台（保留全部诊断与 flag，
 * 供开发/排查使用）；本文件是**面向裁判的入口**，两者共用同一个 MatchEngine
 * 与同一套 UI 组件，不复制任何判定。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { MatchEngine, PLATFORM_ROOT } from '../core/Match';
import { RUNTIME_SLOT_ROOT, prepareRuntimeSlots } from '../submission/Slot';
import { persistArtifacts } from '../core/Logs';
import { AudienceScreenUI } from '../ui/AudienceScreenUI';
import { SlotReadiness, consoleInputFrom, renderAuditSummary, renderJudgeConsole, renderMatchSummary, renderReplayIndex } from '../ui/JudgeConsole';
import { MatchSetupUI } from '../ui/MatchSetupUI';
import {
  buildAnimationFrames,
  createTerminalSink,
  downsampleTrajectory,
  playAnimation,
} from '../ui/TrajectoryAnimator';

interface JudgeOptions {
  a?: string;
  b?: string;
  slots: string;
  seed?: number;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
  artifacts: string;
  auto: boolean;
  spectator: boolean;
  animate: boolean;
  animFrames: number;
  animMs: number;
  maxMatches: number;
}

function parseArgs(argv: string[]): JudgeOptions {
  const o: JudgeOptions = {
    // 正式投递点：运行期槽位根（与 Web `npm run app` 同一处）。
    // 仓库里的 algorithms/ 只是出厂 fixture，**不是**投递点。
    slots: RUNTIME_SLOT_ROOT,
    points: 8,
    difficulty: 'medium',
    artifacts: path.join(process.cwd(), 'artifacts'),
    auto: false,
    spectator: false,
    animate: true,
    animFrames: 24,
    animMs: 45,
    maxMatches: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--a': o.a = next(); break;
      case '--b': o.b = next(); break;
      case '--slots': o.slots = path.resolve(next()); break;
      case '--seed': o.seed = Number(next()); break;
      case '--points': o.points = Number(next()); break;
      case '--difficulty': o.difficulty = next() as JudgeOptions['difficulty']; break;
      case '--artifacts': o.artifacts = path.resolve(next()); break;
      case '--auto': o.auto = true; break;
      case '--spectator': o.spectator = true; break;
      case '--no-anim': o.animate = false; break;
      case '--anim-frames': o.animFrames = Number(next()); break;
      case '--anim-ms': o.animMs = Number(next()); break;
      case '--matches': o.maxMatches = Number(next()); break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`);
    }
  }
  return o;
}

/** 裁判可用的动作 —— 与 §24 的动作清单一一对应 */
const ACTIONS = [
  { key: 'a', label: '载入 / 替换 Team A 算法（输入目录路径）' },
  { key: 'b', label: '载入 / 替换 Team B 算法（输入目录路径）' },
  { key: 'v', label: '校验两份算法并把比赛置为就绪（Preflight）' },
  { key: 's', label: '开始比赛（载入固定槽位并进入第一轮）' },
  { key: 'r', label: '揭晓本轮（REVEAL：公开障碍物，算法仍未运行）' },
  { key: 'g', label: 'START（此刻之前参赛代码一行都没跑）' },
  { key: 'w', label: '结算本轮，并在屏幕上播放轨迹动画' },
  { key: 'n', label: '连续跑完余下回合，直到比赛终止' },
  { key: 'p', label: '查看回放' },
  { key: 'u', label: '查看审计摘要' },
  { key: 'x', label: '本场结束 —— 回到初始状态，准备下一场' },
  { key: 'q', label: '退出裁判台' },
];

function persist(engine: MatchEngine): void {
  try {
    persistArtifacts(engine.getArtifactDir(), engine.getArtifacts());
  } catch {
    /* 产物落盘失败不中断比赛 */
  }
}

function slotsOf(setup: MatchSetupUI): { A: SlotReadiness; B: SlotReadiness } {
  const states = setup.slotStates();
  const pick = (team: 'A' | 'B'): SlotReadiness => {
    const st = states[team];
    return {
      team,
      installed: st.status === 'READY',
      hash: st.hash,
      preflightPassed: Boolean(st.record?.preflight.ok),
    };
  };
  return { A: pick('A'), B: pick('B') };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  // 运行期槽位是正式投递点；首次启动从 canonical fixture 播种（已存在则不覆盖）
  prepareRuntimeSlots(opts.slots);
  /**
   * 输入抽象：**TTY 走交互提示，管道走预读行队列**。
   *
   * 为什么不能一律用 readline：开赛前的载入 / 上传 / Preflight 要跑好几秒，
   * 从管道喂进去的输入在那之前就已经 EOF；readline 会先触发 'close'，
   * 第一次提问还好、第二次就抛 `readline was closed`。
   * （这不是假想 —— 交互路径的首次冒烟就是这样挂的。）
   *
   * 因此：真终端用 readline（有提示、可等待）；非 TTY 一次性读完所有行，
   * 逐行回答；行用完之后**默认退出**，而不是挂住或抛错。
   * 这也让裁判台本身可以被脚本驱动（演练/CI）。
   */
  const interactiveTty = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  let rl: readline.Interface | null = null;
  let pending: string[] | null = null;
  let sawPrompt = false;

  const nextLine = async (q: string): Promise<string | null> => {
    if (interactiveTty) {
      if (!rl) rl = readline.createInterface({ input, output });
      if (sawPrompt) output.write('\n');
      sawPrompt = true;
      return (await rl.question(q)).trim();
    }
    if (pending === null) {
      const raw = fs.readFileSync(0, 'utf8');
      pending = raw.split('\n').map((l) => l.trim());
    }
    // 去掉末尾由换行产生的空串
    if (pending.length > 0 && pending[pending.length - 1] === '') pending.pop();
    if (pending.length === 0) return null;
    const line = pending.shift()!;
    console.log(`${q}${line}`);
    return line;
  };

  /**
   * 提问；输入耗尽时返回空串（调用方按「默认选项」处理）。
   *
   * 同时记下「输入已经没了」—— 主循环据此**退出**，而不是把空串当成
   * 「未知动作」无限循环（这是交互路径冒烟时实际踩到的第二个坑）。
   */
  let inputExhausted = false;
  const ask = async (q: string): Promise<string> => {
    const line = await nextLine(q);
    if (line === null) {
      inputExhausted = true;
      return '';
    }
    return line;
  };

  const closeInput = (): void => {
    rl?.close();
    rl = null;
  };
  const sink = createTerminalSink();
  let played = 0;

  const newSetup = () =>
    new MatchSetupUI({
      seed: opts.seed,
      pointCount: opts.points,
      difficulty: opts.difficulty,
      artifactRoot: opts.artifacts,
      slotRoot: opts.slots,
    });

  try {
    for (;;) {
      const setup = newSetup();
      const engine = setup.getEngine();
      const audience = new AudienceScreenUI(engine);

      // ---- 载入（§24 的第 1、2 项）----
      // 给了 --a/--b 就先替换槽位（非破坏性：坏包不会动现有槽位）。
      for (const team of ['A', 'B'] as const) {
        const src = team === 'A' ? opts.a : opts.b;
        if (!src) continue;
        const inst = await setup.installAlgorithm(team, path.resolve(src));
        if (!inst.success) throw new Error(`Team ${team} 算法载入失败（槽位未改动）: ${inst.errors.join('; ')}`);
        console.log(`  Team ${team} 算法已载入。`);
      }

      /** 从槽位密封副本上传；失败时返回错误而不是抛出，好让裁判在控制台里补救 */
      const uploadBoth = (): string[] => {
        const errs: string[] = [];
        for (const team of ['A', 'B'] as const) {
          const up = setup.uploadFromSlot(team);
          if (!up.success) errs.push(...up.errors);
        }
        return errs;
      };

      // 无人值守：一口气走完「上传 → 校验 → 开赛 → 打到终止」。
      // 交互模式则**只**做上传这一步作为前置，把「校验」「开赛」「揭晓」「START」
      // 留给裁判按动作执行 —— 否则控制台列出的动作在进入循环时就已经做完了。
      if (opts.auto) {
        const errs = uploadBoth();
        if (errs.length > 0) throw new Error(`算法未就绪: ${errs.join('; ')}`);
        const pre = await setup.preflight();
        if (!pre.success) throw new Error(`校验失败: ${pre.errors.join('; ')}`);
        const started = setup.startMatch();
      engine.autoSelectEmitters();
        if (!started.success) throw new Error(`无法开始比赛: ${started.errors.join('; ')}`);
      } else {
        const errs = uploadBoth();
        if (errs.length > 0) {
          console.log('\n⚠ 算法尚未就绪，请先用 [a] / [b] 载入：');
          for (const e of errs) console.log(`  - ${e}`);
        }
      }
      const matchNo = played + 1;
      console.log(`\n比赛 ${matchNo} 就绪（matchId=${engine.matchId}）`);

      const showConsole = () => {
        console.log('\n' + renderJudgeConsole(consoleInputFrom(engine, slotsOf(setup), ACTIONS)));
      };

      const reveal = () => {
        engine.beginRound();
        engine.revealRound();
      };
      const start = () => {
        const r = engine.judgeStartRound();
        if (!r.ok) throw new Error(`START 失败: ${r.error}`);
      };

      /** 结算一轮；带观众屏（含轨迹动画） */
      const computeRound = async (animate: boolean) => {
        const result = await engine.computeRound();
        const frames = engine.getReplay().frames;
        const f = frames[frames.length - 1];
        const tA = downsampleTrajectory(f?.trajectoryA ?? []);
        const tB = downsampleTrajectory(f?.trajectoryB ?? []);
        const snap = engine.getSnapshot();
        const base = {
          snap,
          trajectoryA: tA,
          trajectoryB: tB,
          killed: result.killed,
        };
        const headline = `FIRST: ${result.firstSolver.toUpperCase()}`;
        const footnote =
          result.log.attacksExecuted.length > 0
            ? `attacked [${result.log.attacksExecuted.join(' → ')}]   killed [${result.killed.join(',') || 'none'}]`
            : 'no attack executed this round';

        if (animate && opts.animate && (tA.length > 1 || tB.length > 1)) {
          const plan = buildAnimationFrames({
            lengthA: tA.length,
            lengthB: tB.length,
            frameCount: opts.animFrames,
            frameMs: opts.animMs,
          });
          await playAnimation(sink, plan, base, (fr) => audience.renderSpectatorBoard({ ...base, ...fr }));
          if (sink.interactive) console.log('');
        } else {
          console.log('\n' + audience.renderSpectatorBoard(base));
        }
        console.log('  ' + headline + '   ' + footnote);
        const status = audience.renderRoundStatus(result);
        if (status) console.log(status);
        persist(engine);
        return result;
      };

      const runToEnd = async () => {
        while (engine.endReason() === 'NONE') {
          reveal();
          start();
          await computeRound(true);
        }
      };

      // ---- 交互循环 / 无人值守 ----
      if (opts.auto) {
        // 大屏模式不打印裁判控制台 —— 那是裁判的东西，不是给观众看的
        if (!opts.spectator) showConsole();
        await runToEnd();
      } else {
        let running = true;
        let summaryShown = false;
        while (running) {
          showConsole();
          const cmd = (await ask('裁判动作 > ')).toLowerCase();
          if (inputExhausted) {
            console.log('（输入已结束 —— 退出裁判台）');
            closeInput();
            return;
          }
          switch (cmd) {
            case 'a':
            case 'b': {
              const team = cmd.toUpperCase() as 'A' | 'B';
              const dir = await ask(`Team ${team} 算法目录: `);
              const inst = await setup.installAlgorithm(team, path.resolve(dir));
              if (!inst.success) {
                console.log(`  ✕ 载入失败（槽位未改动）: ${inst.errors.join('; ')}`);
              } else {
                const up = setup.uploadFromSlot(team);
                console.log(up.success ? `  ✓ Team ${team} 算法已载入并密封。` : `  ✕ ${up.errors.join('; ')}`);
              }
              break;
            }
            case 'v': {
              try {
                const p = await setup.preflight();
                console.log(p.success ? '  ✓ 校验通过，双方就绪。' : `  ✕ 校验失败: ${p.errors.join('; ')}`);
              } catch (e) {
                console.log(`  ✕ ${(e as Error).message}`);
              }
              break;
            }
            case 's': {
              // **不重复实现引擎的门禁** —— MatchEngine 自己知道「上传完毕 +
              // preflight 通过」才是可开赛状态，UI 再猜一套（比如按阶段名判断）
              // 只会造出一个和引擎不一致的影子规则。直接把它的结论报出来。
              const r = setup.startMatch();
      engine.autoSelectEmitters();
              console.log(r.success ? '  ✓ 比赛已开始。' : `  ✕ ${r.errors.join('; ')}`);
              break;
            }
            case 'r':
              try {
                if (engine.endReason() !== 'NONE') {
                  console.log('  ✕ 比赛已经结束。');
                  break;
                }
                reveal();
                console.log('  ✓ 已揭晓本轮 —— 参赛代码仍未运行。');
              } catch (e) {
                console.log(`  ✕ ${(e as Error).message}`);
              }
              break;
            case 'g':
              try {
                start();
                console.log('  ▶ START —— 双方算法开始计算。');
              } catch (e) {
                console.log(`  ✕ ${(e as Error).message}`);
              }
              break;
            case 'w':
              try {
                if (engine.getSnapshot().phase !== 'COUNTDOWN') {
                  console.log('  ✕ 本轮尚未 START。');
                  break;
                }
                await computeRound(true);
              } catch (e) {
                console.log(`  ✕ ${(e as Error).message}`);
              }
              break;
            case 'n':
              try {
                await runToEnd();
                console.log('  ✓ 比赛已终止。');
              } catch (e) {
                console.log(`  ✕ ${(e as Error).message}`);
              }
              break;
            case 'p': {
              const replay = engine.getReplay();
              if (replay.frames.length === 0) {
                console.log('  （还没有任何回合）');
                break;
              }
              console.log('\n' + renderReplayIndex(replay));
              const pick = await ask('看第几轮？(回车跳过) ');
              const idx = Number(pick) - 1;
              if (Number.isInteger(idx) && replay.frames[idx]) {
                console.log('\n' + audience.renderReplayFrame(replay, idx));
              }
              break;
            }
            case 'u':
              console.log('\n' + renderAuditSummary(engine.getArtifacts().auditLog));
              break;
            case 'x':
              if (engine.endReason() === 'NONE' && engine.getSnapshot().phase !== 'READY') {
                console.log('  ✕ 本场还没结束（用 [n] 跑完，或 [q] 直接退出）。');
                break;
              }
              running = false;
              break;
            case 'q':
              closeInput();
              return;
            default:
              console.log('  ✕ 未知动作。');
          }

          // 终局摘要只打印一次 —— 之后每次动作都重印一遍会淹没屏幕
          if (engine.endReason() !== 'NONE' && running && !summaryShown) {
            console.log('\n' + renderMatchSummary(engine.getMatchLog()));
            summaryShown = true;
          }
        }
      }

      // ---- 终局：结果 + 回放 + 审计 ----
      if (!opts.spectator) {
        console.log('\n' + renderMatchSummary(engine.getMatchLog()));
        console.log('\n' + renderAuditSummary(engine.getArtifacts().auditLog));
      } else {
        console.log(
          '\n' +
            audience.renderSpectatorBoard({
              snap: engine.getSnapshot(),
              footnote:
                engine.getMatchLog().winner === 'draw'
                  ? `DRAW (${engine.endReason()})`
                  : `WINNER: TEAM ${engine.getMatchLog().winner} (${engine.endReason()})`,
            })
        );
      }
      persist(engine);
      played++;

      if (opts.auto && played < opts.maxMatches) {
        console.log(`\n—— 重置，准备第 ${played + 1} 场 ——\n`);
        continue;
      }
      // 大屏模式**绝不**打印产物路径 —— 即使是无人值守（--auto --spectator）
      if (!opts.spectator) {
        console.log(`\n产物目录: ${engine.getArtifactDir()}`);
        console.log('回放: npx ts-node src/operator/cli.ts --replay <dir>');
      }

      if (opts.auto) break;
      const again = (await ask('再开一场？(y/N) ')).toLowerCase();
      if (again !== 'y') break;
    }
  } finally {
    closeInput();
  }
}

main().catch((e) => {
  console.error(`\n裁判台错误: ${(e as Error).message}`);
  process.exit(1);
});
