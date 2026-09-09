/**
 * MatchLog / AuditLog / Replay —— 真正落盘
 *
 * 修复的 Finding：
 *   P1-16 MatchLog 从未写入
 *   P1-17 startLogging() 从未被调用
 *   P1-18 Replay 完全不可用（0 帧）
 *   P1-26 MatchLog 哈希为空、结果硬编码
 *   P2-22 无持久化
 *   P2-26 ReplayFrame 字段不足
 *
 * Replay 只记录已经结算的结果，回放时不重新运行任何算法。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Obstacle } from '../obstacle/Obstacle';
import { Point } from '../field/Field';

export interface RoundLog {
  round: number;
  stateHash: string;
  mapSeed: number;
  mapHash: string;
  shooterA: string;
  shooterB: string;
  aTimeMs: number | null;
  bTimeMs: number | null;
  aFunction: string | null;
  bFunction: string | null;
  aFunctionMath: string | null;
  bFunctionMath: string | null;
  aFunctionHash: string | null;
  bFunctionHash: string | null;
  aHits: string[];
  bHits: string[];
  aKills: number;
  bKills: number;
  aBlocked: boolean;
  bBlocked: boolean;
  cancelledA: boolean;
  cancelledB: boolean;
  aErrorCode: string | null;
  bErrorCode: string | null;
  aliveAAfter: number;
  aliveBAfter: number;
  result:
    | 'COMPLETE'
    | 'TIMEOUT_A'
    | 'TIMEOUT_B'
    | 'INVALID_A'
    | 'INVALID_B'
    /** Shooter 被先手方击杀，本轮攻击被取消（Plan V1 §25）—— 与 INVALID 语义不同 */
    | 'CANCELLED_A'
    | 'CANCELLED_B'
    | 'TECHNICAL_INVALID';
  firstSolver: 'A' | 'B' | 'tie' | 'none';
}

export interface MatchLog {
  schemaVersion: 1;
  matchId: string;
  seed: number;
  pointCount: number;
  difficulty: string;
  teamAName: string;
  teamBName: string;
  teamAPackageHash: string | null;
  teamBPackageHash: string | null;
  startTime: string;
  endTime: string;
  winner: 'A' | 'B' | 'draw';
  rounds: RoundLog[];
  finalAlive: { A: number; B: number };
}

export interface AuditEvent {
  at: string;
  seq: number;
  type: string;
  team?: 'A' | 'B';
  details: Record<string, unknown>;
}

export interface AuditLog {
  schemaVersion: 1;
  matchId: string;
  events: AuditEvent[];
}

export interface ReplayFrame {
  round: number;
  phase: string;
  stateHash: string;
  obstacles: Obstacle[];
  aliveBefore: { id: string; team: 'A' | 'B'; position: Point }[];
  shooterA: { id: string; position: Point } | null;
  shooterB: { id: string; position: Point } | null;
  functionA: unknown | null;
  functionB: unknown | null;
  functionMathA: string | null;
  functionMathB: string | null;
  trajectoryA: Point[];
  trajectoryB: Point[];
  hitsA: { id: string; at: Point }[];
  hitsB: { id: string; at: Point }[];
  killed: string[];
  blockedA: Point | null;
  blockedB: Point | null;
  timerA: number | null;
  timerB: number | null;
  cancelledA: boolean;
  cancelledB: boolean;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  aliveAfter: { id: string; team: 'A' | 'B'; position: Point }[];
}

export interface Replay {
  schemaVersion: 1;
  matchId: string;
  seed: number;
  teamAName: string;
  teamBName: string;
  winner: 'A' | 'B' | 'draw';
  frames: ReplayFrame[];
}

/** 轨迹降采样：保留形状但限制点数（回放体积） */
export function simplifyTrajectory(points: Point[], maxPoints = 400): Point[] {
  if (points.length <= maxPoints) return points.map((p) => ({ ...p }));
  const out: Point[] = [];
  const stride = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push({ ...points[Math.round(i * stride)] });
  }
  return out;
}

export class AuditRecorder {
  private events: AuditEvent[] = [];
  private seq = 0;

  constructor(private matchId: string) {}

  log(type: string, details: Record<string, unknown> = {}, team?: 'A' | 'B'): void {
    this.events.push({
      at: new Date().toISOString(),
      seq: ++this.seq,
      type,
      team,
      details,
    });
  }

  snapshot(): AuditLog {
    return { schemaVersion: 1, matchId: this.matchId, events: [...this.events] };
  }
}

export interface MatchArtifacts {
  matchLog: MatchLog;
  auditLog: AuditLog;
  replay: Replay;
}

/** 原子写：先写临时文件再 rename，避免半截文件 */
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function persistArtifacts(dir: string, artifacts: MatchArtifacts): string {
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'match.json'), artifacts.matchLog);
  writeJson(path.join(dir, 'audit.json'), artifacts.auditLog);
  writeJson(path.join(dir, 'replay.json'), artifacts.replay);
  return dir;
}

export function loadReplay(file: string): Replay {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Replay;
}
