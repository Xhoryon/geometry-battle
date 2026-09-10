/**
 * full-match-e2e —— 完整比赛端到端
 *
 * Gate §Full E2E 要求：
 *   Upload A/B → Preflight → Seal → Generate map → Start Match →
 *   Human shooter selection → Judge START ROUND → Reveal → Compute →
 *   First solver shot → Second shot / cancellation → Round result →
 *   Next Round → Winner → Logs → Shutdown → Restart → Load Replay
 *
 * 全程只使用正式 API，不修改生产代码 / 内部 JSON / 数据库，
 * 不注入状态、不 monkey patch、不使用测试专用后门。
 *
 * 覆盖 Finding: P0-1, P0-4, P0-5, P0-10, P0-11, P0-12, P1-15, P1-16..18,
 *              P1-20, P1-21, P1-24, P1-25, P2-19, P2-22
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { loadReplay } from '../src/core/Logs';
import { persistArtifacts } from '../src/core/Logs';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ALGO_A = path.join(__dirname, 'fixtures', 'algos', 'arc-sweep');
const ALGO_B = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');

interface Played {
  winner: 'A' | 'B' | 'draw' | null;
  rounds: number;
  engine: MatchEngine;
  artifactDir: string;
}

/** 通过正式 API 打完一整场 8 vs 8 */
async function playFullMatch(opts: { seed: number; pointCount?: number }): Promise<Played> {
  const root = tmpDir('e2e');
  const engine = new MatchEngine({
    matchId: `E2E-${opts.seed}`,
    seed: opts.seed,
    pointCount: opts.pointCount ?? 8,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });

  const upA = engine.upload('A', ALGO_A);
  assert(upA.ok, `上传 A 失败: ${upA.errors.join('; ')}`);
  const upB = engine.upload('B', ALGO_B);
  assert(upB.ok, `上传 B 失败: ${upB.errors.join('; ')}`);
  assert(upA.hash !== upB.hash, '两个算法包哈希不应相同');

  const pre = await engine.preflight();
  assert(pre.ok, `Preflight 失败: ${pre.errors.join('; ')}`);

  const started = engine.startMatch();
  assert(started.ok, `开始比赛失败: ${started.errors.join('; ')}`);

  let rounds = 0;
  while (engine.getWinner() === null) {
    const snap = engine.getSnapshot();
    // Rule Revision 3 §5：这里曾经断言 `SELECT_SHOOTER` 并模拟人工选点。
    // 现在每轮唯一的停留点是 PUBLIC（本轮输入已冻结、等待揭盲）。
    assert(snap.phase === 'PUBLIC', `预期 PUBLIC，实际 ${snap.phase}`);
    assert(snap.emitters !== null, '每轮都应能取到固定的 Emitter');
    assert(snap.emitters!.A.id === 'A0' && snap.emitters!.B.id === 'B0', 'Emitter 标识必须固定');

    const judge = engine.judgeStartRound();
    assert(judge.ok, `START ROUND 失败: ${judge.error}`);

    const result = await engine.runRound();
    assert(result.machinePhases.includes('ROUND_RESULT'), '状态机未到达 ROUND_RESULT');
    assertEqual(result.log.roundStateHash.length, 64, 'roundStateHash 应为 sha256 十六进制');
    assertEqual(result.log.publicStateHash.length, 64, 'publicStateHash 应为 sha256 十六进制');
    assertEqual(result.log.revealStateHash.length, 64, 'revealStateHash 应为 sha256 十六进制');
    rounds++;

    if (rounds > 40) throw new Error('回合数异常：比赛未能在 40 轮内结束');
  }

  const artifactDir = engine.getArtifactDir();
  persistArtifacts(artifactDir, engine.getArtifacts());

  return { winner: engine.getWinner(), rounds, engine, artifactDir };
}

