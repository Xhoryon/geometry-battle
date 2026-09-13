/**
 * i18n —— 双语界面与语言选择的真实浏览器演练（V1.3）
 *
 * 覆盖规格要求的那几条：
 *
 *   · zh-CN 渲染正确、en-US 渲染正确
 *   · 语言开关可用
 *   · 选择跨**刷新**保持
 *   · 选择跨**路由**保持
 *   · 浏览器语言兜底（zh-* → 中文，其余 → 英文）
 *   · **机器标识不随语言改变**（阶段枚举、动作 key、matchId 格式）
 *   · 一条完整的**英文**赛事流程（上传 → 校验 → 选锚点 → 锁定 → 裁判 →
 *     比赛 → 大屏 → 回放）
 *
 * 这里刻意用 `data-testid` / `data-action` 这类**语义选择器**，而不是中文文案 ——
 * 文案本身正是被测对象，拿它当选择器会让测试与实现互相印证。
 * 只有在断言「这一屏确实是英文」时才读文本。
 *
 * 既有中文流程由 `tournament.spec.ts` / `zip-upload.spec.ts` 覆盖（它们显式钉了
 * zh-CN）。本文件不碰那两条，避免重复。
 */

import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const PKG_SRC = path.join(REPO, 'tests', 'fixtures', 'algos', 'arc-sweep');

let server: ChildProcess | null = null;
let baseURL = '';
/** 裁判台入口，含本场令牌的 fragment（`/judge#t=…`），从启动 banner 里抓 */
let judgeURL = '';
let judgeToken = '';
let root = '';

