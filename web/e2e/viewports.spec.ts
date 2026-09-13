/**
 * 视口 × 双语可用性巡检（V1.4 F5）
 *
 * 任务书要求界面在 1280×720 / 1440×900 / 1920×1080 可用，1024×768 下不得横向溢出。
 * 这里起**真的**服务、经 API 打完**真的**一场（上传 → 筹备 → 选锁 Emitter → 连续跑完），
 * 让大屏与回放有真实内容，然后对两种语言 × 四种视口 × 七条路线各截一张图，并断言：
 *
 *   · 无横向溢出（documentElement 与 body 的 scrollWidth ≤ clientWidth）；
 *   · 每个可见的 canvas 高度 > 0（竞技场没被布局挤没）；
 *   · 没有裸翻译键（把两张表的**全部键**拼成一条正则去扫可见文本 —— 不猜命名空间）；
 *   · 没有未插值的 `{placeholder}`；
 *   · 英文模式下界面文本没有 CJK / 全角字符（语言开关的本名与用户内容除外）；
 *   · 全程零 pageerror / console.error。
 *
 * 同步点全部是**权威 DOM 状态**（`data-board="ready"`、播放器 / 表格可见），没有睡眠。
 * 截图落在 web/e2e/.artifacts/viewports/<locale>/<route>-<w>x<h>.png（已 gitignore）。
 *
 * 为什么这里走 API 而不是点按钮：按钮路径已由 tournament.spec / i18n.spec 逐步覆盖；
 * 本文件只需要「一场已结束的比赛」作为巡检的底料，走 API 最快、也最不容易把
 * 巡检失败与流程失败混在一起。
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { translations } from '../src/i18n/translations';

const REPO = path.resolve(__dirname, '..', '..');
const TEAM_PKG = {
  A: path.join(REPO, 'tests', 'fixtures', 'algos', 'arc-sweep'),
  B: path.join(REPO, 'tests', 'fixtures', 'algos', 'parabola-arc'),
} as const;
const ARTIFACTS = path.join(__dirname, '.artifacts', 'viewports');

const VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const LOCALES = ['zh-CN', 'en-US'] as const;
type Locale = (typeof LOCALES)[number];
type Team = 'A' | 'B';

/**
 * 裸翻译键：两张表的全部键（`nav.home` / `judge.adv.install` …）逐字匹配，前后不能紧贴
 * 单词字符或点 —— `solver.py` / `manifest.json` 不是键，`replay.json` 也不是。
 */
const RAW_KEY_RE = new RegExp(
  '(?<![\\w.])(?:' +
    Object.keys(translations['zh-CN'])
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')(?![\\w.])'
);
/** 未插值的占位符：`{n}` / `{team}` */
const PLACEHOLDER_RE = /\{[a-zA-Z_]\w*\}/;
/** CJK 表意文字 / 日文假名 / CJK 标点 / 全角 ASCII 变体 —— 英文界面里一个都不该有 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿　-〿！-～]/;

let server: ChildProcess | null = null;
let baseURL = '';
let judgeURL = '';
let judgeToken = '';
let root = '';
/** 经 API 打完的那一场（beforeAll 里产出） */
let matchId = '';

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

// ---------------------------------------------------------------------------
// API 驱动：与浏览器同一套端点、同一套令牌纪律（令牌走请求头，不进 URL）
// ---------------------------------------------------------------------------

interface JudgeState {
  phase: string;
  matchId: string;
  teamTokens: Record<Team, string>;
  lastError: string | null;
}

async function api<T>(pathname: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseURL}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GB-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function judgeState(): Promise<JudgeState> {
  const j = await api<{ board: JudgeState }>('/api/judge/state', judgeToken);
  return j.board;
}

async function judgeCommand(pathname: string, body: unknown = {}): Promise<void> {
  const r = await api<{ ok: boolean; errors?: string[] }>(pathname, judgeToken, body);
  if (!r.ok) throw new Error(`${pathname} 被拒绝：${(r.errors ?? []).join('; ')}`);
}

