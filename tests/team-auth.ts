/**
 * team-auth —— 调用方身份绑定的端到端回归（V1.2 Final RC Audit 的 P1）
 *
 * 这一套件存在的理由：独立审计发现 `/api/team/*` 与 `ws?topic=team-*` **完全没有**
 * 调用方身份校验 —— 队别由 `body.team` / `?team=` / `?topic=` 决定。投影层一直是对的
 * （`boards.ts` 的 `teamBoard` 按队裁剪），缺的是「谁有资格请求哪一队」。
 * 实测后果：读到对方 reveal 前的 Emitter 选择、代对方改选/锁定锚点、覆盖对方已提交的
 * 算法包、读对方源码。
 *
 * 同一个洞也在裁判面上：裁判板「Emitter 选择在这里给全」，而 `/api/judge/state` 与
 * `ws?topic=judge` 同样没有身份校验 ⇒ **只给参赛者加令牌关不掉这个洞**，因为打开
 * `/judge` 就能看到对方的选择。所以下面同时钉住裁判面。
 *
 * 本套件覆盖四类断言：
 *   1. 无令牌 / 错队令牌一律 401（读板、读源码、三个命令、裁判面全部入口）；
 *   2. **令牌不得抢占协议层错误** —— 403 / 415 / 404 / 400 的顺序不能变；
 *   3. **WS 未鉴权时一个字节都不发**（board 泄漏就藏在「先 send 再 close」里）；
 *   4. 反向对照 —— 公开面（health / replays / trajectory / spectator）仍然匿名可用，
 *      防止「一律设卡」这种过度收紧。
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { WebSocket } from 'ws';
import { startServer, RunningServer } from '../src/server/main';
import { WS_INVALID_TOKEN } from '../src/server/protocol';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const TEAM_PKG = {
  A: path.join(__dirname, 'fixtures', 'algos', 'arc-sweep'),
  B: path.join(__dirname, 'fixtures', 'algos', 'parabola-arc'),
} as const;

interface Ctx {
  server: RunningServer;
  root: string;
  /** **现取**令牌：队伍令牌随 `matchId` 派生，换场就变，缓存会过期 */
  toks(): { A: string; B: string };
  judge: string;
}

async function boot(): Promise<Ctx> {
  const root = tmpDir('team-auth');
  const server = await startServer({
    port: 0,
    slotRoot: path.join(root, 'slots'),
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    tournamentMode: true,
  });
  return { server, root, toks: () => server.session.teamTokens(), judge: server.judgeToken };
}

/** 把一个目录读成「浏览器上传」的形状（path + contentBase64） */
function packDir(dir: string): { path: string; contentBase64: string }[] {
  const out: { path: string; contentBase64: string }[] = [];
  const walk = (d: string, rel: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else out.push({ path: r, contentBase64: fs.readFileSync(full).toString('base64') });
    }
  };
  walk(dir, '');
  return out;
}

