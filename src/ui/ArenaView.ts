/**
 * ArenaView —— 终端里的竞技场渲染（Rule Revision 3 §23/§25）
 *
 * 把一局的真实几何画成等宽字符网格：场地边界、障碍物、固定 Emitter、
 * 战斗点（存活/阵亡）、以及攻击轨迹。**观众屏与裁判台共用同一份渲染**，
 * 区别只在于「显示哪些层」与「是否附带诊断信息」。
 *
 * 设计约束：
 *   - 只用 Unicode 制表符与 ASCII，不依赖 ANSI 颜色 / 清屏 / TTY 能力 ——
 *     现场投影、日志归档、测试断言用同一份文本；
 *   - 纯函数、无 IO、无定时器：给定同一帧永远画出同一张图（可回归、可回放）；
 *   - 宽度自适应：调用方给出列宽与行高，渲染结果一定落在该尺寸内。
 */

import { Point } from '../field/Field';
import { Obstacle, isInsideObstacle } from '../obstacle/Obstacle';
import { FIELD } from '../core/Rules';

export interface ArenaMarker {
  id: string;
  team: 'A' | 'B';
  position: Point;
  /** false 表示这个点已经被击杀（画成 × 而不是实心标记） */
  alive: boolean;
}

export interface ArenaEmitter {
  id: string;
  position: Point;
}

export interface ArenaFrame {
  obstacles?: readonly Obstacle[];
  emitters?: { A: ArenaEmitter | null; B: ArenaEmitter | null } | null;
  points?: readonly ArenaMarker[];
  /** 轨迹（已经降采样），A/B 分别绘制 */
  trajectoryA?: readonly Point[];
  trajectoryB?: readonly Point[];
  /** 本轮被击杀的点（高亮用；文本模式下画成 ×） */
  killed?: readonly string[];
}

const GLYPH = {
  empty: ' ',
  obstacle: '▓',
  emitterA: 'Ⓐ',
  emitterB: 'Ⓑ',
  pointA: 'a',
  pointB: 'b',
  deadA: '×',
  deadB: '×',
  trajA: '.',
  trajB: ',',
  border: '─',
  corner: '+',
  vertical: '|',
};

/** 把一个数学坐标映射到网格坐标（y 轴向上，网格行号向下，因此要翻转） */
function projectX(x: number, cols: number): number {
  const t = (x - FIELD.xMin) / (FIELD.xMax - FIELD.xMin);
  return Math.min(cols - 1, Math.max(0, Math.round(t * (cols - 1))));
}

function projectY(y: number, rows: number): number {
  const t = (y - FIELD.yMin) / (FIELD.yMax - FIELD.yMin);
  return Math.min(rows - 1, Math.max(0, Math.round((1 - t) * (rows - 1))));
}

/**
 * 渲染一帧竞技场。
 *
 * @param cols 场地内部的列数（不含左右边框）
 * @param rows 场地内部的行数（不含上下边框）
 */
export function renderArena(frame: ArenaFrame, cols = 59, rows = 17): string {
  const grid: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill(GLYPH.empty));

  const put = (p: Point, glyph: string, overwrite = true): void => {
    const c = projectX(p.x, cols);
    const r = projectY(p.y, rows);
    if (!overwrite && grid[r][c] !== GLYPH.empty) return;
    grid[r][c] = glyph;
  };

  // ---- 1. 障碍物（背景层）----
  for (const o of frame.obstacles ?? []) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = FIELD.xMin + ((FIELD.xMax - FIELD.xMin) * c) / (cols - 1);
        const y = FIELD.yMax - ((FIELD.yMax - FIELD.yMin) * r) / (rows - 1);
        if (isInsideObstacle({ x, y }, o)) grid[r][c] = GLYPH.obstacle;
      }
    }
  }

  // ---- 2. 轨迹（不覆盖障碍物，让阻挡关系看得见）----
  for (const p of frame.trajectoryA ?? []) put(p, GLYPH.trajA, false);
  for (const p of frame.trajectoryB ?? []) put(p, GLYPH.trajB, false);

  // ---- 3. 战斗点 ----
  const killed = new Set(frame.killed ?? []);
  for (const p of frame.points ?? []) {
    const dead = !p.alive || killed.has(p.id);
    put(p.position, dead ? GLYPH.deadA : p.team === 'A' ? GLYPH.pointA : GLYPH.pointB);
  }

  // ---- 4. 固定 Emitter（最上层：它永远存在，不会被覆盖）----
  if (frame.emitters?.A) put(frame.emitters.A.position, GLYPH.emitterA);
  if (frame.emitters?.B) put(frame.emitters.B.position, GLYPH.emitterB);

  // ---- 组装成边框 + 网格 ----
  const body = grid.map((row) => GLYPH.vertical + row.join('') + GLYPH.vertical);
  const top = GLYPH.corner + GLYPH.border.repeat(cols) + GLYPH.corner;
  return [top, ...body, top].join('\n');
}

/** 竞技场的图例 —— 观众屏必须能看懂字符含义（§25） */
export function arenaLegend(): string {
  return (
    `${GLYPH.emitterA}/${GLYPH.emitterB} fixed emitter   ` +
    `${GLYPH.pointA}/${GLYPH.pointB} alive combat point   ` +
    `${GLYPH.deadA} dead   ${GLYPH.obstacle} obstacle   ` +
    `${GLYPH.trajA}/${GLYPH.trajB} trajectory (A/B)`
  );
}

/** 坐标轴标尺（让「图上的位置」能对回真实坐标） */
export function arenaRuler(cols = 59): string {
  const left = FIELD.xMin;
  const right = FIELD.xMax;
  const mid = (left + right) / 2;
  const label = (v: number): string => `${v}`;
  const span = cols - 1;
  const l = label(left);
  const m = label(mid);
  const r = label(right);
  const pad = span - l.length - m.length - r.length + 1;
  const gapL = Math.floor(pad / 2);
  const gapR = pad - gapL;
  return ` y∈[${FIELD.yMin}, ${FIELD.yMax}]   x: ${l}${' '.repeat(Math.max(1, gapL))}${m}${' '.repeat(
    Math.max(1, gapR)
  )}${r}`;
}
