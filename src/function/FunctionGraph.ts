/**
 * 函数图像系统 - 使用 DSL/AST
 * Plan V1: 基于 AST 的函数系统
 */

import { Point } from '../field/Field';
import { Obstacle, isOnObstacle } from '../obstacle/Obstacle';
import {
  ASTNode,
  DSLValidation,
  parseDSL,
  evaluateAST,
  checkContinuity,
  countConvexityChanges,
  analyzeComplexity,
  astToString
} from './DSL';

/**
 * 函数图像类
 */
export class FunctionGraph {
  private ast: ASTNode | null = null;
  private formula: string; // DSL JSON string
  private field: { isInsideField: (p: Point) => boolean };
  private validation: DSLValidation;

  constructor(dslJson: string, field: { isInsideField: (p: Point) => boolean }) {
    this.formula = dslJson;
    this.field = field;
    this.validation = parseDSL(dslJson);

    if (this.validation.valid && this.validation.ast) {
      this.ast = this.validation.ast;
    }
  }

  /**
   * 获取 DSL 公式
   */
  getFormula(): string {
    return this.formula;
  }

  /**
   * 获取验证结果
   */
  getValidation(): DSLValidation {
    return this.validation;
  }

  /**
   * 计算函数在 x 处的 y 值
   */
  evaluate(x: number): number {
    if (!this.ast) return NaN;
    return evaluateAST(this.ast, x);
  }

  /**
   * 获取函数的可读字符串
   */
  toDisplayString(): string {
    if (!this.ast) return 'Invalid';
    return astToString(this.ast);
  }

  /**
   * 获取采样点
   */
  samplePoints(xStart: number, xEnd: number, step: number = 0.1): Point[] {
    const points: Point[] = [];
    if (!this.ast) return points;

    for (let x = xStart; x <= xEnd; x += step) {
      const y = this.evaluate(x);
      if (!isNaN(y) && isFinite(y)) {
        points.push({ x, y });
      }
    }
    return points;
  }

  /**
   * 检查函数是否与障碍物碰撞
   */
  checkObstacleCollision(obstacle: Obstacle, xStart: number, xEnd: number): boolean {
    if (!this.ast) return false;

    const step = 0.05;
    const points = this.samplePoints(xStart, xEnd, step);

    for (const p of points) {
      if (isOnObstacle(p, obstacle)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查函数图像是否完全在场内
   */
  isWithinField(xStart: number, xEnd: number): boolean {
    if (!this.ast) return false;

    const points = this.samplePoints(xStart, xEnd);
    return points.every(p => this.field.isInsideField(p));
  }

  /**
   * 完整验证函数
   */
  validate(team: 'A' | 'B', xRange: [number, number]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // DSL 解析验证
    if (!this.validation.valid) {
      errors.push(...this.validation.errors);
      return { valid: false, errors, warnings };
    }

    if (!this.ast) {
      errors.push('AST 为空');
      return { valid: false, errors, warnings };
    }

    // 复杂度检查
    const complexity = analyzeComplexity(this.ast);
    if (complexity.nodeCount > 128) {
      errors.push(`AST 节点数 ${complexity.nodeCount} 超过限制 128`);
    }
    if (complexity.depth > 12) {
      errors.push(`AST 深度 ${complexity.depth} 超过限制 12`);
    }

    // 连续性检查
    const continuity = checkContinuity(this.ast, xRange[0], xRange[1]);
    if (!continuity.continuous) {
      errors.push(`函数不连续: ${continuity.issues.slice(0, 3).join(', ')}`);
    }

    // 凸性变化检查
    const convexity = countConvexityChanges(this.ast, xRange[0], xRange[1]);
    if (convexity.count > 100) {
      errors.push(`凸性变化次数 ${convexity.count} 超过限制 100`);
    }

    // 场内边界检查
    if (!this.isWithinField(xRange[0], xRange[1])) {
      errors.push('函数图像超出场地边界');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 反推 x 值（给定 y，找到 x 使得 f(x) = y）
   */
  inverse(y: number, xStart: number, xEnd: number, tolerance: number = 1e-6): number[] {
    if (!this.ast) return [];

    const roots: number[] = [];
    const step = 0.01;

    for (let x = xStart; x <= xEnd; x += step) {
      const y1 = this.evaluate(x);
      const y2 = this.evaluate(x + step);

      if ((y1 - y) * (y2 - y) <= 0) {
        // 跨越点，使用二分法
        let lo = x, hi = x + step;
        while (hi - lo > tolerance) {
          const mid = (lo + hi) / 2;
          const yMid = this.evaluate(mid);
          if ((yMid - y) * (y1 - y) <= 0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        roots.push((lo + hi) / 2);
      }
    }

    return roots;
  }
}
