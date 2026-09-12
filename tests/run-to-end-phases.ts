/**
 * run-to-end-phases —— 「连续跑完余下回合」的**阶段契约**回归
 *
 * ## 背景（V1.3 窄口径复评 P1）
 *
 * `runToEndBlocker()`（`src/server/boards.ts`，与裁判板按钮的 `enabled` **共用同一
 * 判据**）把 **READY / PUBLIC / REVEAL** 三个阶段都判为「可以连续推进」。但
 * `MatchSession.runToEnd()` 的循环原本**无条件**重放 `beginRound(); revealRound();`
 * —— 那套次序只在 READY 起点成立。于是从 REVEAL 起点进入时：
 *
 *     beginRound()      REVEAL → PUBLIC（把已经生成好的本轮揭盲打回「等待揭盲」）
 *     revealRound()     见 pendingReveal 已存在 → 提前返回，**不推回** REVEAL
 *     judgeStartRound() phase !== 'REVEAL' → { ok: false }
 *     循环 return       比赛永久停在 PUBLIC / 0 回合
 *
 * 此后 reveal / start-round / run-to-end 全部无法推进（`revealRound()` 的同一条
 * 提前返回分支让它们都变成空操作），唯一出路是换场重开 —— 而换场会作废双方
 * 已经锁定的 Emitter。这条路径在界面上就是裁判的正常两步：「揭晓本轮」→
 * 「连续跑完余下回合」，**此前零测试覆盖**（既有 e2e 与 `server-team` 一律在
 * READY 阶段点 run-to-end）。
 *
 * ## 本套件钉死的不变量
 *
 *   `runToEndBlocker()` 说允许  ⇒  `runToEnd()` 能从**那个阶段**向前推进
 *
 * 逐个允许阶段各跑一场真比赛到终局，并断言：阶段不回退、本轮已揭晓的
 * 绑定状态（roundStateHash）被原样结算、回合数递增、到达终局、没有换场、
 * Emitter 锁定不变。
 */

import * as fs from 'fs';
import * as path from 'path';
import { startServer, RunningServer } from '../src/server/main';
import { runToEndPreparation } from '../src/server/session';
import { loadReplay } from '../src/server/replays';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import type { WirePhase } from '../src/server/protocol';

const REPO = path.join(__dirname, '..');
const TEAM_PKG = {
  A: path.join(__dirname, 'fixtures', 'algos', 'arc-sweep'),
  B: path.join(__dirname, 'fixtures', 'algos', 'parabola-arc'),
} as const;

/**
 * `WirePhase` 的**运行期**清单。
 *
 * 类型联合在运行期不存在，而本套件要逐阶段验证契约，所以必须写一份。
 * 数量与内容由下面的第一条用例对着 `runToEndPreparation` 的返回值钉住 ——
 * 将来加了新阶段却忘了在这里登记，那条用例的「未登记的阶段」断言会红。
 */
const ALL_PHASES: readonly WirePhase[] = [
  'SETUP',
  'UPLOAD_A',
  'UPLOAD_B',
  'PREFLIGHT',
  'EMITTER_SELECT',
  'READY',
  'PUBLIC',
  'REVEAL',
  'COUNTDOWN',
  'COMPUTING',
  'ROUND_RESULT',
  'MATCH_END',
];

/** `runToEndBlocker()` 允许的阶段集合 —— 与上面那张表必须逐一对应 */
const RUN_TO_END_ALLOWED: readonly WirePhase[] = ['READY', 'PUBLIC', 'REVEAL'];
/** run-to-end 之后比赛必然落在这四类终局之一（Rule Revision 3 §17） */
const TERMINAL_REASONS = ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'];

// ============================================================================
// 服务与工具（与 tests/server-team.ts 同一套做法：真起 HTTP 服务）
// ============================================================================

interface Ctx {
  server: RunningServer;
  root: string;
}

const SERVERS = new Map<number, RunningServer>();

function serverOf(port: number): RunningServer {
  const srv = SERVERS.get(port);
  if (!srv) throw new Error(`端口 ${port} 没有登记服务 —— 起服务必须走 boot()`);
  return srv;
}

