/**
 * runtime-manifest —— Runtime Manifest 的永久核对（V1.1 Competitor Kit §5）
 *
 * 契约：
 *   Manifest 声称**可 import** 的模块，在正式沙箱内必须真的可以 import；
 *   Manifest 声称**不可用**的包，必须真的不可用；
 *   并且任何公开资料都不得再把这些包写成可用（本套件同时核对 `FROZEN_RUNTIME`）。
 *
 * 做法：生成一个探针算法包，在**真实沙箱**（与比赛同一套 `sandbox-exec` +
 * `scrubEnv` + bootstrap）里跑一遍，把结果打到 stderr，再与 Manifest 逐条比对。
 * 不使用宿主上的 `import` 结论 —— 宿主与沙箱并不等价（这正是 B-1 的根因）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import { FROZEN_RUNTIME } from '../src/submission/Runtime';
import { cleanupSandbox, prepareSandbox, spawnRunner } from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { PROBE_REPORT_PREFIX, probeReport } from './protocol-fixture';

const MANIFEST_PATH = path.join(__dirname, '..', 'competitor-kit', 'RUNTIME_MANIFEST.md');

interface Manifest {
  manifest_version: string;
  python: string;
  implementation: string;
  third_party_packages: string[];
  verified_importable: string[];
  importable_but_blocked: { module: string; reason: string }[];
  unavailable: string[];
}

function readManifest(): Manifest {
  const md = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  const block = md.match(/```json\n([\s\S]*?)\n```/);
  assert(block, 'RUNTIME_MANIFEST.md 必须包含机器可读的 ```json 块');
  try {
    return JSON.parse(block![1]) as Manifest;
  } catch (e) {
    throw new Error(`Manifest 的 JSON 块无法解析: ${(e as Error).message}`);
  }
}

interface ProbeReport {
  python: string;
  implementation: string;
  importable: string[];
  failed: Record<string, string>;
  fork: string;
  socket: string;
  subprocess: string;
  pythonnousersite: string | null;
  /** sys.path 里所有含 site-packages 的路径（用于证明用户级目录已被摘除） */
  site_paths: string[];
}

/** 探针结果缓存：四个用例共用一次沙箱运行（探针本身是纯读取） */
let cachedProbe: Promise<ProbeReport> | null = null;

function probeOnce(manifest: Manifest): Promise<ProbeReport> {
  if (cachedProbe === null) cachedProbe = probeSandboxRuntime(manifest);
  return cachedProbe;
}

/** 在真实沙箱里跑一次探针，返回它自报的运行时事实 */
async function probeSandboxRuntime(manifest: Manifest): Promise<ProbeReport> {
  const pkgDir = tmpDir('runtime-probe-pkg');
  const allModules = [
    ...manifest.verified_importable,
    ...manifest.importable_but_blocked.map((m) => m.module),
    ...manifest.unavailable,
  ];

  const probe = `import argparse, json, os, platform, sys
ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True)
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
ap.add_argument("--output", required=True)
args = ap.parse_args()

MODULES = ${JSON.stringify(allModules)}

report = {
    "python": platform.python_version(),
    "implementation": platform.python_implementation(),
    "importable": [],
    "failed": {},
}
for name in MODULES:
    try:
        __import__(name)
        report["importable"].append(name)
    except Exception as exc:
        report["failed"][name] = type(exc).__name__

def probe(fn):
    try:
        fn()
    except Exception as exc:
        return type(exc).__name__
    return "ALLOWED"

def probe_fork():
    pid = os.fork()
    if pid == 0:
        os._exit(0)          # 若 fork 竟然成功，子进程立刻退出，避免报告重复
    try:
        os.waitpid(pid, 0)
    except Exception:
        pass

def probe_connect():
    # 创建 socket 对象本身不触网；真正的网络访问发生在 connect。
    # 沙箱是 (deny network*)，因此这里必须是 PermissionError，
    # 而不是「连接被拒绝」——后者说明网络其实是通的。
    s = __import__("socket").socket()
    try:
        s.settimeout(2)
        s.connect(("127.0.0.1", 9))
    finally:
        s.close()

report["fork"] = probe(probe_fork)
report["socket"] = probe(probe_connect)
report["subprocess"] = probe(lambda: __import__("subprocess").run(["/bin/true"]))
report["pythonnousersite"] = os.environ.get("PYTHONNOUSERSITE")
# 用户级 site-packages 的典型路径形如 /Users/<user>/Library/Python/3.9/lib/python/site-packages。
# PYTHONNOUSERSITE=1 会把它从 sys.path 里摘掉 —— 这正是 numpy 在沙箱内不可用的根因。
report["site_paths"] = [p for p in sys.path if "site-packages" in p]

sys.stderr.write("${PROBE_REPORT_PREFIX}" + json.dumps(report) + "\\n")

tmp = args.output + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump({"schema_version": "1.1", "dsl": {"type": "number", "value": 0}}, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, args.output)
`;
  fs.writeFileSync(path.join(pkgDir, 'solver.py'), probe, 'utf-8');

  const points = [
    { id: 'A1', team: 'A' as const, x: -12, y: 3, alive: true },
    { id: 'B1', team: 'B' as const, x: 12, y: -3, alive: true },
  ];
  const publicState = buildPublicState({ matchId: 'RUNTIME-MANIFEST', round: 0, points });
  const revealState = buildRevealState({
    matchId: 'RUNTIME-MANIFEST',
    round: 0,
    publicStateSha256: publicState.sha256,
    obstacles: [],
  });

  const sandbox = prepareSandbox({
    sandboxRoot: tmpDir('runtime-probe-root'),
    matchId: 'RUNTIME-MANIFEST',
    roundNumber: 0,
    team: 'A',
    packageDir: pkgDir,
    entry: 'solver.py',
    input: { publicJson: publicState.json, revealJson: revealState.json },
    memoryLimitMb: 512,
  });

  try {
    const runner = spawnRunner({ team: 'A', sandbox, timeoutMs: 30_000, memoryLimitMb: 512 });
    await runner.ready;
    runner.release();
    const outcome = await runner.done;
    const parsed = probeReport(outcome.stderr);
    if (!parsed.python) {
      throw new Error(
        `探针未产出报告（errorCode=${outcome.errorCode}）\n${(outcome.error ?? '') + outcome.stderr.slice(-800)}`
      );
    }
    return parsed as unknown as ProbeReport;
  } finally {
    cleanupSandbox(sandbox.dir);
  }
}

