/**
 * arena-view —— 观众屏的竞技场渲染（Rule Revision 3 §23/§25）
 *
 * 这是**纯函数**的 UI 回归：给定同一帧必须画出同一张图，且图必须真的把
 * 固定 Emitter / 战斗点 / 障碍物 / 轨迹画出来。现场投影与回放共用这一份渲染，
 * 所以「画错」等于「现场看错」。
 */

import { EMITTERS, FIELD } from '../src/core/Rules';
import { parseCanonicalDSL } from '../src/core/Ast';
import { ArenaFrame, arenaLegend, arenaRuler, renderArena } from '../src/ui/ArenaView';
import {
  CLEAR_SCREEN,
  buildAnimationFrames,
  computeTrajectoryFrames,
  frameAt,
  playAnimation,
} from '../src/ui/TrajectoryAnimator';
import { computeAnimationFrames } from '../src/visualizer/AudienceDisplay';
import { assert, assertClose, assertEqual, runAll, test } from './harness';

function frameWith(over: Partial<ArenaFrame> = {}): ArenaFrame {
  return {
    obstacles: [],
    emitters: {
      A: { id: 'A0', position: EMITTERS.A },
      B: { id: 'B0', position: EMITTERS.B },
    },
    points: [
      { id: 'A1', team: 'A', position: { x: -10, y: 5 }, alive: true },
      { id: 'B1', team: 'B', position: { x: 10, y: -5 }, alive: true },
    ],
    ...over,
  };
}

test('arena-view: 渲染是纯函数 —— 同一帧画出同一张图', () => {
  const a = renderArena(frameWith());
  const b = renderArena(frameWith());
  assertEqual(a, b, '同一帧必须逐字节相同（现场投影与回放共用这一份）');
});

test('arena-view: 固定 Emitter 一定出现在图上', () => {
  const art = renderArena(frameWith());
  assert(art.includes('Ⓐ'), 'A 的固定 Emitter 必须被画出来');
  assert(art.includes('Ⓑ'), 'B 的固定 Emitter 必须被画出来');

  // Emitter 是常量：即便没有任何战斗点，它也必须在图上
  const bare = renderArena(frameWith({ points: [] }));
  assert(bare.includes('Ⓐ') && bare.includes('Ⓑ'), '没有战斗点时 Emitter 仍然存在');
});

test('arena-view: 战斗点按队别与生死分别绘制', () => {
  const art = renderArena(frameWith());
  assert(art.includes('a'), '存活的 A 队战斗点应画成 a');
  assert(art.includes('b'), '存活的 B 队战斗点应画成 b');

  const dead = renderArena(
    frameWith({
      points: [
        { id: 'A1', team: 'A', position: { x: -10, y: 5 }, alive: false },
        { id: 'B1', team: 'B', position: { x: 10, y: -5 }, alive: true },
      ],
    })
  );
  assert(dead.includes('×'), '阵亡的点应画成 ×');
});

test('arena-view: 障碍物与轨迹都要画出来，且轨迹不覆盖障碍物', () => {
  // 从 A 的 Emitter 出发、沿 y = 0 采样到场地中段：中途会横穿中央的障碍物。
  const trajectory: { x: number; y: number }[] = [];
  for (let x = EMITTERS.A.x; x <= 6; x += 0.5) trajectory.push({ x, y: 0 });

  const art = renderArena(
    frameWith({
      obstacles: [{ type: 'rectangle', xmin: -2, xmax: 2, ymin: -3, ymax: 3 }],
      trajectoryA: trajectory,
    })
  );
  assert(art.includes('▓'), '障碍物应被画出来');
  assert(art.includes('.'), 'A 的轨迹应被画出来（Emitter 与障碍物之外的段落）');

  // 轨迹画在障碍物**之前**且不覆盖它：被挡住的那一段必须仍是障碍物符号。
  // 这是现场看得懂「攻击被挡下」的关键 —— 轨迹不能从障碍物上穿过去。
  const lines = art.split('\n');
  const rowWithObstacle = lines.find((l) => l.includes('▓'))!;
  assert(rowWithObstacle !== undefined, '前提：应有一行含障碍物');
  const block = rowWithObstacle.slice(rowWithObstacle.indexOf('▓'), rowWithObstacle.lastIndexOf('▓') + 1);
  assert(
    block.length > 0 && [...block].every((c) => c === '▓'),
    `障碍物区间必须连续且全是障碍物符号，实际 "${block}"`
  );
});

