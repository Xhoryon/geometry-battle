/**
 * InputProtocol — V1.1 两阶段算法输入协议
 *
 * 规范：`Plans/Input/V1.1 — Algorithm Input Protocol.md`（28 节）
 *
 * 一轮的算法输入拆成两个文件 + 一个 START 信号：
 *
 *   public_state.json   揭盲前的公开世界（不含障碍物 / seed；含固定 Emitter）
 *   reveal_state.json   揭盲增量（**只有障碍物**），以 public_state_sha256 绑定
 *   START               裁判事件 —— 之前参赛代码绝不运行
 *
 * 三个不可退让的原则（规范 §25）：
 *   1. Public JSON 不包含隐藏信息；
 *   2. Reveal JSON 只补充隐藏信息（Delta，不复制 points / map）；
 *   3. START 前参赛代码绝不运行。
 *
 * 字节契约：
 *   - 手写有序拼接（固定键序），**单行、无尾随换行**、UTF-8；
 *     与 `RoundState.ts` 的 `canonicalCoreJson` 同风格，`num()` 约定一致
 *     （`-0` → `0`，其余用 `String(v)` 的最短往返表示）。
 *   - 不使用 `JSON.stringify` 生成整体：它无法约束数值格式，而哈希必须可跨平台复核。
 *   - `sha256` 是对**文件确切字节**的哈希，因此 `shasum -a 256 <file>` 必须等于字段值。
 *
 * 公平性（规范 §11 / §12）：
 *   两份文件对 A / B **字节级完全相同**；队别只经 Runner Context（`--team A|B`）
 *   告知算法，绝不写进 JSON —— 本模块的构造函数**不接受 team 参数**，
 *   从类型层面杜绝「A/B 输入不一致」。
 */

import * as crypto from 'crypto';
import { Obstacle } from '../obstacle/Obstacle';
import { EMITTERS, FIELD } from './Rules';

export const PROTOCOL_VERSION = '1.1';

/** public_state.json 中的一个点（含死点 —— 规范 §5 要求 alive 显式表达） */
export interface PublicStatePoint {
  id: string;
  team: 'A' | 'B';
  x: number;
  y: number;
  alive: boolean;
}

export interface BuiltInputFile {
  /** 文件的确切字节（不含尾随换行） */
  json: string;
  /** SHA-256(json) 的十六进制 */
  sha256: string;
}

export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 数值序列化。非有限值直接抛错 —— 静默产出 `null`/`NaN` 会污染哈希与协议。
 */
function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`输入协议不允许非有限数值: ${v}`);
  if (Object.is(v, -0)) return '0';
  return String(v);
}

function str(s: string): string {
  return JSON.stringify(s);
}

/**
 * 构造 public_state.json（规范 §4 / §5 / §6 / §7）。
 *
 * **不含** obstacles / obstacle count / obstacle type / obstacle coordinates /
 * hidden map seed / future round data / opponent shooter。
 *
 * points 顺序 = 调用方传入的顺序（引擎自然序 A1..An、B1..Bm）；
 * 该顺序是确定性的，并计入哈希。
 */
export function buildPublicState(o: {
  matchId: string;
  round: number;
  /**
   * 固定 Emitter 坐标（Rule Revision 3 §6）—— 公开结构，从第 1 轮就可见。
   *
   * 省略时取全局常量 `Rules.EMITTERS`：Emitter 位置是**游戏的常量**，
   * 不是地图的性质（`MapGenerator` 也写的是同一对常量，并按构造相同）。
   * 生产路径（`MatchEngine.buildRunnerInput`）显式传地图携带的值，
   * 好让「地图哈希 ↔ 输入字节」的链条在代码里看得见。
   */
  emitters?: { A: { x: number; y: number }; B: { x: number; y: number } };
  points: readonly PublicStatePoint[];
}): BuiltInputFile {
  const em = o.emitters ?? EMITTERS;
  const points = o.points
    .map(
      (p) =>
        `{"id":${str(p.id)},"team":${str(p.team)},"x":${num(p.x)},"y":${num(p.y)}` +
        `,"alive":${p.alive ? 'true' : 'false'}}`
    )
    .join(',');

  const json =
    `{"schema_version":${str(PROTOCOL_VERSION)}` +
    `,"match_id":${str(o.matchId)}` +
    `,"round":${num(o.round)}` +
    `,"map":{"xmin":${num(FIELD.xMin)},"xmax":${num(FIELD.xMax)}` +
    `,"ymin":${num(FIELD.yMin)},"ymax":${num(FIELD.yMax)}}` +
    // Emitter 是**公开**结构：它整场比赛不变，不是隐藏信息，所以放在 public
    // 而不是 reveal（Rule Revision 3 §6）。放在 points 之前，让「场地 → 锚点 →
    // 战斗点」的阅读顺序与语义层次一致。
    `,"emitters":{"A":{"x":${num(em.A.x)},"y":${num(em.A.y)}}` +
    `,"B":{"x":${num(em.B.x)},"y":${num(em.B.y)}}}` +
    `,"points":[${points}]}`;

  return { json, sha256: sha256Hex(json) };
}

