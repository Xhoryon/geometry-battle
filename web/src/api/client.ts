/**
 * 服务端客户端：REST 发命令、WS 收状态。
 *
 * 轨迹的处理（对应 spec §3.3）：
 *   - 服务端**只在产生时推一次**，不随 100ms 的 board 重复广播；
 *   - 浏览器按 id 缓存；
 *   - 若某条 board 引用了一个本地没有的 id（推送丢失 / 页面刚刷新），
 *     走 `GET /api/trajectory/:id` 补一次 —— 这是恢复路径，不是常规路径。
 */

import { useEffect, useState } from 'react';
import { bytesToBase64, unzipToFiles } from './zip';
import { JUDGE_READ_PATHS } from '../../../src/server/protocol';
import type {
  CommandResult,
  JudgeBoard,
  ServerMessage,
  SpectatorBoard,
  Topic,
  TrajectoryPayload,
} from '../../../src/server/protocol';

// ============================================================================
// 轨迹缓存
// ============================================================================

const trajCache = new Map<string, TrajectoryPayload>();
const trajListeners = new Set<(t: TrajectoryPayload) => void>();

function putTrajectory(t: TrajectoryPayload): void {
  trajCache.set(t.id, t);
  for (const l of [...trajListeners]) l(t);
}

async function fetchTrajectory(id: string): Promise<TrajectoryPayload | null> {
  const cached = trajCache.get(id);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/trajectory/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { trajectory: TrajectoryPayload };
    putTrajectory(json.trajectory);
    return json.trajectory;
  } catch {
    return null;
  }
}

/**
 * 订阅「当前该显示哪条轨迹」。
 *
 * `handle` 来自 board。换了 id 就换轨迹；本地没有就先查缓存、再走 REST 补。
 * 动画本身由 `ArenaCanvas` 负责 —— 这里只保证**数据到齐**。
 */
export function useTrajectory(handle: { id: string; round: number } | null): TrajectoryPayload | null {
  const [trajectory, setTrajectory] = useState<TrajectoryPayload | null>(() =>
    handle ? trajCache.get(handle.id) ?? null : null
  );
  const id = handle?.id ?? null;

  useEffect(() => {
    if (!id) {
      setTrajectory(null);
      return;
    }
    const cached = trajCache.get(id);
    if (cached) {
      setTrajectory(cached);
    } else {
      // 推送丢了（或刚刷新页面）—— 补一次
      let alive = true;
      void fetchTrajectory(id).then((t) => {
        if (alive && t) setTrajectory(t);
      });
      setTrajectory(null);
      return () => {
        alive = false;
      };
    }
    const listener = (t: TrajectoryPayload): void => {
      if (t.id === id) setTrajectory(t);
    };
    trajListeners.add(listener);
    return () => {
      trajListeners.delete(listener);
    };
  }, [id]);

  return trajectory;
}

// ============================================================================
// WS board 订阅
// ============================================================================

export interface BoardFeed<T> {
  board: T | null;
  /** WS 是否在线。断线时页面自己决定怎么显示（三条板都显示同一个「未连接」标记） */
  connected: boolean;
}

