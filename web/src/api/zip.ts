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

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
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
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (u32(dv, p) !== SIG_CENTRAL) throw new Error('ZIP 中央目录损坏');
    const method = u16(dv, p + 10);
    const compressedSize = u32(dv, p + 20);
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

    let content: Uint8Array;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRaw(compressed);
    else throw new Error(`不支持的 ZIP 压缩方式 ${method}（仅支持 stored / deflate）`);

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
