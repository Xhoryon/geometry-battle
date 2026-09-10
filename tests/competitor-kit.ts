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

import * as fs from 'fs';
import * as path from 'path';
import { parseCanonicalDSL, type ErrorCode } from '../src/core/Ast';
import { MatchEngine, PLATFORM_ROOT } from '../src/core/Match';
import { firingDomain } from '../src/core/Rules';
import { validateAttackFunction } from '../src/core/Validator';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import { cleanupSandbox, prepareSandbox, spawnRunner } from '../src/runner/SandboxRunner';
import { validateSubmission } from '../src/submission/LocalPreflight';
import { inspectPackage } from '../src/submission/Package';
import { generateKitExamples } from '../src/operator/generate-kit-examples';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const KIT = path.join(PLATFORM_ROOT, 'competitor-kit');
const STARTER_SRC = path.join(PLATFORM_ROOT, 'starter');

/** 文档示例的统一约定（DSL_SPECIFICATION.md §8）：Team A，S = (-14, 2) */
const DOC_SHOOTER = { x: -14, y: 2 };
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
  const suspicious: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      for (const pkg of unavailable) {
        if (!new RegExp(`\\b${pkg}\\b`).test(line)) continue;
        // 允许出现在「不可用 / 无 / 禁止 / NONE / 失败」等否定语境里
        const negated = /(不可用|不允许|禁止|无|NONE|none|失败|ModuleNotFoundError|无法|已修正|宿主观测|不要)/.test(line);
        if (!negated) {
          suspicious.push(`${path.relative(PLATFORM_ROOT, file)}:${i + 1} ${line.trim().slice(0, 90)}`);
        }
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
  for (const forbidden of schema.public_state.forbidden) {
    assert(!(forbidden in publicState), `public_state 不得含 ${forbidden}`);
  }

  assertEqual(Object.keys(revealState).sort(), [...schema.reveal_state.required].sort(), 'reveal_state 顶层键应等于字段表');
  assertEqual(Object.keys(revealState.shooters).sort(), [...schema.reveal_state.shooter_fields].sort(), 'shooters 键应等于字段表');
  for (const ob of revealState.obstacles) {
    const expected = ob.type === 'circle'
      ? schema.reveal_state.obstacle_circle_fields
      : schema.reveal_state.obstacle_rectangle_fields;
    assertEqual(Object.keys(ob).sort(), [...expected].sort(), `${ob.type} 障碍物键应等于字段表`);
  }

  assertEqual(Object.keys(result).sort(), [...schema.result.only_keys].sort(), 'result.json 只允许 schema_version + dsl');
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

  // 示例的 Shooter 取自 reveal_state 的 shooters.A
  const publicState = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'public_state.json'), 'utf-8'));
  const revealState = JSON.parse(fs.readFileSync(path.join(KIT, 'examples', 'reveal_state.json'), 'utf-8'));
  const shooter = publicState.points.find((p: { id: string }) => p.id === revealState.shooters.A);
  assert(shooter, '示例的 Shooter 必须能在 public_state.points 里找到');
  const v = validateAttackFunction(parsed.ast!, firingDomain(shooter.x, 'A'), { x: shooter.x, y: shooter.y });
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
      '    return by_id[reveal["shooters"][team]]',
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
    shooters: { A: 'A1', B: 'B1' },
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

void runAll('competitor-kit');
