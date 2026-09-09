/**
 * Judge 系统 - 验证函数是否合法
 * Plan V1: Judge 核心逻辑 (DSL/AST 版本)
 */

import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { FunctionGraph } from '../function/FunctionGraph';
import { ASTNode, parseDSL, evaluateAST } from '../function/DSL';

export interface ShooterInfo {
  id: string;
  position: Point;
  dsl: string;  // DSL JSON
}

export interface JudgeConfig {
  minDistanceBetweenPlayers: number; // 两人之间的最小距离
  minDistanceToObstacle: number;     // 到障碍物的最小距离
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  minDistanceBetweenPlayers: 2,
  minDistanceToObstacle: 2,
};

export interface JudgeResult {
  valid: boolean;
  reason: string;
  errors?: string[];
  details?: {
    collision?: boolean;
    outOfBounds?: boolean;
    tooClose?: boolean;
    invalidFormula?: boolean;
    complexityExceeded?: boolean;
    notContinuous?: boolean;
  };
}

/**
 * 验证选手的函数是否合法
 */
export function validateShooter(
  shooter: ShooterInfo,
  teamObstacles: Obstacle[],
  teamRange: [number, number],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG
): JudgeResult {
  // 1. 验证 DSL 格式
  const validation = parseDSL(shooter.dsl);
  if (!validation.valid || !validation.ast) {
    return {
      valid: false,
      reason: 'DSL 格式无效',
      errors: validation.errors,
      details: { invalidFormula: true },
    };
  }

  // 2. 验证公式是否能求出 shooter 的 y 值
  const expectedY = evaluateAST(validation.ast, shooter.position.x);
  if (isNaN(expectedY) || !isFinite(expectedY)) {
    return {
      valid: false,
      reason: `公式在 x=${shooter.position.x} 处无效`,
      details: { invalidFormula: true },
    };
  }

  // 检查 y 是否匹配（允许小误差）
  const yDiff = Math.abs(expectedY - shooter.position.y);
  if (yDiff > 0.1) {
    return {
      valid: false,
      reason: `公式计算 y=${expectedY.toFixed(2)}，与给定 y=${shooter.position.y} 不匹配`,
      details: { invalidFormula: true },
    };
  }

  // 3. 创建 FunctionGraph 进行完整验证
  const field = {
    isInsideField: (p: Point) =>
      p.x >= teamRange[0] && p.x <= teamRange[1] &&
      p.y >= -12 && p.y <= 12,
  };

  const graph = new FunctionGraph(shooter.dsl, field);

  // 4. 完整验证
  const fullValidation = graph.validate('A', teamRange);
  if (!fullValidation.valid) {
    return {
      valid: false,
      reason: fullValidation.errors[0] || '验证失败',
      errors: fullValidation.errors,
      details: {
        invalidFormula: fullValidation.errors.some(e => e.includes('DSL')),
        outOfBounds: fullValidation.errors.some(e => e.includes('边界')),
        complexityExceeded: fullValidation.errors.some(e => e.includes('128') || e.includes('12')),
        notContinuous: fullValidation.errors.some(e => e.includes('连续')),
      },
    };
  }

  // 5. 验证是否与障碍物碰撞
  for (const obstacle of teamObstacles) {
    if (graph.checkObstacleCollision(obstacle, teamRange[0], teamRange[1])) {
      return {
        valid: false,
        reason: '函数图像与障碍物碰撞',
        details: { collision: true },
      };
    }
  }

  return {
    valid: true,
    reason: '验证通过',
  };
}

/**
 * 验证两个 shooter 是否冲突（公式相同或位置过近）
 */
export function checkConflict(
  shooter1: ShooterInfo,
  shooter2: ShooterInfo,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG
): boolean {
  // 1. DSL 完全相同
  if (shooter1.dsl.trim() === shooter2.dsl.trim()) {
    return true;
  }

  // 2. 位置过近
  const dx = shooter1.position.x - shooter2.position.x;
  const dy = shooter1.position.y - shooter2.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < config.minDistanceBetweenPlayers) {
    return true;
  }

  return false;
}

/**
 * 判断哪一方的 shooter 获胜
 * 核心：比较函数图像在 x_s 处的 y 值
 */
export function determineWinner(
  shooterA: ShooterInfo,
  shooterB: ShooterInfo,
  judgeX: number
): 'A' | 'B' | 'draw' {
  const valA = parseDSL(shooterA.dsl);
  const valB = parseDSL(shooterB.dsl);

  if (!valA.valid || !valB.valid || !valA.ast || !valB.ast) {
    return 'draw';
  }

  try {
    const yA = evaluateAST(valA.ast, judgeX);
    const yB = evaluateAST(valB.ast, judgeX);

    if (isNaN(yA) || isNaN(yB) || !isFinite(yA) || !isFinite(yB)) {
      return 'draw';
    }

    if (Math.abs(yA - yB) < 1e-9) {
      return 'draw';
    }

    return yA > yB ? 'A' : 'B';
  } catch {
    return 'draw';
  }
}
