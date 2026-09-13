/**
 * ArenaCanvas —— 把一局真实的几何画成一张**坐标纸**。
 *
 * 这个组件是这个界面的签名元素，所以它有两处是刻意做的：
 *
 *   1. **它是一张真的坐标系**。网格、轴、刻度数字都画出来 ——
 *      因为判定就发生在这些坐标里（`|f(x_emitter) − y_emitter| ≤ HIT_EPSILON`）。
 *      别的游戏界面不会画刻度，这里画，是因为它是信息。
 *   2. **轨迹的终止点被显式标出来**。攻击在哪里停下（命中 / 撞上障碍物 /
 *      离开场地）是这个比赛里信息量最大的瞬间，而终端渲染完全没表达它。
 *
 * 一条铁律：**画布只消费引擎判定的轨迹点**。
 * 它从不求值函数 —— 重新求值会画出一条穿过障碍物的曲线，
 * 而真实轨迹在第一次接触障碍物处就永久终止了。
 *
 * 动画由 `requestAnimationFrame` 直接改画布，**不经过 React state** ——
 * 每秒 60 次重渲染整棵组件树是没有必要的。
 *
 * 关于交互（V1.2 §五）：这个画布**依然是展示层**。它接受 `interactive`
 * 之类的开关，把 hover / selected / locked 画出来，把点击换算成 id 交回去 ——
 * 但它**不判定任何东西**：不判命中、不判死活、不判胜负，也不修改 arena。
 * 谁被选中、谁被锁定，全部由调用方持有，画布只是个投影面。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { ArenaView, TrajectoryPayload, WireObstacle, WirePoint } from '../../../src/server/protocol';
import {
  HIT_RADIUS_PX,
  PAD,
  hitTestPoints,
  obstacleToDrawable,
  plotSize,
  projectPoint,
  projectX,
  projectY,
  revealedPoints,
} from './projection';
import type { HitTarget } from './projection';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface ArenaCanvasProps {
  arena: ArenaView;
  /** 已判定、已截断、已降采样的轨迹；为 null 时只画静态局面 */
  trajectory?: TrajectoryPayload | null;
  /** 本轮被击杀的点（画命中闪） */
  killed?: readonly string[];
  /** 是否画刻度数字（小尺寸下可以关掉） */
  ticks?: boolean;

  /**
   * 打开交互：点与器材可 hover、可点击。
   *
   * **不传即与 V1.1 完全一致**（纯只读显示），观众大屏与回放走的正是这条路。
   */
  interactive?: boolean;
  /** 当前选中的 id（由调用方持有 —— 画布不保存业务状态，也不做 toggle） */
  selectedId?: string | null;
  /** 不可再改的 id：画虚线圈 + 底座，只作视觉提示，不参与任何判定 */
  lockedIds?: readonly string[];
  /**
   * 覆盖 hover（比如外部列表与画布联动）。**给具体 id 时才生效**：
   * 不传或传 `null` 都表示「hover 交给画布自己维护」——
   * 这样任何调用方都不可能把 hover 弄没，指针离开画布时也一定能清掉。
   */
  hoveredId?: string | null;
  /** 点击命中某个点/器材时回调其 id；点空白处不回调（清选由调用方决定） */
  onSelectPoint?: (id: string) => void;
}

const COLORS = {
  field: '#0a1017',
  grid: 'rgba(110,150,200,0.085)',
  gridBold: 'rgba(110,150,200,0.17)',
  axis: 'rgba(120,165,215,0.30)',
  border: 'rgba(120,160,205,0.34)',
  a: '#38e0d0',
  b: '#ffab3d',
  impact: '#f2f6ff',
  dead: '#42566b',
  /** 与 CSS 的 `--dim` 同一个色 —— 锁定提示用它，不另起色相 */
  dim: '#4d6076',
  obstacleFill: '#16202c',
  obstacleStroke: 'rgba(150,185,220,0.42)',
  label: 'rgba(125,150,175,0.85)',
};

