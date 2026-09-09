/**
 * Round 状态机
 * Plan V1: 完整的 Round 流程
 */

import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { FunctionGraph } from '../function/FunctionGraph';
import { ASTNode, parseDSL, evaluateAST } from '../function/DSL';

/**
 * Round 阶段状态
 */
export type RoundPhase =
  | 'ROUND_INTRO'
  | 'SHOOTER_SELECTION'
  | 'A_LOCKED'           // A 已锁定
  | 'B_LOCKED'           // B 已锁定
  | 'WAITING_FOR_JUDGE' // 等待 Judge 确认
  | 'START_ROUND'        // 开始回合（倒计时）
  | 'COUNTDOWN'          // 3, 2, 1 倒计时
  | 'REVEAL'             // 揭示阶段
  | 'SEND_ROUND_STATE'   // 发送 Round State
  | 'A_COMPUTING'        // A 计算中
  | 'B_COMPUTING'        // B 计算中
  | 'FIRST_SOLUTION'     // 第一个解
  | 'FIRST_SHOT'         // 第一枪
  | 'CHECK_SHOOTER'      // 检查 Shooter 存活
  | 'SECOND_SOLUTION'    // 第二个解
  | 'SECOND_SHOT'        // 第二枪
  | 'ROUND_RESULT'        // 回合结果
  | 'NEXT_ROUND'         // 下一回合
  | 'MATCH_END';         // 比赛结束

export interface ShotResult {
  hit: boolean;
  kill: boolean;
  shooterEliminated: boolean;
  shotCancelled: boolean;
  reason?: string;
}

export interface RoundState {
  round: number;
  phase: RoundPhase;
  teamA: {
    shooterId: string | null;
    dsl: string | null;  // DSL JSON
    solution: ASTNode | null;
    computing: boolean;
    computeTime: number | null;  // ms
  };
  teamB: {
    shooterId: string | null;
    dsl: string | null;
    solution: ASTNode | null;
    computing: boolean;
    computeTime: number | null;
  };
  obstacles: Obstacle[];
  countdown: number | null;  // 3, 2, 1
  shotResults: {
    first: ShotResult | null;
    second: ShotResult | null;
  };
  kills: { A: number; B: number };
  roundWinner: 'A' | 'B' | 'draw' | null;
}

export interface RoundConfig {
  computeTimeout: number;      // 计算超时 ms (1000-2000)
  firstShotBonus: number;      // 先手加成
  hitRange: number;            // 命中判定范围 epsilon
}

/**
 * Round 状态机
 */
export class RoundStateMachine {
  private state: RoundState;
  private config: RoundConfig;

