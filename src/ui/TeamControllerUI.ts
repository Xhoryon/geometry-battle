/**
 * Team Controller UI
 * Plan 2 Phase E: Shooter Selection UI
 */

import { MatchController } from '../competition/MatchController';
import { Point } from '../field/Field';

export interface ShooterSelectionState {
  team: 'A' | 'B';
  alive: { id: string; position: Point }[];
  selected: string | null;
  locked: boolean;
}

/**
 * Team Controller for Shooter Selection
 */
export class TeamControllerUI {
  private match: MatchController;
  private team: 'A' | 'B';

  constructor(match: MatchController, team: 'A' | 'B') {
    this.match = match;
    this.team = team;
  }

  /**
   * 获取存活 shooter 列表
   */
  getAliveShooters(): { id: string; position: Point }[] {
    const state = this.match.getState();
    const map = state.config.map;
    if (!map) return [];

    const teamPoints = this.team === 'A' ? map.teamA : map.teamB;
    return teamPoints.map((p, i) => ({
      id: `${this.team}${i + 1}`,
      position: p,
    }));
  }

  /**
   * 选择 shooter
   */
  selectShooter(shooterId: string): { success: boolean; error: string | null } {
    return this.match.selectShooter(this.team, shooterId);
  }

  /**
   * 获取当前状态
   */
  getState(): ShooterSelectionState {
    return {
      team: this.team,
      alive: this.getAliveShooters(),
      selected: null,
      locked: false,
    };
  }

  /**
   * 渲染 shooter 选择界面
   */
  renderSelectionUI(): string {
    const alive = this.getAliveShooters();
    const state = this.match.getState();

    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────┐');
    lines.push(`│           TEAM ${this.team} CONTROLLER                  │`);
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push(`│  Alive Shooters (${alive.length} remaining):`);

    for (const shooter of alive) {
      lines.push(`│    ${shooter.id.padEnd(4)} (${shooter.position.x.toFixed(1)}, ${shooter.position.y.toFixed(1)})`);
    }

    const currentPhase = state.phase;
    if (currentPhase === 'LOCKED') {
      if (this.team === 'A' && state.shooterA) {
        lines.push(`│  Selected: ${state.shooterA.id} ✓`);
      } else if (this.team === 'B' && state.shooterB) {
        lines.push(`│  Selected: ${state.shooterB.id} ✓`);
      }
      lines.push('│  Status: LOCKED');
    } else if (currentPhase === 'READY' || currentPhase === 'SELECT_SHOOTER') {
      lines.push('│  Status: SELECT SHOOTER');
    } else {
      lines.push(`│  Status: ${currentPhase}`);
    }

    lines.push('└─────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}

/**
 * Judge Controller UI
 * Plan 2 Phase E: Judge Control Panel
 */
export class JudgeControllerUI {
  private match: MatchController;

  constructor(match: MatchController) {
    this.match = match;
  }

  /**
   * 开始 Round
   */
  startRound(): boolean {
    return this.match.judgeStart();
  }

  /**
   * 获取当前 Phase
   */
  getPhase(): string {
    return this.match.getPhase();
  }

  /**
   * 渲染 Judge 控制面板
   */
  renderControlPanel(): string {
    const phase = this.getPhase();
    const state = this.match.getState();

    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────┐');
    lines.push('│              JUDGE CONTROLLER                       │');
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push(`│  Current Phase: ${phase.padEnd(34)}│`);
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push('│  CONTROLS:                                         │');

    const canStart = phase === 'LOCKED';
    const canSelect = phase === 'READY' || phase === 'SELECT_SHOOTER';

    lines.push(`│  [${canSelect ? 'X' : ' '}] SELECT SHOOTERS`.padEnd(55) + '│');
    lines.push(`│  [${canStart ? 'X' : ' '}] START ROUND`.padEnd(55) + '│');
    lines.push('│  [ ] PAUSE MATCH                                   │');
    lines.push('│  [ ] RESUME MATCH                                  │');
    lines.push('│  [ ] END MATCH                                     │');
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push('│  ROUND INFO:                                       │');
    lines.push(`│    Round: ${String(state.roundNumber).padEnd(42)}│`);
    lines.push(`│    Alive - A: ${String(state.aliveA).padEnd(37)}│`);
    lines.push(`│    Alive - B: ${String(state.aliveB).padEnd(37)}│`);
    lines.push('└─────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}
