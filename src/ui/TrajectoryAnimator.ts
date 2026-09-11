/**
 * TrajectoryAnimator —— 现场轨迹动画（Rule Revision 3 §25）
 *
 * 把「已判定的轨迹」逐帧揭示出来。分两层：
 *
 *   1. **帧源**（纯函数）：`buildAnimationFrames()` 把两条轨迹切成 N 帧的
 *      `reveal` 比例序列。可回归、可复现、与终端无关。
 *   2. **播放器**：`playAnimation()` 在 TTY 上原位重绘；**非 TTY**（日志、CI、
 *      重定向）时退化为打印若干关键帧 —— 不做任何 ANSI 操作，也不假装有动画。
 *
 * 设计约束：
 *   - 动画**只读**：它消费引擎判定出的轨迹，绝不重新求值函数。
 *     用原始函数重算会画出一条穿过障碍物的曲线 —— 现场看到的就是错的。
 *   - 不引入依赖：ANSI 转义序列由本文件自己写，不引 chalk / ora / blessed。
 *   - 帧数与耗时由调用方给；本模块不读时钟，只按 `delayMs` 节流。
 */

import { Point } from '../field/Field';
import { ArenaFrame, renderArena } from './ArenaView';

/**
 * 计算轨迹动画帧（**由已判定的轨迹**生成，Rule Revision 3 §25）。
 *
 * 为什么以「轨迹」而不是「函数」为输入：观众要看的是**判定结果**，
 * 不是数学曲线。原始函数会一路画到定义域尽头，而真实轨迹在第一次障碍物接触
 * 或第一次离开 Arena 处就**永久终止**。用函数重采样会画出一条穿过障碍物的曲线，
 * 现场看到的将是错的。
 *
 * 逐帧是**增量**的：第 k 帧 = 前 k 段，不重新采样前面的部分。
 * 因此总代价是 O(点数)，而不是 O(帧数 × 点数)。
 *
 * `frameCount` 大于点数时退化为「一段一帧」；为 0 或负数时返回空数组。
 */
export function computeTrajectoryFrames(
  trajectory: readonly Point[],
  frameCount: number = 30
): Point[][] {
  if (frameCount <= 0 || trajectory.length === 0) return [];
  const total = trajectory.length;
  // 单点轨迹也走满帧数（每帧都只有那一个点）—— 帧数恒定，
  // 调用方不必为退化情形写特例。
  const frames: Point[][] = [];
  for (let i = 0; i < frameCount; i++) {
    // 第 i 帧揭示到 (i+1)/frameCount；至少一个点，至多全部
    const upto = Math.max(1, Math.min(total, Math.ceil(((i + 1) / frameCount) * total)));
    const frame: Point[] = [];
    for (let k = 0; k < upto; k++) frame.push({ ...trajectory[k] });
    frames.push(frame);
  }
  return frames;
}

export interface AnimationFrame {
  /** 本次揭示的轨迹比例（A / B 各自） */
  revealA: number;
  revealB: number;
}

export interface AnimationPlan {
  frames: AnimationFrame[];
  /** 总时长（ms） */
  durationMs: number;
}

export interface AnimationOptions {
  /** 帧数（默认 24） */
  frameCount?: number;
  /** 每帧间隔（ms，默认 45） */
  frameMs?: number;
  /** 只有一方有轨迹时是否仍然走满帧数（默认 true，保持现场节奏稳定） */
  padSingle?: boolean;
}

export const DEFAULT_ANIMATION_FRAME_COUNT = 24;
export const DEFAULT_ANIMATION_FRAME_MS = 45;

/**
 * 生成动画计划（纯函数）。
 *
 * 双方轨迹同时推进 —— 这符合规则：START 之后双方的攻击权是**独立**的，
 * 现场不应该让后手方「等」先手方播完。
 */
