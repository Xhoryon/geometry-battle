/**
 * shooter-cancel —— Shooter 淘汰与攻击取消
 *
 * 覆盖 Finding: P0-11（Shooter 淘汰/攻击取消未实现）、
 *              P1-15（「先解者优先」无副作用）、P1-21（B 先开火时判定错误）、
 *              P1-27（方向约束）
 */

import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { judgeShot } from '../src/core/Judge';
import { MatchEngine, PointState, resolveOrderedShots } from '../src/core/Match';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const SNIPER = path.join(__dirname, 'fixtures', 'algos', 'sniper');
const SLOW_SNIPER = path.join(__dirname, 'fixtures', 'algos', 'slow-sniper');

function lineAst(from: { x: number; y: number }, to: { x: number; y: number }): CanonicalNode {
  const dx = to.x - from.x;
  const m = Math.abs(dx) < 1e-9 ? 0 : (to.y - from.y) / dx;
  const node = {
    type: 'add',
    args: [
      { type: 'number', value: from.y },
      {
        type: 'mul',
        args: [
          { type: 'number', value: m },
          { type: 'sub', args: [{ type: 'variable', value: 'x' }, { type: 'number', value: from.x }] },
        ],
      },
    ],
  };
  const r = parseCanonicalDSL(node);
  assert(r.ok && r.ast, '构造的直线 AST 必须合法');
  return r.ast!;
}

/** 找一个「A1 到 B1 的直线不被障碍物阻挡」的种子 */
function findClearSeed(pointCount = 6): { seed: number; a: any; b: any; obstacles: any[] } {
  for (let seed = 1; seed < 4000; seed++) {
    const map = generateMapOrNull({ seed, pointCount, difficulty: 'easy' });
    if (!map) continue;
    const a = map.teamA[0];
    const b = map.teamB[0];
    const ast = lineAst(a, b);
    const outcome = judgeShot(ast, a, 'A', [{ id: 'B1', position: b }], map.obstacles);
    if (outcome.hits.includes('B1') && !outcome.blocked) {
      return { seed, a, b, obstacles: map.obstacles };
    }
  }
  throw new Error('未能找到 A1→B1 直线畅通的种子');
}

async function playOneRound(
  matchId: string,
  seed: number,
  algoA: string,
  algoB: string
): Promise<{ engine: MatchEngine; result: Awaited<ReturnType<MatchEngine['runRound']>> }> {
  const root = tmpDir('cancel');
  const engine = new MatchEngine({
    matchId,
    seed,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', algoA);
  engine.upload('B', algoB);
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  engine.startMatch();

  assert(engine.selectShooter('A', 'A1').ok, 'A1 应可被选中');
  assert(engine.lockShooter('A').ok, 'A 应可锁定');
  assert(engine.selectShooter('B', 'B1').ok, 'B1 应可被选中');
  assert(engine.lockShooter('B').ok, 'B 应可锁定');
  assert(engine.judgeStartRound().ok, '应可 START ROUND');

  const result = await engine.runRound();
  return { engine, result };
}

test('shooter-cancel: 先解者击杀对方 Shooter → 对方攻击被取消', async () => {
  const clear = findClearSeed();
  const { result } = await playOneRound('CANCEL-A-FIRST', clear.seed, SNIPER, SLOW_SNIPER);

  assertEqual(result.firstSolver, 'A', 'A 应立即求解，成为先手');
  assert(result.hits.A.includes('B1'), `A 的轨迹应命中 B1，实际 [${result.hits.A.join(',')}]`);
  assertEqual(result.cancelled.B, true, 'B 的攻击必须被取消');
  assertEqual(result.hits.B.length, 0, '被取消的一方不得产生命中');
  assertEqual(result.computeTimeMs.B, null, '被取消的一方不应有有效耗时');
  assert(result.killed.includes('B1'), 'B1 应被击杀');
  assertEqual(result.log.bHits.length, 0, '日志中 B 的命中应为空');
  assertEqual(result.log.cancelledB, true, '日志应记录 B 被取消');
});

test('shooter-cancel: 交换顺序后同样成立（不存在顺序偏置）', async () => {
  const clear = findClearSeed();
  const { result } = await playOneRound('CANCEL-B-FIRST', clear.seed, SLOW_SNIPER, SNIPER);

  assertEqual(result.firstSolver, 'B', 'B 应立即求解，成为先手');
  assert(result.hits.B.includes('A1'), `B 的轨迹应命中 A1，实际 [${result.hits.B.join(',')}]`);
  assertEqual(result.cancelled.A, true, 'A 的攻击必须被取消');
  assertEqual(result.hits.A.length, 0, '被取消的一方不得产生命中');
  assert(result.killed.includes('A1'), 'A1 应被击杀');
});

test('shooter-cancel: 已死亡的 Shooter 无法继续攻击', async () => {
  const clear = findClearSeed();
  const root = tmpDir('cancel-dead');
  const engine = new MatchEngine({
    matchId: 'CANCEL-DEAD',
    seed: clear.seed,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', SNIPER);
  engine.upload('B', SLOW_SNIPER);
  assert((await engine.preflight()).ok, 'preflight 应通过');
  engine.startMatch();

  engine.selectShooter('A', 'A1');
  engine.lockShooter('A');
  engine.selectShooter('B', 'B1');
  engine.lockShooter('B');
  engine.judgeStartRound();
  await engine.runRound();

  const snap = engine.getSnapshot();
  const b1 = snap.points.find((p) => p.id === 'B1');
  assert(b1 && !b1.alive, 'B1 应已被击杀');
  if (snap.phase !== 'MATCH_END') {
    const r = engine.selectShooter('B', 'B1');
    assert(!r.ok, '已死亡的 B1 不应能被再次选为 Shooter');
  }
});

test('shooter-cancel: 先手击杀后，后手的射击守卫可达（P2-B 回归）', () => {
  // 结构性单测：结算循环内「Shooter 已死 → 跳过该方射击」的守卫必须真的可达。
  // 早期实现把守卫放在循环内、把 markDead 放在循环之后，守卫恒为真，
  // 后手照样开火，取消只能靠外部 kill —— 本用例锁死这个语义。
  const mk = (id: string, team: 'A' | 'B', x: number, y: number): PointState => ({
    id,
    team,
    position: { x, y },
    alive: true,
  });
  const points = [mk('A1', 'A', -10, 0), mk('B1', 'B', 10, 0), mk('B2', 'B', 15, 5)];
  const shooters = { A: points[0], B: points[1] };
  // A 的水平线只命中 B1（B2 在 y=5，不在轨迹上）
  const astA = lineAst({ x: -10, y: 0 }, { x: 10, y: 0 });
  const astB = lineAst({ x: 10, y: 0 }, { x: -10, y: 0 });
  const cancelled = { A: false, B: false };
  const cancelledEvents: string[] = [];

  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points,
    shooters,
    ast: { A: astA, B: astB },
    obstacles: [],
    cancelled,
    onCancelled: (team) => cancelledEvents.push(team),
  });

  assert(r.shots.A !== null, '先手方必须完成射击');
  assertEqual(r.shots.B, null, '后手方 Shooter 已被击杀 —— 其射击必须被跳过，而不是照常开火');
  assertEqual(cancelled.B, true, '后手方必须被标记为取消');
  assertEqual(cancelledEvents, ['B'], '必须发出一次取消事件');
  assert(r.killed.includes('B1'), 'B1 应被击杀');
  assertEqual(points.find((p) => p.id === 'B1')!.alive, false, 'B1 的 alive 必须被置为 false');
  assertEqual(points.find((p) => p.id === 'B2')!.alive, true, 'B2 不应被误杀');

  // 对照组：B 的 Shooter 存活时，守卫不得误伤（双方都开火）。
  // A 改用一条陡峭、打不中任何人的轨迹，确保 B1 存活。
  const points2 = [mk('A1', 'A', -10, 0), mk('B1', 'B', 10, 0), mk('B2', 'B', 15, 5)];
  const r2 = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points: points2,
    shooters: { A: points2[0], B: points2[1] },
    ast: { A: lineAst({ x: -10, y: 0 }, { x: -9, y: 10 }), B: astB },
    obstacles: [],
    cancelled: { A: false, B: false },
  });
  assert(r2.shots.A !== null && r2.shots.A.killed.length === 0, '前提：A 的对照轨迹不应命中任何人');
  assert(r2.shots.B !== null, 'B1 存活时 B 必须开火（守卫不得误伤）');
});