test('runtime-manifest: Manifest 的 JSON 块结构完整', () => {
  const m = readManifest();
  assertEqual(m.manifest_version, '1.1', 'manifest_version 应为 1.1');
  assertEqual(m.third_party_packages.length, 0, '第三方包必须为 NONE（§4）');
  assert(m.verified_importable.length > 0, 'verified_importable 不应为空');
  assert(m.unavailable.length > 0, 'unavailable 不应为空');
  // Manifest 与冻结 Runtime 常量不得互相矛盾
  assertEqual(m.python, FROZEN_RUNTIME.python, 'Manifest 的 Python 版本应与 FROZEN_RUNTIME 一致');
  assertEqual(
    FROZEN_RUNTIME.packages.length,
    0,
    'FROZEN_RUNTIME.packages 必须为空（沙箱内无第三方包）'
  );
  assert(
    m.unavailable.includes('numpy') && m.unavailable.includes('scipy'),
    'Manifest 必须明确列出 numpy / scipy 不可用'
  );
});

test('runtime-manifest: 声称可 import 的模块在真实沙箱里确实可 import', async () => {
  const m = readManifest();
  const report = await probeOnce(m);

  assertEqual(report.python, m.python, '沙箱内 Python 版本应与 Manifest 一致');
  assertEqual(report.implementation, m.implementation, '沙箱内解释器实现应与 Manifest 一致');

  const importable = new Set(report.importable);
  const missing = m.verified_importable.filter((name) => !importable.has(name));
  assertEqual(
    missing,
    [],
    `以下模块 Manifest 声称可用，但沙箱内 import 失败：${missing
      .map((n) => `${n}(${report.failed[n] ?? '?'})`)
      .join(', ')}`
  );

  // importable_but_blocked：import 本身必须成功（失败的是使用）
  for (const entry of m.importable_but_blocked) {
    assert(
      importable.has(entry.module),
      `${entry.module} 应可 import（Manifest 说它只是「用起来受限」，原因: ${entry.reason}）`
    );
  }
});

test('runtime-manifest: 声称不可用的包在真实沙箱里确实不可用', async () => {
  const m = readManifest();
  const report = await probeOnce(m);

  const wronglyAvailable = m.unavailable.filter((name) => report.importable.includes(name));
  assertEqual(
    wronglyAvailable,
    [],
    `以下包 Manifest 声称不可用，但沙箱内 import 成功：${wronglyAvailable.join(', ')}`
  );
  for (const name of m.unavailable) {
    assertEqual(
      report.failed[name],
      'ModuleNotFoundError',
      `${name} 应因 ModuleNotFoundError 失败，实际 ${report.failed[name] ?? '(未探测)'}`
    );
  }
});

test('runtime-manifest: 沙箱内进程创建 / 网络 / 用户级 site-packages 均被阻断', async () => {
  const m = readManifest();
  const report = await probeOnce(m);

  assertEqual(report.fork, 'PermissionError', 'os.fork() 必须被沙箱拒绝（process-fork）');
  assertEqual(
    report.socket,
    'PermissionError',
    'socket.socket() 必须被沙箱拒绝（network*）'
  );
  assertEqual(
    report.subprocess,
    'PermissionError',
    'subprocess.run() 必须被沙箱拒绝（process-fork）'
  );
  assertEqual(report.pythonnousersite, '1', '沙箱必须设置 PYTHONNOUSERSITE=1');
  const userSite = report.site_paths.filter((p) => p.includes('/Users/'));
  assertEqual(
    userSite,
    [],
    `沙箱内 sys.path 不得出现用户级 site-packages —— 这正是 numpy 不可用的根因；实际: ${report.site_paths.join(', ')}`
  );
});

void runAll('runtime-manifest');
