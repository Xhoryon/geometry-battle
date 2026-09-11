/**
 * obstacle-block —— 障碍物阻挡（Plan V1 §21/§22）
 *
 * 覆盖 Finding: P0-9（executeShots 不检查障碍物）、
 *              P1-7（圆形/多边形障碍物永不阻挡）、
 *              P1-27（攻击方向约束）、P2-24（命中结果来自真实轨迹）
 *
 * 规则：轨迹在第一次与障碍物接触处终止；接触点之前的点可被击杀，
 *       接触点及其之后的点不受影响；多个障碍物取传播方向上最早接触者。
 */

import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { judgeShot, traceTrajectory } from '../src/core/Judge';
import { Obstacle } from '../src/obstacle/Obstacle';
import { assert, assertClose, assertEqual, runAll, test } from './harness';

function ast(node: unknown): CanonicalNode {
  const r = parseCanonicalDSL(node);
  assert(r.ok && r.ast, `AST 必须合法: ${r.issues.map((i) => i.code).join('; ')}`);
  return r.ast!;
}

/** f(x) = 0 —— 水平直线，经过任意 (x, 0) 的 shooter */
const FLAT = ast({
  type: 'add',
  args: [
    { type: 'number', value: 0 },
    { type: 'mul', args: [{ type: 'number', value: 0 }, { type: 'variable', value: 'x' }] },
  ],
});

/** f(x) = y0 + m*(x - x0) */
function line(x0: number, y0: number, m: number): CanonicalNode {
  return ast({
    type: 'add',
    args: [
      { type: 'number', value: y0 },
      {
        type: 'mul',
        args: [
          { type: 'number', value: m },
          { type: 'sub', args: [{ type: 'variable', value: 'x' }, { type: 'number', value: x0 }] },
        ],
      },
    ],
  });
}

const RECT: Obstacle = { type: 'rectangle', xmin: 0, xmax: 5, ymin: -1, ymax: 1 };
const CIRCLE: Obstacle = { type: 'circle', center: [0, 0], radius: 2 };

test('obstacle-block: 矩形阻挡后，接触点之后的点不被命中', () => {
  const outcome = judgeShot(
    FLAT,
    { x: -10, y: 0 },
    'A',
    [
      { id: 'BEFORE', position: { x: -2, y: 0 } },
      { id: 'AFTER', position: { x: 3, y: 0 } },
    ],
    [RECT]
  );
  assertEqual(outcome.endReason, 'OBSTACLE', '轨迹应在障碍物处终止');
  assert(outcome.blocked, '必须记录阻挡信息');
  assertClose(outcome.blocked!.at.x, 0, 1e-9, '首次接触应在矩形近端 x=0');
  assert(outcome.hits.includes('BEFORE'), '接触点之前的点应被命中');
  assert(!outcome.hits.includes('AFTER'), '接触点之后的点不应被命中');
  assertClose(outcome.trajectory[outcome.trajectory.length - 1].x, 0, 1e-9, '轨迹末点应为接触点');
});

test('obstacle-block: 圆形阻挡（P1-7）', () => {
  const outcome = judgeShot(
    FLAT,
    { x: -10, y: 0 },
    'A',
    [
      { id: 'BEFORE', position: { x: -3, y: 0 } },
      { id: 'AFTER', position: { x: 3, y: 0 } },
    ],
    [CIRCLE]
  );
  assertEqual(outcome.endReason, 'OBSTACLE', '圆形障碍物必须阻挡');
  assert(outcome.blocked, '必须记录阻挡信息');
  assertClose(outcome.blocked!.at.x, -2, 1e-6, '首次接触应在圆的左端 x=-2');
  assert(outcome.hits.includes('BEFORE'), '圆之前的点应被命中');
  assert(!outcome.hits.includes('AFTER'), '圆之后的点不应被命中');
});

