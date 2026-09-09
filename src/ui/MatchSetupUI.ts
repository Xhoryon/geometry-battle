/**
 * Match Setup UI —— 绑定 Canonical Match Pipeline
 *
 * 修复的 Finding：
 *   P0-10 无正式操作入口
 *   P1-22 上传后从不 Preflight
 *   P2-3  UI 与真实引擎状态脱节
 *
 * 本文件不含任何业务判定：所有规则都来自 MatchEngine。
 */

import { MatchEngine, MatchOptions, MatchSnapshot } from '../core/Match';
import { GeneratedMap } from '../map/MapGenerator';

export interface MatchSetupState {
  matchId: string;
  seed: number;
  phase: MatchSnapshot['phase'];
  teamA: { name: string; uploaded: boolean; hash: string | null };
  teamB: { name: string; uploaded: boolean; hash: string | null };
  preflightPassed: boolean;
  map: GeneratedMap | null;
  allReady: boolean;
}

export class MatchSetupUI {
  private engine: MatchEngine;
  private preflightPassed = false;
  private teamAName: string;
  private teamBName: string;

  constructor(opts: MatchOptions & { teamAName?: string; teamBName?: string } = {}) {
    this.teamAName = opts.teamAName ?? opts.teamAName ?? 'Team A';
    this.teamBName = opts.teamBName ?? 'Team B';
    this.engine = new MatchEngine({ ...opts, teamAName: this.teamAName, teamBName: this.teamBName });
  }

  getEngine(): MatchEngine {
    return this.engine;
  }

  uploadTeamA(packageDir: string): { success: boolean; hash: string | null; errors: string[] } {
    const r = this.engine.upload('A', packageDir);
    return { success: r.ok, hash: r.hash, errors: r.errors };
  }

  uploadTeamB(packageDir: string): { success: boolean; hash: string | null; errors: string[] } {
    const r = this.engine.upload('B', packageDir);
    return { success: r.ok, hash: r.hash, errors: r.errors };
  }

  async preflight(): Promise<{ success: boolean; errors: string[]; detail: Record<string, unknown> }> {
    const r = await this.engine.preflight();
    this.preflightPassed = r.ok;
    return { success: r.ok, errors: r.errors, detail: r.detail };
  }

  startMatch(): { success: boolean; errors: string[] } {
    const r = this.engine.startMatch();
    return { success: r.ok, errors: r.errors };
  }

  getState(): MatchSetupState {
    const snap = this.engine.getSnapshot();
    return {
      matchId: snap.matchId,
      seed: snap.seed,
      phase: snap.phase,
      teamA: { name: this.teamAName, uploaded: Boolean(snap.packages.A), hash: snap.packages.A?.hash ?? null },
      teamB: { name: this.teamBName, uploaded: Boolean(snap.packages.B), hash: snap.packages.B?.hash ?? null },
      preflightPassed: this.preflightPassed,
      map: snap.map,
      allReady: Boolean(snap.packages.A && snap.packages.B && this.preflightPassed),
    };
  }

  renderStatusTable(): string {
    const s = this.getState();
    const line = (label: string, value: string) => `│ ${label.padEnd(14)}${value.padEnd(49)}│`;
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│                   MATCH SETUP STATUS                        │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(line('Match ID', s.matchId));
    lines.push(line('Seed', String(s.seed)));
    lines.push(line('Phase', s.phase));
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(line('Team A', `${s.teamA.uploaded ? '✓' : '✕'} ${s.teamA.name}`));
    if (s.teamA.hash) lines.push(line('  hash', s.teamA.hash.substring(0, 32)));
    lines.push(line('Team B', `${s.teamB.uploaded ? '✓' : '✕'} ${s.teamB.name}`));
    if (s.teamB.hash) lines.push(line('  hash', s.teamB.hash.substring(0, 32)));
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(line('Preflight', s.preflightPassed ? '✓ PASSED' : '✕ NOT RUN'));
    lines.push(line('Map', s.map ? `seed=${s.map.seed} ${s.map.teamA.length}v${s.map.teamB.length} obstacles=${s.map.obstacles.length}` : '✕ not generated'));
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(line('ALL READY', s.allReady ? '✓ YES' : '✕ NO'));
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}
