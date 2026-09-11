/**
 * 服务端客户端：REST 发命令、WS 收状态。
 *
 * 轨迹的处理（对应 spec §3.3）：
 *   - 服务端**只在产生时推一次**，不随 100ms 的 board 重复广播；
 *   - 浏览器按 id 缓存；
 *   - 若某条 board 引用了一个本地没有的 id（推送丢失 / 页面刚刷新），
 *     走 `GET /api/trajectory/:id` 补一次 —— 这是恢复路径，不是常规路径。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  connected: boolean;
  error: string | null;
}

export function useBoard<T = JudgeBoard | SpectatorBoard>(topic: Topic): BoardFeed<T> {
  const [board, setBoard] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(null);
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

  return { board, connected, error };
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

/** 一次性 POST 的便捷包装（命令按钮用），带 pending 状态 */
export function useCommand(): {
  run: (path: string, body?: unknown) => Promise<CommandResult>;
  pending: boolean;
  lastErrors: string[];
} {
  const [pending, setPending] = useState(false);
  const [lastErrors, setLastErrors] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const run = useCallback(async (path: string, body: unknown = {}): Promise<CommandResult> => {
    setPending(true);
    const r = await command(path, body);
    if (mounted.current) {
      setPending(false);
      setLastErrors(r.ok ? [] : r.errors);
    }
    return r;
  }, []);

  return { run, pending, lastErrors };
}
