/**
 * process-tree-cleanup —— 进程树清理（Plan V1 §14 / P1-12）
 *
 * 覆盖 Finding: P1-12（只杀直接子进程，孙进程成为孤儿）、
 *              P1-13（子进程继承宿主环境）
 *
 * 契约：每个算法运行在独立进程组里；取消/超时必须杀掉整个进程组；
 *       算法自身无法 fork 或 spawn 子进程（因此也不可能留下 daemon）。
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PLATFORM_ROOT } from '../src/core/Match';
import { RoundStateCore } from '../src/core/RoundState';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { sealPackage } from '../src/submission/Package';
import { cleanupSandbox, prepareSandbox, spawnRunner } from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { runnerInputFromCore } from './protocol-fixture';

const STARTER = path.join(__dirname, '..', 'starter');

function coreFor(seed: number): RoundStateCore {
  const map = generateMapOrNull({ seed, pointCount: 6, difficulty: 'easy' });
  assert(map, `种子 ${seed} 应能生成地图`);
  return {
    round: 1,
    mapSeed: map!.seed,
    mapHash: map!.stateHash,
    obstacles: map!.obstacles,
    points: [
      ...map!.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, position: p })),
      ...map!.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, position: p })),
    ],
    shooters: {
      A: { id: 'A1', position: map!.teamA[0] },
      B: { id: 'B1', position: map!.teamB[0] },
    },
    teamAXRange: [-20, -4],
    teamBXRange: [4, 20],
  };
}

function pgidOf(pid: number): number | null {
  try {
    const out = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const v = parseInt(out, 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 起一个长睡眠的算法（自己不能 fork，所以进程组里只应有它自己） */
function sleepPkg(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'sleeper', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(path.join(dir, 'solver.py'), 'import time\ntime.sleep(120)\n');
  return dir;
}

test('process-tree-cleanup: 算法运行在独立进程组中', async () => {
  const root = tmpDir('ptree');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const seal = sealPackage({
    team: 'A',
    sourceDir: sleepPkg(path.join(root, 'sleep-src')),
    sealRoot: sealedRoot,
    matchId: 'PTREE-GROUP',
  });
  assert(seal.sealed, '包应能密封');

  const sandbox = prepareSandbox({
    sandboxRoot,
    matchId: 'PTREE-GROUP',
    roundNumber: 1,
    team: 'A',
    packageDir: seal.sealed!.sealedDir,
    entry: 'solver.py',
    input: runnerInputFromCore(coreFor(11), 'PTREE-GROUP'),
    memoryLimitMb: 512,
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
  });
  const runner = spawnRunner({
    team: 'A',
    sandbox,
    timeoutMs: 60_000,
    memoryLimitMb: 512,
  });
  await runner.ready;
  const pid = runner.proc.pid;
  assert(pid, '进程应有 pid');
  assertEqual(pgidOf(pid!), pid!, '算法必须是自己进程组的组长（否则无法整组杀）');
  assert(isAlive(pid!), '此时算法应仍在运行');

  runner.cancel();
  const outcome = await runner.done;
  assertEqual(outcome.errorCode, 'CANCELLED', '取消应报 CANCELLED');
  // SIGKILL 是异步的，给内核一点时间回收
  await new Promise((r) => setTimeout(r, 300));
  assert(!isAlive(pid!), '取消后进程必须已消失');

  cleanupSandbox(sandbox.dir);
});

