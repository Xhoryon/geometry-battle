/**
 * Map Generator with Seed
 * Plan 2 Phase H: Deterministic seeded map generation
 */

import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';

export interface MapConfig {
  seed: number;
  pointCount: number;  // N per team (6-10)
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GeneratedMap {
  seed: number;
  teamA: Point[];
  teamB: Point[];
  obstacles: Obstacle[];
  stateHash: string;
}

/**
 * 简单 seeded 随机数生成器
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}

const FIELD_CONFIG = {
  teamAXRange: [-20, -4] as [number, number],
  teamBXRange: [4, 20] as [number, number],
  yRange: [-12, 12],
  minDistance: 2.5,
};

const OBSTACLE_CONFIGS = {
  easy: { count: 2, sizeRange: [2, 4] },
  medium: { count: 4, sizeRange: [1.5, 5] },
  hard: { count: 6, sizeRange: [1, 6] },
};

/**
 * 计算两点间距离
 */
function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

/**
 * 检查点是否在障碍物内
 */
function isInsideObstacle(p: Point, obstacles: Obstacle[]): boolean {
  for (const obs of obstacles) {
    if (obs.type === 'rectangle') {
      if (p.x >= obs.xmin && p.x <= obs.xmax &&
          p.y >= obs.ymin && p.y <= obs.ymax) {
        return true;
      }
    } else if (obs.type === 'circle') {
      const [cx, cy] = obs.center;
      if (distance(p, { x: cx, y: cy }) < obs.radius) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 生成随机障碍物
 */
function generateObstacle(rng: SeededRandom, config: typeof OBSTACLE_CONFIGS.medium): Obstacle {
  const type = rng.next() > 0.5 ? 'rectangle' : 'circle';
  const x = rng.nextFloat(-15, 15);
  const y = rng.nextFloat(-8, 8);
  const size = rng.nextFloat(config.sizeRange[0], config.sizeRange[1]);

  if (type === 'rectangle') {
    return {
      type: 'rectangle',
      xmin: x - size,
      xmax: x + size,
      ymin: y - size * 0.6,
      ymax: y + size * 0.6,
    };
  } else {
    return {
      type: 'circle',
      center: [x, y],
      radius: size,
    };
  }
}

/**
 * 生成队伍点
 */
function generateTeamPoints(
  rng: SeededRandom,
  range: [number, number],
  count: number,
  existingPoints: Point[],
  obstacles: Obstacle[]
): Point[] {
  const points: Point[] = [];
  const maxAttempts = 1000;

  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = rng.nextFloat(range[0], range[1]);
      const y = rng.nextFloat(FIELD_CONFIG.yRange[0] + 2, FIELD_CONFIG.yRange[1] - 2);

      // 检查与已有点的距离
      let validDistance = true;
      for (const p of [...existingPoints, ...points]) {
        if (distance({ x, y }, p) < FIELD_CONFIG.minDistance) {
          validDistance = false;
          break;
        }
      }

      // 检查是否在障碍物内
      if (validDistance && isInsideObstacle({ x, y }, obstacles)) {
        validDistance = false;
      }

      if (validDistance) {
        points.push({ x, y });
        placed = true;
        break;
      }
    }

    if (!placed) {
      // 强制放置
      const x = rng.nextFloat(range[0], range[1]);
      const y = rng.nextFloat(FIELD_CONFIG.yRange[0] + 2, FIELD_CONFIG.yRange[1] - 2);
      points.push({ x, y });
    }
  }

  return points;
}

/**
 * 生成地图
 */
export function generateMap(config: MapConfig): GeneratedMap {
  const rng = new SeededRandom(config.seed);
  const obstacles: Obstacle[] = [];
  const obstacleConfig = OBSTACLE_CONFIGS[config.difficulty];

  // 生成障碍物
  for (let i = 0; i < obstacleConfig.count; i++) {
    const obs = generateObstacle(rng, obstacleConfig);
    obstacles.push(obs);
  }

  // 生成队伍点
  const teamA = generateTeamPoints(rng, FIELD_CONFIG.teamAXRange, config.pointCount, [], obstacles);
  const teamB = generateTeamPoints(rng, FIELD_CONFIG.teamBXRange, config.pointCount, [], obstacles);

  // 计算 state hash
  const stateString = JSON.stringify({
    seed: config.seed,
    teamA,
    teamB,
    obstacles,
  });
  const stateHash = require('crypto').createHash('sha256').update(stateString).digest('hex').substring(0, 16);

  return {
    seed: config.seed,
    teamA,
    teamB,
    obstacles,
    stateHash,
  };
}

/**
 * 验证地图合法性
 */
export function validateMap(map: GeneratedMap): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 检查点数
  if (map.teamA.length !== map.teamB.length) {
    errors.push(`双方点数不一致: A=${map.teamA.length}, B=${map.teamB.length}`);
  }

  if (map.teamA.length < 6 || map.teamA.length > 10) {
    errors.push(`点数不在 6-10 范围内: ${map.teamA.length}`);
  }

  // 检查坐标范围
  for (const p of map.teamA) {
    if (p.x < -20 || p.x > -4 || p.y < -12 || p.y > 12) {
      errors.push(`Team A 点坐标超出范围: (${p.x}, ${p.y})`);
    }
  }

  for (const p of map.teamB) {
    if (p.x < 4 || p.x > 20 || p.y < -12 || p.y > 12) {
      errors.push(`Team B 点坐标超出范围: (${p.x}, ${p.y})`);
    }
  }

  // 检查点间距
  const allPoints = [...map.teamA.map((p, i) => ({ ...p, team: 'A', id: `A${i + 1}` })),
                     ...map.teamB.map((p, i) => ({ ...p, team: 'B', id: `B${i + 1}` }))];

  for (let i = 0; i < allPoints.length; i++) {
    for (let j = i + 1; j < allPoints.length; j++) {
      const d = distance(allPoints[i], allPoints[j]);
      if (d < FIELD_CONFIG.minDistance) {
        if (allPoints[i].team !== allPoints[j].team) {
          warnings.push(`${allPoints[i].id} 和 ${allPoints[j].id} 过近: ${d.toFixed(2)}`);
        } else {
          errors.push(`${allPoints[i].id} 和 ${allPoints[j].id} 过近: ${d.toFixed(2)}`);
        }
      }
    }
  }

  // 检查障碍物覆盖
  for (const p of allPoints) {
    if (isInsideObstacle(p, map.obstacles)) {
      errors.push(`点 ${p.id} 在障碍物内部`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 批量生成测试地图
 */
export function batchGenerateMaps(count: number, difficulty: 'easy' | 'medium' | 'hard' = 'medium'): GeneratedMap[] {
  const maps: GeneratedMap[] = [];
  const errors: { seed: number; error: string }[] = [];

  for (let i = 0; i < count; i++) {
    const seed = 1000000 + i;
    const map = generateMap({ seed, pointCount: 8, difficulty });
    const validation = validateMap(map);

    if (!validation.valid) {
      errors.push({ seed, error: validation.errors.join('; ') });
    } else {
      maps.push(map);
    }
  }

  console.log(`Generated ${maps.length}/${count} valid maps`);
  if (errors.length > 0) {
    console.log(`Failed seeds:`, errors.slice(0, 5));
  }

  return maps;
}
