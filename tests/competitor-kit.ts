/**
 * competitor-kit —— 参赛工具包的永久契约（V1.1 Competitor Kit Remediation & Freeze）
 *
 * 覆盖：
 *   §3   目录布局完整（每个声称存在的文件都真的存在）
 *   §7   variable 严格形态（另有 dsl-contract 的专项回归）
 *   §8   文档里的每一个 AST 示例都真的过一遍 parser / validator
 *   §10  examples 由真实引擎生成 + 防漂移
 *   §13  CRASH 时必须保留根因（头 + 尾，而不是只留头部）
 *   §20  干净参赛者 → 复制 starter → 本地自检 / 官方 Preflight 首次即 PASS
 *   §22  引用完整性：0 个缺失文件、0 条坏链接、0 个不存在的命令
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMPUTE_TIMEOUT_MS,
  EMITTERS,
  HARD_ROUND_LIMIT,
  STALEMATE_NO_PROGRESS_LIMIT,
  firingDomain,
} from '../src/core/Rules';
import { parseCanonicalDSL, type ErrorCode } from '../src/core/Ast';
import { MatchEngine, PLATFORM_ROOT } from '../src/core/Match';
import { validateAttackFunction } from '../src/core/Validator';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import { cleanupSandbox, prepareSandbox, spawnRunner } from '../src/runner/SandboxRunner';
import { validateSubmission } from '../src/submission/LocalPreflight';
import { inspectPackage } from '../src/submission/Package';
import { generateKitExamples } from '../src/operator/generate-kit-examples';
import { formatReport, judgeDiffersOnEveryPair, type MirrorReport } from '../src/operator/check-mirror';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const KIT = path.join(PLATFORM_ROOT, 'competitor-kit');
/** 受跟踪的 canonical 出厂槽位目录（不是投递点） */
const ALGORITHMS_DIR = path.join(PLATFORM_ROOT, 'algorithms');
const STARTER_SRC = path.join(PLATFORM_ROOT, 'starter');

/**
 * 文档示例的统一约定（DSL_SPECIFICATION.md §8）。
 *
 * Rule Revision 3 §4：锚点是**固定 Emitter**，坐标是常量 —— Team A 为 (-18, 0)。
 * 文档里的示例值必须与这个常量一致，否则「示例通过校验」就成了空转。
 */
const DOC_SHOOTER = { x: EMITTERS.A.x, y: EMITTERS.A.y };
const DOC_DOMAIN = firingDomain(DOC_SHOOTER.x, 'A');

function readDoc(name: string): string {
  return fs.readFileSync(path.join(KIT, name), 'utf-8');
}

// ============================================================================
// §3 目录布局
// ============================================================================

test('competitor-kit: §3 规定的文件全部存在', () => {
  const required = [
    'README.md',
    'ALGORITHM_REQUIREMENTS.md',
    'RUNTIME_MANIFEST.md',
    'DSL_SPECIFICATION.md',
    'JSON_SCHEMA.md',
    'starter/solver.py',
    'starter/manifest.json',
    'examples/public_state.json',
    'examples/reveal_state.json',
    'examples/result.json',
    'tools/validate_submission.py',
    'tools/check_mirror.py',
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(KIT, rel)));
  assertEqual(missing, [], `competitor-kit 缺少规定文件: ${missing.join(', ')}`);
});

// ============================================================================
// §22 引用完整性
// ============================================================================

test('competitor-kit: 所有相对链接与提及的路径都真实存在', () => {
  const docs = ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'RUNTIME_MANIFEST.md', 'DSL_SPECIFICATION.md', 'JSON_SCHEMA.md'];
  const brokenLinks: string[] = [];
  const missingPaths: string[] = [];

  for (const doc of docs) {
    const text = readDoc(doc);
    const dir = path.dirname(path.join(KIT, doc));

    // ---- markdown 链接（跳过 http / mailto / 纯锚点）----
    for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      const target = m[2].trim();
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split('#')[0];
      if (clean === '') continue;
      const abs = path.resolve(dir, clean);
      if (!fs.existsSync(abs)) brokenLinks.push(`${doc}: [${m[1]}](${target})`);
    }

    // ---- 反引号里提到的仓库路径（形如 competitor-kit/… src/… tests/…）----
    for (const m of text.matchAll(/`([A-Za-z0-9_.\-/]+)`/g)) {
      const token = m[1];
      if (!/^(competitor-kit|src|tests|starter|algorithms)\//.test(token)) continue;
      const clean = token.replace(/[.,;:)）]+$/, '');
      const abs = path.join(PLATFORM_ROOT, clean);
      if (!fs.existsSync(abs)) missingPaths.push(`${doc}: ${clean}`);
    }
  }

  assertEqual(brokenLinks, [], `文档中存在坏链接:\n  ${brokenLinks.join('\n  ')}`);
  assertEqual(missingPaths, [], `文档中提到但不存在的路径:\n  ${missingPaths.join('\n  ')}`);
});

test('competitor-kit: 文档中提到的命令都指向真实入口', () => {
  const docs = ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'RUNTIME_MANIFEST.md', 'DSL_SPECIFICATION.md', 'JSON_SCHEMA.md'];
  // 命令 → 它必须存在的入口文件
  const commands: Array<{ pattern: RegExp; entry: string }> = [
    { pattern: /competitor-kit\/tools\/validate_submission\.py/, entry: 'competitor-kit/tools/validate_submission.py' },
    { pattern: /src\/operator\/validate-submission\.ts/, entry: 'src/operator/validate-submission.ts' },
    { pattern: /competitor-kit\/tools\/check_mirror\.py/, entry: 'competitor-kit/tools/check_mirror.py' },
    { pattern: /src\/operator\/check-mirror\.ts/, entry: 'src/operator/check-mirror.ts' },
    { pattern: /src\/operator\/generate-kit-examples\.ts/, entry: 'src/operator/generate-kit-examples.ts' },
    { pattern: /starter\/solver\.py/, entry: 'starter/solver.py' },
  ];
  const missing: string[] = [];
  for (const doc of docs) {
    const text = readDoc(doc);
    for (const c of commands) {
      if (c.pattern.test(text) && !fs.existsSync(path.join(PLATFORM_ROOT, c.entry))) {
        missing.push(`${doc} 提到了 ${c.entry}，但它不存在`);
      }
    }
  }
  assertEqual(missing, [], `文档引用了不存在的命令入口:\n  ${missing.join('\n  ')}`);
});

