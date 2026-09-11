/**
 * web-server —— 本地 Web 服务的**端到端**回归
 *
 * 这里起的是**真的** HTTP 服务与**真的** WS 连接，跑的是**真的**算法
 * （`playtest/competitors/solver-fast` vs `solver-hybrid`），不是 mock。
 *
 * 断言四组东西：
 *
 *   1. **完整链路能走完**：装两队 → 校验 → 开赛 → 多轮 → 终局 → 回放 → 重置 → 第二场。
 *      并且**只按 board 标记 enabled 的动作点** —— 如果服务端的启用判据与引擎的真实
 *      门禁不一致，某一步就会返回 ok:false，本套件立刻红。这是「UI 不许再猜一套规则」
 *      的机器化守卫。
 *   2. **观众通道不泄漏**：真跑了比赛之后的 board 里仍不得出现禁用键与绝对路径。
 *   3. **轨迹只发一次**：同一个 id 的 trajectory 消息恰好一条（重连补推另算）。
 *   4. **本机边界**：伪造 Host、跨源 Origin、越权 matchId 一律被拒。
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { WebSocket } from 'ws';
import {
  CANONICAL_SLOT_ROOT,
  RUNTIME_SLOT_ROOT,
  RunningServer,
  seedRuntimeSlots,
  startServer,
} from '../src/server/main';
import { isSafeMatchId, listReplays, loadReplay, resolveMatchDir } from '../src/server/replays';
import { JudgeBoard, ServerMessage } from '../src/server/protocol';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const ALGO_A = path.join(REPO, 'playtest', 'competitors', 'solver-fast');
const ALGO_B = path.join(REPO, 'playtest', 'competitors', 'solver-hybrid');

/** failure-path 夹具：只在**正式轮**（round ≥ 1）失败，因此能通过安装时的 decoy preflight */
const ALGO_CRASH = path.join(REPO, 'tests', 'fixtures', 'algos', 'crash-on-real-round');
const ALGO_TIMEOUT = path.join(REPO, 'tests', 'fixtures', 'algos', 'timeout-on-real-round');

/** operator-e2e 已验证会终止的组合（points=6 / easy） */
const SEED = 700001;
const POINTS = 6;

const MATCH_TIMEOUT_MS = 8 * 60 * 1000;

// ---------------------------------------------------------------------------
// HTTP / WS 小工具（raw http 才能伪造 Host —— fetch 会覆盖它）
// ---------------------------------------------------------------------------

interface RawResponse {
  status: number;
  text: string;
}

function rawRequest(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/',
        headers: opts.headers ?? {},
        // 关键：不要用 Node 的默认 Host 覆盖我们伪造的那个
        setHost: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function post(port: number, p: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const r = await rawRequest(port, {
    method: 'POST',
    path: p,
    headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: JSON.parse(r.text) };
}

async function get(port: number, p: string): Promise<{ status: number; body: any }> {
  const r = await rawRequest(port, { path: p, headers: { Host: `127.0.0.1:${port}` } });
  return { status: r.status, body: JSON.parse(r.text) };
}

/** 同 get()，但容忍非 JSON 响应（越权探测可能落到静态处理器上） */
async function getRaw(
  port: number,
  p: string
): Promise<{ status: number; body: unknown; text: string }> {
  const r = await rawRequest(port, { path: p, headers: { Host: `127.0.0.1:${port}` } });
  let body: unknown = null;
  try {
    body = JSON.parse(r.text);
  } catch {
    body = null;
  }
  return { status: r.status, body, text: r.text };
}

/** 递归收集对象里出现过的全部键名（含值为 null 的键 —— 泄漏常是 `"hash": null` 这种形状） */
function collectKeys(v: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(v)) {
    for (const item of v) collectKeys(item, out);
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      out.add(k);
      collectKeys(val, out);
    }
  }
  return out;
}

async function judgeState(port: number): Promise<JudgeBoard> {
  const r = await get(port, '/api/judge/state');
  assertEqual(r.status, 200, '裁判板查询应成功');
  return r.body.board as JudgeBoard;
}

// ---------------------------------------------------------------------------
// 演练（只跑一次，后续用例复用它的结果）
// ---------------------------------------------------------------------------

interface Rehearsal {
  srv: RunningServer;
  root: string;
  artifactRoot: string;
  matchId: string;
  rounds: number;
  spectatorMessages: ServerMessage[];
  trajectoryIds: string[];
  finalBoard: JudgeBoard;
  secondMatchId: string;
}

let rehearsal: Rehearsal | null = null;

