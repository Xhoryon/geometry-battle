/**
 * Deterministic Seeded Map Generator
 *
 * 修复的 Finding：
 *   P2-23 `if (!placed)` 强制放置绕过所有约束（可能生成障碍物内的出生点）
 *   P3-13 弱 LCG 随机数（低位周期短、分布差）
 *   P2-24 地图合法性仅靠调用方自觉
 *
 * 新语义：
 *   - 生成失败时返回 null，由调用方换种子重试或干净地失败
 *   - 绝不强制产生非法点（P2-23）
 *   - 增加公平性过滤：障碍物不得在单方区域内形成贯通墙
 */

import * as crypto from 'crypto';
import { Point } from '../field/Field';
import { Obstacle, distanceToObstacle } from '../obstacle/Obstacle';
import {
  DIFFICULTY_OBSTACLES,
  FIELD,
  MIN_POINT_DISTANCE,
  EMITTERS,
  POINT_COUNT_RANGE,
  POINT_OBSTACLE_CLEARANCE,
} from '../core/Rules';

export interface MapConfig {
  seed: number;
  pointCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GeneratedMap {
  seed: number;
  teamA: Point[];
  teamB: Point[];
  /**
   * 固定 Emitter（Rule Revision 3 §3）：本队函数在整个 Match 的发射锚点。
   *
   * **刻意不进 `teamA` / `teamB`** —— 它不是战斗点：不计入存活数、不能被击杀、
   * 不能作为胜利目标。把它放在数组外，`getWinner()` / `aliveAfter` /
   * 敌人筛选 / `markDead()` 这些「遍历 Points」的地方就**天然**碰不到它，
   * 不需要在每处加 `role !== 'emitter'` 判断（那是漏判的温床）。
   */
  emitterA: Point;
  emitterB: Point;
  obstacles: Obstacle[];
  /** 地图内容哈希（供 RoundState 使用） */
  stateHash: string;
}

export interface MapValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** mulberry32 —— 确定性、分布良好（替代原 LCG） */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
    // 预热，避免相近种子产生相近序列
    for (let i = 0; i < 8; i++) this.next();
  }
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isInsideObstacle(p: Point, obstacles: Obstacle[]): boolean {
  for (const obs of obstacles) {
    switch (obs.type) {
      case 'rectangle':
        if (p.x >= obs.xmin && p.x <= obs.xmax && p.y >= obs.ymin && p.y <= obs.ymax) return true;
        break;
      case 'circle':
        if (Math.hypot(p.x - obs.center[0], p.y - obs.center[1]) <= obs.radius) return true;
        break;
      case 'segment': {
        const { x1, y1, x2, y2 } = obs;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / lenSq));
        if (Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy)) <= 0.5) return true;
        break;
      }
      case 'polygon': {
        let inside = false;
        const v = obs.vertices;
        for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
          const [xi, yi] = v[i];
          const [xj, yj] = v[j];
          if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return true;
        break;
      }
    }
  }
  return false;
}

