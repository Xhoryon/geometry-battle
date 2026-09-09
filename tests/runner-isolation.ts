/**
 * runner-isolation —— 沙箱隔离（Cheat Re-Gate）
 *
 * 覆盖 Finding: P0-7（Runner 没有真正的隔离边界）、P1-13（子进程继承宿主环境）、
 *              P1-14（网络不受限制）、P2-25（标准输出无上限）、
 *              P1-ISO（密封包目录在 /Users 之外时可被对手读取）
 *
 * 判定标准是「平台阻止了它」，不是「算法选择不做」：
 * 恶意算法包主动尝试每一条越界操作，报告必须是 blocked，
 * 同时对照项（读自己的包、写自己的 work 目录）必须是 allowed。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MatchEngine, PLATFORM_ROOT } from '../src/core/Match';
import { RoundStateCore } from '../src/core/RoundState';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { sealPackage } from '../src/submission/Package';
import {
  RunnerOutcome,
  cleanupSandbox,
  defaultSandboxRoot,
  prepareSandbox,
  runDuel,
  sandboxExecAvailable,
} from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import {
  PROBE_REPORT_PREFIX,
  PY_ARGV_PRELUDE,
  PY_EMIT,
  probeReport,
  runnerInputFromCore,
} from './protocol-fixture';

const STARTER = path.join(__dirname, '..', 'starter');
const SHARED_TMP = '/tmp/gb-cheat-shared.txt';

interface CheatPaths {
  judgeSource: string;
  opponentSealed: string;
  sandboxRoot: string;
  projectWrite: string;
  sharedTmp: string;
  workDir: string;
}

/** 生成恶意算法包：把测试提供的绝对路径嵌入源码（沙箱里读不到环境变量） */
function writeCheatPackage(dir: string, paths: CheatPaths): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'cheat', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(path.join(dir, 'solver.py'), cheatSource(paths));
}

function cheatSource(p: CheatPaths): string {
  return `# 恶意算法包（仅用于隔离回归测试）
import socket, subprocess
${PY_ARGV_PRELUDE}${PY_EMIT}PATHS = ${JSON.stringify(p)}

with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
team = args.team
by_id = {pt["id"]: pt for pt in public["points"]}
me = by_id[reveal["shooters"][team]]
x0 = me["x"]
y0 = me["y"]

report = {}

def attempt(name, fn):
    try:
        fn()
        report[name] = "allowed"
    except Exception as e:
        report[name] = "blocked:" + type(e).__name__ + ":" + str(e).replace("\\n", " ")[:70]

def read_text(path):
    with open(path, "r") as f:
        return f.read(200)

def net_probe():
    # 只用 socket() 建对象是拦不住的（SBPL 的 network* 管的是 bind/connect），
    # 必须真的发起连接：被拒绝时抛 PermissionError。
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2)
    try:
        s.connect(("10.255.255.1", 81))
    finally:
        s.close()

def round_dir():
    # --public 指向 <sandboxDir>/input/public_state.json，
    # 因此上三级就是 <sandboxRoot>/<matchId>/round-N ——
    # 对手沙箱目录名（含 nonce）只可能从这里泄漏。
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(args.public))))

def read_opponent_input():
    for entry in os.listdir(round_dir()):
        if entry.startswith("B-"):
            return read_text(os.path.join(round_dir(), entry, "input", "public_state.json"))
    raise FileNotFoundError("opponent sandbox not listed")

attempt("read_judge_source", lambda: read_text(PATHS["judgeSource"]))
attempt("read_opponent_package", lambda: read_text(os.path.join(PATHS["opponentSealed"], "manifest.json")))
attempt("list_opponent_package", lambda: os.listdir(PATHS["opponentSealed"]))
attempt("list_sandbox_root", lambda: os.listdir(PATHS["sandboxRoot"]))
attempt("list_round_dir", lambda: os.listdir(round_dir()))
attempt("read_opponent_input", lambda: read_opponent_input())
attempt("write_project", lambda: open(PATHS["projectWrite"], "w").write("pwned"))
attempt("write_home", lambda: open(os.path.join(os.environ.get("HOME", "/"), "gb-cheat-home.txt"), "w").write("pwned"))
attempt("write_shared_tmp", lambda: open(PATHS["sharedTmp"], "w").write("pwned"))
attempt("network", lambda: net_probe())
attempt("fork_child", lambda: os.fork() and os._exit(0))
attempt("spawn_subprocess", lambda: subprocess.run(["/bin/echo", "x"], capture_output=True, check=True))
# 对照组：这些必须成功，否则「全部 blocked」只是沙箱根本没跑起来
attempt("read_own_package", lambda: read_text(os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json")))
attempt("write_work", lambda: open(os.path.join(os.environ.get("TMPDIR", "/tmp"), "ok.txt"), "w").write("ok"))

# 诊断报告走 stderr（规范 §30）；正式结果只写 result.json（规范 §24）
sys.stderr.write("${PROBE_REPORT_PREFIX}" + json.dumps(report) + "\\n")
emit({"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]})
`;
}

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

