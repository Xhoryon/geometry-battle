/**
 * 完整赛事演练（浏览器）—— 任务书要求的「至少做一次完整 browser tournament rehearsal」。
 *
 *     启动应用 → 载入两队 → Preflight → Match → 多 Round → 终局
 *     → Replay → Reset → 第二场
 *
 * 目标：**正常比赛全过程不需要 Terminal 或开发者介入**。
 *
 * 这个文件里跑的是：
 *   - **真的**服务端进程（`src/server/main.ts`，与 `npm run app` 同一条入口）；
 *   - **真的**算法（`playtest/competitors/solver-fast` vs `solver-hybrid`）；
 *   - **真的**浏览器（Chromium）+ 真的 WS 连接。
 *
 * 每一个动作都是**点界面上的按钮**，不直接调 API —— 这样按钮的启用判据、
 * 错误呈现、状态刷新全都被覆盖到。唯一直接读的是页面上显示的文本。
 */

import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const ALGO_A = path.join(REPO, 'playtest', 'competitors', 'solver-fast');
const ALGO_B = path.join(REPO, 'playtest', 'competitors', 'solver-hybrid');

/** operator-e2e 已验证会终止的组合 */
const SEED_A = 700001;
const SEED_B = 700002;

/** 大屏上绝不允许出现的字样（开发者诊断） */
const FORBIDDEN_ON_SCREEN = [
  '/Users/',
  '/var/folders/',
  '/private/tmp',
  'sha256',
  'match.json',
  'audit.json',
  'replay.json',
  'artifactRoot',
  'sourceDir',
  'stack',
  'at Object.',
  'node_modules',
];

let server: ChildProcess | null = null;
let baseURL = '';
let root = '';

