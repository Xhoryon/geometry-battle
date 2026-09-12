/**
 * web-zip —— 上传用 ZIP 的回归
 *
 * 为什么需要它：ZIP 是唯一一条在浏览器里解析的输入路径
 * （`web/src/api/zip.ts` 自己实现 ZIP 解析，服务端保持零依赖）。
 * 它的端到端覆盖在 `web/e2e/zip-upload.spec.ts` —— 那条真的开浏览器、
 * 真的走完整流程。但那条**只在装了 Chrome 的机器上跑**，而这里要守的东西
 * 必须在 `npm test` 里每次都守：
 *
 *   1. `valid-deflate.zip` 必须真的是一个 **DEFLATE(8)** 压缩包，
 *      而且解开之后必须逐字节等于那个被打包的算法包。
 *      否则——有人日后用普通压缩工具重打一遍（可能回落成 stored），
 *      文件名不会变、浏览器演练也照样通过，而 DEFLATE 分支就悄悄没人覆盖了。
 *   2. 浏览器那个解包器本身的行为：CRC 校验与**解压体积上限**。
 *
 * 第 1 条用 Node 内置 `zlib` **独立**验字节（不经 `zip.ts`），保证「fixture 是不是
 * 真 DEFLATE」这件事不被被测代码自己证明。第 2 条才真的 import `zip.ts`。
 *
 * 关于 import：本文件曾经**不能** import `web/src/api/zip.ts`，因为那个模块用了
 * DOM 的 `Blob`/`BlobPart`，而平台侧 tsconfig 的 `lib` 只有 ES2020。
 * V1.2 Final RC Audit 之后那里的起流改成了 `Response`（`Response` /
 * `DecompressionStream` / `btoa` 在 `@types/node` 里都有全局声明），
 * 于是 CRC 与体积上限这两条**不再只能靠需要 Chrome 的 E2E 覆盖**。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { unzipToFiles, crc32 } from '../web/src/api/zip';
import { MAX_UPLOAD_BYTES } from '../src/server/protocol';
import { assert, assertEqual, assertRejects, runAll, test } from './harness';

const FIX = path.join(__dirname, 'fixtures', 'uploads', 'valid-deflate.zip');
const SRC = path.join(__dirname, 'fixtures', 'algos', 'arc-sweep');
/** fixture 是「压缩一个文件夹」的产物形状：包内带一层外层目录 */
const WRAPPER = 'my-algorithm';

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  rawSize: number;
  data: Buffer;
}

/** 只解析本 fixture 用到的那点 ZIP 结构（局部头 + 中央目录） */
function readZip(zip: Buffer): ZipEntry[] {
  const out: ZipEntry[] = [];
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue; // 中央目录签名
    const method = zip.readUInt16LE(i + 10);
    const compressedSize = zip.readUInt32LE(i + 20);
    const rawSize = zip.readUInt32LE(i + 24);
    const nameLen = zip.readUInt16LE(i + 28);
    const extraLen = zip.readUInt16LE(i + 30);
    const commentLen = zip.readUInt16LE(i + 32);
    const localOffset = zip.readUInt32LE(i + 42);
    const name = zip.toString('utf-8', i + 46, i + 46 + nameLen);

    assert(zip.readUInt32LE(localOffset) === 0x04034b50, `局部头签名必须合法: ${name}`);
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + lNameLen + lExtraLen;

    out.push({
      name,
      method,
      compressedSize,
      rawSize,
      data: zip.subarray(dataAt, dataAt + compressedSize),
    });
    i += 45 + nameLen + extraLen + commentLen; // 跳到下一条中央目录记录
  }
  return out;
}

// ---------------------------------------------------------------------------
// 最小 ZIP 写入器 —— 用来造「坏 CRC」与「炸弹」两种输入。
// CRC 复用被测模块导出的 `crc32`：写入侧算错的话，正向用例立刻会红。
// ---------------------------------------------------------------------------

interface WriteEntry {
  name: string;
  content: Buffer;
  /** 写进中央目录与局部头的 CRC（默认按内容算）。传错值即模拟「文件损坏」 */
  crcOverride?: number;
  /** 写进头里的**声称**解压体积（默认按内容算）。传小值即模拟「声明值撒谎」 */
  rawSizeOverride?: number;
}