test('obstacle-block: 多个障碍物取传播方向上最早接触者', () => {
  const far: Obstacle = { type: 'rectangle', xmin: 4, xmax: 8, ymin: -1, ymax: 1 };
  const near: Obstacle = { type: 'circle', center: [-1, 0], radius: 1 };
  // 传入顺序为 [far, near]，结论必须是 near
  const outcome = judgeShot(FLAT, { x: -10, y: 0 }, 'A', [{ id: 'X', position: { x: 6, y: 0 } }], [far, near]);
  assert(outcome.blocked, '必须记录阻挡信息');
  assertClose(outcome.blocked!.at.x, -2, 1e-6, '应取最早接触的障碍物（圆）');
  assertEqual(outcome.hits.length, 0, '两次接触之间的点不应被命中');
});

test('obstacle-block: B 方向（-x）同样被阻挡', () => {
  const outcome = judgeShot(
    FLAT,
    { x: 10, y: 0 },
    'B',
    [
      { id: 'BEFORE', position: { x: 7, y: 0 } },
      { id: 'AFTER', position: { x: 2, y: 0 } },
    ],
    [RECT]
  );
  assertEqual(outcome.endReason, 'OBSTACLE', 'B 方向也应被阻挡');
  assertClose(outcome.blocked!.at.x, 5, 1e-9, 'B 方向首次接触应在矩形远端 x=5');
  assert(outcome.hits.includes('BEFORE'), 'B 方向接触前的点应被命中');
  assert(!outcome.hits.includes('AFTER'), 'B 方向接触后的点不应被命中');
});

test('obstacle-block: 线段障碍物（零厚度需要接触阈值）', () => {
  const seg: Obstacle = { type: 'segment', x1: 0, y1: -1, x2: 0, y2: 1 };
  const outcome = judgeShot(FLAT, { x: -10, y: 0 }, 'A', [{ id: 'AFTER', position: { x: 3, y: 0 } }], [seg]);
  assertEqual(outcome.endReason, 'OBSTACLE', '线段必须能阻挡（P1-7）');
  assert(!outcome.hits.includes('AFTER'), '线段之后的点不应被命中');
});

test('obstacle-block: 多边形障碍物（内部判定）', () => {
  const poly: Obstacle = {
    type: 'polygon',
    vertices: [
      [0, -2],
      [4, -2],
      [4, 2],
      [0, 2],
    ],
  };
  const outcome = judgeShot(FLAT, { x: -10, y: 0 }, 'A', [{ id: 'AFTER', position: { x: 3, y: 0 } }], [poly]);
  assertEqual(outcome.endReason, 'OBSTACLE', '多边形必须能阻挡');
  assert(!outcome.hits.includes('AFTER'), '多边形内部的点不应被命中');
});

test('obstacle-block: 无障碍物时到达场地边界', () => {
  const { endReason } = traceTrajectory(FLAT, { x: -10, y: 0 }, 'A', []);
  assertEqual(endReason, 'FIELD_EDGE', '无障碍物应到达场地边界');
});

test('obstacle-block: 越出场地后立即截断，不误杀场地外的点', () => {
  const steep = line(-10, 0, 3); // 在 x=-6 处 y=12，越界
  const outcome = judgeShot(steep, { x: -10, y: 0 }, 'A', [{ id: 'OUT', position: { x: 10, y: 60 } }], []);
  assertEqual(outcome.endReason, 'OUT_OF_FIELD', '越界应截断');
  assert(!outcome.hits.includes('OUT'), '场地外的点不应被命中');
});

test('obstacle-block: 从障碍物内部出发的轨迹在起点即被阻挡', () => {
  // shooter 位于圆内 → penetration = 0 → 首次接触即起点
  const outcome = judgeShot(FLAT, { x: 0, y: 0 }, 'A', [{ id: 'ANY', position: { x: 3, y: 0 } }], [CIRCLE]);
  assert(outcome.blocked, '起点在障碍物内应判定为被阻挡');
  assertEqual(outcome.hits.length, 0, '被阻挡时不应产生命中');
});

void runAll('obstacle-block');
