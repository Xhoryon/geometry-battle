/**
 * arena-view —— 观众屏的竞技场渲染（Rule Revision 3 §23/§25）
 *
 * 这是**纯函数**的 UI 回归：给定同一帧必须画出同一张图，且图必须真的把
 * 固定 Emitter / 战斗点 / 障碍物 / 轨迹画出来。现场投影与回放共用这一份渲染，
 * 所以「画错」等于「现场看错」。
 */

import { EMITTERS, FIELD } from '../src/core/Rules';
import { ArenaFrame, arenaLegend, arenaRuler, renderArena } from '../src/ui/ArenaView';
import { assert, assertEqual, runAll, test } from './harness';

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

void runAll('arena-view');
