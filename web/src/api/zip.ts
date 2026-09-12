/**
 * 浏览器端 ZIP 解包（V1.2 §一：「上传自己的算法包（ZIP / folder / solver.py）」）
 *
 * 为什么在**浏览器**里解包，而不是把 zip 传给服务端：
 *   1. 平台是**零依赖**的（`package.json` 没有 `dependencies`），服务端没有
 *      zip 库；自己写一个 ZIP 解析器塞进服务端，风险与收益不成比例。
 *   2. 浏览器有平台自带的 `DecompressionStream('deflate-raw')` —— 解压是
 *      经过浏览器实现、久经考验的那一份，不是我们手写的 inflate。
 *   3. 服务端拿到的仍然是「路径 + 字节」的**文件清单**，走同一条安装流水线；
 *      浏览器解包**不绕过任何校验**。
 *
 * 只支持 `stored(0)` 与 `deflate(8)` —— 这两种覆盖了所有常规 zip 工具的输出。
 * 遇到别的压缩方法直接报错，不猜。
 */

import { MAX_UPLOAD_BYTES } from '../../../src/server/protocol';

export interface UploadedFile {
  path: string;
  contentBase64: string;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function u16(dv: DataView, at: number): number {
  return dv.getUint16(at, true);
}
function u32(dv: DataView, at: number): number {
  return dv.getUint32(at, true);
}

/** 从尾部往前找 EOCD（注释区最长 65535，因此只需要回扫这么多） */
function findEocd(dv: DataView): number {
  const min = Math.max(0, dv.byteLength - 65557);
  for (let i = dv.byteLength - 22; i >= min; i--) {
    if (u32(dv, i) === SIG_EOCD) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// CRC-32（ZIP 用的就是 IEEE 802.3 那一条）
// ---------------------------------------------------------------------------

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 标准 CRC-32。导出来给打包方（E2E 里现造 ZIP 的写入器）复用，免得写第二份 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 解一条 deflate-raw 流，**边解边计字节**，超过预算立刻中止。
 *
 * 为什么不只看中央目录里声明的 uncompressed size：那个值**攻击者可控且可以撒谎**
 * （声明 1KB、实际 1GB）。声明值只配当快路优化，**真正的防线是这里的流式计数** ——
 * 否则一个 deflate 炸弹能把标签页打死，而浏览器这一侧没有服务端那道 12MiB 闸门兜着。
 *
 * 起流用 `ReadableStream` 而不是 `Blob`：`Blob` / `BlobPart` 是 **DOM-only** 类型，
 * 而平台侧 tsconfig 的 `lib` 只有 ES2020 —— 引用了它，这个模块就没法被
 * `tests/web-zip.ts` import，于是 CRC 与体积上限就只能靠需要 Chrome 的 E2E 覆盖。
 * `ReadableStream` / `DecompressionStream` / `btoa` 在 `@types/node` 里都有全局声明。
 *
 * **不要**图省事把 `bytes.buffer` 直接交给 `Response`：`bytes` 常常是
 * `subarray`（见 `unzipToFiles`），`.buffer` 是它**底下的整块**缓冲，
 * 会连着别的条目的字节一起解 —— 那是真的解错，不是类型问题。
 */
async function inflateRaw(bytes: Uint8Array, budget: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  // DOM 那份 `DecompressionStream` 把 writable 收窄成 `WritableStream<BufferSource>`，
  // 而 `@types/node` 那份是 `WritableStream<any>` —— 两边各自自洽，交叉起来 TS 推不出
  // 公共类型。**运行时完全没这回事**（浏览器与 Node 都照样接受 `Uint8Array`），
  // 所以只在这里做一次局部断言，不把 `any` 泄漏到函数签名之外。
  const stream = source.pipeThrough(
    ds as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }
  );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > budget) {
      await reader.cancel();
      throw new Error(`解压后体积超过上限 ${budget} 字节 —— 疑似 ZIP 炸弹`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * 解一个 zip 成文件清单。
 *
 * 这是**纯前端**的展开：只把字节读出来，不判断包是否合法 ——
 * 「有没有 solver.py」「扩展名对不对」「体积超没超」全部由服务端的安装流水线判定。
 */
export async function unzipToFiles(zipBytes: ArrayBuffer): Promise<UploadedFile[]> {
  const dv = new DataView(zipBytes);
  const eocd = findEocd(dv);
  if (eocd < 0) throw new Error('不是合法的 ZIP 文件');

  const count = u16(dv, eocd + 10);
  const cdOffset = u32(dv, eocd + 16);
  if (count > 4096) throw new Error(`ZIP 内条目过多（${count}）`);

  const raw = new Uint8Array(zipBytes);
  const out: UploadedFile[] = [];
  /** 解压后**累计**体积 —— 与服务端同一个预算（见 `protocol.ts` 的 MAX_UPLOAD_BYTES） */
  let totalOut = 0;
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (u32(dv, p) !== SIG_CENTRAL) throw new Error('ZIP 中央目录损坏');
    const method = u16(dv, p + 10);
    const declaredCrc = u32(dv, p + 16);
    const compressedSize = u32(dv, p + 20);
    const declaredSize = u32(dv, p + 24);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOffset = u32(dv, p + 42);
    const name = new TextDecoder('utf-8').decode(raw.subarray(p + 46, p + 46 + nameLen));

    // 目录条目（以 / 结尾）直接跳过 —— 空目录不进包
    if (name.endsWith('/')) {
      p += 46 + nameLen + extraLen + commentLen;
      continue;
    }

    if (u32(dv, localOffset) !== SIG_LOCAL) throw new Error(`ZIP 局部头损坏: ${name}`);
    const lNameLen = u16(dv, localOffset + 26);
    const lExtraLen = u16(dv, localOffset + 28);
    const dataAt = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = raw.subarray(dataAt, dataAt + compressedSize);

    // 快路：声明值本身就超预算的，不必解压。**只是快路** —— 声明值是攻击者可控的，
    // 真防线是下面 inflateRaw 的流式计数与逐条 CRC。
    if (declaredSize > MAX_UPLOAD_BYTES) {
      throw new Error(`ZIP 内文件声明体积过大: ${name}`);
    }

    let content: Uint8Array;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRaw(compressed, MAX_UPLOAD_BYTES - totalOut);
    else throw new Error(`不支持的 ZIP 压缩方式 ${method}（仅支持 stored / deflate）`);

    totalOut += content.byteLength;
    if (totalOut > MAX_UPLOAD_BYTES) {
      throw new Error(`ZIP 解压后总体积超过上限 ${MAX_UPLOAD_BYTES} 字节`);
    }

    // CRC 不只是「更早发现损坏」：它能在浏览器里就说清「这个 zip 是坏的」，
    // 而不是上传之后得到一句难懂的 Preflight 失败。服务端哈希 + Preflight 仍是权威兜底。
    if (crc32(content) !== declaredCrc) {
      throw new Error(`ZIP 校验和不匹配: ${name}（文件已损坏）`);
    }

    out.push({ path: name, contentBase64: bytesToBase64(content) });
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (out.length === 0) throw new Error('ZIP 里没有任何文件');
  return out;
}

/** 分块转 base64 —— 一次性 apply 会在包大时爆栈 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
