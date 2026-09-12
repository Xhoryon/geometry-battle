/**
 * web-zip —— 上传用 ZIP fixture 的**防漂移**回归
 *
 * 为什么需要它：ZIP 是唯一一条在浏览器里解析的输入路径
 * （`web/src/api/zip.ts` 自己实现 ZIP 解析，服务端保持零依赖）。
 * 它的端到端覆盖在 `web/e2e/zip-upload.spec.ts` —— 那条真的开浏览器、
 * 真的走完整流程。但那条**只在装了 Chrome 的机器上跑**，而这里要守的东西
 * 必须在 `npm test` 里每次都守：
 *
 *   `valid-deflate.zip` 必须真的是一个 **DEFLATE(8)** 压缩包，
 *   而且解开之后必须逐字节等于那个被打包的算法包。
 *
 * 否则——有人日后用普通压缩工具重打一遍（可能回落成 stored），
 * 文件名不会变、浏览器演练也照样通过，而 DEFLATE 分支就悄悄没人覆盖了。
 *
 * 本文件**不 import `web/src/api/zip.ts`**：那个模块用了 DOM 的 `BlobPart`，
 * 而平台侧 tsconfig 的 lib 只有 ES2020。为一条测试改平台的编译环境不划算，
 * 用 Node 内置的 `zlib` 直接验字节更干净 —— 验的也正是同一个东西。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { assert, assertEqual, runAll, test } from './harness';

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
    assertEqual(
      inflated.equals(onDisk),
      true,
      `${e.name} 解压后必须与源文件逐字节一致`
    );
  }
});

void runAll('web-zip');
