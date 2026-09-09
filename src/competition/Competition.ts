/**
 * 比赛流程系统
 * Plan V1: 完整比赛流程控制
 */

import { Field, Point, DEFAULT_FIELD_CONFIG, FieldConfig } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { FunctionGraph } from '../function/FunctionGraph';
import { ShooterInfo, JudgeResult, validateShooter, checkConflict, determineWinner, DEFAULT_JUDGE_CONFIG } from '../judge/Judge';

export interface Team {
  id: 'A' | 'B';
  name: string;
  players: string[];  // 选手 ID 列表
  obstacles: Obstacle[];
  shooter: ShooterInfo | null;
}

export interface RoundState {
  round: number;
  teamA: Team;
  teamB: Team;
  obstacles: Obstacle[];
  judgeX: number;  // 评判 x 坐标
  status: 'idle' | 'lockin' | 'waiting' | 'ready' | 'running' | 'finished';
}

export interface CompetitionResult {
  winner: 'A' | 'B' | 'draw';
  rounds: RoundResult[];
  totalScore: { A: number; B: number };
}

export interface RoundResult {
  round: number;
  shooterA: ShooterInfo;
  shooterB: ShooterInfo;
  winner: 'A' | 'B' | 'draw';
  judgeX: number;
  scoreA: number;
  scoreB: number;
}

/**
 * 比赛管理器
 */
export class Competition {
  private field: Field;
  private config: FieldConfig;
  private teamA: Team;
  private teamB: Team;
  private obstacles: Obstacle[];
  private rounds: RoundResult[] = [];
  private currentRound: number = 0;
  private status: 'idle' | 'lockin' | 'ready' | 'running' | 'finished' = 'idle';

  constructor(
    teamAName: string = 'Team A',
    teamBName: string = 'Team B',
    fieldConfig: FieldConfig = DEFAULT_FIELD_CONFIG
  ) {
    this.field = new Field(fieldConfig);
    this.config = fieldConfig;
    this.obstacles = [];
    this.teamA = {
      id: 'A',
      name: teamAName,
      players: [],
      obstacles: [],
      shooter: null,
    };
    this.teamB = {
      id: 'B',
      name: teamBName,
      players: [],
      obstacles: [],
      shooter: null,
    };
  }

  /**
   * 设置障碍物
   */
  setObstacles(obstacles: Obstacle[]): void {
    this.obstacles = obstacles;
  }

  /**
   * 添加队伍选手
   */
  addPlayer(team: 'A' | 'B', playerId: string): void {
    if (team === 'A') {
      this.teamA.players.push(playerId);
    } else {
      this.teamB.players.push(playerId);
    }
  }

  /**
   * 设置 shooter
   */
  setShooter(team: 'A' | 'B', shooter: ShooterInfo): JudgeResult {
    const teamObj = team === 'A' ? this.teamA : this.teamB;
    const range = team === 'A' ? this.config.teamAXRange : this.config.teamBXRange;

    // 验证 shooter
    const result = validateShooter(shooter, teamObj.obstacles, range, DEFAULT_JUDGE_CONFIG);

    if (result.valid) {
      teamObj.shooter = shooter;
    }

    return result;
  }

  /**
   * 获取当前状态
   */
  getState(): RoundState {
    return {
      round: this.currentRound,
      teamA: { ...this.teamA },
      teamB: { ...this.teamB },
      obstacles: [...this.obstacles],
      judgeX: 0, // 中心对抗点
      status: this.status,
    };
  }

  /**
   * LOCK IN 阶段
   */
  lockIn(team: 'A' | 'B', shooter: ShooterInfo): JudgeResult {
    if (this.status !== 'idle' && this.status !== 'lockin') {
      return { valid: false, reason: '当前不是 LOCK IN 阶段' };
    }

    this.status = 'lockin';
    return this.setShooter(team, shooter);
  }

  /**
   * READY 阶段
   */
  ready(): boolean {
    if (this.status !== 'lockin') {
      return false;
    }

    if (!this.teamA.shooter || !this.teamB.shooter) {
      return false;
    }

    // 检查冲突
    if (checkConflict(this.teamA.shooter, this.teamB.shooter)) {
      return false;
    }

    this.status = 'ready';
    return true;
  }

  /**
   * 开始比赛
   */
  start(): boolean {
    if (this.status !== 'ready') {
      return false;
    }

    this.status = 'running';
    return true;
  }

  /**
   * 执行一回合
   */
  executeRound(judgeX: number = 0): RoundResult {
    if (this.status !== 'running') {
      throw new Error('比赛未在运行状态');
    }

    if (!this.teamA.shooter || !this.teamB.shooter) {
      throw new Error('缺少 shooter');
    }

    this.currentRound++;
    const winner = determineWinner(this.teamA.shooter, this.teamB.shooter, judgeX);

    // 计分
    let scoreA = 0, scoreB = 0;
    if (winner === 'A') scoreA = 1;
    if (winner === 'B') scoreB = 1;

    const result: RoundResult = {
      round: this.currentRound,
      shooterA: this.teamA.shooter,
      shooterB: this.teamB.shooter,
      winner,
      judgeX,
      scoreA,
      scoreB,
    };

    this.rounds.push(result);

    // 重置 shooter 状态
    this.teamA.shooter = null;
    this.teamB.shooter = null;
    this.status = 'idle';

    return result;
  }

  /**
   * 获取比赛结果
   */
  getResult(): CompetitionResult {
    const totalScore = this.rounds.reduce(
      (acc, r) => ({
        A: acc.A + r.scoreA,
        B: acc.B + r.scoreB,
      }),
      { A: 0, B: 0 }
    );

    let winner: 'A' | 'B' | 'draw' = 'draw';
    if (totalScore.A > totalScore.B) winner = 'A';
    if (totalScore.B > totalScore.A) winner = 'B';

    return {
      winner,
      rounds: [...this.rounds],
      totalScore,
    };
  }

  /**
   * 重置比赛
   */
  reset(): void {
    this.currentRound = 0;
    this.rounds = [];
    this.teamA.shooter = null;
    this.teamB.shooter = null;
    this.status = 'idle';
  }
}
