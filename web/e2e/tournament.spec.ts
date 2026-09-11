/**
 * 完整赛事演练（浏览器）—— V1.2 §八
 *
 *     启动应用 → 两队**真实上传** → 各自选 Emitter 并 Lock → 未锁定不泄漏
 *     → 裁判向导 → 多 Round → 终局 → 大屏 → 回放 → 刷新恢复 → Reset → 第二场
 *
 * 目标：**正常比赛全过程不需要 Terminal 或开发者介入**。
 *
 * 这个文件里跑的是：
 *   - **真的**服务端进程（`src/server/main.ts`，与 `npm run app` 同一条入口）；
 *   - **真的**算法（两队各自的包，由参赛者页**上传**上去）；
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
/**
 * 两队「自己交上来」的算法包。
 *
 * 取的是 `tests/fixtures/algos/` 下的**测试私有** solver，而不是仓库发行树里的
 * `demo/` 或 `playtest/competitors/` —— 那些是平台自带的算法，锦标赛模式
 * 会**在服务端拒绝**它们上场（V1.2 §二，见 `isBundledAlgorithm`）。
 * 这两个 fixture 在 `full-match-e2e` 里已被证明能打到终局。
 */
const TEAM_PKG = {
  A: path.join(REPO, 'tests', 'fixtures', 'algos', 'arc-sweep'),
  B: path.join(REPO, 'tests', 'fixtures', 'algos', 'parabola-arc'),
} as const;

/** operator-e2e 已验证会终止的组合 */
const SEED_A = 700001;

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

/** 大屏上绝不允许出现的旧规则字样 */
const FORBIDDEN_RULE_WORDS = ['SHOT CANCELLED', 'Shooter', 'shooter'];

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
      // 不传 --no-tournament：走**锦标赛模式**（出厂模板不算就绪）
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

/** 展开 Advanced 折叠区（wizard 把底层动作收在这里） */
async function openAdvanced(page: Page): Promise<void> {
  const details = page.locator('details.adv');
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator('summary').click();
}

/**
 * 参赛者上传算法包（走**文件**入口；demo 包是平铺的多个 .py）。
 *
 * 上传会真跑一次 decoy preflight（要起沙箱），给足时间。
 */
async function uploadPackage(page: Page, team: 'A' | 'B'): Promise<void> {
  await page.goto(`${baseURL}/team/${team.toLowerCase()}`);
  const dir = TEAM_PKG[team];
  const files = fs
    .readdirSync(dir)
    .map((n) => path.join(dir, n))
    .filter((p) => fs.statSync(p).isFile());
  await page.locator('[data-testid="team-upload"]').setInputFiles(files);
  await expect(page.locator('[data-testid="team-notes"]')).toContainText('已安装', { timeout: 120000 });
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('已就绪');
}

/** 在参赛者页选一个候选点并锁定 */
async function pickAndLock(page: Page, team: 'A' | 'B', index: number): Promise<string> {
  await page.goto(`${baseURL}/team/${team.toLowerCase()}`);
  const cands = page.locator('[data-testid="team-candidate"]');
  await expect(cands.first()).toBeVisible({ timeout: 60000 });
  const target = cands.nth(index);
  const id = await target.getAttribute('data-candidate');
  await expect(target).toBeEnabled({ timeout: 60000 });
  await target.click();
  await expect(page.locator('[data-testid="team-notes"]')).toContainText(`已选择 ${id}`, { timeout: 60000 });
  const lock = page.locator('[data-testid="team-lock"]');
  await expect(lock).toBeEnabled({ timeout: 60000 });
  await lock.click();
  await expect(lock).toBeDisabled({ timeout: 60000 });
  return id as string;
}

/**
 * 点一个裁判动作。
 *
 * 两件事必须处理，否则点击会**永远挂住**（元素不可见时 Playwright 会一直等）：
 *
 *   1. **向导每一步只把「一个」动作放在主按钮上**，其余全收进
 *      `Advanced Controls` 那个 `<details>` 里。`run-to-end`、部分步骤的
 *      `prepare` 都属于后者 —— 直接点会等可见性等到超时。
 *      所以先展开折叠区（它是给裁判用的正常入口，不是测试后门）。
 *   2. 同一个 key 在页面上**只能出现一次**：主按钮已经占了那个 key，
 *      Advanced 里就不会再列一遍。出现两次说明向导的去重坏了。
 */
