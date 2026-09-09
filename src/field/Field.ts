/**
 * 场地系统 - 比赛场地定义
 * Plan V1: 场地坐标范围 [-20, 20] × [-12, 12]
 */

export interface Point {
  x: number;
  y: number;
}

export interface FieldConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  teamAXRange: [number, number]; // Team A 的有效 x 范围
  teamBXRange: [number, number]; // Team B 的有效 x 范围
  centerZoneX: [number, number]; // 中心对抗区域
}

export const DEFAULT_FIELD_CONFIG: FieldConfig = {
  xMin: -20,
  xMax: 20,
  yMin: -12,
  yMax: 12,
  teamAXRange: [-20, -4],    // Team A: x < 0 区域，但实际限制在 [-20, -4]
  teamBXRange: [4, 20],      // Team B: x > 0 区域，但实际限制在 [4, 20]
  centerZoneX: [-4, 4],       // 中心区域 x ∈ [-4, 4]，这里不允许函数交叉
};

export class Field {
  constructor(private config: FieldConfig = DEFAULT_FIELD_CONFIG) {}

  getConfig(): FieldConfig {
    return { ...this.config };
  }

  /**
   * 检查点是否在场内
   */
  isInsideField(p: Point): boolean {
    return (
      p.x >= this.config.xMin &&
      p.x <= this.config.xMax &&
      p.y >= this.config.yMin &&
      p.y <= this.config.yMax
    );
  }

  /**
   * 检查点是否属于 Team A 区域
   */
  isTeamAZone(p: Point): boolean {
    return p.x < 0;
  }

  /**
   * 检查点是否属于 Team B 区域
   */
  isTeamBZone(p: Point): boolean {
    return p.x > 0;
  }

  /**
   * 检查 x 坐标是否在中心对抗区域
   */
  isInCenterZone(x: number): boolean {
    return x >= this.config.centerZoneX[0] && x <= this.config.centerZoneX[1];
  }

  /**
   * 获取 Team A 的有效 x 范围
   */
  getTeamAXRange(): [number, number] {
    return [...this.config.teamAXRange];
  }

  /**
   * 获取 Team B 的有效 x 范围
   */
  getTeamBXRange(): [number, number] {
    return [...this.config.teamBXRange];
  }

  /**
   * 计算两点之间的距离
   */
  distance(p1: Point, p2: Point): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }

  /**
   * 检查两点是否相同（考虑浮点误差）
   */
  pointsEqual(p1: Point, p2: Point, epsilon: number = 1e-9): boolean {
    return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
  }
}
