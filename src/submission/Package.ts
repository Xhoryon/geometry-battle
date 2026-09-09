/**
 * Algorithm Package — 校验 / 密封 / 防篡改
 *
 * 修复的 Finding：
 *   P0-5  validatePackage 在比赛流程中从未被调用
 *   P0-6  包密封与哈希校验不存在
 *   P1-26 MatchLog 哈希为空、结果硬编码
 *   P2-14 缺少 entrypoint / 语法错误 / 运行时错误检查
 *
 * 密封语义：
 *   Upload 时把包复制到 artifacts/sealed/<matchId>/<team>/ 并计算 SHA-256。
 *   之后所有 Round 都从密封副本启动，并在每回合开始前重新校验**密封副本**的哈希。
 *
 *   ⚠️ 已知边界（Cycle 1 审计 P3-A #4）：密封后**不再复验原始包目录**。
 *   比赛开始后替换原始包既不影响已密封副本（比赛用的是密封副本），
 *   也**不会**产生任何告警或审计事件。人工评审时不要指望靠替换源包触发告警。
 *
 * V1.1（Algorithm Slot, Startup & JSON IPC §3/§4）：
 *   入口固定为包根目录的 `solver.py`；`manifest.json` 变为可选元数据，
 *   平台不再读取 `manifest.entry` 来决定执行什么。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ENTRY_FILENAME, Manifest, defaultManifest, parseManifest } from './Manifest';

export interface PackageFile {
  relPath: string;
  size: number;
  sha256: string;
}

export interface PackageInspection {
  valid: boolean;
  errors: string[];
  manifest: Manifest | null;
  files: PackageFile[];
  totalBytes: number;
  /** 文件清单的 SHA-256（稳定、与顺序无关） */
  hash: string | null;
}

export interface SealedPackage {
  team: 'A' | 'B';
  sourceDir: string;
  sealedDir: string;
  manifest: Manifest;
  entry: string;
  hash: string;
  files: PackageFile[];
  sealedAt: string;
}

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGE_FILES = 256;
const ALLOWED_EXTENSIONS = new Set(['.py', '.json', '.txt', '.md', '.csv', '.yaml', '.yml']);

function walk(dir: string, base: string, out: PackageFile[], errors: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    errors.push(`无法读取目录 ${dir}: ${(e as Error).message}`);
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    if (rel.startsWith('..')) {
      errors.push(`包内存在越界路径: ${rel}`);
      continue;
    }
    if (entry.isSymbolicLink()) {
      errors.push(`不允许符号链接: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(abs, base, out, errors);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`不允许的文件类型: ${rel}`);
      continue;
    }
    const content = fs.readFileSync(abs);
    out.push({
      relPath: rel.split(path.sep).join('/'),
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }
}

/** 计算与文件顺序无关的包哈希 */
export function hashFileList(files: PackageFile[]): string {
  const canonical = [...files]
    .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
    .map((f) => `${f.relPath}\u0000${f.size}\u0000${f.sha256}`)
    .join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** 结构校验（不执行算法） */
export function inspectPackage(dir: string): PackageInspection {
  const errors: string[] = [];
  const files: PackageFile[] = [];

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { valid: false, errors: ['Package 目录不存在'], manifest: null, files: [], totalBytes: 0, hash: null };
  }

  // V1.1 §3/§4：入口固定为包根目录的 solver.py；manifest.json 变为可选元数据。
  // 平台不再用 manifest.entry 决定执行什么，因此缺失 manifest 不再算错误。
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest: Manifest;
  if (fs.existsSync(manifestPath)) {
    const manifestResult = parseManifest(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifestResult.valid || !manifestResult.manifest) {
      return { valid: false, errors: manifestResult.errors, manifest: null, files: [], totalBytes: 0, hash: null };
    }
    manifest = manifestResult.manifest;
  } else {
    manifest = defaultManifest(path.basename(dir));
  }

  walk(dir, dir, files, errors);

  if (files.length === 0) errors.push('Package 为空');
  if (files.length > MAX_PACKAGE_FILES) errors.push(`文件数 ${files.length} 超过上限 ${MAX_PACKAGE_FILES}`);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    errors.push(`包体积 ${totalBytes} 字节超过上限 ${MAX_PACKAGE_BYTES}`);
  }

  // 固定入口必须在**包根目录**（子目录里的 solver.py 不算，规范 §3）
  if (!files.some((f) => f.relPath === ENTRY_FILENAME)) {
    errors.push(`缺少固定入口 ${ENTRY_FILENAME}（V1.1 §3：包根目录必须存在该文件）`);
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest,
    files,
    totalBytes,
    hash: files.length > 0 ? hashFileList(files) : null,
  };
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * 密封算法包：复制到 artifacts 并计算哈希。
 * 之后比赛只从密封副本启动。
 */
export function sealPackage(opts: {
  team: 'A' | 'B';
  sourceDir: string;
  sealRoot: string;
  matchId: string;
}): { sealed: SealedPackage | null; errors: string[] } {
  const inspection = inspectPackage(opts.sourceDir);
  const manifest = inspection.manifest;
  const sourceHash = inspection.hash;
  if (!inspection.valid || !manifest || !sourceHash) {
    return { sealed: null, errors: inspection.errors };
  }

  const sealedDir = path.join(opts.sealRoot, opts.matchId, opts.team);
  fs.rmSync(sealedDir, { recursive: true, force: true });
  copyDir(opts.sourceDir, sealedDir);

  // 复制后重新计算哈希：必须与源一致
  const sealedInspection = inspectPackage(sealedDir);
  if (!sealedInspection.valid || sealedInspection.hash !== sourceHash) {
    return {
      sealed: null,
      errors: ['密封副本哈希与源包不一致', ...sealedInspection.errors],
    };
  }

  // 密封副本只读，防止运行期被修改
  makeReadOnly(sealedDir);

  return {
    sealed: {
      team: opts.team,
      sourceDir: opts.sourceDir,
      sealedDir,
      manifest,
      entry: manifest.entry,
      hash: sourceHash,
      files: inspection.files,
      sealedAt: new Date().toISOString(),
    },
    errors: [],
  };
}

function makeReadOnly(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      makeReadOnly(p);
      try { fs.chmodSync(p, 0o555); } catch { /* ignore */ }
    } else {
      try { fs.chmodSync(p, 0o444); } catch { /* ignore */ }
    }
  }
}

/** 重新校验密封副本是否仍然完好 */
export function verifySeal(sealed: SealedPackage): { ok: boolean; hash: string | null; errors: string[] } {
  const inspection = inspectPackage(sealed.sealedDir);
  if (!inspection.valid) return { ok: false, hash: null, errors: inspection.errors };
  if (inspection.hash !== sealed.hash) {
    return {
      ok: false,
      hash: inspection.hash,
      errors: [`密封副本已被篡改：期望 ${sealed.hash}，实际 ${inspection.hash}`],
    };
  }
  return { ok: true, hash: inspection.hash, errors: [] };
}
