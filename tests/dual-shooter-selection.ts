/**
 * dual-shooter-selection —— 双方 Shooter 选择 / 锁定 / 死点保护
 *
 * 覆盖 Finding: P0-1（硬编码空 DSL）、P0-12（未锁定即可开局）、
 *              P2-19（死点仍可被选）、P2-16~18（非法阶段转换）
 */

import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ALGO_A = path.join(__dirname, 'fixtures', 'algos', 'precision-line');
const ALGO_B = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');

async function readyEngine(matchId: string): Promise<MatchEngine> {
  const root = tmpDir('dual');
  const engine = new MatchEngine({
    matchId,
    seed: 31337,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', ALGO_A);
  engine.upload('B', ALGO_B);
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  engine.startMatch();
  return engine;
}

test('dual-shooter-selection: 不能替对方选点，不能选非本队点', async () => {
  const engine = await readyEngine('DUAL-1');
  assert(!engine.selectShooter('A', 'B1').ok, 'A 不应能选择 B 的点');
  assert(!engine.selectShooter('A', 'NOPE').ok, '不存在的点必须被拒绝');
  assert(engine.selectShooter('A', 'A1').ok, 'A 选择自己的点应成功');
  assert(!engine.selectShooter('A', 'A2').ok, '同一轮不能重复选择');
});

test('dual-shooter-selection: 锁定后不可修改', async () => {
  const engine = await readyEngine('DUAL-2');
  assert(engine.selectShooter('A', 'A1').ok, '选择应成功');
  assert(engine.lockShooter('A').ok, '锁定应成功');
  assert(!engine.selectShooter('A', 'A2').ok, '锁定后不得再改选');
  assert(!engine.lockShooter('A').ok, '重复锁定应被拒绝');
  assert(!engine.lockShooter('B').ok, 'B 未选点不能锁定');
});

test('dual-shooter-selection: 双方都锁定后才允许 START ROUND', async () => {
  const engine = await readyEngine('DUAL-3');
  assert(!engine.judgeStartRound().ok, '未选点时不能开局');
  engine.selectShooter('A', 'A1');
  engine.lockShooter('A');
  assert(!engine.judgeStartRound().ok, '只有一方锁定时不能开局');
  engine.selectShooter('B', 'B1');
  engine.lockShooter('B');
  assertEqual(engine.getSnapshot().phase, 'LOCKED', '双方锁定后、START 前阶段应为 LOCKED');
  assert(engine.judgeStartRound().ok, '双方锁定后应允许开局');
  // V1.1：START 是真实门禁 —— 揭盲发生在 START 之前，START 之后才进入 COUNTDOWN
  assertEqual(engine.getSnapshot().phase, 'COUNTDOWN', 'START 之后阶段应为 COUNTDOWN');
});

test('dual-shooter-selection: 死点不可被选为 Shooter', async () => {
  const engine = await readyEngine('DUAL-4');
  // 先打完一轮，让某一方出现死亡点
  let guard = 0;
  while (engine.getSnapshot().rounds.length === 0 && guard++ < 40) {
    const snap = engine.getSnapshot();
    for (const team of ['A', 'B'] as const) {
      const pick = snap.points.find((p) => p.team === team && p.alive)!;
      engine.selectShooter(team, pick.id);
      engine.lockShooter(team);
    }
    engine.judgeStartRound();
    await engine.runRound();
  }

  const snap = engine.getSnapshot();
  const dead = snap.points.find((p) => !p.alive);
  assert(dead, '一轮之后应出现死亡点（否则本测试无意义）');

  if (engine.getWinner() === null) {
    const r = engine.selectShooter(dead.team, dead.id);
    assert(!r.ok, `死点 ${dead.id} 不应能被选为 Shooter`);
  }
});

test('dual-shooter-selection: 选择状态在每轮开始时重置', async () => {
  const engine = await readyEngine('DUAL-5');
  const snap0 = engine.getSnapshot();
  for (const team of ['A', 'B'] as const) {
    const pick = snap0.points.find((p) => p.team === team && p.alive)!;
    engine.selectShooter(team, pick.id);
    engine.lockShooter(team);
  }
  engine.judgeStartRound();
  await engine.runRound();

  const after = engine.getSnapshot();
  if (after.phase !== 'MATCH_END') {
    assertEqual(after.shooters.A, null, '新一轮开始时 A 的 Shooter 应被清空');
    assertEqual(after.shooters.B, null, '新一轮开始时 B 的 Shooter 应被清空');
    assertEqual(after.locked.A, false, '新一轮开始时 A 应回到未锁定');
    assertEqual(after.locked.B, false, '新一轮开始时 B 应回到未锁定');
  }
});

void runAll('dual-shooter-selection');