test('competitor-kit: 不再把沙箱内不可用的包写成可用（§4/§5）', () => {
  const unavailable = ['numpy', 'scipy', 'sympy', 'torch', 'pandas', 'sklearn', 'numba', 'cvxpy', 'z3'];
  const files = [
    path.join(KIT, 'README.md'),
    path.join(KIT, 'ALGORITHM_REQUIREMENTS.md'),
    path.join(KIT, 'DSL_SPECIFICATION.md'),
    path.join(KIT, 'JSON_SCHEMA.md'),
    path.join(PLATFORM_ROOT, 'README.md'),
  ];
  // 否定词表**必须两种语言都有**：README 自 V1.3 起是双语的，只写中文的话
  // 英文那半边的「依赖不可用」说明会被误判成「把不可用的包写成了可用」。
  // 注意不要加 `available` 这类词 —— 它会把真正的问题陈述一起放过。
  const NEGATED =
    /(不可用|不允许|禁止|无|NONE|none|失败|ModuleNotFoundError|无法|已修正|宿主观测|不要|cannot|unavailable|unusable|denies|deny|forbidden|not allowed|no third-party)/i;
  /**
   * 判定看**前后各 3 行**，而不是只看当前行。
   *
   * 散文是折行的：英文那句「早期文档把 numpy/scipy 写成冻结依赖 …… 但它们在沙箱里
   * 不可用」里，包名与否定词天然会落在不同物理行上。只看单行就会把**正确的说明**
   * 判成错误陈述。放宽到一个小窗口不会放过真问题 —— 一段话里只要有一句说「不可用」，
   * 它就是在讲不可用；一段话从头到尾不提否定，仍然会被抓。
   */
  const suspicious: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      for (const pkg of unavailable) {
        if (!new RegExp(`\\b${pkg}\\b`).test(line)) continue;
        const context = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        if (NEGATED.test(context)) continue;
        suspicious.push(`${path.relative(PLATFORM_ROOT, file)}:${i + 1} ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assertEqual(suspicious, [], `以下行把不可用的包写成了可用:\n  ${suspicious.join('\n  ')}`);
});

test('competitor-kit: 文档不得把不存在的绝对路径当成工作区（§14）', () => {
  const docs = ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'RUNTIME_MANIFEST.md', 'DSL_SPECIFICATION.md', 'JSON_SCHEMA.md'];
  // 绝对路径字面量（排除 `<sandbox>/input/...` 这类占位符：前面是字母/尖括号的都不算）
  const absolute = /(?:^|[\s`"'(])\/(tmp|work|Users|home)(?:\/|\b)/;
  // 否定语境（同一行或前 8 行内出现即视为「在提醒不要用」）
  const negated = /(不要硬编码|禁止|不存在|拒绝|PermissionError|不得|勿|无法|不可)/;
  const suspicious: string[] = [];

  for (const doc of docs) {
    const lines = readDoc(doc).split('\n');
    lines.forEach((line, i) => {
      if (!absolute.test(line)) return;
      const context = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      if (!negated.test(context)) suspicious.push(`${doc}:${i + 1} ${line.trim().slice(0, 80)}`);
    });
  }
  assertEqual(
    suspicious,
    [],
    `以下位置把不可用的绝对路径当成了工作区（应说明「cwd 与 TMPDIR 即工作区」）:\n  ${suspicious.join('\n  ')}`
  );
});

test('competitor-kit: 提交形态统一为目录，不存在 zip 指引（§15）', () => {
  const docs = ['README.md', 'ALGORITHM_REQUIREMENTS.md'];
  const suspicious: string[] = [];
  for (const doc of docs) {
    const lines = readDoc(doc).split('\n');
    lines.forEach((line, i) => {
      if (!/\bzip\b/i.test(line)) return;
      // 只允许「不是 zip / 无需 zip」这类否定表述
      if (!/(不是|无需|不用|不要|禁止|no\s+zip|目录)/i.test(line)) {
        suspicious.push(`${doc}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assertEqual(suspicious, [], `提交形态必须统一为目录:\n  ${suspicious.join('\n  ')}`);
});

// ============================================================================
// §8 文档里的 AST 示例必须真的过一遍 parser / validator
// ============================================================================

test('competitor-kit: DSL 文档中的每个 AST 示例都通过真实 parser / validator', () => {
  const docs = ['DSL_SPECIFICATION.md', 'ALGORITHM_REQUIREMENTS.md'];
  const marker = /<!--\s*AST-(VALID|PARSE-OK|INVALID(?::\s*([A-Z_]+))?)\s*-->\s*```json\n([\s\S]*?)```/g;
  let checked = 0;
  const failures: string[] = [];

  for (const doc of docs) {
    const text = readDoc(doc);
    for (const m of text.matchAll(marker)) {
      // m[1] 是整段标记（如 "INVALID: BAD_VALUE"），m[2] 才是错误码
      const kind = m[1].startsWith('INVALID') ? 'INVALID' : m[1];
      const expectedCode = m[2] as ErrorCode | undefined;
      const json = m[3];
      const label = `${doc}: ${kind}${expectedCode ? ` ${expectedCode}` : ''} — ${json.replace(/\s+/g, ' ').slice(0, 60)}…`;
      checked++;

      const parsed = parseCanonicalDSL(json);
      if (kind === 'INVALID') {
        // 要么解析期就报该错误码，要么解析通过但数值校验报该错误码
        const parseCodes = parsed.issues.map((i) => i.code);
        let actual: string | null = parseCodes.includes(expectedCode!) ? expectedCode! : null;
        if (actual === null && parsed.ok && parsed.ast) {
          const v = validateAttackFunction(parsed.ast, DOC_DOMAIN, DOC_SHOOTER);
          const codes = v.issues.map((i) => i.code);
          actual = codes.includes(expectedCode!) ? expectedCode! : null;
        }
        if (actual !== expectedCode) {
          failures.push(`${label}\n      期望错误码 ${expectedCode}，实际 ${parseCodes.join(',') || '(解析通过)'}`);
        }
        continue;
      }

      if (!parsed.ok || !parsed.ast) {
        failures.push(`${label}\n      应被接受，实际 ${parsed.issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
        continue;
      }
      if (kind === 'PARSE-OK') continue;

      // AST-VALID：还要通过完整函数合法性校验
      const v = validateAttackFunction(parsed.ast, DOC_DOMAIN, DOC_SHOOTER);
      if (!v.valid) {
        failures.push(`${label}\n      应通过函数校验，实际 ${v.issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
      }
    }
  }

  assert(checked >= 10, `文档示例数量异常（只找到 ${checked} 个），标记可能被破坏`);
  assertEqual(failures, [], `文档示例未通过真实判定:\n  ${failures.join('\n  ')}`);
});

// ============================================================================
// §9 JSON_SCHEMA 的机器可读块必须与真实样例一致
// ============================================================================

test('competitor-kit: JSON_SCHEMA 的字段表与真实样例键集合一致', () => {
  const md = readDoc('JSON_SCHEMA.md');
  const block = md.match(/```json\n([\s\S]*?)\n```/);
  assert(block, 'JSON_SCHEMA.md 必须包含机器可读的 ```json 块');
  const schema = JSON.parse(block![1]);

  const publicState = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'public_state.json'), 'utf-8'));
  const revealState = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'reveal_state.json'), 'utf-8'));
  const result = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'result.json'), 'utf-8'));

  assertEqual(Object.keys(publicState).sort(), [...schema.public_state.required].sort(), 'public_state 顶层键应等于字段表');
  assertEqual(Object.keys(publicState.map).sort(), [...schema.public_state.map_fields].sort(), 'map 键应等于字段表');
  assertEqual(Object.keys(publicState.points[0]).sort(), [...schema.public_state.point_fields].sort(), 'point 键应等于字段表');
  // Rule Revision 3 §6：固定 Emitter 在 public 里，字段表必须随之更新
  assertEqual(Object.keys(publicState.emitters).sort(), [...schema.public_state.emitter_fields].sort(), 'emitters 键应等于字段表');
  assertEqual(Object.keys(publicState.emitters.A).sort(), [...schema.public_state.emitter_point_fields].sort(), 'emitters.A 键应等于字段表');
  assert(!publicState.points.some((p: { id: string }) => p.id === 'A0' || p.id === 'B0'), 'points 里不得出现 Emitter（它不是战斗点）');
  for (const forbidden of schema.public_state.forbidden) {
    assert(!(forbidden in publicState), `public_state 不得含 ${forbidden}`);
  }

  assertEqual(Object.keys(revealState).sort(), [...schema.reveal_state.required].sort(), 'reveal_state 顶层键应等于字段表');
  // Rule Revision 3 §5/§6：reveal 不再承担 Shooter/Emitter，只补障碍物
  assert(!('shooters' in revealState), 'reveal_state 不得再含 shooters（§5 已删除 Shooter Selection）');
  assert(!('emitters' in revealState), 'emitters 属 public_state，不得出现在 reveal_state');
  for (const ob of revealState.obstacles) {
    const expected = ob.type === 'circle'
      ? schema.reveal_state.obstacle_circle_fields
      : schema.reveal_state.obstacle_rectangle_fields;
    assertEqual(Object.keys(ob).sort(), [...expected].sort(), `${ob.type} 障碍物键应等于字段表`);
  }

  assertEqual(Object.keys(result).sort(), [...schema.result.only_keys].sort(), 'result.json 只允许 schema_version + dsl');
});

