/**
 * termination —— 终止保证（Rule Revision 3 §16/§17）
 *
 * §17 要求：**每场合法比赛都在有限时间内终止**，且四类结束方式穷举全部情形：
 *
 *     ELIMINATION / MUTUAL_ELIMINATION / STALEMATE / HARD_ROUND_LIMIT
 *
 * 这条保证落在 **MatchEngine** 里，而不是 CLI 的 `--max-rounds`。
 * 本套件逐条验证两条**边界**终局能被触发 —— 在自然对局里 HARD_ROUND_LIMIT
 * 可能一整轮都不出现（180 场最终 playtest 里是 0 次），那条代码路径就没人盯着。
 *
 * 因此这里用 `MatchOptions` 的**测试专用**阈值覆盖把两条边界都逼出来；
 * 生产路径（`operator/cli.ts`）不暴露这两个参数，用的永远是 Rules 里的冻结值。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { HARD_ROUND_LIMIT, STALEMATE_NO_PROGRESS_LIMIT } from '../src/core/Rules';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const SNIPER = path.join(__dirname, 'fixtures', 'algos', 'sniper');

/**
 * 永远打不中任何人的算法：交一条只穿过自己 Emitter 的常函数。
 *
 * 双方都是它 → 谁也不会击杀谁 → `NoProgressStreak` 一路增长。
 * 这是「吸收式僵持」的最小构造。
 */
const NEVER_HITS = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
emit({"type": "add", "args": [
    {"type": "number", "value": me["y"]},
    {"type": "mul", "args": [{"type": "number", "value": 0.0},
                             {"type": "variable", "value": "x"}]}]})
