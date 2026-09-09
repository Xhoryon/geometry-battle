/**
 * Team Controller / Judge Controller UI —— 绑定 Canonical Match Pipeline
 *
 * 修复的 Finding：
 *   P0-1  Shooter 选择写入硬编码空 DSL
 *   P0-10 需要正式入口
 *   P0-12 未锁定即可开局
 *   P2-19 死点仍可被选择
 *
 * 所有动作都是 MatchEngine 的薄封装，不复制任何规则。
 */

import { MatchEngine } from '../core/Match';
import { Point } from '../field/Field';

export interface ShooterSelectionState {
  team: 'A' | 'B';
  alive: { id: string; position: Point }[];
  selected: string | null;
  locked: boolean;
}

export class TeamControllerUI {
  constructor(private engine: MatchEngine, private team: 'A' | 'B') {}

  getAliveShooters(): { id: string; position: Point }[] {
    return this.engine
      .getSnapshot()
      .points.filter((p) => p.team === this.team && p.alive)
      .map((p) => ({ id: p.id, position: p.position }));
  }

  selectShooter(shooterId: string): { success: boolean; error: string | null } {
    const r = this.engine.selectShooter(this.team, shooterId);
    return { success: r.ok, error: r.error };
  }

  lockShooter(): { success: boolean; error: string | null } {
    const r = this.engine.lockShooter(this.team);
    return { success: r.ok, error: r.error };
  }

  getState(): ShooterSelectionState {
    const snap = this.engine.getSnapshot();
    return {
      team: this.team,
      alive: this.getAliveShooters(),
      selected: snap.shooters[this.team]?.id ?? null,
      locked: snap.locked[this.team],
    };
  }

  renderSelectionUI(): string {
    const s = this.getState();
    const lines: string[] = [];
    lines.push(`┌─────────────────────────────────────────────────────────────┐`);
    lines.push(`│                  TEAM ${this.team} CONTROLLER                      │`);
    lines.push(`├─────────────────────────────────────────────────────────────┤`);
    lines.push(`│  Alive points (${s.alive.length}):`);
    if (s.alive.length === 0) lines.push('│    (none)');
    for (const p of s.alive) {
      const marker = s.selected === p.id ? ' ← SELECTED' : '';
      lines.push(`│    ${p.id.padEnd(4)} (${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)})${marker}`);
    }
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  Locked: ${s.locked ? '✓ YES' : '✕ NO'}`);
    lines.push(`└─────────────────────────────────────────────────────────────┘`);
    return lines.join('\n');
  }
}

export class JudgeControllerUI {
  constructor(private engine: MatchEngine) {}

  /** 裁判显式 START ROUND —— 双方 READY 不会自动触发 */
  startRound(): { success: boolean; error: string | null } {
    const r = this.engine.judgeStartRound();
    return { success: r.ok, error: r.error };
  }

  /**
   * WAITING FOR JUDGE 面板（规范 §18）—— 揭盲完成、算法未运行。
   *
   * 这是 V1.1 与 V1.0 最直观的差别：START 是一个真实的门禁，
   * 裁判在这里按下的不是「确认」而是「开火」。
   */
  renderWaitingForStart(): string {
    const snap = this.engine.getSnapshot();
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ROUND ${String(snap.round + 1).padEnd(3)} — WAITING FOR JUDGE`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  PUBLIC STATE  ✓   A LOCKED ${snap.locked.A ? '✓' : '✕'}  B LOCKED ${snap.locked.B ? '✓' : '✕'}   REVEAL STATE ✓`.padEnd(62) + '│');
    lines.push(
      `│  A SHOOTER: ${(snap.shooters.A?.id ?? '-').padEnd(6)}   B SHOOTER: ${(snap.shooters.B?.id ?? '-').padEnd(6)}`.padEnd(62) + '│'
    );
    lines.push('│                                                             │');
    lines.push('│  A ALGORITHM: NOT STARTED                                   │');
    lines.push('│  B ALGORITHM: NOT STARTED                                   │');
    lines.push('│  READY TO COMPUTE                          [ START ]        │');
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  renderJudgeUI(): string {
    const snap = this.engine.getSnapshot();
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│                     JUDGE CONSOLE                           │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  Phase:   ${snap.phase}`);
    lines.push(`│  Round:   ${snap.round}`);
    lines.push(`│  A:       ${snap.locked.A ? 'LOCKED' : 'pending'} ${snap.shooters.A ? `(${snap.shooters.A.id})` : ''}`);
    lines.push(`│  B:       ${snap.locked.B ? 'LOCKED' : 'pending'} ${snap.shooters.B ? `(${snap.shooters.B.id})` : ''}`);
    lines.push(`│  Alive:   A=${snap.alive.A}  B=${snap.alive.B}`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}
