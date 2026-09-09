/**
 * Audience Screen UI
 * Plan 2 Phase F: Audience Display
 */

import { MatchController } from '../competition/MatchController';
import { MatchLogger, RoundLog } from '../replay/ReplayLogger';
import { formatAudienceState, AudienceState } from '../visualizer/AudienceDisplay';
import { astToString, ASTNode } from '../function/DSL';

export interface MatchResult {
  winner: 'A' | 'B' | 'draw';
  rounds: number;
  totalKillsA: number;
  totalKillsB: number;
}

/**
 * Audience Screen - Main spectator view
 */
export class AudienceScreenUI {
  private match: MatchController;
  private logger: MatchLogger | null;

  constructor(match: MatchController, logger?: MatchLogger) {
    this.match = match;
    this.logger = logger || null;
  }

  /**
   * 获取观众状态
   */
  getAudienceState(): AudienceState {
    const state = this.match.getState();
    const matchState = this.match.getState();

    return {
      roundNumber: state.roundNumber,
      phase: state.phase,
      teamA: {
        name: state.config.teamAName,
        alive: state.aliveA,
        shooter: state.shooterA?.id || null,
        computing: state.phase === 'COMPUTING' && !state.resultA,
        computeTime: state.resultA?.computeTimeMs || null,
        function: state.functionA ? astToString(state.functionA) : null,
      },
      teamB: {
        name: state.config.teamBName,
        alive: state.aliveB,
        shooter: state.shooterB?.id || null,
        computing: state.phase === 'COMPUTING' && !state.resultB,
        computeTime: state.resultB?.computeTimeMs || null,
        function: state.functionB ? astToString(state.functionB) : null,
      },
      trajectoryA: null,  // TODO: compute from function
      trajectoryB: null,
      hits: [...state.hitsA, ...state.hitsB],
      winner: null,
    };
  }

  /**
   * 获取比赛结果
   */
  getMatchResult(): MatchResult | null {
    const winner = this.match.getWinner();
    if (winner === 'draw' && this.match.getState().aliveA > 0 && this.match.getState().aliveB > 0) {
      return null;
    }

    const state = this.match.getState();
    const logs = state.roundLogs;

    const totalKillsA = logs.reduce((sum, log) => sum + log.aKills, 0);
    const totalKillsB = logs.reduce((sum, log) => sum + log.bKills, 0);

    return {
      winner,
      rounds: state.roundNumber,
      totalKillsA,
      totalKillsB,
    };
  }