test('arena-view: 渲染结果一定落在给定尺寸内（现场投影不会被撑破）', () => {
  const cols = 41;
  const rows = 11;
  const art = renderArena(frameWith(), cols, rows);
  const lines = art.split('\n');
  assertEqual(lines.length, rows + 2, `应为 ${rows} 行场地 + 上下边框`);
  for (const l of lines) {
    assertEqual(l.length, cols + 2, `每行应为 ${cols} 列 + 左右边框，实际 ${l.length}`);
  }
});

test('arena-view: 极值坐标不会越界（场地四角都能画）', () => {
  const art = renderArena(
    frameWith({
      points: [
        { id: 'A1', team: 'A', position: { x: FIELD.xMin, y: FIELD.yMin }, alive: true },
        { id: 'A2', team: 'A', position: { x: FIELD.xMin, y: FIELD.yMax }, alive: true },
        { id: 'B1', team: 'B', position: { x: FIELD.xMax, y: FIELD.yMin }, alive: true },
        { id: 'B2', team: 'B', position: { x: FIELD.xMax, y: FIELD.yMax }, alive: true },
      ],
    })
  );
  const lines = art.split('\n');
  for (const l of lines) assertEqual(l.length, 61, '极值坐标不得把网格撑破');
  assert(lines.some((l) => l.includes('a')), '四角的点必须被画出来');
  assert(lines.some((l) => l.includes('b')), '四角的点必须被画出来');
});

test('arena-view: 图例与标尺覆盖全部符号（观众必须看得懂）', () => {
  const legend = arenaLegend();
  for (const g of ['Ⓐ', 'Ⓑ', 'a', 'b', '×', '▓', '.', ',']) {
    assert(legend.includes(g), `图例必须解释符号 ${g}`);
  }
  const ruler = arenaRuler();
  assert(ruler.includes(`${FIELD.xMin}`) && ruler.includes(`${FIELD.xMax}`), '标尺必须标出 x 的两端');
  assert(ruler.includes(`${FIELD.yMin}`) && ruler.includes(`${FIELD.yMax}`), '标尺必须标出 y 的两端');
});

test('arena-view: 函数版动画入口已接线（computeAnimationFrames 不再是死代码）', () => {
  const parsed = parseCanonicalDSL({
    type: 'add',
    args: [
      { type: 'number', value: EMITTERS.A.y },
      {
        type: 'mul',
        args: [
          { type: 'number', value: 0 },
          { type: 'sub', args: [{ type: 'variable', value: 'x' }, { type: 'number', value: EMITTERS.A.x }] },
        ],
      },
    ],
  });
  assert(parsed.ok && parsed.ast, '构造的直线 AST 必须合法');
  const ast = parsed.ast!;
  const frames = computeAnimationFrames(ast, EMITTERS.A.x, 10, 6);
  assertEqual(frames.length, 6, '应生成 6 帧');
  assert(frames[0].length < frames[5].length, '应是增量揭示');
  // 起点必须落在 Emitter 上（f(x_e) = y_e）
  assertClose(frames[0][0].x, EMITTERS.A.x, 1e-9, '首点应是发射锚点');
});

void runAll('arena-view');

// ===========================================================================
// 轨迹动画（Rule Revision 3 §25）
// ===========================================================================

test('arena-view: 动画帧是增量揭示，最后一帧等于完整轨迹', () => {
  const traj = Array.from({ length: 40 }, (_, i) => ({ x: -18 + i * 0.9, y: 0 }));
  const frames = computeTrajectoryFrames(traj, 8);
  assertEqual(frames.length, 8, '应生成 8 帧');
  assertEqual(frames[0].length, 5, '第一帧应揭示 1/8');
  assertEqual(frames[frames.length - 1].length, traj.length, '最后一帧必须是完整轨迹');

  // 逐帧单调不减，且每一帧都是下一帧的前缀（增量而不是重采样）
  for (let i = 1; i < frames.length; i++) {
    assert(frames[i].length >= frames[i - 1].length, `第 ${i} 帧不应比上一帧短`);
    for (let k = 0; k < frames[i - 1].length; k++) {
      assertEqual(frames[i][k], frames[i - 1][k], `第 ${i} 帧必须是第 ${i - 1} 帧的延长`);
    }
  }
});

