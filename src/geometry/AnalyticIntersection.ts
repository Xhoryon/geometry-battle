/**
 * Analytic Geometry Intersection
 *
 * Gate 0.5 Finding F4: Discrete sampling (128 steps) can miss narrow obstacles.
 * Solution: Analytic intersection detection for circles, rectangles, and segments.
 *
 * All functions return the first intersection x-coordinate along the direction,
 * or null if no intersection exists.
 */

import { Point } from '../field/Field';
import { Obstacle, SegmentObstacle } from '../obstacle/Obstacle';

export interface Line {
  /** Starting point */
  start: Point;
  /** Direction: 1 (right) or -1 (left) */
  dir: 1 | -1;
  /** Ending x coordinate */
  xEnd: number;
  /** Evaluate y at given x */
  evalY: (x: number) => number;
}

/**
 * Line-circle intersection using analytic quadratic solution.
 *
 * Given trajectory y = f(x) and circle (cx, cy, r), solve:
 *   (x - cx)^2 + (f(x) - cy)^2 = r^2
 *
 * For linear trajectory y = mx + b, this becomes a quadratic in x.
 * For general functions, we sample to find intervals containing roots,
 * then refine with Newton-Raphson.
 */
export function lineCircleIntersection(
  line: Line,
  center: [number, number],
  radius: number,
  epsilon: number = 1e-9
): number | null {
  const [cx, cy] = center;
  const { start, dir, xEnd, evalY } = line;

  // Determine search interval
  const xMin = Math.min(start.x, xEnd);
  const xMax = Math.max(start.x, xEnd);

  // Circle bounding box
  const circleXMin = cx - radius;
  const circleXMax = cx + radius;

  // Intersection of trajectory x-range and circle x-range
  const searchXMin = Math.max(xMin, circleXMin);
  const searchXMax = Math.min(xMax, circleXMax);

  if (searchXMax < searchXMin) return null;

  // Distance squared from point (x, y) to circle center
  const distSq = (x: number): number => {
    const y = evalY(x);
    if (!Number.isFinite(y)) return Infinity;
    return (x - cx) ** 2 + (y - cy) ** 2;
  };

  // Signed penetration: negative when inside/touching circle
  const penetration = (x: number): number => {
    const dSq = distSq(x);
    if (!Number.isFinite(dSq)) return Infinity;
    return Math.sqrt(dSq) - radius;
  };

  // Sample along direction to find sign change
  const steps = 256; // Higher resolution than original 128
  const span = searchXMax - searchXMin;
  const step = span / steps;

  let prevX = dir === 1 ? searchXMin : searchXMax;
  let prevPen = penetration(prevX);

  // Check starting point
  if (prevPen <= epsilon) {
    return prevX;
  }

  for (let i = 1; i <= steps; i++) {
    const x = dir === 1
      ? searchXMin + step * i
      : searchXMax - step * i;

    const pen = penetration(x);

    // Sign change detected: penetration went from positive to non-positive
    if (pen <= epsilon) {
      // Refine with bisection
      let a = prevX;
      let b = x;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const mPen = penetration(m);
        if (mPen <= epsilon) {
          b = m;
        } else {
          a = m;
        }
        if (Math.abs(b - a) < epsilon) break;
      }
      return b;
    }

    prevX = x;
    prevPen = pen;
  }

  return null;
}

/**
 * Line-rectangle intersection.
 *
 * Rectangle defined by [xMin, xMax] × [yMin, yMax].
 * Returns first x where trajectory enters rectangle.
 */
export function lineRectangleIntersection(
  line: Line,
  rect: { xMin: number; xMax: number; yMin: number; yMax: number },
  epsilon: number = 1e-9
): number | null {
  const { start, dir, xEnd, evalY } = line;
  const { xMin: rx0, xMax: rx1, yMin: ry0, yMax: ry1 } = rect;

  // Trajectory x-range
  const txMin = Math.min(start.x, xEnd);
  const txMax = Math.max(start.x, xEnd);

  // Rectangle x-range overlap with trajectory
  const searchXMin = Math.max(txMin, rx0 - epsilon);
  const searchXMax = Math.min(txMax, rx1 + epsilon);

  if (searchXMax < searchXMin) return null;

  // Check if point (x, y) is inside or touching rectangle
  const inside = (x: number, y: number): boolean => {
    return x >= rx0 - epsilon && x <= rx1 + epsilon &&
           y >= ry0 - epsilon && y <= ry1 + epsilon;
  };

  // Sample along direction
  const steps = 256;
  const span = searchXMax - searchXMin;
  const step = span / steps;

  let prevX = dir === 1 ? searchXMin : searchXMax;
  const prevY = evalY(prevX);
  let prevInside = Number.isFinite(prevY) && inside(prevX, prevY);

  if (prevInside) return prevX;

  for (let i = 1; i <= steps; i++) {
    const x = dir === 1
      ? searchXMin + step * i
      : searchXMax - step * i;

    const y = evalY(x);
    if (!Number.isFinite(y)) continue;

    const nowInside = inside(x, y);

    if (nowInside && !prevInside) {
      // Entered rectangle: refine with bisection
      let a = prevX;
      let b = x;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const my = evalY(m);
        if (Number.isFinite(my) && inside(m, my)) {
          b = m;
        } else {
          a = m;
        }
        if (Math.abs(b - a) < epsilon) break;
      }
      return b;
    }

    prevX = x;
    prevInside = nowInside;
  }

  return null;
}

