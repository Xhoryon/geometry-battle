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

/**
 * 画布四周留出刻度数字的固定内边距（**CSS 像素**）。
 *
 * 正向投影（`projectX`/`projectY`）只认「绘图区」的宽高 —— 它不知道画布有多大。
 * 因此**反向投影与鼠标换算必须先扣掉这份 PAD**。
 *
 * 这里把它导出、并让 `ArenaCanvas` 从这里导入，而不是在组件里再抄一份：
 * 两份常量一旦漂移，画面与鼠标就会错位，而且错得很隐蔽。
 */
export const PAD = { l: 40, r: 18, t: 16, b: 28 } as const;

/**
 * 画布 CSS 尺寸 → 绘图区尺寸。
 *
 * 正向投影、反向投影、鼠标换算三方**必须**用它算出的同一个 `Size`，
 * 这是互逆性的前提（见 `unprojectX`）。
 */
export function plotSize(cssW: number, cssH: number): Size {
  return { w: Math.max(10, cssW - PAD.l - PAD.r), h: Math.max(10, cssH - PAD.t - PAD.b) };
}

/**
 * 指针命中半径（CSS 像素）。
 *
 * 定在**像素**空间而不是数学空间：命中手感必须与缩放无关 ——
 * 场地放大一倍时，能点中的区域不该跟着缩一半。
 */
export const HIT_RADIUS_PX = 14;

