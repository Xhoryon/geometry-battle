/**
 * map-fairness —— 地图公平性过滤（Plan V1 §47）
 *
 * 覆盖 Finding: P2-23（强制放置绕过约束）、
 *              P1-FAIR（出生点紧贴障碍物 → 该点几乎被彻底封死，
 *                       抛物线族无法绕过，比赛会陷入永久僵局）
 *
 * 正式比赛地图必须：点不在障碍物内、不紧贴障碍物、不与队友重叠、
 * 不出现贯通单方区域的墙；生成失败必须返回 null 而不是强行放置。
 */

import { POINT_OBSTACLE_CLEARANCE } from '../src/core/Rules';
import { distanceToObstacle } from '../src/obstacle/Obstacle';
import {
  GeneratedMap,
  generateMapOrNull,
  tryGenerateMap,
  validateMap,
} from '../src/map/MapGenerator';
import { assert, assertEqual, runAll, test } from './harness';

const DIFFICULTIES: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];

/** 障碍物在 x 轴上的投影区间 */
function xExtent(o: GeneratedMap['obstacles'][number]): [number, number] {
  switch (o.type) {
    case 'segment':
      return [Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)];
    case 'rectangle':
      return [o.xmin, o.xmax];
    case 'circle':
      return [o.center[0] - o.radius, o.center[0] + o.radius];
    case 'polygon': {
      const xs = o.vertices.map((v) => v[0]);
      return [Math.min(...xs), Math.max(...xs)];
    }
  }
}

/** 障碍物在 y 轴上的投影区间 */
function yExtent(o: GeneratedMap['obstacles'][number]): [number, number] {
  switch (o.type) {
    case 'segment':
      return [Math.min(o.y1, o.y2), Math.max(o.y1, o.y2)];
    case 'rectangle':
      return [o.ymin, o.ymax];
    case 'circle':
      return [o.center[1] - o.radius, o.center[1] + o.radius];
    case 'polygon': {
      const ys = o.vertices.map((v) => v[1]);
      return [Math.min(...ys), Math.max(...ys)];
    }
  }
}

test('map-fairness: 批量生成的地图 0 非法', () => {
  let generated = 0;
  const failures: string[] = [];
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < 1400; i++) {
      const seed = 1_000_003 + i * 7919;
      const map = tryGenerateMap({ seed, pointCount: 8, difficulty });
      if (!map) continue; // 生成失败是允许的（由调用方换种子）
      generated++;
      const v = validateMap(map);
      if (!v.valid) failures.push(`seed=${seed} ${difficulty}: ${v.errors.join('; ')}`);
    }
  }
  assertEqual(failures.length, 0, `不得有非法地图：\n${failures.slice(0, 5).join('\n')}`);
  assert(generated > 2000, `样本量太小: ${generated}`);
});

test('map-fairness: 每个出生点与障碍物保持最小间距', () => {
  let worst = Infinity;
  let checked = 0;
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < 300; i++) {
      const map = tryGenerateMap({ seed: 5_000_011 + i * 104_729, pointCount: 8, difficulty });
      if (!map) continue;
      for (const p of [...map.teamA, ...map.teamB]) {
        for (const o of map.obstacles) {
          worst = Math.min(worst, distanceToObstacle(p, o));
          checked++;
        }
      }
    }
  }
  assert(checked > 5000, `检查样本太少: ${checked}`);
  assert(
    worst >= POINT_OBSTACLE_CLEARANCE - 1e-9,
    `最小间距 ${worst.toFixed(4)} 必须 ≥ ${POINT_OBSTACLE_CLEARANCE}`
  );
});

test('map-fairness: validateMap 拒绝紧贴障碍物的点', () => {
  const map: GeneratedMap = {
    seed: 1,
    teamA: [{ x: -10, y: 0 }],
    teamB: [{ x: 10, y: 0 }],
    obstacles: [{ type: 'rectangle', xmin: -10.5, xmax: -9.5, ymin: -0.5, ymax: 0.5 }],
    stateHash: 'x',
  };
  // 点在矩形外，但距离只有 0 —— 属于「紧贴」，必须被拒绝
  const v = validateMap(map);
  assert(!v.valid, '紧贴障碍物的地图必须非法');
  assert(
    v.errors.some((e) => e.includes('紧贴障碍物')),
    `错误信息应说明紧贴障碍物: ${v.errors.join('; ')}`
  );
});

test('map-fairness: validateMap 拒绝位于障碍物内部的点', () => {
  const map: GeneratedMap = {
    seed: 1,
    teamA: [{ x: -10, y: 0 }],
    teamB: [{ x: 10, y: 0 }],
    obstacles: [{ type: 'circle', center: [-10, 0], radius: 2 }],
    stateHash: 'x',
  };
  const v = validateMap(map);
  assert(!v.valid, '位于障碍物内部的点必须非法');
});

test('map-fairness: 生成失败时返回 null，绝不强行放置', () => {
  // 点数远超单方区域容量（60 个点 × 最小间距 2.5 + 障碍物间距 1.5），
  // 放置必然失败 —— 此时必须返回 null，而不是强行放一个非法点（P2-23）。
  let nullCount = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const map = tryGenerateMap({ seed, pointCount: 60, difficulty: 'hard' });
    if (!map) {
      nullCount++;
      continue;
    }
    // 只要返回了地图，就必须完全合法
    assert(validateMap(map).valid, `seed=${seed} 返回的地图必须合法`);
  }
  assert(nullCount === 10, `点数超容量时必须全部返回 null，实际 null=${nullCount}/10`);
});

test('map-fairness: 常规配置下返回的地图永远合法', () => {
  let returned = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const map = generateMapOrNull({ seed, pointCount: 10, difficulty: 'hard' });
    if (!map) continue;
    returned++;
    assert(validateMap(map).valid, `seed=${seed} 返回的地图必须合法`);
  }
  assert(returned > 0, '常规配置应当能生成地图');
});

test('map-fairness: 生成的障碍物几何完全落在场地内（P3-7）', () => {
  let checked = 0;
  const escaped: string[] = [];
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < 400; i++) {
      const seed = 7_000_001 + i * 31_337;
      const map = tryGenerateMap({ seed, pointCount: 8, difficulty });
      if (!map) continue;
      for (const o of map.obstacles) {
        checked++;
        const [x0, x1] = xExtent(o);
        const [y0, y1] = yExtent(o);
        if (x0 < -20 || x1 > 20 || y0 < -12 || y1 > 12) {
          escaped.push(`${difficulty} seed=${seed}: ${JSON.stringify(o)}`);
        }
      }
    }
  }
  assert(checked > 1000, `样本太少: ${checked}`);
  assertEqual(escaped.length, 0, `障碍物越界:\n${escaped.slice(0, 5).join('\n')}`);
});

test('map-fairness: validateMap 拒绝越出场地边界的障碍物（P3-7）', () => {
  const map: GeneratedMap = {
    seed: 1,
    teamA: [{ x: -10, y: 0 }],
    teamB: [{ x: 10, y: 0 }],
    // 圆心在场地内，但半径让它伸到 x=23 > 20
    obstacles: [{ type: 'circle', center: [18, 0], radius: 5 }],
    stateHash: 'x',
  };
  const v = validateMap(map);
  assert(!v.valid, '越界障碍物的地图必须非法');
  assert(
    v.errors.some((e) => e.includes('越出场地边界')),
    `错误信息应说明越界: ${v.errors.join('; ')}`
  );
});

void runAll('map-fairness');
