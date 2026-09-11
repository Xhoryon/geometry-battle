/**
 * obstacle-geometry —— 障碍物几何的 property test（V1.2 Gap 四）
 *
 * 诊断结论：**MAP GEOMETRY**。`MapGenerator` 逐个独立生成障碍物，只检查
 * 「是否越出场地」与「是否把一方封死」，**从不检查障碍物之间是否重合**；
 * `validateMap` 也只在「点 ↔ 障碍物」这一侧做校验。
 *
 * 因此这里用大样本 property test 把三条不变量钉死：
 *   1. 任意两个障碍物的间距 ≥ MIN_OBSTACLE_CLEARANCE（不重合、不紧贴）；
 *   2. 障碍物不覆盖任何战斗点，也不覆盖 Emitter；
 *   3. 同一 seed 永远生成同一张地图（determinism 不得被几何过滤破坏）。
 */

import { EMITTERS, MIN_OBSTACLE_CLEARANCE, POINT_OBSTACLE_CLEARANCE } from '../src/core/Rules';
import { distanceBetweenObstacles, distanceToObstacle, isInsideObstacle } from '../src/obstacle/Obstacle';
import { GeneratedMap, generateMapOrNull, validateMap } from '../src/map/MapGenerator';
import { assert, assertEqual, runAll, test } from './harness';

/** 大样本扫描：难度 × 点数 × 种子 */
function* sweep(): Generator<{ seed: number; points: number; difficulty: 'easy' | 'medium' | 'hard' }> {
  const difficulties = ['easy', 'medium', 'hard'] as const;
  for (let seed = 1; seed <= 400; seed++) {
    for (const points of [6, 8, 10]) {
      for (const difficulty of difficulties) {
        yield { seed, points, difficulty };
      }
    }
  }
}

/** 收集所有障碍物两两之间的最小间距（负数表示相交） */
function worstObstacleGap(map: GeneratedMap): { gap: number; pair: [number, number] } {
  let worst = Number.POSITIVE_INFINITY;
  let pair: [number, number] = [-1, -1];
  for (let i = 0; i < map.obstacles.length; i++) {
    for (let j = i + 1; j < map.obstacles.length; j++) {
      const gap = distanceBetweenObstacles(map.obstacles[i], map.obstacles[j]);
      if (gap < worst) {
        worst = gap;
        pair = [i, j];
      }
    }
  }
  return { gap: worst, pair };
}

test('obstacle-geometry: 大样本 property —— 任意两个障碍物都不相交', () => {
  let checked = 0;
  let failures = 0;
  let worst = Number.POSITIVE_INFINITY;
  const examples: string[] = [];

  for (const c of sweep()) {
    const map = generateMapOrNull({ seed: c.seed, pointCount: c.points, difficulty: c.difficulty });
    if (!map) continue; // 该种子合法地生成失败
    checked++;
    const { gap, pair } = worstObstacleGap(map);
    if (gap < worst) worst = gap;
    if (gap < MIN_OBSTACLE_CLEARANCE) {
      failures++;
      if (examples.length < 5) {
        examples.push(
          `seed=${map.seed} p${c.points} ${c.difficulty} O${pair[0] + 1}/O${pair[1] + 1} gap=${gap.toFixed(3)}`
        );
      }
    }
  }

  assert(checked > 2000, `样本量应足够大，实际只检查了 ${checked} 张地图`);
  assertEqual(
    failures,
    0,
    `障碍物不得相交或紧贴（要求 gap ≥ ${MIN_OBSTACLE_CLEARANCE}）。` +
      `失败 ${failures}/${checked}，最差 gap=${worst.toFixed(3)}。例：\n  ${examples.join('\n  ')}`
  );
});