export function buildAnimationFrames(o: {
  lengthA: number;
  lengthB: number;
  frameCount?: number;
  frameMs?: number;
}): AnimationPlan {
  const frames = Math.max(1, o.frameCount ?? DEFAULT_ANIMATION_FRAME_COUNT);
  const frameMs = Math.max(0, o.frameMs ?? DEFAULT_ANIMATION_FRAME_MS);
  const plan: AnimationFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const t = (i + 1) / frames;
    plan.push({
      revealA: o.lengthA > 0 ? t : 0,
      revealB: o.lengthB > 0 ? t : 0,
    });
  }
  return { frames: plan, durationMs: frames * frameMs };
}

/** 把动画计划套用到一帧竞技场数据上 */
export function frameAt(plan: AnimationPlan, index: number, base: ArenaFrame): ArenaFrame {
  const f = plan.frames[Math.min(Math.max(0, index), plan.frames.length - 1)];
  if (!f) return base;
  return { ...base, revealA: f.revealA, revealB: f.revealB };
}

/** 终端动画播放的抽象：便于测试注入假的输出与时钟 */
export interface PlaybackSink {
  /** 是否支持原位重绘（TTY）。false 时只打印关键帧 */
  interactive: boolean;
  write(text: string): void;
  /** 等待 ms 毫秒 */
  wait(ms: number): Promise<void>;
}

export interface PlaybackResult {
  /** 实际渲染并输出的帧数 */
  renderedFrames: number;
  /** 是否走了原位重绘路径 */
  interactive: boolean;
}

/**
 * 播放一段动画。
 *
 * - `interactive === true`：逐帧清屏重绘（ANSI `\x1b[H\x1b[2J`），最后停在**完整**轨迹。
 * - `interactive === false`：只在开头、中点、结尾各打印一帧 —— 日志里看得到「有动画」，
 *   但不会把 24 帧灌进归档。
 *
 * 无论走哪条路，**最后一帧一定是完整轨迹**（动画结束时画面必须与判定结果一致）。
 */
export async function playAnimation(
  sink: PlaybackSink,
  plan: AnimationPlan,
  base: ArenaFrame,
  render: (f: ArenaFrame) => string = (f) => renderArena(f)
): Promise<PlaybackResult> {
  const last = plan.frames.length - 1;
  if (!sink.interactive) {
    const picks = [...new Set([0, Math.floor(last / 2), last])].filter((i) => i >= 0);
    for (const i of picks) {
      sink.write(`\n[动画帧 ${i + 1}/${last + 1}]\n` + render(frameAt(plan, i, base)));
    }
    return { renderedFrames: picks.length, interactive: false };
  }

  const frameMs = plan.frames.length > 0 ? Math.round(plan.durationMs / plan.frames.length) : 0;
  for (let i = 0; i <= last; i++) {
    sink.write(CLEAR_SCREEN + render(frameAt(plan, i, base)));
    if (i < last) await sink.wait(frameMs);
  }
  return { renderedFrames: last + 1, interactive: true };
}

/** ANSI：光标归位 + 清屏。自己写而不是引依赖（§0 的零依赖约束） */
export const CLEAR_SCREEN = '\x1b[H\x1b[2J';

/**
 * 从真实引擎数据构造动画的两条轨迹。
 *
 * **只做降采样**：轨迹可能在几万点量级，终端一次画不完。
 * 这里保留首尾与均分点，保证「起始点、终止点」一定在画面里 ——
 * 动画的观感取决于终点是否准确（它代表攻击在哪里停下）。
 */
export function downsampleTrajectory(points: readonly Point[], maxPoints = 240): Point[] {
  if (points.length <= maxPoints) return points.map((p) => ({ ...p }));
  const out: Point[] = [];
  const stride = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push({ ...points[Math.round(i * stride)] });
  }
  return out;
}

/** 默认播放器：真 TTY 走原位重绘，否则退化为关键帧 */
export function createTerminalSink(out: { write(s: string): void } = process.stdout): PlaybackSink {
  return {
    interactive: Boolean((process.stdout as { isTTY?: boolean }).isTTY),
    write: (text) => out.write(text),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
