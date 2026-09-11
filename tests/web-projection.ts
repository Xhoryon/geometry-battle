/**
 * web-projection —— Web UI 投影层的**纯函数**回归
 *
 * 这里不跑比赛、不起服务、不开浏览器（那是 `web-server` 与 Playwright 演练的事）。
 * 本套件盯的是三件「不跑不知道」的事：
 *
 *   1. **观众板是白名单** —— 键集合被钉死，任何新增字段都必须显式写进本文件的
 *      允许清单才会通过。这是「大屏不泄漏开发者诊断」的结构性守卫。
 *   2. **摘要的变更检测** —— ticker 靠它决定推不推 board；漏掉一个可见变化，
 *      现场就会看到画面不动。
 *   3. **投影与揭示的语义** —— 必须与终端 `ArenaView` 同一条规则，
 *      否则同一场比赛在终端与浏览器里画出来不一样。
 */

import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { FIELD } from '../src/core/Rules';
import { downsampleTrajectory } from '../src/ui/TrajectoryAnimator';
import { TRAJECTORY_MAX_POINTS, isTopic } from '../src/server/protocol';
import { snapshotDigest, spectatorBoard } from '../src/server/boards';
import {
  obstacleToDrawable,
  projectPoint,
  projectRadius,
  projectX,
  projectY,
  ratioAt,
  revealedPoints,
} from '../web/src/arena/projection';
import { assert, assertClose, assertEqual, runAll, test, tmpDir } from './harness';

// ============================================================================
// 允许在观众板上出现的键 —— 这是**独立于实现**的清单。
// 实现里多一个键，本测试就会红。
// ============================================================================
const ALLOWED_TOP_KEYS = [
  'alive',
  'arena',
  'computeBudgetMs',
  'computes',
  'lastRound',
  'matchId',
  'phase',
  'round',
  'trajectoryHandle',
  'verdict',
].sort();

const ALLOWED_ARENA_KEYS = ['emitters', 'field', 'obstacles', 'points'].sort();
const ALLOWED_COMPUTE_KEYS = ['errorCode', 'state', 'timeMs'].sort();
const ALLOWED_POINT_KEYS = ['alive', 'id', 'position', 'team'].sort();
const ALLOWED_HANDLE_KEYS = ['id', 'round'].sort();

/**
 * 禁用键 —— 出现在观众板里就是泄漏（哪怕是 null）。
 *
 * 注意这里查的是**键名**与**绝对路径**，不是「有没有花括号」：
 * 序列化后的 JSON 天然含 `{`，拿它当断言恒真，是假测试。
 */
const FORBIDDEN_KEYS = [
  'audit',
  'artifactDir',
  'dir',
  'hash',
  'isolation',
  'manifest',
  'packages',
  'runtime',
  'seed',
  'settings',
  'slots',
  'sourceDir',
  'stack',
  'status',
];

function collectKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) {
    for (const item of v) collectKeys(item, out);
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      out.add(k);
      collectKeys(val, out);
    }
  }
  return out;
}

function bareEngine(root: string): MatchEngine {
  return new MatchEngine({
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    slotRoot: path.join(root, 'algorithms'),
  });
}

// ============================================================================
// 1. 观众板白名单
// ============================================================================

test('观众板的顶层键就是白名单本身 —— 多一个键即失败', () => {
  const root = tmpDir('webproj');
  const engine = bareEngine(root);
  const board = spectatorBoard(engine, null);
  assertEqual(Object.keys(board).sort(), ALLOWED_TOP_KEYS, '顶层键集合必须与允许清单逐字相同');
  assertEqual(Object.keys(board.arena).sort(), ALLOWED_ARENA_KEYS, 'arena 的键集合必须是白名单');
  assertEqual(Object.keys(board.computes.A).sort(), ALLOWED_COMPUTE_KEYS, 'computes 单元只暴露这三项');
});

test('观众板（含空局面）不含任何禁用键', () => {
  const root = tmpDir('webproj');
  const board = spectatorBoard(bareEngine(root), null);
  const keys = collectKeys(board);
  for (const bad of FORBIDDEN_KEYS) {
    assert(!keys.has(bad), `观众板不得出现键 "${bad}"（实际键：${[...keys].sort().join(',')}）`);
  }
});

test('观众板序列化后不含绝对路径', () => {
  const root = tmpDir('webproj');
  const board = spectatorBoard(bareEngine(root), null);
  const json = JSON.stringify(board);
  for (const prefix of ['/Users/', '/var/folders/', '/private/', '/tmp/', root]) {
    assert(!json.includes(prefix), `观众板不得出现绝对路径前缀 "${prefix}"`);
  }
});

test('观众板在比赛未结束时不得提前公布判决', () => {
  const root = tmpDir('webproj');
  const board = spectatorBoard(bareEngine(root), null);
  assertEqual(board.verdict, null, 'SETUP 阶段 verdict 必须是 null —— 中途不得公布胜者');
});