test('obstacle-geometry: 障碍物不得覆盖战斗点，也不得覆盖 Emitter', () => {
  let checked = 0;
  const problems: string[] = [];

  for (const c of sweep()) {
    const map = generateMapOrNull({ seed: c.seed, pointCount: c.points, difficulty: c.difficulty });
    if (!map) continue;
    checked++;

    const labelled = [
      ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, position: p })),
      ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, position: p })),
      { id: 'Emitter A', position: map.emitterA },
      { id: 'Emitter B', position: map.emitterB },
    ];

    for (const p of labelled) {
      for (const o of map.obstacles) {
        if (isInsideObstacle(p.position, o)) {
          if (problems.length < 5) problems.push(`seed=${map.seed} ${p.id} 落在障碍物内部`);
        } else if (distanceToObstacle(p.position, o) < POINT_OBSTACLE_CLEARANCE) {
          if (problems.length < 5) problems.push(`seed=${map.seed} ${p.id} 紧贴障碍物`);
        }
      }
    }
  }

  assert(checked > 2000, `样本量应足够大，实际 ${checked}`);
  assertEqual(problems.length, 0, `障碍物不得覆盖或紧贴任何点。例：\n  ${problems.join('\n  ')}`);
});

test('obstacle-geometry: 同一 seed 永远生成同一张地图（determinism 不受几何过滤影响）', () => {
  for (const c of [
    { seed: 7, points: 6, difficulty: 'easy' as const },
    { seed: 101, points: 8, difficulty: 'medium' as const },
    { seed: 2024, points: 10, difficulty: 'hard' as const },
  ]) {
    const a = generateMapOrNull({ seed: c.seed, pointCount: c.points, difficulty: c.difficulty });
    const b = generateMapOrNull({ seed: c.seed, pointCount: c.points, difficulty: c.difficulty });
    assert(a !== null && b !== null, `seed=${c.seed} 应能生成`);
    assertEqual(a!.stateHash, b!.stateHash, `seed=${c.seed} 两次生成必须字节级相同`);
    assertEqual(JSON.stringify(a!.obstacles), JSON.stringify(b!.obstacles), `seed=${c.seed} 障碍物必须相同`);
  }
});

test('obstacle-geometry: validateMap 拒绝重合的障碍物（V1.2 Gap 四 回归）', () => {
  const base = {
    seed: 1,
    teamA: [{ x: -10, y: 5 }],
    teamB: [{ x: 10, y: 5 }],
    emitterA: EMITTERS.A,
    emitterB: EMITTERS.B,
    stateHash: 'x',
  };
  // 两个完全重合的矩形：必须非法，且错误信息要指出是哪一对
  const overlapping = validateMap({
    ...base,
    obstacles: [
      { type: 'rectangle', xmin: -3, xmax: -1, ymin: -2, ymax: 2 },
      { type: 'rectangle', xmin: -3, xmax: -1, ymin: -2, ymax: 2 },
    ],
  });
  assert(!overlapping.valid, '完全重合的障碍物必须判非法');
  assert(
    overlapping.errors.some((e) => e.includes('O1') && e.includes('O2')),
    `错误信息必须点明是哪一对，实际: ${overlapping.errors.join('; ')}`
  );

  // 圆心相距 3、半径各 2 → 相交（间距 −1）
  const circles = validateMap({
    ...base,
    obstacles: [
      { type: 'circle', center: [0, 0], radius: 2 },
      { type: 'circle', center: [3, 0], radius: 2 },
    ],
  });
  assert(!circles.valid, '相交的圆形障碍物必须判非法');

  // 对照组：间距恰好达标的两张障碍物必须合法（否则上面的断言只是「一律拒绝」）
  const ok = validateMap({
    ...base,
    obstacles: [
      { type: 'circle', center: [0, 0], radius: 2 },
      { type: 'circle', center: [5.5, 0], radius: 2 }, // 间距 1.5 > 1.0
    ],
  });
  assert(
    !ok.errors.some((e) => e.includes('相交或过近')),
    `间距达标的一对不得被判非法，实际: ${ok.errors.join('; ')}`
  );
});

void runAll('obstacle-geometry');