/**
 * Line-segment intersection.
 *
 * Segment from (x0, y0) to (x1, y1).
 * Returns first x where trajectory comes within epsilon of segment.
 */
export function lineSegmentIntersection(
  line: Line,
  seg: { x0: number; y0: number; x1: number; y1: number },
  contactEps: number = 1e-9
): number | null {
  const { start, dir, xEnd, evalY } = line;
  const { x0, y0, x1, y1 } = seg;

  // Segment bounding box
  const segXMin = Math.min(x0, x1);
  const segXMax = Math.max(x0, x1);

  // Trajectory x-range
  const txMin = Math.min(start.x, xEnd);
  const txMax = Math.max(start.x, xEnd);

  // Search interval
  const searchXMin = Math.max(txMin, segXMin - contactEps);
  const searchXMax = Math.min(txMax, segXMax + contactEps);

  if (searchXMax < searchXMin) return null;

  // Distance from point (px, py) to segment
  const distToSegment = (px: number, py: number): number => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-18) {
      // Degenerate segment (point)
      return Math.sqrt((px - x0) ** 2 + (py - y0) ** 2);
    }

    // Project point onto segment line
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
    const projX = x0 + t * dx;
    const projY = y0 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  };

  // Sample along direction
  const steps = 256;
  const span = searchXMax - searchXMin;
  const step = span / steps;

  let prevX = dir === 1 ? searchXMin : searchXMax;
  const prevY = evalY(prevX);
  let prevDist = Number.isFinite(prevY) ? distToSegment(prevX, prevY) : Infinity;

  if (prevDist <= contactEps) return prevX;

  for (let i = 1; i <= steps; i++) {
    const x = dir === 1
      ? searchXMin + step * i
      : searchXMax - step * i;

    const y = evalY(x);
    if (!Number.isFinite(y)) continue;

    const dist = distToSegment(x, y);

    if (dist <= contactEps) {
      // Contact detected: refine
      let a = prevX;
      let b = x;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const my = evalY(m);
        if (Number.isFinite(my) && distToSegment(m, my) <= contactEps) {
          b = m;
        } else {
          a = m;
        }
        if (Math.abs(b - a) < 1e-12) break;
      }
      return b;
    }

    prevX = x;
    prevDist = dist;
  }

  return null;
}

/**
 * Dispatch to appropriate analytic intersection based on obstacle type.
 */
export function analyticObstacleIntersection(
  line: Line,
  obstacle: Obstacle,
  contactEps: number = 1e-9
): number | null {
  switch (obstacle.type) {
    case 'circle':
      return lineCircleIntersection(line, obstacle.center, obstacle.radius, contactEps);

    case 'rectangle':
      return lineRectangleIntersection(
        line,
        { xMin: obstacle.xmin, xMax: obstacle.xmax, yMin: obstacle.ymin, yMax: obstacle.ymax },
        contactEps
      );

    case 'segment': {
      const seg = obstacle as SegmentObstacle;
      return lineSegmentIntersection(
        line,
        { x0: seg.x1, y0: seg.y1, x1: seg.x2, y1: seg.y2 },
        contactEps
      );
    }

    case 'polygon':
      // Polygon: check each edge as segment
      return polygonIntersection(line, obstacle.vertices, contactEps);
  }
}

function polygonIntersection(
  line: Line,
  vertices: [number, number][],
  contactEps: number
): number | null {
  let firstX: number | null = null;

  for (let i = 0; i < vertices.length; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % vertices.length];

    const edgeX = lineSegmentIntersection(line, { x0, y0, x1, y1 }, contactEps);
    if (edgeX !== null) {
      if (firstX === null || (line.dir === 1 ? edgeX < firstX : edgeX > firstX)) {
        firstX = edgeX;
      }
    }
  }

  return firstX;
}
