/**
 * Match Log & Replay System
 * Plan 2 Phase I: Replay & Audit Log
 */

import { ASTNode } from '../function/DSL';

export interface MatchLog {
  matchId: string;
  seed: number;
  teamAHash: string;
  teamBHash: string;
  startTime: string;
  endTime: string;
  winner: 'A' | 'B' | 'draw';
  rounds: RoundLog[];
}

export interface RoundLog {
  round: number;
  stateHash: string;
  shooterA: string;
  shooterB: string;
  aTimeMs: number;
  bTimeMs: number;
  aFunction: string;
  bFunction: string;
  aFunctionHash: string;
  bFunctionHash: string;
  aHits: string[];
  bHits: string[];
  aKills: number;
  bKills: number;
  result: 'COMPLETE' | 'TIMEOUT_A' | 'TIMEOUT_B' | 'INVALID_A' | 'INVALID_B' | 'TECHNICAL_INVALID';
}

export interface AuditLog {
  matchId: string;
  events: AuditEvent[];
}

export interface AuditEvent {
  timestamp: string;
  type: string;
  team?: 'A' | 'B';
  details: string;
}

export interface ReplayFrame {
  round: number;
  phase: string;
  shooterA: { id: string; position: { x: number; y: number } } | null;
  shooterB: { id: string; position: { x: number; y: number } } | null;
  functionA: ASTNode | null;
  functionB: ASTNode | null;
  trajectoryA: { x: number; y: number }[];
  trajectoryB: { x: number; y: number }[];
  hits: string[];
  killed: string[];
  timerA: number | null;
  timerB: number | null;
}

/**
 * Match Log Manager
 */
export class MatchLogger {
  private matchId: string;
  private seed: number;
  private teamAHash: string;
  private teamBHash: string;
  private startTime: Date;
  private rounds: RoundLog[] = [];

  constructor(matchId: string, seed: number, teamAHash: string, teamBHash: string) {
    this.matchId = matchId;
    this.seed = seed;
    this.teamAHash = teamAHash;
    this.teamBHash = teamBHash;
    this.startTime = new Date();
  }

  logRound(round: RoundLog): void {
    this.rounds.push(round);
  }

  endMatch(winner: 'A' | 'B' | 'draw'): MatchLog {
    return {
      matchId: this.matchId,
      seed: this.seed,
      teamAHash: this.teamAHash,
      teamBHash: this.teamBHash,
      startTime: this.startTime.toISOString(),
      endTime: new Date().toISOString(),
      winner,
      rounds: [...this.rounds],
    };
  }

  toJson(): string {
    return JSON.stringify(this.endMatch('draw'), null, 2);
  }
}

/**
 * Audit Logger
 */
export class AuditLogger {
  private matchId: string;
  private events: AuditEvent[] = [];

  constructor(matchId: string) {
    this.matchId = matchId;
  }

  log(type: string, details: string, team?: 'A' | 'B'): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      type,
      team,
      details,
    });
  }

  getLog(): AuditLog {
    return {
      matchId: this.matchId,
      events: [...this.events],
    };
  }

  toJson(): string {
    return JSON.stringify(this.getLog(), null, 2);
  }
}

/**
 * Replay Generator
 */
export class ReplayGenerator {
  private frames: ReplayFrame[] = [];

  addFrame(frame: ReplayFrame): void {
    this.frames.push(frame);
  }

  getFrames(): ReplayFrame[] {
    return [...this.frames];
  }

  toJson(): string {
    return JSON.stringify({ frames: this.frames }, null, 2);
  }
}

/**
 * 生成函数 Hash
 */
export function computeFunctionHash(ast: ASTNode): string {
  const str = JSON.stringify(ast);
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * 生成 Match ID
 */
export function generateMatchId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `MATCH-${timestamp}-${random}`.toUpperCase();
}
