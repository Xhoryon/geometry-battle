/**
 * REST 路由 + 静态资源。
 *
 * 分工：REST 只承载**用户操作**（命令）与只读查询；实时状态一律走 WS。
 *
 * 错误处理原则：
 *   - **预期内的失败**（阶段不对、算法没装、校验没过）一律 HTTP 200 +
 *     `{ ok:false, errors:[人话] }` —— 那是比赛的一部分，不是服务器故障；
 *   - 只有协议层错误（Host/Origin/Content-Type/路径越权/JSON 解析）才用 4xx；
 *   - 未预期异常回 500，且**不回堆栈**。
 */

import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { MatchSession } from './session';
import { listReplays, loadReplay } from './replays';
import { checkCommandRequest } from './security';
import { downsampleTrajectory } from '../ui/TrajectoryAnimator';
import { Replay } from '../core/Logs';
import {
  COMMAND_PATHS,
  CommandResult,
  JUDGE_READ_PATHS,
  TEAM_COMMAND_PATHS,
  TRAJECTORY_MAX_POINTS,
  WireDifficulty,
} from './protocol';
import { MAX_UPLOAD_BYTES, UploadedFile } from './upload';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * 上传端点的体积上限。
 *
 * 「装下 8MB 的包 + base64 的 33% 开销 + JSON 包装」还留有余量。
 * 其它端点仍然受 64KB 限制 —— 不因为多了一个上传口就把全局闸门放松。
 */
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BYTES + 2 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface HttpDeps {
  session: MatchSession;
  artifactRoot: string;
  /** 前端构建产物目录（`web/dist`）；不存在时给出可操作的提示 */
  distDir: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    // 本地应用：禁缓存，免得改了前端还要手动清
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJsonBody(
  req: IncomingMessage,
  limit = MAX_BODY_BYTES
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    total += b.length;
    if (total > limit) throw new Error('请求体过大');
    chunks.push(b);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
  return parsed as Record<string, unknown>;
}

function asTeam(v: unknown): 'A' | 'B' | null {
  return v === 'A' || v === 'B' ? v : null;
}

/** 查询串里的队别（大小写不敏感：`?team=a` 与 `?team=A` 都收） */
function asTeamQuery(v: string | null): 'A' | 'B' | null {
  if (typeof v !== 'string') return null;
  const u = v.trim().toUpperCase();
  return u === 'A' || u === 'B' ? (u as 'A' | 'B') : null;
}

// ============================================================================
// 访问令牌（V1.2 Final RC Audit 的 P1 修复）
// ============================================================================

/** 需要**裁判**令牌的命令（精确路径，不是前缀匹配） */
const JUDGE_COMMANDS: readonly string[] = Object.values(COMMAND_PATHS);
/** 需要**对应队伍**令牌的命令 */
const TEAM_COMMANDS: readonly string[] = Object.values(TEAM_COMMAND_PATHS);

const UNAUTHORIZED_MESSAGE = '缺少或无效的访问令牌';
const UNAUTHORIZED: CommandResult = { ok: false, errors: [UNAUTHORIZED_MESSAGE] };

/** 401 —— 鉴权失败是**协议层**错误，所以用 4xx 而不是既有的「200 + ok:false」 */
function sendUnauthorized(res: ServerResponse): void {
  sendJson(res, 401, { ok: false, errors: [UNAUTHORIZED_MESSAGE] });
}

/**
 * 取出调用方出示的令牌。
 *
 * - **POST 只认请求头**：request-line 是最容易进日志、进错误报告、进截图的位置，
 *   而 POST 完全没必要把令牌放进去（浏览器能设头）。
 * - **GET 允许回退到 `?t=`**：纯粹为了让 curl / 测试 / 下一次审计能一行命令探测。
 * - **WS 只能走 `?t=`**：浏览器无法给 `WebSocket` 设置请求头（见 `ws.ts`）。
 *
 * 注意令牌**不是**秘密凭据（没有用户名密码），它是 capability：持有即可行使其权限。
 * 因此「查询串里出现令牌」在 GET/WS 上是可接受的，而页面 URL 本身改用 fragment
 * `#t=`，让它既不进 request-line 也不进 `Referer`。
 */
function presentedToken(req: IncomingMessage, url: URL, method: string): string | null {
  const h = req.headers['x-gb-token'];
  const header = Array.isArray(h) ? h[0] ?? null : h ?? null;
  if (header) return header;
  if (method === 'POST') return null;
  return url.searchParams.get('t');
}

/**
 * 裁判面的门禁。
 *
 * 为什么**必须**有这一道：`boards.ts` 的裁判板「Emitter 选择在这里给全」
 * （参赛者板才按队别裁剪），而 `Match.ts` 的快照在队伍**一选就**填 `emitterChoice`。
 * 也就是说裁判板在 reveal 前就带着双方的锚点身份 —— 所以只给参赛者加令牌
 * 根本关不掉这个洞：打开 `/judge` 就看到了。
 */
function requireJudge(session: MatchSession, presented: string | null): CommandResult | null {
  return session.tokens.isJudge(presented) ? null : UNAUTHORIZED;
}

/**
 * 参赛者面的门禁：令牌解析出的队伍必须**与入参一致**。
 *
 * 刻意不做「用令牌决定队伍、忽略入参」：那样一个客户端 bug（模板变量拼错）会
 * **静默操作另一支队伍**并回 `ok:true`。现场「请求成功了但动的是别人」比
 * 「401 被拒」坏一个数量级。而且 `body.team` / `?team=` 在分派与投影里到处都是，
 * 宣称忽略它而代码里还留着，就是下一次回归的种子。
 */
function requireTeam(
  session: MatchSession,
  team: 'A' | 'B',
  presented: string | null
): CommandResult | null {
  const resolved = session.tokens.teamOf(session.currentMatchId(), presented);
  return resolved === team ? null : UNAUTHORIZED;
}

/**
 * 命令的鉴权分派。
 *
 * 返回 `null` 表示放行**或**「这个路径不归鉴权管」—— 未知路径仍然走
 * `dispatchCommand` 的 `default → null → 404`。**不能**用
 * `pathname.startsWith('/api/judge/')`：那会把 `POST /api/judge/not-a-thing`
 * 从 404 变成 401，既有用例「未知接口回 404」当场变红。
 */
function authorizeCommand(
  session: MatchSession,
  pathname: string,
  body: Record<string, unknown>,
  presented: string | null
): CommandResult | null {
  if (JUDGE_COMMANDS.includes(pathname)) return requireJudge(session, presented);
  if (TEAM_COMMANDS.includes(pathname)) {
    const team = asTeam(body.team);
    // 形状不对时**不**在这里拒绝：交给 dispatchCommand 回它那句「team 必须是 A 或 B」，
    // 保持既有语义（那是人话提示，不是鉴权失败）。
    if (!team) return null;
    return requireTeam(session, team, presented);
  }
  return null;
}

function asDifficulty(v: unknown): WireDifficulty | undefined {
  return v === 'easy' || v === 'medium' || v === 'hard' ? v : undefined;
}

function asOptionalInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

/** 回放体积控制：轨迹是全分辨率的，发出去前降到协议上限 */
function downsampleReplay(replay: Replay): Replay {
  return {
    ...replay,
    frames: replay.frames.map((f) => ({
      ...f,
      trajectoryA: downsampleTrajectory(f.trajectoryA, TRAJECTORY_MAX_POINTS),
      trajectoryB: downsampleTrajectory(f.trajectoryB, TRAJECTORY_MAX_POINTS),
    })),
  };
}

/**
 * 发送一个静态文件。
 *
 * **必须等 `open` 成功再写响应头。** 直接 `fs.createReadStream(f).pipe(res)` 有两个
 * 叠加的坏处：文件打不开时 200 头**已经发出去了**，而且源流上的 `'error'` 没有任何
 * 监听器 —— 它会升级成 uncaughtException，把整个比赛服务带走。
 *
 * Final Re-Gate 实测过这条路径：`web/dist` 里放一个 mode-000 文件，
 * **一次 GET 就让进程 exit(1)**。那与本轮修掉的 `GET //` 是同一类事故：
 * 一个请求不该能结束整场赛事。
 *
 * 现在的顺序是：先 `open` 成功 → 才 `writeHead(200)` → 再管道传输；
 * 打不开则回一个**受控**状态码，进程继续服务。传输途中出错由 `pipeline`
 * 负责销毁两端（客户端中途断开也不会留下悬挂的读流）。
 */
function sendFile(res: ServerResponse, file: string, headers: Record<string, string>): void {
  const stream = fs.createReadStream(file);
  stream.once('open', () => {
    if (res.headersSent || res.writableEnded) {
      stream.destroy();
      return;
    }
    res.writeHead(200, headers);
    pipeline(stream, res, () => {
      /* 传输结束或某一端出错：pipeline 已负责销毁两端，这里无需再做什么 */
    });
  });
  stream.once('error', (e: NodeJS.ErrnoException) => {
    stream.destroy();
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    const status = e.code === 'ENOENT' ? 404 : e.code === 'EACCES' || e.code === 'EPERM' ? 403 : 500;
    sendJson(res, status, { ok: false, errors: ['静态资源不可读'] });
  });
}

function serveStatic(deps: HttpDeps, pathname: string, res: ServerResponse): boolean {
  const root = path.resolve(deps.distDir);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(root, `.${requested}`);

  // 路径穿越防御：解析后必须仍在 dist 内
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    sendJson(res, 403, { ok: false, errors: ['路径不被允许'] });
    return true;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    sendFile(res, resolved, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    return true;
  }

  // SPA fallback：/judge、/spectator、/replay/:id 都由前端路由接管
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) {
    sendFile(res, index, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return true;
  }

  sendText(
    res,
    503,
    '前端尚未构建。请先运行 `npm run build:web`（或开发时用 `npm run app:dev`）。\n'
  );
  return true;
}

/**
 * 解析请求目标。
 *
 * `new URL('//', base)` / `new URL('///', base)` / `new URL('http://[', base)`
 * 这类**畸形请求目标**会让 `new URL` 抛 `ERR_INVALID_URL`。那是一次*请求*的错误，
 * 不是进程的错误 —— 必须就地收敛成 `null`（→ 400）。
 *
 * 原实现把这一句放在所有校验之前、且不在任何 try 内，于是浏览器地址栏里
 * 多打一个斜杠（`http://127.0.0.1:17800//` 的 request-target 就是 `//`）
 * 就能让整个比赛服务进程退出（Final Audit P0-1）。
 */
export function parseRequestTarget(raw: string | undefined): URL | null {
  try {
    return new URL(raw ?? '/', 'http://127.0.0.1');
  } catch {
    return null;
  }
}

export function createRequestHandler(deps: HttpDeps) {
  /**
   * 最后一道闸：`handle` 是 async 的，而 `main.ts` 用 `void handler(req, res)` 调用它 ——
   * 没人接这个 promise，**一条漏出去的 rejection 就是一次进程退出**。
   * 因此这里把逃逸的异常收敛成一次 500 响应（绝不回堆栈），
   * 让「一个坏请求」最多影响「那一个请求」。
   *
   * 注意这不是「吞掉异常继续跑」：能走到这里说明前面的分支都已经被正确地
   * 局部兜住了，剩下的是真正的未知异常，而它只影响当前这个响应。
   * 进程级未知异常由 `main.ts` 的 unhandledRejection / uncaughtException 处理（记录 + 退出）。
   */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(deps, req, res);
    } catch {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { ok: false, errors: ['服务器内部错误'] });
    }
  };
}