function connect(port: number, topic: 'judge' | 'spectator', sink: ServerMessage[]): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?topic=${topic}`);
  ws.on('message', (raw: Buffer) => {
    try {
      sink.push(JSON.parse(String(raw)) as ServerMessage);
    } catch {
      /* 非法消息不应出现；忽略以免中断收集 */
    }
  });
  return ws;
}

function waitFor(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

/** 等到某条 judge board 满足条件（或超时） */
function boardUntil(
  port: number,
  predicate: (b: JudgeBoard) => boolean,
  deadlineMs: number,
  what: string
): Promise<JudgeBoard> {
  const deadline = Date.now() + deadlineMs;
  return (async () => {
    for (;;) {
      const b = await judgeState(port);
      if (predicate(b)) return b;
      assert(Date.now() < deadline, `等待「${what}」超时（当前 lastError=${JSON.stringify(b.lastError)}）`);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
}

/**
 * 发一条**原始**请求行。
 *
 * 必须绕过 Node 的 http 客户端：它会对目标做规范化、并直接拒绝含空格等字符的
 * 目标 —— 那样就测不到**服务端**的解析行为了。畸形目标是本次回归的主角，
 * 得原样送到线上去。
 */
function rawSocketRequest(
  port: number,
  requestLine: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 5000
): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const socket = net.connect(port, '127.0.0.1', () => {
      const headers = [`Host: 127.0.0.1:${port}`, 'Connection: close', ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`)];
      socket.write(`${requestLine}\r\n${headers.join('\r\n')}\r\n\r\n`);
    });
    const done = (): void => resolve(buf);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      done();
    });
    socket.on('data', (c) => {
      buf += String(c);
    });
    socket.on('close', done);
    socket.on('error', done);
  });
}

/** 起一个**独立**的服务实例（自己的槽位 / 产物目录），供 failure-path 用例使用 */
async function startIsolated(opts: { teamA?: string; teamB?: string } = {}): Promise<{
  srv: RunningServer;
  port: number;
  root: string;
  artifactRoot: string;
}> {
  const root = tmpDir('webfail');
  const artifactRoot = path.join(root, 'artifacts');
  const srv = await startServer({
    port: 0,
    slotRoot: path.join(root, 'algorithms'),
    artifactRoot,
    sandboxRoot: path.join(root, 'sandboxes'),
    distDir: path.join(root, 'no-dist'),
    seed: 730001,
    pointCount: 6,
    difficulty: 'easy',
  });
  const port = srv.port;
  const a = await post(port, '/api/judge/install', { team: 'A', sourceDir: opts.teamA ?? ALGO_A });
  assert(a.body.ok, `Team A 安装应成功：${JSON.stringify(a.body.errors)}`);
  const b = await post(port, '/api/judge/install', { team: 'B', sourceDir: opts.teamB ?? ALGO_B });
  assert(b.body.ok, `Team B 安装应成功：${JSON.stringify(b.body.errors)}`);
  return { srv, port, root, artifactRoot };
}

/** 把一场比赛推到「正式轮第一轮结算完毕」，返回该轮之后的裁判板 */
async function playFirstRealRound(port: number): Promise<JudgeBoard> {
  await act(port, 'use-slot-a');
  await act(port, 'use-slot-b');
  await act(port, 'preflight');
  await act(port, 'start');
  await act(port, 'reveal');
  await act(port, 'start-round');
  await act(port, 'compute');
  return judgeState(port);
}

/** 按 board 的 enabled 标记执行一个动作 —— 未启用就直接失败，不「绕过」 */
async function act(port: number, key: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const board = await judgeState(port);
  const action = board.actions.find((a) => a.key === key);
  assert(action, `board 上必须存在动作 ${key}`);
  assert(action!.enabled, `动作 ${key} 应处于启用状态（hint: ${action!.hint}）`);

  const PATH_OF: Record<string, string> = {
    'use-slot-a': '/api/judge/use-slot',
    'use-slot-b': '/api/judge/use-slot',
    preflight: '/api/judge/preflight',
    start: '/api/judge/start',
    reveal: '/api/judge/reveal',
    'start-round': '/api/judge/start-round',
    compute: '/api/judge/compute',
  };
  const pathOf = PATH_OF[key];
  assert(pathOf, `动作 ${key} 必须有对应接口`);

  const payload =
    key === 'use-slot-a' ? { team: 'A' } : key === 'use-slot-b' ? { team: 'B' } : body;
  const r = await post(port, pathOf, payload);
  assertEqual(r.status, 200, `${key} 应回 200（预期内的失败也是 200 + ok:false）`);
  assert(r.body.ok, `${key} 必须成功，实际错误：${JSON.stringify(r.body.errors)}`);
  return r;
}