// ---------------------------------------------------------------------------
// HTTP 小工具（raw http 才能伪造 Host —— fetch 会覆盖它）
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
        setHost: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getJson(
  ctx: Ctx,
  p: string,
  token?: string
): Promise<{ status: number; body: any }> {
  const r = await rawRequest(ctx.server.port, {
    path: p,
    headers: { Host: `127.0.0.1:${ctx.server.port}`, ...(token ? { 'X-GB-Token': token } : {}) },
  });
  let body: any = null;
  try {
    body = JSON.parse(r.text);
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

async function postJson(
  ctx: Ctx,
  p: string,
  body: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
  const r = await rawRequest(ctx.server.port, {
    method: 'POST',
    path: p,
    headers: {
      Host: `127.0.0.1:${ctx.server.port}`,
      'Content-Type': 'application/json',
      ...(token ? { 'X-GB-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  let parsed: any = null;
  try {
    parsed = JSON.parse(r.text);
  } catch {
    parsed = null;
  }
  return { status: r.status, body: parsed };
}

interface WsOutcome {
  opened: boolean;
  code: number | null;
  reason: string;
  messages: string[];
}

/**
 * 连一条 WS 并如实记录「关闭码」与「关闭前收到的每一条消息」。
 *
 * `messages` 是这个套件里最要紧的一个字段：`ws.ts` 的 `handleConnection` 第一行就
 * `send({type:'hello'})` + `send({type:'board', ...})`，所以鉴权只要写错位置
 * （放进 `handleConnection` 开头而不是它之前），裁判板就会在关闭**之前**完整推给
 * 未鉴权连接 —— 而客户端仍然收到 4401，只断言关闭码的测试照样绿。
 * 因此「未授权时 messages 必须为空」是必答项。
 */
function probeWs(port: number, query: string, expectMessages = 0, timeoutMs = 8000): Promise<WsOutcome> {
  return new Promise((resolve) => {
    const messages: string[] = [];
    let opened = false;
    let code: number | null = null;
    let reason = '';
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        /* 已经关了 */
      }
      resolve({ opened, code, reason, messages });
    };

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
    ws.on('open', () => {
      opened = true;
    });
    ws.on('message', (raw: Buffer) => {
      messages.push(String(raw));
      // 只有**正向**用例（expectMessages > 0）才够数收工。
      // 负向用例必须一路等到 close / 超时，把泄漏出来的每一条都收齐 ——
      // 否则「关闭前一个字节都不发」这条断言会因为提前退出而变成空的假绿。
      if (expectMessages > 0 && messages.length >= expectMessages) finish();
    });
    ws.on('close', (c: number, r: Buffer) => {
      code = c;
      reason = String(r);
      finish();
    });
    ws.on('error', () => {
      /* close 紧随其后，统一在那里收工 */
    });
    setTimeout(finish, timeoutMs);
  });
}

async function judgeBoard(ctx: Ctx): Promise<any> {
  const r = await getJson(ctx, '/api/judge/state', ctx.judge);
  assertEqual(r.status, 200, '带裁判令牌读裁判板应成功');
  return r.body.board;
}

// ===========================================================================
// 1. 参赛者面：没有令牌就什么都拿不到
// ===========================================================================

test('team-auth: 未带令牌的参赛者请求一律 401（读板 / 读源码 / 三个命令）', async () => {
  const ctx = await boot();
  try {
    const reads = ['/api/team/state?team=a', '/api/team/state?team=b', '/api/team/source?team=a&path=solver.py'];
    for (const p of reads) {
      const r = await getJson(ctx, p);
      assertEqual(r.status, 401, `${p} 无令牌必须 401`);
    }
    const cmds: [string, unknown][] = [
      ['/api/team/upload', { team: 'A', files: [] }],
      ['/api/team/select-emitter', { team: 'A', pointId: 'x' }],
      ['/api/team/lock-emitter', { team: 'A' }],
    ];
    for (const [p, body] of cmds) {
      const r = await postJson(ctx, p, body);
      assertEqual(r.status, 401, `${p} 无令牌必须 401`);
    }
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: 拿 A 的令牌去操作 B —— 读板、改选、锁定、覆盖包全部 401', async () => {
  const ctx = await boot();
  try {
    const { A: tokA } = ctx.toks();

    // B 先由裁判装一份包，这样「有没有被 A 覆盖」有一个可比对的基准
    const installed = await postJson(ctx, '/api/judge/install', { team: 'B', sourceDir: TEAM_PKG.B }, ctx.judge);
    assert(installed.body?.ok, `裁判安装 B 的包应成功：${JSON.stringify(installed.body?.errors ?? [])}`);
    const hashBefore = (await judgeBoard(ctx)).slots.B.hash;
    assert(typeof hashBefore === 'string' && hashBefore.length > 0, 'B 槽位应已有本场密封哈希');

    const cross: [string, string, unknown][] = [
      ['GET', '/api/team/state?team=b', undefined],
      ['GET', '/api/team/source?team=b&path=solver.py', undefined],
      ['POST', '/api/team/select-emitter', { team: 'B', pointId: 'B1' }],
      ['POST', '/api/team/lock-emitter', { team: 'B' }],
      ['POST', '/api/team/upload', { team: 'B', files: packDir(TEAM_PKG.A) }],
    ];
    for (const [method, p, body] of cross) {
      const r = method === 'GET' ? await getJson(ctx, p, tokA) : await postJson(ctx, p, body, tokA);
      assertEqual(r.status, 401, `持 A 的令牌打 ${method} ${p} 必须 401（实际 ${r.status}）`);
    }

    // 最要紧的一条：被拒之后对方的槽位必须**一个字节都没被动过**
    const hashAfter = (await judgeBoard(ctx)).slots.B.hash;
    assertEqual(hashAfter, hashBefore, 'A 的令牌不得改动 B 已提交的包');
  } finally {
    await ctx.server.close();
  }
});

// ===========================================================================
// 2. 裁判面：只给参赛者加令牌关不掉这个洞
// ===========================================================================

test('team-auth: 裁判面（读 state / 读 source / 全部命令）无令牌一律 401', async () => {
  const ctx = await boot();
  try {
    for (const p of ['/api/judge/state', '/api/judge/source?team=a&path=solver.py']) {
      const r = await getJson(ctx, p);
      assertEqual(r.status, 401, `${p} 无裁判令牌必须 401`);
    }

    const commands: [string, unknown][] = [
      ['/api/judge/new-match', {}],
      ['/api/judge/reset', {}],
      ['/api/judge/install', { team: 'A', sourceDir: TEAM_PKG.A }],
      ['/api/judge/use-slot', { team: 'A' }],
      ['/api/judge/preflight', {}],
      ['/api/judge/start', {}],
      ['/api/judge/reveal', {}],
      ['/api/judge/start-round', {}],
      ['/api/judge/compute', {}],
      ['/api/judge/run-to-end', {}],
      ['/api/judge/prepare', {}],
    ];
    for (const [p, body] of commands) {
      const r = await postJson(ctx, p, body);
      assertEqual(r.status, 401, `${p} 无裁判令牌必须 401（实际 ${r.status}）`);
    }

    // 反向对照：**拿参赛者令牌打裁判面同样不行** —— 能力位之间不互通
    const { A: tokA } = ctx.toks();
    const asTeam = await getJson(ctx, '/api/judge/state', tokA);
    assertEqual(asTeam.status, 401, '参赛者令牌不得读裁判板');
    const cmd = await postJson(ctx, '/api/judge/reveal', {}, tokA);
    assertEqual(cmd.status, 401, '参赛者令牌不得下达裁判命令');
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: 裁判板下发本场队伍令牌，参赛者板里没有这个字段', async () => {
  const ctx = await boot();
  try {
    const jb = await judgeBoard(ctx);
    const live = ctx.toks();
    assertEqual(jb.teamTokens, { A: live.A, B: live.B }, '裁判板必须下发本场的两个队伍令牌');

    // 参赛者板是**另一个**投影函数，里面根本没有这个字段 —— 传输层就不发
    const { A: tokA } = live;
    const tb = await getJson(ctx, '/api/team/state?team=a', tokA);
    assertEqual(tb.status, 200, '带本队令牌读板应成功');
    assert(!('teamTokens' in tb.body.board), '参赛者板不得含任何令牌字段');
  } finally {
    await ctx.server.close();
  }
});

// ===========================================================================
// 3. 顺序：令牌不得抢占协议层错误
//
// 这组断言是「门禁必须用精确路径、且排在 readJsonBody 之后」的理由。它们与
// `tests/web-server.ts` 里那三条既有用例是同一件事 —— 这里独立再钉一次，
// 因为一次「顺手改成 startsWith('/api/judge/')」就会让 404 变 401。
// ===========================================================================

test('team-auth: 鉴权不得抢占协议层错误（403 / 415 / 404 / 400 顺序不变）', async () => {
  const ctx = await boot();
  const port = ctx.server.port;
  try {
    // 伪造 Host → 403（挡 DNS rebinding），且必须早于 401
    const forged = await rawRequest(port, {
      method: 'POST',
      path: '/api/judge/compute',
      headers: { Host: 'evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assertEqual(forged.status, 403, '伪造 Host 必须仍然 403，不能被 401 抢占');

    // 跨源 → 403（挡 CSRF）
    const crossOrigin = await rawRequest(port, {
      method: 'POST',
      path: '/api/judge/compute',
      headers: { Host: `127.0.0.1:${port}`, Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assertEqual(crossOrigin.status, 403, '跨源 POST 必须仍然 403');

    // 非 JSON 体 → 415（挡跨站表单）
    const form = await rawRequest(port, {
      method: 'POST',
      path: '/api/judge/compute',
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    });
    assertEqual(form.status, 415, '表单体必须仍然 415');

    // **未知接口 → 404**（不是 401）—— 这条是「禁止 startsWith 前缀门禁」的直接守卫
    const unknown = await postJson(ctx, '/api/judge/not-a-thing', {});
    assertEqual(unknown.status, 404, '未知裁判接口必须仍然 404，不能因为前缀匹配变成 401');

    // 坏 JSON → 400（协议层错误先于身份）
    const badJson = await rawRequest(port, {
      method: 'POST',
      path: '/api/judge/compute',
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    assertEqual(badJson.status, 400, '坏 JSON 必须仍然 400，不能被 401 抢占');
    assert(!/at .*\(.*:\d+:\d+\)/.test(badJson.text), '响应不得包含堆栈帧');
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: 畸形令牌一律 401 而不是 500（定长比较的长度守卫）', async () => {
  const ctx = await boot();
  try {
    // `crypto.timingSafeEqual` 在长度不等时抛 RangeError —— 没有长度守卫的话
    // 这里会冒到 route() 的 catch 变成 500，既是一条未捕获路径，
    // 也把「长度对不对」这个信号送给探测者。
    const weird = ['', 'a', 'x'.repeat(1000), '!!!not-base64url!!!', ' '];
    for (const t of weird) {
      const r = await getJson(ctx, '/api/team/state?team=a', t);
      assertEqual(r.status, 401, `畸形令牌 ${JSON.stringify(t.slice(0, 12))} 必须 401（实际 ${r.status}）`);
      const j = await getJson(ctx, '/api/judge/state', t);
      assertEqual(j.status, 401, `畸形令牌打裁判面必须 401（实际 ${j.status}）`);
    }

    // 换行只能从查询串注入（Node 的 HTTP 客户端会拒发含 CR/LF 的请求头）。
    // 令牌走 `safeEqual` 的定长比较，所以这里同样是 401 —— 不是异常、更不是 500。
    const injected = await getJson(ctx, `/api/team/state?team=a&t=${encodeURIComponent('a\nb')}`);
    assertEqual(injected.status, 401, '换行注入必须 401');
    const injectedJudge = await getJson(ctx, `/api/judge/state?t=${encodeURIComponent('a\r\nb')}`);
    assertEqual(injectedJudge.status, 401, 'CRLF 注入裁判面必须 401');
  } finally {
    await ctx.server.close();
  }
});

// ===========================================================================
// 4. WebSocket
// ===========================================================================

test('team-auth: WS 持 A 的令牌连 team-b —— 收到 4401，且关闭前一个字节都不发', async () => {
  const ctx = await boot();
  try {
    const { A: tokA, B: tokB } = ctx.toks();

    // 反向：A 的令牌连对方 topic
    const cross = await probeWs(ctx.server.port, `topic=team-b&t=${tokA}`);
    // 先断消息、再断关闭码：消息泄漏是更严重的那一件事，失败信息也应该先说它
    assertEqual(cross.messages, [], '未授权连接在关闭前**不得收到任何消息**（hello/board 都不行）');
    assertEqual(cross.code, 4401, `跨队 topic 必须关闭码 4401（实际 ${cross.code}）`);

    // 完全没令牌
    const none = await probeWs(ctx.server.port, 'topic=team-b');
    assertEqual(none.messages, [], '未授权连接不得收到任何消息');
    assertEqual(none.code, 4401, '无令牌连 team-b 必须 4401');

    const judgeNone = await probeWs(ctx.server.port, 'topic=judge');
    assertEqual(judgeNone.messages, [], '裁判板在 reveal 前带双方锚点 —— 不得流向未授权连接');
    assertEqual(judgeNone.code, 4401, '无裁判令牌连 judge 必须 4401');

    // 正向对照：本队令牌必须真的能连上并收到 hello + board
    const ok = await probeWs(ctx.server.port, `topic=team-b&t=${tokB}`, 2);
    assert(ok.opened, '带本队令牌应能完成握手');
    assert(ok.messages.length >= 2, '授权连接应收到 hello + board');
    assertEqual(ok.code, null, '授权连接不应被立即关闭');
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: spectator 仍然匿名可连（防过度设卡）', async () => {
  const ctx = await boot();
  try {
    const spec = await probeWs(ctx.server.port, 'topic=spectator', 2);
    assert(spec.opened, '观众大屏必须能匿名连接 —— 它的语义就是给任何人看');
    assert(spec.messages.length >= 2, '匿名观众应收到 hello + board');
    // 而且发出去的板里不得夹带令牌
    const joined = spec.messages.join('');
    assert(!joined.includes(ctx.judge), '观众板不得夹杂裁判令牌');
    assert(!joined.includes(ctx.toks().A), '观众板不得夹杂参赛者令牌');
  } finally {
    await ctx.server.close();
  }
});

// ===========================================================================
// 5. 轮换
// ===========================================================================

test('team-auth: 换场之后旧队伍令牌失效，裁判令牌不受影响', async () => {
  const ctx = await boot();
  try {
    const before = ctx.toks();
    const r = await postJson(ctx, '/api/judge/new-match', {}, ctx.judge);
    assert(r.body?.ok, `裁判开新场应成功：${JSON.stringify(r.body?.errors ?? [])}`);

    const after = ctx.toks();
    assert(before.A !== after.A, '换场后 A 的令牌必须变化');
    assert(before.B !== after.B, '换场后 B 的令牌必须变化');

    // 旧令牌：读板与命令都拒
    const staleRead = await getJson(ctx, '/api/team/state?team=a', before.A);
    assertEqual(staleRead.status, 401, '上一场的队伍令牌必须失效');
    const staleCmd = await postJson(ctx, '/api/team/lock-emitter', { team: 'A' }, before.A);
    assertEqual(staleCmd.status, 401, '上一场的队伍令牌不得下达命令');

    // 新令牌：可用
    const fresh = await getJson(ctx, '/api/team/state?team=a', after.A);
    assertEqual(fresh.status, 200, '本场的新令牌必须可用');

    // 裁判令牌：**不随场次轮换** —— 否则组织者按一次 new-match 就锁死自己开着的裁判页
    const jb = await getJson(ctx, '/api/judge/state', ctx.judge);
    assertEqual(jb.status, 200, '裁判令牌不得随场次失效');
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: 换场必须断掉已建立的参赛者 WS，且断开前不再推新场次的 board', async () => {
  const ctx = await boot();
  try {
    const { A: tokA } = ctx.toks();

    // 保持观察：`expectMessages = 0` 表示一路收到关闭为止（不是收到一条就收工）
    const watching = probeWs(ctx.server.port, `topic=team-a&t=${tokA}`, 0, 8000);
    await new Promise((r) => setTimeout(r, 400)); // 让它先连上并收到旧场次的 hello+board

    const r = await postJson(ctx, '/api/judge/new-match', {}, ctx.judge);
    assert(r.body?.ok, `裁判开新场应成功：${JSON.stringify(r.body?.errors ?? [])}`);
    const newMatchId = ctx.server.session.currentMatchId();

    const out = await watching;
    assert(out.opened, '（前置）这条连接本来应当能建立');
    // **最关键的一条**：陈旧连接绝不能收到新场次的任何一条 board。
    // 令牌轮换只让新请求失效；若不断开旧连接，它会带着上一场的授权继续读本队状态。
    assertEqual(
      out.messages.filter((m) => m.includes(newMatchId)),
      [],
      '换场后陈旧连接不得收到新场次的 board'
    );
    assert(
      out.messages.length <= 2,
      `换场后最多只该有旧场次的 hello+board，实际收到 ${out.messages.length} 条`
    );
    assertEqual(out.code, WS_INVALID_TOKEN, `换场应主动断开该连接（实际关闭码 ${out.code}）`);
  } finally {
    await ctx.server.close();
  }
});

test('team-auth: 换场**不**影响裁判与观众的连接（它们本就该跨场开着）', async () => {
  const ctx = await boot();
  try {
    // 反向对照：上面那条修复最容易犯的错是「一律断开」——
    // 裁判令牌是进程生命周期的，观众大屏更是本来就该跨场一直开着。
    const j = probeWs(ctx.server.port, `topic=judge&t=${ctx.judge}`, 0, 5000);
    const s = probeWs(ctx.server.port, 'topic=spectator', 0, 5000);
    await new Promise((r) => setTimeout(r, 400));

    const r = await postJson(ctx, '/api/judge/new-match', {}, ctx.judge);
    assert(r.body?.ok, `裁判开新场应成功：${JSON.stringify(r.body?.errors ?? [])}`);
    const newMatchId = ctx.server.session.currentMatchId();

    const [jo, so] = await Promise.all([j, s]);
    assertEqual(jo.code, null, '裁判连接不得因换场被断开');
    assertEqual(so.code, null, '观众大屏连接不得因换场被断开');
    assert(
      jo.messages.some((m) => m.includes(newMatchId)),
      '裁判连接应当继续收到新场次的 board'
    );
    assert(
      so.messages.some((m) => m.includes(newMatchId)),
      '观众大屏应当继续收到新场次的 board'
    );
  } finally {
    await ctx.server.close();
  }
});

// ===========================================================================
// 6. 反向对照：公开面不能被顺手关掉
// ===========================================================================

test('team-auth: 公开面（health / replays / trajectory）仍然匿名可访问', async () => {
  const ctx = await boot();
  try {
    const health = await getJson(ctx, '/api/health');
    assertEqual(health.status, 200, 'health 必须匿名可用（它现在是测试与工具链的存活探针）');
    assertEqual(health.body.matchId, ctx.server.session.currentMatchId(), 'health 必须回当前场次 id');

    const replays = await getJson(ctx, '/api/replays');
    assertEqual(replays.status, 200, '回放索引必须匿名可用');

    const traj = await getJson(ctx, '/api/trajectory/nope');
    assertEqual(traj.status, 404, '未知轨迹回 404（这张面不设卡，只是查不到）');
  } finally {
    await ctx.server.close();
  }
});

void runAll('team-auth');
