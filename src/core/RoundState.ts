/**
 * RoundState — Judge 内部使用的本轮状态
 *
 * 修复的 Finding：
 *   P2-2  A/B 输入不一致 / 无 RoundState hash
 *   P0-2  Runner 传入的 round state 与 Judge 使用的不一致
 *
 * V1.1 契约（规范 §11/§12/§13）：
 *   Runner 的输入**不再**由本文件序列化。V1.0 的 `runnerPayloadJson(core, team)`
 *   以「core + team_id」的形式发一份 JSON，因此 A/B 的字节必然不同 —— 规范 §11
 *   要求两份输入逐字节相同、队别只经 Runner Context 传递。那套 API 已删除，
 *   正式序列化只有 `InputProtocol.buildPublicState / buildRevealState` 一处。
 *
 * 本文件只保留 Judge 侧的**内部**类型：判定与校验读它，它不出现在任何沙箱里。
 */

import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';

export interface AlivePoint {
  id: string;
  team: 'A' | 'B';
  position: Point;
}

export interface RoundStateCore {
  round: number;
  mapSeed: number;
  mapHash: string;
  obstacles: Obstacle[];
  /** 本轮开始前仍存活的**战斗点**（不含 Emitter —— 它不是战斗点） */
  points: AlivePoint[];
  /**
   * 固定 Emitter（Rule Revision 3 §2–§4）。
   *
   * 与旧的 `shooters` 的本质区别：它是**常量**，不是从本轮存活点里选出来的。
   * 没有 `alive` 字段 —— Emitter 不会死，所以「它是否存活」这个问题不再存在，
   * 类型层面就堵住了「alive Shooter」这类旧语义的回流（§3 明文要求）。
   */
  emitters: { A: { id: string; position: Point }; B: { id: string; position: Point } };
  teamAXRange: [number, number];
  teamBXRange: [number, number];
}
