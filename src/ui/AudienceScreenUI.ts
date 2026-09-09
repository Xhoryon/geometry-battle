/**
 * Audience Screen UI —— 只读消费 Canonical Match Pipeline 的状态
 *
 * 修复的 Finding：
 *   P1-24 比赛结束前显示错误的获胜者
 *   P2-3  UI 与真实引擎状态脱节
 *
 * 关键约束：观众屏只读取引擎快照 / 已落盘回放，
 * 不参与判定，也不重新运行算法。
 */

import { MatchEngine, MatchSnapshot } from '../core/Match';
import { Replay, ReplayFrame, RoundLog } from '../core/Logs';
import { AudienceState, formatAudienceState } from '../visualizer/AudienceDisplay';
import { parseCanonicalDSL, toMathString } from '../core/Ast';

export interface MatchResultSummary {
  winner: 'A' | 'B' | 'draw';
  rounds: number;
  totalKillsA: number;
  totalKillsB: number;
}

export class AudienceScreenUI {
  constructor(private engine: MatchEngine) {}

  getAudienceState(): AudienceState {
    const snap = this.engine.getSnapshot();
    const last = snap.rounds[snap.rounds.length - 1] ?? null;

    const fnText = (log: RoundLog | null, team: 'A' | 'B'): string | null => {
      if (!log) return null;
      const raw = team === 'A' ? log.aFunction : log.bFunction;
      if (!raw) return null;
      const parsed = parseCanonicalDSL(raw);
      return parsed.ok && parsed.ast ? toMathString(parsed.ast) : null;
    };

    return {
      roundNumber: snap.round,
      phase: snap.phase,
      teamA: {
        name: 'Team A',
        alive: snap.alive.A,
        shooter: snap.shooters.A?.id ?? null,
        computing: snap.phase === 'COMPUTING',
        computeTime: last ? last.aTimeMs : null,
        function: fnText(last, 'A'),
      },
      teamB: {
        name: 'Team B',
        alive: snap.alive.B,
        shooter: snap.shooters.B?.id ?? null,
        computing: snap.phase === 'COMPUTING',
        computeTime: last ? last.bTimeMs : null,
        function: fnText(last, 'B'),
      },
      trajectoryA: null,
      trajectoryB: null,
      hits: last ? [...last.aHits, ...last.bHits] : [],
      // 只有比赛真正结束后才展示胜者（P1-24）
      winner: snap.phase === 'MATCH_END' ? snap.winner : null,
    };
  }

  render(): string {
    return formatAudienceState(this.getAudienceState());
  }

  renderSnapshotBoard(snap: MatchSnapshot): string {
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ROUND ${String(snap.round).padEnd(3)} ${snap.phase.padEnd(51)}│`);
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  TEAM A  alive=${String(snap.alive.A).padEnd(3)}   TEAM B  alive=${String(snap.alive.B).padEnd(3)}                │`);
    lines.push(`│  Shooter A: ${(snap.shooters.A?.id ?? '???').padEnd(6)}        Shooter B: ${(snap.shooters.B?.id ?? '???').padEnd(6)}      │`);
    lines.push(`│  Locked: A=${snap.locked.A ? 'Y' : 'N'} B=${snap.locked.B ? 'Y' : 'N'}                                            │`);
    if (snap.phase === 'MATCH_END') {
      lines.push(`│  WINNER: ${(snap.winner ?? 'draw').toUpperCase()}`.padEnd(62) + '│');
    }
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /** 回放一帧 —— 只读已记录的数据 */
  renderReplayFrame(replay: Replay, index: number): string {
    const frame: ReplayFrame | undefined = replay.frames[index];
    if (!frame) return `(no frame ${index})`;
    const lines: string[] = [];
    lines.push(`═══ REPLAY ${replay.matchId} — ROUND ${frame.round} (${index + 1}/${replay.frames.length}) ═══`);
    lines.push(`  stateHash: ${frame.stateHash.substring(0, 16)}…`);
    lines.push(`  Shooter A: ${frame.shooterA?.id ?? '-'}   Shooter B: ${frame.shooterB?.id ?? '-'}`);
    lines.push(`  f_A(x) = ${frame.functionMathA ?? '(invalid)'}`);
    lines.push(`  f_B(x) = ${frame.functionMathB ?? '(invalid)'}`);
    lines.push(`  t_A = ${frame.timerA === null ? '-' : frame.timerA.toFixed(3) + 'ms'}   t_B = ${frame.timerB === null ? '-' : frame.timerB.toFixed(3) + 'ms'}`);
    lines.push(`  first solver: ${frame.firstSolver}`);
    lines.push(`  hits: A=[${frame.hitsA.map((h) => h.id).join(',')}] B=[${frame.hitsB.map((h) => h.id).join(',')}]`);
    lines.push(`  killed: [${frame.killed.join(',')}]  cancelled: A=${frame.cancelledA} B=${frame.cancelledB}`);
    lines.push(`  alive after: ${frame.aliveAfter.map((p) => p.id).join(',') || '(none)'}`);
    return lines.join('\n');
  }

  getResultSummary(): MatchResultSummary {
    const log = this.engine.getMatchLog();
    const killsA = log.rounds.reduce((s, r) => s + r.aKills, 0);
    const killsB = log.rounds.reduce((s, r) => s + r.bKills, 0);
    return {
      winner: log.winner,
      rounds: log.rounds.length,
      totalKillsA: killsA,
      totalKillsB: killsB,
    };
  }
}
