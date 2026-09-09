/**
 * 障碍物系统 - 支持线段、矩形、圆、多边形
 * Plan V1: 障碍物类型定义
 */

import { Point } from '../field/Field';

export type ObstacleType = 'segment' | 'rectangle' | 'circle' | 'polygon';

export interface BaseObstacle {
  type: ObstacleType;
}

export interface SegmentObstacle extends BaseObstacle {
  type: 'segment';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RectangleObstacle extends BaseObstacle {
  type: 'rectangle';
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface CircleObstacle extends BaseObstacle {
  type: 'circle';
  center: [number, number];
  radius: number;
}

export interface PolygonObstacle extends BaseObstacle {
  type: 'polygon';
  vertices: [number, number][];
}

export type Obstacle = SegmentObstacle | RectangleObstacle | CircleObstacle | PolygonObstacle;

/**
 * 计算点到线段的距离
 */
export function distanceToSegment(p: Point, seg: SegmentObstacle): number {
  const { x1, y1, x2, y2 } = seg;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.sqrt((p.x - x1) ** 2 + (p.y - y1) ** 2);
  }

  let t = ((p.x - x1) * dx + (p.y - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/**
 * 计算点到矩形的距离（外部）
 */
export function distanceToRectangle(p: Point, rect: RectangleObstacle): number {
  const { xmin, xmax, ymin, ymax } = rect;

  if (p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax) {
    return 0; // 点在矩形内部
  }

  const dx = Math.max(xmin - p.x, 0, p.x - xmax);
  const dy = Math.max(ymin - p.y, 0, p.y - ymax);

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算点到圆的距离
 */
export function distanceToCircle(p: Point, circle: CircleObstacle): number {
  const [cx, cy] = circle.center;
  const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
  return Math.abs(dist - circle.radius);
}

/**
 * 计算点到多边形的距离（简化：使用顶点距离）
 */
export function distanceToPolygon(p: Point, poly: PolygonObstacle): number {
  let minDist = Infinity;

  for (let i = 0; i < poly.vertices.length; i++) {
    const [x1, y1] = poly.vertices[i];
    const [x2, y2] = poly.vertices[(i + 1) % poly.vertices.length];

    const seg: SegmentObstacle = { type: 'segment', x1, y1, x2, y2 };
    const dist = distanceToSegment(p, seg);
    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

/**
 * 计算点到障碍物的距离
 */
export function distanceToObstacle(p: Point, obstacle: Obstacle): number {
  switch (obstacle.type) {
    case 'segment':
      return distanceToSegment(p, obstacle);
    case 'rectangle':
      return distanceToRectangle(p, obstacle);
    case 'circle':
      return distanceToCircle(p, obstacle);
    case 'polygon':
      return distanceToPolygon(p, obstacle);
  }
}

/**
 * 检查点是否在障碍物上（距离小于阈值）
 */
export function isOnObstacle(p: Point, obstacle: Obstacle, threshold: number = 2): boolean {
  return distanceToObstacle(p, obstacle) < threshold;
}

/**
 * 检查点是否在障碍物内部（适用于圆形和矩形）
 */
export function isInsideObstacle(p: Point, obstacle: Obstacle): boolean {
  switch (obstacle.type) {
    case 'rectangle': {
      const { xmin, xmax, ymin, ymax } = obstacle;
      return p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax;
    }
    case 'circle': {
      const [cx, cy] = obstacle.center;
      const distSq = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      return distSq <= obstacle.radius ** 2;
    }
    default:
      return false;
  }
}
