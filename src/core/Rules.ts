/**
 * 比赛规则常量 — 唯一来源
 *
 * 任何模块都不得自行定义第二套数值（这是 P1-9「命中容差 0.3/0.1 对比验证 2.0」
 * 与 P0-3「DSL 契约不一致」的根因）。
 */

import { Point } from '../field/Field';

/** 场地范围 */
export const FIELD = {
  xMin: -20,
  xMax: 20,
  yMin: -12,
  yMax: 12,
  teamAXRange: [-20, -4] as [number, number],
  teamBXRange: [4, 20] as [number, number],
} as const;

/**
 * 统一 epsilon（Plan V1 §20/§21）。
 * 仅用于浮点误差处理，不代表攻击轨迹有实际宽度。
 */
export const HIT_EPSILON = 1e-6;

/**
 * 障碍物接触阈值（Plan V1 §22「第一次接触」）。
 * 零厚度线段需要一个小厚度才能被有限采样捕获。
 */
export const OBSTACLE_CONTACT_EPS = 1e-3;

/** 计算超时（Plan V1 / README） */
export const COMPUTE_TIMEOUT_MS = 2000;

/** 内存上限（RLIMIT_AS） */
export const MEMORY_LIMIT_MB = 512;

/** Runner 标准输出上限（P2-25） */
export const MAX_STDOUT_BYTES = 256 * 1024;

/** Runner 标准错误上限 */
export const MAX_STDERR_BYTES = 64 * 1024;

/** 地图最小点间距（Plan V1 §4 建议 ≥ 2） */
export const MIN_POINT_DISTANCE = 2.5;

/**
 * 点与障碍物的最小间距（Plan V1 §47 Fairness Filter）。
 *
 * 不加这条约束时，生成器会把出生点放在障碍物边缘（实测出现过 0.11 的间距，
 * 且该点的 y 落在矩形带内）—— 这种点几乎被完全封死：任何经过该点的曲线
 * 都必须在一个极窄的 x 区间内爬升到障碍物上沿，抛物线族做不到，
 * 比赛会陷入永久僵局。1.5 的距离保证曲线有足够的空间绕过障碍物。
 */
export const POINT_OBSTACLE_CLEARANCE = 1.5;

/** 地图点数范围 */
export const POINT_COUNT_RANGE = [6, 10] as const;

export const DIFFICULTY_OBSTACLES: Record<'easy' | 'medium' | 'hard', { count: number; sizeRange: [number, number] }> = {
  easy: { count: 2, sizeRange: [2, 4] },
  medium: { count: 4, sizeRange: [1.5, 5] },
  hard: { count: 6, sizeRange: [1, 6] },
};

/** 进攻方向：A 向 +x，B 向 -x */
export function attackEndX(team: 'A' | 'B'): number {
  return team === 'A' ? FIELD.xMax : FIELD.xMin;
}

/** 点是否在该队的合法区域 */
export function inTeamZone(p: Point, team: 'A' | 'B'): boolean {
  const r = team === 'A' ? FIELD.teamAXRange : FIELD.teamBXRange;
  return p.x >= r[0] && p.x <= r[1] && p.y >= FIELD.yMin && p.y <= FIELD.yMax;
}

/** 点的有效攻击 x 区间（从 shooter 出发到场地边界） */
export function firingDomain(shooterX: number, team: 'A' | 'B'): [number, number] {
  return team === 'A' ? [shooterX, FIELD.xMax] : [FIELD.xMin, shooterX];
}