test('process-tree-cleanup: 算法无法 fork / spawn 子进程', async () => {
  const root = tmpDir('ptree-fork');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const src = path.join(root, 'fork-src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, 'manifest.json'),
    JSON.stringify({ name: 'forker', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(
    path.join(src, 'solver.py'),
    `import argparse, json, os, subprocess, sys
ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True)
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
args = ap.parse_args()
with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
y0 = by_id[reveal["shooters"][args.team]]["y"]
report = {}
try:
    os.fork()
    report["fork"] = "allowed"
except Exception as e:
    report["fork"] = "blocked:" + type(e).__name__
try:
    subprocess.Popen(["/bin/sleep", "120"])
    report["spawn"] = "allowed"
except Exception as e:
    report["spawn"] = "blocked:" + type(e).__name__
dsl = {"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]}
sys.stdout.write(json.dumps({"dsl": dsl, "cheat": report}) + "\\n")
`
  );

  const seal = sealPackage({ team: 'A', sourceDir: src, sealRoot: sealedRoot, matchId: 'PTREE-FORK' });
  assert(seal.sealed, '包应能密封');
  const sandbox = prepareSandbox({
    sandboxRoot,
    matchId: 'PTREE-FORK',
    roundNumber: 1,
    team: 'A',
    packageDir: seal.sealed!.sealedDir,
    entry: 'solver.py',
    input: runnerInputFromCore(coreFor(12), 'PTREE-FORK'),
    memoryLimitMb: 512,
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
  });
  const runner = spawnRunner({
    team: 'A',
    sandbox,
    timeoutMs: 10_000,
    memoryLimitMb: 512,
  });
  await runner.ready;
  runner.release(); // P1-B：不再传入共享 releaseNs
  const outcome = await runner.done;

  const report = JSON.parse(outcome.stdout.trim()).cheat as Record<string, string>;
  assertEqual(report.fork, 'blocked:PermissionError', 'fork 必须被拒绝');
  assertEqual(report.spawn, 'blocked:PermissionError', 'spawn 子进程必须被拒绝');

  const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
  assert(!ps.includes(sandbox.dir), '不得残留任何来自该沙箱的进程');
  cleanupSandbox(sandbox.dir);
});

test('process-tree-cleanup: 沙箱环境变量被清理（P1-13）', async () => {
  const root = tmpDir('ptree-env');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const src = path.join(root, 'env-src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, 'manifest.json'),
    JSON.stringify({ name: 'env', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(
    path.join(src, 'solver.py'),
    `import argparse, json, os, sys
ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True)
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
args = ap.parse_args()
with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
y0 = by_id[reveal["shooters"][args.team]]["y"]
env = {k: v for k, v in os.environ.items()}
sys.stdout.write(json.dumps({"dsl": {"type": "number", "value": y0}, "env": env}) + "\\n")
`
  );
  const seal = sealPackage({ team: 'A', sourceDir: src, sealRoot: sealedRoot, matchId: 'PTREE-ENV' });
  const sandbox = prepareSandbox({
    sandboxRoot,
    matchId: 'PTREE-ENV',
    roundNumber: 1,
    team: 'A',
    packageDir: seal.sealed!.sealedDir,
    entry: 'solver.py',
    input: runnerInputFromCore(coreFor(13), 'PTREE-ENV'),
    memoryLimitMb: 512,
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
  });
  const runner = spawnRunner({
    team: 'A',
    sandbox,
    timeoutMs: 10_000,
    memoryLimitMb: 512,
  });
  await runner.ready;
  runner.release(); // P1-B：不再传入共享 releaseNs
  const outcome = await runner.done;

  const env = JSON.parse(outcome.stdout.trim()).env as Record<string, string>;
  // 这几个变量由运行时自行注入，与宿主环境无关：
  //   PWD/SHLVL 来自 /bin/sh 启动器（PWD 是沙箱 work 目录）；
  //   SDKROOT/CPATH/LIBRARY_PATH/MANPATH/__CF_USER_TEXT_ENCODING
  //   来自 macOS 的 /usr/bin/python3 启动器（Xcode CLT 工具链）。
  // 宿主里没有任何 TOKEN / 密钥 / 用户数据被带进来。
  const OS_INJECTED = new Set([
    'PWD',
    'SHLVL',
    '__CF_USER_TEXT_ENCODING',
    'SDKROOT',
    'CPATH',
    'LIBRARY_PATH',
    'MANPATH',
  ]);
  const leaked = Object.keys(env).filter(
    (k) => !/^(PATH|HOME|TMPDIR|LANG|LC_ALL|PYTHON|GB_TEAM)/.test(k) && !OS_INJECTED.has(k)
  );
  assertEqual(leaked, [], `不得继承宿主环境变量：${leaked.join(', ')}`);

  const secrets = Object.keys(env).filter((k) => /TOKEN|SECRET|KEY|PASS|AUTH|AWS|ANTHROPIC|SSH/i.test(k));
  assertEqual(secrets, [], `不得泄漏任何凭据类变量：${secrets.join(', ')}`);
  assertEqual(env.GB_TEAM, 'A', '应只暴露自己的队号');
  assertEqual(env.HOME, sandbox.dir, 'HOME 必须指向沙箱目录');
  assertEqual(env.TMPDIR, path.join(sandbox.dir, 'work'), 'TMPDIR 必须指向沙箱 work 目录');
  assertEqual(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin', 'PATH 必须是固定白名单');
  cleanupSandbox(sandbox.dir);
});

void runAll('process-tree-cleanup');
