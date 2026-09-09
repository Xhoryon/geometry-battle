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
import { MatchEngine } from '../src/core/Match';
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
