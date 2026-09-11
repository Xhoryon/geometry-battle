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
import { PREVIEW_MAX_BYTES, readPackageFile } from '../src/server/upload';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const STARTER = path.join(REPO, 'starter');
/**
 * 两队「自己交上来」的包：测试私有 fixture，不属于平台发行树。
 *
 * 不能再用 `demo/reference-solver-v2` —— 它是平台自带的参考解，
 * 锦标赛模式现在会**在服务端拒绝**它（V1.2 §二）。
 */
const TEAM_PKG = {
  A: path.join(__dirname, 'fixtures', 'algos', 'arc-sweep'),
  B: path.join(__dirname, 'fixtures', 'algos', 'parabola-arc'),
} as const;

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
      files: packDir(TEAM_PKG.A),
    });
    assert(upA.body.ok, `Team A 上传应成功: ${JSON.stringify(upA.body.errors)}`);
    const upB = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'B',
      files: packDir(TEAM_PKG.B),
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

test('server-team: 锦标赛模式拒绝平台自带算法 —— 且每条入口都堵死（§二）', async () => {
  // 这条曾经只是「界面建议」：判据只写在 board 的 `enabled` 上，
  // 而 `prepare` / `use-slot` / `install` 三个执行入口根本不查它 ——
  // 于是一个直接的 POST 就能让一场「锦标赛」跑在出厂模板上。
  const ctx = await boot({ tournament: true });
  try {
    // ---- 入口 1：参赛者页上传出厂 starter ----
    const r = await postJson(`${ctx.server.url}/api/team/upload`, {
      team: 'A',
      files: packDir(STARTER),
    });
    assertEqual(r.body.ok, false, '锦标赛模式下出厂模板不得算就绪');
    assert(
      r.body.errors.some((e: string) => e.includes('平台自带算法')),
      `拒绝原因应点明「平台自带算法」，实际: ${JSON.stringify(r.body.errors)}`
    );

    // **先判后装**：被拒之后槽位必须一个字节都没变（此前是装完再拒绝）
    const after = await teamBoard(ctx, 'a');
    assertEqual(after.packageReady, false, '被拒的包不得让槽位变成就绪');

    // ---- 入口 2：Advanced 的按路径安装（拿发行树里的 demo 试）----
    for (const dir of [path.join(REPO, 'starter'), path.join(REPO, 'demo', 'reference-solver-v2')]) {
      const ins = await postJson(`${ctx.server.url}/api/judge/install`, { team: 'A', sourceDir: dir });
      assertEqual(ins.body.ok, false, `锦标赛模式下不得从 ${path.basename(dir)} 安装`);
      assert(
        ins.body.errors.some((e: string) => e.includes('平台自带算法')),
        `install 的拒绝原因应点明平台自带算法，实际: ${JSON.stringify(ins.body.errors)}`
      );
    }
    // 安装被拒之后槽位仍必须是空的 —— 「先判后装」的完整含义
    assertEqual((await teamBoard(ctx, 'a')).packageReady, false, '被拒的安装不得留下任何痕迹');

    // ---- 入口 3：use-slot —— 槽位里躺着自带算法时不许密封 ----
    // 绕开 install 的门禁，直接把 starter 拷进槽位（模拟出厂播种 / 手工放置）
    const slotA = path.join(ctx.root, 'slots', 'team-a');
    fs.rmSync(slotA, { recursive: true, force: true });
    fs.cpSync(STARTER, slotA, { recursive: true });
    const use = await postJson(`${ctx.server.url}/api/judge/use-slot`, { team: 'A' });
    assertEqual(use.body.ok, false, '槽位里是自带算法时，锦标赛模式不得密封进本场');
    assert(
      use.body.errors.some((e: string) => e.includes('平台自带算法')),
      `use-slot 的拒绝原因应点明平台自带算法，实际: ${JSON.stringify(use.body.errors)}`
    );

    // ---- 入口 4：prepare（裁判向导主按钮）—— 最容易绕过的那一条 ----
    const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
    assertEqual(prep.body.ok, false, 'prepare 必须同样拒绝，不得绕过 use-slot 的门禁');
    assertEqual(prep.body.detail?.step, 'use-slot-A', '拒绝时应点明停在哪一步');
    assertEqual(
      (await getJson(`${ctx.server.url}/api/judge/state`)).body.board.phase,
      'SETUP',
      '被拒之后比赛不得被推进'
    );
  } finally {
    await ctx.server.close();
  }

  // ---- 对照：真实上传的包必须放行，否则上面只是一串「一律拒绝」 ----
  const ok = await boot({ tournament: true });
  try {
    for (const team of ['A', 'B'] as const) {
      const up = await postJson(`${ok.server.url}/api/team/upload`, {
        team,
        files: packDir(TEAM_PKG[team]),
      });
      assert(up.body.ok, `真实的算法包应被接受（${team}）: ${JSON.stringify(up.body.errors)}`);
    }
    const prep = await postJson(`${ok.server.url}/api/judge/prepare`, {});
    assert(prep.body.ok, `真实包应能筹备成功: ${JSON.stringify(prep.body.errors)}`);
  } finally {
    await ok.server.close();
  }
});

