/**
 * Round 状态机 —— 17 阶段，真实运行（不是死代码）
 *
 * 修复的 Finding：
 *   P1-20 17 状态机未集成
 *   P1-21 finishRound() 在 B 先开火时判定错误
 *   P1-25 finishRound() 没有阶段守卫
 *   P2-16/P2-17/P2-18 非法转换 / 跳过状态 / 自动开始下一回合
 *
 * 设计原则：
 *   - 所有转换都必须通过 transition()，非法转换抛错并记录
 *   - 双方 READY 不会自动开始 Round —— 必须裁判显式 judgeStartRound()
 */

export type RoundPhase =
  | 'ROUND_INTRO'
  | 'SHOOTER_SELECTION'
  | 'A_LOCKED'
  | 'B_LOCKED'
  | 'WAITING_FOR_JUDGE'
  | 'START_ROUND'
  | 'COUNTDOWN'
  | 'REVEAL'
  | 'SEND_ROUND_STATE'
  | 'A_COMPUTING'
  | 'B_COMPUTING'
  | 'FIRST_SOLUTION'
  | 'FIRST_SHOT'
  | 'CHECK_SHOOTER'
  | 'SECOND_SOLUTION'
  | 'SECOND_SHOT'
  | 'ROUND_RESULT'
  | 'NEXT_ROUND'
  | 'MATCH_END';

/** 允许的转换表 */
const TRANSITIONS: Record<RoundPhase, RoundPhase[]> = {
  ROUND_INTRO: ['SHOOTER_SELECTION'],
  SHOOTER_SELECTION: ['A_LOCKED', 'B_LOCKED'],
  A_LOCKED: ['WAITING_FOR_JUDGE'],
  B_LOCKED: ['WAITING_FOR_JUDGE'],
  WAITING_FOR_JUDGE: ['START_ROUND'],
  START_ROUND: ['COUNTDOWN'],
  COUNTDOWN: ['REVEAL'],
  REVEAL: ['SEND_ROUND_STATE'],
  SEND_ROUND_STATE: ['A_COMPUTING', 'B_COMPUTING'],
  A_COMPUTING: ['B_COMPUTING', 'FIRST_SOLUTION', 'ROUND_RESULT'],
  B_COMPUTING: ['A_COMPUTING', 'FIRST_SOLUTION', 'ROUND_RESULT'],
  FIRST_SOLUTION: ['FIRST_SHOT'],
  FIRST_SHOT: ['CHECK_SHOOTER'],
  CHECK_SHOOTER: ['SECOND_SOLUTION', 'SECOND_SHOT', 'ROUND_RESULT'],
  SECOND_SOLUTION: ['SECOND_SHOT'],
  SECOND_SHOT: ['ROUND_RESULT'],
  ROUND_RESULT: ['NEXT_ROUND', 'MATCH_END'],
  NEXT_ROUND: ['ROUND_INTRO'],
  MATCH_END: [],
};

export interface PhaseTransition {
  from: RoundPhase;
  to: RoundPhase;
  at: number;
  reason: string;
}

export class RoundMachine {
  readonly roundNumber: number;
  private phase: RoundPhase = 'ROUND_INTRO';
  private history: PhaseTransition[] = [];
  private locked: { A: boolean; B: boolean } = { A: false, B: false };
  private submitted: { A: boolean; B: boolean } = { A: false, B: false };
  private countdown: number | null = null;

  constructor(roundNumber: number) {
    this.roundNumber = roundNumber;
  }

  getPhase(): RoundPhase {
    return this.phase;
  }

  getHistory(): PhaseTransition[] {
    return [...this.history];
  }

  getCountdown(): number | null {
    return this.countdown;
  }

  isLocked(team: 'A' | 'B'): boolean {
    return this.locked[team];
  }

  /**
   * 唯一转换入口。非法转换抛错（调用方不得吞掉）。
   */
  private transition(to: RoundPhase, reason: string): void {
    const allowed = TRANSITIONS[this.phase];
    if (!allowed.includes(to)) {
      throw new Error(
        `非法状态转换: ${this.phase} → ${to} (reason: ${reason})，允许: [${allowed.join(', ')}]`
      );
    }
    this.history.push({ from: this.phase, to, at: Date.now(), reason });
    this.phase = to;
  }

  // ---- 阶段动作 ----

  beginSelection(): void {
    this.transition('SHOOTER_SELECTION', 'round intro complete');
  }