/**
 * 构造 reveal_state.json（规范 §8 / §9 / §10）。
 *
 * 这是 **Delta**：只补障碍物，不重复 points / map / alive / emitters，
 * 避免两个来源不一致（规范 §9）。
 *
 * `public_state_sha256` 把本文件绑定到唯一一份 public state，
 * 从而拒绝「Round N public + Round N+1 reveal」这类错配（规范 §10）。
 */
export function buildRevealState(o: {
  matchId: string;
  round: number;
  publicStateSha256: string;
  obstacles: readonly Obstacle[];
}): BuiltInputFile {
  const obstacles = o.obstacles.map((obstacle, i) => obstacleJson(obstacle, i)).join(',');

  const json =
    `{"schema_version":${str(PROTOCOL_VERSION)}` +
    `,"match_id":${str(o.matchId)}` +
    `,"round":${num(o.round)}` +
    `,"public_state_sha256":${str(o.publicStateSha256)}` +
    // 这里**不再**有 shooters：Rule Revision 3 §5 删除了每轮 Shooter Selection，
    // Emitter 已上移到 public。REVEAL 现在只补障碍物这一项隐藏信息。
    `,"obstacles":[${obstacles}]}`;

  return { json, sha256: sha256Hex(json) };
}

/**
 * 障碍物序列化（规范 §8）。
 *
 * `MapGenerator` 只产出 rectangle 与 circle（`MapGenerator.ts:174,181`）；
 * circle 在内部是 `center:[x,y]`，协议要求扁平的 `cx` / `cy`（规范 §8 示例）。
 * 其它类型**抛错**而非静默透传 —— 协议外字段会破坏审计。
 */
function obstacleJson(o: Obstacle, index: number): string {
  const id = `O${index + 1}`;
  switch (o.type) {
    case 'rectangle':
      return (
        `{"id":${str(id)},"type":"rectangle"` +
        `,"xmin":${num(o.xmin)},"xmax":${num(o.xmax)}` +
        `,"ymin":${num(o.ymin)},"ymax":${num(o.ymax)}}`
      );
    case 'circle':
      return (
        `{"id":${str(id)},"type":"circle"` +
        `,"cx":${num(o.center[0])},"cy":${num(o.center[1])},"radius":${num(o.radius)}}`
      );
    default:
      throw new Error(`V1.1 reveal_state 不支持障碍物类型: ${(o as Obstacle).type}`);
  }
}

/**
 * 本轮统一哈希（规范 §20）：`SHA256(publicHash + revealHash)`。
 *
 * 一场争议比赛之后，凭这个值即可证明「两支算法究竟在什么输入上计算」。
 */
export function roundStateHash(publicStateSha256: string, revealStateSha256: string): string {
  return sha256Hex(publicStateSha256 + revealStateSha256);
}

/** 校验 reveal 是否绑定到这份 public（规范 §10）。 */
export function verifyRevealBinding(publicStateJson: string, revealStateJson: string): boolean {
  let reveal: unknown;
  try {
    reveal = JSON.parse(revealStateJson);
  } catch {
    return false;
  }
  if (typeof reveal !== 'object' || reveal === null) return false;
  const bound = (reveal as { public_state_sha256?: unknown }).public_state_sha256;
  if (typeof bound !== 'string') return false;
  return constantTimeEqual(sha256Hex(publicStateJson), bound);
}

/** 校验某份字节是否就是声明的 public state（哈希可复核）。 */
export function verifyPublicState(publicStateJson: string, expectedSha256: string): boolean {
  return constantTimeEqual(sha256Hex(publicStateJson), expectedSha256);
}

/**
 * Preflight 的 decoy 地图种子（规范 §14 / §15）。
 *
 * Preflight 只是赛前冒烟测试，**绝不能**使用比赛种子 —— 否则双方算法在
 * REVEAL 之前就看到了本轮真实的障碍物布局，等于开放的 preprocessing 窗口。
 *
 * 由 `matchId` 派生：确定性（可测试）、每场不同、与操作员指定的 `seed` 无关。
 * 调用方仍需断言 `derivePreflightSeed(id) !== 比赛 seed`（见 MatchEngine.preflight）。
 */
export function derivePreflightSeed(matchId: string): number {
  return parseInt(sha256Hex(`${matchId}|preflight`).slice(0, 8), 16) % 1_000_000_000;
}

/** 定长十六进制比较 —— 避免因提前返回而泄漏时序信息。 */
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