test('server-team: 关掉锦标赛模式（开发自测）时，自带算法可以正常跑', async () => {
  // `--no-tournament` 是唯一的例外通道：开发自测需要它，
  // 正式赛事不得使用 —— 否则一场正规比赛会跑在模板算法上。
  const ctx = await boot({ tournament: false });
  try {
    for (const team of ['A', 'B'] as const) {
      const up = await postJson(`${ctx.server.url}/api/team/upload`, {
        team,
        files: packDir(STARTER),
      });
      assert(up.body.ok, `开发模式下出厂 starter 应被接受（${team}）: ${JSON.stringify(up.body.errors)}`);
    }
    const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
    assert(prep.body.ok, `开发模式下应能筹备成功: ${JSON.stringify(prep.body.errors)}`);
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
          files: packDir(TEAM_PKG[team]),
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

test('server-team: 双方锁定后（READY）裁判仍能逐步推进，且能看到选择过程', async () => {
  // 回归（V1.2）：`beginRound()` 接受 READY，但 `buildActions` 的 reveal / start-round
  // 一度只认 PUBLIC / REVEAL —— 于是 READY 下唯一可点的裁判动作只剩 run-to-end，
  // 「揭晓 → START → 结算」这条逐步流程在 UI 上整条走不通。
  // 这类「UI 的判据与引擎的判据不一致」正是 V1.1 翻车的根因，必须钉死。
  const ctx = await boot();
  try {
    for (const team of ['A', 'B'] as const) {
      const up = await postJson(`${ctx.server.url}/api/team/upload`, { team, files: packDir(TEAM_PKG[team]) });
      assert(up.body.ok, `${team} 上传应成功`);
    }
    const prep = await postJson(`${ctx.server.url}/api/judge/prepare`, {});
    assert(prep.body.ok, `筹备应成功: ${JSON.stringify(prep.body.errors)}`);

    // 裁判板必须能看到双方的选择过程（权威视角）
    let j = await getJson(`${ctx.server.url}/api/judge/state`);
    assert(j.body.board.emitterSelection, '裁判板必须下发 emitterSelection');
    assertEqual(j.body.board.emitterSelection.A.selected, null, '尚未选择时应为 null');

    for (const team of ['A', 'B'] as const) {
      const b = await teamBoard(ctx, team.toLowerCase() as 'a' | 'b');
      await postJson(`${ctx.server.url}/api/team/select-emitter`, { team, pointId: b.candidates[1].id });
      await postJson(`${ctx.server.url}/api/team/lock-emitter`, { team });
    }

    j = await getJson(`${ctx.server.url}/api/judge/state`);
    assertEqual(j.body.board.phase, 'READY', '双方锁定后应为 READY');
    assertEqual(j.body.board.emitterSelection.revealed, true, '裁判板应显示已公开');
    assert(j.body.board.emitterSelection.A.selected.id, '裁判板应能看到 A 选了哪个点');
    assert(j.body.board.emitterSelection.B.selected.id, '裁判板应能看到 B 选了哪个点');

    const byKey = new Map(
      (j.body.board.actions as { key: string; enabled: boolean }[]).map((a) => [a.key, a])
    );
    assert(byKey.get('reveal')?.enabled, 'READY 下「揭晓本轮」必须可点（逐步流程走得通）');
    assert(byKey.get('start-round')?.enabled, 'READY 下「START」必须可点');

    // 真的一步步走一遍：READY → 揭晓 → START → 结算
    const rev = await postJson(`${ctx.server.url}/api/judge/reveal`, {});
    assert(rev.body.ok, `揭晓应成功: ${JSON.stringify(rev.body.errors)}`);
    const start = await postJson(`${ctx.server.url}/api/judge/start-round`, {});
    assert(start.body.ok, `START 应成功: ${JSON.stringify(start.body.errors)}`);
    const comp = await postJson(`${ctx.server.url}/api/judge/compute`, {});
    assert(comp.body.ok, `结算应成功: ${JSON.stringify(comp.body.errors)}`);
    const after = await getJson(`${ctx.server.url}/api/judge/state`);
    assertEqual(after.body.board.round, 1, '应完成第 1 轮');
  } finally {
    await ctx.server.close();
  }
});

test('server-team: 主办方能在网页上查看上传的算法源码（V1.2 §一）', async () => {
  // 「投的是不是选手那份」—— 哈希对不了人眼，源码可以。
  // 裁判端必须是**权威视角**：两个队都能看；参赛者端则只看得到自己那一份。
  const ctx = await boot();
  try {
    for (const team of ['A', 'B'] as const) {
      const up = await postJson(`${ctx.server.url}/api/team/upload`, { team, files: packDir(TEAM_PKG[team]) });
      assert(up.body.ok, `${team} 上传应成功`);
    }

    // 裁判板必须带**双方**的文件清单，否则无从点开
    const j = await getJson(`${ctx.server.url}/api/judge/state`);
    for (const team of ['A', 'B'] as const) {
      const list = j.body.board.slots[team].fileList as { path: string; bytes: number }[];
      assert(Array.isArray(list) && list.length > 0, `裁判板必须下发 Team ${team} 的文件清单`);
      assert(
        list.some((f) => f.path === 'solver.py'),
        `Team ${team} 的文件清单里必须有 solver.py，实际 ${list.map((f) => f.path).join(',')}`
      );
    }

    // 裁判能读**任一队**的源码，且读到的是选手交上来的真代码
    for (const team of ['a', 'b'] as const) {
      const r = await getJson(`${ctx.server.url}/api/judge/source?team=${team}&path=solver.py`);
      assertEqual(r.status, 200, `裁判应能读取 Team ${team} 的源码`);
      assert(r.body.ok, `读取 Team ${team} 源码应 ok`);
      const onDisk = fs.readFileSync(path.join(TEAM_PKG[team.toUpperCase() as 'A' | 'B'], 'solver.py'), 'utf-8');
      assertEqual(r.body.text, onDisk, `裁判读到的必须是磁盘上那份源码的逐字节原文`);
    }

    // 路径穿越与不存在一律被拒 —— 且**不得透露服务端路径**。
    // 这条曾经红过：Node 的 ENOENT 消息里带着槽位的绝对路径，被原样回给了浏览器。
    // 两端读的是同一份实现，因此两个端点都要守。
    for (const base of ['/api/judge/source', '/api/team/source']) {
      for (const bad of ['../solver.py', '../../etc/passwd', 'nope/missing.py', '']) {
        const r = await getJson(
          `${ctx.server.url}${base}?team=a&path=${encodeURIComponent(bad)}`
        );
        assert(r.status >= 400, `${base} 非法路径 ${JSON.stringify(bad)} 必须被拒，实际 ${r.status}`);
        assert(
          !/\/Users\/|\/var\/folders\/|\/private\//.test(JSON.stringify(r.body)),
          `${base} 拒绝理由不得泄漏服务端路径，实际 ${JSON.stringify(r.body)}`
        );
      }
    }

    // 队伍必须提供合法队别
    const noTeam = await getJson(`${ctx.server.url}/api/judge/source?path=solver.py`);
    assertEqual(noTeam.status, 400, '缺少 team 必须回 400');

    // 参赛者端仍然只看得到自己那份（对方队别读不到对方源码这件事由
    // 「参赛者板里根本没有对手字段」结构性保证，见本套件第 1 个用例）
    const ownA = await getJson(`${ctx.server.url}/api/team/source?team=a&path=solver.py`);
    assertEqual(ownA.status, 200, '参赛者读自己的源码仍应可用');
  } finally {
    await ctx.server.close();
  }
});

test('server-team: 源码预览的边界 —— 嵌套 / 绝对路径 / 二进制 / 超长（§39–§41）', () => {
  // 规格 §39–§41：预览必须用包内相对标识、拒绝越界路径、
  // 二进制不解码、超长受控截断。这里直接测读取内核 —— 它是 HTTP 两端点共用的实现。
  const dir = tmpDir('preview');
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'utils', 'helper.py'), '# nested\n');
  fs.writeFileSync(path.join(dir, 'plain.py'), 'x = 1\n');
  // 头部含 NUL —— 按二进制处理
  fs.writeFileSync(path.join(dir, 'blob.py'), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0xff, 0xfe]));
  fs.writeFileSync(path.join(dir, 'big.py'), 'a'.repeat(PREVIEW_MAX_BYTES + 128));

  // 普通文件与**嵌套**文件都能读到
  assertEqual(readPackageFile(dir, 'plain.py').text, 'x = 1\n', '普通文件应可读');
  assertEqual(readPackageFile(dir, 'utils/helper.py').text, '# nested\n', '嵌套文件应可读');

  // 越界与未知一律抛错（消息里只回显调用方自己传的 relPath）
  for (const bad of ['/etc/passwd', '../escape.py', 'nope.py', '', 'utils/../../x.py']) {
    let threw = false;
    try {
      readPackageFile(dir, bad);
    } catch {
      threw = true;
    }
    assert(threw, `非法路径 ${JSON.stringify(bad)} 必须被拒`);
  }

  // 二进制：受控降级，不尝试解码
  const bin = readPackageFile(dir, 'blob.py');
  assertEqual(bin.binary, true, '含 NUL 的文件应判为二进制');
  assertEqual(bin.text, '', '二进制不返回任何文本（绝不渲染乱码）');

  // 超长：截断并标注，而不是拒绝 —— 大文件不该让主办方完全看不到
  const big = readPackageFile(dir, 'big.py');
  assertEqual(big.binary, false, '超长文本文件不是二进制');
  assertEqual(big.truncated, true, '超过上限应标注已截断');
  assert(big.text.length <= PREVIEW_MAX_BYTES, `截断后不应超过上限，实际 ${big.text.length}`);
  assert(big.text.length > 0, '截断后仍应有内容可看');
});

void runAll('server-team');
