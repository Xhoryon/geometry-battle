/**
 * Canonical Judge — 比赛唯一 Source of Truth
 *
 * Plan V1 §21 命中判定：
 *   |f(x_p) - y_p| <= ε  且  点在攻击方向上  且  点在第一个障碍物接触位置之前
 * Plan V1 §22 障碍物判定：
 *   轨迹第一次与任何障碍物接触后，攻击仅在该位置之前有效。
 *
 * 修复的 Finding：
 *   P0-9  executeShots() 不检查障碍物
 *   P1-7  圆形/多边形障碍物永不阻挡
 *   P1-9  命中容差 0.3/0.1 与验证 2.0 不一致 → 统一 HIT_EPSILON
 *   P1-27 验证仅覆盖己方半场 → 攻击方向由 firingDomain 强制
 *   P2-24 胜负由 judgeX 处比较 y 值决定 → 改为真实轨迹结算
 */

import { Point } from '../field/Field';
import {
  Obstacle,
  SegmentObstacle,
  distanceToSegment,
  distanceToRectangle,
  distanceToCircle,
  distanceToPolygon,
} from '../obstacle/Obstacle';
import { CanonicalNode, evaluateNode, analyzeComplexity, oscillationBound } from './Ast';
import { FIELD, HIT_EPSILON, OBSTACLE_CONTACT_EPS, attackEndX } from './Rules';

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export type TrajectoryEndReason =
  | 'FIELD_EDGE'
  | 'OBSTACLE'
  | 'OUT_OF_FIELD'
  | 'NON_FINITE'
  | 'MAX_POINTS';

export interface BlockInfo {
  obstacleIndex: number;
  obstacle: Obstacle;
  at: TrajectoryPoint;
}

export interface ShotOutcome {
  team: 'A' | 'B';
  hits: string[];
  killed: string[];
  blocked: BlockInfo | null;
  endReason: TrajectoryEndReason;
  trajectory: TrajectoryPoint[];
  /** 命中点及其 x 坐标（用于回放/动画排序） */
  hitDetails: { id: string; at: TrajectoryPoint }[];
}

/** 障碍物「穿透深度」：外部为正，接触/内部为 0 —— 连续函数，便于二分求首次接触 */
export function penetration(p: Point, obstacle: Obstacle): number {
  switch (obstacle.type) {
    case 'segment': {
      const d = distanceToSegment(p, obstacle);
      return Math.max(0, d - OBSTACLE_CONTACT_EPS);
    }
    case 'rectangle':
      return distanceToRectangle(p, obstacle);
    case 'circle': {
      const [cx, cy] = obstacle.center;
      const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      return Math.max(0, d - obstacle.radius);
    }
    case 'polygon': {
      const inside = pointInPolygon(p, obstacle.vertices);
      if (inside) return 0;
      return distanceToPolygon(p, obstacle);
    }
  }
}

function pointInPolygon(p: Point, vertices: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 障碍物在 x 轴上的投影范围 */
function obstacleXRange(obstacle: Obstacle): [number, number] {
  switch (obstacle.type) {
    case 'segment':
      return [Math.min(obstacle.x1, obstacle.x2), Math.max(obstacle.x1, obstacle.x2)];
    case 'rectangle':
      return [obstacle.xmin, obstacle.xmax];
    case 'circle':
      return [obstacle.center[0] - obstacle.radius, obstacle.center[0] + obstacle.radius];
    case 'polygon': {
      const xs = obstacle.vertices.map((v) => v[0]);
      return [Math.min(...xs), Math.max(...xs)];
    }
  }
}

/**
 * 求曲线在 [xLo, xHi] 上与障碍物「首次接触」的 x。
 * 沿传播方向 dir 扫描，找到第一个 penetration <= 0 的位置并二分细化。
 */
function firstContactX(
  ast: CanonicalNode,
  obstacle: Obstacle,
  xLo: number,
  xHi: number,
  dir: 1 | -1
): number | null {
  const [ox0, ox1] = obstacleXRange(obstacle);
  const lo = Math.max(xLo, Math.min(ox0, ox1));
  const hi = Math.min(xHi, Math.max(ox0, ox1));
  if (hi < lo) return null;

  const pen = (x: number) => {
    const y = evaluateNode(ast, x);
    if (!Number.isFinite(y)) return Infinity;
    return penetration({ x, y }, obstacle);
  };

  // 退化为单个 x（例如垂直线段，x 跨度为零）：直接在该处判定。
  // 否则下面的采样区间为空，这类障碍物会永远无法阻挡。
  if (hi === lo) return pen(lo) <= 0 ? lo : null;

  // 沿传播方向归一化：从 start 到 end
  const start = dir === 1 ? lo : hi;
  const end = dir === 1 ? hi : lo;
  const span = Math.abs(end - start);
  const steps = 128;
  const step = (span / steps) * dir;

  let prevX = start;
  let prevP = pen(prevX);
  if (prevP <= 0) return prevX;

  for (let i = 1; i <= steps; i++) {
    const x = start + step * i;
    const p = pen(x);
    if (p <= 0) {
      // 在 [prevX, x] 之间二分
      let a = prevX;
      let b = x;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        if (pen(m) <= 0) b = m;
        else a = m;
      }
      return b;
    }
    prevX = x;
    prevP = p;
  }
  return null;
}