test('shooter-cancel: 并列先手时双方基于同一快照同时开火（P2-B 回归）', () => {
  const mk = (id: string, team: 'A' | 'B', x: number, y: number): PointState => ({
    id,
    team,
    position: { x, y },
    alive: true,
  });
  const points = [mk('A1', 'A', -10, 0), mk('B1', 'B', 10, 0)];
  const cancelled = { A: false, B: false };
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: true,
    points,
    shooters: { A: points[0], B: points[1] },
    ast: {
      A: lineAst({ x: -10, y: 0 }, { x: 10, y: 0 }),
      B: lineAst({ x: 10, y: 0 }, { x: -10, y: 0 }),
    },
    obstacles: [],
    cancelled,
  });
  // 双方互相命中：并列先手时不得因为「先结算的一方已把对方打死」而取消另一方
  assert(r.shots.A !== null && r.shots.B !== null, '并列先手时双方都必须开火');
  assertEqual(cancelled, { A: false, B: false }, '并列先手不得产生取消');
  assert(r.killed.includes('A1') && r.killed.includes('B1'), '双方都应被击杀');
});

test('shooter-cancel: 取消的回合结果独立编码，不与 INVALID 混用（P2-A 回归）', async () => {
  const clear = findClearSeed();
  const { result } = await playOneRound('CANCEL-RESULT-CODE', clear.seed, SNIPER, SLOW_SNIPER);
  assertEqual(result.cancelled.B, true, '前提：B 的攻击应被取消');
  assertEqual(
    result.log.result,
    'CANCELLED_B',
    '取消必须有自己的回合结果码，而不是被记成 INVALID_B'
  );
  assert(result.log.result !== 'INVALID_B', '取消 ≠ 算法非法，不得混用同一个结果码');
  assertEqual(result.log.cancelledB, true, '日志必须独立记录 cancelledB');
});

test('shooter-cancel: 反向攻击不会命中自己后方的敌人', () => {
  // A 向 +x 射击；位于 A 左侧的敌点不应被命中（P1-27）
  const ast = lineAst({ x: -10, y: 0 }, { x: 10, y: 0 });
  const outcome = judgeShot(
    ast,
    { x: -10, y: 0 },
    'A',
    [
      { id: 'BEHIND', position: { x: -15, y: 0 } },
      { id: 'AHEAD', position: { x: 5, y: 0 } },
    ],
    []
  );
  assert(outcome.hits.includes('AHEAD'), '正前方的敌人应被命中');
  assert(!outcome.hits.includes('BEHIND'), '身后的敌人不应被命中');
});

void runAll('shooter-cancel');
