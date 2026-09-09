/**
 * cross-round-cheat —— 跨 Round 无持久化（Cheat Re-Gate）
 *
 * 覆盖 Finding: P0-8（没有每回合全新沙箱）、P1-12（孙进程成为孤儿）
 *
 * 规则：每一轮的沙箱都是全新的；上一轮的目录在轮次结束后被销毁，
 *       算法不能靠文件 / socket / 后台进程把状态带到下一轮。
 * 判定标准仍是「平台阻止了它」，不是「算法选择不做」。
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PLATFORM_ROOT } from '../src/core/Match';
import { RoundStateCore } from '../src/core/RoundState';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { sealPackage } from '../src/submission/Package';
import { runDuel, RunnerOutcome } from '../src/runner/SandboxRunner';
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

/** 第一轮：写入标记文件、尝试留 socket、尝试留 daemon */
function roundOneSource(): string {
  return `import argparse, json, os, socket, subprocess, sys
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
work = os.environ.get("TMPDIR", "/tmp")
report = {}

def attempt(name, fn):
    try:
        fn()
        report[name] = "allowed"
    except Exception as e:
        report[name] = "blocked:" + type(e).__name__ + ":" + str(e).replace("\\n", " ")[:70]

def write_work():
    with open(os.path.join(work, "persist.txt"), "w") as f:
        f.write("round-1")

def bind_inet():
    # 想留一个监听端口给下一轮的自己用 —— 必须被拒绝
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))

def spawn_daemon():
    subprocess.Popen(["/bin/sh", "-c", "sleep 30  # GB_CHEAT_DAEMON_MARKER"],
                     start_new_session=True)

attempt("write_work_file", write_work)
attempt("inet_bind", bind_inet)
attempt("spawn_daemon", spawn_daemon)

dsl = {"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]}
sys.stdout.write(json.dumps({"dsl": dsl, "cheat": report}) + "\\n")
`;
}

/** 第二轮：检查上一轮与自己的工作目录里是否还残留任何东西 */
function roundTwoSource(prevDir: string): string {
  return `import argparse, json, os, socket, sys
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
work = os.environ.get("TMPDIR", "/tmp")
PREV = ${JSON.stringify(prevDir)}
report = {}

def socket_connect():
    # 想连上上一轮留下的监听端口 —— 必须被拒绝
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2)
    try:
        s.connect(("127.0.0.1", 9))
    finally:
        s.close()

def attempt(name, fn):
    try:
        v = fn()
        report[name] = "allowed" if v is None else "allowed:" + str(v)[:40]
    except Exception as e:
        report[name] = "blocked:" + type(e).__name__ + ":" + str(e).replace("\\n", " ")[:70]

attempt("read_prev_work_file", lambda: open(os.path.join(PREV, "work", "persist.txt")).read())
attempt("list_prev_dir", lambda: os.listdir(PREV))
attempt("connect_prev_socket", lambda: socket_connect())
attempt("read_own_work_file", lambda: open(os.path.join(work, "persist.txt")).read())
report["prev_dir_exists"] = str(os.path.exists(PREV))

dsl = {"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]}
sys.stdout.write(json.dumps({"dsl": dsl, "cheat": report}) + "\\n")
`;
}

function writePkg(dir: string, source: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name, version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(path.join(dir, 'solver.py'), source);
  return dir;
}

function reportOf(outcome: RunnerOutcome): Record<string, string> {
  try {
    return JSON.parse(outcome.stdout.trim()).cheat ?? {};
  } catch {
    return {};
  }
}

interface TwoRounds {
  root: string;
  sandboxRoot: string;
  round1: RunnerOutcome;
  round2: RunnerOutcome;
  round1Report: Record<string, string>;
  round2Report: Record<string, string>;
}