function tokenFor(port: number, p: string, body?: unknown): string | undefined {
  if (p.startsWith('/api/judge/')) return serverOf(port).judgeToken;
  if (p.startsWith('/api/team/')) {
    const q = /[?&]team=([abAB])/.exec(p);
    const raw = q ? q[1] : (body as { team?: unknown } | undefined)?.team;
    if (raw === 'A' || raw === 'a') return serverOf(port).session.teamTokens().A;
    if (raw === 'B' || raw === 'b') return serverOf(port).session.teamTokens().B;
  }
  return undefined;
}

async function boot(): Promise<Ctx> {
  const root = tmpDir('run-to-end');
  const server = await startServer({
    port: 0,
    slotRoot: path.join(root, 'slots'),
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    tournamentMode: true,
  });
  SERVERS.set(server.port, server);
  return { server, root };
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const u = new URL(url);
  const token = tokenFor(Number(u.port), u.pathname + u.search);
  const r = await fetch(u, { headers: token ? { 'X-GB-Token': token } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const u = new URL(url);
  const token = tokenFor(Number(u.port), u.pathname + u.search, body);
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'X-GB-Token': token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function judgeBoard(ctx: Ctx): Promise<any> {
  const r = await getJson(`${ctx.server.url}/api/judge/state`);
  assertEqual(r.status, 200, '读取裁判板应成功');
  return r.body.board;
}

function actionOf(board: any, key: string): any {
  const a = board.actions.find((x: { key: string }) => x.key === key);
  assert(a, `裁判板上应有动作 ${key}`);
  return a;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 一个目录读成「浏览器上传」的形状 */
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

/** 上传 + 筹备 + 双方锁定 → 停在 READY（可跑整场的起点） */
async function readyToPlay(ctx: Ctx): Promise<any> {
  for (const team of ['A', 'B'] as const) {
    const up = await postJson(`${ctx.server.url}/api/team/upload`, {
      team,
      files: packDir(TEAM_PKG[team]),
    });
    assert(up.body.ok, `${team} 上传应成功: ${JSON.stringify(up.body.errors)}`);
  }
  const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
  assert(prep.body.ok, `筹备应成功: ${JSON.stringify(prep.body.errors)}`);

  // 契约的另一侧：**不在**允许集合里的阶段必须被拒（不然「允许集合」就没有信息量）。
  // EMITTER_SELECT 是稳定可观测的：双方还没锁定 Emitter，不允许连续推进。
  const atEmitSelect = await judgeBoard(ctx);
  assertEqual(atEmitSelect.phase, 'EMITTER_SELECT', '筹备后应停在 EMITTER_SELECT');
  assertEqual(
    actionOf(atEmitSelect, 'run-to-end').enabled,
    false,
    'EMITTER_SELECT 不在 runToEndBlocker 的允许集合里'
  );

  let board = await judgeBoard(ctx);
  for (const team of ['A', 'B'] as const) {
    // 候选点只在**本队**的参赛者板上（裁判板是权威视角但不列候选点）
    const tb = await getJson(`${ctx.server.url}/api/team/state?team=${team.toLowerCase()}`);
    const id = tb.body.board.candidates[0].id;
    const sel = await postJson(`${ctx.server.url}/api/team/select-emitter`, { team, pointId: id });
    assert(sel.body.ok, `${team} 选择 Emitter 应成功`);
    const lock = await postJson(`${ctx.server.url}/api/team/lock-emitter`, { team });
    assert(lock.body.ok, `${team} 锁定应成功`);
  }
  board = await judgeBoard(ctx);
  assertEqual(board.phase, 'READY', '双方锁定后应停在 READY');
  return board;
}

/**
 * 等比赛到达终局。
 *
 * **一旦板上出现 `lastError` 立刻失败** —— 后台任务出错时它会如实写上原因，
 * 而阶段会永远停在原地；不等满超时才能让失败信息直接指向根因。
 */
async function waitForMatchEnd(
  ctx: Ctx,
  // 等待预算必须**远大于**一场比赛的典型耗时：本机负载高时，「双方都超时」会让
  // 回合数一路涨到硬上限（60 轮），每轮还要起两个 Python 沙箱。这里给 5 分钟
  // （对照：浏览器演练里 run-to-end 的预算是 600 秒）。注意这**不是**竞赛阈值 ——
  // 僵持上限、硬回合上限、500ms 计算预算一个字都没动。
  timeoutMs = 300_000
): Promise<{ board: any; samples: { phase: string; round: number }[] }> {
  const deadline = Date.now() + timeoutMs;
  const samples: { phase: string; round: number }[] = [];
  for (;;) {
    const board = await judgeBoard(ctx);
    samples.push({ phase: board.phase, round: board.round });
    if (board.lastError) {
      throw new Error(
        `run-to-end 的后台任务报错并停在 ${board.phase}（round ${board.round}）：${board.lastError}`
      );
    }
    if (board.phase === 'MATCH_END') return { board, samples };
    if (Date.now() > deadline) {
      throw new Error(
        `等待终局超时：停在 ${board.phase}（round ${board.round}），` +
          `已观察到的阶段序列 ${JSON.stringify(samples.map((s) => `${s.phase}/${s.round}`))}`
      );
    }
    await sleep(60);
  }
}

/** 读取落盘产物（走生产同一条 loadReplay 路径） */
function readMatch(ctx: Ctx, matchId: string): any {
  const r = loadReplay(path.join(ctx.root, 'artifacts'), matchId);
  assert(r.ok, `应能读到本场产物 ${matchId}`);
  return r.match;
}

/** 锁定的 Emitter 是比赛状态的一部分，整场不得改变 */
function emittersOf(board: any): unknown {
  return {
    A: board.emitterSelection.A.selected?.id ?? null,
    B: board.emitterSelection.B.selected?.id ?? null,
    lockedA: board.emitterSelection.A.locked,
    lockedB: board.emitterSelection.B.locked,
  };
}

// ============================================================================
// 1. 契约本身：允许集合与逐阶段准备动作必须一一对应
// ============================================================================

test('run-to-end: 阶段契约与 runToEndBlocker 允许的集合逐一对齐', () => {
  assertEqual(ALL_PHASES.length, 12, 'WirePhase 有 12 个成员 —— 新加了阶段就要在这里登记');

  const allowed: string[] = [];
  for (const phase of ALL_PHASES) {
    const prep = runToEndPreparation(phase);
    if (prep) allowed.push(phase);
    // 不允许的阶段必须**明确**返回 null（循环据此如实报错退出，而不是空转）
    if (!RUN_TO_END_ALLOWED.includes(phase)) {
      assertEqual(prep, null, `阶段 ${phase} 不在 runToEndBlocker 的允许集合里，不得给出准备动作`);
    }
  }
  assertEqual(
    allowed,
    [...RUN_TO_END_ALLOWED],
    'runToEndPreparation 允许的阶段必须与 runToEndBlocker 的允许集合完全一致'
  );

  // 逐阶段的动作必须「只补该补的」，一个都不许多做
  assertEqual(
    runToEndPreparation('READY'),
    { beginRound: true, revealRound: true },
    'READY 是新一轮起点：冻结本轮输入 + 揭盲'
  );
  assertEqual(
    runToEndPreparation('PUBLIC'),
    { beginRound: false, revealRound: true },
    'PUBLIC 已有本轮输入，只差揭盲 —— 绝不能重放 beginRound'
  );
  assertEqual(
    runToEndPreparation('REVEAL'),
    { beginRound: false, revealRound: false },
    'REVEAL 已经揭晓过：直接 START，一步都不许回头'
  );
});

// ============================================================================
// 2. READY → run-to-end → 终局
// ============================================================================

test('run-to-end: 从 READY 起跑到终局，且不换场、Emitter 锁定不变', async () => {
  const ctx = await boot();
  try {
    const before = await readyToPlay(ctx);
    assertEqual(
      actionOf(before, 'run-to-end').enabled,
      true,
      'READY 下 runToEndBlocker 必须放行（这条就是它的判据）'
    );

    const matchId = before.matchId;
    const emitters = emittersOf(before);

    const run = await postJson(`${ctx.server.url}/api/judge/run-to-end`, {});
    assert(run.body.ok, `run-to-end 应被受理: ${JSON.stringify(run.body.errors)}`);
    assertEqual(run.body.detail?.background, true, 'run-to-end 是后台任务，必须立刻返回');

    const { board } = await waitForMatchEnd(ctx);
    assert(
      TERMINAL_REASONS.includes(board.verdict?.endReason),
      `终局必须落在四类之内，实际 ${board.verdict?.endReason}`
    );
    assertEqual(board.matchId, matchId, 'run-to-end 不得换场');
    assertEqual(emittersOf(board), emitters, 'Emitter 锁定与选择整场不得改变');
    assertEqual(board.lastError, null, '不得留下后台错误');

    const match = readMatch(ctx, matchId);
    assert(match.rounds.length >= 1, `至少应结算一轮，实际 ${match.rounds.length}`);
  } finally {
    await ctx.server.close();
  }
});

// ============================================================================
// 3. PUBLIC → run-to-end → 终局
// ============================================================================

test('run-to-end: 从 PUBLIC 起跑到终局（本轮输入已冻结、尚未揭盲）', async () => {
  const ctx = await boot();
  try {
    const before = await readyToPlay(ctx);
    const matchId = before.matchId;
    const emitters = emittersOf(before);

    // 把比赛停在 PUBLIC：**只做 beginRound**，不揭盲。
    // 这是 `runToEndBlocker` 允许、但没有任何 HTTP 命令会停在的阶段 ——
    // 入口判据说它合法，循环就必须能接得住。
    ctx.server.session.peekEngine().beginRound();
    const atPublic = await judgeBoard(ctx);
    assertEqual(atPublic.phase, 'PUBLIC', 'beginRound() 之后应停在 PUBLIC');
    assertEqual(atPublic.round, 0, '第一轮尚未结算');
    assertEqual(
      actionOf(atPublic, 'run-to-end').enabled,
      true,
      'PUBLIC 下 runToEndBlocker 必须放行'
    );

    const run = await postJson(`${ctx.server.url}/api/judge/run-to-end`, {});
    assert(run.body.ok, `run-to-end 应被受理: ${JSON.stringify(run.body.errors)}`);

    const { board } = await waitForMatchEnd(ctx);
    assert(
      TERMINAL_REASONS.includes(board.verdict?.endReason),
      `终局必须落在四类之内，实际 ${board.verdict?.endReason}`
    );
    assertEqual(board.matchId, matchId, 'run-to-end 不得换场');
    assertEqual(emittersOf(board), emitters, 'Emitter 锁定与选择整场不得改变');

    const match = readMatch(ctx, matchId);
    assert(match.rounds.length >= 1, `至少应结算一轮，实际 ${match.rounds.length}`);
    assertEqual(match.rounds[0].round, 1, '第一轮必须是 round 1');
  } finally {
    await ctx.server.close();
  }
});

// ============================================================================
// 4. REVEAL → run-to-end → 终局（复评 P1 的原始现场）
// ============================================================================

test('run-to-end: 从 REVEAL 起跑到终局，本轮揭晓不被重放也不被打回 PUBLIC', async () => {
  const ctx = await boot();
  try {
    const before = await readyToPlay(ctx);
    const matchId = before.matchId;
    const emitters = emittersOf(before);

    // 裁判的正常第一步：揭晓本轮
    const revealed = await postJson(`${ctx.server.url}/api/judge/reveal`, {});
    assert(revealed.body.ok, `揭晓应成功: ${JSON.stringify(revealed.body.errors)}`);
    const revealedRound = revealed.body.detail.round;
    const revealedRoundStateHash = revealed.body.detail.roundStateHash;
    assertEqual(typeof revealedRoundStateHash, 'string', '揭晓应回报本轮绑定哈希');

    const atReveal = await judgeBoard(ctx);
    assertEqual(atReveal.phase, 'REVEAL', '揭晓后应停在 REVEAL');
    // 这两条一起构成 bug 的可达条件：按钮被判为可用，而阶段的下一步就是 START
    assertEqual(
      actionOf(atReveal, 'run-to-end').enabled,
      true,
      'REVEAL 下 runToEndBlocker 必须放行（这正是复评 P1 的可达条件）'
    );

    // ---- 采样：整场过程中不得出现「PUBLIC + round 0」这个卡死签名 ----
    const samples: { phase: string; round: number }[] = [];
    let sampling = true;
    const sampler = (async (): Promise<void> => {
      while (sampling) {
        try {
          const b = await judgeBoard(ctx);
          samples.push({ phase: b.phase, round: b.round });
          if (b.lastError) break;
        } catch {
          /* 服务正在忙，下一轮再采 */
        }
        await sleep(100);
      }
    })();

    const run = await postJson(`${ctx.server.url}/api/judge/run-to-end`, {});
    assert(run.body.ok, `run-to-end 应被受理: ${JSON.stringify(run.body.errors)}`);

    let final: any;
    try {
      final = (await waitForMatchEnd(ctx)).board;
    } finally {
      sampling = false;
      await sampler;
    }

    // 1) 不得回退到 PUBLIC/0 并卡住
    const stalled = [...samples].filter((s) => s.phase === 'PUBLIC' && s.round === 0);
    assertEqual(
      stalled,
      [],
      `揭晓之后不得再出现 PUBLIC/round 0（卡死签名），实际采样 ${JSON.stringify(
        samples.map((s) => `${s.phase}/${s.round}`)
      )}`
    );

    // 2) 到达终局、回合推进、没有换场、Emitter 锁定不变
    assert(
      TERMINAL_REASONS.includes(final.verdict?.endReason),
      `终局必须落在四类之内，实际 ${final.verdict?.endReason}`
    );
    assertEqual(final.matchId, matchId, 'run-to-end 不得换场（换场会作废双方已锁定的 Emitter）');
    assertEqual(emittersOf(final), emitters, 'Emitter 锁定与选择整场不得改变');
    assertEqual(final.lastError, null, '不得留下后台错误');

    const match = readMatch(ctx, matchId);
    assert(match.rounds.length >= 1, `至少应结算一轮，实际 ${match.rounds.length}`);

    // 3) **本轮已揭晓的那份绑定状态被原样结算**，而不是被重新生成一轮
    //    roundStateHash = H(public_state || reveal_state)，它相等即证明
    //    本轮的两个输入字节一字未变（复评要求的「现状被保留」）。
    assertEqual(
      match.rounds[0].round,
      revealedRound,
      '第一轮必须就是裁判揭晓的那一轮'
    );
    assertEqual(
      match.rounds[0].roundStateHash,
      revealedRoundStateHash,
      '结算用的必须是**裁判已经揭晓过**的那份 round state，不得重新生成'
    );
  } finally {
    await ctx.server.close();
  }
});

// ============================================================================
// 5. 同一根因的第二条 UI 路径：REVEAL 阶段重复「揭晓」
// ============================================================================

test('run-to-end: REVEAL 阶段重复揭晓是幂等的，不会把比赛打回 PUBLIC', async () => {
  const ctx = await boot();
  try {
    const before = await readyToPlay(ctx);
    const matchId = before.matchId;
    const emitters = emittersOf(before);

    const first = await postJson(`${ctx.server.url}/api/judge/reveal`, {});
    assert(first.body.ok, '第一次揭晓应成功');
    const hash = first.body.detail.roundStateHash;

    // `beginRound()` 不得把**已经揭晓**的本轮打回「等待揭盲」——
    // 这是卡死的根因；直接对着引擎钉一次，比只看界面更快定位回归。
    ctx.server.session.peekEngine().beginRound();
    const afterBegin = await judgeBoard(ctx);
    assertEqual(afterBegin.phase, 'REVEAL', 'beginRound() 不得让已揭晓的本轮回退到 PUBLIC');

    // 裁判重复点「揭晓本轮」：必须幂等（同哈希、同阶段）
    const second = await postJson(`${ctx.server.url}/api/judge/reveal`, {});
    assert(second.body.ok, `重复揭晓应幂等成功: ${JSON.stringify(second.body.errors)}`);
    assertEqual(second.body.detail.roundStateHash, hash, '重复揭晓必须回报同一份绑定哈希');

    const atReveal = await judgeBoard(ctx);
    assertEqual(atReveal.phase, 'REVEAL', '重复揭晓后仍应停在 REVEAL');
    assertEqual(
      actionOf(atReveal, 'run-to-end').enabled,
      true,
      '此时 run-to-end 仍须可用（否则又成了「按钮能点但一跑就废」）'
    );

    const run = await postJson(`${ctx.server.url}/api/judge/run-to-end`, {});
    assert(run.body.ok, `run-to-end 应被受理: ${JSON.stringify(run.body.errors)}`);
    const final = (await waitForMatchEnd(ctx)).board;

    assert(
      TERMINAL_REASONS.includes(final.verdict?.endReason),
      `终局必须落在四类之内，实际 ${final.verdict?.endReason}`
    );
    assertEqual(final.matchId, matchId, '不得换场');
    assertEqual(emittersOf(final), emitters, 'Emitter 锁定与选择整场不得改变');

    const match = readMatch(ctx, matchId);
    assertEqual(
      match.rounds[0].roundStateHash,
      hash,
      '仍需结算裁判第一次揭晓的那份 round state'
    );
  } finally {
    await ctx.server.close();
  }
});

void runAll('run-to-end-phases');