test('观众板的点视图只带白名单字段', () => {
  const root = tmpDir('webproj');
  const board = spectatorBoard(bareEngine(root), null);
  // 空局面没有点，这里断言的是「有点时也不会多带字段」——
  // 由 playwright 演练在真实对局里再覆盖一次。
  for (const p of board.arena.points) {
    assertEqual(Object.keys(p).sort(), ALLOWED_POINT_KEYS, '点视图只允许 id/team/position/alive');
  }
});

test('trajectoryHandle 只带 id 与 round', () => {
  const root = tmpDir('webproj');
  const board = spectatorBoard(bareEngine(root), { id: 'M:3', round: 3 });
  assert(board.trajectoryHandle, '传入句柄后必须出现在板上');
  assertEqual(Object.keys(board.trajectoryHandle).sort(), ALLOWED_HANDLE_KEYS, '句柄只带 id 与 round');
  assertEqual(board.trajectoryHandle!.id, 'M:3', '句柄 id 必须原样透传');
});

// ============================================================================
// 2. 摘要（ticker 的变更检测）
// ============================================================================

test('同一引擎的连续两次摘要完全相同（否则 ticker 会空转推送）', () => {
  const root = tmpDir('webproj');
  const engine = bareEngine(root);
  assertEqual(snapshotDigest(engine.getSnapshot(), null), snapshotDigest(engine.getSnapshot(), null), '摘要必须稳定');
});

test('不同比赛产生不同摘要', () => {
  const root = tmpDir('webproj');
  const a = bareEngine(root);
  const b = bareEngine(root);
  assert(
    snapshotDigest(a.getSnapshot(), null) !== snapshotDigest(b.getSnapshot(), null),
    'matchId 不同则摘要必须不同，否则换场后大屏不会刷新'
  );
});

test('轨迹句柄变化会改变摘要（新轨迹必须触发一次推送）', () => {
  const root = tmpDir('webproj');
  const snap = bareEngine(root).getSnapshot();
  assert(
    snapshotDigest(snap, null) !== snapshotDigest(snap, 'M:1'),
    '句柄从 null 变为有值时摘要必须变化 —— 否则浏览器永远收不到新轨迹'
  );
});

// ============================================================================
// 3. 投影（必须与终端 ArenaView 同规则）
// ============================================================================

test('场地四角投影到画布四角（y 轴已翻转）', () => {
  const size = { w: 100, h: 100 };
  const tl = projectPoint({ x: FIELD.xMin, y: FIELD.yMax }, FIELD, size);
  const br = projectPoint({ x: FIELD.xMax, y: FIELD.yMin }, FIELD, size);
  assertClose(tl.x, 0, 1e-9, 'xMin 应落到最左列');
  assertClose(tl.y, 0, 1e-9, 'yMax 应落到最上行（翻转）');
  assertClose(br.x, 99, 1e-9, 'xMax 应落到最右列');
  assertClose(br.y, 99, 1e-9, 'yMin 应落到最下行（翻转）');
});

test('投影单调，且越界点被夹取在场内', () => {
  assert(projectX(-19, FIELD, 100) < projectX(19, FIELD, 100), 'x 增大应向右');
  assert(projectY(-11, FIELD, 100) > projectY(11, FIELD, 100), 'y 增大应向上（屏幕行号变小）');
  assertClose(projectX(-999, FIELD, 100), 0, 1e-9, '越界左侧应夹到 0');
  assertClose(projectX(999, FIELD, 100), 99, 1e-9, '越界右侧应夹到 w-1');
});

test('四种障碍物都能投影成可绘制的屏幕几何', () => {
  const size = { w: 400, h: 240 };
  const rect = obstacleToDrawable({ type: 'rectangle', xmin: -5, xmax: 5, ymin: -2, ymax: 2 }, FIELD, size);
  assertEqual(rect.kind, 'rect', '矩形 → rect');
  assert((rect.w ?? 0) > 0 && (rect.h ?? 0) > 0, '矩形的宽高必须为正（否则画不出来）');

  const circle = obstacleToDrawable({ type: 'circle', center: [0, 0], radius: 3 }, FIELD, size);
  assertEqual(circle.kind, 'circle', '圆 → circle');
  assert((circle.rx ?? 0) > 0 && (circle.ry ?? 0) > 0, '圆的两个半径都必须为正');

  const seg = obstacleToDrawable({ type: 'segment', x1: -4, y1: 0, x2: 4, y2: 0 }, FIELD, size);
  assertEqual(seg.kind, 'segment', '线段 → segment');

  const poly = obstacleToDrawable({ type: 'polygon', vertices: [[0, 0], [2, 0], [2, 2]] }, FIELD, size);
  assertEqual(poly.kind, 'polygon', '多边形 → polygon');
  assertEqual(poly.points?.length, 3, '多边形顶点数必须保留');
});