test('arena-view: 动画帧不越界，且空轨迹安全', () => {
  assertEqual(computeTrajectoryFrames([], 8), [], '空轨迹应返回空');
  assertEqual(computeTrajectoryFrames([{ x: 0, y: 0 }], 0), [], '帧数 0 应返回空');
  const single = computeTrajectoryFrames([{ x: 0, y: 0 }], 4);
  assertEqual(single.length, 4, '单点轨迹仍应给出 4 帧');
  for (const f of single) assertEqual(f.length, 1, '单点轨迹的每一帧都只有一个点');
});

test('arena-view: 动画以**已判定轨迹**为输入，绝不画到障碍物之后', () => {
  // 引擎判定出的轨迹在第一次障碍物接触处终止。动画只揭示这条轨迹 ——
  // 因此被挡住之后的那一段**永远不该出现**。用原始函数重算就会画出来。
  const traj = [
    { x: -18, y: 0 },
    { x: -10, y: 0 },
    { x: -2, y: 0 }, // 障碍物接触点（轨迹到此为止）
  ];
  const plan = buildAnimationFrames({ lengthA: traj.length, lengthB: 0, frameCount: 6, frameMs: 0 });
  const base: ArenaFrame = {
    obstacles: [{ type: 'rectangle', xmin: -2, xmax: 2, ymin: -3, ymax: 3 }],
    emitters: { A: { id: 'A0', position: EMITTERS.A }, B: { id: 'B0', position: EMITTERS.B } },
    points: [],
    trajectoryA: traj,
    trajectoryB: [],
  };
  const lastFrame = frameAt(plan, plan.frames.length - 1, base);
  assertEqual(lastFrame.revealA, 1, '最后一帧应揭示整条轨迹');
  const art = renderArena(lastFrame);
  const lines = art.split('\n');
  // 障碍物右侧（x > 2）不应出现轨迹符号 —— 轨迹在接触点就停了
  for (const line of lines) {
    const obstacleEnd = line.lastIndexOf('▓');
    if (obstacleEnd < 0) continue;
    const after = line.slice(obstacleEnd + 1);
    assert(!after.includes('.'), `障碍物之后不得出现 A 轨迹：${line}`);
  }
});

test('arena-view: 播放器在非交互模式下只打关键帧，且末帧是完整轨迹', async () => {
  const writes: string[] = [];
  const traj = Array.from({ length: 12 }, (_, i) => ({ x: -18 + i, y: 0 }));
  const plan = buildAnimationFrames({ lengthA: traj.length, lengthB: 0, frameCount: 12, frameMs: 0 });
  const base: ArenaFrame = {
    obstacles: [],
    emitters: { A: { id: 'A0', position: EMITTERS.A }, B: { id: 'B0', position: EMITTERS.B } },
    points: [],
    trajectoryA: traj,
    trajectoryB: [],
  };
  const r = await playAnimation(
    { interactive: false, write: (t) => writes.push(t), wait: async () => {} },
    plan,
    base
  );
  assertEqual(r.interactive, false, '非交互模式不得走原位重绘');
  assertEqual(r.renderedFrames, 3, '非交互模式应只打 3 个关键帧（首 / 中 / 尾）');
  assert(!writes.join('').includes('\x1b'), '非交互模式不得输出 ANSI 转义序列');

  // 末帧必须等于「完整轨迹」那一帧 —— 动画结束时的画面要与判定结果一致
  const full = renderArena(frameAt(plan, plan.frames.length - 1, base));
  assert(writes[writes.length - 1].includes(full), '最后打印的必须是完整轨迹那一帧');
});

test('arena-view: 交互模式逐帧重绘，帧数等于计划帧数', async () => {
  const writes: string[] = [];
  let waits = 0;
  const traj = Array.from({ length: 8 }, (_, i) => ({ x: -18 + i * 2, y: 0 }));
  const plan = buildAnimationFrames({ lengthA: traj.length, lengthB: 4, frameCount: 5, frameMs: 1 });
  const r = await playAnimation(
    { interactive: true, write: (t) => writes.push(t), wait: async () => void waits++ },
    plan,
    { obstacles: [], emitters: null, points: [], trajectoryA: traj, trajectoryB: [] }
  );
  assertEqual(r.renderedFrames, 5, '应逐帧渲染 5 帧');
  assertEqual(writes.length, 5, '应写出 5 次');
  assertEqual(waits, 4, '最后一帧之后不应再等待');
  for (const w of writes) assert(w.startsWith(CLEAR_SCREEN), '每一帧都应先清屏再重绘');
});