function makeZip(entries: WriteEntry[], method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const raw = e.content;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = e.crcOverride ?? crc32(new Uint8Array(raw));
    const declared = e.rawSizeOverride ?? raw.length;
    const name = Buffer.from(e.name, 'utf-8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

/** Node Buffer → 独立的 ArrayBuffer（`unzipToFiles` 的入参形状） */
function ab(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer;
}

// ===========================================================================
// 1. fixture 的真伪（用 Node 的 zlib 独立验，不经被测代码）
// ===========================================================================

test('web-zip: 上传 fixture 必须真的是 DEFLATE 压缩（防止被改回 stored）', () => {
  const entries = readZip(fs.readFileSync(FIX));
  assert(entries.length > 0, 'fixture 必须能读出中央目录');
  assertEqual(
    [...new Set(entries.map((e) => e.method))],
    [8],
    `每条记录的压缩方式都必须是 DEFLATE(8)，实际 ${JSON.stringify(entries.map((e) => e.method))}`
  );
  // 真压缩过：压缩后必须比原始小，否则「方法写着 8、其实没压」也能蒙混过去
  for (const e of entries) {
    assert(
      e.compressedSize < e.rawSize,
      `${e.name} 必须是真压缩（${e.compressedSize} 应小于 ${e.rawSize}）`
    );
  }
});

test('web-zip: fixture 解压后逐字节等于被打包的算法包', () => {
  const entries = readZip(fs.readFileSync(FIX));
  assertEqual(
    entries.map((e) => e.name).sort(),
    [`${WRAPPER}/manifest.json`, `${WRAPPER}/solver.py`],
    'fixture 必须是「压缩一个文件夹」的形状（外层目录留给浏览器侧剥）'
  );

  for (const e of entries) {
    const rel = e.name.slice(WRAPPER.length + 1);
    const onDisk = fs.readFileSync(path.join(SRC, rel));
    const inflated = zlib.inflateRawSync(e.data);
    assertEqual(inflated.equals(onDisk), true, `${e.name} 解压后必须与源文件逐字节一致`);
  }
});

// ===========================================================================
// 2. 浏览器解包器本身（直接 import zip.ts）
// ===========================================================================

test('web-zip: 浏览器解包器能直接解开提交的 DEFLATE fixture', async () => {
  const files = await unzipToFiles(ab(fs.readFileSync(FIX)));
  assertEqual(
    files.map((f) => f.path).sort(),
    [`${WRAPPER}/manifest.json`, `${WRAPPER}/solver.py`],
    '解包结果必须就是包内那两个文件'
  );
  for (const f of files) {
    const rel = f.path.slice(WRAPPER.length + 1);
    const decoded = Buffer.from(f.contentBase64, 'base64');
    assertEqual(
      decoded.equals(fs.readFileSync(path.join(SRC, rel))),
      true,
      `${f.path} 解出来的字节必须与源文件一致`
    );
  }
});

test('web-zip: CRC 不匹配的 ZIP 在浏览器里就被拒（不留到 Preflight 才报错）', async () => {
  const good = makeZip([{ name: 'solver.py', content: Buffer.from('def f(x):\n  return 0\n') }]);
  // 正向对照：先证明这个 ZIP 本身是好的，否则下面的「被拒」可能只是别的原因
  await unzipToFiles(ab(good));

  const bad = makeZip([
    {
      name: 'solver.py',
      content: Buffer.from('def f(x):\n  return 0\n'),
      crcOverride: 0xdeadbeef,
    },
  ]);
  await assertRejects(
    () => unzipToFiles(ab(bad)),
    'CRC 与内容不符时必须拒绝（损坏的 stored/deflate 条目此前会静默通过）'
  );
});

test('web-zip: 声称体积撒谎的 deflate 炸弹被流式上限拒（不能只信中央目录的声明值）', async () => {
  // 20MB 的全零 → deflate 之后只有约 20KB，是典型的炸弹形状
  const bomb = zlib.deflateRawSync(Buffer.alloc(20 * 1024 * 1024));
  assert(bomb.length < 200 * 1024, `炸弹的压缩体应当很小，实际 ${bomb.length} 字节`);

  const honest = makeZip([{ name: 'bomb.bin', content: Buffer.alloc(20 * 1024 * 1024) }]);
  await assertRejects(
    () => unzipToFiles(ab(honest)),
    '声明体积就超预算的必须被快路拒掉'
  );

  // 关键的一条：**声明值撒谎**（声称 1KB，实际解出 20MB）。
  // 快路看声明值会放行，只有 inflateRaw 的流式计数能挡住它。
  const liar = makeZip([
    { name: 'bomb.bin', content: Buffer.alloc(20 * 1024 * 1024), rawSizeOverride: 1024 },
  ]);
  const declared = readZip(liar)[0].rawSize;
  assertEqual(declared, 1024, '（前置）中央目录里声明的体积确实是撒过谎的小值');
  await assertRejects(
    () => unzipToFiles(ab(liar)),
    '声明值撒谎时，必须靠流式计数而不是声明值拦住炸弹'
  );
});

test('web-zip: 上限常量与服务端一致（前端预算不能自己另造一个数字）', () => {
  assertEqual(MAX_UPLOAD_BYTES, 12 * 1024 * 1024, '前端解压预算必须引用服务端那个常量');
});

void runAll('web-zip');
