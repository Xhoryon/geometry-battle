/**
 * replay —— 回放、日志与持久化（P1-16 / P1-17 / P1-18）
 *
 * 契约：
 *   1) 回放是「只读记录」，加载回放绝不允许重新运行算法；
 *   2) 删除算法包与沙箱之后，回放仍然可以完整重建每一轮；
 *   3) 帧的 stateHash 与 MatchLog 逐轮一致，alive 链首尾相接；
 *   4) 审计日志是完整、单调、可追溯的事件序列。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { AuditLog, MatchLog, Replay, loadReplay, persistArtifacts } from '../src/core/Logs';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ALGO_A = path.join(__dirname, 'fixtures', 'algos', 'arc-sweep');
const ALGO_B = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');

interface Played {
  engine: MatchEngine;
  artifactDir: string;
  root: string;
  rounds: number;
  winner: 'A' | 'B' | 'draw' | null;
}

async function playAndPersist(matchId: string, seed: number, pointCount = 6): Promise<Played> {
  const root = tmpDir('replay');
  const engine = new MatchEngine({
    matchId,
    seed,
    pointCount,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', ALGO_A).ok, '上传 A 应成功');
  assert(engine.upload('B', ALGO_B).ok, '上传 B 应成功');
  assert((await engine.preflight()).ok, 'preflight 应通过');
  assert(engine.startMatch().ok, '开始比赛应成功');

  let rounds = 0;
  while (engine.getWinner() === null) {
    assert(engine.judgeStartRound().ok, 'START ROUND 应成功');
    await engine.runRound();
    if (++rounds > 40) throw new Error('回合数异常');
  }

  const artifactDir = engine.getArtifactDir();
  persistArtifacts(artifactDir, engine.getArtifacts());
  return { engine, artifactDir, root, rounds, winner: engine.getWinner() };
}

test('replay: 删除算法包与沙箱后，回放仍可完整加载', async () => {
  const played = await playAndPersist('REPLAY-SELFCONTAINED', 880011);
  const replayFile = path.join(played.artifactDir, 'replay.json');
  assert(fs.existsSync(replayFile), 'replay.json 应存在');

  // 把「跑比赛所需的一切」全部删掉：密封包、沙箱、源包都不可用
  fs.rmSync(path.join(played.root, 'artifacts', 'sealed'), { recursive: true, force: true });
  fs.rmSync(path.join(played.root, 'sandboxes'), { recursive: true, force: true });

  const started = Date.now();
  const replay = loadReplay(replayFile);
  const elapsed = Date.now() - started;

  assertEqual(replay.frames.length, played.rounds, '帧数必须等于回合数');
  assertEqual(replay.winner, played.winner, '胜者必须一致');
  // 重跑一轮算法需要几百毫秒；加载回放必须是纯读取
  assert(elapsed < 200, `加载回放耗时 ${elapsed}ms，说明它可能重跑了算法`);
  for (const frame of replay.frames) {
    assert(frame.obstacles.length >= 0, '帧必须自带地图障碍物');
    assert(frame.aliveBefore.length > 0, '帧必须自带开战前存活点');
    assert(frame.aliveAfter.length >= 0, '帧必须自带结算后存活点');
    // Rule Revision 3 §22：回放必须能画出整场不变的固定 Emitter。
    assert(frame.emitters && frame.emitters.A && frame.emitters.B, '帧必须自带双方固定 Emitter');
    assert(frame.emitters!.A.id === 'A0', 'Emitter 标识必须是固定的 A0');
  }
});

test('replay: 帧的 roundStateHash 与 MatchLog 逐轮一致，alive 链首尾相接', async () => {
  const played = await playAndPersist('REPLAY-CHAIN', 660022);
  const replay: Replay = loadReplay(path.join(played.artifactDir, 'replay.json'));
  const match: MatchLog = JSON.parse(
    fs.readFileSync(path.join(played.artifactDir, 'match.json'), 'utf-8')
  );

  assertEqual(replay.frames.length, match.rounds.length, '帧数应等于 MatchLog 回合数');
  for (let i = 0; i < replay.frames.length; i++) {
    assertEqual(
      replay.frames[i].roundStateHash,
      match.rounds[i].roundStateHash,
      `第 ${i + 1} 轮 roundStateHash 必须一致`
    );
    assertEqual(
      replay.frames[i].publicStateHash,
      match.rounds[i].publicStateHash,
      `第 ${i + 1} 轮 publicStateHash 必须一致`
    );
    assertEqual(
      replay.frames[i].revealStateHash,
      match.rounds[i].revealStateHash,
      `第 ${i + 1} 轮 revealStateHash 必须一致`
    );
    assertEqual(replay.frames[i].killed.length, match.rounds[i].aKills + match.rounds[i].bKills, '击杀数必须一致');
    assertEqual(replay.frames[i].firstSolver, match.rounds[i].firstSolver, '先手必须一致');
    if (i > 0) {
      const prev = replay.frames[i - 1].aliveAfter.map((p) => p.id).sort();
      const cur = replay.frames[i].aliveBefore.map((p) => p.id).sort();
      assertEqual(cur, prev, `第 ${i + 1} 轮的开局存活点必须等于第 ${i} 轮的结算结果`);
    }
  }
  // 规则修订 §8 之后，「同归于尽」是可达的收场：先手清零对方、后手凭已锁定的
  // 攻击权再清零先手方 → draw。旧断言隐含假设「比赛只会以单方全灭结束」，
  // 按规则修订 §18 归类为 obsolete due to authorized rule change。
  const last = replay.frames[replay.frames.length - 1].aliveAfter;
  const aliveA = last.filter((p) => p.team === 'A').length;
  const aliveB = last.filter((p) => p.team === 'B').length;
  assert(aliveA === 0 || aliveB === 0, '比赛必须在某一方（或双方）全灭时结束');
  if (replay.winner === 'draw') {
    assertEqual([aliveA, aliveB], [0, 0], '平局只可能来自同归于尽 —— 双方都必须归零');
  } else {
    const winnerAlive = replay.winner === 'A' ? aliveA : aliveB;
    const loserAlive = replay.winner === 'A' ? aliveB : aliveA;
    assert(winnerAlive > 0 && loserAlive === 0, '非平局时：胜方有存活点、败方全灭');
  }
});

test('replay: 回放文件不含任何可执行入口或沙箱路径', async () => {
  const played = await playAndPersist('REPLAY-NOEXEC', 550033);
  const raw = fs.readFileSync(path.join(played.artifactDir, 'replay.json'), 'utf-8');
  for (const needle of ['solver.py', 'manifest.json', '__gb_bootstrap', '__gb_profile', 'sandboxes']) {
    assert(!raw.includes(needle), `回放不得包含 ${needle}（否则回放可能重跑算法）`);
  }
  // 但必须保留可视化所需的函数表达式
  const replay: Replay = JSON.parse(raw);
  for (const frame of replay.frames) {
    assert(frame.functionMathA || frame.functionMathB, '回放应保留函数表达式用于展示');
  }
});

test('replay: 审计日志完整且单调', async () => {
  const played = await playAndPersist('REPLAY-AUDIT', 440044);
  const audit: AuditLog = JSON.parse(
    fs.readFileSync(path.join(played.artifactDir, 'audit.json'), 'utf-8')
  );
  const types = audit.events.map((e) => e.type);
  for (const required of ['MatchCreated', 'PackageSealed', 'RoundComputeStart', 'MatchEnded']) {
    assert(types.includes(required), `审计日志必须包含 ${required}，实际 ${types.join(',')}`);
  }
  // seq 必须严格递增，时间戳必须可解析
  for (let i = 1; i < audit.events.length; i++) {
    assert(audit.events[i].seq > audit.events[i - 1].seq, 'seq 必须严格递增');
  }
  for (const e of audit.events) {
    assert(!Number.isNaN(Date.parse(e.at)), `时间戳必须可解析: ${e.at}`);
  }
});

test('replay: 末帧的 endReason 必须反映四类终局，不得恒为 NONE（P0-2 回归）', async () => {
  // 帧是在终局判定**之前** push 的，所以末帧的 endReason 曾经恒为 'NONE'：
  // 顶层 replay/match 都是对的，但任何按帧渲染的下游（终端 `--replay`、
  // 观众屏逐帧回放）永远不会显示 STALEMATE / HARD_ROUND_LIMIT 横幅。
  // 契约见 `src/core/Logs.ts` 的 `ReplayFrame.endReason`。
  const root = tmpDir('replay-lastframe');
  const engine = new MatchEngine({
    matchId: 'REPLAY-LASTFRAME',
    seed: 660066,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', ALGO_A).ok, '上传 A 应成功');
  assert(engine.upload('B', ALGO_B).ok, '上传 B 应成功');
  assert((await engine.preflight()).ok, 'preflight 应通过');
  assert(engine.startMatch().ok, '开始比赛应成功');

  let rounds = 0;
  while (engine.endReason() === 'NONE') {
    assert(engine.judgeStartRound().ok, 'START ROUND 应成功');
    await engine.runRound();
    assert(++rounds <= 60, `比赛必须自行终止，实际跑了 ${rounds} 轮`);
  }

  const replay: Replay = engine.getReplay();
  assert(replay.frames.length > 0, '回放必须有帧');

  const last = replay.frames[replay.frames.length - 1];
  const TERMINAL = ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'];
  assert(TERMINAL.includes(replay.endReason), `顶层必须是四类终局之一，实际 ${replay.endReason}`);
  assertEqual(last.endReason, replay.endReason, '末帧的 endReason 必须与顶层一致');
  assert(TERMINAL.includes(last.endReason), `末帧必须记下一次正常终结，实际 ${last.endReason}`);

  // 反向对照：非末帧必须仍然如实表示「比赛还在继续」——
  // 否则「把每一帧都写成终局」这种退化也会让上面那条断言变绿。
  for (const f of replay.frames.slice(0, -1)) {
    assertEqual(f.endReason, 'NONE', `第 ${f.round} 帧不是末帧，endReason 必须是 NONE`);
  }
});

void runAll('replay');
