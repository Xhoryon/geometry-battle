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
import { SlotState, TeamSlot } from '../submission/Slot';
import { FROZEN_RUNTIME, checkRuntime, describeRuntime } from '../submission/Runtime';

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

/** 终端框宽（列）。中文按 2 列计算，否则边框会错位。 */
const BOX_WIDTH = 62;
const BOX_TOP = `┌${'─'.repeat(BOX_WIDTH)}┐`;
const BOX_BOTTOM = `└${'─'.repeat(BOX_WIDTH)}┘`;

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 0x1100 ? 2 : 1;
  return w;
}

function boxLine(text: string): string {
  const clipped = shorten(text, BOX_WIDTH - 1);
  return `│${clipped}${' '.repeat(Math.max(0, BOX_WIDTH - displayWidth(clipped)))}│`;
}

function shorten(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = '';
  for (const ch of text) {
    const w = displayWidth(ch);
    if (displayWidth(out) + w > max - 1) break;
    out += ch;
  }
  return `${out}…`;
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

  /**
   * 把算法安装进固定槽位（规范 §31/§32）：
   * staging → validate → preflight → hash → seal → replace。
   * 失败时现有槽位保持不变。
   */
  async installAlgorithm(
    team: TeamSlot,
    sourceDir: string
  ): Promise<{ success: boolean; hash: string | null; errors: string[]; detail: Record<string, unknown> }> {
    const r = await this.engine.installAlgorithm(team, sourceDir);
    return { success: r.ok, hash: r.hash, errors: r.errors, detail: r.detail };
  }

  /** 直接使用槽位里的算法（规范 §2/§41 的常规路径） */
  uploadFromSlot(team: TeamSlot): { success: boolean; hash: string | null; errors: string[] } {
    const state = this.engine.slotStates()[team];
    if (state.status !== 'READY') {
      return { success: false, hash: null, errors: [`槽位 ${state.dir} 不可用: ${state.status}`] };
    }
    const r = this.engine.upload(team, state.dir);
    return { success: r.ok, hash: r.hash, errors: r.errors };
  }

  slotStates(): { A: SlotState; B: SlotState } {
    return this.engine.slotStates();
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

  /**
   * 算法槽位面板（规范 §33）。
   *
   * 展示的是**槽位实际状态**而不是上传记录：哈希来自槽位目录本身，
   * Preflight 结论来自安装记录，因此手工改过槽位就会立刻显示为 INVALID。
   */
  renderSlotPanel(): string {
    const slots = this.slotStates();
    const lines: string[] = [BOX_TOP];
    for (const team of ['A', 'B'] as const) {
      const s = slots[team];
      const label = team === 'A' ? this.teamAName : this.teamBName;
      lines.push(boxLine(`TEAM ${team} ALGORITHM — ${label}`));
      lines.push(boxLine(`  Status       ${s.status}`));
      lines.push(boxLine(`  Slot         ${shorten(s.dir, 44)}`));
      if (s.status === 'READY') {
        lines.push(boxLine(`  Entrypoint   ${s.entry}`));
        lines.push(boxLine(`  Package Hash ${(s.hash ?? '').substring(0, 32)}…`));
        lines.push(boxLine(`  Files        ${s.files}  (${s.totalBytes} bytes)`));
        const pf = s.record?.preflight;
        lines.push(boxLine(`  Preflight    ${pf ? (pf.ok ? 'PASS' : `FAIL — ${pf.error ?? ''}`) : 'N/A（未通过本平台安装）'}`));
      } else if (s.status === 'INVALID') {
        for (const err of s.errors.slice(0, 3)) lines.push(boxLine(`  ✕ ${err}`));
      }
      lines.push(boxLine(''));
    }
    lines.push(boxLine(`Runtime  ${describeRuntime()}`));
    lines.push(boxLine('[ REPLACE ALGORITHM ]  ← CLI: --a <dir> / --b <dir>'));
    lines.push(BOX_BOTTOM);
    return lines.join('\n');
  }

  /** 宿主 Runtime 与冻结清单的比对结果（规范 §5） */
  renderRuntimePanel(): string {
    const check = checkRuntime();
    const lines = [`  冻结: ${describeRuntime()}`, `  实测: ${FROZEN_RUNTIME.implementation} ${check.detected.python ?? '未知'}`];
    if (check.ok) lines.push('  核对: ✓ 与冻结清单一致');
    else for (const m of check.mismatches) lines.push(`  核对: ✕ ${m}`);
    return lines.join('\n');
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