/** 等服务端把阶段推进到 `expected`（轮询权威状态，不是猜时间） */
async function waitPhase(expected: string, timeoutMs: number): Promise<JudgeState> {
  const deadline = Date.now() + timeoutMs;
  let last: JudgeState | null = null;
  while (Date.now() < deadline) {
    last = await judgeState();
    if (last.phase === expected) return last;
    if (last.lastError) throw new Error(`后台推进失败（阶段 ${last.phase}）：${last.lastError}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${timeoutMs}ms 内阶段未到 ${expected}（最后是 ${last?.phase ?? '未知'}）`);
}

async function uploadViaApi(team: Team, token: string): Promise<void> {
  const dir = TEAM_PKG[team];
  const files = fs
    .readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((n) => ({ path: n, contentBase64: fs.readFileSync(path.join(dir, n)).toString('base64') }));
  const r = await api<{ ok: boolean; errors?: string[] }>('/api/team/upload', token, { team, files });
  if (!r.ok) throw new Error(`Team ${team} 上传被拒绝：${(r.errors ?? []).join('; ')}`);
}

async function pickAndLockViaApi(team: Team, token: string): Promise<void> {
  const st = await api<{ board: { candidates: { id: string }[] } }>(
    `/api/team/state?team=${team}`,
    token
  );
  const cand = st.board.candidates[1] ?? st.board.candidates[0];
  if (!cand) throw new Error(`Team ${team} 没有候选锚点`);
  for (const [p, body] of [
    ['/api/team/select-emitter', { team, pointId: cand.id }],
    ['/api/team/lock-emitter', { team }],
  ] as const) {
    const r = await api<{ ok: boolean; errors?: string[] }>(p, token, body);
    if (!r.ok) throw new Error(`Team ${team} ${p} 被拒绝：${(r.errors ?? []).join('; ')}`);
  }
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-viewports-'));
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

  // 一场真的比赛：两队上传（含沙箱 decoy preflight）→ 筹备 → 各自选锁 → 连续跑完
  const tokens = (await judgeState()).teamTokens;
  await uploadViaApi('A', tokens.A);
  await uploadViaApi('B', tokens.B);
  await judgeCommand('/api/judge/prepare');
  await waitPhase('EMITTER_SELECT', 180000);
  await pickAndLockViaApi('A', tokens.A);
  await pickAndLockViaApi('B', tokens.B);
  await waitPhase('READY', 60000);
  await judgeCommand('/api/judge/run-to-end');
  matchId = (await waitPhase('MATCH_END', 600000)).matchId;
});

test.afterAll(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    if (!server.killed) server.kill('SIGKILL');
  }
});

// ---------------------------------------------------------------------------
// 巡检
// ---------------------------------------------------------------------------

interface Route {
  name: string;
  url: () => Promise<string>;
  /** 权威就绪状态 —— 到了才截图、才读文本 */
  ready: (page: Page) => Promise<void>;
}

const teamURL = async (team: Team): Promise<string> =>
  `${baseURL}/team/${team.toLowerCase()}#t=${(await judgeState()).teamTokens[team]}`;

const ROUTES: readonly Route[] = [
  {
    name: 'home',
    url: async () => `${baseURL}/`,
    ready: async (p) => {
      await expect(p.locator('[data-testid="home"]')).toBeVisible();
      await expect(p.locator('[data-testid="home-replay-table"]')).toBeVisible();
    },
  },
  {
    name: 'judge',
    url: async () => judgeURL,
    ready: (p) => expect(p.locator('[data-testid="judge"]')).toHaveAttribute('data-board', 'ready'),
  },
  {
    name: 'team-a',
    url: () => teamURL('A'),
    ready: (p) => expect(p.locator('[data-testid="team"]')).toHaveAttribute('data-board', 'ready'),
  },
  {
    name: 'team-b',
    url: () => teamURL('B'),
    ready: (p) => expect(p.locator('[data-testid="team"]')).toHaveAttribute('data-board', 'ready'),
  },
  {
    name: 'spectator',
    url: async () => `${baseURL}/spectator`,
    ready: (p) => expect(p.locator('[data-testid="spectator"]')).toHaveAttribute('data-board', 'ready'),
  },
  {
    name: 'replays',
    url: async () => `${baseURL}/replays`,
    ready: (p) => expect(p.locator('[data-testid="replays-table"]')).toBeVisible(),
  },
  {
    name: 'replay',
    url: async () => `${baseURL}/replay/${encodeURIComponent(matchId)}`,
    ready: async (p) => {
      await expect(p.locator('[data-testid="replay-player"]')).toBeVisible();
      await expect(p.locator('.frame-btn').first()).toBeVisible();
    },
  },
];

interface Audit {
  doc: { scrollWidth: number; clientWidth: number };
  body: { scrollWidth: number; clientWidth: number };
  canvases: { width: number; height: number; visible: boolean }[];
  /** 界面文本（含 title / aria-label / placeholder），已剔除语言开关与用户内容 */
  text: string;
}