test('圆的屏幕几何 = 数学圆在投影下的像（非等比绘图区同样成立）', () => {
  // 引擎判定的是一张数学平面上的**真圆**（`Judge.ts` 用欧氏距离），
  // 而绘图区几乎不可能正好等比缩放 —— 于是屏幕上该画成椭圆。
  //
  // 旧实现只按 x 轴缩放半径，在宽屏下把圆画得**偏高**：轨迹看起来在碰到
  // 障碍物之前就停了，两个其实有间距的障碍物看起来在重叠。这正是现场
  // 报上来的「障碍物视觉重叠」。
  const circle = { type: 'circle' as const, center: [-6, 3] as [number, number], radius: 4.6 };
  // 400x240 的宽高比恰好是场地 40:24（1.667）—— 那是旧实现唯一看不出问题的尺寸，
  // 所以清单里必须**同时**有非等比的尺寸，否则这条回归是空转的。
  const sizes = [
    { w: 400, h: 240 },
    { w: 1200, h: 300 },
    { w: 320, h: 640 },
    { w: 900, h: 900 },
  ];

  for (const size of sizes) {
    const d = obstacleToDrawable(circle, FIELD, size);
    const rx = d.rx ?? 0;
    const ry = d.ry ?? 0;
    const tag = `${size.w}x${size.h}`;
    assert(rx > 0 && ry > 0, `${tag}: 两个半径都必须为正`);

    // 两个半径各用**自己**那条轴的尺度（与 projectX/projectY 分母一致）
    assertClose(rx, projectRadius(circle.radius, FIELD.xMax - FIELD.xMin, size.w), 1e-9, `${tag}: rx 必须用 x 轴尺度`);
    assertClose(ry, projectRadius(circle.radius, FIELD.yMax - FIELD.yMin, size.h), 1e-9, `${tag}: ry 必须用 y 轴尺度`);

    // 数学圆上任意一点投影后，必须正好落在画出的椭圆上
    for (const deg of [0, 30, 90, 145, 210, 300]) {
      const th = (deg * Math.PI) / 180;
      const px = projectX(circle.center[0] + circle.radius * Math.cos(th), FIELD, size.w);
      const py = projectY(circle.center[1] + circle.radius * Math.sin(th), FIELD, size.h);
      const nx = (px - d.cx!) / rx;
      const ny = (py - d.cy!) / ry;
      assertClose(nx * nx + ny * ny, 1, 1e-9, `${tag}: ${deg}° 处的投影点必须落在画出的椭圆上`);
    }
  }
});

// ============================================================================
// 4. 揭示语义（必须与终端 revealed() 一致）
// ============================================================================

test('揭示比例 0 时仍给 1 个点（否则开场那一帧什么都看不见）', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  assertEqual(revealedPoints(pts, 0).length, 1, '比例 0 至少要有 1 个点');
});

test('揭示比例 1 时给完整轨迹（动画结束必须与判定结果一致）', () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
  assertEqual(revealedPoints(pts, 1).length, 50, '比例 1 必须是完整轨迹');
  assertEqual(revealedPoints(pts, 2).length, 50, '比例 >1 也应夹到完整轨迹');
});

test('揭示只做前缀切片 —— 绝不重采样、绝不新增点', () => {
  const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i * 2 }));
  const half = revealedPoints(pts, 0.5);
  assertEqual(half.length, 51, '比例 0.5 → 51 个点（前缀）');
  for (let i = 0; i < half.length; i++) {
    assertEqual(half[i], pts[i], `第 ${i} 个点必须与引擎给出的完全一致`);
  }
});

test('空轨迹任何比例都是空', () => {
  assertEqual(revealedPoints([], 0).length, 0, '空轨迹比例 0');
  assertEqual(revealedPoints([], 1).length, 0, '空轨迹比例 1');
});

test('ratioAt 在时长内线性推进并被夹取到 0..1', () => {
  assertClose(ratioAt(0, 1000), 0, 1e-9, '起点为 0');
  assertClose(ratioAt(500, 1000), 0.5, 1e-9, '中点为 0.5');
  assertClose(ratioAt(5000, 1000), 1, 1e-9, '超时应夹到 1');
  assertClose(ratioAt(0, 0), 1, 1e-9, '零时长直接完成，不得除零');
});

// ============================================================================
// 5. 轨迹载荷
// ============================================================================

test('轨迹降采样后不超过协议上限', () => {
  const dense = Array.from({ length: 4000 }, (_, i) => ({ x: i * 0.01, y: Math.sin(i * 0.01) }));
  const out = downsampleTrajectory(dense, TRAJECTORY_MAX_POINTS);
  assertEqual(out.length, TRAJECTORY_MAX_POINTS, `降采样必须恰好压到 ${TRAJECTORY_MAX_POINTS} 点`);
  assertEqual(out[0], dense[0], '首点必须保留（攻击起点）');
  assertEqual(out[out.length - 1], dense[dense.length - 1], '末点必须保留（攻击终止点）');
});

test('稀疏轨迹降采样不做任何改动', () => {
  const sparse = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assertEqual(downsampleTrajectory(sparse, TRAJECTORY_MAX_POINTS), sparse, '点数未超限时原样返回');
});

// ============================================================================
// 6. topic 校验
// ============================================================================

test('WS topic 只接受 judge / spectator', () => {
  assert(isTopic('judge'), 'judge 合法');
  assert(isTopic('spectator'), 'spectator 合法');
  assert(!isTopic('admin'), 'admin 非法');
  assert(!isTopic(''), '空串非法');
  assert(!isTopic(null), 'null 非法');
});

void runAll('web-projection');