test('competitor-kit: 官方 reveal_state 的障碍物形态必须与文档一致（§8 防漂移）', () => {
  // 为什么单独钉这一条，而不是靠 examples 的键集合比对：
  //
  // 算法侧现在有一份**兼容读取器**（demo 的 `gb_world`）同时接受两种形状 ——
  //   · 协议形态      {"type":"circle","cx":…,"cy":…,"radius":…}
  //   · 平台内部形态  {"type":"circle","center":[x,y],"radius":…}
  // 兼容读取器本身没问题（回放帧里存的确实是内部形态），但它会诱导一种
  // 「顺手统一」：既然两边都能读，那把官方输出也改成内部形态算了。
  // 那会改掉 reveal_state 的**字节**，进而改掉 `public_state_sha256`、
  // `roundStateHash`，以及所有历史回放的可复核性。
  //
  // examples 那条只在样例被重新生成时才会发现漂移；这条直接对着
  // `buildRevealState` 的真实输出断言，不经过任何 fixture。
  const md = readDoc('JSON_SCHEMA.md');
  const block = md.match(/```json\n([\s\S]*?)\n```/);
  assert(block, 'JSON_SCHEMA.md 必须包含机器可读的 ```json 块');
  const schema = JSON.parse(block![1]);

  const pub = buildPublicState({
    matchId: 'ANTI-DRIFT',
    round: 1,
    points: [{ id: 'A1', team: 'A', x: -14, y: 6, alive: true }],
  });
  const rev = buildRevealState({
    matchId: 'ANTI-DRIFT',
    round: 1,
    publicStateSha256: pub.sha256,
    obstacles: [
      { type: 'circle', center: [4, 3], radius: 2 },
      { type: 'rectangle', xmin: -1, xmax: 2, ymin: -5, ymax: 1 },
    ],
  });
  const obstacles = (JSON.parse(rev.json) as { obstacles: Record<string, unknown>[] }).obstacles;

  for (const ob of obstacles) {
    const expected =
      ob.type === 'circle'
        ? schema.reveal_state.obstacle_circle_fields
        : schema.reveal_state.obstacle_rectangle_fields;
    assertEqual(
      Object.keys(ob).sort(),
      [...expected].sort(),
      `官方 reveal_state 的 ${ob.type} 键必须等于文档字段表 —— 兼容读取器能读内部形态，` +
        '**不代表**官方输出可以改成内部形态'
    );
  }

  // 圆必须是扁平的 cx/cy，绝不能残留内部的 center —— 这条是上面那条的名字版
  const circle = obstacles.find((o) => o.type === 'circle')!;
  assert('cx' in circle && 'cy' in circle, 'circle 必须写扁平 cx / cy');
  assert(!('center' in circle), 'circle 不得出现内部形态的 center 字段');
  // 而且字节里也不能有（键集合比对会被「两种都写」绕过）
  assert(!rev.json.includes('"center"'), 'reveal_state 的字节里不得出现 "center"');
});

// ============================================================================
// §10 examples 防漂移 + 必须通过当前 Validator
// ============================================================================

test('competitor-kit: examples 可重新生成且逐字节一致（防漂移）', async () => {
  const work = tmpDir('kit-examples');
  const regenerated = await generateKitExamples(work);

  const onDisk = {
    publicJson: fs.readFileSync(path.join(KIT, 'examples', 'public_state.json'), 'utf-8'),
    revealJson: fs.readFileSync(path.join(KIT, 'examples', 'reveal_state.json'), 'utf-8'),
    resultJson: fs.readFileSync(path.join(KIT, 'examples', 'result.json'), 'utf-8'),
  };
  assertEqual(
    regenerated.publicJson === onDisk.publicJson,
    true,
    'examples/public_state.json 与真实引擎重新生成的字节不一致（请运行 npx ts-node src/operator/generate-kit-examples.ts）'
  );
  assertEqual(regenerated.revealJson === onDisk.revealJson, true, 'examples/reveal_state.json 已漂移');
  assertEqual(regenerated.resultJson === onDisk.resultJson, true, 'examples/result.json 已漂移');
});

