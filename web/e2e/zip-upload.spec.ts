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

test('ZIP 上传：合法包 → 源码审阅 → 筹备 → 双方锁定 → 坏包不改动已装好的包', async ({
  page,
}) => {
  test.setTimeout(20 * 60 * 1000);
  const { solver, manifest } = packageFiles();

  // ---- 1. Team A：**平铺** ZIP（包根目录直接是 solver.py）----
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

  // ---- 3. Team B：**带外层目录**的 ZIP ----
  // 「把文件夹压缩成 zip」的产物长这样，入口在 my-algo/solver.py。
  // 平台要求入口就在包根目录，所以浏览器侧必须把那层目录剥掉。
  const zipB = path.join(tmpZipDir, 'team-b.zip');
  fs.writeFileSync(
    zipB,
    makeZip([
      { name: 'my-algo/solver.py', data: solver },
      { name: 'my-algo/manifest.json', data: manifest },
    ])
  );
  await uploadZip(page, 'B', zipB);
  const filesB = await page.locator('[data-testid="team-file"]').allInnerTexts();
  expect(filesB.sort(), '外层目录必须被剥掉，入口落在包根').toEqual([
    'manifest.json',
    'solver.py',
  ]);

  // ---- 4. 裁判筹备（含真实沙箱 Preflight）----
  await page.goto(`${baseURL}/judge`);
  await expect(page.locator('[data-testid="judge-team-A"]')).toContainText('算法就绪');
  await expect(page.locator('[data-testid="judge-team-B"]')).toContainText('算法就绪');
  await page.locator('[data-action="prepare"]').click();
  await expect(page.locator('[data-testid="phase"]')).toHaveText('EMITTER_SELECT', {
    timeout: 180000,
  });

  // ---- 5. 双方各自选锚点并锁定 ----
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

  // ---- 6. 坏 ZIP：必须当场报错 ----
  const zipBad = path.join(tmpZipDir, 'broken.zip');
  // 有 .zip 后缀，但内容不是 ZIP（EOCD 签名找不到）
  fs.writeFileSync(zipBad, Buffer.from('this is definitely not a zip file\n'));
  await page.goto(`${baseURL}/team/a`);
  await page.locator('[data-testid="team-upload"]').setInputFiles([zipBad]);
  await expect(page.locator('[data-testid="team-errors"]')).toBeVisible({ timeout: 60000 });

  // ---- 7. 坏包不得动到槽位里那份合法包 ----
  // 「先判后装」的意义就在这里：失败的替换不能把上一份好包一起带走。
  await expect(page.locator('[data-testid="team-package"] .tag')).toHaveText('已就绪');
  const stillThere = await page.locator('[data-testid="team-file"]').allInnerTexts();
  expect(stillThere.sort(), '被拒的 ZIP 不得改动已装好的包').toEqual([
    'manifest.json',
    'solver.py',
  ]);
});