  constructor(roundNumber: number, obstacles: Obstacle[], config?: Partial<RoundConfig>) {
    this.config = {
      computeTimeout: config?.computeTimeout ?? 2000,
      firstShotBonus: config?.firstShotBonus ?? 0,
      hitRange: config?.hitRange ?? 0.1,
    };

    this.state = {
      round: roundNumber,
      phase: 'ROUND_INTRO',
      teamA: {
        shooterId: null,
        dsl: null,
        solution: null,
        computing: false,
        computeTime: null,
      },
      teamB: {
        shooterId: null,
        dsl: null,
        solution: null,
        computing: false,
        computeTime: null,
      },
      obstacles: [...obstacles],
      countdown: null,
      shotResults: {
        first: null,
        second: null,
      },
      kills: { A: 0, B: 0 },
      roundWinner: null,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): RoundState {
    return { ...this.state };
  }

  /**
   * 设置 Shooter 选择
   */
  setShooter(team: 'A' | 'B', shooterId: string, dsl: string): boolean {
    const teamState = team === 'A' ? this.state.teamA : this.state.teamB;

    // 验证 DSL
    const validation = parseDSL(dsl);
    if (!validation.valid) {
      return false;
    }

    teamState.shooterId = shooterId;
    teamState.dsl = dsl;
    teamState.solution = validation.ast;

    // 更新阶段
    if (team === 'A') {
      this.state.phase = 'A_LOCKED';
    } else {
      this.state.phase = 'B_LOCKED';
    }

    // 双方都锁定后进入 WAITING_FOR_JUDGE
    if (this.state.teamA.shooterId && this.state.teamB.shooterId) {
      this.state.phase = 'WAITING_FOR_JUDGE';
    }

    return true;
  }

  /**
   * Judge 确认
   */
  judgeApprove(): boolean {
    if (this.state.phase !== 'WAITING_FOR_JUDGE') {
      return false;
    }

    // 验证 DSL 有效性（复杂度、连续性等）
    // 实际验证由 FunctionGraph.validate() 进行
    this.state.phase = 'START_ROUND';
    return true;
  }

  /**
   * 开始倒计时
   */
  startCountdown(): boolean {
    if (this.state.phase !== 'START_ROUND') {
      return false;
    }

    this.state.phase = 'COUNTDOWN';
    this.state.countdown = 3;
    return true;
  }

  /**
   * 递减倒计时
   */
  tick(): RoundPhase {
    if (this.state.phase !== 'COUNTDOWN') {
      return this.state.phase;
    }

    if (this.state.countdown === null) {
      this.state.countdown = 3;
    } else {
      this.state.countdown--;
    }

    if (this.state.countdown <= 0) {
      this.state.phase = 'REVEAL';
      this.state.countdown = null;
    }

    return this.state.phase;
  }

  /**
   * 发送 Round State 给算法
   */
  sendRoundState(): boolean {
    if (this.state.phase !== 'REVEAL') {
      return false;
    }

    this.state.phase = 'SEND_ROUND_STATE';
    return true;
  }

  /**
   * 队伍开始计算
   */
  startComputing(team: 'A' | 'B'): boolean {
    const phaseKey = team === 'A' ? 'A_COMPUTING' : 'B_COMPUTING';
    if (this.state.phase !== 'SEND_ROUND_STATE' &&
        this.state.phase !== 'A_COMPUTING' &&
        this.state.phase !== 'B_COMPUTING') {
      return false;
    }

    const teamState = team === 'A' ? this.state.teamA : this.state.teamB;
    teamState.computing = true;
    this.state.phase = phaseKey;
    return true;
  }

  /**
   * 队伍提交解
   */
  submitSolution(team: 'A' | 'B', solution: ASTNode, computeTime: number): boolean {
    const teamState = team === 'A' ? this.state.teamA : this.state.teamB;

    if (!teamState.computing) {
      return false;
    }

    // 检查超时
    if (computeTime > this.config.computeTimeout) {
      teamState.computing = false;
      teamState.computeTime = computeTime;
      // 超时处理
      return false;
    }

    teamState.solution = solution;
    teamState.computing = false;
    teamState.computeTime = computeTime;

    // 第一个解
    if (this.state.phase === 'A_COMPUTING' || this.state.phase === 'B_COMPUTING') {
      this.state.phase = 'FIRST_SOLUTION';
    } else {
      this.state.phase = 'SECOND_SOLUTION';
    }

    return true;
  }

  /**
   * 执行射击
   */
  executeShot(
    shooterTeam: 'A' | 'B',
    targetTeam: 'A' | 'B',
    shooterPosition: Point,
    enemyPositions: Point[],
    obstacles: Obstacle[]
  ): ShotResult {
    const shooterState = shooterTeam === 'A' ? this.state.teamA : this.state.teamB;
    const targetState = shooterTeam === 'A' ? this.state.teamB : this.state.teamA;

    // 检查 shooter 是否已被淘汰
    if (!shooterState.shooterId) {
      return {
        hit: false,
        kill: false,
        shooterEliminated: true,
        shotCancelled: true,
        reason: 'Shooter 已淘汰',
      };
    }

    // 使用 DSL 计算射击轨迹
    if (!shooterState.solution) {
      return {
        hit: false,
        kill: false,
        shooterEliminated: false,
        shotCancelled: true,
        reason: '无有效解',
      };
    }

    // 计算轨迹上的点
    const trajectory: Point[] = [];
    const xStart = shooterPosition.x;
    const xEnd = shooterTeam === 'A' ? 20 : -20;  // 向对方区域射击
    const step = (xEnd > xStart ? 1 : -1) * 0.1;

    for (let x = xStart; (xEnd > xStart ? x <= xEnd : x >= xEnd); x += step) {
      const y = evaluateAST(shooterState.solution, x);
      if (!isFinite(y)) break;
      trajectory.push({ x, y });
    }

    // 检查轨迹上的敌人
    let hit = false;
    let kill = false;

    for (const enemyPos of enemyPositions) {
      for (const trajPoint of trajectory) {
        const dist = Math.sqrt(
          (trajPoint.x - enemyPos.x) ** 2 + (trajPoint.y - enemyPos.y) ** 2
        );

        if (dist <= this.config.hitRange) {
          // 检查障碍物遮挡
          const blocked = this.isLineBlocked(shooterPosition, enemyPos, obstacles);
          if (!blocked) {
            hit = true;
            // 假设一个敌人只有一条命，击杀直接淘汰
            kill = true;
            break;
          }
        }
      }
      if (hit) break;
    }

    // 记录射击结果
    if (!this.state.shotResults.first) {
      this.state.shotResults.first = { hit, kill, shooterEliminated: false, shotCancelled: false };
    } else {
      this.state.shotResults.second = { hit, kill, shooterEliminated: false, shotCancelled: false };
    }

    return this.state.shotResults.second || this.state.shotResults.first;
  }

  /**
   * 检查两点之间是否有障碍物遮挡
   */
  private isLineBlocked(p1: Point, p2: Point, obstacles: Obstacle[]): boolean {
    // 简化：检查线段是否与障碍物相交
    for (const obstacle of obstacles) {
      if (obstacle.type === 'segment') {
        // 检查线段相交
        if (this.segmentsIntersect(p1, p2, { x: obstacle.x1, y: obstacle.y1 }, { x: obstacle.x2, y: obstacle.y2 })) {
          return true;
        }
      } else if (obstacle.type === 'rectangle') {
        // 检查是否穿过矩形
        if (this.lineIntersectsRect(p1, p2, obstacle)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 线段相交检测
   */
  private segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    const ccw = (A: Point, B: Point, C: Point) =>
      (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);

    return (
      ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
      ccw(p1, p2, p3) !== ccw(p1, p2, p4)
    );
  }

  /**
   * 线段与矩形相交检测
   */
  private lineIntersectsRect(p1: Point, p2: Point, rect: { xmin: number; xmax: number; ymin: number; ymax: number }): boolean {
    // 检查线段是否与矩形四条边相交
    const topLeft = { x: rect.xmin, y: rect.ymin };
    const topRight = { x: rect.xmax, y: rect.ymin };
    const bottomLeft = { x: rect.xmin, y: rect.ymax };
    const bottomRight = { x: rect.xmax, y: rect.ymax };

    return (
      this.segmentsIntersect(p1, p2, topLeft, topRight) ||
      this.segmentsIntersect(p1, p2, topRight, bottomRight) ||
      this.segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
      this.segmentsIntersect(p1, p2, bottomLeft, topLeft)
    );
  }

  /**
   * 回合结束，判断胜负
   */
  finishRound(): 'A' | 'B' | 'draw' {
    const { first, second } = this.state.shotResults;

    // 如果有 kill，直接决定胜负
    if (first?.kill) {
      this.state.kills.A += first.hit && this.state.teamA.shooterId ? 1 : 0;
      this.state.kills.B += first.kill && this.state.teamB.shooterId ? 1 : 0;
      return first.hit ? 'A' : 'B';
    }

    if (second?.kill) {
      return 'B';
    }

    // 比较 computeTime（越快越好）
    const timeA = this.state.teamA.computeTime ?? Infinity;
    const timeB = this.state.teamB.computeTime ?? Infinity;

    if (timeA < timeB) return 'A';
    if (timeB < timeA) return 'B';

    return 'draw';
  }

  /**
   * 重置回合
   */
  reset(): void {
    this.state.teamA = {
      shooterId: null,
      dsl: null,
      solution: null,
      computing: false,
      computeTime: null,
    };
    this.state.teamB = {
      shooterId: null,
      dsl: null,
      solution: null,
      computing: false,
      computeTime: null,
    };
    this.state.phase = 'ROUND_INTRO';
    this.state.countdown = null;
    this.state.shotResults = { first: null, second: null };
    this.state.roundWinner = null;
  }
}
