/**
 * ZIP 上传的真实浏览器演练（V1.2 §33/§34/§35）
 *
 * 参赛者页面上写着「一个 .zip 也可以」—— 这条演练就真的走一遍那条路：
 *
 *   1. Team A 上传一个**合法 ZIP**（包根目录直接是 solver.py）
 *   2. Team B 上传一个**带外层目录的 ZIP**（「压缩一个文件夹」的常见产物）
 *   3. 只读浏览包内源码
 *   4. 裁判筹备（含真实沙箱 Preflight）
 *   5. 双方各自选锚点并锁定 → READY
 *   6. 一个**坏 ZIP**：必须当场报错
 *   7. 坏包之后，槽位里**上一份合法的包原样还在**
 *
 * 为什么值得单独一条：ZIP 是唯一一条**在浏览器里**解析的输入路径
 * （`web/src/api/zip.ts` 自己实现 ZIP 解析，服务端零依赖）。它此前没有任何
 * 端到端覆盖 —— 普通的 `setInputFiles` 走的是「文件」那条路，不碰解压。
 */

import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
/** 打包用的源材料：测试私有的算法包。
 *  不能用 `starter/` —— 它是平台发行树里的包，锦标赛模式会在服务端拒绝它
 *  （这条演练第一次跑就是这么红的，那是门禁在正常工作）。 */
const PKG_SRC = path.join(REPO, 'tests', 'fixtures', 'algos', 'arc-sweep');

/**
 * 已提交的 **DEFLATE** ZIP fixture。
 *
 * 用提交好的二进制而不是测试里现压：它代表「用真实压缩工具打出来的包」，
 * 而不是我们自己写出来的字节。它的真伪（压缩方式必须是 8、解压后必须与源包
 * 逐字节一致）由 `tests/web-zip.ts` 在 `npm test` 里每次守住 ——
 * 那一条不需要浏览器，因此即使这台机器没有 Chrome 也依然有效。
 */
const DEFLATE_ZIP = path.join(REPO, 'tests', 'fixtures', 'uploads', 'valid-deflate.zip');

let server: ChildProcess | null = null;
let baseURL = '';
let root = '';

function waitForUrl(child: ChildProcess, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error(`服务未在 ${timeoutMs}ms 内启动。已收到:\n${buf}`)),
      timeoutMs
    );
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
      reject(new Error(`服务提前退出（code ${code}）:\n${buf}`));
    });
  });
}

// ============================================================================
// 最小 ZIP 写入器（stored / 不压缩）
//
// 只用到 stored(0)：客户端 `unzipToFiles` 支持 stored 与 deflate，而 stored
// 不需要实现 deflate —— 测试里要的是**产生一个真实可解析的 ZIP**，
// 不是产生一个压缩率好看的 ZIP。
// ============================================================================

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 把若干 `路径 → 字节` 打成一个 stored ZIP */
function makeZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf-8');
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 局部文件头签名
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18); // compressed size
    local.writeUInt32LE(e.data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method = stored
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // 局部头偏移
    centrals.push(central, name);

    offset += local.length + name.length + e.data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** 一个真实可用的算法包（能过结构校验与沙箱 Preflight） */
function packageFiles(): { solver: Buffer; manifest: Buffer } {
  return {
    solver: fs.readFileSync(path.join(PKG_SRC, 'solver.py')),
    manifest: fs.readFileSync(path.join(PKG_SRC, 'manifest.json')),
  };
}

/** ZIP 的存放位置 */
let tmpZipDir = '';

/**
 * 上传一个 ZIP 并等到本队显示已就绪。
 *
 * 走的是参赛者页上那个 `[data-testid="team-upload"]`（文件 / ZIP 入口），
 * 与真人操作完全一致 —— 不直接调 API。
 */
async function uploadZip(page: Page, team: 'A' | 'B', zipPath: string): Promise<void> {
  await page.goto(`${baseURL}/team/${team.toLowerCase()}`);
  await page.locator('[data-testid="team-upload"]').setInputFiles([zipPath]);
  await expect(page.locator('[data-testid="team-notes"]')).toContainText('已安装', {
    timeout: 120000,
  });
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('已就绪');
}

/**
 * 服务端权威的槽位包哈希。
 *
 * 事务性要验的是「服务端认的那份没变」，不是「界面显示没变」——
 * 所以这里读的是**服务端状态**，而不是页面上的文字。
 */
async function slotHash(team: 'a' | 'b'): Promise<string | null> {
  const r = await fetch(`http://127.0.0.1:${new URL(baseURL).port}/api/team/state?team=${team}`);
  const body = (await r.json()) as { board?: { slot?: { hash?: string | null } } };
  return body.board?.slot?.hash ?? null;
}

/** 展开裁判台的 Advanced 折叠区（非主按钮收在里面） */
async function openAdvanced(page: Page): Promise<void> {
  const details = page.locator('details.adv');
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) await details.locator('summary').click();
}

