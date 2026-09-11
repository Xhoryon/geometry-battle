/**
 * 已落盘回放的索引与加载 —— **只读**，回放期间不运行任何算法。
 *
 * 安全要点：`matchId` 来自 URL，是本服务唯一一个用户可控且**会长进文件路径**的输入。
 * 因此它经过三道：
 *
 *   1. **字符白名单**：`^[A-Za-z0-9._-]{1,128}$`，并显式拒绝 `.` / `..`；
 *   2. **枚举命中**：服务端自己 `readdir` 出真实存在的场次集合，参数必须命中集合 ——
 *      这一条才是真正的保证：路径**从来不是拼出来的**，而是从服务端自有的列表里选出来的；
 *   3. **resolve 复核**：解析后其父目录必须仍等于 `matches/`。
 *
 * 只靠正则是不够的（编码、大小写、平台分隔符的差异都能绕），
 * 所以第 2 条是主防线，第 1、3 条是冗余。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchLog, Replay } from '../core/Logs';

/**
 * 字符白名单。真实 matchId 形如 `MATCH-<base36>-<base36>`（见 `generateMatchId`），
 * 永远不含路径分隔符、不以点开头。
 *
 * **不允许以 `.` 开头**：`matches/` 下任何以点开头的条目（`.DS_Store`、
 * 将来可能出现的隐藏目录）都不该通过 URL 可达。这一条是冗余防线，
 * 主防线仍是下面的「枚举命中」。
 */
const MATCH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeMatchId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return MATCH_ID_RE.test(id);
}

function matchesRoot(artifactRoot: string): string {
  return path.join(artifactRoot, 'matches');
}

/** 服务端自有的场次 id 列表（枚举目录，不接受任何外部输入） */
export function listMatchIds(artifactRoot: string): string[] {
  const root = matchesRoot(artifactRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && isSafeMatchId(e.name)).map((e) => e.name);
}

/**
 * 把 matchId 映射成产物目录。
 *
 * 返回 `null` 表示「不存在或不允许」—— 调用方一律回 404，
 * **不区分**「格式非法」与「不存在」，避免把内部结构透露给探测者。
 */
export function resolveMatchDir(artifactRoot: string, matchId: string): string | null {
  if (!isSafeMatchId(matchId)) return null;
  // 主防线：必须在服务端枚举出的集合里
  if (!listMatchIds(artifactRoot).includes(matchId)) return null;
  // 冗余复核：解析后父目录仍须是 matches/
  const root = path.resolve(matchesRoot(artifactRoot));
  const resolved = path.resolve(root, matchId);
  if (path.dirname(resolved) !== root) return null;
  return resolved;
}

export interface ReplayIndexEntry {
  matchId: string;
  winner: 'A' | 'B' | 'draw';
  endReason: MatchLog['endReason'];
  rounds: number;
  startedAt: string;
  endedAt: string;
  teamAName: string;
  teamBName: string;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 场次索引：按结束时间倒序（最新的排最前） */
export function listReplays(artifactRoot: string): ReplayIndexEntry[] {
  const out: ReplayIndexEntry[] = [];
  for (const id of listMatchIds(artifactRoot)) {
    const dir = resolveMatchDir(artifactRoot, id);
    if (!dir) continue;
    const match = readJson<MatchLog>(path.join(dir, 'match.json'));
    const replay = readJson<Replay>(path.join(dir, 'replay.json'));
    if (!match || !replay) continue;
    out.push({
      matchId: match.matchId,
      winner: match.winner,
      endReason: match.endReason,
      rounds: match.rounds.length,
      startedAt: match.startTime,
      endedAt: match.endTime,
      teamAName: match.teamAName,
      teamBName: match.teamBName,
    });
  }
  out.sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0));
  return out;
}

export type LoadReplayResult =
  | { ok: true; replay: Replay; match: MatchLog }
  | { ok: false; status: number; message: string };

/**
 * 加载单场回放。
 *
 * 轨迹在 `replay.json` 里是**全分辨率**的，直接发出去会有几万个点；
 * 调用方（http 层）负责降采样 —— 这里只保证取到的是**引擎记下的原始数据**，
 * 回放**不重新运行任何算法**。
 */
export function loadReplay(artifactRoot: string, matchId: string): LoadReplayResult {
  const dir = resolveMatchDir(artifactRoot, matchId);
  if (!dir) return { ok: false, status: 404, message: '没有这场比赛' };

  const match = readJson<MatchLog>(path.join(dir, 'match.json'));
  const replay = readJson<Replay>(path.join(dir, 'replay.json'));
  if (!match || !replay) return { ok: false, status: 404, message: '这场比赛的产物不完整' };
  return { ok: true, replay, match };
}