/** 传播顺序比较：x 是否严格早于 limit（沿 dir 方向） */
function isBefore(x: number, limit: number, dir: 1 | -1): boolean {
  return dir === 1 ? x < limit - 1e-12 : x > limit + 1e-12;
}

/**
 * 计算轨迹（Plan V1 §38：从 Shooter 出发，到地图边界或第一个障碍物为止）。
 */
export function traceTrajectory(
  ast: CanonicalNode,
  shooter: Point,
  team: 'A' | 'B',
  obstacles: Obstacle[]
): { points: TrajectoryPoint[]; blocked: BlockInfo | null; endReason: TrajectoryEndReason } {
  const xEnd = attackEndX(team);
  const dir: 1 | -1 = xEnd > shooter.x ? 1 : -1;

  const complexity = analyzeComplexity(ast);
  const omega = oscillationBound(ast, [
    Math.min(shooter.x, xEnd),
    Math.max(shooter.x, xEnd),
  ]);
  const baseStep = Number.isFinite(omega) && omega > 0
    ? Math.min(0.005, Math.PI / (8 * omega))
    : 0.005;
  const span = Math.abs(xEnd - shooter.x);
  const maxPoints = 200_000;
  const h = Math.max(baseStep, span / maxPoints);

  // ---- 1. 首次接触位置（所有障碍物取传播方向上最早者）----
  let blocked: BlockInfo | null = null;
  for (let i = 0; i < obstacles.length; i++) {
    const cx = firstContactX(ast, obstacles[i], Math.min(shooter.x, xEnd), Math.max(shooter.x, xEnd), dir);
    if (cx === null) continue;
    if (!blocked || isBefore(cx, blocked.at.x, dir)) {
      const y = evaluateNode(ast, cx);
      blocked = { obstacleIndex: i, obstacle: obstacles[i], at: { x: cx, y } };
    }
  }

  // ---- 2. 采样轨迹，在障碍物处截断 ----
  const points: TrajectoryPoint[] = [];
  let endReason: TrajectoryEndReason = 'FIELD_EDGE';

  for (let i = 0; i <= maxPoints; i++) {
    const x = shooter.x + dir * h * i;
    if (dir === 1 ? x > xEnd + 1e-12 : x < xEnd - 1e-12) break;

    if (blocked && !isBefore(x, blocked.at.x, dir)) {
      points.push({ x: blocked.at.x, y: blocked.at.y });
      endReason = 'OBSTACLE';
      break;
    }

    const y = evaluateNode(ast, x);
    if (!Number.isFinite(y)) {
      endReason = 'NON_FINITE';
      break;
    }
    if (y < FIELD.yMin - 1e-9 || y > FIELD.yMax + 1e-9) {
      endReason = 'OUT_OF_FIELD';
      break;
    }
    points.push({ x, y });

    if (Math.abs(x - xEnd) <= h) break;
  }

  if (points.length === 0) points.push({ x: shooter.x, y: evaluateNode(ast, shooter.x) });

  return { points, blocked, endReason };
}

/**
 * 结算一次攻击。
 *
 * @param aliveEnemies 敌方仍然存活的点（含 id）
 */
export function judgeShot(
  ast: CanonicalNode,
  shooter: Point,
  team: 'A' | 'B',
  aliveEnemies: { id: string; position: Point }[],
  obstacles: Obstacle[],
  epsilon: number = HIT_EPSILON
): ShotOutcome {
  const { points, blocked, endReason } = traceTrajectory(ast, shooter, team, obstacles);
  const xEnd = attackEndX(team);
  const dir: 1 | -1 = xEnd > shooter.x ? 1 : -1;

  const endX = points.length > 0 ? points[points.length - 1].x : shooter.x;

  const hitDetails: { id: string; at: TrajectoryPoint }[] = [];

  for (const enemy of aliveEnemies) {
    // 方向约束：敌人必须位于攻击方向上（P1-27）
    if (dir === 1 ? enemy.position.x < shooter.x - 1e-12 : enemy.position.x > shooter.x + 1e-12) {
      continue;
    }
    // 轨迹已经结束（场地边界 / 障碍物截断）之后不受影响
    if (dir === 1 ? enemy.position.x > endX + 1e-12 : enemy.position.x < endX - 1e-12) {
      continue;
    }
    if (blocked && !isBefore(enemy.position.x, blocked.at.x, dir)) continue;

    // 命中判定是「点是否在函数图像上」：|f(x_e) - y_e| <= ε
    const y = evaluateNode(ast, enemy.position.x);
    if (!Number.isFinite(y)) continue;
    if (Math.abs(y - enemy.position.y) > epsilon) continue;

    hitDetails.push({ id: enemy.id, at: { x: enemy.position.x, y } });
  }

  hitDetails.sort((a, b) => (dir === 1 ? a.at.x - b.at.x : b.at.x - a.at.x));

  return {
    team,
    hits: hitDetails.map((d) => d.id),
    killed: hitDetails.map((d) => d.id),
    blocked,
    endReason,
    trajectory: points,
    hitDetails,
  };
}