async function clickAction(page: Page, key: string): Promise<void> {
  const btn = page.locator(`[data-action="${key}"]`);
  await expect(btn, `动作 ${key} 在页面上应当恰好出现一次`).toHaveCount(1);

  // 非主按钮收在 Advanced 折叠区里 —— 不展开的话 click() 会一直等可见性
  if (!(await btn.isVisible())) await openAdvanced(page);

  await expect(btn).toBeEnabled({ timeout: 180000 });
  await btn.click();
}

test('完整赛事演练：两队真实上传 → 独立选锚点 → 裁判向导 → 终局 → 回放 → 第二场', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  const clock = new StepClock();

  // ---- 1. 裁判台起步：SETUP ----
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP');
  await expect(page.locator('[data-testid="wizard"]')).toBeVisible();
  clock.mark('打开裁判台（SETUP）');

  // ---- 2. 两队**真实上传**（各自独立的浏览器上下文，互不可见）----
  const pageA = await page.context().newPage();
  const pageB = await page.context().newPage();

  // §77：隐藏选择是**传输层**性质，不只是视觉性质。
  // 因此把 B 端收到的每一条 WebSocket 文本帧都记下来，稍后逐字检查
  // —— 只断言 DOM/innerText 是不够的，DOM 里没有不代表载荷里没有。
  const bFrames: string[] = [];
  pageB.on('websocket', (ws) => {
    ws.on('framereceived', (f) => bFrames.push(String(f.payload)));
  });

  await uploadPackage(pageA, 'A');
  clock.mark('Team A 上传算法包（含沙箱 preflight）');
  await uploadPackage(pageB, 'B');
  clock.mark('Team B 上传算法包（含沙箱 preflight）');

  // ---- 3. 裁判向导：ALGORITHM READY ----
  await expect(page.locator('[data-action="prepare"]')).toBeEnabled({ timeout: 60000 });
  await clickAction(page, 'prepare');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('EMITTER_SELECT', { timeout: 120000 });
  clock.mark('裁判「开始比赛筹备」（封装 → Preflight → 建赛）');

  // ---- 4. A 先选并锁定；**B 看不到 A 选了什么** ----
  const idA = await pickAndLock(pageA, 'A', 1);
  await pageB.goto(`${baseURL}/team/b`);
  await expect(pageB.locator('[data-testid="team-phase"]')).toContainText('选择发射锚点');
  // 未公开时 B 端根本收不到坐标 —— 断言服务端没发，而不是断言前端藏起来
  await expect(pageB.locator('[data-testid="team-emitters-hidden"]')).toBeVisible();
  await expect(pageB.locator('[data-testid="team-emitters"]')).toHaveCount(0);
  const bText = await pageB.locator('body').innerText();
  expect(bText, 'B 端不得出现 A 的选择').not.toContain(idA);

  // §77：载荷里也不许有 —— 服务端根本不发，而不是前端藏起来
  expect(bFrames.length, 'B 端应当收到过 board 推送').toBeGreaterThan(0);
  const leaked = bFrames.filter((f) => f.includes(idA));
  expect(leaked, `B 端收到的 WebSocket 载荷里不得出现 A 的选择（${idA}）`).toEqual([]);
  clock.mark(`Team A 选定并锁定 Emitter（${idA}），DOM 与 WS 载荷均未泄漏给 B`);

  // §72 / §112：锁定是**服务端owns**的状态，刷新参赛者页必须原样恢复
  await pageA.reload();
  await expect(pageA.locator('[data-testid="team-candidates"]')).toBeVisible({ timeout: 60000 });
  await expect(pageA.locator('[data-testid="team-emitter"] .tag')).toHaveText('已锁定');
  await expect(pageA.locator('[data-testid="team-lock"]')).toBeDisabled();
  const aReloaded = await pageA.locator('body').innerText();
  expect(aReloaded, '刷新后 A 仍应看到自己选的那个点').toContain(idA);
  clock.mark('参赛者页刷新后，Emitter 选择与锁定状态原样恢复');

  // ---- 5. B 也选并锁定 → 双方公开 ----
  const idB = await pickAndLock(pageB, 'B', 1);
  await expect(pageA.locator('[data-testid="team-emitters"]')).toContainText(idA, { timeout: 60000 });
  await expect(pageA.locator('[data-testid="team-emitters"]')).toContainText(idB);
  clock.mark(`Team B 选定并锁定 Emitter（${idB}），双方锚点公开`);

  // ---- 6. 裁判向导：READY → 逐步走一轮 ----
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 60000 });
  await clickAction(page, 'reveal');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('REVEAL', { timeout: 60000 });
  await clickAction(page, 'start-round');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('COUNTDOWN', { timeout: 60000 });
  await clickAction(page, 'compute');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 120000 });
  clock.mark('裁判逐步走完第 1 轮（揭晓 → START → 结算）');

  // ---- 7. 跑到终局 ----
  await clickAction(page, 'run-to-end');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('MATCH_END', { timeout: 600000 });
  const matchId = (await page.locator('[data-testid="match-id"]').innerText()).replace(/^MATCH\s*/, '');
  await expect(page.locator('[data-testid="verdict"]')).toBeVisible({ timeout: 60000 });
  clock.mark(`跑到终局（${matchId}）`);

  // ---- 8. 刷新恢复（WS 重连自恢复，不需要任何点击）----
  await page.reload();
  await expect(page.locator('[data-testid="phase"]')).toHaveText('MATCH_END', { timeout: 120000 });
  clock.mark('刷新后自动恢复到终局');

  // ---- 9. 观众大屏：不泄漏诊断，也没有任何按钮 ----
  await page.goto(`${baseURL}/spectator`);
  await expect(page.locator('[data-testid="spectator"]')).toBeVisible();
  const screenText = await page.locator('body').innerText();
  for (const bad of FORBIDDEN_ON_SCREEN) {
    expect(screenText, `大屏不得出现 ${bad}`).not.toContain(bad);
  }
  for (const bad of FORBIDDEN_RULE_WORDS) {
    expect(screenText, `大屏不得出现旧规则字样 ${bad}`).not.toContain(bad);
  }
  expect(await page.locator('button').count(), '大屏不得有按钮').toBe(0);
  // 双方锁定后，大屏必须能看到锚点
  expect(screenText).toContain(idA);
  clock.mark('观众大屏（无诊断 / 无按钮 / 锚点已公开）');

  // ---- 10. 回放 ----
  await page.goto(`${baseURL}/replay/${encodeURIComponent(matchId)}`);
  const frames = page.locator('.frame-btn');
  await expect(frames.first()).toBeVisible({ timeout: 60000 });
  expect(await frames.count()).toBeGreaterThan(0);
  clock.mark('打开回放');

  // ---- 11. Reset → 第二场（不重新上传，直接再走一遍）----
  await page.goto(`${baseURL}/judge`);
  await clickAction(page, 'reset');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP', { timeout: 60000 });
  // 槽位里的包还在（出厂 starter 不算就绪，但**上传过的包**算）→ 直接筹备
  await expect(page.locator('[data-action="prepare"]')).toBeEnabled({ timeout: 60000 });
  await clickAction(page, 'prepare');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('EMITTER_SELECT', { timeout: 120000 });

  await pickAndLock(pageA, 'A', 0);
  await pickAndLock(pageB, 'B', 0);
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 60000 });
  await clickAction(page, 'run-to-end');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('MATCH_END', { timeout: 600000 });
  const secondId = (await page.locator('[data-testid="match-id"]').innerText()).replace(/^MATCH\s*/, '');
  expect(secondId, '第二场必须是新的 matchId').not.toBe(matchId);
  clock.mark('Reset → 第二场跑到终局');

  // ---- 12. 全程零页面错误 ----
  expect(errors, '全程不得有 pageerror / console.error').toEqual([]);

  console.log(clock.report());
});

test('参赛者端：坏包被拒，且不碰槽位里已装好的包', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(`${baseURL}/team/a`);

  // 前置：上面那场演练已经给 A 装好了一个包。
  // 因此这里能证明的是**更强**的性质 —— 安装流水线是非破坏性的，
  // 被拒的上传一个字节都不会动到槽位里现有的东西。
  // （「空槽位 + 坏包 → 未就绪」那条由 `server-team` 在全新服务上覆盖。）
  const nameBefore = await page.locator('[data-testid="team-package"] .slot__name').innerText();
  expect(nameBefore, '前置：A 的槽位里应已装好一个包').not.toContain('未命名');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-badpkg-'));
  const bad = path.join(tmp, 'helper.py');
  fs.writeFileSync(bad, 'x = 1\n');
  await page.locator('[data-testid="team-upload"]').setInputFiles([bad]);

  // 失败必须**当场看得见**，而不是静默无事发生
  await expect(page.locator('[data-testid="team-errors"]')).toBeVisible({ timeout: 60000 });

  // 而槽位保持原样：包名照旧、仍然就绪
  await expect(page.locator('[data-testid="team-package"] .slot__name')).toHaveText(nameBefore);
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('已就绪');
});