export function useBoard<T = JudgeBoard | SpectatorBoard>(topic: Topic): BoardFeed<T> {
  const [board, setBoard] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    let retry = 0;
    let retryTimer: number | undefined;

    const open = (): void => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?topic=${topic}`);

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'board') {
          setBoard(msg.board as T);
        } else if (msg.type === 'trajectory') {
          putTrajectory(msg.trajectory);
        }
      };
      ws.onerror = () => {
        /* onclose 会紧随其后，统一在那里重连 */
      };
      ws.onclose = () => {
        setConnected(false);
        if (disposed) return;
        retry += 1;
        // 服务重启 / 页面休眠都会走到这里；退避重连，最长 5s
        retryTimer = window.setTimeout(open, Math.min(5000, 250 * retry));
      };
    };

    open();

    // 连接长时间无消息时，用 WS 层的 ping 探活（也让服务端知道我们还在）
    const beat = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 20000);

    return () => {
      disposed = true;
      window.clearInterval(beat);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [topic]);

  return { board, connected };
}

// ============================================================================
// 命令
// ============================================================================

export async function command(path: string, body: unknown = {}): Promise<CommandResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as CommandResult;
    if (!res.ok && !json.errors) {
      return { ok: false, errors: [`请求失败（HTTP ${res.status}）`] };
    }
    return json;
  } catch (e) {
    // 服务没起来 / 连接断了 —— 说人话，不吐异常对象
    return { ok: false, errors: [`无法连接到本地服务：${(e as Error).message}`] };
  }
}

// ============================================================================
// 回放
// ============================================================================

export interface ReplayIndexEntry {
  matchId: string;
  winner: 'A' | 'B' | 'draw';
  endReason: string;
  rounds: number;
  startedAt: string;
  endedAt: string;
  teamAName: string;
  teamBName: string;
}

export function useReplayList(): { replays: ReplayIndexEntry[]; error: string | null } {
  const [replays, setReplays] = useState<ReplayIndexEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch('/api/replays')
      .then((r) => r.json())
      .then((j: { replays: ReplayIndexEntry[] }) => {
        if (alive) setReplays(j.replays ?? []);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { replays, error };
}

// ============================================================================
// 参赛者端（V1.2 §一）
// ============================================================================

export type TeamSide = 'A' | 'B';

export const TEAM_PATHS = {
  source: '/api/team/source',
  upload: '/api/team/upload',
  selectEmitter: '/api/team/select-emitter',
  lockEmitter: '/api/team/lock-emitter',
} as const;

/**
 * 读取槽位内的一个源文件（只读浏览；服务端会做路径校验）。
 *
 * 参赛者端（`/api/team/source`）与裁判端（`/api/judge/source`）只有**路径**不同，
 * 读取与防护是服务端同一条实现 —— 这里也就不必写两份 fetch。
 */
async function fetchSource(
  base: string,
  team: TeamSide,
  relPath: string
): Promise<{ ok: boolean; errors: string[]; text?: string }> {
  try {
    const res = await fetch(
      `${base}?team=${team.toLowerCase()}&path=${encodeURIComponent(relPath)}`
    );
    return (await res.json()) as { ok: boolean; errors: string[]; text?: string };
  } catch (e) {
    return { ok: false, errors: [`无法连接到本地服务：${(e as Error).message}`] };
  }
}

/** 参赛者视角：只读本队的源码 */
export function fetchTeamSource(
  team: TeamSide,
  relPath: string
): Promise<{ ok: boolean; errors: string[]; text?: string }> {
  return fetchSource(TEAM_PATHS.source, team, relPath);
}

/** 裁判 / 主办方视角：可读**任一队**的源码（核对选手交上来的到底是什么） */
export function fetchJudgeSource(
  team: TeamSide,
  relPath: string
): Promise<{ ok: boolean; errors: string[]; text?: string }> {
  return fetchSource(JUDGE_READ_PATHS.source, team, relPath);
}

/**
 * 去掉一层**公共的顶层目录**。
 *
 * 「把文件夹压缩成 zip」和「选一个目录上传」都会让所有文件带上同一个外层目录名
 * （`my-algo/solver.py`）。但平台要求入口就在**包根目录**，所以这一层必须去掉，
 * 否则一个结构完全正常的包会因为「缺少固定入口 solver.py」被拒。
 *
 * 只有**所有**文件都共享同一个首段时才剥；`a/x.py` + `b/y.py` 这种不剥。
 */
function stripCommonRoot(
  files: { path: string; contentBase64: string }[]
): { path: string; contentBase64: string }[] {
  if (files.length === 0) return files;
  const first = files[0].path.split('/').filter(Boolean);
  if (first.length < 2) return files;
  const root = first[0];
  const allShare =
    files.every((f) => {
      const parts = f.path.split('/').filter(Boolean);
      return parts.length >= 2 && parts[0] === root;
    }) &&
    // 单文件也要剥：用户的包里可能确实只有 solver.py
    files.some((f) => f.path.split('/').filter(Boolean).length > 1);
  if (!allShare) return files;
  return files.map((f) => ({ ...f, path: f.path.split('/').filter(Boolean).slice(1).join('/') }));
}

/**
 * 把浏览器选到的文件变成「路径 + base64」清单。
 *
 * 三种来源统一到这里：
 *   - 单个 `solver.py` → 一个文件；
 *   - 目录（`webkitdirectory`）→ `FileList` 里每一项带 `webkitRelativePath`；
 *   - `.zip` → 交给 `unzipToFiles` 在浏览器里展开。
 *
 * 三条路都必须产出**同一种形状**，因为服务端只有一条安装流水线。
 */
export async function filesToUploadPayload(list: FileList): Promise<{
  files: { path: string; contentBase64: string }[];
  errors: string[];
}> {
  const picked = Array.from(list);
  if (picked.length === 0) return { files: [], errors: ['没有选择任何文件'] };

  const collected: { path: string; contentBase64: string }[] = [];
  const errors: string[] = [];

  for (const f of picked) {
    // 每个 zip 都在浏览器里展开 —— **不管同时选了几个文件**。
    // 此前只在「恰好选了一个文件、且它是 zip」时才展开：一个 zip 和别的文件
    // 一起选中时，它的原始字节会被当成算法文件上传，得到一个莫名其妙的失败。
    if (/\.zip$/i.test(f.name)) {
      try {
        collected.push(...(await unzipToFiles(await f.arrayBuffer())));
      } catch (e) {
        errors.push(`${f.name} 解压失败：${(e as Error).message}`);
      }
      continue;
    }
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    collected.push({ path: rel, contentBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())) });
  }

  // 有任何一份没解出来就整体不提交 —— 半个包上传上去比失败更糟
  if (errors.length > 0) return { files: [], errors };
  return { files: stripCommonRoot(collected), errors: [] };
}