interface DuelRun {
  report: Record<string, string>;
  outcomeA: RunnerOutcome;
  projectWrite: string;
  sandboxRoot: string;
  sealedRoot: string;
  matchId: string;
  artifactRoot: string;
}

async function runCheatDuel(matchId: string, timeoutMs = 4000): Promise<DuelRun> {
  const root = tmpDir('isolation');
  const artifactRoot = path.join(root, 'artifacts');
  const sandboxRoot = path.join(root, 'sandboxes');
  const sealedRoot = path.join(artifactRoot, 'sealed');

  const cheatDir = path.join(root, 'cheat-src');
  const projectWrite = path.join(PLATFORM_ROOT, 'CHEAT_PROJECT_WRITE.txt');

  // 对手包先密封，才能知道它在沙箱外的真实位置
  const oppSeal = sealPackage({ team: 'B', sourceDir: STARTER, sealRoot: sealedRoot, matchId });
  assert(oppSeal.sealed, `对手包应能密封: ${oppSeal.errors.join('; ')}`);

  writeCheatPackage(cheatDir, {
    judgeSource: path.join(PLATFORM_ROOT, 'src', 'core', 'Judge.ts'),
    opponentSealed: oppSeal.sealed!.sealedDir,
    sandboxRoot,
    projectWrite,
    sharedTmp: SHARED_TMP,
    workDir: '',
  });
  const cheatSeal = sealPackage({ team: 'A', sourceDir: cheatDir, sealRoot: sealedRoot, matchId });
  assert(cheatSeal.sealed, `恶意包应能密封: ${cheatSeal.errors.join('; ')}`);

  const core = coreFor(4242);
  const duel = await runDuel({
    matchId,
    roundNumber: 1,
    sandboxRoot,
    input: runnerInputFromCore(core, matchId),
    teamA: { packageDir: cheatSeal.sealed!.sealedDir, entry: 'solver.py' },
    teamB: { packageDir: oppSeal.sealed!.sealedDir, entry: 'solver.py' },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs,
  });

  // 探针报告在 stderr（规范 §30）—— stdout 已不是 IPC 通道（规范 §24）
  const report = probeReport(duel.a.stderr);
  return { report, outcomeA: duel.a, projectWrite, sandboxRoot, sealedRoot, matchId, artifactRoot };
}

test('runner-isolation: 沙箱机制可用', () => {
  assert(sandboxExecAvailable(), '必须启用 sandbox-exec，否则隔离无从谈起（P0-7）');
});

test('runner-isolation: 所有越界尝试全部 BLOCKED', async () => {
  const run = await runCheatDuel('ISO-BLOCK');
  assert(run.outcomeA.success, `恶意包本身应正常运行: ${run.outcomeA.errorCode}`);

  const attacks = [
    'read_judge_source',
    'read_opponent_package',
    'list_opponent_package',
    'list_sandbox_root',
    // V1.1：对手的 input/public_state.json 与自己的沙箱是同级目录，必须同样不可达
    'list_round_dir',
    'read_opponent_input',
    'write_project',
    'write_home',
    'write_shared_tmp',
    'fork_child',
    'spawn_subprocess',
  ];
  const leaked = attacks.filter((a) => !String(run.report[a]).startsWith('blocked:'));
  assertEqual(
    leaked,
    [],
    `以下攻击未被阻止：${leaked.map((a) => `${a}=${run.report[a]}`).join(', ')}\n完整报告: ${JSON.stringify(run.report)}`
  );
  // 网络必须是被沙箱拒绝（EPERM），而不是「连不上」这种假象
  assert(
    String(run.report.network).startsWith('blocked:PermissionError'),
    `网络必须被沙箱拒绝，实际 ${run.report.network}`
  );

  // 对照组：沙箱必须仍能正常读自己的包、写自己的 work 目录
  assertEqual(run.report.read_own_package, 'allowed', '沙箱内必须能读自己的包');
  assertEqual(run.report.write_work, 'allowed', '沙箱内必须能写自己的 work 目录');

  // 宿主侧独立验证：标记文件从未落地
  assert(!fs.existsSync(run.projectWrite), `项目目录不得被写入: ${run.projectWrite}`);
  assert(!fs.existsSync(SHARED_TMP), `共享临时目录不得被写入: ${SHARED_TMP}`);
  assert(!fs.existsSync(path.join(require('os').homedir(), 'gb-cheat-home.txt')), 'HOME 不得被写入');
});

