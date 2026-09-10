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
  /** 本轮 public_state.json 的字节哈希（规范 §4） */
  publicStateHash: string;
  /** 本轮 reveal_state.json 的字节哈希（规范 §8） */
  revealStateHash: string;
  /** SHA256(publicStateHash + revealStateHash)（规范 §20） */
  roundStateHash: string;
  mapSeed: number;
  mapHash: string;
  /**
   * 固定 Emitter 的标识（恒为 'A0' / 'B0'）—— 本轮的发射锚点。
   *
   * Rule Revision 3 §3 起锚点是常量，不再是「本轮从存活点里选出的那个 Shooter」，
   * 因此这里记录的是**整场不变**的结构，而不是每轮可变的选点结果。
   */
  emitterA: string;
  emitterB: string;
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
    /**
     * **历史/兼容**（V1.1 规则修订 §11）：旧规则下「Shooter 被先手方击杀 →
     * 本轮攻击被取消」的结果码。规则修订后这条路径已不存在，
     * 生产路径不会再产出这两个值；保留联合成员以兼容旧日志与旧回放。
     */
    | 'CANCELLED_A'
    | 'CANCELLED_B'
    | 'TECHNICAL_INVALID';
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  /**
   * 本轮**实际执行**了攻击的队伍，按执行顺序（V1.1 规则修订 §12）。
   *
   * 与 `firstSolver` 的区别是实质性的：`firstSolver` 说的是「谁先解出」，
   * 而这里说的是「谁的攻击真的落地了」—— 后手方算法 TIMEOUT / INVALID / CRASH
   * 时它不会出现在这个数组里，尽管 firstSolver 仍可能指向它。
   */
  attacksExecuted: ('A' | 'B')[];
  /** 本轮结算后双方同时归零 → MATCH DRAW（§8） */
  mutualElimination: boolean;
  /** 本轮结束时连续零击杀回合数（Rule Revision 3 §15/§16） */
  noProgressStreak: number;
}

export interface MatchLog {
  schemaVersion: 1;
  /** 算法输入协议版本（V1.1 起为 '1.1'；日志形状本身仍是 schemaVersion 1） */
  protocolVersion: string;
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
  /**
   * 结束原因（V1.1 规则修订 §8）。
   *   - `ELIMINATION`：一方归零、另一方存活，正常分胜负
   *   - `MUTUAL_ELIMINATION`：同一轮结束后双方都归零 → 平局（`winner = 'draw'`）
   *   - `STALEMATE`：连续零击杀回合数达到上限 → 平局（Rule Revision 3 §16）
   *   - `HARD_ROUND_LIMIT`：到达硬回合上限 → 平局（Rule Revision 3 §17）
   *   - `NONE`：比赛尚未结束
   *
   * `MUTUAL_ELIMINATION` 是在取消规则废止后**才可能出现**的局面：先手方清零对方、
   * 后手方凭锁定攻击权再清零先手方。它必须被判为平局，不得因为谁是 First Solver
   * 就自动判谁赢。
   *
   * **终止保证**（Rule Revision 3 §17）：`ELIMINATION` / `MUTUAL_ELIMINATION` /
   * `STALEMATE` / `HARD_ROUND_LIMIT` 四者覆盖了所有结束方式 —— 每场合法比赛
   * 都在有限时间内终止。
   */
  endReason: 'ELIMINATION' | 'MUTUAL_ELIMINATION' | 'STALEMATE' | 'HARD_ROUND_LIMIT' | 'NONE';
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
  /** 规范 §20 的三元哈希 —— 回放只存哈希，不存两份 JSON 正文 */
  publicStateHash: string;
  revealStateHash: string;
  roundStateHash: string;
  obstacles: Obstacle[];
  aliveBefore: { id: string; team: 'A' | 'B'; position: Point }[];
  /**
   * 固定 Emitter（Rule Revision 3 §22）：回放必须能画出整场不变的发射锚点。
   * 与战斗点分开存放 —— 它们不是同一类实体，混在一起会让「剩余战斗点数」
   * 这类统计出错。
   */
  emitters: { A: { id: string; position: Point }; B: { id: string; position: Point } } | null;
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
  /** 历史/兼容：规则修订后恒为 false（§11） */
  cancelledA: boolean;
  cancelledB: boolean;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  /** 实际执行了攻击的队伍，按执行顺序（§12/§13） */
  attacksExecuted: ('A' | 'B')[];
  /** 本轮结算后双方同时归零（§8） */
  mutualElimination: boolean;
  /** 本帧终结比赛时的结束原因；比赛仍继续时为 'NONE'（§22） */
  endReason: MatchLog['endReason'];
  /** 连续零击杀回合数（§15） */
  noProgressStreak: number;
  aliveAfter: { id: string; team: 'A' | 'B'; position: Point }[];
}

export interface Replay {
  schemaVersion: 1;
  matchId: string;
  seed: number;
  teamAName: string;
  teamBName: string;
  winner: 'A' | 'B' | 'draw';
  /** 回放的结束原因与 MatchLog 一致（§22：回放必须能表达 stalemate 与 mutual elimination） */
  endReason: MatchLog['endReason'];
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