export interface Drawable {
  kind: 'rect' | 'circle' | 'segment' | 'polygon';
  /** rect */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /**
   * circle —— **两个**半径，不是一个。
   *
   * 引擎判定的是一张数学平面上的**真圆**（`Judge.ts` 用欧氏距离）。
   * 绘图区几乎不可能正好是 40:24 的等比缩放（`PAD` 固定、画布随布局伸缩），
   * 于是「x 方向 1 单位」与「y 方向 1 单位」对应的像素数并不相等 ——
   * 一个数学圆在屏幕上本该画成椭圆。
   *
   * 早先这里只存一个 `r`（按 x 轴缩放），在任何宽屏布局下都会把圆画得
   * 比真实几何**更高**：轨迹看起来在碰到障碍物之前就停了，
   * 障碍物之间也会看起来重叠。**画错形状才是真的误导观感。**
   */
  cx?: number;
  cy?: number;
  /** 水平半径（像素）—— 由 `projectX` 的尺度决定 */
  rx?: number;
  /** 垂直半径（像素）—— 由 `projectY` 的尺度决定，与 `rx` 一般不相等 */
  ry?: number;
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

/**
 * 数学长度（半径 / 半边长）→ 像素长度，**沿某一个轴**。
 *
 * 与 `projectX` / `projectY` 用同一套尺度（分母同样是 `pixels - 1`），
 * 否则画出来的形状与判定用的几何不是同一个。
 *
 * `x` 轴传 `size.w` 与 `xMax - xMin`，`y` 轴传 `size.h` 与 `yMax - yMin`。
 */
export function projectRadius(radius: number, span: number, pixels: number): number {
  if (span <= 0) return 0;
  return (radius / span) * (pixels - 1);
}

// ============================================================================
// 反向投影（屏幕像素 → 数学坐标）
//
// **互逆性是这个模块的硬约束**，三件事必须同时成立：
//
//   1. 正向用 `w - 1` / `h - 1` 作分母（`xMax` 落在最后一列像素上），
//      反向也必须用同一个分母 —— 差 1 像素就是 `40 / (w-1)` 个数学单位；
//   2. 两端的 `w` / `h` 必须是**同一个绘图区尺寸**。画布有 `PAD` 内边距，
//      正向只认绘图区，所以反向（以及鼠标）必须先扣掉 PAD ——
//      扣错了不会报错，只会让鼠标整体偏移一格刻度；
//   3. 正向**夹取**越界点（`clamp01`），所以互逆只在
//      `x ∈ [xMin, xMax]`、`y ∈ [yMin, yMax]` 内严格成立；场外像素
//      反解出来会落到界外，这是有意的（调用方自己决定要不要夹）。
//
// 即：对任意 x ∈ [xMin, xMax] 与任意 w > 1，
//     unprojectX(projectX(x, field, w), field, w) === x（浮点误差内），
// 反向亦然。回归套件盯的就是这条。
// ============================================================================

/** 屏幕列 → 数学 x。与 `projectX` 严格互逆（见上）。 */
export function unprojectX(px: number, field: WireField, w: number): number {
  const denom = w - 1;
  if (denom <= 0) return field.xMin;
  return field.xMin + (px / denom) * (field.xMax - field.xMin);
}

/** 屏幕行 → 数学 y（**已翻转**）。与 `projectY` 严格互逆（见上）。 */
export function unprojectY(py: number, field: WireField, h: number): number {
  const denom = h - 1;
  if (denom <= 0) return field.yMin;
  return field.yMin + (1 - py / denom) * (field.yMax - field.yMin);
}

/** 屏幕点 → 数学点（坐标仍是**绘图区**坐标，不含 PAD） */
export function unprojectPoint(
  p: { x: number; y: number },
  field: WireField,
  size: Size
): WirePoint {
  return { x: unprojectX(p.x, field, size.w), y: unprojectY(p.y, field, size.h) };
}

/** `getBoundingClientRect()` 需要的最小信息 —— 用普通对象描述，保持本模块无 DOM */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 画布上的**客户端坐标**（`event.clientX/clientY`，CSS 像素，含 PAD）
 * → 数学坐标。
 *
 * 这是鼠标换算的完整一步：先减掉画布在页面中的位置，再减掉 PAD，
 * 最后反向投影。`devicePixelRatio` 不参与 —— `clientX` 与
 * `rect.width` 都是 CSS 像素，位图分辨率与此无关
 * （dpr 只影响画布的 `width`/`height` 属性，见 `ArenaCanvas` 的绘制）。
 */
export function clientToMath(
  clientX: number,
  clientY: number,
  rect: RectLike,
  field: WireField
): WirePoint {
  const size = plotSize(rect.width, rect.height);
  return {
    x: unprojectX(clientX - rect.left - PAD.l, field, size.w),
    y: unprojectY(clientY - rect.top - PAD.t, field, size.h),
  };
}

/** 命中的候选目标 —— 战斗点与固定器材都是「可点的东西」 */
export interface HitTarget {
  id: string;
  position: WirePoint;
}

/**
 * 命中测试：返回**离指针最近**且在 `radiusPx` 内的目标 id，没有则 `null`。
 *
 * 全程在**屏幕像素**里比距离（`projectPoint` + PAD），而不是先反解成数学坐标
 * 再比：一来命中半径才是肉眼看到的那个半径，二来省掉一次正反往返的浮点误差。
 * 因此它与 `unproject*` 是两条独立的路径，都建立在同一份正向投影上。
 *
 * 越界（指针在画布外）时距离自然超出半径，返回 `null`，无需特判。
 * 半径内等距时**后出现的目标优先** —— 调用方把器材排在战斗点之后，
 * 于是「设备压在点上」时点中的是设备，与画面上谁在最上层一致。
 */
export function hitTestPoints(
  targets: readonly HitTarget[],
  at: { x: number; y: number },
  rect: RectLike,
  field: WireField,
  radiusPx: number
): string | null {
  const size = plotSize(rect.width, rect.height);
  const localX = at.x - rect.left - PAD.l;
  const localY = at.y - rect.top - PAD.t;
  let best: string | null = null;
  let bestD2 = radiusPx * radiusPx;
  for (const t of targets) {
    const p = projectPoint(t.position, field, size);
    const dx = p.x - localX;
    const dy = p.y - localY;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = t.id;
    }
  }
  return best;
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
        // 两个轴各按**自己**的尺度缩放，画出来才是那个数学圆。
        // 分母与 projectX/projectY 完全一致（`w - 1` / `h - 1`）——
        // 差一像素就是「画面与判定不是同一个形状」。
        rx: projectRadius(o.radius, field.xMax - field.xMin, size.w),
        ry: projectRadius(o.radius, field.yMax - field.yMin, size.h),
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
