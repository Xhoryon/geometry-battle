/**
 * Function Visualizer - Renders function graphs and animations
 * Plan 2 Phase F/G: Audience UI and Animation
 */

import { Point } from '../field/Field';
import { CanonicalNode, evaluateNode } from '../core/Ast';

export interface VisualizerConfig {
  width: number;
  height: number;
  xRange: [number, number];
  yRange: [number, number];
  animationDuration: number;  // ms per shot
}

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  width: 1200,
  height: 600,
  xRange: [-25, 25],
  yRange: [-15, 15],
  animationDuration: 450,
};

/**
 * 渲染函数图像上的点
 */
export function sampleFunctionPoints(
  fn: CanonicalNode,
  xStart: number,
  xEnd: number,
  step: number = 0.05
): Point[] {
  const points: Point[] = [];
  const direction = xEnd > xStart ? 1 : -1;
  const actualStep = step * direction;

  for (let x = xStart; direction > 0 ? x <= xEnd : x >= xEnd; x += actualStep) {
    const y = evaluateNode(fn, x);
    if (isFinite(y) && !isNaN(y)) {
      points.push({ x, y });
    }
  }

  return points;
}

/**
 * 计算轨迹动画帧
 */
export function computeAnimationFrames(
  fn: CanonicalNode,
  xStart: number,
  xEnd: number,
  frameCount: number = 30
): Point[][] {
  const frames: Point[][] = [];
  const direction = xEnd > xStart ? 1 : -1;
  const totalDistance = Math.abs(xEnd - xStart);
  const stepPerFrame = totalDistance / frameCount;

  for (let i = 1; i <= frameCount; i++) {
    const currentX = xStart + stepPerFrame * i * direction;
    const framePoints = sampleFunctionPoints(fn, xStart, currentX, 0.05);
    frames.push(framePoints);
  }

  return frames;
}

/**
 * 坐标转换：数学坐标 -> Canvas 像素
 */
export function mathToCanvas(
  point: Point,
  config: VisualizerConfig
): { x: number; y: number } {
  const { width, height, xRange, yRange } = config;
  const x = ((point.x - xRange[0]) / (xRange[1] - xRange[0])) * width;
  const y = height - ((point.y - yRange[0]) / (yRange[1] - yRange[0])) * height;
  return { x, y };
}

/**
 * Canvas 坐标 -> 数学坐标
 */
export function canvasToMath(
  canvasX: number,
  canvasY: number,
  config: VisualizerConfig
): Point {
  const { width, height, xRange, yRange } = config;
  const x = (canvasX / width) * (xRange[1] - xRange[0]) + xRange[0];
  const y = ((height - canvasY) / height) * (yRange[1] - yRange[0]) + yRange[0];
  return { x, y };
}

/**
 * 生成 SVG 路径字符串
 */
export function pointsToSvgPath(points: Point[], config: VisualizerConfig): string {
  if (points.length === 0) return '';

  const canvasPoints = points.map(p => mathToCanvas(p, config));
  let path = `M ${canvasPoints[0].x} ${canvasPoints[0].y}`;

  for (let i = 1; i < canvasPoints.length; i++) {
    path += ` L ${canvasPoints[i].x} ${canvasPoints[i].y}`;
  }

  return path;
}

/**
 * 一支队伍在观众屏上的状态。
 *
 * `emitter` 取代了旧的 `shooter`：Rule Revision 3 §2–§4 之后发射锚点整场固定，
 * 不再是「每轮选出来的那个点」。
 */
export interface AudienceTeamState {
  name: string;
  /** 剩余**战斗点**数（不含 Emitter —— 它不是战斗点，§3/§9） */
  alive: number;
  /** 固定 Emitter 的标识（恒为 'A0' / 'B0'） */
  emitter: string | null;
  computing: boolean;
  computeTime: number | null;
  function: string | null;
}

/**
 * Audience Screen 显示状态
 */
export interface AudienceState {
  roundNumber: number;
  phase: string;
  teamA: AudienceTeamState;
  teamB: AudienceTeamState;
  trajectoryA: Point[] | null;
  trajectoryB: Point[] | null;
  hits: string[];
  winner: 'A' | 'B' | 'draw' | null;
}

/**
 * 生成 Audience Screen 文字描述
 */
export function formatAudienceState(state: AudienceState): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════`);
  lines.push(`           ROUND ${state.roundNumber}`);
  lines.push(`═══════════════════════════════════════`);
  lines.push(``);
  lines.push(`  TEAM A                      TEAM B`);
  lines.push(`  ${state.teamA.alive} ALIVE                    ${state.teamB.alive} ALIVE`);
  lines.push(``);

  // Shooter status
  const emitterA = state.teamA.emitter || '???';
  const emitterB = state.teamB.emitter || '???';
  lines.push(`  Emitter: ${emitterA}              Emitter: ${emitterB}   (fixed)`);
  lines.push(``);

  // Compute status
  if (state.teamA.computing || state.teamB.computing) {
    lines.push(`  A COMPUTING...              B COMPUTING...`);
  } else if (state.teamA.function && state.teamB.function) {
    lines.push(`  ${state.teamA.function.substring(0, 20)}...`);
    lines.push(`  ${state.teamB.function.substring(0, 20)}...`);
    if (state.teamA.computeTime !== null && state.teamB.computeTime !== null) {
      lines.push(`  Time: ${state.teamA.computeTime.toFixed(2)}ms          Time: ${state.teamB.computeTime.toFixed(2)}ms`);
    }
  }

  // Hits
  if (state.hits.length > 0) {
    lines.push(``);
    lines.push(`  HITS: ${state.hits.join(', ')}`);
  }

  // Winner
  if (state.winner) {
    lines.push(``);
    if (state.winner === 'draw') {
      lines.push(`              DRAW`);
    } else {
      lines.push(`           TEAM ${state.winner} WINS`);
    }
  }

  return lines.join('\n');
}

/**
 * 生成动画帧数据（用于前端）
 */
export interface AnimationFrame {
  frame: number;
  totalFrames: number;
  trajectoryA: Point[];
  trajectoryB: Point[];
  headA: Point | null;
  headB: Point | null;
  hits: string[];
}

export function generateAnimationData(
  fnA: CanonicalNode | null,
  fnB: CanonicalNode | null,
  xStartA: number,
  xEndA: number,
  xStartB: number,
  xEndB: number,
  frameCount: number = 30
): AnimationFrame[] {
  const frames: AnimationFrame[] = [];

  const trajA = fnA ? computeAnimationFrames(fnA, xStartA, xEndA, frameCount) : [];
  const trajB = fnB ? computeAnimationFrames(fnB, xStartB, xEndB, frameCount) : [];

  const maxFrames = Math.max(trajA.length, trajB.length);

  for (let i = 0; i < maxFrames; i++) {
    frames.push({
      frame: i + 1,
      totalFrames: maxFrames,
      trajectoryA: trajA[i] || [],
      trajectoryB: trajB[i] || [],
      headA: trajA[i]?.slice(-1)[0] || null,
      headB: trajB[i]?.slice(-1)[0] || null,
      hits: [],
    });
  }

  return frames;
}