/** 用同一个 matchId 连续跑两轮，第二轮能拿到第一轮的沙箱路径 */
async function runTwoRounds(matchId: string): Promise<TwoRounds> {
  const root = tmpDir('cross-round');
  const artifactRoot = path.join(root, 'artifacts');
  const sandboxRoot = path.join(root, 'sandboxes');
  const sealedRoot = path.join(artifactRoot, 'sealed');

  const oppSeal = sealPackage({ team: 'B', sourceDir: STARTER, sealRoot: sealedRoot, matchId });
  assert(oppSeal.sealed, `对手包应能密封: ${oppSeal.errors.join('; ')}`);

  const core = coreFor(31337);
  const pkg1 = writePkg(path.join(root, 'cheat-r1'), roundOneSource(), 'cheat-r1');
  const seal1 = sealPackage({ team: 'A', sourceDir: pkg1, sealRoot: sealedRoot, matchId });
  assert(seal1.sealed, `第一轮恶意包应能密封: ${seal1.errors.join('; ')}`);

  const duel1 = await runDuel({
    matchId,
    roundNumber: 1,
    sandboxRoot,
    input: runnerInputFromCore(core, matchId),
    teamA: { packageDir: seal1.sealed!.sealedDir, entry: 'solver.py' },
    teamB: { packageDir: oppSeal.sealed!.sealedDir, entry: 'solver.py' },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs: 4000,
  });
  const prevDir = duel1.a.sandboxDir;

  // 第二轮用新的包目录（同一 matchId、不同 roundNumber）
  const pkg2 = writePkg(path.join(root, 'cheat-r2'), roundTwoSource(prevDir), 'cheat-r2');
  const seal2 = sealPackage({ team: 'A', sourceDir: pkg2, sealRoot: sealedRoot, matchId: `${matchId}-r2` });
  assert(seal2.sealed, `第二轮恶意包应能密封: ${seal2.errors.join('; ')}`);

  const duel2 = await runDuel({
    matchId,
    roundNumber: 2,
    sandboxRoot,
    input: runnerInputFromCore(core, matchId),
    teamA: { packageDir: seal2.sealed!.sealedDir, entry: 'solver.py' },
    teamB: { packageDir: oppSeal.sealed!.sealedDir, entry: 'solver.py' },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs: 4000,
  });

  return {
    root,
    sandboxRoot,
    round1: duel1.a,
    round2: duel2.a,
    round1Report: reportOf(duel1.a),
    round2Report: reportOf(duel2.a),
  };
}

test('cross-round-cheat: 上一轮的沙箱目录在轮次结束后被销毁', async () => {
  const t = await runTwoRounds('XR-DESTROY');
  assert(t.round1.success, `第一轮应正常结束: ${t.round1.errorCode}`);
  assert(!fs.existsSync(t.round1.sandboxDir), `第一轮沙箱必须被删除: ${t.round1.sandboxDir}`);
  assertEqual(t.round2Report.prev_dir_exists, 'False', '第二轮不应再看到上一轮的沙箱目录');
});

test('cross-round-cheat: 沙箱目录树不留空壳（P3-D 回归）', async () => {
  const t = await runTwoRounds('XR-SHELL');
  const roundDir = path.dirname(t.round1.sandboxDir);
  assert(!fs.existsSync(roundDir), `回合目录必须被移除: ${roundDir}`);
  assert(
    !fs.existsSync(path.dirname(roundDir)),
    `matchId 目录必须被移除: ${path.dirname(roundDir)}`
  );
  // sandboxRoot 本身必须保留 —— 后续轮次还要在里面建沙箱
  assert(fs.existsSync(t.sandboxRoot), `sandboxRoot 本身不应被删除: ${t.sandboxRoot}`);
  const leftovers = fs.readdirSync(t.sandboxRoot);
  assertEqual(leftovers, [], `沙箱根目录下不得残留任何空壳，实际 ${leftovers.join(', ')}`);
});

test('cross-round-cheat: 文件无法跨轮持久化', async () => {
  const t = await runTwoRounds('XR-FILE');
  assertEqual(t.round1Report.write_work_file, 'allowed', '沙箱内必须能写自己的 work 目录');
  assert(
    t.round2Report.read_prev_work_file.startsWith('blocked:FileNotFoundError'),
    `上一轮文件必须不可见，实际 ${t.round2Report.read_prev_work_file}`
  );
  assert(
    t.round2Report.read_own_work_file.startsWith('blocked:FileNotFoundError'),
    `新一轮 work 目录必须是空的，实际 ${t.round2Report.read_own_work_file}`
  );
  assert(
    t.round2Report.list_prev_dir.startsWith('blocked:'),
    `上一轮目录必须不可列举，实际 ${t.round2Report.list_prev_dir}`
  );
});

test('cross-round-cheat: 无法建立跨轮 socket 通道', async () => {
  const t = await runTwoRounds('XR-SOCKET');
  assert(
    t.round1Report.inet_bind.startsWith('blocked:PermissionError'),
    `监听端口必须被拒绝，实际 ${t.round1Report.inet_bind}`
  );
  assert(
    t.round2Report.connect_prev_socket.startsWith('blocked:PermissionError'),
    `连接本地端口必须被拒绝，实际 ${t.round2Report.connect_prev_socket}`
  );
});

test('cross-round-cheat: 无法留下 daemon 进程（P1-12）', async () => {
  const t = await runTwoRounds('XR-DAEMON');
  assert(
    t.round1Report.spawn_daemon.startsWith('blocked:PermissionError'),
    `启动后台进程必须被拒绝，实际 ${t.round1Report.spawn_daemon}`
  );
  const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
  assert(
    !ps.includes('GB_CHEAT_DAEMON_MARKER'),
    '宿主上不得残留恶意 daemon 进程'
  );
});

void runAll('cross-round-cheat');
