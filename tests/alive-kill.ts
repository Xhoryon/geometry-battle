/**
 * alive-kill —— 命中判定与存活数递减
 *
 * 覆盖 Finding: P0-4（存活数从不递减）、P0-9（命中容差不一致）、
 *              P1-9（多处硬编码不同容差）、P2-24（命中结果未落到状态）
 */

import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { judgeShot, traceTrajectory } from '../src/core/Judge';
import { HIT_EPSILON } from '../src/core/Rules';
import { MatchEngine } from '../src/core/Match';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ARC_A = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');
const ARC_B = path.join(__dirname, 'fixtures', 'algos', 'arc-sweep');

function ast(node: unknown): CanonicalNode {
  const r = parseCanonicalDSL(node);
  assert(r.ok && r.ast, 'AST 必须合法');
  return r.ast!;
}

test('alive-kill: 轨迹命中的点全部被击杀，按传播顺序返回', () => {
  const line = ast({
    type: 'add',
    args: [{ type: 'number', value: 0 }, { type: 'mul', args: [{ type: 'number', value: 0 }, { type: 'variable', value: 'x' }] }],
  });
  const outcome = judgeShot(
    line,
    { x: -10, y: 0 },
    'A',
    [
      { id: 'B2', position: { x: 8, y: 0 } },
      { id: 'B1', position: { x: 3, y: 0 } },
      { id: 'B3', position: { x: 15, y: 0 } },
      { id: 'OFF', position: { x: 9, y: 5 } },
    ],
    []
  );
  assertEqual(outcome.hits, ['B1', 'B2', 'B3'], '命中应按 x 递增顺序返回');
  assert(!outcome.hits.includes('OFF'), '不在轨迹上的点不应被命中');
});

test('alive-kill: 命中容差就是唯一的 HIT_EPSILON', () => {
  const line = ast({
    type: 'add',
    args: [{ type: 'number', value: 0 }, { type: 'mul', args: [{ type: 'number', value: 0 }, { type: 'variable', value: 'x' }] }],
  });
  const within = judgeShot(line, { x: -10, y: 0 }, 'A', [{ id: 'NEAR', position: { x: 5, y: HIT_EPSILON * 0.5 } }], []);
  assert(within.hits.includes('NEAR'), '容差内的点应被命中');

  const outside = judgeShot(line, { x: -10, y: 0 }, 'A', [{ id: 'FAR', position: { x: 5, y: 0.5 } }], []);
  assert(!outside.hits.includes('FAR'), '容差外的点不应被命中');
});

test('alive-kill: 陡峭到离开场地的轨迹会被截断（不误杀场地外）', () => {
  // f(x) = 5x + 50 → 在 x=-10 处 y=0，x=-2 处 y=40 已越界
  const steep = ast({
    type: 'add',
    args: [{ type: 'number', value: 50 }, { type: 'mul', args: [{ type: 'number', value: 5 }, { type: 'variable', value: 'x' }] }],
  });
  const { endReason, points } = traceTrajectory(steep, { x: -10, y: 0 }, 'A', []);
  assertEqual(endReason, 'OUT_OF_FIELD', '越界轨迹应被标记 OUT_OF_FIELD');
  assert(points.length > 0, '应记录部分轨迹');

  const outcome = judgeShot(steep, { x: -10, y: 0 }, 'A', [{ id: 'HIGH', position: { x: 15, y: 40 } }], []);
  assert(!outcome.hits.includes('HIGH'), '越界之后的点不应被命中');
});

test('alive-kill: MatchEngine 中存活数严格递减且只作用于敌人', async () => {
  const root = tmpDir('alive');
  const engine = new MatchEngine({
    matchId: 'ALIVE-KILL',
    seed: 8675309,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', ARC_A);
  engine.upload('B', ARC_B);
  assert((await engine.preflight()).ok, 'preflight 应通过');
  engine.startMatch();

  const before = engine.getSnapshot();
  assertEqual(before.alive.A, 6, '开局 A 应为 6');
  assertEqual(before.alive.B, 6, '开局 B 应为 6');

  let guard = 0;
  let total = before.alive.A + before.alive.B;
  while (engine.getWinner() === null && guard++ < 30) {
    const snap = engine.getSnapshot();
    for (const team of ['A', 'B'] as const) {
      const pick = snap.points.find((p) => p.team === team && p.alive)!;
      engine.selectShooter(team, pick.id);
      engine.lockShooter(team);
    }
    engine.judgeStartRound();
    const r = await engine.runRound();

    // 命中只作用于敌人：A 的命中必须是 B 的点，B 的命中必须是 A 的点
    for (const id of r.hits.A) assert(id.startsWith('B'), `A 不得命中 ${id}`);
    for (const id of r.hits.B) assert(id.startsWith('A'), `B 不得命中 ${id}`);
    const hitIds = new Set([...r.hits.A, ...r.hits.B]);
    for (const id of r.killed) assert(hitIds.has(id), `被击杀的 ${id} 必须在命中列表里`);

    const after = engine.getSnapshot();
    assertEqual(after.alive.A, r.aliveAfter.A, '快照存活数应与回合结果一致');
    assertEqual(after.alive.B, r.aliveAfter.B, '快照存活数应与回合结果一致');
    assert(
      after.alive.A + after.alive.B < total,
      `存活总数必须严格递减（第 ${r.round} 轮：${total} → ${after.alive.A + after.alive.B}）`
    );
    total = after.alive.A + after.alive.B;
  }

  const final = engine.getSnapshot();
  assert(final.alive.A === 0 || final.alive.B === 0, '比赛结束时必有一方归零');
  assert(final.alive.A + final.alive.B < 12, '存活总数必须下降');
  assert(engine.getWinner() !== null, '必须决出胜者');
});

test('alive-kill: 击杀在整场比赛中只被应用一次', async () => {
  const root = tmpDir('alive-once');
  const engine = new MatchEngine({
    matchId: 'ALIVE-ONCE',
    seed: 20260909,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', ARC_A);
  engine.upload('B', ARC_B);
  assert((await engine.preflight()).ok, 'preflight 应通过');
  engine.startMatch();

  const seen = new Set<string>();
  let guard = 0;
  while (engine.getWinner() === null && guard++ < 40) {
    const snap = engine.getSnapshot();
    for (const team of ['A', 'B'] as const) {
      const pick = snap.points.find((p) => p.team === team && p.alive)!;
      engine.selectShooter(team, pick.id);
      engine.lockShooter(team);
    }
    engine.judgeStartRound();
    const r = await engine.runRound();
    for (const id of r.killed) {
      assert(!seen.has(id), `${id} 被重复击杀 —— 击杀必须只应用一次`);
      seen.add(id);
    }
  }
  assert(seen.size > 0, '至少应发生一次击杀');
});

void runAll('alive-kill');