async function waitForMatchEnd(port: number): Promise<JudgeBoard> {
  const deadline = Date.now() + MATCH_TIMEOUT_MS;
  for (;;) {
    const board = await judgeState(port);
    if (board.phase === 'MATCH_END') return board;
    assert(Date.now() < deadline, `比赛未在 ${MATCH_TIMEOUT_MS / 1000}s 内终止（当前 ${board.phase} round ${board.round}）`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function runRehearsal(): Promise<Rehearsal> {
  const root = tmpDir('websrv');
  const artifactRoot = path.join(root, 'artifacts');
  const srv = await startServer({
    port: 0,
    slotRoot: path.join(root, 'algorithms'),
    artifactRoot,
    sandboxRoot: path.join(root, 'sandboxes'),
    distDir: path.join(root, 'no-dist'),
    seed: SEED,
    pointCount: POINTS,
    difficulty: 'easy',
  });
  const port = srv.port;

  const spectatorMessages: ServerMessage[] = [];
  const ws = connect(port, 'spectator', spectatorMessages);
  await waitFor(ws);

  // ---- 载入两队：走 Advanced 的安装流水线（真跑 decoy preflight）----
  const iA = await post(port, '/api/judge/install', { team: 'A', sourceDir: ALGO_A });
  assert(iA.body.ok, `Team A 安装应成功：${JSON.stringify(iA.body.errors)}`);
  const iB = await post(port, '/api/judge/install', { team: 'B', sourceDir: ALGO_B });
  assert(iB.body.ok, `Team B 安装应成功：${JSON.stringify(iB.body.errors)}`);

  // ---- 正式主流程：Preflight → 开赛 → 手动跑两轮 → 一键跑完 ----
  await act(port, 'use-slot-a');
  await act(port, 'use-slot-b');
  await act(port, 'preflight');
  await act(port, 'start');

  for (let i = 0; i < 2; i++) {
    await act(port, 'reveal');
    await act(port, 'start-round');
    await act(port, 'compute');
  }

  // 后台推进余下回合：请求立即返回，比赛由 WS 推进
  const runBoard = await judgeState(port);
  const runAction = runBoard.actions.find((a) => a.key === 'run-to-end');
  assert(runAction?.enabled, '跑完余下回合应可用');
  const runRes = await post(port, '/api/judge/run-to-end', {});
  assert(runRes.body.ok, 'run-to-end 应立即受理');
  assertEqual(runRes.body.detail?.background, true, 'run-to-end 必须是后台任务，不得阻塞请求');

  const finalBoard = await waitForMatchEnd(port);
  const matchId = finalBoard.matchId;
  assert(finalBoard.verdict, '终局必须带判决');

  // ---- 回放 ----
  // 回合数从**落盘产物**取：board 上有意不带回合数组（那是观众看得见的最小的板，
  // 不该塞整本 MatchLog）。
  const one = await get(port, `/api/replays/${encodeURIComponent(matchId)}`);
  assertEqual(one.status, 200, '刚打完的这一场必须能立刻从回放接口读到');
  const rounds: number = one.body.match.rounds.length;
  assertEqual(rounds, finalBoard.round, '落盘回合数必须与 board 上的回合号一致');

  const list = await get(port, '/api/replays');
  assertEqual(list.status, 200, '回放索引应可读');
  assert(
    (list.body.replays as { matchId: string }[]).some((r) => r.matchId === matchId),
    '回放索引必须包含刚打完的这一场'
  );

  // ---- 重置 + 第二场（这次只用「使用槽位算法」，不重装）----
  const reset = await post(port, '/api/judge/reset', { seed: 700002, pointCount: POINTS, difficulty: 'easy' });
  assert(reset.body.ok, `重置应成功：${JSON.stringify(reset.body.errors)}`);
  const afterReset = await judgeState(port);
  assert(afterReset.matchId !== matchId, '重置后必须是新的一场（matchId 变）');
  assertEqual(afterReset.phase, 'SETUP', '重置后回到 SETUP');
  assertEqual(afterReset.arena.points.length, 0, '重置后不应残留上一场的点位');

  await act(port, 'use-slot-a');
  await act(port, 'use-slot-b');
  const secondMatchId = (await judgeState(port)).matchId;

  const trajectoryIds = spectatorMessages
    .filter((m): m is Extract<ServerMessage, { type: 'trajectory' }> => m.type === 'trajectory')
    .map((m) => m.trajectory.id);

  ws.close();
  return {
    srv,
    root,
    artifactRoot,
    matchId,
    rounds,
    spectatorMessages,
    trajectoryIds,
    finalBoard,
    secondMatchId,
  };
}

async function ensure(): Promise<Rehearsal> {
  if (!rehearsal) rehearsal = await runRehearsal();
  return rehearsal;
}

// ===========================================================================
// 用例
// ===========================================================================

test('完整链路：载入两队 → 校验 → 开赛 → 多轮 → 终局 → 回放 → 重置 → 第二场', async () => {
  const r = await ensure();
  assertEqual(r.finalBoard.phase, 'MATCH_END', '最终阶段必须是 MATCH_END');
  assert(r.rounds >= 1, `至少要打一回合，实际 ${r.rounds}`);
  assert(
    ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(r.finalBoard.verdict!.endReason),
    `终止原因必须是四种之一，实际 ${r.finalBoard.verdict!.endReason}`
  );
  assert(r.secondMatchId.length > 0, '第二场必须已经建立');
});

test('只点 board 标记 enabled 的动作 —— 每一步都不得失败', async () => {
  // 这条用例的断言全部发生在演练过程中（act() 里）；
  // 能走到这里说明服务端的启用判据与引擎的真实门禁一致。
  const r = await ensure();
  assert(r.finalBoard.actions.length >= 8, '裁判板必须列全动作清单');
  assert(
    r.finalBoard.actions.every((a) => typeof a.hint === 'string' && a.hint.length > 0),
    '每个动作都必须带一句人话提示'
  );
});

test('观众 board 在真实对局结束后仍不含禁用键', async () => {
  const r = await ensure();
  const boards = r.spectatorMessages.filter((m) => m.type === 'board').map((m) => (m as { board: any }).board);
  assert(boards.length > 0, '观众通道必须收到过 board');
  const last = boards[boards.length - 1];

  const FORBIDDEN = ['audit', 'artifactDir', 'hash', 'isolation', 'manifest', 'packages', 'runtime', 'seed', 'settings', 'slots', 'sourceDir', 'stack'];
  const spectatorKeys = collectKeys(last, new Set<string>());
  for (const bad of FORBIDDEN) {
    assert(!spectatorKeys.has(bad), `观众 board 不得出现键 "${bad}"`);
  }
  // 反空转对照：裁判板**必须**含这些键。
  // 没有这条，上面那圈断言在「投影整个空掉」时也会全绿。
  const judgeKeys = collectKeys(r.finalBoard, new Set<string>());
  assert(judgeKeys.has('hash'), `裁判板本该带 hash（对照），实际键：${[...judgeKeys].sort().join(',')}`);
  assert(judgeKeys.has('audit'), '裁判板本该带 audit（对照）');
  assert(judgeKeys.has('slots') && judgeKeys.has('runtime'), '裁判板本该带 slots 与 runtime（对照）');
});

test('观众 board 在真实对局结束后仍不含绝对路径', async () => {
  const r = await ensure();
  const boards = r.spectatorMessages.filter((m) => m.type === 'board').map((m) => (m as { board: any }).board);
  const json = JSON.stringify(boards);
  for (const prefix of ['/Users/', '/var/folders/', '/private/', r.root]) {
    assert(!json.includes(prefix), `观众通道不得出现绝对路径前缀 "${prefix}"`);
  }
});

test('轨迹每个 id 只推一次（不随 ticker 重复广播）', async () => {
  const r = await ensure();
  assert(r.trajectoryIds.length > 0, '观众通道必须收到过轨迹');
  const seen = new Map<string, number>();
  for (const id of r.trajectoryIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, n] of seen) {
    assertEqual(n, 1, `轨迹 ${id} 应恰好推送一次（重连补推除外），实际 ${n} 次`);
  }
  assertEqual(seen.size, r.rounds, `轨迹条数必须等于回合数 ${r.rounds}`);
});

test('轨迹载荷已降采样且只含引擎给出的点', async () => {
  const r = await ensure();
  const traj = r.spectatorMessages.find(
    (m): m is Extract<ServerMessage, { type: 'trajectory' }> => m.type === 'trajectory'
  );
  assert(traj, '至少应有一条轨迹');
  for (const side of ['A', 'B'] as const) {
    assert(traj!.trajectory[side].length <= 240, `${side} 侧轨迹不得超过 240 点`);
  }
  // 轨迹点必须落在场地内 —— 越界点说明它是被重新求值出来的，而不是引擎给的
  for (const p of traj!.trajectory.A) {
    assert(p.x >= -20.001 && p.x <= 20.001 && p.y >= -12.001 && p.y <= 12.001, `轨迹点越界: ${p.x},${p.y}`);
  }
});

test('比赛进行中观众通道能看到 COMPUTING（计算状态是实时推的）', async () => {
  const r = await ensure();
  const phases = r.spectatorMessages
    .filter((m) => m.type === 'board')
    .map((m) => (m as { board: { phase: string } }).board.phase);
  assert(phases.includes('COMPUTING'), `观众通道必须观察到 COMPUTING，实际观察到：${[...new Set(phases)].join(',')}`);
});

test('回放可加载且轨迹已降采样、不重跑算法', async () => {
  const r = await ensure();
  const one = await get(r.srv.port, `/api/replays/${encodeURIComponent(r.matchId)}`);
  assertEqual(one.status, 200, '本场回放应可加载');
  assertEqual(one.body.replay.frames.length, r.rounds, '回放帧数必须等于回合数');
  assertEqual(one.body.match.matchId, r.matchId, '回放必须与比赛对得上');
  for (const f of one.body.replay.frames) {
    assert(f.trajectoryA.length <= 240 && f.trajectoryB.length <= 240, '回放轨迹必须已降采样');
  }
});

// ---------------------------------------------------------------------------
// 本机边界
// ---------------------------------------------------------------------------

test('伪造 Host 一律 403（挡 DNS rebinding）', async () => {
  const r = await ensure();
  const res = await rawRequest(r.srv.port, {
    path: '/api/health',
    headers: { Host: 'evil.example' },
  });
  assertEqual(res.status, 403, '非回环 Host 必须被拒');
  assert(res.text.includes('Host'), '拒绝理由必须说清是 Host');
});

test('跨源 POST 一律 403（挡 CSRF）', async () => {
  const r = await ensure();
  const res = await rawRequest(r.srv.port, {
    method: 'POST',
    path: '/api/judge/compute',
    headers: {
      Host: `127.0.0.1:${r.srv.port}`,
      Origin: 'http://evil.example',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assertEqual(res.status, 403, '跨源命令必须被拒');
});

test('非 JSON 体的 POST 一律 415（挡跨站表单）', async () => {
  const r = await ensure();
  const res = await rawRequest(r.srv.port, {
    method: 'POST',
    path: '/api/judge/compute',
    headers: { Host: `127.0.0.1:${r.srv.port}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'a=1',
  });
  assertEqual(res.status, 415, '表单体必须被拒');
});

test('跨源 WS upgrade 被拒（挡直连裁判通道）', async () => {
  const r = await ensure();
  const ws = new WebSocket(`ws://127.0.0.1:${r.srv.port}/ws?topic=judge`, {
    headers: { Origin: 'http://evil.example' },
  });
  const outcome = await new Promise<string>((resolve) => {
    ws.once('open', () => resolve('open'));
    ws.once('error', () => resolve('rejected'));
    ws.once('unexpected-response', () => resolve('rejected'));
    setTimeout(() => resolve('timeout'), 5000);
  });
  ws.terminate();
  assertEqual(outcome, 'rejected', '跨源 WS 必须被拒');
});

/** 恶意 / 越界的 matchId 样本 */
const HOSTILE_IDS = [
  '..',
  '.',
  '../../etc/passwd',
  '..%2F..%2Fetc%2Fpasswd',
  '%2e%2e%2f%2e%2e',
  'a/../../b',
  'x'.repeat(200),
  'with space',
  'nul\u0000byte',
  '.hidden',
];

test('replay 的 matchId 越权一律被拒，且绝不透露服务端路径', async () => {
  const r = await ensure();
  for (const bad of HOSTILE_IDS) {
    // 浏览器会做的编码，这里照做 —— 否则带空格/`%` 的样本连 HTTP 都发不出去
    const res = await getRaw(r.srv.port, `/api/replays/${encodeURIComponent(bad)}`);
    // 注意：`new URL()` 会把 `/api/replays/../../etc/passwd` 规范化成 `/etc/passwd`，
    // 于是它落到静态处理器上（那也不是 replay 接口，同样被拒）。
    // 因此这里断言的是「绝不成功」，而不是某一个具体状态码。
    assert(res.status >= 400, `越权 matchId "${bad}" 不得成功，实际 ${res.status}`);
    for (const prefix of ['/Users/', '/var/folders/', r.root, 'root:']) {
      assert(!res.text.includes(prefix), `越权响应不得包含 "${prefix}"`);
    }
  }
});

test('越权 matchId 在映射层被严格拒绝（含正向对照）', async () => {
  const r = await ensure();
  for (const bad of HOSTILE_IDS) {
    assertEqual(resolveMatchDir(r.artifactRoot, bad), null, `resolveMatchDir 必须拒绝 "${bad}"`);
    assert(!isSafeMatchId(bad), `isSafeMatchId 必须拒绝 "${bad}"`);
  }
  // 正向对照：真实存在的场次必须解析得到。
  // **没有这条，上面的「全 null」在传错根目录时也是绿的** —— 本轮就真的踩到了。
  const real = resolveMatchDir(r.artifactRoot, r.matchId);
  assert(real, `真实存在的 matchId ${r.matchId} 必须能解析`);
  assert(real!.startsWith(r.artifactRoot + path.sep), '解析结果必须落在产物根目录内');
  assert(isSafeMatchId(r.matchId), '真实 matchId 必须通过字符校验');
});

test('不存在的 matchId 回 404，且不透露目录内容', async () => {
  const r = await ensure();
  const res = await get(r.srv.port, '/api/replays/NoSuchMatch12345');
  assertEqual(res.status, 404, '不存在的场次应 404');
  const text = JSON.stringify(res.body);
  for (const prefix of ['/Users/', '/var/folders/', r.root]) {
    assert(!text.includes(prefix), '错误响应不得透露服务端路径');
  }
});

test('未知接口回 404，未知方法回 405', async () => {
  const r = await ensure();
  const unknown = await post(r.srv.port, '/api/judge/not-a-thing', {});
  assertEqual(unknown.status, 404, '未知接口应 404');
  const bad = await rawRequest(r.srv.port, {
    method: 'PUT',
    path: '/api/health',
    headers: { Host: `127.0.0.1:${r.srv.port}` },
  });
  assertEqual(bad.status, 405, '不支持的方法应 405');
});

test('服务端不返回堆栈（哪怕请求体是坏 JSON）', async () => {
  const r = await ensure();
  const res = await rawRequest(r.srv.port, {
    method: 'POST',
    path: '/api/judge/compute',
    headers: { Host: `127.0.0.1:${r.srv.port}`, 'Content-Type': 'application/json' },
    body: '{ this is not json',
  });
  assertEqual(res.status, 400, '坏 JSON 应回 400');
  assert(!/at .*\(.*:\d+:\d+\)/.test(res.text), '响应不得包含堆栈帧');
});

// ---------------------------------------------------------------------------
// Failure path（Final Audit 的 P0-1 / P0-3 / P0-4 / P0-5 / P0-6 / P0-8）
//
// 这一组用例存在的理由：审计发现「32 个套件全绿，却没人跑过任何一条失败路径」。
// 下面每一条都对应一个曾经真实发生过的失败，且都带**正向对照** ——
// 避免出现「实现整个坏掉时断言反而全绿」的假绿。
// ---------------------------------------------------------------------------

test('畸形请求目标回 4xx，且服务必须存活（P0-1 回归）', async () => {
  const r = await ensure();
  // `//` / `///` 会让 `new URL(target, base)` 抛 ERR_INVALID_URL；
  // 浏览器地址栏里多打一个斜杠，request-target 就正是 `//`。
  for (const target of ['//', '///', 'http://[', 'http://']) {
    const text = await rawSocketRequest(r.srv.port, `GET ${target} HTTP/1.1`);
    const statusLine = text.split('\r\n')[0] ?? '';
    assert(
      /^HTTP\/1\.\d 4\d\d/.test(statusLine),
      `请求目标 ${JSON.stringify(target)} 必须回 4xx，实际响应行：${statusLine || '(无响应)'}`
    );
  }
  // 真正的回归点：一个坏请求绝不能掀掉整个比赛服务（那一场就没法继续了）
  const health = await get(r.srv.port, '/api/health');
  assertEqual(health.status, 200, '畸形请求之后服务必须仍然存活');
});

test('畸形请求目标在 WS upgrade 路径上同样不杀服务（P0-1 回归）', async () => {
  const r = await ensure();
  // upgrade 监听器是**同步**的：那里抛出的异常直接就是 uncaughtException
  await rawSocketRequest(r.srv.port, 'GET // HTTP/1.1', {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
  });
  const health = await get(r.srv.port, '/api/health');
  assertEqual(health.status, 200, 'WS upgrade 上的畸形目标之后服务必须仍然存活');
});

test('忙时重复命令被拒，且忙窗口内 board 如实标记 busy（P0-8 回归）', async () => {
  const iso = await startIsolated();
  try {
    // install 内含一次真实 decoy preflight（秒级），是一个**稳定**的忙窗口
    const installing = post(iso.port, '/api/judge/install', { team: 'A', sourceDir: ALGO_A });
    await new Promise((r) => setTimeout(r, 150)); // 让服务端先把这条命令接起来

    const dup = await post(iso.port, '/api/judge/use-slot', { team: 'A' });
    assertEqual(dup.body.ok, false, '忙时的新命令必须被拒，不得排队进引擎');
    assert(
      (dup.body.errors as string[]).join(' ').includes('尚未完成'),
      `拒绝理由必须是人话，实际 ${JSON.stringify(dup.body.errors)}`
    );
    const busyBoard = await judgeState(iso.port);
    assertEqual(busyBoard.busy, true, '忙窗口内 board 必须如实标记 busy（否则裁判会一直白点）');

    const res = await installing;
    assert(res.body.ok, `安装本身必须成功：${JSON.stringify(res.body.errors)}`);
    // 正向对照：忙窗口结束后 busy 必须释放，否则上面的断言在「永远 busy」时也成立
    const idleBoard = await boardUntil(iso.port, (b) => !b.busy, 30_000, 'busy 释放');
    assertEqual(idleBoard.busy, false, '命令结束后 busy 必须释放');
  } finally {
    await iso.srv.close();
  }
});

test('算法 CRASH：如实上板、不泄漏诊断，且 run-to-end 不在 COUNTDOWN 启用（P0-3 / P0-8 回归）', async () => {
  const iso = await startIsolated({ teamA: ALGO_CRASH });
  try {
    const spectatorMessages: ServerMessage[] = [];
    const ws = connect(iso.port, 'spectator', spectatorMessages);
    await waitFor(ws);

    await act(iso.port, 'use-slot-a');
    await act(iso.port, 'use-slot-b');
    await act(iso.port, 'preflight');
    await act(iso.port, 'start');

    // ---- P0-3：PUBLIC 时 run-to-end 可用（正向对照）----
    const atPublic = await judgeState(iso.port);
    assertEqual(atPublic.phase, 'PUBLIC', '开赛后应停在 PUBLIC');
    assert(
      atPublic.actions.find((a) => a.key === 'run-to-end')!.enabled,
      'PUBLIC 阶段 run-to-end 必须可用（正向对照）'
    );

    await act(iso.port, 'reveal');
    await act(iso.port, 'start-round');
    const atCountdown = await judgeState(iso.port);
    assertEqual(atCountdown.phase, 'COUNTDOWN', 'START 之后应停在 COUNTDOWN');
    assertEqual(
      atCountdown.actions.find((a) => a.key === 'run-to-end')!.enabled,
      false,
      'COUNTDOWN 阶段**不得**启用 run-to-end —— 点了必然抛错，且会留下粘住的 lastError'
    );

    // ---- P0-5：先制造一条陈旧的失败说明 ----
    // 直接打 session：COUNTDOWN 下推后台循环，第一句 beginRound() 必然抛错。
    // （正常 UI 路径已经被上面那条门禁挡住了，这里是在验证**真的出错过之后**能不能自愈。）
    void iso.srv.session.runToEnd();
    const errored = await boardUntil(iso.port, (b) => b.lastError !== null, 10_000, 'lastError 出现');
    assert(errored.lastError, '后台推进失败必须留下可读的说明');

    // ---- P0-8 + P0-5：结算本轮（一条**成功**的命令）----
    await act(iso.port, 'compute');
    const after = await judgeState(iso.port);

    assertEqual(after.lastError, null, '成功的命令必须清除陈旧的失败说明（P0-5）');

    const judgeErrors = (after.lastRound?.errors ?? []).join(' | ');
    assert(judgeErrors.includes('CRASH'), `裁判板必须如实展示 CRASH，实际：${judgeErrors || '(空)'}`);
    assert(judgeErrors.includes('Team A'), `错误必须指明是哪一方，实际：${judgeErrors}`);

    // 大屏也要说话，但不得带任何开发者诊断
    const spectatorJson = JSON.stringify(spectatorMessages);
    assert(spectatorJson.includes('CRASH'), '观众板必须也展示 CRASH（大屏不是哑的）');
    for (const bad of ['/Users/', '/private/', '/var/folders/', 'at Object.', 'node_modules', 'sourceDir']) {
      assert(!spectatorJson.includes(bad), `观众通道不得出现 "${bad}"`);
    }

    ws.close();
  } finally {
    await iso.srv.close();
  }
});

test('算法 TIMEOUT：如实上板（P0-8 回归）', async () => {
  const iso = await startIsolated({ teamA: ALGO_TIMEOUT });
  try {
    const board = await playFirstRealRound(iso.port);
    const errors = (board.lastRound?.errors ?? []).join(' | ');
    assert(errors.includes('TIMEOUT'), `裁判板必须如实展示 TIMEOUT，实际：${errors || '(空)'}`);
    assert(errors.includes('Team A'), `错误必须指明是哪一方，实际：${errors}`);
    // 超时的一方必须被记为「本轮没有攻击」，而不是伪造一个结果
    assertEqual(board.lastRound?.attacksExecuted.includes('A'), false, '超时的一方不得被记为执行了攻击');
  } finally {
    await iso.srv.close();
  }
});

test('run-to-end 期间页面刷新（重连）即恢复现场并自行收敛到终局（P0-8 回归）', async () => {
  const r = await ensure();
  const port = r.srv.port;
  // 演练留下的第二场：槽位已就绪，推到正式比赛
  await act(port, 'preflight');
  await act(port, 'start');

  const run = await post(port, '/api/judge/run-to-end', {});
  assert(run.body.ok, 'run-to-end 应立即受理');
  assertEqual(run.body.detail?.background, true, 'run-to-end 必须是后台任务，不得阻塞请求');

  // ① 重复命令必须被拒 —— 否则后台循环会被开两份
  const dup = await post(port, '/api/judge/run-to-end', {});
  assertEqual(dup.body.ok, false, 'run-to-end 进行中不得再受理第二条');
  assert((dup.body.errors as string[]).join(' ').includes('尚未完成'), '拒绝理由必须是人话');

  // ② 「刷新页面」≈ 新开一条 WS：必须立刻拿到当前现场，而不是空白
  const live = new WebSocket(`ws://127.0.0.1:${port}/ws?topic=judge`);
  const first = await new Promise<JudgeBoard>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('重连后 5s 内未收到 board')), 5000);
    live.on('message', (raw: Buffer) => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      if (m.type === 'board') {
        clearTimeout(t);
        resolve(m.board as JudgeBoard);
      }
    });
    live.on('error', reject);
  });
  assert(first.phase !== 'SETUP', `重连必须拿到进行中的现场，实际 phase=${first.phase}`);

  // ③ 重连的客户端不做任何操作，也会自行收敛到终局
  const terminal = await new Promise<JudgeBoard>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('重连的 WS 未收到终局 board')), MATCH_TIMEOUT_MS);
    live.on('message', (raw: Buffer) => {
      const m = JSON.parse(raw as unknown as string) as ServerMessage;
      if (m.type === 'board' && (m.board as JudgeBoard).phase === 'MATCH_END') {
        clearTimeout(t);
        resolve(m.board as JudgeBoard);
      }
    });
  });
  live.close();
  assert(terminal.verdict, '重连的客户端必须能拿到终局判决');

  // ④ 比赛本身没被重复命令破坏，正常跑完后也不得残留失败说明（P0-5）
  const finalBoard = await waitForMatchEnd(port);
  assert(finalBoard.verdict, '终局必须带判决');
  assertEqual(finalBoard.lastError, null, '比赛正常跑完后不得残留失败说明');
});