function waitForBoot(child: ChildProcess, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error(`服务未在 ${timeoutMs}ms 内启动。已收到:\n${buf}`)),
      timeoutMs
    );
    const onData = (chunk: Buffer): void => {
      buf += String(chunk);
      const base = /(http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      const judge = /(http:\/\/127\.0\.0\.1:\d+\/judge#t=[A-Za-z0-9_-]+)/.exec(buf);
      if (base && judge) {
        clearTimeout(timer);
        baseURL = base[1];
        judgeURL = judge[1];
        judgeToken = judgeURL.split('#t=')[1];
        resolve();
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

/** 某一队**本场**的参赛页链接（队令牌按场次派生，必须现取） */
async function teamURL(team: 'A' | 'B'): Promise<string> {
  const port = new URL(baseURL).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/judge/state`, {
    headers: { 'X-GB-Token': judgeToken },
  });
  const json = (await res.json()) as { board: { teamTokens: Record<string, string> } };
  return `${baseURL}/team/${team.toLowerCase()}#t=${json.board.teamTokens[team]}`;
}

/** 展开裁判台的 Advanced 折叠区（非主按钮收在里面） */
async function openAdvanced(page: Page): Promise<void> {
  const details = page.locator('details.adv');
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator('summary').click();
}

/** 点一个裁判动作（语义选择器：`data-action` 是机器标识，与语言无关） */
async function clickAction(page: Page, key: string): Promise<void> {
  const btn = page.locator(`[data-action="${key}"]`);
  await expect(btn).toHaveCount(1);
  if (!(await btn.isVisible())) await openAdvanced(page);
  await expect(btn).toBeEnabled({ timeout: 180000 });
  await btn.click();
}

async function uploadPackage(page: Page, team: 'A' | 'B'): Promise<void> {
  await page.goto(await teamURL(team));
  const files = fs
    .readdirSync(PKG_SRC)
    .map((n) => path.join(PKG_SRC, n))
    .filter((p) => fs.statSync(p).isFile());
  await page.locator('[data-testid="team-upload"]').setInputFiles(files);
  await expect(page.locator('[data-testid="team-notes"]')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('Ready');
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-i18n-'));
  server = spawn(
    'npx',
    [
      'ts-node', path.join(REPO, 'src', 'server', 'main.ts'),
      '--port', '0', '--no-open',
      '--slots', path.join(root, 'slots'),
      '--artifacts', path.join(root, 'artifacts'),
      '--sandbox', path.join(root, 'sandboxes'),
      '--seed', '700001', '--points', '6', '--difficulty', 'easy',
    ],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  await waitForBoot(server);
});

test.afterAll(() => {
  server?.kill('SIGTERM');
});

// ============================================================================
// 中文浏览器
// ============================================================================

test.describe('浏览器语言是 zh-CN', () => {
  test.use({ locale: 'zh-CN' });

  test('默认中文界面，且机器标识不翻译', async ({ page }) => {
    await page.goto(judgeURL);
    await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP');

    // 无障碍：<html lang> 必须跟着语言走
    expect(await page.locator('html').getAttribute('lang')).toBe('zh-CN');

    // 机器标识不翻译：阶段枚举原文、动作 key、matchId 格式
    await expect(page.locator('[data-testid="match-id"]')).toHaveText(/^MATCH MATCH-/);
    await expect(page.locator('[data-action="prepare"]')).toHaveCount(1);

    // 界面文案确实是中文（只在「确认这是中文界面」时才读文本）
    const body = await page.locator('body').innerText();
    expect(body, '这一屏应当是中文').toContain('裁判向导');
    expect(body).toContain('参赛者入口');
  });

  test('手动切到 EN 后覆盖浏览器语言，并且刷新仍然保持', async ({ page }) => {
    await page.goto(judgeURL);
    await expect(page.locator('body')).toContainText('裁判向导');

    // 切英文
    await page.locator('[data-testid="lang-en"]').click();
    await expect(page.locator('body')).toContainText('Judge wizard');
    expect(await page.locator('html').getAttribute('lang')).toBe('en-US');

    // 刷新：**手动选择覆盖浏览器语言**（浏览器仍是 zh-CN）
    await page.reload();
    await expect(page.locator('body')).toContainText('Judge wizard');
    expect(await page.locator('body')).not.toContainText('裁判向导');
    expect(await page.locator('html').getAttribute('lang')).toBe('en-US');

    // 用户选择落在规格指定的那个键上
    const saved = await page.evaluate(() => window.localStorage.getItem('geometry-battle.locale'));
    expect(saved).toBe('en-US');
  });

  test('语言选择跨路由保持', async ({ page }) => {
    await page.goto(judgeURL);
    await page.locator('[data-testid="lang-en"]').click();
    await expect(page.locator('body')).toContainText('Judge wizard');

    // 换一条路由（整页加载）—— provider 会重新解析 localStorage，仍应是英文
    await page.goto(`${baseURL}/spectator`);
    await expect(page.locator('[data-testid="spectator"]')).toBeVisible();
    // 大屏上多处文案有 CSS `text-transform: uppercase`，innerText 会是大写 ——
    // 这里比的是「语言」，不是「大小写」，所以统一转小写再比。
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body, '大屏也应当是英文').toContain('team a alive');
    expect(body).not.toContain('存活');
    // 开关在每一屏都在，且当前选中项是 EN
    await expect(page.locator('[data-testid="lang-en"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ============================================================================
// 英文浏览器
// ============================================================================

test.describe('浏览器语言不是 zh-*', () => {
  test.use({ locale: 'en-US' });

  test('默认英文界面（规格：只有 zh-* 才是中文）', async ({ page }) => {
    await page.goto(judgeURL);
    await expect(page.locator('body')).toContainText('Judge wizard');
    expect(await page.locator('html').getAttribute('lang')).toBe('en-US');
    // 机器标识照旧
    await expect(page.locator('[data-testid="phase"]')).toHaveText('SETUP');
  });

  test('完整赛事流程（全英文，无终端介入）', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    // ---- 首页：选择身份（英文），粘贴裁判链接进裁判台；令牌只进 fragment（V1.4）----
    await page.goto(`${baseURL}/`);
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.locator('[data-testid="home"]')).toBeVisible();
    await expect(page.locator('.home__title')).toHaveText('Choose your role');
    await page.locator('[data-testid="access-input-judge"]').fill(judgeURL);
    await page.locator('[data-testid="access-go-judge"]').click();
    await expect(page).toHaveURL(judgeURL);
    expect(page.url(), '令牌不得进查询串').not.toContain('?t=');
    await expect(page.locator('[data-testid="judge"]')).toHaveAttribute('data-board', 'ready');
    await expect(page.locator('body')).toContainText('Judge wizard');

    // ---- 双方上传（参赛者页）----
    await uploadPackage(page, 'A');
    await uploadPackage(page, 'B');

    // ---- 源码审阅：英文界面下也能看到内容 ----
    await page.goto(await teamURL('A'));
    await page.locator('[data-testid="team-file"]', { hasText: 'solver.py' }).click();
    await expect(page.locator('.source-view')).toContainText('def ', { timeout: 30000 });

    // ---- 裁判筹备（含真实沙箱 Preflight）----
    await page.goto(judgeURL);
    await expect(page.locator('[data-testid="judge-team-A"]')).toContainText('Algorithm ready');
    await expect(page.locator('[data-testid="judge-team-B"]')).toContainText('Algorithm ready');
    await clickAction(page, 'prepare');
    await expect(page.locator('[data-testid="phase"]')).toHaveText('EMITTER_SELECT', {
      timeout: 180000,
    });

    // ---- 双方各自选锚点并锁定 ----
    for (const team of ['A', 'B'] as const) {
      const p = await page.context().newPage();
      await p.goto(await teamURL(team));
      const cands = p.locator('[data-testid="team-candidate"]');
      await expect(cands.first()).toBeVisible({ timeout: 60000 });

      // 参赛者页的动作提示是**服务端给 key、客户端翻译**的（V1.3）。这两条断言
      // 盯的是「客户端真的翻了」——服务端原文是中文（「请先选择 Emitter」），
      // 直接渲染就会在英文界面上冒出一句中文，即 tests/i18n.ts 点名的混合语言事故。
      // 断言**完整英文原文**而不只是「不含中文」：后者在文案被换成任意英文时也绿。
      await expect(p.locator('[data-testid="team-lock-hint"]')).toHaveText('Pick an Emitter first');

      await cands.nth(1).click();
      await expect(p.locator('[data-testid="team-lock-hint"]')).toHaveText(
        'Fixed for the whole match once locked; both anchors go public when both sides lock'
      );
      await expect(p.locator('[data-testid="team-notes"]')).toBeVisible();
      await p.locator('[data-testid="team-lock"]').click();
      await expect(p.locator('[data-testid="team-lock"]')).toBeDisabled({ timeout: 60000 });
      await p.close();
    }

    await page.goto(judgeURL);
    await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 120000 });
    await expect(page.locator('[data-testid="judge-team-A-emitter"]')).toContainText('Anchor');
    await expect(page.locator('[data-testid="judge-team-B-emitter"]')).toContainText('Anchor');

    // ---- 跑到终局 ----
    await clickAction(page, 'reveal');
    await expect(page.locator('[data-testid="phase"]')).toHaveText('REVEAL', { timeout: 60000 });
    await clickAction(page, 'start-round');
    await expect(page.locator('[data-testid="phase"]')).toHaveText('COUNTDOWN', { timeout: 60000 });
    await clickAction(page, 'compute');
    await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 120000 });
    await clickAction(page, 'run-to-end');
    await expect(page.locator('[data-testid="phase"]')).toHaveText('MATCH_END', { timeout: 600000 });
    await expect(page.locator('[data-testid="verdict"]')).toBeVisible({ timeout: 60000 });
    const matchId = (await page.locator('[data-testid="match-id"]').innerText()).replace(
      /^MATCH\s*/,
      ''
    );
    // 终局主位置是「打开回放」；换场（危险动作）收在 Advanced 里，不是主按钮
    await expect(page.locator('[data-testid="judge-open-replay"]')).toBeVisible();
    await expect(page.locator('[data-testid="primary-action"]')).toHaveCount(0);
    // `reset` 只出现在 Advanced 折叠区里（clickAction 为了点到里面的按钮可能已把它展开，
    // 所以这里断言的是「在哪」而不是「可见否」）
    await expect(page.locator('details.adv [data-action="reset"]')).toHaveCount(1);

    // ---- 大屏：英文，且不泄漏诊断、没有命令控件 ----
    await page.goto(`${baseURL}/spectator`);
    await expect(page.locator('[data-testid="spectator"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator"]')).toHaveAttribute('data-board', 'ready');
    await expect(page.locator('[data-testid="spectator"]')).toHaveAttribute('data-terminal', 'true');
    await expect(page.locator('[data-testid="spectator-verdict"]')).toBeVisible({ timeout: 60000 });
    const screenText = await page.locator('body').innerText();
    expect(screenText.toLowerCase(), '大屏应当是英文').toContain('team a alive');
    for (const bad of ['/Users/', '/var/folders/', 'sha256', 'match.json']) {
      expect(screenText, `大屏不得出现 ${bad}`).not.toContain(bad);
    }
    expect(await page.locator('[data-action]').count(), '大屏不得出现裁判动作按钮').toBe(0);
    expect(await page.locator('button:not([data-locale])').count(), '大屏除语言开关外不得有按钮').toBe(0);

    // ---- 回放播放器（英文）：上一轮 / 播放·暂停 / 下一轮 / 计数 ----
    await page.goto(`${baseURL}/replay/${encodeURIComponent(matchId)}`);
    const player = page.locator('[data-testid="replay-player"]');
    await expect(player).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.frame-btn').first()).toBeVisible({ timeout: 60000 });
    const frameCount = await page.locator('.frame-btn').count();
    expect(frameCount).toBeGreaterThan(0);
    const replayText = await page.locator('body').innerText();
    expect(replayText, '回放页应当是英文').toContain('Rounds');
    await expect(page.locator('[data-testid="replay-counter"]')).toHaveText(`Round 1 / ${frameCount}`);
    await expect(page.locator('[data-testid="replay-prev"]')).toHaveAttribute('title', 'Previous round');
    await expect(page.locator('[data-testid="replay-next"]')).toHaveAttribute('title', 'Next round');
    await expect(page.locator('[data-testid="replay-play"]')).toHaveText('Play');
    if (frameCount > 1) {
      await page.locator('[data-testid="replay-next"]').click();
      await expect(page.locator('[data-testid="replay-counter"]')).toHaveText(`Round 2 / ${frameCount}`);
      await page.locator('[data-testid="replay-prev"]').click();
      await expect(player).toHaveAttribute('data-index', '0');
      await page.locator('[data-testid="replay-speed-2"]').click();
      await page.locator('[data-testid="replay-play"]').click();
      await expect(page.locator('[data-testid="replay-play"]')).toHaveText('Pause');
      // 播放器自己走到下一帧（等 DOM 状态，不睡眠）
      await expect(player).toHaveAttribute('data-index', '1', { timeout: 30000 });
      await page.locator('[data-testid="replay-play"]').click();
      await expect(player).toHaveAttribute('data-playing', 'false');
    }

    expect(errors, '全程不得有 pageerror / console.error').toEqual([]);
  });
});