function waitForUrl(child: ChildProcess, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`服务未在 ${timeoutMs}ms 内启动。已收到的输出:\n${buf}`)), timeoutMs);
    const onData = (chunk: Buffer): void => {
      buf += String(chunk);
      const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（code ${code}）：\n${buf}`));
    });
  });
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-e2e-'));
  server = spawn(
    'npx',
    [
      'ts-node',
      path.join(REPO, 'src', 'server', 'main.ts'),
      '--port', '0',
      '--no-open',
      '--slots', path.join(root, 'algorithms'),
      '--artifacts', path.join(root, 'artifacts'),
      '--sandbox', path.join(root, 'sandboxes'),
      '--seed', String(SEED_A),
      '--points', '6',
      '--difficulty', 'easy',
    ],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  baseURL = await waitForUrl(server);
});

test.afterAll(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    if (!server.killed) server.kill('SIGKILL');
  }
});

/**
 * 分段计时：演练跑完把每一步的实际耗时打出来。
 * 这不只是诊断 —— 「整套流程走完要多久」本身就是交接要报的证据。
 */
class StepClock {
  private t0 = Date.now();
  private last = this.t0;
  readonly marks: { step: string; ms: number }[] = [];
  mark(step: string): void {
    const now = Date.now();
    this.marks.push({ step, ms: now - this.last });
    this.last = now;
  }
  total(): number {
    return Date.now() - this.t0;
  }
  report(): string {
    const lines = this.marks.map((m) => `    ${String(m.ms).padStart(7)}ms  ${m.step}`);
    return `演练分段耗时（总计 ${this.total()}ms）：\n${lines.join('\n')}`;
  }
}

/** 展开 Advanced 折叠区 */
async function openAdvanced(page: Page): Promise<void> {
  const details = page.locator('details.adv');
  // 用 DOM 上的 open 属性判断，不要用 getAttribute —— 开着的时候它返回空串，
  // 直接取反会把已经展开的区域又点回去收起来。
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator('summary').click();
}

/** 展开 Advanced 折叠区并安装一队算法 */
async function installTeam(page: Page, team: 'A' | 'B', dir: string): Promise<void> {
  await openAdvanced(page);
  const input = page.getByLabel(`Team ${team} 算法目录`);
  await input.fill(dir);
  await page.getByRole('button', { name: new RegExp(`^安装 Team ${team} 算法$`) }).click();
  // 安装会真跑一次 decoy preflight（要起沙箱），给足时间
  await expect(page.locator(`[data-action="use-slot-${team.toLowerCase()}"]`)).toBeEnabled({ timeout: 120000 });
}

/**
 * 点一个裁判动作。
 *
 * 先等它变为 enabled —— 按钮的启用判据来自服务端的 board（每 100ms 推一次），
 * 所以「等按钮亮起」本身就是「等引擎进入可以执行这一步的状态」。
 */
async function clickAction(page: Page, key: string): Promise<void> {
  const btn = page.locator(`[data-action="${key}"]`);
  await expect(btn).toBeEnabled({ timeout: 180000 });
  await btn.click();
}

test('完整赛事演练：载入 → 校验 → 开赛 → 多轮 → 终局 → 回放 → 重置 → 第二场', async ({ page, context }) => {
  test.setTimeout(15 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  const clock = new StepClock();

  // ---- 1. 启动应用，进裁判台 ----
  await page.goto(`${baseURL}/judge`);
  await expect(page.getByText('裁判台').first()).toBeVisible();
  await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP');
  clock.mark('1 打开裁判台');

  // ---- 2. 载入两队（Advanced 的目录安装；正式比赛选手会把算法投进槽位）----
  await installTeam(page, 'A', ALGO_A);
  await page.locator('details.adv > summary').click(); // 收起来，让动作区可见
  await clickAction(page, 'use-slot-a');

  await expect(page.locator('[data-testid="phase"]')).toHaveText('UPLOAD_A');
  await installTeam(page, 'B', ALGO_B);
  await page.locator('details.adv > summary').click();
  await clickAction(page, 'use-slot-b');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('UPLOAD_B');
  clock.mark('2 载入两队');

  // ---- 3. Preflight ----
  await clickAction(page, 'preflight');
  clock.mark('3 Preflight');

  // ---- 4. 开赛（Match Setup → 地图生成 → 竞技场预览）----
  await clickAction(page, 'start');
  await expect(page.locator('[data-testid="phase"]')).not.toHaveText('UPLOAD_B');
  // 竞技场：地图生成后画布上应有点位
  await expect(page.locator('.stage-wrap canvas')).toBeVisible();
  clock.mark('4 开赛 + 竞技场预览');

  // ---- 5. 手动跑两轮（覆盖 揭晓 → START → 结算 三步 + 轨迹动画）----
  for (let round = 1; round <= 2; round++) {
    await clickAction(page, 'reveal');
    await clickAction(page, 'start-round');
    await clickAction(page, 'compute');
    await expect(page.locator('.lastround')).toContainText(`R${round}`);
  }

  clock.mark('5 手动两轮');

  const matchId = (await page.locator('[data-testid="match-id"]').innerText()).replace('MATCH ', '').trim();
  expect(matchId).toMatch(/^MATCH-/);

  // ---- 6. 一键跑完余下回合，并且**立刻刷新页面** ----
  //
  // run-to-end 是后台任务：刷新页面（≈ 断开并重建 WS）绝不能打断比赛，
  // 页面也必须靠重连拿到的 board 自行恢复到现场 —— 不需要任何额外点击。
  // 这是 Final Audit 的 P0-8 回归之一。
  await clickAction(page, 'run-to-end');
  await page.reload();
  await expect(page.locator('[data-testid="phase"]')).not.toHaveText('SETUP');
  await expect(page.locator('[data-testid="verdict"]')).toBeVisible({ timeout: 10 * 60 * 1000 });
  clock.mark('6 跑完余下（含刷新恢复）→ 终局');

  const verdictText = await page.locator('[data-testid="verdict"]').innerText();
  expect(verdictText).toMatch(/TEAM [AB] 获胜|平局/);
  expect(verdictText).toMatch(/ELIMINATION|MUTUAL_ELIMINATION|STALEMATE|HARD_ROUND_LIMIT/);

  // ---- 7. 观众大屏：与裁判台并行开着，只读 ----
  const spectator = await context.newPage();
  await spectator.goto(`${baseURL}/spectator`);
  await expect(spectator.locator('[data-testid="spectator"]')).toBeVisible();
  await expect(spectator.locator('[data-testid="spectator-verdict"]')).toBeVisible();

  // 大屏不得出现任何开发者诊断
  const screenText = await spectator.locator('body').innerText();
  for (const bad of FORBIDDEN_ON_SCREEN) {
    expect(screenText, `大屏不得出现 "${bad}"`).not.toContain(bad);
  }
  // 大屏不得有任何按钮（只读）
  expect(await spectator.locator('button').count()).toBe(0);
  // 大屏确实画了竞技场
  await expect(spectator.locator('canvas')).toBeVisible();
  clock.mark('7 观众大屏校验');

  // ---- 8. 回放 ----
  await page.getByRole('link', { name: '回放' }).click();
  await expect(page).toHaveURL(new RegExp(`/replay/${matchId}`));
  await expect(page.locator('.replay__controls')).toBeVisible();
  const frameCount = await page.locator('.frame-btn').count();
  expect(frameCount).toBeGreaterThanOrEqual(1);
  await expect(page.locator('canvas')).toBeVisible();
  // 逐轮切换可用
  await page.getByRole('button', { name: '下一轮' }).click();
  clock.mark('8 回放');

  // ---- 9. 重置 → 第二场（这次只用「使用槽位算法」，不重装）----
  await page.goto(`${baseURL}/judge`);
  await clickAction(page, 'reset');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP');

  await clickAction(page, 'use-slot-a');
  await clickAction(page, 'use-slot-b');
  await clickAction(page, 'preflight');
  await clickAction(page, 'start');

  const secondMatchId = (await page.locator('[data-testid="match-id"]').innerText()).replace('MATCH ', '').trim();
  expect(secondMatchId).not.toBe(matchId);
  expect(secondMatchId).toMatch(/^MATCH-/);
  // 第二场已经进入比赛流程（不再是 SETUP）
  await expect(page.locator('[data-testid="phase"]')).not.toHaveText('SETUP');
  clock.mark('9 重置 + 第二场');

  // 分段耗时是交接要报的证据：整套流程走完要多久、卡在哪一段
  console.log('\n' + clock.report() + '\n');

  // ---- 10. 全程无页面级 JS 错误 ----
  expect(errors, `页面出现 JS 错误：\n${errors.join('\n')}`).toEqual([]);
});