test('回放列表与加载排除「未终结」与「旧版自相矛盾」的产物（P0-4 回归）', async () => {
  const root = tmpDir('replay-classify');
  const write = (id: string, match: unknown): void => {
    const dir = path.join(root, 'matches', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'match.json'), JSON.stringify(match));
    fs.writeFileSync(path.join(dir, 'replay.json'), JSON.stringify({ schemaVersion: 1, matchId: id, frames: [] }));
  };
  const base = { schemaVersion: 1, rounds: [], startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:10:00Z' };

  // 正常终结 —— 必须出现在列表里（正向对照：否则「全排除」也是绿的）
  write('GOOD-ONE', { ...base, matchId: 'GOOD-ONE', endReason: 'ELIMINATION', winner: 'A' });
  // 未终结：每轮落盘会让它进目录，但不得冒充正常结果
  write('UNFINISHED-ONE', { ...base, matchId: 'UNFINISHED-ONE', endReason: 'NONE', winner: 'draw' });
  // 修复前的旧产物：一方全灭却被写成平局（本机 artifacts/ 里就躺着 130 场这种）
  write('LEGACY-ONE', { ...base, matchId: 'LEGACY-ONE', endReason: 'ELIMINATION', winner: 'draw' });

  const listed = listReplays(root).map((e) => e.matchId);
  assertEqual(listed, ['GOOD-ONE'], `只有已终结且自洽的场次能进正常回放列表，实际 ${JSON.stringify(listed)}`);

  const good = loadReplay(root, 'GOOD-ONE');
  assert(good.ok, '正常终结的产物必须加载得到（正向对照）');

  const unfinished = loadReplay(root, 'UNFINISHED-ONE');
  assertEqual(unfinished.ok, false, '未终结的比赛不得作为回放加载');
  assertEqual((unfinished as { status: number }).status, 409, '必须与「没有这场比赛」区分开');

  const legacy = loadReplay(root, 'LEGACY-ONE');
  assertEqual(legacy.ok, false, '自相矛盾的旧产物不得作为回放加载');
  assert(
    (legacy as { message: string }).message.includes('自相矛盾'),
    `拒绝理由必须说清是数据问题，实际：${(legacy as { message: string }).message}`
  );
  // 与「不存在」区分：不存在的仍是 404
  assertEqual((loadReplay(root, 'NoSuchMatch') as { status: number }).status, 404, '不存在的场次仍回 404');
});

