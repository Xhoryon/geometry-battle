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
import { Obstacle } from '../obstacle/Obstacle';
import { Point } from '../field/Field';
import { ArenaFrame, arenaLegend, arenaRuler, renderArena } from './ArenaView';
import { AudienceState, formatAudienceState } from '../visualizer/AudienceDisplay';
import { parseCanonicalDSL, toMathString } from '../core/Ast';

/** 看板一行：内宽 61 字符，超长截断，保证边框不被撑破 */
function wrapLegend(text: string, width = 61): string[] {
  if (text.length <= width) return [' ' + text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > width - 1) {
    const cut = rest.lastIndexOf('   ', width - 1);
    const at = cut > 0 ? cut : width - 1;
    out.push(' ' + rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  out.push(' ' + rest);
  return out;
}

function fmtPt(p: Point | undefined): string {
  return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}` : '-';
}

function row(text: string): string {
  return `│  ${text}`.padEnd(62).slice(0, 62) + '│';
}

/** 揭盲后的障碍物一行摘要（只用于展示，不参与判定） */
function formatObstacle(o: Obstacle): string {
  const n = (v: number) => v.toFixed(2);
  switch (o.type) {
    case 'rectangle':
      return `rect    x[${n(o.xmin)}, ${n(o.xmax)}]  y[${n(o.ymin)}, ${n(o.ymax)}]`;
    case 'circle':
      return `circle  c(${n(o.center[0])}, ${n(o.center[1])})  r=${n(o.radius)}`;
    case 'segment':
      return `segment (${n(o.x1)}, ${n(o.y1)}) → (${n(o.x2)}, ${n(o.y2)})`;
    case 'polygon':
      return `polygon ${o.vertices.length} vertices`;
  }
}

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
        emitter: snap.emitters?.A.id ?? null,
        computing: snap.phase === 'COMPUTING',
        computeTime: last ? last.aTimeMs : null,
        function: fnText(last, 'A'),
      },
      teamB: {
        name: 'Team B',
        alive: snap.alive.B,
        emitter: snap.emitters?.B.id ?? null,
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
    lines.push(`│  Emitter A: ${(snap.emitters?.A.id ?? '???').padEnd(4)}        Emitter B: ${(snap.emitters?.B.id ?? '???').padEnd(4)}      │`);
    lines.push(`│  (fixed emitters — this match)                                        │`);
    if (snap.phase === 'MATCH_END') {
      lines.push(`│  WINNER: ${(snap.winner ?? 'draw').toUpperCase()}`.padEnd(62) + '│');
    }
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /**
   * PRE-REVEAL 板（规范 §26）。
   *
   * 只显示点、坐标、存活状态 —— 障碍物、Shooter、seed 一律不出现。
   * 这一刻算法进程还不存在（规范 §14/§15）。
   */
  renderPreRevealBoard(snap: MatchSnapshot): string {
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ROUND ${String(snap.round + 1).padEnd(3)} PUBLIC`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(row('PUBLIC STATE  (obstacles 仍未揭盲；Emitter 已公开且整场不变)'));
    if (snap.emitters) {
      lines.push(row(`  Emitter A0 (${snap.emitters.A.position.x.toFixed(1)}, ${snap.emitters.A.position.y.toFixed(1)})  [FIXED]`));
      lines.push(row(`  Emitter B0 (${snap.emitters.B.position.x.toFixed(1)}, ${snap.emitters.B.position.y.toFixed(1)})  [FIXED]`));
    }
    for (const p of snap.points) {
      const mark = p.alive ? ' ' : '×';
      lines.push(row(`${mark} ${p.id.padEnd(4)} (${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)})`));
    }
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /**
   * REVEAL 板（规范 §17/§18/§26）。
   *
   * 揭盲后、START 前：Shooter 与障碍物已公开，但两支算法都还没运行 ——
   * 现场可以停任意久，停多久都不影响公平。
   */
  renderRevealBoard(snap: MatchSnapshot): string {
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ROUND ${String(snap.round + 1).padEnd(3)} REVEAL`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(row(`A EMITTER: ${(snap.emitters?.A.id ?? '-').padEnd(4)} (${(snap.emitters?.A.position.x ?? 0).toFixed(1)}, ${(snap.emitters?.A.position.y ?? 0).toFixed(1)})   B EMITTER: ${(snap.emitters?.B.id ?? '-').padEnd(4)} (${(snap.emitters?.B.position.x ?? 0).toFixed(1)}, ${(snap.emitters?.B.position.y ?? 0).toFixed(1)})`));
    lines.push(row(`OBSTACLES REVEALED: ${snap.map?.obstacles.length ?? 0}`));
    for (const o of snap.map?.obstacles ?? []) {
      lines.push(row(`  ${formatObstacle(o)}`));
    }
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push('│  A ALGORITHM: NOT STARTED                                   │');
    lines.push('│  B ALGORITHM: NOT STARTED                                   │');
    lines.push('│  READY TO COMPUTE                          [ START ]        │');
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /**
   * 竞技场板（Rule Revision 3 §23/§25）—— 观众屏的主体。
   *
   * 画出真实几何：场地、障碍物、**固定 Emitter**、战斗点、以及本轮轨迹。
   * 传入 `frame` 时可以带轨迹与击杀（结算后）；不传则只画静态局面（REVEAL 时）。
   */
  renderArenaBoard(frame: ArenaFrame, title: string): string {
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ${title}`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    for (const line of renderArena(frame, 59, 17).split('\n')) {
      lines.push(`│${line}│`);
    }
    lines.push('├─────────────────────────────────────────────────────────────┤');
    for (const line of wrapLegend(arenaRuler())) lines.push(`│${line.padEnd(61)}│`);
    for (const line of wrapLegend(arenaLegend())) lines.push(`│${line.padEnd(61)}│`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /**
   * 本轮的状态与错误（§27 Error UX）。
   *
   * 正式 UI 必须能清楚表达 `INVALID` / `TIMEOUT` / `CRASH` ——
   * 而不是把「有一方没开火」留给裁判自己去翻 match.json。
   */
  renderRoundStatus(result: Awaited<ReturnType<MatchEngine['computeRound']>>): string {
    const lines: string[] = [];
    for (const team of ['A', 'B'] as const) {
      const err = team === 'A' ? result.log.aErrorCode : result.log.bErrorCode;
      const ran = result.log.attacksExecuted.includes(team);
      if (!err && ran) continue;
      const label = err === 'TIMEOUT' ? 'TIMEOUT' : err === 'CRASH' ? 'CRASH' : err === 'CANCELLED' ? 'RUNNER CANCELLED (historical)' : err ? 'INVALID' : 'NO RESULT';
      const detail = err
        ? err === 'TIMEOUT'
          ? '未在计算预算内产出合法 result.json'
          : err === 'CRASH'
            ? '算法进程异常退出'
            : '输出不是合法函数'
        : '本轮没有执行攻击';
      lines.push(`  ⚠ TEAM ${team}: ${label} — ${detail}`);
    }
    return lines.join('\n');
  }

  /** 回放一帧 —— 只读已记录的数据 */
  renderReplayFrame(replay: Replay, index: number): string {
    const frame: ReplayFrame | undefined = replay.frames[index];
    if (!frame) return `(no frame ${index})`;
    const lines: string[] = [];
    lines.push(`═══ REPLAY ${replay.matchId} — ROUND ${frame.round} (${index + 1}/${replay.frames.length}) ═══`);
    lines.push(`  roundStateHash: ${frame.roundStateHash.substring(0, 16)}…`);
    lines.push(
      `  Emitter A: ${frame.emitters?.A.id ?? '-'} (${fmtPt(frame.emitters?.A.position)})   ` +
        `Emitter B: ${frame.emitters?.B.id ?? '-'} (${fmtPt(frame.emitters?.B.position)})`
    );
    lines.push(`  f_A(x) = ${frame.functionMathA ?? '(invalid)'}`);
    lines.push(`  f_B(x) = ${frame.functionMathB ?? '(invalid)'}`);
    lines.push(`  t_A = ${frame.timerA === null ? '-' : frame.timerA.toFixed(3) + 'ms'}   t_B = ${frame.timerB === null ? '-' : frame.timerB.toFixed(3) + 'ms'}`);
    lines.push(`  first solver: ${frame.firstSolver}`);
    lines.push(`  hits: A=[${frame.hitsA.map((h) => h.id).join(',')}] B=[${frame.hitsB.map((h) => h.id).join(',')}]`);
    lines.push(`  killed: [${frame.killed.join(',')}]`);
    // 攻击执行顺序（Rule Revision 3 §22）。这里**不再**有
    // 「Shooter killed / Shot cancelled / New Shooter selected」任何一种表述：
    // 发射锚点是固定 Emitter，它不会死，所以这三种情形都不存在。
    lines.push(`  attacks executed: [${frame.attacksExecuted.join(' → ')}]`);
    if (frame.mutualElimination) lines.push('  *** MUTUAL ELIMINATION — round ended with both teams at zero ***');
    if (frame.endReason === 'STALEMATE') lines.push('  *** STALEMATE — no progress within the limit ***');
    if (frame.endReason === 'HARD_ROUND_LIMIT') lines.push('  *** HARD ROUND LIMIT reached ***');
    // cancelled 字段保留为历史/兼容语义：规则修订后它只能是运行器自身的显式取消，
    // 与 TIMEOUT / INVALID / CRASH 无关，因此这里明确区分，不再打印成「取消」。
    if (frame.cancelledA || frame.cancelledB) {
      lines.push(`  runner cancelled (historical field): A=${frame.cancelledA} B=${frame.cancelledB}`);
    }
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
