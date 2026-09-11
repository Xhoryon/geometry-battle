/**
 * 浏览器上传的落盘与只读浏览（V1.2 §一/§二）
 *
 * 两个函数，一条纪律：**这里不做任何校验**。
 *
 * 上传的文件只是被写进一个临时目录，然后交给平台既有的安装流水线
 * （`MatchSetupUI.installAlgorithm` → `stageSlot` → `inspectPackage` → 沙箱 preflight
 * → `commitSlot`）。包形态、体积、文件数、扩展名、能不能跑起来、输出合不合法，
 * 全部由那条流水线判定 —— 浏览器侧**没有任何绕过验证的通道**。
 *
 * 本文件只负责两件事：
 *   1. 把「路径 + 内容」安全地落到磁盘（防路径穿越、防符号链接、防写出界）；
 *   2. 只读地读回本队包内的一个文件（同样防穿越）——「浏览源码」用。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** 单次上传允许的**编码前**总字节上限（与包上限 8MB 同量级，留出 base64 开销余量） */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** 单次上传允许的文件数上限（与包上限一致） */
export const MAX_UPLOAD_FILES = 256;

export interface UploadedFile {
  /** 包内相对路径，如 `solver.py` 或 `utils/helper.py` */
  path: string;
  /** 文件内容的 base64 */
  contentBase64: string;
}

export interface StagedUpload {
  ok: boolean;
  dir: string;
  errors: string[];
}

/**
 * 校验一个包内相对路径是否可以安全落盘。
 *
 * 拒绝：绝对路径、盘符、`..` 段、空段、NUL、以及任何解析后逃出根目录的路径。
 * **在校验之后**仍然用 `resolve` 复核一次 —— 不依赖「我刚检查过了」。
 */
export function isSafeRelPath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.length > 512) return false;
  if (rel.includes('\0')) return false;
  if (path.isAbsolute(rel)) return false;
  if (/^[A-Za-z]:/.test(rel)) return false; // Windows 盘符
  if (rel.startsWith('\\\\') || rel.startsWith('//')) return false; // UNC
  const parts = rel.split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') return false;
  }
  return true;
}

/**
 * 把上传的文件清单落进一个全新的临时目录。
 *
 * 失败时**不留下半份包**：任何一项不合法就直接返回错误，调用方拿到的是
 * 「什么都没写」。目录由 `mkdtemp` 创建，具备 0700 权限且名字不可预测。
 */
export function writeUploadedPackage(files: UploadedFile[]): StagedUpload {
  const errors: string[] = [];
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, dir: '', errors: ['上传内容为空'] };
  }
  if (files.length > MAX_UPLOAD_FILES) {
    return { ok: false, dir: '', errors: [`文件数超过上限 ${MAX_UPLOAD_FILES}`] };
  }

  let total = 0;
  const decoded: { rel: string; bytes: Buffer }[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const rel = String(f?.path ?? '');
    if (!isSafeRelPath(rel)) {
      errors.push(`非法路径: ${rel || '(empty)'}`);
      continue;
    }
    if (seen.has(rel)) {
      errors.push(`重复路径: ${rel}`);
      continue;
    }
    seen.add(rel);

    let bytes: Buffer;
    try {
      bytes = Buffer.from(String(f?.contentBase64 ?? ''), 'base64');
    } catch {
      errors.push(`内容不是合法 base64: ${rel}`);
      continue;
    }
    total += bytes.length;
    if (total > MAX_UPLOAD_BYTES) {
      return { ok: false, dir: '', errors: [`上传体积超过上限 ${MAX_UPLOAD_BYTES} 字节`] };
    }
    decoded.push({ rel, bytes });
  }

  if (errors.length > 0) return { ok: false, dir: '', errors };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-upload-'));
  fs.chmodSync(dir, 0o700);
  for (const d of decoded) {
    const target = path.resolve(dir, d.rel);
    // 复核：解析之后仍必须落在临时目录内（防 `a/../../x` 这类绕过）
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      return { ok: false, dir, errors: [`路径越界: ${d.rel}`] };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, d.bytes);
  }
  return { ok: true, dir, errors: [] };
}

/**
 * 只读读回包内的一个文件（浏览源码）。
 *
 * 与上传同样的两道防线：先按相对路径的规则拒一次，再 `resolve` 复核一次。
 * 另外拒绝任何指向包外的符号链接 —— 包本身不允许符号链接（规范 §1），
 * 但这里不复用那条规则，而是直接查 `lstat`，避免依赖上游的校验顺序。
 */
export function readPackageFile(packageDir: string, relPath: string): string {
  if (!isSafeRelPath(relPath)) throw new Error(`非法路径: ${relPath}`);
  const base = path.resolve(packageDir);
  const target = path.resolve(base, relPath);
  if (!target.startsWith(base + path.sep)) throw new Error(`路径越界: ${relPath}`);

  // 所有 fs 错误都被翻译成人话再抛出。
  //
  // 原因：Node 的 `ENOENT: … lstat '/Users/…/slots/team-a/nope.py'` 里带着
  // **服务端绝对路径**，而这条消息会原样回给浏览器 —— 等于给探测者泄了目录结构。
  // 回显 `relPath` 是安全的：那是调用方自己传进来的字符串。
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch {
    throw new Error(`包内没有这个文件: ${relPath}`);
  }
  if (st.isSymbolicLink()) throw new Error('不允许读取符号链接');
  if (!st.isFile()) throw new Error('不是一个文件');
  if (st.size > 512 * 1024) throw new Error('文件过大，不予在线浏览');

  try {
    return fs.readFileSync(target, 'utf-8');
  } catch {
    throw new Error(`读取失败: ${relPath}`);
  }
}
