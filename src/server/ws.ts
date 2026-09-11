/**
 * board 广播。
 *
 * 两个 topic（judge / spectator）连的是**同一个** `MatchSession`，
 * 区别只在 `getBoard(topic)` 走哪个投影 —— 观众那侧的 board 里根本没有诊断字段，
 * 所以「大屏不泄漏」在传输层就已经成立了，不依赖前端自觉。
 *
 * 发送策略（对应 spec §3.3）：
 *   - `board` 是小消息，摘要变化时才推（由 session 的 ticker 决定）；
 *   - `trajectory` 是**一次性**的：只在产生时推、以及 WS 连接建立时补推一次
 *     （重连恢复）。绝不随 ticker 重复广播。
 */

import type { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { MatchSession } from './session';
import { ClientMessage, ServerMessage, Topic, isTopic } from './protocol';
import { checkOriginAndHost } from './security';

export interface WsHub {
  close(): Promise<void>;
}

export function attachWebSocket(server: Server, session: MatchSession): WsHub {
  const wss = new WebSocketServer({ noServer: true });
  let seq = 0;

  const currentPort = (): number => {
    const addr = server.address();
    return typeof addr === 'object' && addr ? addr.port : 0;
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // WS upgrade **不经过** http 请求管线，必须自己校验 Host / Origin，
    // 否则一个恶意网页可以直接开一条直通裁判 topic 的信道。
    const sec = checkOriginAndHost(req, currentPort());
    if (!sec.ok) {
      socket.write(`HTTP/1.1 ${sec.status} Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const topic = url.searchParams.get('topic');
    if (!isTopic(topic)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // topic 是本次 upgrade 解析出来的，直接带进连接处理 ——
      // 不走 `emit('connection', ...)`（那条签名只有 ws/req，塞不进第三个参数）
      handleConnection(ws, topic);
    });
  });

  function handleConnection(ws: WebSocket, topic: Topic): void {
    const send = (msg: ServerMessage): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(msg));
    };

    // 连接建立：hello + 当前 board + 当前轨迹（若有）—— 重连即恢复现场
    send({ type: 'hello', topic, seq: ++seq });
    send({ type: 'board', topic, seq: ++seq, board: session.getBoard(topic) });
    const handle = session.getBoard(topic).trajectoryHandle;
    if (handle) {
      const traj = session.getTrajectory(handle.id);
      if (traj) send({ type: 'trajectory', topic, trajectory: traj });
    }

    const unsubscribe = session.onChange((ev) => {
      if (ev.kind === 'board') {
        send({ type: 'board', topic, seq: ++seq, board: session.getBoard(topic) });
      } else {
        send({ type: 'trajectory', topic, trajectory: ev.trajectory });
      }
    });

    ws.on('message', (raw: Buffer) => {
      let msg: ClientMessage | null = null;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return; // 非法消息直接忽略，不打断连接
      }
      if (msg?.type === 'ping') send({ type: 'pong' });
    });

    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  }

  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
