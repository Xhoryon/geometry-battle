/**
 * server-team —— 参赛者端与锦标赛模式的端到端回归（V1.2 §一/§二/§八）
 *
 * 这一套件**真的起一个 HTTP 服务**，走浏览器会走的那些端点，断言：
 *
 *   1. 双方**真实上传**算法包（走 staging → validate → preflight → seal → replace）；
 *   2. 双方**独立**选择 Emitter 并 Lock；
 *   3. **未锁定之前对方的选择不泄漏**（不是前端隐藏 —— 服务端根本不发）；
 *   4. **锦标赛模式不允许出厂 starter**（真实上传的包才算就绪）；
 *   5. 上传路径穿越被拒；两份包的槽位与源码互相不可见；
 *   6. 连续两场真实比赛。
 */

import * as fs from 'fs';
import * as path from 'path';
import { startServer, RunningServer } from '../src/server/main';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const DEMO = path.join(REPO, 'demo', 'reference-solver-v2');
const STARTER = path.join(REPO, 'starter');

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

interface Ctx {
  server: RunningServer;
  root: string;
}

async function boot(opts: { tournament?: boolean } = {}): Promise<Ctx> {
  const root = tmpDir('server-team');
  const server = await startServer({
    port: 0,
    slotRoot: path.join(root, 'slots'),
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    tournamentMode: opts.tournament ?? true,
  });
  return { server, root };
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const r = await fetch(url);
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** 轮询裁判板直到 phase 达到期望值（后台任务模型：run-to-end 立即返回） */
async function waitForPhase(ctx: Ctx, phase: string, timeoutMs = 120_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await getJson(`${ctx.server.url}/api/judge/state`);
    const board = r.body?.board;
    if (board?.phase === phase) return board;
    if (Date.now() > deadline) {
      throw new Error(`等待阶段 ${phase} 超时，当前 ${board?.phase}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function teamBoard(ctx: Ctx, team: 'a' | 'b'): Promise<any> {
  const r = await getJson(`${ctx.server.url}/api/team/state?team=${team}`);
  assertEqual(r.status, 200, `读取 Team ${team} 状态应成功`);
  assert(r.body.ok, `Team ${team} 状态应 ok：${JSON.stringify(r.body.errors ?? [])}`);
  return r.body.board;
}

// ===========================================================================

test('server-team: 参赛者端只暴露本队信息，且开赛前锁定 Emitter', async () => {
  const ctx = await boot();
  try {
    const a0 = await teamBoard(ctx, 'a');
    assertEqual(a0.team, 'A', 'A 端看到的应该是 A 队');
    assertEqual(a0.tournamentMode, true, '默认应为锦标赛模式');
    assertEqual(a0.phase, 'SETUP', '初始阶段应为 SETUP');
    // 白名单：参赛者板里根本没有对手的槽位/源码字段
    assert(!('packages' in a0), '参赛者板不得含双方包清单');
    assert(!('slots' in a0), '参赛者板不得含双方槽位（只有自己的 slot）');
    assert(!('audit' in a0), '参赛者板不得含审计日志');
    assert(!('artifactDir' in a0), '参赛者板不得含产物目录');
    assertEqual(a0.opponent.selected, null, '对方未选择前不得暴露任何选择');

    // 上传前：候选点为空（比赛还没开始，没有地图）
    assertEqual(a0.candidates.length, 0, '未开赛时没有候选点');

    // 双方真实上传
    const upA = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: packDir(DEMO),
    });
    assert(upA.body.ok, `Team A 上传应成功: ${JSON.stringify(upA.body.errors)}`);
    const upB = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'B',
      files: packDir(DEMO),
    });
    assert(upB.body.ok, `Team B 上传应成功: ${JSON.stringify(upB.body.errors)}`);

    const a1 = await teamBoard(ctx, 'a');
    assertEqual(a1.packageReady, true, '上传后本队算法应就绪');
    assert(a1.files.length > 0, '应能看到自己包内的文件清单');
    assert(a1.files.some((f: { path: string }) => f.path === 'solver.py'), '清单里应有入口文件');

    // 只读浏览源码（只限本队包内）
    const src = await getJson(`${ctx.server.url}/api/team/source?team=a&path=solver.py`);
    assertEqual(src.status, 200, '应能读取本队源码');
    assert(typeof src.body.text === 'string' && src.body.text.length > 0, '源码内容不应为空');
    const traversal = await getJson(`${ctx.server.url}/api/team/source?team=a&path=${encodeURIComponent('../../etc/passwd')}`);
    assert(traversal.status !== 200, '路径穿越必须被拒');

    // 裁判走向导主步：封装 → Preflight → 建赛
    const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
    assert(prep.body.ok, `筹备应成功: ${JSON.stringify(prep.body.errors)}`);
    const j = await getJson(`${ctx.server.url}/api/judge/state`);
    assertEqual(j.body.board.phase, 'EMITTER_SELECT', '筹备后应进入 Emitter 选择阶段');

    const a2 = await teamBoard(ctx, 'a');
    assert(a2.candidates.length > 0, '开赛后本队应有可选的点');
    assertEqual(a2.own.selected, null, '尚未选择');

    // A 选择并锁定
    const candA = a2.candidates[0].id;
    const sel = await postJson(`${ctx.server.url}/api/team/select-emitter`, { team: 'A', pointId: candA });
    assert(sel.body.ok, `A 选择应成功: ${JSON.stringify(sel.body.errors)}`);
    const lock = await postJson(`${ctx.server.url}/api/team/lock-emitter`, { team: 'A' });
    assert(lock.body.ok, `A 锁定应成功: ${JSON.stringify(lock.body.errors)}`);

    // A 自己看得到；**B 看不到 A 选了什么**（只有 locked 布尔）
    const a3 = await teamBoard(ctx, 'a');
    assertEqual(a3.own.selected, candA, 'A 应看到自己的选择');
    assertEqual(a3.own.locked, true, 'A 应已锁定');
    const b3 = await teamBoard(ctx, 'b');
    assertEqual(b3.opponent.locked, true, 'B 应知道对方已锁定');
    assertEqual(b3.opponent.selected, null, '**双方锁定前，B 不得看到 A 选了什么**');
    assertEqual(b3.revealed, false, '整体尚未公开');
    assertEqual(b3.emitters, null, '未公开时不得下发任何锚点坐标');

    // B 选择并锁定 → 双方公开
    const candB = b3.candidates[0].id;
    await postJson(`${ctx.server.url}/api/team/select-emitter`, { team: 'B', pointId: candB });
    const lockB = await postJson(`${ctx.server.url}/api/team/lock-emitter`, { team: 'B' });
    assert(lockB.body.ok, `B 锁定应成功: ${JSON.stringify(lockB.body.errors)}`);

    const a4 = await teamBoard(ctx, 'a');
    const b4 = await teamBoard(ctx, 'b');
    assertEqual(a4.revealed, true, '双方锁定后应公开');
    assertEqual(a4.emitters.A.id, candA, 'A 的锚点应是 A 选的');
    assertEqual(a4.emitters.B.id, candB, 'A 端应能看到 B 的锚点');
    assertEqual(b4.opponent.selected, candA, 'B 端应能看到 A 的锚点');
    assertEqual(b4.emitters.A.id, candA, '两侧看到的锚点必须一致');
    assertEqual(a4.phase, 'READY', '双方锁定后应进入 READY');
  } finally {
    await ctx.server.close();
  }
});

test('server-team: 锦标赛模式不接受出厂 starter 模板（§二）', async () => {
  const ctx = await boot({ tournament: true });
  try {
    // 把官方 starter 原样上传 —— 它是**出厂模板**，锦标赛模式必须拒绝
    const r = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: packDir(STARTER),
    });
    assertEqual(r.body.ok, false, '锦标赛模式下出厂模板不得算就绪');
    assert(
      r.body.errors.some((e: string) => e.includes('模板')),
      `拒绝原因应说明是模板算法，实际: ${JSON.stringify(r.body.errors)}`
    );

    // 对照：真实的算法包必须接受，否则上面的断言只是「一律拒绝」
    const good = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: packDir(DEMO),
    });
    assert(good.body.ok, `真实算法包应被接受: ${JSON.stringify(good.body.errors)}`);
  } finally {
    await ctx.server.close();
  }
});

test('server-team: 上传的包仍要过完整流水线 —— 坏包被拒且不留痕', async () => {
  const ctx = await boot();
  try {
    // 没有 solver.py 的包
    const noEntry = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: [{ path: 'helper.py', contentBase64: Buffer.from('x = 1\n').toString('base64') }],
    });
    assertEqual(noEntry.body.ok, false, '缺少 solver.py 的包必须被拒');

    // 路径穿越
    const evil = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: [
        { path: 'solver.py', contentBase64: Buffer.from('x = 1\n').toString('base64') },
        { path: '../escape.py', contentBase64: Buffer.from('y = 2\n').toString('base64') },
      ],
    });
    assertEqual(evil.body.ok, false, '含路径穿越的上传必须被拒');

    // 形状不对
    const shape = await postJson(`${ctx.server.url}/api/team/upload`, { team: 'A', files: 'nope' });
    assertEqual(shape.body.ok, false, 'files 形状不对必须被拒');

    const board = await teamBoard(ctx, 'a');
    assertEqual(board.packageReady, false, '被拒的上传不得让本队变成就绪');
  } finally {
    await ctx.server.close();
  }
});

test('server-team: 连续两场真实比赛（§八）', async () => {
  const ctx = await boot();
  try {
    const playOne = async (): Promise<string> => {
      for (const team of ['A', 'B'] as const) {
        const up = await postJson(`${ctx.server.url}/api/team/upload`, {
          team,
          files: packDir(DEMO),
        });
        assert(up.body.ok, `${team} 上传应成功: ${JSON.stringify(up.body.errors)}`);
      }
      const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
      assert(prep.body.ok, `筹备应成功: ${JSON.stringify(prep.body.errors)}`);

      for (const team of ['A', 'B'] as const) {
        const b = await teamBoard(ctx, team.toLowerCase() as 'a' | 'b');
        const sel = await postJson(`${ctx.server.url}/api/team/select-emitter`, {
          team,
          pointId: b.candidates[0].id,
        });
        assert(sel.body.ok, `${team} 选择应成功`);
        const lock = await postJson(`${ctx.server.url}/api/team/lock-emitter`, { team });
        assert(lock.body.ok, `${team} 锁定应成功`);
      }

      const run = await postJson(`${ctx.server.url}/api/judge/run-to-end`, {});
      assert(run.body.ok, `跑完整场应成功: ${JSON.stringify(run.body.errors)}`);
      // run-to-end 是**后台任务**：立刻返回，随后自行推进到终局
      const board = await waitForPhase(ctx, 'MATCH_END');
      assert(
        ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(
          board.verdict?.endReason
        ),
        `终局必须落在四类之内，实际 ${board.verdict?.endReason}`
      );
      return board.matchId as string;
    };

    const first = await playOne();
    const reset = await postJson(`${ctx.server.url}/api/judge/reset`, {});
    assert(reset.body.ok, '重置应成功');
    const second = await playOne();
    assert(first !== second, '两场必须是不同的 matchId');

    // 两场都留下了可回放的产物
    const list = await getJson(`${ctx.server.url}/api/replays`);
    assertEqual(list.body.ok, true, '回放列表应可读');
    assert(list.body.replays.length >= 2, `应至少有两场可回放，实际 ${list.body.replays.length}`);
  } finally {
    await ctx.server.close();
  }
});

void runAll('server-team');