async function route(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const port = ((): number => {
    const a = req.socket.localPort;
    return typeof a === 'number' ? a : 0;
  })();

  const url = parseRequestTarget(req.url);
  if (!url) {
    // 畸形目标（`//`、`///`、`http://[` …）：回 4xx，**服务必须继续活着**
    sendJson(res, 400, { ok: false, errors: ['请求目标无法解析'] });
    return;
  }
    // **不整段 decodeURIComponent**：那会把 `%2F` 变成真实的路径分隔符，
    // 让「路由匹配」和「路径分段」被同一段输入操纵。id 一律在取用时单独解码，
    // 且解码结果只用于**查表**（见 replays.ts），不用于拼路径。
    const pathname = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // 非 /api 的请求交给静态资源（SPA）。
    // GET 的校验内容就是 Host + Origin —— 静态资源不受 Content-Type 约束。
    if (!pathname.startsWith('/api/')) {
      const hostCheck = checkCommandRequest(req, port);
      if (!hostCheck.ok) {
        sendJson(res, hostCheck.status, { ok: false, errors: [hostCheck.message] });
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { ok: false, errors: ['只支持 GET'] });
        return;
      }
      serveStatic(deps, pathname, res);
      return;
    }

    const sec = checkCommandRequest(req, port);
    if (!sec.ok) {
      sendJson(res, sec.status, { ok: false, errors: [sec.message] });
      return;
    }

    // 协议层三闸（Host / Origin / Content-Type）**先于**鉴权：
    // 403 / 415 的语义不能因为多了一层令牌而改变。
    const presented = presentedToken(req, url, method);

    try {
      // ---- 只读 ----
      if (method === 'GET' && pathname === '/api/health') {
        // 只回一个 id。**不要**投影整块裁判板：那会走 packageFiles + slotStates +
        // inspectPackage（读盘 + 哈希），而这个端点**故意**不设卡，
        // 于是它会变成一个任何调用方都能踩的放大器。
        sendJson(res, 200, { ok: true, version: 1, matchId: deps.session.currentMatchId() });
        return;
      }
      if (method === 'GET' && pathname === '/api/judge/state') {
        if (requireJudge(deps.session, presented)) {
          sendUnauthorized(res);
          return;
        }
        sendJson(res, 200, { ok: true, board: deps.session.getBoard('judge') });
        return;
      }
      if (method === 'GET' && pathname === '/api/replays') {
        sendJson(res, 200, { ok: true, replays: listReplays(deps.artifactRoot) });
        return;
      }
      if (method === 'GET' && pathname.startsWith('/api/replays/')) {
        const id = decodeURIComponent(pathname.slice('/api/replays/'.length));
        const r = loadReplay(deps.artifactRoot, id);
        if (!r.ok) {
          // `reasonKey` / `reasonParams` 是**纯附加**字段：浏览器认不出键时
          // 回退到 `errors[0]`（服务端原文），与 board 的错误处理同一套约定。
          sendJson(res, r.status, {
            ok: false,
            errors: [r.message],
            reasonKey: r.reasonKey,
            reasonParams: r.reasonParams,
          });
          return;
        }
        sendJson(res, 200, { ok: true, replay: downsampleReplay(r.replay), match: r.match });
        return;
      }
      // ---- 参赛者端只读（V1.2）----
      if (method === 'GET' && pathname === '/api/team/state') {
        const team = asTeamQuery(url.searchParams.get('team'));
        if (!team) {
          sendJson(res, 400, { ok: false, errors: ['team 必须是 a / A / b / B'] });
          return;
        }
        // 形状（400）先于身份（401）：缺参数和没身份是两件事，不该混成一句
        if (requireTeam(deps.session, team, presented)) {
          sendUnauthorized(res);
          return;
        }
        sendJson(res, 200, { ok: true, board: deps.session.getBoard(team === 'A' ? 'team-a' : 'team-b') });
        return;
      }
      if (method === 'GET' && pathname === '/api/team/source') {
        const team = asTeamQuery(url.searchParams.get('team'));
        const rel = url.searchParams.get('path') ?? '';
        if (!team) {
          sendJson(res, 400, { ok: false, errors: ['team 必须是 a / A / b / B'] });
          return;
        }
        if (requireTeam(deps.session, team, presented)) {
          sendUnauthorized(res);
          return;
        }
        const r = deps.session.readOwnSource(team, rel);
        if (!r.ok) {
          sendJson(res, 400, { ok: false, errors: r.errors });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          path: rel,
          text: r.text,
          truncated: r.truncated ?? false,
          binary: r.binary ?? false,
        });
        return;
      }
      // ---- 裁判端只读（V1.2 §一：主办方核对选手交上来的源码）----
      if (method === 'GET' && pathname === JUDGE_READ_PATHS.source) {
        const team = asTeamQuery(url.searchParams.get('team'));
        const rel = url.searchParams.get('path') ?? '';
        if (!team) {
          sendJson(res, 400, { ok: false, errors: ['team 必须是 a / A / b / B'] });
          return;
        }
        if (requireJudge(deps.session, presented)) {
          sendUnauthorized(res);
          return;
        }
        const r = deps.session.readSlotSource(team, rel);
        if (!r.ok) {
          sendJson(res, 400, { ok: false, errors: r.errors });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          path: rel,
          text: r.text,
          truncated: r.truncated ?? false,
          binary: r.binary ?? false,
        });
        return;
      }
      if (method === 'GET' && pathname.startsWith('/api/trajectory/')) {
        const id = decodeURIComponent(pathname.slice('/api/trajectory/'.length));
        const traj = deps.session.getTrajectory(id);
        if (!traj) {
          sendJson(res, 404, { ok: false, errors: ['没有这条轨迹'] });
          return;
        }
        sendJson(res, 200, { ok: true, trajectory: traj });
        return;
      }

      // ---- 命令（全部 POST） ----
      if (method === 'POST') {
        // 只有上传端点放宽体积上限；其余一律 64KB
        const limit = pathname === TEAM_COMMAND_PATHS.upload ? MAX_UPLOAD_BODY_BYTES : undefined;
        const body = await readJsonBody(req, limit);
        // 鉴权排在 body 解析**之后**，这是被既有用例钉死的顺序：
        //   - 坏 JSON 必须仍然回 400（协议层错误先于身份）
        //   - 未知路径必须仍然回 404（`authorizeCommand` 对非命令路径返回 null）
        // 代价：上传端点在鉴权前会缓冲一个请求体。那是**既有行为**（此前无条件读），
        // 且已有 MAX_UPLOAD_BODY_BYTES 封顶，不新增暴露面。
        const denied = authorizeCommand(deps.session, pathname, body, presented);
        if (denied) {
          sendUnauthorized(res);
          return;
        }
        const result = await dispatchCommand(deps.session, pathname, body);
        if (result === null) {
          sendJson(res, 404, { ok: false, errors: ['未知接口'] });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      // 未命中任何路由的 GET 是「未知接口」（404），不是「方法不对」——
      // 注意 `new URL()` 会把 `/api/replays/..` 规范化成 `/api/`，
      // 所以带 `..` 的探测到这里会落到这条分支，而不是去碰文件系统。
      if (method === 'GET' || method === 'HEAD') {
        sendJson(res, 404, { ok: false, errors: ['未知接口'] });
        return;
      }

      sendJson(res, 405, { ok: false, errors: [`${method} 不被支持`] });
    } catch (e) {
      // 协议层错误（JSON 解析、体积）与真正的服务器异常在这里汇合；
      // **绝不回堆栈** —— 回堆栈对使用者没有价值，对探测者有。
      const msg = (e as Error).message;
      const status = msg.includes('JSON') || msg.includes('过大') ? 400 : 500;
      sendJson(res, status, { ok: false, errors: [status === 400 ? msg : '服务器内部错误'] });
    }
}