test('runner-isolation: 密封包目录在 /Users 之外时同样不可读', async () => {
  const run = await runCheatDuel('ISO-SEALED-OUTSIDE');
  assert(
    !run.sealedRoot.startsWith('/Users'),
    `本用例前提是密封包位于 /Users 之外，实际 ${run.sealedRoot}`
  );
  assert(
    run.report.read_opponent_package.startsWith('blocked:PermissionError'),
    `对手密封包必须不可读，实际 ${run.report.read_opponent_package}`
  );
  assert(
    run.report.list_opponent_package.startsWith('blocked:PermissionError'),
    `对手密封包目录必须不可列举，实际 ${run.report.list_opponent_package}`
  );
});

/**
 * 生成一个「只做读取探测」的算法包：
 *   - 全部目标读取都被拒（PermissionError）→ 输出合法 DSL，正常运行；
 *   - 任一处读取成功 → 向 stderr 打出 LEAK:<名字> 并以非 0 退出。
 * 因此「Preflight 通过」等价于「所有目标读取都被平台拒绝」。
 */
function writeProbePackage(dir: string, targets: Record<string, { path: string; kind: 'file' | 'dir' }>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'probe', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    `${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
y0 = by_id[reveal["shooters"][args.team]]["y"]
TARGETS = ${JSON.stringify(targets)}

for name, spec in TARGETS.items():
    try:
        if spec["kind"] == "dir":
            os.listdir(spec["path"])
        else:
            with open(spec["path"], "r") as f:
                f.read(64)
    except PermissionError:
        continue
    except Exception as e:
        sys.stderr.write("UNEXPECTED:" + name + ":" + type(e).__name__ + ":" + spec["path"] + "\\n")
        sys.exit(1)
    sys.stderr.write("LEAK:" + name + ":" + spec["path"] + "\\n")
    sys.exit(1)

emit({"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]})
`
  );
}

async function preflightProbe(
  matchId: string,
  root: string,
  targets: Record<string, { path: string; kind: 'file' | 'dir' }>
) {
  const artifactRoot = path.join(root, 'artifacts');
  const sandboxRoot = path.join(root, 'sandboxes');
  const srcA = path.join(root, 'probe-src');
  const srcB = path.join(root, 'opp-src');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(srcB, { recursive: true });
  fs.cpSync(STARTER, srcB, { recursive: true });
  writeProbePackage(srcA, targets);

  const engine = new MatchEngine({
    matchId,
    seed: 20260909,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot,
    sandboxRoot,
  });
  assert(engine.upload('A', srcA).ok, 'A 上传应成功');
  assert(engine.upload('B', srcB).ok, 'B 上传应成功');
  const pre = await engine.preflight();
  return { pre, artifactRoot, srcA, srcB, sealedDir: path.join(artifactRoot, 'sealed', matchId) };
}

test('runner-isolation: 官方 MatchEngine 路径下双方源包与产物目录不可读（P0-B 回归）', async () => {
  const root = tmpDir('iso-engine');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'host-only');

  const srcA = path.join(root, 'probe-src');
  const srcB = path.join(root, 'opp-src');
  const artifactRoot = path.join(root, 'artifacts');

  const { pre } = await preflightProbe('ISO-ENGINE-BLOCK', root, {
    own_source_dir: { path: srcA, kind: 'dir' },
    opp_source_dir: { path: srcB, kind: 'dir' },
    artifact_dir: { path: artifactRoot, kind: 'dir' },
  });
  assert(
    pre.ok,
    `官方路径必须拒绝算法读取双方源包与产物目录；Preflight 失败说明有读取未被阻止:\n${pre.errors.join('\n')}`
  );

  // 反向对照：把目标换成未被 deny 的目录时，探测包必须能读到并报 LEAK，
  // 否则本用例只是「探测包根本没跑」的假阳性（也会抓出过宽的 deny）。
  const { pre: leak } = await preflightProbe('ISO-ENGINE-LEAK', root, {
    outside_dir: { path: outside, kind: 'dir' },
  });
  assert(!leak.ok, '对照用例：读取未被 deny 的目录必须被探测到（否则断言无效）');
  assert(
    leak.errors.some((e) => e.includes('LEAK:outside_dir')),
    `对照用例应报出 LEAK:outside_dir，实际: ${leak.errors.join('; ')}`
  );
});

