/**
 * RoundState — 双方完全一致的比赛输入
 *
 * 修复的 Finding：
 *   P2-2  A/B 输入不一致 / 无 RoundState hash
 *   P0-2  Runner 传入的 round state 与 Judge 使用的不一致
 *
 * 设计：
 *   - core 是公共不可变快照（与队伍身份无关）
 *   - 发给 Runner 的 payload = core + team_id，除此之外完全相同
 *   - stateHash = SHA-256(canonical(core))，双方日志记录同一个 hash
 */

import * as crypto from 'crypto';
import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import { FIELD } from './Rules';

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
  /** 本轮开始前仍存活的点（双方，按 id 排序） */
  points: AlivePoint[];
  /** 本轮 Shooter（Reveal 后为公开信息） */
  shooters: { A: { id: string; position: Point }; B: { id: string; position: Point } };
  teamAXRange: [number, number];
  teamBXRange: [number, number];
}

export interface RunnerPayload extends RoundStateCore {
  team_id: 'A' | 'B';
  state_hash: string;
}

/** 确定性序列化：键顺序固定、数字用 JS 最短往返表示 */
export function canonicalCoreJson(core: RoundStateCore): string {
  const points = [...core.points]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => `{"id":${JSON.stringify(p.id)},"team":"${p.team}","position":${pt(p.position)}}`)
    .join(',');

  const obstacles = core.obstacles.map(obstacleJson).join(',');

  return (
    `{"round":${core.round}` +
    `,"mapSeed":${core.mapSeed}` +
    `,"mapHash":${JSON.stringify(core.mapHash)}` +
    `,"obstacles":[${obstacles}]` +
    `,"points":[${points}]` +
    `,"shooters":{"A":{"id":${JSON.stringify(core.shooters.A.id)},"position":${pt(core.shooters.A.position)}}` +
    `,"B":{"id":${JSON.stringify(core.shooters.B.id)},"position":${pt(core.shooters.B.position)}}}` +
    `,"teamAXRange":[${core.teamAXRange[0]},${core.teamAXRange[1]}]` +
    `,"teamBXRange":[${core.teamBXRange[0]},${core.teamBXRange[1]}]` +
    `}`
  );
}

function pt(p: Point): string {
  return `{"x":${num(p.x)},"y":${num(p.y)}}`;
}

function num(v: number): string {
  if (Object.is(v, -0)) return '0';
  return String(v);
}

function obstacleJson(o: Obstacle): string {
  switch (o.type) {
    case 'segment':
      return `{"type":"segment","x1":${num(o.x1)},"y1":${num(o.y1)},"x2":${num(o.x2)},"y2":${num(o.y2)}}`;
    case 'rectangle':
      return `{"type":"rectangle","xmin":${num(o.xmin)},"xmax":${num(o.xmax)},"ymin":${num(o.ymin)},"ymax":${num(o.ymax)}}`;
    case 'circle':
      return `{"type":"circle","center":[${num(o.center[0])},${num(o.center[1])}],"radius":${num(o.radius)}}`;
    case 'polygon':
      return `{"type":"polygon","vertices":[${o.vertices.map((v) => `[${num(v[0])},${num(v[1])}]`).join(',')}]}`;
  }
}

export function computeStateHash(core: RoundStateCore): string {
  return crypto.createHash('sha256').update(canonicalCoreJson(core)).digest('hex');
}

/**
 * 构造 Runner 输入。A 与 B 的唯一差异是 team_id。
 */
export function toRunnerPayload(core: RoundStateCore, team: 'A' | 'B'): RunnerPayload {
  return { ...core, team_id: team, state_hash: computeStateHash(core) };
}

/** Runner 看到的 JSON 文本（用于字节级一致性校验） */
export function runnerPayloadJson(core: RoundStateCore, team: 'A' | 'B'): string {
  const payload = toRunnerPayload(core, team);
  return JSON.stringify({
    round: payload.round,
    team_id: payload.team_id,
    state_hash: payload.state_hash,
    map_seed: payload.mapSeed,
    map_hash: payload.mapHash,
    obstacles: payload.obstacles,
    points: payload.points,
    shooters: payload.shooters,
    team_a_x_range: payload.teamAXRange,
    team_b_x_range: payload.teamBXRange,
    field: { x_min: FIELD.xMin, x_max: FIELD.xMax, y_min: FIELD.yMin, y_max: FIELD.yMax },
  });
}

/** 去掉 team_id 后应当逐字节一致 —— 用于回归测试 */
export function runnerPayloadWithoutTeamId(core: RoundStateCore, team: 'A' | 'B'): string {
  const parsed = JSON.parse(runnerPayloadJson(core, team));
  delete parsed.team_id;
  return JSON.stringify(parsed);
}
