/**
 * timeout-boundary —— 超时语义（Plan V1 §14）
 *
 * 覆盖 Finding: P1-19（超时预算与规范不符）、P2-25（标准输出无上限的邻居问题）
 *
 * 契约：计时从**每方自己的** GO 时刻起算（Re-Gate Cycle 1 P1-B），与进程创建顺序无关；
 *       恰好低于预算 → 成功，超过预算 → TIMEOUT；
 *       超时后进程必须被杀掉、沙箱必须被销毁。
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PLATFORM_ROOT } from '../src/core/Match';
import { RoundStateCore } from '../src/core/RoundState';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { sealPackage } from '../src/submission/Package';
import { runDuel } from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { PY_ARGV_PRELUDE, PY_EMIT, runnerInputFromCore } from './protocol-fixture';

const STARTER = path.join(__dirname, '..', 'starter');
const TIMEOUT_MS = 1200;

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

/** 睡眠 sleepSec 秒后写出合法 result.json 的算法 */
function sleeperSource(sleepSec: number): string {
  return `import time
${PY_ARGV_PRELUDE}with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
y0 = by_id[reveal["shooters"][args.team]]["y"]
time.sleep(${sleepSec})
${PY_EMIT}emit({"type": "add", "args": [
    {"type": "number", "value": y0},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]})
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

async function duelWithSleeper(
  matchId: string,
  sleepSec: number
): Promise<{ root: string; a: Awaited<ReturnType<typeof runDuel>>['a']; b: Awaited<ReturnType<typeof runDuel>>['b'] }> {
  const root = tmpDir('timeout');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');

  const oppSeal = sealPackage({ team: 'B', sourceDir: STARTER, sealRoot: sealedRoot, matchId });
  const slowSeal = sealPackage({
    team: 'A',
    sourceDir: writePkg(path.join(root, 'slow-src'), sleeperSource(sleepSec), 'slow'),
    sealRoot: sealedRoot,
    matchId,
  });
  assert(oppSeal.sealed && slowSeal.sealed, '双方包应能密封');

  const core = coreFor(90210);
  const duel = await runDuel({
    matchId,
    roundNumber: 1,
    sandboxRoot,
    input: runnerInputFromCore(core, matchId),
    teamA: { packageDir: slowSeal.sealed!.sealedDir, entry: 'solver.py' },
    teamB: { packageDir: oppSeal.sealed!.sealedDir, entry: 'solver.py' },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs: TIMEOUT_MS,
  });
  return { root, a: duel.a, b: duel.b };
}

test('timeout-boundary: 低于超时上限的算法成功', async () => {
  const { a, b } = await duelWithSleeper('TO-FAST', 0.3);
  assert(a.success, `0.3s < ${TIMEOUT_MS}ms 应成功: ${a.errorCode} ${a.error}`);
  assert(b.success, '对手应成功');
  assert(
    a.computeTimeMs >= 300 && a.computeTimeMs < TIMEOUT_MS,
    `耗时应在 [300, ${TIMEOUT_MS}) 之间，实际 ${a.computeTimeMs.toFixed(1)}ms`
  );
});

test('timeout-boundary: 超过超时上限的算法被判 TIMEOUT', async () => {
  const { a } = await duelWithSleeper('TO-SLOW', 6);
  assert(!a.success, '超过预算必须失败');
  assertEqual(a.errorCode, 'TIMEOUT', '错误码必须是 TIMEOUT');
  // 计时从 GO 起算：耗时必须贴近预算，而不是贴近 spawn 时刻
  assert(
    a.computeTimeMs <= TIMEOUT_MS + 400,
    `超时耗时必须贴近预算 ${TIMEOUT_MS}ms，实际 ${a.computeTimeMs.toFixed(1)}ms`
  );
});

test('timeout-boundary: 超时后进程被杀掉、沙箱被销毁', async () => {
  const { a, root } = await duelWithSleeper('TO-CLEANUP', 6);
  assertEqual(a.errorCode, 'TIMEOUT', '前提：本轮必须超时');
  assert(!fs.existsSync(a.sandboxDir), `超时后沙箱目录必须被删除: ${a.sandboxDir}`);

  const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
  assert(
    !ps.includes(a.sandboxDir),
    '超时后不得残留该沙箱内的任何进程'
  );
  assert(fs.existsSync(path.join(root, 'sandboxes')), 'sandboxRoot 本身应保留');
});

test('timeout-boundary: 一方超时不影响另一方（无共享计时器）', async () => {
  const { a, b } = await duelWithSleeper('TO-INDEPENDENT', 6);
  assertEqual(a.errorCode, 'TIMEOUT', 'A 应超时');
  assert(b.success, `B 不应被 A 的超时影响: ${b.errorCode} ${b.error}`);
  assert(b.computeTimeMs < TIMEOUT_MS, `B 的耗时 ${b.computeTimeMs.toFixed(1)}ms 应远小于预算`);
});

void runAll('timeout-boundary');