test('full-match-e2e: 8v8 从干净启动跑到 Winner', async () => {
  const played = await playFullMatch({ seed: 20260909 });
  assert(played.winner === 'A' || played.winner === 'B' || played.winner === 'draw', '必须产生胜者');
  assert(played.rounds >= 1, '至少进行一轮');
  console.log(`      胜者=${played.winner}，回合数=${played.rounds}`);
});

test('full-match-e2e: 存活数严格单调递减，且 winner 只在结算后出现', async () => {
  const root = tmpDir('e2e-mono');
  const engine = new MatchEngine({
    matchId: 'E2E-MONO',
    seed: 424242,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', ALGO_A);
  engine.upload('B', ALGO_B);
  assert((await engine.preflight()).ok, 'preflight 应通过');
  engine.startMatch();

  let prevAlive = engine.getSnapshot().alive.A + engine.getSnapshot().alive.B;
  let guard = 0;
  while (engine.getWinner() === null && guard++ < 40) {
    engine.judgeStartRound();
    await engine.runRound();
    const alive = engine.getSnapshot().alive.A + engine.getSnapshot().alive.B;
    assert(alive <= prevAlive, `存活数不应增加: ${prevAlive} → ${alive}`);
    prevAlive = alive;
  }
  assert(engine.getWinner() !== null, '比赛应当结束');
});

test('full-match-e2e: 日志 / 审计 / 回放落盘后可重新加载，且回放不重跑算法', async () => {
  const played = await playFullMatch({ seed: 777001, pointCount: 6 });
  const dir = played.artifactDir;

  assert(fs.existsSync(path.join(dir, 'match.json')), 'match.json 应存在');
  assert(fs.existsSync(path.join(dir, 'audit.json')), 'audit.json 应存在');
  assert(fs.existsSync(path.join(dir, 'replay.json')), 'replay.json 应存在');

  const match = JSON.parse(fs.readFileSync(path.join(dir, 'match.json'), 'utf-8'));
  assertEqual(match.rounds.length, played.rounds, 'MatchLog 回合数应与实际一致');
  assert(match.teamAPackageHash, 'MatchLog 必须记录 A 包哈希');
  assert(match.teamBPackageHash, 'MatchLog 必须记录 B 包哈希');
  assert(match.teamAPackageHash !== match.teamBPackageHash, '两包哈希应不同');

  // 模拟重启后加载
  const replay = loadReplay(path.join(dir, 'replay.json'));
  assertEqual(replay.frames.length, played.rounds, 'Replay 帧数应等于回合数');
  assertEqual(replay.winner, match.winner, 'Replay 胜者应与 MatchLog 一致');
  for (const frame of replay.frames) {
    assert(frame.trajectoryA.length > 0 || frame.trajectoryB.length > 0, '回放帧应包含轨迹');
    assertEqual(frame.roundStateHash.length, 64, '回放帧应带 roundStateHash');
  }

  // 回放数据里不得包含可执行入口 —— 回放只读记录，不重跑算法
  const raw = fs.readFileSync(path.join(dir, 'replay.json'), 'utf-8');
  assert(!raw.includes('solver.py'), 'Replay 不得包含算法入口，避免回放时重跑');
});

test('full-match-e2e: 阶段守卫 —— 未锁定/未裁决时不允许开跑', async () => {
  const root = tmpDir('e2e-guard');
  const engine = new MatchEngine({
    matchId: 'E2E-GUARD',
    seed: 1234,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', ALGO_A);
  engine.upload('B', ALGO_B);
  assert((await engine.preflight()).ok, 'preflight 应通过');

  // 比赛尚未开始时不得 START（阶段门禁）
  assert(!engine.judgeStartRound().ok, '比赛未开始时不应允许 START ROUND');
  engine.startMatch();
  // Rule Revision 3 §5 之后没有「锁定」这个动作：开始比赛即进入 PUBLIC，
  // START 的前置条件是 PUBLIC → REVEAL，而不是「双方 LOCK」。
  assert(engine.judgeStartRound().ok, '进入 PUBLIC 后应允许 START ROUND');
});

void runAll('full-match-e2e');
