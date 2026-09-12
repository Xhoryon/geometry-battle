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

import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { MatchSession } from './session';
import {
  ClientMessage,
  ServerMessage,
  Topic,
  WS_INVALID_TOKEN,
  isTopic,
  teamOfTopic,
} from './protocol';
import { checkOriginAndHost } from './security';
import { parseRequestTarget } from './http';

/**
 * topic 的能力格（见 `tokens.ts` 文件头）：
 *
 *   - `spectator`：脱敏只读投影，大屏语义要求**匿名可访问**；
 *   - `judge`：裁判令牌 —— 裁判板在 reveal 前就带双方锚点身份，绝不能不设卡；
 *   - `team-a` / `team-b`：**对应那一队**的令牌（不是裁判令牌 —— 不搞矩阵，
 *     队伍面的唯一入口就是裁判台「参赛者入口」给出的链接）。
 */
function isAuthorizedTopic(session: MatchSession, topic: Topic, presented: string | null): boolean {
  if (topic === 'spectator') return true;
  if (topic === 'judge') return session.tokens.isJudge(presented);
  const team = teamOfTopic(topic);
  return team !== null && session.tokens.teamOf(session.currentMatchId(), presented) === team;
}

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

  /**
   * upgrade 监听器是**同步**的：这里抛出的异常不会被任何 promise 接住，
   * 直接就是 uncaughtException → 进程退出。而 `new URL('//')` 恰好就会抛 ——
   * 一个畸形目标不该能掀掉整个比赛服务（Final Audit P0-1）。
   * 因此整条 upgrade 处理路径都自带兜底。
   */
  server.on('upgrade', (req, socket, head) => {
    try {
      handleUpgrade(req, socket, head);
    } catch {
      socket.destroy();
    }
  });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = parseRequestTarget(req.url);
    if (!url || url.pathname !== '/ws') {
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
    // 令牌只能走查询串：浏览器**无法**给 `WebSocket` 设置请求头。
    // 这是全链路里令牌唯一必须出现在 request-line 的位置（页面 URL 已改用 fragment）。
    const authorized = isAuthorizedTopic(session, topic, url.searchParams.get('t'));

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!authorized) {
        // ⚠️ **绝不调用 `handleConnection`。**
        // 它第一行就 `send({type:'hello'})` + `send({type:'board', ...})`，
        // 所以把鉴权写进它开头，会让裁判板在关闭**之前**完整推给未鉴权连接 ——
        // 而客户端确实收到了 4401，回归测试照样绿。假绿就藏在这个顺序里。
        ws.close(WS_INVALID_TOKEN, 'invalid-token');
        return;
      }
      // topic 是本次 upgrade 解析出来的，直接带进连接处理 ——
      // 不走 `emit('connection', ...)`（那条签名只有 ws/req，塞不进第三个参数）
      try {
        handleConnection(ws, topic);
      } catch {
        ws.terminate();
      }
    });
  }

  function handleConnection(ws: WebSocket, topic: Topic): void {
    const send = (msg: ServerMessage): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(msg));
    };

    /**
     * 这条连接是在**哪个场次**上通过授权的。
     *
     * 参赛者令牌随 `matchId` 派生，所以「换场」等于「令牌轮换」。但轮换只让
     * **新请求**失效 —— 已经建立的 WS 不会自己重扫，它会带着旧场次的授权继续
     * 收到新场次的（本队）只读状态。那与 `README.md` 的承诺不符：
     * 「上一场的人不该继续持有下一场的访问权」。
     *
     * 所以这里记住授权时的场次，推送前发现已经换场就断开。
     * 只对参赛者 topic 生效：裁判令牌是进程生命周期的，观众大屏本来就该
     * 跨场一直开着。
     */
    const teamTopic = teamOfTopic(topic);
    const authorizedMatchId = session.currentMatchId();

    // 连接建立：hello + 当前 board + 当前轨迹（若有）—— 重连即恢复现场
    send({ type: 'hello', topic, seq: ++seq });
    const board = session.getBoard(topic);
    send({ type: 'board', topic, seq: ++seq, board });
    // 参赛者板没有轨迹句柄（它不看比赛画面），只有观众/裁判会拿到
    const handle = 'trajectoryHandle' in board ? board.trajectoryHandle : null;
    if (handle) {
      const traj = session.getTrajectory(handle.id);
      if (traj) send({ type: 'trajectory', topic, trajectory: traj });
    }

    const unsubscribe = session.onChange((ev) => {
      // 换场即断，**在推送之前**判断 —— 否则这条陈旧连接会先收到一条新场次的 board
      // 再被关闭，而「收到过新场次的本队状态」正是要避免的那件事。
      if (teamTopic && session.currentMatchId() !== authorizedMatchId) {
        unsubscribe();
        ws.close(WS_INVALID_TOKEN, 'match-rotated');
        return;
      }
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