test('runner-isolation: sandboxRoot 位于 /tmp 下时，任意 /tmp 读取仍被拒绝（D-1 回归）', async () => {
  // Re-Gate Cycle 2 审计 D-1：buildProfile 的自保护过滤曾把 sandboxRoot 也列入
  // 判定对象（`covers(p, sandboxRoot)`），于是当 sandboxRoot 落在 /tmp 之下时，
  // 系统兜底 deny `/private/tmp` 被整条静默丢弃 —— 算法即可读取任意未被显式
  // deny 的 /tmp 文件（包括**其他场次的密封包**）。
  // 本用例把 sandboxRoot 放到 /tmp 下，同时做结构性断言与行为断言。
  const root = fs.mkdtempSync(path.join('/tmp', 'gb-iso-tmp-'));
  try {
    const secret = path.join(root, 'secret.txt');
    fs.writeFileSync(secret, 'HOST-ONLY');

    // 结构性断言：profile 必须保留系统兜底 deny（这一行是修复的承重断言）
    const sb = prepareSandbox({
      sandboxRoot: path.join(root, 'sandboxes'),
      matchId: 'ISO-TMPROOT-PROFILE',
      roundNumber: 1,
      team: 'A',
      packageDir: STARTER,
      entry: 'solver.py',
      input: runnerInputFromCore(coreFor(11), 'ISO-TMPROOT-PROFILE'),
      memoryLimitMb: 512,
      denyReadPaths: [],
    });
    const profile = fs.readFileSync(sb.profilePath, 'utf-8');
    assert(
      profile.includes('(deny file-read* (subpath "/private/tmp"))'),
      `sandboxRoot 位于 /tmp 下时仍必须保留系统兜底 deny，实际 profile:\n${profile}`
    );
    cleanupSandbox(sb.dir);

    // 行为断言：读任意 /tmp 文件、列举 /tmp 都必须被拒绝。
    // pre.ok 同时证明沙箱仍能读自己的包（否则解释器起不来，Preflight 会失败）。
    const { pre } = await preflightProbe('ISO-TMPROOT', root, {
      tmp_secret: { path: secret, kind: 'file' },
      tmp_list: { path: '/tmp', kind: 'dir' },
    });
    assert(
      pre.ok,
      `sandboxRoot 位于 /tmp 下时，/tmp 的读取与列举必须全部被拒绝；Preflight 失败说明有泄漏:\n${pre.errors.join('\n')}`
    );

    // 反向对照：把目标换成未被 deny 的目录（os.tmpdir() 下，不是 /tmp），
    // 探测包必须能读到并报 LEAK —— 否则上面的 pre.ok 只是「探针没跑」的假阳性。
    const ctrl = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-iso-ctrl-'));
    const { pre: leak } = await preflightProbe('ISO-TMPROOT-CTRL', root, {
      ctrl_dir: { path: ctrl, kind: 'dir' },
    });
    assert(!leak.ok, '对照用例：读取未被 deny 的目录必须被探测到（否则断言无效）');
    assert(
      leak.errors.some((e) => e.includes('LEAK:ctrl_dir')),
      `对照用例应报出 LEAK:ctrl_dir，实际: ${leak.errors.join('; ')}`
    );
    fs.rmSync(ctrl, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runner-isolation: 洪泛 stdout 被限长（P2-25）', async () => {
  const root = tmpDir('isolation-flood');
  const artifactRoot = path.join(root, 'artifacts');
  const sandboxRoot = path.join(root, 'sandboxes');
  const sealedRoot = path.join(artifactRoot, 'sealed');

  const floodDir = path.join(root, 'flood-src');
  fs.mkdirSync(floodDir, { recursive: true });
  fs.writeFileSync(
    path.join(floodDir, 'manifest.json'),
    JSON.stringify({ name: 'flood', version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(
    path.join(floodDir, 'solver.py'),
    'import sys\nsys.stdout.write("A" * 5_000_000)\nsys.stdout.flush()\n'
  );

  const oppSeal = sealPackage({ team: 'B', sourceDir: STARTER, sealRoot: sealedRoot, matchId: 'FLOOD' });
  const floodSeal = sealPackage({ team: 'A', sourceDir: floodDir, sealRoot: sealedRoot, matchId: 'FLOOD' });
  assert(oppSeal.sealed && floodSeal.sealed, '双方包应能密封');

  const core = coreFor(777);
  const duel = await runDuel({
    matchId: 'FLOOD',
    roundNumber: 1,
    sandboxRoot,
    input: runnerInputFromCore(core, 'FLOOD'),
    teamA: { packageDir: floodSeal.sealed!.sealedDir, entry: 'solver.py' },
    teamB: { packageDir: oppSeal.sealed!.sealedDir, entry: 'solver.py' },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs: 4000,
  });

  assert(!duel.a.success, '洪泛输出必须判定为失败');
  assertEqual(duel.a.errorCode, 'OUTPUT_TOO_LARGE', '应报 OUTPUT_TOO_LARGE');
  assert(duel.a.stdout.length <= 256 * 1024, `stdout 必须被限长，实际 ${duel.a.stdout.length} 字节`);
  assert(duel.b.success, '对手不应被洪泛影响');
});

void runAll('runner-isolation');