  /**
   * 渲染主屏幕
   */
  render(): string {
    const state = this.getAudienceState();
    const lines: string[] = [];

    lines.push('');
    lines.push('╔═══════════════════════════════════════════════════════════════════════╗');
    lines.push('║                                                                       ║');
    lines.push(`║                          R O U N D   ${String(state.roundNumber).padStart(2, ' ')}                        ║`);
    lines.push('║                                                                       ║');
    lines.push('╠═══════════════════════════════════════════════════════════════════════╣');
    lines.push('║                                                                       ║');

    // Team A info
    const aAlive = '●'.repeat(state.teamA.alive) + '○'.repeat(8 - state.teamA.alive);
    lines.push(`║  TEAM A  ${state.teamA.name.padEnd(15)}  ${aAlive}  ${String(state.teamA.alive).padStart(2)} ALIVE     ║`);
    lines.push(`║  Shooter: ${(state.teamA.shooter || '???').padEnd(10)}                                        ║`);

    if (state.teamA.computing) {
      lines.push('║  >>> COMPUTING...                                                    ║');
    } else if (state.teamA.function) {
      const fn = state.teamA.function.length > 40
        ? state.teamA.function.substring(0, 37) + '...'
        : state.teamA.function;
      lines.push(`║  f(x) = ${fn.padEnd(52)}║`);
      if (state.teamA.computeTime !== null) {
        lines.push(`║  Time: ${state.teamA.computeTime.toFixed(2).padEnd(55)}ms  ║`);
      }
    }

    lines.push('║                                                                       ║');
    lines.push('║                         ┌─────────────────┐                            ║');
    lines.push('║                         │   MATCH FIELD   │                            ║');
    lines.push('║                         │                 │                            ║');
    lines.push('║                         │   [-20]  [0]  [20]  │                            ║');
    lines.push('║                         │    A    ●●●●    B    │                            ║');
    lines.push('║                         │        ●●●●        │                            ║');
    lines.push('║                         │                 │                            ║');
    lines.push('║                         └─────────────────┘                            ║');
    lines.push('║                                                                       ║');

    // Team B info
    const bAlive = '●'.repeat(state.teamB.alive) + '○'.repeat(8 - state.teamB.alive);
    lines.push(`║  TEAM B  ${state.teamB.name.padEnd(15)}  ${bAlive}  ${String(state.teamB.alive).padStart(2)} ALIVE     ║`);
    lines.push(`║  Shooter: ${(state.teamB.shooter || '???').padEnd(10)}                                        ║`);

    if (state.teamB.computing) {
      lines.push('║  >>> COMPUTING...                                                    ║');
    } else if (state.teamB.function) {
      const fn = state.teamB.function.length > 40
        ? state.teamB.function.substring(0, 37) + '...'
        : state.teamB.function;
      lines.push(`║  f(x) = ${fn.padEnd(52)}║`);
      if (state.teamB.computeTime !== null) {
        lines.push(`║  Time: ${state.teamB.computeTime.toFixed(2).padEnd(55)}ms  ║`);
      }
    }

    lines.push('║                                                                       ║');

    // Hits
    if (state.hits.length > 0) {
      lines.push(`║  HITS: ${state.hits.join(', ').padEnd(57)}║`);
    }

    lines.push('║                                                                       ║');
    lines.push(`║                          Phase: ${state.phase.padEnd(31)}║`);
    lines.push('║                                                                       ║');
    lines.push('╚═══════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * 渲染比赛结束屏幕
   */
  renderMatchEnd(): string {
    const result = this.getMatchResult();
    if (!result) return '';

    const lines: string[] = [];
    lines.push('');
    lines.push('╔═══════════════════════════════════════════════════════════════════════╗');
    lines.push('║                                                                       ║');
    lines.push('║                      M A T C H   C O M P L E T E                      ║');
    lines.push('║                                                                       ║');
    lines.push('╠═══════════════════════════════════════════════════════════════════════╣');
    lines.push('║                                                                       ║');

    if (result.winner === 'draw') {
      lines.push('║                            ╱╲    ╱╲                                ║');
      lines.push('║                           ╱  ╲  ╱  ╲                               ║');
      lines.push('║                              DRAW                                   ║');
    } else {
      lines.push(`║                                                                       ║`);
      lines.push(`║                    ╔═══════════════════════╗                         ║`);
      lines.push(`║                    ║                       ║                         ║`);
      lines.push(`║                    ║    TEAM ${result.winner} WINS!    ║                         ║`);
      lines.push(`║                    ║                       ║                         ║`);
      lines.push(`║                    ╚═══════════════════════╝                         ║`);
    }

    lines.push('║                                                                       ║');
    lines.push(`║  Rounds Played: ${String(result.rounds).padEnd(56)}║`);
    lines.push(`║  Team A Kills: ${String(result.totalKillsA).padEnd(57)}║`);
    lines.push(`║  Team B Kills: ${String(result.totalKillsB).padEnd(57)}║`);
    lines.push('║                                                                       ║');
    lines.push('╠═══════════════════════════════════════════════════════════════════════╣');
    lines.push('║  [REPLAY]  [MATCH LOG]  [NEW MATCH]                                ║');
    lines.push('╚═══════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    return lines.join('\n');
  }
}