test('competitor-kit: examples/result.json 通过当前 Validator', () => {
  const raw = fs.readFileSync(path.join(KIT, 'examples', 'result.json'), 'utf-8');
  const obj = JSON.parse(raw);
  assertEqual(obj.schema_version, '1.1', 'schema_version 必须为 1.1');
  const parsed = parseCanonicalDSL(typeof obj.dsl === 'string' ? obj.dsl : JSON.stringify(obj.dsl));
  assert(parsed.ok && parsed.ast, `示例 DSL 必须合法: ${parsed.issues.map((i) => i.code).join(',')}`);

  // 示例的发射锚点是 public_state 里的**固定 Emitter**（Rule Revision 3 §4/§6）
  const publicState = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'public_state.json'), 'utf-8'));
  const emitter = publicState.emitters.A;
  assert(emitter && typeof emitter.x === 'number', '示例必须能在 public_state.emitters 里取到 A 的锚点');
  const v = validateAttackFunction(parsed.ast!, firingDomain(emitter.x, 'A'), { x: emitter.x, y: emitter.y });
  assert(v.valid, `示例函数必须通过校验: ${v.issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
});

// ============================================================================
// §20 starter：与平台 starter 同源，且干净参赛者首跑即过
// ============================================================================

test('competitor-kit: kit starter 与平台 starter 逐字节相同（防漂移）', () => {
  for (const name of ['solver.py', 'manifest.json']) {
    const a = fs.readFileSync(path.join(STARTER_SRC, name));
    const b = fs.readFileSync(path.join(KIT, 'starter', name));
    assert(a.equals(b), `competitor-kit/starter/${name} 与平台 starter 不一致`);
  }
});

test('competitor-kit: 干净参赛者复制 starter → 本地自检首次 PASS', async () => {
  const mine = tmpDir('fresh-competitor');
  fs.cpSync(path.join(KIT, 'starter'), mine, { recursive: true });

  const report = await validateSubmission(mine);
  const failures = report.teams.flatMap((t) =>
    t.checks.filter((c) => c.status === 'FAIL').map((c) => `${t.team}/${c.section}: ${c.errors.join('; ')}`)
  );
  assertEqual(failures, [], `starter 复制后自检应全 PASS:\n  ${failures.join('\n  ')}`);
  assert(report.ok, '本地自检应返回 ok');
});

test('competitor-kit: 干净参赛者复制 starter → 官方 Preflight PASS', async () => {
  const mine = tmpDir('fresh-competitor-official');
  fs.cpSync(path.join(KIT, 'starter'), mine, { recursive: true });
  assert(inspectPackage(mine).valid, '复制出来的包必须是合法算法包');

  const root = tmpDir('kit-preflight');
  const engine = new MatchEngine({
    matchId: 'KIT-OFFICIAL-PREFLIGHT',
    seed: 90210,
    pointCount: 8,
    difficulty: 'medium',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  const upA = engine.upload('A', mine);
  assert(upA.ok, `上传 A 失败: ${upA.errors.join('; ')}`);
  const upB = engine.upload('B', mine);
  assert(upB.ok, `上传 B 失败: ${upB.errors.join('; ')}`);

  const pre = await engine.preflight();
  assert(pre.ok, `官方 Preflight 应通过: ${pre.errors.join('; ')}`);
  const detail = pre.detail as { A: { valid: boolean }; B: { valid: boolean } };
  assertEqual(detail.A.valid, true, 'A 侧 DSL 应合法');
  assertEqual(detail.B.valid, true, 'B 侧 DSL 应合法');
});

// ============================================================================
// I-1：文档承诺的「自带 .py 模块 / utils/ 子目录」必须真的能用
// ============================================================================

/** 按 ALGORITHM_REQUIREMENTS.md §1 的措辞原样写一个多文件包（含 utils/ 子目录） */
function writeMultiFilePackage(dir: string): void {
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    [
      '"""多文件算法包：入口 + 同级模块 + utils/ 子目录（不自行改 sys.path）。"""',
      'import argparse, hashlib, json, os, sys',
      '',
      'from strategy import build_function',            // 同级模块
      'from utils.helper import alive_enemies, shooter_of',  // 子目录模块
      '',
      'def main():',
      '    ap = argparse.ArgumentParser()',
      '    ap.add_argument("--team", required=True)',
      '    ap.add_argument("--public", required=True)',
      '    ap.add_argument("--reveal", required=True)',
      '    ap.add_argument("--output", required=True)',
      '    args = ap.parse_args()',
      '    with open(args.public, "rb") as f:',
      '        raw = f.read()',
      '    public = json.loads(raw.decode("utf-8"))',
      '    with open(args.reveal, "r") as f:',
      '        reveal = json.load(f)',
      '    if reveal.get("public_state_sha256") != hashlib.sha256(raw).hexdigest():',
      '        raise SystemExit(2)',
      '    dsl = build_function(shooter_of(public, reveal, args.team),',
      '                        alive_enemies(public, args.team))',
      '    tmp = args.output + ".tmp"',
      '    with open(tmp, "w", encoding="utf-8") as f:',
      '        json.dump({"schema_version": "1.1", "dsl": dsl}, f)',
      '        f.flush()',
      '        os.fsync(f.fileno())',
      '    os.replace(tmp, args.output)',
      '    return 0',
      '',
      'if __name__ == "__main__":',
      '    sys.exit(main())',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(dir, 'strategy.py'),
    [
      '"""策略层：构造经过 Shooter 的直线 f(x) = y_s + m*(x - x_s)。"""',
      '',
      'def _num(v):',
      '    return {"type": "number", "value": v}',
      '',
      'def build_function(shooter, enemies):',
      '    sx, sy = shooter["x"], shooter["y"]',
      '    if enemies:',
      '        t = min(enemies, key=lambda p: (abs(p["y"] - sy), (p["x"] - sx) ** 2))',
      '        tx, ty = t["x"], t["y"]',
      '    else:',
      '        tx, ty = sx, sy',
      '    dx, dy = tx - sx, ty - sy',
      '    slope = 0.0 if abs(dx) < 1e-6 else max(-2.0, min(2.0, dy / dx))',
      '    return {"type": "add", "args": [_num(sy), {"type": "mul", "args": [',
      '        _num(slope), {"type": "sub", "args": [',
      '            {"type": "variable", "value": "x"}, _num(sx)]}]}]}',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(dir, 'utils', 'helper.py'),
    [
      '"""输入查询工具。"""',
      '',
      'def shooter_of(public, reveal, team):',
      '    by_id = {p["id"]: p for p in public["points"]}',
      '    return public["emitters"][team]',
      '',
      'def alive_enemies(public, team):',
      '    return [p for p in public["points"] if p["team"] != team and p.get("alive", True)]',
      '',
    ].join('\n')
  );
}

test('competitor-kit: 多文件包（同级模块 + utils/ 子目录）首次自检即 PASS（I-1）', async () => {
  const mine = tmpDir('multi-file-competitor');
  writeMultiFilePackage(mine);

  assert(inspectPackage(mine).valid, '多文件包必须是合法算法包');
  const report = await validateSubmission(mine);
  const failures = report.teams.flatMap((t) =>
    t.checks.filter((c) => c.status === 'FAIL').map((c) => `${t.team}/${c.section}: ${c.errors.join('; ')}`)
  );
  assertEqual(
    failures,
    [],
    `多文件包自检应全 PASS（不自行改 sys.path 也必须能 import 包内模块）:\n  ${failures.join('\n  ')}`
  );
});

// ============================================================================
// §13 CRASH 必须保留根因（头 + 尾）
// ============================================================================

interface CrashCase {
  name: string;
  solver: string;
  /** 必须在报错里出现的根因标记 */
  marker: string;
  /** 期望的异常类型名 */
  kind: string;
}

const ARGV_PRELUDE = `import argparse, json, os, sys
ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True)
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
ap.add_argument("--output", required=True)
args = ap.parse_args()
`;

const CRASH_CASES: CrashCase[] = [
  {
    name: '缺失模块',
    marker: 'no_such_module_xyz',
    kind: 'ModuleNotFoundError',
    solver: `${ARGV_PRELUDE}import no_such_module_xyz\n`,
  },
  {
    name: '运行时异常',
    marker: 'BOOM-MARKER',
    kind: 'RuntimeError',
    solver: `${ARGV_PRELUDE}raise RuntimeError("BOOM-MARKER")\n`,
  },
  {
    name: '语法错误',
    marker: 'syntax',
    kind: 'SyntaxError',
    solver: `${ARGV_PRELUDE}def broken(:\n    pass\n`,
  },
  {
    name: '长 stderr 截断后仍保留根因',
    marker: 'TAIL-ROOT-CAUSE',
    kind: 'RuntimeError',
    solver: `${ARGV_PRELUDE}
for i in range(400):
    sys.stderr.write("noise line %d " % i + "x" * 40 + "\\n")
raise RuntimeError("TAIL-ROOT-CAUSE")
`,
  },
];

async function runCrashCase(c: CrashCase): Promise<{ error: string; errorCode: string | null }> {
  const pkgDir = tmpDir('crash-pkg');
  fs.writeFileSync(path.join(pkgDir, 'solver.py'), c.solver, 'utf-8');

  const points = [
    { id: 'A1', team: 'A' as const, x: -12, y: 3, alive: true },
    { id: 'B1', team: 'B' as const, x: 12, y: -3, alive: true },
  ];
  const pub = buildPublicState({ matchId: 'CRASH', round: 0, points });
  const rev = buildRevealState({
    matchId: 'CRASH',
    round: 0,
    publicStateSha256: pub.sha256,
    obstacles: [],
  });
  const sandbox = prepareSandbox({
    sandboxRoot: tmpDir('crash-root'),
    matchId: 'CRASH',
    roundNumber: 0,
    team: 'A',
    packageDir: pkgDir,
    entry: 'solver.py',
    input: { publicJson: pub.json, revealJson: rev.json },
    memoryLimitMb: 512,
  });
  try {
    const runner = spawnRunner({ team: 'A', sandbox, timeoutMs: 10_000, memoryLimitMb: 512 });
    runner.release();
    const outcome = await runner.done;
    return { error: outcome.error ?? '', errorCode: outcome.errorCode };
  } finally {
    cleanupSandbox(sandbox.dir);
  }
}

for (const c of CRASH_CASES) {
  test(`competitor-kit: CRASH 报错保留根因 — ${c.name}（§13）`, async () => {
    const { error, errorCode } = await runCrashCase(c);
    assertEqual(errorCode, 'CRASH', `${c.name} 应报 CRASH`);
    assert(
      error.includes(c.kind),
      `${c.name} 的报错必须包含异常类型 ${c.kind}，实际:\n${error.slice(0, 400)}`
    );
    assert(
      error.includes(c.marker),
      `${c.name} 的报错必须包含根因标记 ${c.marker}，实际:\n${error.slice(0, 400)}`
    );
    // 有界性：截断后总长不得突破预算（1000 + 前缀）
    assert(error.length <= 1100, `${c.name} 的报错长度 ${error.length} 超出预算`);
    if (c.name.startsWith('长 stderr')) {
      assert(error.includes('已省略'), '长 stderr 必须出现省略标记');
    }
  });
}

// ============================================================================
// §23 面向选手的文档必须与引擎常量同步（Rule Revision 3）
//
// 这一条的存在理由：Revision 3 把预算从 2000ms 收到 500ms、把每轮选出的
// Shooter 换成固定 Emitter，但**没有任何套件在看着这些数字** ——
// 于是 4 处「2000 ms」与 2 处「reveal.shooters」一路漂到最终审计才被发现。
// ============================================================================

test('competitor-kit: 面向选手的文档与 Revision 3 常量一致（防再次漂移）', () => {
  // 先钉死冻结值本身（此前零覆盖）
  assertEqual(COMPUTE_TIMEOUT_MS, 500, '单轮计算预算必须是 500ms（Rule Revision 3 §11）');
  assertEqual(STALEMATE_NO_PROGRESS_LIMIT, 20, 'STALEMATE 必须是连续 20 回合零击杀');
  assertEqual(HARD_ROUND_LIMIT, 60, 'HARD_ROUND_LIMIT 必须是第 60 回合');

  const kitDocs = ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'RUNTIME_MANIFEST.md', 'DSL_SPECIFICATION.md', 'JSON_SCHEMA.md', 'starter/solver.py'];
  const targets: Array<[string, string]> = kitDocs.map((f) => [
    `competitor-kit/${f}`,
    fs.readFileSync(path.join(KIT, f), 'utf-8'),
  ]);
  targets.push(['README.md(仓库根)', fs.readFileSync(path.join(PLATFORM_ROOT, 'README.md'), 'utf-8')]);
  // `algorithms/README.md` 是**投递者最可能打开的那一份**（它就在被描述的目录里）。
  // 它在 388dd0d 之前一直是漏网的：给它加一句错误的 2000 ms，本套件曾经全绿。
  targets.push(['algorithms/README.md', fs.readFileSync(path.join(ALGORITHMS_DIR, 'README.md'), 'utf-8')]);

  for (const [name, text] of targets) {
    assert(!/2000\s*ms/.test(text), `${name} 不得再出现 2000 ms（引擎是 500 ms）`);
    assert(!/NOT YET IMPLEMENTED/i.test(text), `${name} 不得再声称规则未实现`);
    assert(!/reveal\[["']shooters["']\]/.test(text), `${name} 不得再教选手从 reveal 取 shooters`);
    assert(!/shooters\s*\{\s*A\s*,\s*B\s*\}/.test(text), `${name} 不得再声称 reveal 含 shooters{A,B}`);
  }

  // 正向对照：文档必须**真的**写了正确的东西，否则「全都不提」也会全绿
  const kitReadme = fs.readFileSync(path.join(KIT, 'README.md'), 'utf-8');
  const rootReadme = fs.readFileSync(path.join(PLATFORM_ROOT, 'README.md'), 'utf-8');
  assert(/500\s*ms/.test(kitReadme), 'competitor-kit/README.md 必须写明 500 ms');
  assert(/500\s*ms/.test(rootReadme), '仓库 README 必须写明 500 ms');
  assert(/emitters/.test(rootReadme), '仓库 README 必须写明 emitters（固定 Emitter 在 public 里）');
  assert(/STALEMATE/.test(kitReadme), 'competitor-kit/README.md 必须写明 STALEMATE 规则');
  assert(/STALEMATE/.test(rootReadme), '仓库 README 必须写明 STALEMATE 规则');
  assert(/HARD_ROUND_LIMIT|第 60 回合/.test(rootReadme), '仓库 README 必须写明硬回合上限');

  // ---- 槽位语义：投递点是运行期槽位根，不是仓库里的 canonical ----
  // 这条防的是 Re-Gate 抓到的那类事故：把投递点改对了，文档却还在教选手
  // 往 `algorithms/` 投 —— 比赛于是静默跑另一份算法。
  assert(/runs\/slots/.test(rootReadme), '仓库 README 必须写明运行期槽位根 runs/slots（正式投递点）');
  assert(/出厂 fixture/.test(rootReadme), '仓库 README 必须写明 algorithms/ 只是出厂 fixture');
  assert(/投递点/.test(rootReadme), '仓库 README 必须点明「投递点」这个概念');

  // ---- canonical 槽位目录自己的 README 必须讲对语义（Final Tag Re-Gate 的缺口）----
  // 它在被描述的目录里，是投递者最可能先打开的一份 —— 教错方向的代价是
  // 「投进去被静默忽略、比赛拿出厂 starter 跑完」。
  const algorithmsReadme = fs.readFileSync(path.join(ALGORITHMS_DIR, 'README.md'), 'utf-8');
  assert(
    /runs\/slots/.test(algorithmsReadme),
    'algorithms/README.md 必须写明运行期槽位根 runs/slots（正式投递点）'
  );
  assert(
    !/唯一算法投放区|唯一算法投放点/.test(algorithmsReadme),
    'algorithms/README.md 不得再自称「唯一算法投放区」—— 它只是出厂 fixture'
  );
  assert(
    /不是投递点/.test(algorithmsReadme),
    'algorithms/README.md 必须明确写出「本目录不是投递点」'
  );
  assert(
    /出厂 fixture/.test(algorithmsReadme),
    'algorithms/README.md 必须写明自己是出厂 fixture'
  );
  // 当前 timeout 语义不得漂移：这里是 500 ms，且必须说清起算点
  assert(/500\s*ms/.test(algorithmsReadme), 'algorithms/README.md 必须写明 500 ms 预算');
  assert(/GO/.test(algorithmsReadme), 'algorithms/README.md 必须写明预算从 GO 起算');
  assert(!/2000/.test(algorithmsReadme), 'algorithms/README.md 不得再出现 2000');

  // 根 README 的项目结构树同样要讲对：`algorithms/` 不得再被注为「槽位」。
  const treeBlock = rootReadme.slice(rootReadme.indexOf('## 项目结构'), rootReadme.indexOf('## 本地 Web UI 的边界'));
  assert(/runs\//.test(treeBlock), '项目结构树里必须出现 runs/（运行期槽位根）');
  assert(
    !/algorithms\/\s*#\s*固定算法槽位/.test(treeBlock),
    '项目结构树不得再把 algorithms/ 注为「固定算法槽位」'
  );

  // ---- 现行 CLI / 工具的文案同样面向选手，一并纳入防漂移 ----
  for (const f of ['validate-submission.ts', 'generate-kit-examples.ts', 'cli.ts', 'judge.ts']) {
    const t = fs.readFileSync(path.join(PLATFORM_ROOT, 'src', 'operator', f), 'utf-8');
    assert(!/2000/.test(t), `src/operator/${f} 不得再出现 2000（引擎是 500ms）`);
    assert(
      !/固定槽位 algorithms\/team-a/.test(t),
      `src/operator/${f} 不得再声称默认槽位是 algorithms/team-a|team-b`
    );
  }
});

test('competitor-kit: 文档不得再把 Emitter 写成平台常量（V1.2 §一）', () => {
  // V1.2 把锚点从「平台常量」改成了「各队开赛前自选并锁定」。
  // 选手手册若不跟着改，会教人写出写死 -18 的算法 —— 那能通过 Preflight
  // （decoy 世界仍用常量），却在正赛第一轮就 NOT_THROUGH_SHOOTER。
  const docs = ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'DSL_SPECIFICATION.md', 'JSON_SCHEMA.md'];
  const textOf = (f: string): string => fs.readFileSync(path.join(KIT, f), 'utf-8');

  /** 这些是已经作废的 V1.1 原句，一个字都不许再出现 */
  const stalePhrases = [
    /Emitter\s*坐标是\s*\*\*常量\*\*/,
    /Emitter\s*是\s*常量/,
    /发射锚点[^\n]{0,20}里的\*\*常量\*\*/,
    /\|\s*\*\*固定 Emitter\*\*\s*\|\s*A：`\(-18,\s*0\)`/,
  ];
  for (const f of docs) {
    const text = textOf(f);
    for (const re of stalePhrases) {
      assert(!re.test(text), `competitor-kit/${f} 仍把 Emitter 写成常量：${re}`);
    }
  }

  // 正向对照：必须**真的**教会选手从 public_state 读锚点，
  // 否则「整篇不提」也会全绿。
  for (const f of ['README.md', 'ALGORITHM_REQUIREMENTS.md', 'JSON_SCHEMA.md']) {
    assert(
      /public_state\.emitters|`emitters`/.test(textOf(f)),
      `competitor-kit/${f} 必须写明 Emitter 从 public_state.emitters 读`
    );
  }

  // 选手手册必须讲清楚 decoy 锚点的语义：它是**decoy 地图上的点**，不是平台常量，
  // 因此写死坐标会在本地自检 / Preflight 就 FAIL。这句话是防止选手
  // 「本地都过了」却在正赛每轮 INVALID 的关键提示。
  const req = textOf('ALGORITHM_REQUIREMENTS.md');
  assert(/Preflight/.test(req) && /decoy/.test(req), '选手手册必须解释 Preflight 用的是 decoy 世界');
  assert(
    /写死/.test(req) && /decoy 地图/.test(req),
    '选手手册必须点明「decoy 锚点取自 decoy 地图，写死坐标会被拦下」'
  );
});

// ============================================================================
// V1.4 §6.2：坐标方向 / 数组顺序 / 双侧兼容必须写进选手手册，且措辞可被机器核对
//
// 这一节的存在理由：引擎里 A 向 +x、B 向 −x、points 先 A 后 B 按生成顺序、Emitter 编号
// 被移除且不重新编号 —— 这些事实一直成立，但此前没有一份选手文档把它们说全，
// JSON_SCHEMA 甚至写着「编号会随击杀减少」（与代码相反）。措辞一旦被「顺手精简」掉，
// 选手就会重新写出只会打 Team A 的算法。所以这里钉的是**原句**，不是「大意」。
// ============================================================================

test('competitor-kit: 手册写明坐标方向 / 数组顺序 / 双侧兼容，中英文原句都在（V1.4 §6.2）', () => {
  const req = readDoc('ALGORITHM_REQUIREMENTS.md');
  const schema = readDoc('JSON_SCHEMA.md');
  const kitReadme = readDoc('README.md');
  const rootReadme = fs.readFileSync(path.join(PLATFORM_ROOT, 'README.md'), 'utf-8');

  // 章节本身（双语标题）
  assert(/## 6\.2 坐标方向与镜像 \/ Orientation & Symmetry/.test(req), 'ALGORITHM_REQUIREMENTS 必须有 §6.2「坐标方向与镜像 / Orientation & Symmetry」');

  // 前进方向：中英文各一句，A / B 都要
  assert(req.includes('Team A 的前进方向 = x 增大'), '手册必须写明「Team A 的前进方向 = x 增大」');
  assert(req.includes('Team B 的前进方向 = x 减小'), '手册必须写明「Team B 的前进方向 = x 减小」');
  assert(req.includes('Team A forward direction = increasing x'), '手册必须写明 "Team A forward direction = increasing x"');
  assert(req.includes('Team B forward direction = decreasing x'), '手册必须写明 "Team B forward direction = decreasing x"');

  // 数组顺序警告：中英文原句
  const ORDER_ZH = '不要假设数组顺序代表 x 从小到大、离 Emitter 从近到远，或任何其它几何排序。';
  const ORDER_EN = 'Do not assume array order is geometric order.';
  assert(req.includes(ORDER_ZH), `手册必须原句写出「${ORDER_ZH}」`);
  assert(req.includes(ORDER_EN), `手册必须原句写出 "${ORDER_EN}"`);
  assert(schema.includes(ORDER_ZH), 'JSON_SCHEMA §4 必须原句写出数组顺序警告（中文）');
  assert(schema.includes(ORDER_EN), 'JSON_SCHEMA §4 必须原句写出数组顺序警告（英文）');
  // 顺序保证本身也要写出来，否则「全都不保证」也能让上面那句成立
  assert(/先是 Team A 的全部条目，再是 Team B 的全部条目/.test(req), '手册必须写明 points 先 A 组后 B 组');
  assert(/不重新编号/.test(req) && /`A1` 可能/.test(req), '手册必须写明 Emitter 编号被移除且不重新编号（A1 可能缺席）');
  assert(/O1\.\.On/.test(req), '手册必须写明 obstacles 按生成顺序编号 O1..On');

  // 双侧兼容 MUST：中英文原句，且进入 §11 表与 §17 清单
  const BOTH_ZH = '同一正式提交必须能够在 Team A 与 Team B 两侧正确运行。';
  const BOTH_EN = 'The same formal submission MUST run correctly as Team A and as Team B.';
  assert(req.includes(BOTH_ZH), `手册必须原句写出「${BOTH_ZH}」`);
  assert(req.includes(BOTH_EN), `手册必须原句写出 "${BOTH_EN}"`);
  // 中文是「必须」，英文不得退化成 may（可能性陈述）—— 三处文档一起盯
  for (const [name, text] of [['ALGORITHM_REQUIREMENTS', req], ['competitor-kit/README', kitReadme], ['README', rootReadme]] as const) {
    assert(!/may run as Team A or Team B/.test(text), `${name} 的英文半边不得把 MUST 写成 "may run as Team A or Team B"`);
  }
  // 两侧都失败也记 FAIL：手册与 kit README 都得写明，免得参赛者把它当镜像问题
  assert(/两侧都失败同样记 `FAIL`/.test(req) && /both sides failing is also\s+`FAIL`/.test(req), '手册 §6.2.3 必须写明两侧都失败同样记 FAIL（中英）');
  assert(/两侧都失败同样记 `FAIL`/.test(kitReadme) && /both sides failing is also `FAIL`/.test(kitReadme), 'kit README §5.1 必须写明两侧都失败同样记 FAIL（中英）');
  assert(/\| M15 \| 同一正式提交必须能够在 Team A 与 Team B 两侧正确运行/.test(req), '§11 MUST 表必须有双侧兼容那一行（M15）');
  assert(/\[ \] [^\n]*check_mirror\.py/.test(req), '§17 提交前清单必须包含 check_mirror.py');

  // Team B 的 DSL 示例要真的存在（且只标 PARSE-OK：AST-VALID 是按 Team A 锚点校验的）
  assert(/Team B 的直线示例[\s\S]{0,300}<!-- AST-PARSE-OK -->/.test(req), '手册必须给出标为 AST-PARSE-OK 的 Team B 示例');

  // JSON_SCHEMA 不得再说编号「会随击杀减少」—— 与代码相反（击杀只翻 alive，条目与编号都不动）
  assert(!schema.includes('会随击杀减少'), 'JSON_SCHEMA 不得再写「会随击杀减少」');
  assert(/Array-order guarantees/.test(schema), 'JSON_SCHEMA 必须有「数组顺序保证 / Array-order guarantees」');

  // 工具索引与「诊断而非规则」的定性
  assert(/\| \[tools\/check_mirror\.py\]\(tools\/check_mirror\.py\) \|/.test(kitReadme), 'competitor-kit/README.md §2 文件索引必须有 tools/check_mirror.py 那一行');
  assert(/官方 Preflight 不运行它/.test(kitReadme), 'competitor-kit/README.md 必须说明官方 Preflight 不运行镜像自检');
  assert(/the official Preflight does not run it/.test(kitReadme), 'competitor-kit/README.md 的英文半边也要说明官方 Preflight 不运行镜像自检');

  // 仓库根 README 的「场地与判定」两半都要讲遍历方向与数组顺序
  assert(/不要假设数组顺序代表几何顺序/.test(rootReadme), '仓库 README（中文）必须写明不要假设数组顺序代表几何顺序');
  assert(rootReadme.includes(ORDER_EN.replace(/\.$/, '')), '仓库 README（英文）必须写明 Do not assume array order is geometric order');
  assert(/遍历方向/.test(rootReadme) && /Traversal direction/.test(rootReadme), '仓库 README 两半都必须写明遍历方向');
  assert(/check_mirror\.py/.test(rootReadme), '仓库 README 必须列出 check_mirror.py');
});

// ============================================================================
// V1.4 §6.2.3：镜像自检工具本身 —— 对称算法 PASS / 只会打 Team A 的算法 FAIL
// ============================================================================

const CHECK_MIRROR = path.join(PLATFORM_ROOT, 'src', 'operator', 'check-mirror.ts');

interface MirrorCliResult {
  status: number | null;
  /** `--json` 的完整报告（与内核导出的 MirrorReport 同一形态），解析失败为 null */
  report: MirrorReport | null;
  stderr: string;
}

/** 走参赛者会走的那条路（CLI 进程 + 退出码），沙箱根目录落在临时目录 */
function runCheckMirrorCli(dir: string): MirrorCliResult {
  const r = spawnSync(
    'npx',
    ['ts-node', CHECK_MIRROR, dir, '--json', '--sandbox-root', tmpDir('mirror-sandbox')],
    { cwd: PLATFORM_ROOT, encoding: 'utf8' }
  );
  let report: MirrorCliResult['report'] = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = null;
  }
  return { status: r.status, report, stderr: r.stderr };
}

test('competitor-kit: check_mirror 对镜像对称的算法（precision-line）报 PASS，退出码 0', () => {
  const dir = path.join(PLATFORM_ROOT, 'tests', 'fixtures', 'algos', 'precision-line');
  const { status, report, stderr } = runCheckMirrorCli(dir);
  assert(report, `check-mirror 应输出 JSON 报告，stderr:\n${stderr.slice(0, 600)}`);
  assertEqual(status, 0, `对称算法的退出码应为 0（verdict=${report!.verdict}）`);
  assertEqual(report!.pairs.length, 2, '应有两对镜像比较');
  for (const p of report!.pairs) {
    assert(p.original.ok && p.mirror.ok, `两侧都应合法：${p.original.team}=${p.original.stage} / ${p.mirror.team}=${p.mirror.stage}`);
    assert(p.geometry, '两侧都合法时必须有几何比对');
  }
  // precision-line 的选目标 / 画线逻辑是按 |Δy| 与距离写的，与队别无关 —— 它应当**精确**对称
  assertEqual(report!.verdict, 'PASS', 'precision-line 应当是镜像对称的（PASS 而非 WARN）');
});

/**
 * 把「前进」写死成 +x 的 starter 变体：只在 x > x_e 的敌人里选目标（测试反例）。
 * Team A 侧毫无问题；Team B 侧一个敌人都筛不到 ——
 *   degenerateFallback=false：enemies[0] 抛 IndexError → CRASH（FAIL 路径）；
 *   degenerateFallback=true： 交出过 Emitter 的水平线 —— 合法但退化（WARN 路径，同一个 bug 的不崩溃形态）。
 */
function writeTeamAOnlySolver(dir: string, degenerateFallback: boolean): void {
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    [
      '"""只在 Team A 侧调试过的算法（测试反例）：前进方向写死为 +x。"""',
      'import argparse, hashlib, json, os, sys',
      '',
      'ap = argparse.ArgumentParser()',
      'ap.add_argument("--team", required=True, choices=["A", "B"])',
      'ap.add_argument("--public", required=True)',
      'ap.add_argument("--reveal", required=True)',
      'ap.add_argument("--output", required=True)',
      'a = ap.parse_args()',
      'raw = open(a.public, "rb").read()',
      'public = json.loads(raw.decode("utf-8"))',
      'reveal = json.load(open(a.reveal))',
      'if hashlib.sha256(raw).hexdigest() != reveal["public_state_sha256"]:',
      '    raise SystemExit(2)',
      's = public["emitters"][a.team]',
      'sx, sy = s["x"], s["y"]',
      '# 错误假设：敌人一定在 +x 方向',
      'enemies = [p for p in public["points"] if p["team"] != a.team and p["alive"] and p["x"] > sx]',
      ...(degenerateFallback
        ? ['if enemies:', '    t = enemies[0]', '    m = max(-2.0, min(2.0, (t["y"] - sy) / (t["x"] - sx)))', 'else:', '    m = 0.0']
        : ['t = enemies[0]', 'm = max(-2.0, min(2.0, (t["y"] - sy) / (t["x"] - sx)))']),
      'dsl = {"type": "add", "args": [{"type": "number", "value": sy}, {"type": "mul", "args": [',
      '    {"type": "number", "value": m},',
      '    {"type": "sub", "args": [{"type": "variable", "value": "x"}, {"type": "number", "value": sx}]}]}]}',
      'tmp = a.output + ".tmp"',
      'with open(tmp, "w", encoding="utf-8") as f:',
      '    json.dump({"schema_version": "1.1", "dsl": dsl}, f)',
      '    f.flush()',
      '    os.fsync(f.fileno())',
      'os.replace(tmp, a.output)',
      '',
    ].join('\n')
  );
}

test('competitor-kit: check_mirror 对只会打 Team A 的算法报 FAIL，退出码 1', () => {
  const mine = tmpDir('team-a-only');
  writeTeamAOnlySolver(mine, false);

  const { status, report, stderr } = runCheckMirrorCli(mine);
  assert(report, `check-mirror 应输出 JSON 报告，stderr:\n${stderr.slice(0, 600)}`);
  assertEqual(status, 1, `只会打 Team A 的算法退出码应为 1（verdict=${report!.verdict}）`);
  assertEqual(report!.verdict, 'FAIL', 'verdict 应为 FAIL');
  for (const p of report!.pairs) {
    assertEqual(p.status, 'FAIL', '两对都应 FAIL（B 侧在原世界与镜像世界里都崩）');
    assert(p.original.ok !== p.mirror.ok, '经典症状是「一侧合法、镜像侧失败」，而不是两侧都失败');
    const bad = p.original.ok ? p.mirror : p.original;
    assertEqual(bad.team, 'B', '失败的一侧必须是 Team B');
  }
});

test('competitor-kit: check_mirror 对「B 侧交退化函数」的只会打 Team A 算法报 WARN（退出码 0），并额外点名', () => {
  // 同一个 bug 的不崩溃形态：B 侧筛不到敌人就交一条过 Emitter 的水平线。两侧都合法，
  // 所以按契约只能是 WARN / 退出码 0 —— 但两对的结算（命中 / 阻挡 / 终止原因）都不一致，人类可读报告必须点名。
  const mine = tmpDir('team-a-degenerate');
  writeTeamAOnlySolver(mine, true);

  const { status, report, stderr } = runCheckMirrorCli(mine);
  assert(report, `check-mirror 应输出 JSON 报告，stderr:\n${stderr.slice(0, 600)}`);
  assertEqual(status, 0, `两侧都合法时退出码应为 0（verdict=${report!.verdict}）`);
  assertEqual(report!.verdict, 'WARN', 'verdict 应为 WARN（不是 FAIL：B 侧的函数是合法的）');
  for (const p of report!.pairs) {
    assert(p.original.ok && p.mirror.ok, `两侧都应合法：${p.original.team}=${p.original.stage} / ${p.mirror.team}=${p.mirror.stage}`);
    assert(p.judge && !p.judge.same, `配对 ${p.index} 的结算应不一致（A 侧瞄准敌人，B 侧水平线）`);
  }
  assert(judgeDiffersOnEveryPair(report!), 'judgeDiffersOnEveryPair 必须为 true');
  const text = formatReport(report!);
  assert(/MIRROR WARN/.test(text), '结论行应为 MIRROR WARN');
  assert(/不崩溃形态/.test(text) && /non-crashing form of the Team-A-only bug/.test(text), '人类可读报告必须点名「只会打 Team A」bug 的不崩溃形态（中英）');
  // 对照：真正对称的算法不该被点名
  const symmetric = runCheckMirrorCli(path.join(PLATFORM_ROOT, 'tests', 'fixtures', 'algos', 'precision-line')).report;
  assert(symmetric && !/不崩溃形态/.test(formatReport(symmetric)), '对称算法的报告不得出现「不崩溃形态」提示');
});

test('competitor-kit: check_mirror.py 前端只是转发（无参 → 用法 / 退出码 2；--help → 0）', () => {
  const tool = path.join(KIT, 'tools', 'check_mirror.py');
  const noArgs = spawnSync('python3', [tool], { cwd: PLATFORM_ROOT, encoding: 'utf8' });
  assertEqual(noArgs.status, 2, '无参数时应打印用法并以 2 退出');
  assert(/check-mirror\.ts/.test(noArgs.stderr), '用法说明必须指向 TS 内核（判定不在 Python 里）');
  const help = spawnSync('python3', [tool, '--help'], { cwd: PLATFORM_ROOT, encoding: 'utf8' });
  assertEqual(help.status, 0, '--help 应以 0 退出');
  assert(/开发诊断/.test(help.stderr) && /Preflight 不运行/.test(help.stderr), '前端说明必须点明它是开发诊断、官方 Preflight 不运行');
});

void runAll('competitor-kit');