/**
 * 在页面里收集要审的东西。**用户内容**不算界面文本：源码预览、算法包名、回放侧栏队名 ——
 * 那些是选手交上来的字节，可以是任何语言。语言开关的本名（`中文`）刻意不随界面语言变。
 */
function auditPage(): Audit {
  const EXCLUDE =
    'script,style,noscript,[data-locale],.source-view,.slot__name,.review__name,.teamcard__name,.replay__teamname';
  const parts: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest(EXCLUDE)) continue;
    const v = n.nodeValue?.trim();
    if (v) parts.push(v);
  }
  for (const el of Array.from(document.body.querySelectorAll('[title],[aria-label],[placeholder],[aria-valuetext]'))) {
    if (el.closest(EXCLUDE)) continue;
    for (const attr of ['title', 'aria-label', 'placeholder', 'aria-valuetext']) {
      const v = el.getAttribute(attr)?.trim();
      if (v) parts.push(v);
    }
  }
  const de = document.documentElement;
  return {
    doc: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
    canvases: Array.from(document.querySelectorAll('canvas')).map((c) => ({
      width: c.clientWidth,
      height: c.clientHeight,
      visible: c.getClientRects().length > 0,
    })),
    text: parts.join('\n'),
  };
}

async function runLocale(browser: Browser, locale: Locale): Promise<void> {
  const outDir = path.join(ARTIFACTS, locale);
  fs.mkdirSync(outDir, { recursive: true });
  const problems: string[] = [];
  const summary: Record<string, unknown>[] = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: vp, locale });
    // 与 tournament.spec 同一种钉法：每个页面加载前先写好语言选择
    await context.addInitScript((l: string) => {
      try {
        window.localStorage.setItem('geometry-battle.locale', l);
      } catch {
        /* 私密模式下写不进去，那就退回浏览器语言 */
      }
    }, locale);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    for (const route of ROUTES) {
      const tag = `${locale} ${route.name} ${vp.width}x${vp.height}`;
      await page.goto(await route.url());
      await route.ready(page);
      // <html lang> 跟着语言走
      expect(await page.locator('html').getAttribute('lang'), `${tag}: <html lang>`).toBe(locale);

      const a = await page.evaluate(auditPage);
      await page.screenshot({ path: path.join(outDir, `${route.name}-${vp.width}x${vp.height}.png`), fullPage: true });

      if (a.doc.scrollWidth > a.doc.clientWidth) problems.push(`${tag}: 文档横向溢出 ${a.doc.scrollWidth} > ${a.doc.clientWidth}`);
      if (a.body.scrollWidth > a.body.clientWidth) problems.push(`${tag}: body 横向溢出 ${a.body.scrollWidth} > ${a.body.clientWidth}`);
      for (const c of a.canvases) {
        if (c.visible && !(c.height > 0 && c.width > 0)) problems.push(`${tag}: 可见 canvas 尺寸为 ${c.width}×${c.height}`);
      }
      const rawKey = RAW_KEY_RE.exec(a.text);
      if (rawKey) problems.push(`${tag}: 出现裸翻译键 ${rawKey[0]}`);
      const hole = PLACEHOLDER_RE.exec(a.text);
      if (hole) problems.push(`${tag}: 出现未插值占位符 ${hole[0]}`);
      if (locale === 'en-US') {
        const cjk = CJK_RE.exec(a.text);
        if (cjk) {
          const at = cjk.index;
          problems.push(`${tag}: 英文界面出现 CJK：…${a.text.slice(Math.max(0, at - 30), at + 30).replace(/\n/g, ' ')}…`);
        }
      }
      summary.push({
        route: route.name,
        viewport: `${vp.width}x${vp.height}`,
        docScrollWidth: a.doc.scrollWidth,
        canvases: a.canvases,
        textChars: a.text.length,
      });
    }

    if (errors.length) problems.push(`${locale} ${vp.width}x${vp.height}: ${errors.join(' | ')}`);
    await context.close();
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ matchId, summary, problems }, null, 2));
  expect(problems, `巡检问题（${locale}）`).toEqual([]);
}

for (const locale of LOCALES) {
  test(`视口巡检 ${locale}：4 视口 × 7 路线，无溢出 / 无裸键 / 无占位 / 画布可见 / 零页面错误`, async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    expect(matchId, '前置：应当已经经 API 打完一场').not.toBe('');
    await runLocale(browser, locale);
  });
}
