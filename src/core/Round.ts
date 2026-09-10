/**
 * Round 状态机 —— **16 阶段**，真实运行（不是死代码）
 *
 * Rule Revision 3 §5 把每轮的 Shooter Selection 整个删掉了：
 *   - `SHOOTER_SELECTION` → 换成 `PUBLIC`（本轮 public_state 冻结的停留点）
 *   - `A_LOCKED` / `B_LOCKED` 删除（不再有「选中/锁定 Shooter」这个动作）
 *   - `CHECK_SHOOTER` 删除（Emitter 不会死，「检查 Shooter 是否存活」失去意义）
 * 阶段数 19 → 16。这是规则变更的**直接后果**，不是重构。
 *
 * 修复的 Finding：
 *   P1-20 17 状态机未集成
 *   P1-21 finishRound() 在 B 先开火时判定错误
 *   P1-25 finishRound() 没有阶段守卫
 *   P2-16/P2-17/P2-18 非法转换 / 跳过状态 / 自动开始下一回合
 *
 * V1.1 顺序修正（规范 §3/§17/§18/§25）：
 *   揭盲（REVEAL）必须发生在 START 之前，且 START 与揭盲是两个独立事件：
 *     WAITING_FOR_JUDGE → REVEAL → START_ROUND → COUNTDOWN → SEND_ROUND_STATE
 *   V1.0 的转换表是 START_ROUND → COUNTDOWN → REVEAL —— 揭盲落在 START 之后，
 *   与「START 前参赛代码绝不运行」的三大原则直接冲突。
 *
 * 设计原则：
 *   - 所有转换都必须通过 transition()，非法转换抛错并记录
 *   - 双方 READY 不会自动开始 Round —— 必须裁判显式 judgeStartRound()
 *   - 倒计时归零不自行推进：宿主随后显式 sendRoundState()
 */

export type RoundPhase =
  | 'ROUND_INTRO'
  /** 本轮 public_state.json 已冻结，等待 REVEAL（Rule Revision 3 §5 的新阶段） */
  | 'PUBLIC'
  | 'WAITING_FOR_JUDGE'
  | 'START_ROUND'
  | 'COUNTDOWN'
  | 'REVEAL'
  | 'SEND_ROUND_STATE'
  | 'A_COMPUTING'
  | 'B_COMPUTING'
  | 'FIRST_SOLUTION'
  | 'FIRST_SHOT'
  | 'SECOND_SOLUTION'
  | 'SECOND_SHOT'
  | 'ROUND_RESULT'
  | 'NEXT_ROUND'
  | 'MATCH_END';

/** 允许的转换表 */
const TRANSITIONS: Record<RoundPhase, RoundPhase[]> = {
  ROUND_INTRO: ['PUBLIC'],
  PUBLIC: ['WAITING_FOR_JUDGE'],
  WAITING_FOR_JUDGE: ['REVEAL'],
  REVEAL: ['START_ROUND'],
  START_ROUND: ['COUNTDOWN'],
  COUNTDOWN: ['SEND_ROUND_STATE'],
  SEND_ROUND_STATE: ['A_COMPUTING', 'B_COMPUTING'],
  A_COMPUTING: ['B_COMPUTING', 'FIRST_SOLUTION', 'ROUND_RESULT'],
  B_COMPUTING: ['A_COMPUTING', 'FIRST_SOLUTION', 'ROUND_RESULT'],
  FIRST_SOLUTION: ['FIRST_SHOT'],
  // 不再有 CHECK_SHOOTER：Emitter 不会死，双方攻击权在 START 时已锁定，
  // 第一击之后没有任何「需要检查某方是否还能开火」的判断。
  FIRST_SHOT: ['SECOND_SOLUTION', 'SECOND_SHOT', 'ROUND_RESULT'],
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

  /**
   * ROUND_INTRO → PUBLIC。本轮输入已经冻结，等待揭盲。
   *
   * 旧的 `beginSelection()` 在这里停下等双方选 Shooter；Rule Revision 3 §5
   * 删除了那个动作，因此这里直接推进到「本轮输入已就绪」的状态。
   */
  beginPublic(): void {
    this.transition('PUBLIC', 'round input frozen');
  }

  /** PUBLIC → WAITING_FOR_JUDGE：进入揭盲/START 前的等待点（裁判可停任意久）。 */
  readyForJudge(): void {
    this.transition('WAITING_FOR_JUDGE', 'awaiting judge');
  }

  /** 裁判开始本轮。双方 READY 不会自动触发。 */
  judgeStartRound(): void {
    this.transition('START_ROUND', 'judge START ROUND');
  }

  startCountdown(): void {
    this.transition('COUNTDOWN', 'countdown start');
    this.countdown = 3;
  }

  /**
   * 返回当前倒计时值；归零时只返回 null，**不自行推进阶段**。
   *
   * 归零后由宿主显式 `sendRoundState()` —— 否则倒计时结束会把状态机推回
   * REVEAL（V1.0 的顺序），而 V1.1 的 REVEAL 已经在 START 之前发生。
   */
  tickCountdown(): number | null {
    if (this.phase !== 'COUNTDOWN') {
      throw new Error(`当前阶段 ${this.phase} 不在倒计时`);
    }
    if (this.countdown === null) this.countdown = 3;
    else this.countdown -= 1;

    if (this.countdown <= 0) {
      this.countdown = null;
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

  secondSolution(): void {
    if (this.phase === 'FIRST_SHOT') {
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
    if (this.phase === 'FIRST_SHOT' || this.phase === 'SECOND_SHOT' || this.phase === 'SECOND_SOLUTION') {
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
