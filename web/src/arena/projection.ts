/**
 * 数学坐标 ↔ 屏幕像素（**纯函数**，无 DOM、无 Canvas）
 *
 * 与终端 `src/ui/ArenaView.ts` 的 `projectX`/`projectY` 是同一条映射规则，
 * 只是输出到像素而不是字符网格。放在纯函数里是为了能回归 ——
 * 渲染本身（Canvas 调用）不可断言，投影必须可以。
 *
 * 约定：
 *   - 数学 y 轴向上，屏幕 y 轴向下 —— 因此 y 方向要翻转；
 *   - 结果一律夹取在场内，越界点画在边界上而不是画到画布外。
 */

import type { WireField, WireObstacle, WirePoint } from '../../../src/server/protocol';

export interface Size {
  w: number;
  h: number;
}

export interface Drawable {
  kind: 'rect' | 'circle' | 'segment' | 'polygon';
  /** rect */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** circle */
  cx?: number;
  cy?: number;
  r?: number;
  /** segment */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** polygon */
  points?: { x: number; y: number }[];
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** 数学 x → 屏幕列（0 .. w-1） */
export function projectX(x: number, field: WireField, w: number): number {
  const t = (x - field.xMin) / (field.xMax - field.xMin);
  return clamp01(t) * (w - 1);
}

/** 数学 y → 屏幕行（0 .. h-1，**已翻转**） */
export function projectY(y: number, field: WireField, h: number): number {
  const t = (y - field.yMin) / (field.yMax - field.yMin);
  return (1 - clamp01(t)) * (h - 1);
}

export function projectPoint(p: WirePoint, field: WireField, size: Size): { x: number; y: number } {
  return { x: projectX(p.x, field, size.w), y: projectY(p.y, field, size.h) };
}

/** 障碍物 → 可直接绘制的屏幕几何 */
export function obstacleToDrawable(o: WireObstacle, field: WireField, size: Size): Drawable {
  switch (o.type) {
    case 'rectangle': {
      const x = projectX(o.xmin, field, size.w);
      const y = projectY(o.ymax, field, size.h);
      return {
        kind: 'rect',
        x,
        y,
        w: projectX(o.xmax, field, size.w) - x,
        h: projectY(o.ymin, field, size.h) - y,
      };
    }
    case 'circle':
      return {
        kind: 'circle',
        cx: projectX(o.center[0], field, size.w),
        cy: projectY(o.center[1], field, size.h),
        // 半径按最小边缩放；圆在非等比画布上画成椭圆会误导观感，这里取等比
        r: (o.radius / (field.xMax - field.xMin)) * (size.w - 1),
      };
    case 'segment':
      return {
        kind: 'segment',
        x1: projectX(o.x1, field, size.w),
        y1: projectY(o.y1, field, size.h),
        x2: projectX(o.x2, field, size.w),
        y2: projectY(o.y2, field, size.h),
      };
    case 'polygon':
      return {
        kind: 'polygon',
        points: o.vertices.map((v) => ({
          x: projectX(v[0], field, size.w),
          y: projectY(v[1], field, size.h),
        })),
      };
  }
}

/**
 * 取轨迹的前 `ratio` 段（动画揭示用）。
 *
 * 与终端 `ArenaView.revealed()` **同一条语义**：
 *   - 空轨迹 → 空数组；
 *   - ratio ≤ 0 → 仍然给 1 个点（否则「刚开始传播」那一帧什么都看不见）；
 *   - ratio ≥ 1 → **完整**轨迹（动画结束时画面必须与判定结果一致）；
 *   - 只做**前缀切片**，绝不重采样、绝不求值函数。
 */
export function revealedPoints(pts: readonly WirePoint[], ratio: number): readonly WirePoint[] {
  if (pts.length === 0) return [];
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  if (r >= 1) return pts;
  return pts.slice(0, Math.max(1, Math.round(r * pts.length)));
}

/**
 * 揭示比例随时间的推进（0..1）。
 *
 * 纯函数，方便回归；真实播放由 `requestAnimationFrame` 驱动。
 */
export function ratioAt(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return clamp01(elapsedMs / durationMs);
}
