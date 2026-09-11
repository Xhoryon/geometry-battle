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
 * 固定 Emitter —— 每支队伍的**永久函数发射锚点**（V1.1 Rule Revision 3 §2–§4）。
 *
 * 语义（与旧的「每轮选一个存活点当 Shooter」彻底不同）：
 *   - 整场比赛**固定不变**，不随回合变化，也不由任何人选择；
 *   - **不属于战斗点**：不计入存活数、不能被击杀、不能作为胜利目标，
 *     也不参与 `MIN_POINT_DISTANCE` 之外的点位规则；
 *   - 每轮函数的锚点：`|f(x_emitter) − y_emitter| ≤ HIT_EPSILON`。
 *
 * 位置是全局常量而不是地图生成的结果 —— 这样它对所有比赛都是同一个公开结构，
 * 观众、选手、裁判不需要先看地图就知道从哪儿开火；同时**不改变任何既有的
 * 地图生成路径与地图哈希**（生成器只需保证出生点不和它重叠、障碍物不封死它）。
 */
export const EMITTERS: Record<'A' | 'B', Point> = {
  A: { x: -18, y: 0 },
  B: { x: 18, y: 0 },
};

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

/**
 * 计算超时（Plan V1 / README）。
 *
 * Rule Revision 3 §11 把默认值从 2000ms 收紧到 **500ms**：让运行效率成为算法
 * 设计约束，并防止无限拉长的复杂优化搜索。250 / 500 / 750 三档 benchmark 的
 * 数据见 `playtest/results/revision-3-*`。
 */
export const COMPUTE_TIMEOUT_MS = 500;

/**
 * Stalemate：连续 **零击杀** 回合数达到该值即判 MATCH DRAW（Rule Revision 3 §16）。
 *
 * 阈值由 Revision 3 的实测分布决定，不是拍脑袋 —— 见
 * `Plans/Output/V1.1 Completion Wave Report.md` 的 Stalemate 一节。
 */
export const STALEMATE_NO_PROGRESS_LIMIT = 20;

/**
 * 硬回合上限（Rule Revision 3 §17）。
 *
 * 无论局面如何，比赛到达该回合数必须结束（判 DRAW，`endReason = HARD_ROUND_LIMIT`）。
 * 这条是**引擎级**保证 —— 不是 CLI 的 `--max-rounds` 护栏。有了它，
 * 「每场比赛都在有限时间内终止」不再依赖操作台传参。
 */
export const HARD_ROUND_LIMIT = 60;

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
