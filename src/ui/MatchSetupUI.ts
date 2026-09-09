/**
 * Match Setup UI
 * Plan 2 Phase E: Match Setup Page UI
 */

import { MatchController, MatchPhase } from '../competition/MatchController';
import { GeneratedMap } from '../map/MapGenerator';

export interface MatchSetupState {
  matchId: string;
  seed: number;
  teamA: {
    name: string;
    uploaded: boolean;
    hash: string | null;
    ready: boolean;
  };
  teamB: {
    name: string;
    uploaded: boolean;
    hash: string | null;
    ready: boolean;
  };
  map: GeneratedMap | null;
  mapReady: boolean;
  allReady: boolean;
}

/**
 * Match Setup UI Manager
 */
export class MatchSetupUI {
  private match: MatchController;
  private state: MatchSetupState;

  constructor(teamAName: string = 'Team A', teamBName: string = 'Team B') {
    this.match = new MatchController(teamAName, teamBName);
    this.state = this.getDefaultState(teamAName, teamBName);
  }

  private getDefaultState(teamAName: string, teamBName: string): MatchSetupState {
    const matchState = this.match.getState();
    return {
      matchId: matchState.config.matchId,
      seed: matchState.config.seed,
      teamA: {
        name: teamAName,
        uploaded: false,
        hash: null,
        ready: false,
      },
      teamB: {
        name: teamBName,
        uploaded: false,
        hash: null,
        ready: false,
      },
      map: null,
      mapReady: false,
      allReady: false,
    };
  }

  /**
   * 上传 Team A 算法
   */
  uploadTeamA(packagePath: string, entry: string): { success: boolean; hash: string | null; errors: string[] } {
    const result = this.match.uploadTeamA(packagePath, entry);
    if (result.success) {
      this.state.teamA.uploaded = true;
      this.state.teamA.hash = result.hash;
      this.updateAllReady();
    }
    return result;
  }

  /**
   * 上传 Team B 算法
   */
  uploadTeamB(packagePath: string, entry: string): { success: boolean; hash: string | null; errors: string[] } {
    const result = this.match.uploadTeamB(packagePath, entry);
    if (result.success) {
      this.state.teamB.uploaded = true;
      this.state.teamB.hash = result.hash;
      this.updateAllReady();
    }
    return result;
  }

  /**
   * 生成/加载地图
   */
  generateMap(pointCount: number = 8, difficulty: 'easy' | 'medium' | 'hard' = 'medium'): {
    success: boolean;
    map: GeneratedMap | null;
    errors: string[];
  } {
    const result = this.match.generateMap(pointCount, difficulty);
    if (result.success && result.map) {
      this.state.map = result.map;
      this.state.mapReady = true;
      this.updateAllReady();
    }
    return result;
  }

  /**
   * 加载已有地图
   */
  loadMap(map: GeneratedMap): boolean {
    const matchState = this.match.getState();
    if (matchState.config.map) {
      this.state.map = map;
      this.state.mapReady = true;
      this.updateAllReady();
      return true;
    }
    return false;
  }

  private updateAllReady(): void {
    this.state.allReady = this.state.teamA.uploaded &&
      this.state.teamB.uploaded &&
      this.state.mapReady;
  }

  /**
   * 获取当前状态
   */
  getState(): MatchSetupState {
    return { ...this.state };
  }

  /**
   * 获取 Match Controller
   */
  getMatchController(): MatchController {
    return this.match;
  }

  /**
   * 渲染状态表格
   */
  renderStatusTable(): string {
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────┐');
    lines.push('│               MATCH SETUP STATUS                    │');
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push(`│ Match ID: ${this.state.matchId.padEnd(35)}│`);
    lines.push(`│ Seed: ${String(this.state.seed).padEnd(42)}│`);
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push('│ TEAM A                                             │');
    lines.push(`│   Package: ${this.state.teamA.uploaded ? '✓' : '✕'} Uploaded`.padEnd(49) + '│');
    if (this.state.teamA.hash) {
      lines.push(`│   Hash: ${this.state.teamA.hash.substring(0, 16).padEnd(43)}│`);
    }
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push('│ TEAM B                                             │');
    lines.push(`│   Package: ${this.state.teamB.uploaded ? '✓' : '✕'} Uploaded`.padEnd(49) + '│');
    if (this.state.teamB.hash) {
      lines.push(`│   Hash: ${this.state.teamB.hash.substring(0, 16).padEnd(43)}│`);
    }
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push('│ MAP                                                │');
    lines.push(`│   Generated: ${this.state.mapReady ? '✓' : '✕'}${this.state.map ? ` Seed: ${this.state.map.seed}` : ''}`.padEnd(43) + '│');
    if (this.state.map) {
      lines.push(`│   Points: ${this.state.map.teamA.length} vs ${this.state.map.teamB.length}`.padEnd(47) + '│');
      lines.push(`│   Obstacles: ${this.state.map.obstacles.length}`.padEnd(43) + '│');
    }
    lines.push('├─────────────────────────────────────────────────────┤');
    lines.push(`│ ALL READY: ${this.state.allReady ? '✓ YES' : '✕ NO'} `.padEnd(48) + '│');
    lines.push('└─────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}