function obstacleYExtent(o: Obstacle): [number, number] {
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

function obstacleXExtent(o: Obstacle): [number, number] {
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

/**
 * 障碍物是否完全落在场地内（P3-7）。
 *
 * `generateObstacle` 只在「中心点 ±3」的范围内取中心，但半径最大到 6，
 * 于是圆/矩形可能伸出场地边界。伸出去的部分永远不影响判定（点都在场内、
 * 轨迹也在场边截断），但 §20 要求地图几何本身合法，所以这里直接拒绝该种子。
 */
function obstacleInField(o: Obstacle): boolean {
  const [x0, x1] = obstacleXExtent(o);
  const [y0, y1] = obstacleYExtent(o);
  return x0 >= FIELD.xMin && x1 <= FIELD.xMax && y0 >= FIELD.yMin && y1 <= FIELD.yMax;
}

/** 障碍物是否在某方区域内形成贯通 y 轴的墙（会彻底封锁一方） */
function formsWallInZone(o: Obstacle, xRange: [number, number]): boolean {
  const [x0, x1] = obstacleXExtent(o);
  const overlaps = x1 >= xRange[0] && x0 <= xRange[1];
  if (!overlaps) return false;
  const [y0, y1] = obstacleYExtent(o);
  return y0 <= FIELD.yMin + 0.5 && y1 >= FIELD.yMax - 0.5;
}

function generateObstacle(rng: Rng, cfg: { count: number; sizeRange: [number, number] }): Obstacle {
  const useRect = rng.next() > 0.5;
  const x = rng.float(FIELD.xMin + 3, FIELD.xMax - 3);
  const y = rng.float(FIELD.yMin + 2, FIELD.yMax - 2);
  const size = rng.float(cfg.sizeRange[0], cfg.sizeRange[1]);

  if (useRect) {
    const w = size;
    const h = size * rng.float(0.4, 0.8);
    return {
      type: 'rectangle',
      xmin: x - w,
      xmax: x + w,
      ymin: y - h,
      ymax: y + h,
    };
  }
  return { type: 'circle', center: [x, y], radius: size };
}

function placeTeam(
  rng: Rng,
  range: [number, number],
  count: number,
  other: Point[],
  obstacles: Obstacle[]
): Point[] | null {
  const points: Point[] = [];
  const maxAttempts = 4000;

  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = rng.float(range[0] + 1, range[1] - 1);
      const y = rng.float(FIELD.yMin + 2, FIELD.yMax - 2);
      const candidate = { x, y };

      if (isInsideObstacle(candidate, obstacles)) continue;
      // 公平性过滤：出生点不得紧贴障碍物（否则可能被彻底封死）
      if (obstacles.some((o) => distanceToObstacle(candidate, o) < POINT_OBSTACLE_CLEARANCE)) {
        continue;
      }
      let ok = true;
      for (const p of [...other, ...points]) {
        if (distance(candidate, p) < MIN_POINT_DISTANCE) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      points.push(candidate);
      placed = true;
      break;
    }
    // 绝不强制放置（P2-23）
    if (!placed) return null;
  }
  return points;
}

/** 尝试用给定种子生成一张地图；失败返回 null */
export function tryGenerateMap(config: MapConfig): GeneratedMap | null {
  const rng = new Rng(config.seed);
  const cfg = DIFFICULTY_OBSTACLES[config.difficulty];
  const obstacles: Obstacle[] = [];

  for (let i = 0; i < cfg.count; i++) {
    const obs = generateObstacle(rng, cfg);
    if (!obstacleInField(obs)) return null; // 几何越界 → 本种子失败（P3-7）
    if (formsWallInZone(obs, FIELD.teamAXRange) || formsWallInZone(obs, FIELD.teamBXRange)) {
      // 会封锁一方 → 本种子失败
      return null;
    }
    obstacles.push(obs);
  }

  // Emitter 位置是全局常量，但出生点必须与它保持 MIN_POINT_DISTANCE，
  // 否则会在锚点上叠一个战斗点（几何上毫无意义，回放里也画不开）。
  const emitterA = EMITTERS.A;
  const emitterB = EMITTERS.B;

  const teamA = placeTeam(rng, FIELD.teamAXRange, config.pointCount, [emitterA], obstacles);
  if (!teamA) return null;
  const teamB = placeTeam(rng, FIELD.teamBXRange, config.pointCount, [emitterB], obstacles);
  if (!teamB) return null;

  const map: GeneratedMap = {
    seed: config.seed,
    teamA,
    teamB,
    emitterA,
    emitterB,
    obstacles,
    stateHash: '',
  };
  map.stateHash = computeMapHash(map);

  const validation = validateMap(map);
  return validation.valid ? map : null;
}

/**
 * 生成地图。若某个种子不可用则顺序尝试 seed, seed+1, ... 最多 512 次。
 * 全部失败时抛出 —— 不允许静默返回非法地图。
 */
export function generateMap(config: MapConfig): GeneratedMap {
  const map = generateMapOrNull(config);
  if (!map) {
    throw new Error(
      `无法从 seed=${config.seed} 起生成合法地图（已尝试 ${MAX_SEED_ATTEMPTS} 个种子）`
    );
  }
  return map;
}

export const MAX_SEED_ATTEMPTS = 512;

export function generateMapOrNull(config: MapConfig): GeneratedMap | null {
  for (let i = 0; i < MAX_SEED_ATTEMPTS; i++) {
    const map = tryGenerateMap({ ...config, seed: config.seed + i });
    if (map) return map;
  }
  return null;
}

export function computeMapHash(map: Omit<GeneratedMap, 'stateHash'>): string {
  const canonical = JSON.stringify({
    seed: map.seed,
    teamA: map.teamA,
    teamB: map.teamB,
    // Emitter 是常量，但**必须进哈希**：地图哈希是「这一局是什么世界」的
    // 完整承诺，事后改常量而不改哈希会让归档世界不可复核。
    emitterA: map.emitterA,
    emitterB: map.emitterB,
    obstacles: map.obstacles,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function validateMap(map: GeneratedMap): MapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (map.teamA.length !== map.teamB.length) {
    errors.push(`双方点数不一致: A=${map.teamA.length}, B=${map.teamB.length}`);
  }
  if (map.teamA.length < POINT_COUNT_RANGE[0] || map.teamA.length > POINT_COUNT_RANGE[1]) {
    errors.push(`点数不在 ${POINT_COUNT_RANGE[0]}-${POINT_COUNT_RANGE[1]} 范围内: ${map.teamA.length}`);
  }

  for (const p of map.teamA) {
    if (p.x < FIELD.teamAXRange[0] || p.x > FIELD.teamAXRange[1] || p.y < FIELD.yMin || p.y > FIELD.yMax) {
      errors.push(`Team A 点坐标超出范围: (${p.x}, ${p.y})`);
    }
  }
  for (const p of map.teamB) {
    if (p.x < FIELD.teamBXRange[0] || p.x > FIELD.teamBXRange[1] || p.y < FIELD.yMin || p.y > FIELD.yMax) {
      errors.push(`Team B 点坐标超出范围: (${p.x}, ${p.y})`);
    }
  }

  const all = [
    ...map.teamA.map((p, i) => ({ ...p, team: 'A' as const, id: `A${i + 1}` })),
    ...map.teamB.map((p, i) => ({ ...p, team: 'B' as const, id: `B${i + 1}` })),
  ];

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const d = distance(all[i], all[j]);
      if (d < MIN_POINT_DISTANCE) {
        if (all[i].team !== all[j].team) {
          warnings.push(`${all[i].id} 与 ${all[j].id} 距离过近: ${d.toFixed(2)}`);
        } else {
          errors.push(`${all[i].id} 与 ${all[j].id} 距离过近: ${d.toFixed(2)}`);
        }
      }
    }
  }

  for (const p of all) {
    if (isInsideObstacle(p, map.obstacles)) errors.push(`点 ${p.id} 位于障碍物内部`);
    for (const o of map.obstacles) {
      const d = distanceToObstacle(p, o);
      if (d < POINT_OBSTACLE_CLEARANCE) {
        errors.push(`点 ${p.id} 紧贴障碍物（间距 ${d.toFixed(3)} < ${POINT_OBSTACLE_CLEARANCE}）`);
      }
    }
  }

  // ---- Emitter 的公平性（Rule Revision 3 §3/§7）----
  // 与任何出生点享受同一套保护：不落在障碍物内部、不紧贴障碍物，
  // 且与所有战斗点保持 MIN_POINT_DISTANCE。Emitter 被障碍物封死等同于
  // 该队永远无法命中任何东西 —— 这是必须整局作废的公平性缺陷，不是 warning。
  for (const team of ['A', 'B'] as const) {
    const e = team === 'A' ? map.emitterA : map.emitterB;
    const label = `Emitter ${team}`;
    if (e.x < FIELD.xMin || e.x > FIELD.xMax || e.y < FIELD.yMin || e.y > FIELD.yMax) {
      errors.push(`${label} 坐标越出场地: (${e.x}, ${e.y})`);
    }
    if (isInsideObstacle(e, map.obstacles)) errors.push(`${label} 位于障碍物内部`);
    for (const o of map.obstacles) {
      const d = distanceToObstacle(e, o);
      if (d < POINT_OBSTACLE_CLEARANCE) {
        errors.push(`${label} 紧贴障碍物（间距 ${d.toFixed(3)} < ${POINT_OBSTACLE_CLEARANCE}）`);
      }
    }
    for (const p of all) {
      const d = distance(e, p);
      if (d < MIN_POINT_DISTANCE) {
        errors.push(`${label} 与 ${p.id} 距离过近: ${d.toFixed(2)}`);
      }
    }
  }

  for (const o of map.obstacles) {
    if (!obstacleInField(o)) {
      errors.push(`障碍物越出场地边界: ${JSON.stringify(o)}`);
    }
    if (formsWallInZone(o, FIELD.teamAXRange) || formsWallInZone(o, FIELD.teamBXRange)) {
      errors.push('存在彻底封锁一方的障碍物');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** 批量生成（测试/压力验证用） */
export function batchGenerateMaps(
  count: number,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  pointCount = 8
): { valid: GeneratedMap[]; failed: { seed: number; error: string }[] } {
  const valid: GeneratedMap[] = [];
  const failed: { seed: number; error: string }[] = [];

  for (let i = 0; i < count; i++) {
    const seed = 1_000_000 + i * 7919;
    const map = tryGenerateMap({ seed, pointCount, difficulty });
    if (!map) {
      failed.push({ seed, error: '该种子无法生成合法地图' });
    } else {
      valid.push(map);
    }
  }
  return { valid, failed };
}
