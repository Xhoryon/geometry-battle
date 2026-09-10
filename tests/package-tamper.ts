/**
 * package-tamper —— 算法包密封与防篡改
 *
 * 覆盖 Finding: P0-5（validatePackage 从未调用）、P0-6（密封副本可被修改）、
 *              P2-14（缺少 entrypoint 检查）
 *
 * 契约：比赛只从密封副本启动；密封副本只读；任何事后修改（改内容、加文件、
 *       删文件）都必须被 verifySeal 检出，并让引擎在轮次开始前拒绝开赛。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import {
  PackageFile,
  SealedPackage,
  hashFileList,
  inspectPackage,
  sealPackage,
  verifySeal,
} from '../src/submission/Package';
import { assert, assertEqual, assertRejects, runAll, test, tmpDir } from './harness';

/** 字段分隔符：真正的 NUL（用 fromCharCode 构造，源码保持纯 ASCII） */
const NUL = String.fromCharCode(0);

const STARTER = path.join(__dirname, '..', 'starter');

function sealStarter(matchId: string): { sealed: SealedPackage; root: string } {
  const root = tmpDir('tamper');
  const r = sealPackage({
    team: 'A',
    sourceDir: STARTER,
    sealRoot: path.join(root, 'artifacts', 'sealed'),
    matchId,
  });
  assert(r.sealed, `密封应成功: ${r.errors.join('; ')}`);
  return { sealed: r.sealed!, root };
}

/** 把只读文件/目录改回可写（测试扮演宿主上的攻击者） */
function makeWritable(p: string): void {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    fs.chmodSync(p, 0o755);
    for (const e of fs.readdirSync(p)) makeWritable(path.join(p, e));
  } else {
    fs.chmodSync(p, 0o644);
  }
}

test('package-tamper: 哈希字段分隔符与源码可检索性（P3-B 回归）', () => {
  // 1) 哈希必须用真正的 NUL 分隔字段 —— 用独立实现对照，
  //    避免「实现与测试同源」导致的假阳性。
  const files: PackageFile[] = [
    { relPath: 'b.py', size: 2, sha256: 'bb' },
    { relPath: 'a.py', size: 1, sha256: 'aa' },
  ];
  const expected = crypto
    .createHash('sha256')
    .update([`a.py${NUL}1${NUL}aa`, `b.py${NUL}2${NUL}bb`].join('\n'))
    .digest('hex');
  assertEqual(hashFileList(files), expected, '哈希必须与「按 relPath 排序 + NUL 分隔」一致');
  assertEqual(hashFileList([...files].reverse()), expected, '哈希必须与文件顺序无关');

  // 2) 源码不得含裸 NUL 字节 —— 否则 grep / diff / 审计工具会把整份文件判为二进制，
  //    静态检索会静默漏掉这个文件（P3-B 的原始症状）。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'submission', 'Package.ts'));
  assert(!source.includes(0), 'Package.ts 不得包含裸 NUL 字节（会让 grep 判定为二进制）');
});

test('package-tamper: 密封副本是只读的', () => {
  const { sealed } = sealStarter('TAMPER-RO');
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const mode = fs.statSync(p).mode & 0o777;
      if (e.isDirectory()) {
        assertEqual(mode, 0o555, `目录 ${e.name} 必须是只读的`);
        walk(p);
      } else {
        assertEqual(mode, 0o444, `文件 ${e.name} 必须是只读的`);
      }
    }
  };
  walk(sealed.sealedDir);
});

test('package-tamper: 修改密封副本内容被检出', () => {
  const { sealed } = sealStarter('TAMPER-EDIT');
  const entry = path.join(sealed.sealedDir, 'solver.py');
  makeWritable(entry);
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8') + '\n# tampered\n');

  const inspection = inspectPackage(sealed.sealedDir);
  assert(inspection.valid, '篡改后的包结构仍然合法 —— 所以必须靠哈希检出');
  const verify = verifySeal(sealed);
  assert(!verify.ok, '篡改必须被检出');
  assert(
    verify.errors.some((e) => e.includes('篡改')),
    `错误信息应说明被篡改: ${verify.errors.join('; ')}`
  );
});

test('package-tamper: 新增文件被检出', () => {
  const { sealed } = sealStarter('TAMPER-ADD');
  makeWritable(sealed.sealedDir);
  fs.writeFileSync(path.join(sealed.sealedDir, 'extra.py'), '# injected\n');
  const verify = verifySeal(sealed);
  assert(!verify.ok, '新增文件必须被检出（哈希不一致）');
});

test('package-tamper: 删除文件被检出', () => {
  const { sealed } = sealStarter('TAMPER-DEL');
  makeWritable(sealed.sealedDir);
  fs.rmSync(path.join(sealed.sealedDir, 'solver.py'));
  const verify = verifySeal(sealed);
  assert(!verify.ok, '删除文件必须被检出');
});

test('package-tamper: 源包被篡改不影响已密封副本', () => {
  const root = tmpDir('tamper-src');
  const src = path.join(root, 'src');
  fs.cpSync(STARTER, src, { recursive: true });
  const r = sealPackage({ team: 'A', sourceDir: src, sealRoot: path.join(root, 'sealed'), matchId: 'TAMPER-SRC' });
  assert(r.sealed, '密封应成功');

  // 攻击者改了源目录
  const srcEntry = path.join(src, 'solver.py');
  fs.writeFileSync(srcEntry, fs.readFileSync(srcEntry, 'utf8') + '\n# tampered\n');

  const verify = verifySeal(r.sealed!);
  assert(verify.ok, `密封副本不应受源包影响: ${verify.errors.join('; ')}`);
  assertEqual(verify.hash, r.sealed!.hash, '密封哈希必须保持不变');
});

test('package-tamper: 引擎在轮次开始时拒绝被篡改的包', async () => {
  const root = tmpDir('tamper-engine');
  const engine = new MatchEngine({
    matchId: 'TAMPER-ENGINE',
    seed: 20260909,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', STARTER).ok, 'A 上传应成功');
  assert(engine.upload('B', STARTER).ok, 'B 上传应成功');
  assert((await engine.preflight()).ok, 'preflight 应通过');
  engine.startMatch();
  assert(engine.judgeStartRound().ok, '应可 START ROUND');

  // 在开赛前篡改 A 的密封副本
  const sealedA = path.join(root, 'artifacts', 'sealed', 'TAMPER-ENGINE', 'A', 'solver.py');
  makeWritable(sealedA);
  fs.writeFileSync(sealedA, fs.readFileSync(sealedA, 'utf8') + '\n# tampered\n');

  await assertRejects(() => engine.runRound(), '被篡改的包必须让轮次开赛失败（P0-6）');
  const audit = engine.getArtifacts().auditLog;
  assert(
    audit.events.some((e) => e.type === 'PackageTampered'),
    `审计日志必须记录 PackageTampered，实际 ${audit.events.map((e) => e.type).join(',')}`
  );
});

void runAll('package-tamper');