  /** 人工选择 Shooter 并锁定。返回是否双方已锁定。 */
  lockShooter(team: 'A' | 'B'): boolean {
    if (this.phase !== 'SHOOTER_SELECTION' && this.phase !== 'A_LOCKED' && this.phase !== 'B_LOCKED') {
      throw new Error(`当前阶段 ${this.phase} 不允许选择 Shooter`);
    }
    if (this.locked[team]) {
      throw new Error(`${team} 已经锁定，Lock 后不可修改`);
    }
    this.locked[team] = true;
    const bothLocked = this.locked.A && this.locked.B;
    if (bothLocked) {
      // 第二个锁定的人直接进入 WAITING_FOR_JUDGE
      this.transition('WAITING_FOR_JUDGE', `${team} shooter locked; both teams locked`);
      return true;
    }
    this.transition(team === 'A' ? 'A_LOCKED' : 'B_LOCKED', `${team} shooter locked`);
    return false;
  }

  /** 裁判开始本轮。双方 READY 不会自动触发。 */
  judgeStartRound(): void {
    this.transition('START_ROUND', 'judge START ROUND');
  }

  startCountdown(): void {
    this.transition('COUNTDOWN', 'countdown start');
    this.countdown = 3;
  }

  /** 返回当前倒计时值；归零时进入 REVEAL */
  tickCountdown(): number | null {
    if (this.phase !== 'COUNTDOWN') {
      throw new Error(`当前阶段 ${this.phase} 不在倒计时`);
    }
    if (this.countdown === null) this.countdown = 3;
    else this.countdown -= 1;

    if (this.countdown <= 0) {
      this.countdown = null;
      this.transition('REVEAL', 'countdown finished');
      return null;
    }
    return this.countdown;
  }

  reveal(): void {
    if (this.phase === 'REVEAL') return;
    this.transition('REVEAL', 'reveal');
  }

  sendRoundState(): void {
    this.transition('SEND_ROUND_STATE', 'round state sent');
  }

  startComputing(team: 'A' | 'B'): void {
    this.transition(team === 'A' ? 'A_COMPUTING' : 'B_COMPUTING', `${team} computing`);
  }

  /** 记录某个队伍已经提交（用于判断先手）。 */
  markSubmitted(team: 'A' | 'B'): void {
    this.submitted[team] = true;
  }

  hasSubmitted(team: 'A' | 'B'): boolean {
    return this.submitted[team];
  }

  firstSolution(): void {
    if (this.phase !== 'A_COMPUTING' && this.phase !== 'B_COMPUTING') {
      throw new Error(`当前阶段 ${this.phase} 不能进入 FIRST_SOLUTION`);
    }
    this.transition('FIRST_SOLUTION', 'first solution arrived');
  }

  /**
   * 双方都没有产出合法解 —— 直接结算（没有 FIRST_SOLUTION 可进）。
   * 显式建模，避免为了满足状态机而伪造一次「先解」。
   */
  noSolution(): void {
    if (this.phase !== 'A_COMPUTING' && this.phase !== 'B_COMPUTING') {
      throw new Error(`当前阶段 ${this.phase} 不能直接进入 ROUND_RESULT（无解）`);
    }
    this.transition('ROUND_RESULT', 'no valid solution');
  }

  firstShot(): void {
    this.transition('FIRST_SHOT', 'first shot');
  }

  checkShooter(): void {
    this.transition('CHECK_SHOOTER', 'check shooter alive');
  }

  secondSolution(): void {
    if (this.phase === 'CHECK_SHOOTER') {
      this.transition('SECOND_SOLUTION', 'second solution available');
      return;
    }
    if (this.phase === 'A_COMPUTING' || this.phase === 'B_COMPUTING') {
      this.transition('FIRST_SOLUTION', 'second solution is actually first');
      return;
    }
    throw new Error(`当前阶段 ${this.phase} 不能进入 SECOND_SOLUTION`);
  }

  secondShot(): void {
    this.transition('SECOND_SHOT', 'second shot');
  }

  roundResult(): void {
    if (this.phase === 'CHECK_SHOOTER' || this.phase === 'SECOND_SHOT' || this.phase === 'SECOND_SOLUTION') {
      this.transition('ROUND_RESULT', 'round settled');
      return;
    }
    if (this.phase === 'FIRST_SHOT') {
      this.transition('CHECK_SHOOTER', 'check shooter alive');
      this.transition('ROUND_RESULT', 'round settled');
      return;
    }
    throw new Error(`当前阶段 ${this.phase} 不能进入 ROUND_RESULT`);
  }

  nextRound(): void {
    this.transition('NEXT_ROUND', 'next round requested');
    this.transition('ROUND_INTRO', 'round intro');
  }

  matchEnd(): void {
    this.transition('MATCH_END', 'match ended');
  }

  /** 供审计使用：必须经过的关键阶段 */
  visitedPhases(): RoundPhase[] {
    return [this.history.length > 0 ? this.history[0].from : this.phase, ...this.history.map((h) => h.to)];
  }
}