test('默认 runtime 槽位根与受跟踪的 algorithms/ 隔离，且播种只读（P0-6 回归）', () => {
  // ① 默认槽位根必须**不在**受跟踪的 algorithms/ 里
  assert(
    RUNTIME_SLOT_ROOT !== CANONICAL_SLOT_ROOT &&
      !RUNTIME_SLOT_ROOT.startsWith(CANONICAL_SLOT_ROOT + path.sep),
    `默认运行期槽位根不得落在受跟踪的 algorithms/ 内，实际 ${RUNTIME_SLOT_ROOT}`
  );
  assertEqual(RUNTIME_SLOT_ROOT, path.join(REPO, 'runs', 'slots'), '默认运行期槽位根应为 runs/slots（已被 .gitignore 忽略）');

  // ② 播种：从 canonical 复制到运行期根，源目录一个字节都不能变
  const fingerprint = (dir: string): string =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? [e.name].concat(fs.readdirSync(path.join(dir, e.name)).map((f) => `${e.name}/${f}`)) : [e.name]))
      .sort()
      .join(',');
  const before = fingerprint(CANONICAL_SLOT_ROOT);
  const dest = path.join(tmpDir('seed'), 'slots');
  seedRuntimeSlots(CANONICAL_SLOT_ROOT, dest);
  assertEqual(fingerprint(CANONICAL_SLOT_ROOT), before, '播种不得改写 canonical 槽位');
  assert(fs.existsSync(path.join(dest, 'team-a', 'solver.py')), '播种必须产出可用的运行期槽位');
  assert(
    fs.readFileSync(path.join(dest, 'team-a', 'solver.py')).equals(fs.readFileSync(path.join(CANONICAL_SLOT_ROOT, 'team-a', 'solver.py'))),
    '播种出来的槽位内容必须与 canonical 一致'
  );

  // ③ 已存在的运行期槽位绝不能被 canonical 覆盖回去 ——
  //    否则选手已经投递进槽位的算法会被静默抹掉
  const payload = '# 选手投递的算法，绝不能被覆盖\n';
  fs.writeFileSync(path.join(dest, 'team-a', 'solver.py'), payload);
  seedRuntimeSlots(CANONICAL_SLOT_ROOT, dest);
  assertEqual(
    fs.readFileSync(path.join(dest, 'team-a', 'solver.py'), 'utf-8'),
    payload,
    '已存在的运行期槽位不得被 canonical 覆盖'
  );
});

test('收尾：关闭服务', async () => {
  const r = await ensure();
  await r.srv.close();
  // 关闭后再访问必须失败 —— 证明 close() 真的把监听器关掉了，没有泄漏句柄
  const after = await rawRequest(r.srv.port, { path: '/api/health', headers: { Host: `127.0.0.1:${r.srv.port}` } }).then(
    () => 'still-up',
    () => 'down'
  );
  assertEqual(after, 'down', 'close() 之后端口必须不再监听');
});

void runAll('web-server');
