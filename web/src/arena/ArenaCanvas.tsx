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
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ArenaView, TrajectoryPayload, WireObstacle, WirePoint } from '../../../src/server/protocol';
import { obstacleToDrawable, projectPoint, projectX, projectY, revealedPoints } from './projection';
import type { JSX } from 'react';

export interface ArenaCanvasProps {
  arena: ArenaView;
  /** 已判定、已截断、已降采样的轨迹；为 null 时只画静态局面 */
  trajectory?: TrajectoryPayload | null;
  /** 本轮被击杀的点（画命中闪） */
  killed?: readonly string[];
  /** 是否画刻度数字（小尺寸下可以关掉） */
  ticks?: boolean;
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
  obstacleFill: '#16202c',
  obstacleStroke: 'rgba(150,185,220,0.42)',
  label: 'rgba(125,150,175,0.85)',
};

/** 命中闪的衰减时长（ms）—— 「刚刚发生了什么」的可见窗口 */
const FLASH_MS = 900;

/** 让场地四周留出刻度数字的位置 */
const PAD = { l: 40, r: 18, t: 16, b: 28 };

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
}

export function ArenaCanvas({ arena, trajectory = null, killed = [], ticks = true }: ArenaCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<DrawState>({ arena, trajectory, killed, revealA: 1, revealB: 1, flash: 0, ticks });
  // 每次都写进 ref：rAF 回调读的是最新值，而不用把 draw 重新挂到 effect 上
  stateRef.current.arena = arena;
  stateRef.current.trajectory = trajectory;
  stateRef.current.killed = killed;
  stateRef.current.ticks = ticks;

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
    const w = Math.max(10, cssW - PAD.l - PAD.r);
    const h = Math.max(10, cssH - PAD.t - PAD.b);

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

    // ---- 战斗点 ----
    const killedSet = new Set(s.killed);
    for (const p of s.arena.points) {
      const c = projectPoint(p.position, field, { w, h });
      const color = p.team === 'A' ? COLORS.a : COLORS.b;
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
    const emit = (e: { id: string; position: WirePoint } | null | undefined, color: string): void => {
      if (!e) return;
      const c = projectPoint(e.position, field, { w, h });
      const outward = e.position.x < 0 ? -1 : 1;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.6;
      // 支架：一条指向场内的短横线
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + outward * 11, c.y);
      ctx.stroke();
      // 锚点：菱形（与圆形的战斗点明确区分）
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 7);
      ctx.lineTo(c.x + 5.5, c.y);
      ctx.lineTo(c.x, c.y + 7);
      ctx.lineTo(c.x - 5.5, c.y);
      ctx.closePath();
      ctx.fill();
    };
    emit(s.arena.emitters?.A, COLORS.a);
    emit(s.arena.emitters?.B, COLORS.b);

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

  return <canvas ref={canvasRef} aria-label="竞技场" role="img" />;
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
      ctx.arc(d.cx!, d.cy!, d.r!, 0, Math.PI * 2);
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