async function dispatchCommand(
  session: MatchSession,
  pathname: string,
  body: Record<string, unknown>
): Promise<CommandResult | null> {
  switch (pathname) {
    case COMMAND_PATHS.newMatch:
    case COMMAND_PATHS.reset:
      return session.newMatch({
        seed: asOptionalInt(body.seed),
        pointCount: asOptionalInt(body.pointCount),
        difficulty: asDifficulty(body.difficulty),
      });
    case COMMAND_PATHS.install: {
      const team = asTeam(body.team);
      const sourceDir = typeof body.sourceDir === 'string' ? body.sourceDir : '';
      if (!team) return { ok: false, errors: ['team 必须是 A 或 B'] };
      if (!sourceDir) return { ok: false, errors: ['缺少 sourceDir（算法目录绝对路径）'] };
      return session.install(team, sourceDir);
    }
    case COMMAND_PATHS.useSlot: {
      const team = asTeam(body.team);
      if (!team) return { ok: false, errors: ['team 必须是 A 或 B'] };
      return session.useSlot(team);
    }
    case COMMAND_PATHS.preflight:
      return session.preflight();
    case COMMAND_PATHS.start:
      return session.startMatch();
    case COMMAND_PATHS.reveal:
      return session.reveal();
    case COMMAND_PATHS.startRound:
      return session.startRound();
    case COMMAND_PATHS.compute:
      return session.compute();
    case COMMAND_PATHS.runToEnd:
      return session.runToEnd();
    case COMMAND_PATHS.prepare:
      return session.prepareMatch();

    // ---- 参赛者端命令（V1.2）----
    case TEAM_COMMAND_PATHS.upload: {
      const team = asTeam(body.team);
      if (!team) return { ok: false, errors: ['team 必须是 A 或 B'] };
      const files = asUploadedFiles(body.files);
      if (!files) return { ok: false, errors: ['files 必须是 [{path, contentBase64}]'] };
      return session.uploadPackage(team, files);
    }
    case TEAM_COMMAND_PATHS.selectEmitter: {
      const team = asTeam(body.team);
      if (!team) return { ok: false, errors: ['team 必须是 A 或 B'] };
      const pointId = typeof body.pointId === 'string' ? body.pointId : '';
      if (!pointId) return { ok: false, errors: ['缺少 pointId'] };
      return session.selectEmitter(team, pointId);
    }
    case TEAM_COMMAND_PATHS.lockEmitter: {
      const team = asTeam(body.team);
      if (!team) return { ok: false, errors: ['team 必须是 A 或 B'] };
      return session.lockEmitter(team);
    }
    default:
      return null;
  }
}

/** 把请求体里的 files 字段收敛成受控形状；形状不对就返回 null（不猜） */
function asUploadedFiles(v: unknown): UploadedFile[] | null {
  if (!Array.isArray(v)) return null;
  const out: UploadedFile[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.path !== 'string' || typeof rec.contentBase64 !== 'string') return null;
    out.push({ path: rec.path, contentBase64: rec.contentBase64 });
  }
  return out;
}