`;

function writePkg(dir: string, source: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name, version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(path.join(dir, 'solver.py'), source);
  return dir;
}

interface Opts {
  matchId: string;
  algoA: string;
  algoB: string;
  stalemateNoProgressLimit?: number;
  hardRoundLimit?: number;
  seed?: number;
}

async function ready(o: Opts): Promise<MatchEngine> {
  const root = tmpDir('termination');
  const engine = new MatchEngine({
    matchId: o.matchId,
    seed: o.seed ?? 31337,
    pointCount: 6,
    difficulty: 'easy',
    stalemateNoProgressLimit: o.stalemateNoProgressLimit,
    hardRoundLimit: o.hardRoundLimit,
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', o.algoA).ok, 'A 应能上传');
  assert(engine.upload('B', o.algoB).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  assert(engine.startMatch().ok, '开始比赛应成功');
  engine.autoSelectEmitters();
  return engine;
}

/** 一直跑到引擎自己宣布终止，返回跑过的轮数 */
async function runToTermination(engine: MatchEngine, guard = 200): Promise<number> {
  let rounds = 0;
  while (engine.endReason() === 'NONE') {
    await engine.runRound();
    if (++rounds > guard) throw new Error(`引擎没有在 ${guard} 轮内终止 —— 终止保证失效`);
  }
  return rounds;
}

test('termination: 冻结的阈值就是规范里的值', () => {
  assertEqual(STALEMATE_NO_PROGRESS_LIMIT, 20, 'Stalemate 阈值应为 20（规范 §44）');
  assertEqual(HARD_ROUND_LIMIT, 60, '硬回合上限应为 60（规范 §44）');
});

test('termination: 双方都打不中 → 连续零击杀达到阈值判 STALEMATE / DRAW', async () => {
  const pkg = writePkg(path.join(tmpDir('term-stale'), 'never'), NEVER_HITS, 'never-hits');
  // 用测试专用阈值把边界逼出来（生产值是 20）
  const engine = await ready({ matchId: 'TERM-STALE', algoA: pkg, algoB: pkg, stalemateNoProgressLimit: 4 });

  const rounds = await runToTermination(engine);
  assertEqual(rounds, 4, '应在第 4 个零击杀回合判僵持');
  assertEqual(engine.endReason(), 'STALEMATE', '结束原因必须是 STALEMATE');
  assertEqual(engine.getWinner(), null, '僵持时没有胜者（getWinner 返回 null）');
  assertEqual(engine.getMatchLog().winner, 'draw', '僵持必须判和');
  assertEqual(engine.getMatchLog().endReason, 'STALEMATE', '落盘日志必须记录 STALEMATE');

  // 逐轮的 NoProgressStreak 必须可复核
  const roundsLog = engine.getMatchLog().rounds;
  assertEqual(roundsLog.length, 4, '应有 4 轮记录');
  for (let i = 0; i < roundsLog.length; i++) {
    assertEqual(roundsLog[i].noProgressStreak, i + 1, `第 ${i + 1} 轮的连续零击杀数应为 ${i + 1}`);
    assertEqual(roundsLog[i].aKills + roundsLog[i].bKills, 0, '这一局不该有任何击杀');
  }
  // 双方都还有战斗点 —— 它不是同归于尽
  assert(engine.getMatchLog().finalAlive.A > 0 && engine.getMatchLog().finalAlive.B > 0, '僵持时双方都还应有战斗点');
});

test('termination: 硬回合上限会兜住「一直有击杀但打不完」的局面', async () => {
  const pkg = writePkg(path.join(tmpDir('term-hard'), 'never2'), NEVER_HITS, 'never-hits2');
  const engine = await ready({
    matchId: 'TERM-HARD',
    algoA: pkg,
    algoB: pkg,
    // 把僵持阈值抬到硬上限之上：这样 STALEMATE 不会先触发，必须由硬上限收场
    stalemateNoProgressLimit: 1000,
    hardRoundLimit: 3,
  });

  const rounds = await runToTermination(engine);
  assertEqual(rounds, 3, '应在第 3 回合被硬上限截断');
  assertEqual(engine.endReason(), 'HARD_ROUND_LIMIT', '结束原因必须是 HARD_ROUND_LIMIT');
  assertEqual(engine.getMatchLog().winner, 'draw', '硬上限同样判和');
  assertEqual(engine.getMatchLog().endReason, 'HARD_ROUND_LIMIT', '落盘日志必须记录原因');
});

test('termination: 一条击杀就把连续零击杀计数清零', async () => {
  // A 用狙击（会命中），B 永远打不中 → 第一轮有击杀，之后一路僵持。
  const root = tmpDir('term-reset');
  const never = writePkg(path.join(root, 'never3'), NEVER_HITS, 'never-hits3');
  const engine = await ready({
    matchId: 'TERM-RESET',
    algoA: SNIPER,
    algoB: never,
    stalemateNoProgressLimit: 50,
    hardRoundLimit: 3,
    seed: 7,
  });

  const first = await engine.runRound();
  const killed = first.killed.length;
  assertEqual(first.log.noProgressStreak, killed > 0 ? 0 : 1, '有击杀时计数必须清零，没有则加一');

  const more = await runToTermination(engine);
  // 第一轮已经在上面手动跑过，这里只统计剩下的
  assertEqual(1 + more, 3, '应跑到硬上限');
  const log = engine.getMatchLog();
  // 每一轮都要么清零、要么 +1，不允许跳变
  let streak = 0;
  for (const r of log.rounds) {
    streak = r.aKills + r.bKills > 0 ? 0 : streak + 1;
    assertEqual(r.noProgressStreak, streak, `第 ${r.round} 轮的连续零击杀计数不符合定义`);
  }
});

test('termination: 四类结束方式是穷举 —— 每一场都以其中之一收场', async () => {
  // 用几组不同的条件各跑一场，逐场确认 endReason 落在四类之内，
  // 且 winner 与 endReason 的对应关系正确（ELIMINATION 才可能分出胜负）
  const root = tmpDir('term-exhaustive');
  const never = writePkg(path.join(root, 'never4'), NEVER_HITS, 'never-hits4');
  const cases: { id: string; a: string; b: string; stale: number; hard: number; seed: number }[] = [
    { id: 'EX-1', a: SNIPER, b: never, stale: 50, hard: 60, seed: 11 },
    { id: 'EX-2', a: never, b: never, stale: 3, hard: 60, seed: 12 },
    { id: 'EX-3', a: SNIPER, b: never, stale: 1000, hard: 2, seed: 13 },
  ];
  const seen = new Set<string>();
  for (const c of cases) {
    const engine = await ready({
      matchId: c.id, algoA: c.a, algoB: c.b,
      stalemateNoProgressLimit: c.stale, hardRoundLimit: c.hard, seed: c.seed,
    });
    await runToTermination(engine);
    const log = engine.getMatchLog();
    seen.add(log.endReason);
    assert(
      ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(log.endReason),
      `${c.id}: endReason 必须落在四类之内，实际 ${log.endReason}`
    );
    if (log.endReason !== 'ELIMINATION') {
      assertEqual(log.winner, 'draw', `${c.id}: 非 ELIMINATION 必须判和，实际 ${log.winner}`);
    }
    // 回放必须记录同一个结束原因（§22）
    assertEqual(engine.getReplay().endReason, log.endReason, `${c.id}: 回放的 endReason 必须一致`);
  }
  assert(seen.size >= 2, `至少应观察到两类不同的终局，实际 {${[...seen].join(',')}}`);
});

void runAll('termination');