/** 命中闪的衰减时长（ms）—— 「刚刚发生了什么」的可见窗口 */
const FLASH_MS = 900;

interface DrawState {
  arena: ArenaView;
  trajectory: TrajectoryPayload | null;
  killed: readonly string[];
  revealA: number;
  revealB: number;
  /**
   * 命中闪的强度（0..1）。
   *
   * 它是**一闪**而不是常驻状态：随轨迹推进而亮，动画结束后在 FLASH_MS 内衰减到 0。
   * 若画成常驻，到了下一轮屏幕上还挂着上一轮的「刚刚命中」——那是在说谎。
   */
  flash: number;
  ticks: boolean;
  interactive: boolean;
  hoveredId: string | null;
  selectedId: string | null;
  lockedIds: readonly string[];
}

export function ArenaCanvas({
  arena,
  trajectory = null,
  killed = [],
  ticks = true,
  interactive = false,
  selectedId = null,
  lockedIds,
  hoveredId: hoveredIdProp,
  onSelectPoint,
}: ArenaCanvasProps): JSX.Element {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // hover 由画布内部维护；调用方给了**具体的 id** 才覆盖（null 不算覆盖，见 props 注释）
  const [hoverInternal, setHoverInternal] = useState<string | null>(null);
  const hoveredId = hoveredIdProp != null ? hoveredIdProp : hoverInternal;

  const stateRef = useRef<DrawState>({
    arena,
    trajectory,
    killed,
    revealA: 1,
    revealB: 1,
    flash: 0,
    ticks,
    interactive,
    hoveredId,
    selectedId,
    lockedIds: lockedIds ?? [],
  });
  // 每次都写进 ref：rAF 回调读的是最新值，而不用把 draw 重新挂到 effect 上
  stateRef.current.arena = arena;
  stateRef.current.trajectory = trajectory;
  stateRef.current.killed = killed;
  stateRef.current.ticks = ticks;
  stateRef.current.interactive = interactive;
  stateRef.current.hoveredId = hoveredId;
  stateRef.current.selectedId = selectedId;
  stateRef.current.lockedIds = lockedIds ?? [];

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const s = stateRef.current;
    const field = s.arena.field;
    // 绘图区尺寸与反向投影、命中测试共用同一个 plotSize —— 三方不共享就没有互逆性
    const { w, h } = plotSize(cssW, cssH);

    ctx.save();
    ctx.translate(PAD.l, PAD.t);

    // ---- 纸 ----
    ctx.fillStyle = COLORS.field;
    ctx.fillRect(0, 0, w, h);

    // ---- 网格（每 2 单位细线，每 10 单位粗线）----
    ctx.lineWidth = 1;
    for (let x = Math.ceil(field.xMin / 2) * 2; x <= field.xMax; x += 2) {
      const px = Math.round(projectX(x, field, w)) + 0.5;
      ctx.strokeStyle = x % 10 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let y = Math.ceil(field.yMin / 2) * 2; y <= field.yMax; y += 2) {
      const py = Math.round(projectY(y, field, h)) + 0.5;
      ctx.strokeStyle = y % 10 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // ---- 轴 ----
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    const ax = Math.round(projectX(0, field, w)) + 0.5;
    const ay = Math.round(projectY(0, field, h)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, h);
    ctx.moveTo(0, ay);
    ctx.lineTo(w, ay);
    ctx.stroke();

    // ---- 轨迹（先于障碍物绘制：让「被墙挡住」这件事看得见）----
    const traj = s.trajectory;
    const side = (pts: readonly WirePoint[] | undefined, reveal: number, color: string): void => {
      if (!pts || pts.length === 0) return;
      const shown = revealedPoints(pts, reveal);
      if (shown.length === 0) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      for (let i = 0; i < shown.length; i++) {
        const p = projectPoint(shown[i], field, { w, h });
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 发光头：轨迹正在传播到的位置
      const head = projectPoint(shown[shown.length - 1], field, { w, h });
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(head.x, head.y, reveal >= 1 ? 2.6 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (reveal < 1) {
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 终止环：轨迹**为什么停在这里** —— 命中 / 撞墙 / 出界
      if (reveal >= 1) {
        const end = projectPoint(pts[pts.length - 1], field, { w, h });
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(end.x, end.y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };
    side(traj?.A, s.revealA, COLORS.a);
    side(traj?.B, s.revealB, COLORS.b);

    // ---- 障碍物（盖在轨迹之上）----
    for (const o of s.arena.obstacles) {
      drawObstacle(ctx, o, field, { w, h });
    }

    // ---- 战斗点（alive = 实心环，dead = 空心 + 叉）----
    // 交互状态只在这之后统一叠加：基础图形与只读时**逐像素相同**。
    const selected = s.interactive ? s.selectedId : null;
    const hovered = s.interactive ? s.hoveredId : null;
    const killedSet = new Set(s.killed);
    for (const p of s.arena.points) {
      const c = projectPoint(p.position, field, { w, h });
      const color = p.team === 'A' ? COLORS.a : COLORS.b;
      // 有选中目标时其余点退到背景：选中必须是**一眼可见**的状态
      ctx.globalAlpha = selected !== null && p.id !== selected ? 0.5 : 1;
      if (!p.alive) {
        ctx.strokeStyle = COLORS.dead;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - 3.2, c.y - 3.2);
        ctx.lineTo(c.x + 3.2, c.y + 3.2);
        ctx.moveTo(c.x + 3.2, c.y - 3.2);
        ctx.lineTo(c.x - 3.2, c.y + 3.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.field;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- 命中闪（白热环）----
    // 放在存活/阵亡分支**之后**：本轮被打死的点在这张板上已经是 `alive: false`，
    // 放在分支之内就永远画不出来，这条视觉线索会变成死代码。
    // 只用白，不引入第三种队色之外的彩色。
    if (s.flash > 0.01) {
      ctx.strokeStyle = COLORS.impact;
      ctx.lineWidth = 2;
      for (const p of s.arena.points) {
        if (!killedSet.has(p.id)) continue;
        const c = projectPoint(p.position, field, { w, h });
        ctx.globalAlpha = s.flash;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- 固定 Emitter（最上层，永不被覆盖：它不是战斗点，是器材）----
    // 与战斗点的区分靠**四重**信号，不靠颜色：
    //   圆形 vs 菱形、空心 vs 亮心、尺寸、以及两条「焊在边框一侧」的支架线。
    // 颜色仍用队色（器材也属于某一队），不引入新色相。
    const emit = (e: { id: string; position: WirePoint } | null | undefined, color: string): void => {
      if (!e) return;
      const c = projectPoint(e.position, field, { w, h });
      const outward = e.position.x < 0 ? -1 : 1;
      // 支架长度随画布缩放并设上限：画布很小时它必须缩回来，
      // 否则这条「指向边框」的线会戳出场外（器材贴在边界上）
      const stem = Math.max(7, Math.min(15, w * 0.03));
      // 支架：两条短横线 + 外侧底座，读作「固定器材」而不是「可动的点」
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 3.4);
      ctx.lineTo(c.x + outward * stem, c.y - 3.4);
      ctx.moveTo(c.x, c.y + 3.4);
      ctx.lineTo(c.x + outward * stem, c.y + 3.4);
      ctx.stroke();
      // 锚点：外侧的小方底座 —— 它被钉在这里，位置是器材属性
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(c.x + outward * stem - 2.5, c.y - 4.5, 5, 9);
      ctx.globalAlpha = 1;
      // 菱形主体：比战斗点更大
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 10);
      ctx.lineTo(c.x + 7, c.y);
      ctx.lineTo(c.x, c.y + 10);
      ctx.lineTo(c.x - 7, c.y);
      ctx.closePath();
      ctx.fill();
      // 白描边 + 亮心：战斗点是**暗心**（挖空），器材是**亮心**，形状之外再加一重区分
      ctx.strokeStyle = COLORS.impact;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = COLORS.impact;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    };
    emit(s.arena.emitters?.A, COLORS.a);
    emit(s.arena.emitters?.B, COLORS.b);

    // ---- 交互状态（hover / selected / locked）----
    // 全部叠在最后：它们是「关于这张图的操作提示」，不该被任何图形盖住。
    // 只画装饰 —— 这里没有任何一行会改变 arena 的内容或判定结果。
    if (s.interactive && (hovered !== null || selected !== null || s.lockedIds.length > 0)) {
      const locked = new Set(s.lockedIds);
      for (const m of markers(s.arena)) {
        const c = projectPoint(m.position, field, { w, h });
        const r = m.emitter ? 14.5 : 10;

        // locked：虚线环 + 下方底座 —— 「已经定了，改不动」
        if (locked.has(m.id)) {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = COLORS.dim;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r - 2.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(c.x - 5, c.y + r + 2.5);
          ctx.lineTo(c.x + 5, c.y + r + 2.5);
          ctx.stroke();
          ctx.restore();
        }

        // hover：细描边高亮。已选中的那个不重复画，免得两种状态糊在一起。
        if (m.id === hovered && m.id !== selected) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = COLORS.impact;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // selected：双环 + 四角刻度 —— 比 hover 明显重得多，且有「被夹住」的读法
        if (m.id === selected) {
          ctx.save();
          ctx.strokeStyle = COLORS.impact;
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r + 1.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.42;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.6;
          for (let k = 0; k < 4; k++) {
            const a = Math.PI / 4 + (k * Math.PI) / 2;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(c.x + cos * (r + 3), c.y + sin * (r + 3));
            ctx.lineTo(c.x + cos * (r + 8), c.y + sin * (r + 8));
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }

    // ---- 场地边框 + 刻度 ----
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (s.ticks) {
      ctx.fillStyle = COLORS.label;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = field.xMin; x <= field.xMax; x += 10) {
        ctx.fillText(String(x), projectX(x, field, w), h + 6);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let y = field.yMin; y <= field.yMax; y += 6) {
        if (y === 0) continue;
        ctx.fillText(String(y), -8, projectY(y, field, h));
      }
    }

    ctx.restore();
  }, []);

  // 任何 prop 变化都重画（轨迹没有动画时也要正确显示）
  useEffect(() => {
    draw();
  });

  // 尺寸变化重画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // 轨迹揭示动画
  const trajId = trajectory?.id ?? null;
  useEffect(() => {
    if (!trajectory) {
      stateRef.current.revealA = 1;
      stateRef.current.revealB = 1;
      draw();
      return;
    }
    const hasA = trajectory.A.length > 0;
    const hasB = trajectory.B.length > 0;
    const duration = trajectory.durationMs > 0 ? trajectory.durationMs : 900;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || (!hasA && !hasB)) {
      // 尊重「减少动态效果」：直接落到末帧 —— 末帧一定是**完整**轨迹。
      // 不做闪（阵亡点本身画成空心圈，信息不丢）。
      stateRef.current.revealA = hasA ? 1 : 0;
      stateRef.current.revealB = hasB ? 1 : 0;
      stateRef.current.flash = 0;
      draw();
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const step = (now: number): void => {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / duration);
      stateRef.current.revealA = hasA ? t : 0;
      stateRef.current.revealB = hasB ? t : 0;
      // 轨迹走完之前不闪（闪光点还没到）；之后在 FLASH_MS 内衰减到 0
      stateRef.current.flash =
        elapsed < duration ? 0 : Math.max(0, 1 - (elapsed - duration) / FLASH_MS);
      draw();
      if (elapsed < duration + FLASH_MS) raf = requestAnimationFrame(step);
    };
    stateRef.current.revealA = 0;
    stateRef.current.revealB = 0;
    stateRef.current.flash = 0;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajId, draw]);

  /**
   * 指针 → 命中的 id。
   *
   * 全程在 **CSS 像素**里做：`clientX` 与 `getBoundingClientRect()` 同一坐标系，
   * 因此 `devicePixelRatio` 不参与命中判定 —— 它只决定画布的位图分辨率
   * （见 `draw` 里的 `Math.min(dpr, 2)`），改显示器缩放不会让点变得难点中。
   */
  const pick = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return hitTestPoints(
      markers(arena),
      { x: clientX, y: clientY },
      canvas.getBoundingClientRect(),
      arena.field,
      HIT_RADIUS_PX
    );
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const id = pick(e.clientX, e.clientY);
    if (id !== hoveredId) setHoverInternal(id);
  };

  // 指针离开画布就清掉 hover —— 否则会留下一个「还在指着」的假状态
  const handlePointerLeave = (): void => {
    if (hoveredId !== null) setHoverInternal(null);
  };

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (!onSelectPoint) return;
    const id = pick(e.clientX, e.clientY);
    // 点空白处什么都不做：画布不替调用方决定「取消选中」的语义
    if (id !== null) onSelectPoint(id);
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label={interactive ? t('arena.labelInteractive') : t('arena.label')}
      role="img"
      style={interactive ? { cursor: hoveredId !== null ? 'pointer' : 'default' } : undefined}
      // 只读时**不挂任何监听**：V1.1 的行为与 DOM 一字不差
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerLeave={interactive ? handlePointerLeave : undefined}
      onClick={interactive ? handleClick : undefined}
    />
  );
}

/** 画布上「可标注 / 可点」的东西 —— 战斗点与固定器材 */
interface Marker {
  id: string;
  position: WirePoint;
  emitter: boolean;
}

/**
 * 收集可点目标。
 *
 * 器材排在战斗点**之后**：`hitTestPoints` 等距时后者优先，
 * 于是「设备压在点上」时点中的是设备 —— 与画面上谁在最上层一致。
 */
function markers(arena: ArenaView): Marker[] {
  const out: Marker[] = arena.points.map((p) => ({ id: p.id, position: p.position, emitter: false }));
  for (const e of [arena.emitters?.A, arena.emitters?.B]) {
    if (e) out.push({ id: e.id, position: e.position, emitter: true });
  }
  return out;
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  o: WireObstacle,
  field: ArenaView['field'],
  size: { w: number; h: number }
): void {
  const d = obstacleToDrawable(o, field, size);
  ctx.beginPath();
  switch (d.kind) {
    case 'rect':
      ctx.rect(d.x!, d.y!, d.w!, d.h!);
      break;
    case 'circle':
      // 必须用 ellipse：绘图区非等比，数学圆在屏幕上就是椭圆。
      // 画成正圆会让画面与引擎判定（真圆）对不上 —— 轨迹看着有缝或提前停。
      ctx.ellipse(d.cx!, d.cy!, d.rx!, d.ry!, 0, 0, Math.PI * 2);
      break;
    case 'segment':
      ctx.moveTo(d.x1!, d.y1!);
      ctx.lineTo(d.x2!, d.y2!);
      break;
    case 'polygon': {
      const pts = d.points ?? [];
      if (pts.length === 0) return;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      break;
    }
  }
  if (d.kind !== 'segment') {
    ctx.fillStyle = COLORS.obstacleFill;
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.obstacleStroke;
  // 线段障碍物零厚度，给一点线宽才看得见（与判定无关，纯显示）
  ctx.lineWidth = d.kind === 'segment' ? 2.5 : 1;
  ctx.stroke();
}