/** 点一个裁判动作：先确保可见（折叠区里的先展开），再等它变可用 */
async function clickAction(page: Page, key: string): Promise<void> {
  const btn = page.locator(`[data-action="${key}"]`);
  await expect(btn, `动作 ${key} 在页面上应当恰好出现一次`).toHaveCount(1);
  if (!(await btn.isVisible())) await openAdvanced(page);
  await expect(btn).toBeEnabled({ timeout: 180000 });
  await btn.click();
}

// ============================================================================

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-zip-'));
  tmpZipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-zipfiles-'));
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
  baseURL = await waitForUrl(server);
});

test.afterAll(() => {
  server?.kill('SIGTERM');
});

test('ZIP 上传（stored + DEFLATE）→ 源码审阅 → 筹备 → 锁定 → 完整赛事 → 坏包事务性', async ({
  page,
}) => {
  test.setTimeout(20 * 60 * 1000);
  const { solver, manifest } = packageFiles();

  // ---- 1. Team A：**stored** ZIP（平铺，包根目录直接是 solver.py）----
  // stored(0) 与 deflate(8) 是浏览器解析器里两条**不同的分支**，两条都要走。
  const zipA = path.join(tmpZipDir, 'team-a.zip');
  fs.writeFileSync(
    zipA,
    makeZip([
      { name: 'solver.py', data: solver },
      { name: 'manifest.json', data: manifest },
    ])
  );
  await uploadZip(page, 'A', zipA);

  // 解压出来的就是包内的两个文件
  const filesA = await page.locator('[data-testid="team-file"]').allInnerTexts();
  expect(filesA.sort(), 'A 端文件清单应来自 ZIP 内容').toEqual(['manifest.json', 'solver.py']);

  // ---- 2. 只读浏览包内源码 ----
  await page.locator('[data-testid="team-file"]', { hasText: 'solver.py' }).click();
  const preview = page.locator('[data-testid="team-source"]');
  await expect(preview).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.source-view')).toContainText('def ', { timeout: 30000 });
  const shown = await page.locator('.source-view').innerText();
  expect(shown, '预览必须与 ZIP 里的 solver.py 逐字一致').toBe(solver.toString('utf-8'));

  // ---- 3. 坏 ZIP 替换：必须当场报错，且**服务端权威状态不被替换** ----
  //
  // 「先判后装」的意义就在这里：失败的替换不能把上一份好包一起带走。
  // 只断言界面报错是不够的 —— 还要证明服务端真正认的那份**没变**：
  // 槽位哈希与文件清单都必须与替换前一致。
  const hashBefore = await slotHash('a');
  expect(hashBefore, '前置：A 的槽位里应已有一份合法的包').not.toBeNull();

  const zipBad = path.join(tmpZipDir, 'broken.zip');
  // 有 .zip 后缀，但内容不是 ZIP（EOCD 签名找不到）
  fs.writeFileSync(zipBad, Buffer.from('this is definitely not a zip file\n'));
  await page.locator('[data-testid="team-upload"]').setInputFiles([zipBad]);
  await expect(page.locator('[data-testid="team-errors"]')).toBeVisible({ timeout: 60000 });

  expect(await slotHash('a'), '被拒的替换不得改动服务端权威的包哈希').toBe(hashBefore);
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('已就绪');
  expect(
    (await page.locator('[data-testid="team-file"]').allInnerTexts()).sort(),
    '被拒的 ZIP 不得改动已装好的包'
  ).toEqual(['manifest.json', 'solver.py']);

  // ---- 4. Team B：**DEFLATE** ZIP（已提交的 fixture）----
  // 这是与 stored 不同的解析分支：客户端要走 `DecompressionStream('deflate-raw')`。
  // 该 fixture 带一层外层目录（「把文件夹压缩成 zip」的产物形状），
  // 因此这里顺带钉住「外层目录必须被剥掉，入口落在包根」。
  // 它本身的真伪由 `tests/web-zip.ts` 在 `npm test` 里每次守住。
  await uploadZip(page, 'B', DEFLATE_ZIP);
  const filesB = await page.locator('[data-testid="team-file"]').allInnerTexts();
  expect(filesB.sort(), '外层目录必须被剥掉，入口落在包根').toEqual([
    'manifest.json',
    'solver.py',
  ]);
  await page.locator('[data-testid="team-file"]', { hasText: 'solver.py' }).click();
  await expect(page.locator('.source-view')).toContainText('def ', { timeout: 30000 });
  expect(
    await page.locator('.source-view').innerText(),
    'B 端预览必须与 DEFLATE 包里解出来的源码逐字一致'
  ).toBe(solver.toString('utf-8'));

  // ---- 5. 裁判筹备（含真实沙箱 Preflight）----
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="judge-team-A"]')).toContainText('算法就绪');
  await expect(page.locator('[data-testid="judge-team-B"]')).toContainText('算法就绪');
  await clickAction(page, 'prepare');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('EMITTER_SELECT', {
    timeout: 180000,
  });

  // ---- 6. 双方各自选锚点并锁定 ----
  for (const team of ['A', 'B'] as const) {
    const p = await page.context().newPage();
    await p.goto(`${baseURL}/team/${team.toLowerCase()}`);
    const cands = p.locator('[data-testid="team-candidate"]');
    await expect(cands.first()).toBeVisible({ timeout: 60000 });
    await cands.nth(1).click();
    await expect(p.locator('[data-testid="team-notes"]')).toContainText('已选择');
    await p.locator('[data-testid="team-lock"]').click();
    await expect(p.locator('[data-testid="team-lock"]')).toBeDisabled({ timeout: 60000 });
    await p.close();
  }
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 120000 });
  await expect(page.locator('[data-testid="judge-team-A-emitter"]')).toContainText('锚点');
  await expect(page.locator('[data-testid="judge-team-B-emitter"]')).toContainText('锚点');

  // ---- 7. 真的打起来：至少一方是 DEFLATE 传上来的包 ----
  // 走到终局为止 —— 证明「解压出来的包」不只是能装，而是能参赛。
  await clickAction(page, 'reveal');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('REVEAL', { timeout: 60000 });
  await clickAction(page, 'start-round');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('COUNTDOWN', { timeout: 60000 });
  await clickAction(page, 'compute');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('READY', { timeout: 120000 });
  await clickAction(page, 'run-to-end');
  await expect(page.locator('[data-testid="phase"]')).toHaveText('MATCH_END', { timeout: 600000 });
  const matchId = (await page.locator('[data-testid="match-id"]').innerText()).replace(
    /^MATCH\s*/,
    ''
  );
  await expect(page.locator('[data-testid="verdict"]')).toBeVisible({ timeout: 60000 });

  // ---- 8. 观众大屏与回放 ----
  await page.goto(`${baseURL}/spectator`);
  await expect(page.locator('[data-testid="spectator"]')).toBeVisible();
  await expect(page.locator('[data-testid="spectator-verdict"]')).toBeVisible({ timeout: 60000 });

  await page.goto(`${baseURL}/replay/${encodeURIComponent(matchId)}`);
  await expect(page.locator('.frame-btn').first()).toBeVisible({ timeout: 60000 });
  expect(await page.locator('.frame-btn').count()).toBeGreaterThan(0);
});
