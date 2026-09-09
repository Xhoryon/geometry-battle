/**
 * timing-fairness —— 计时公平性（Plan V1 §14 / P1-10、P1-19、P2-2）
 *
 * 覆盖 Finding: P1-10（计时偏差系统性偏向第二个启动的队伍）、
 *              P2-2（array order / Promise order / runner 创建顺序造成胜率偏差）
 *
 * 两个批次：
 *   1) 同一算法对同一算法（n ≥ 100）：释放时刻偏差、就绪偏差、
 *      computeTime 差值、以及「A 更快」的比例必须接近 0.5；
 *   2) 配对换序（同一张地图，X=A/Y=B 与 X=B/Y=A 各跑一次）：
 *      X 的胜率在两序之间不得出现系统性偏移。
 */

import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { judgeShot } from '../src/core/Judge';
import { PLATFORM_ROOT } from '../src/core/Match';
import { RoundStateCore, runnerPayloadJson } from '../src/core/RoundState';
import { GeneratedMap, generateMapOrNull } from '../src/map/MapGenerator';
import { sealPackage } from '../src/submission/Package';
import { runDuel, RunnerOutcome } from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const STARTER = path.join(__dirname, '..', 'starter');
const ALGO_X = path.join(__dirname, 'fixtures', 'algos', 'arc-sweep');
const ALGO_Y = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');

/** 轮数：可用 GB_FAIRNESS_ROUNDS / GB_FAIRNESS_SWAP_ROUNDS 调整 */
const ROUNDS_ORDER = Number(process.env.GB_FAIRNESS_ROUNDS ?? 300);
const ROUNDS_SWAP = Number(process.env.GB_FAIRNESS_SWAP_ROUNDS ?? 150);
/** 正式要求 ≥ 100；仅用于本地冒烟时可调低 */
const MIN_ROUNDS = Number(process.env.GB_FAIRNESS_MIN ?? 100);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function describe(values: number[]): string {
  const s = [...values].sort((a, b) => a - b);
  return `median=${percentile(s, 50).toFixed(3)} p95=${percentile(s, 95).toFixed(3)} max=${s[s.length - 1].toFixed(3)}`;
}

function median(values: number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

function coreFor(map: GeneratedMap): RoundStateCore {
  return {
    round: 1,
    mapSeed: map.seed,
    mapHash: map.stateHash,
    obstacles: map.obstacles,
    points: [
      ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, position: p })),
      ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, position: p })),
    ],
    shooters: {
      A: { id: 'A1', position: map.teamA[0] },
      B: { id: 'B1', position: map.teamB[0] },
    },
    teamAXRange: [-20, -4],
    teamBXRange: [4, 20],
  };
}

function extractDsl(outcome: RunnerOutcome): CanonicalNode | null {
  const text = outcome.stdout.trim();
  if (!text) return null;
  const tryOne = (s: string): CanonicalNode | null => {
    try {
      const obj = JSON.parse(s);
      const dsl = obj?.dsl ?? obj?.function ?? obj?.f ?? null;
      if (dsl === null || dsl === undefined) return null;
      const parsed = parseCanonicalDSL(typeof dsl === 'string' ? dsl : JSON.stringify(dsl));
      return parsed.ok ? parsed.ast! : null;
    } catch {
      return null;
    }
  };
  const whole = tryOne(text);
  if (whole) return whole;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = tryOne(lines[i]);
    if (r) return r;
  }
  return null;
}

/** 用 Canonical Judge 结算一次 duel，返回双方击杀数 */
function killsOf(map: GeneratedMap, duel: { a: RunnerOutcome; b: RunnerOutcome }): { A: number; B: number } {
  const count = (team: 'A' | 'B', outcome: RunnerOutcome): number => {
    const ast = extractDsl(outcome);
    if (!ast) return 0;
    const shooter = team === 'A' ? map.teamA[0] : map.teamB[0];
    const enemies = (team === 'A' ? map.teamB : map.teamA).map((p, i) => ({
      id: `${team === 'A' ? 'B' : 'A'}${i + 1}`,
      position: p,
    }));
    return judgeShot(ast, shooter, team, enemies, map.obstacles).killed.length;
  };
  return { A: count('A', duel.a), B: count('B', duel.b) };
}

interface Batch {
  releaseSkewUs: number[];
  readySkewMs: number[];
  timeA: number[];
  timeB: number[];
  aFaster: number;
  rounds: number;
}

async function orderBatch(n: number): Promise<Batch> {
  const root = tmpDir('fairness-order');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const seal = sealPackage({ team: 'A', sourceDir: STARTER, sealRoot: sealedRoot, matchId: 'FAIR-ORDER' });
  assert(seal.sealed, 'starter 应能密封');

  const out: Batch = { releaseSkewUs: [], readySkewMs: [], timeA: [], timeB: [], aFaster: 0, rounds: 0 };
  for (let i = 0; i < n; i++) {
    const map = generateMapOrNull({ seed: 3_000_011 + i * 10_007, pointCount: 8, difficulty: 'medium' });
    if (!map) continue;
    const core = coreFor(map);
    const duel = await runDuel({
      matchId: 'FAIR-ORDER',
      roundNumber: i + 1,
      sandboxRoot,
      teamA: {
        packageDir: seal.sealed!.sealedDir,
        entry: 'solver.py',
        payloadJson: runnerPayloadJson(core, 'A'),
      },
      teamB: {
        packageDir: seal.sealed!.sealedDir,
        entry: 'solver.py',
        payloadJson: runnerPayloadJson(core, 'B'),
      },
      denyReadPaths: [sealedRoot, PLATFORM_ROOT],
      timeoutMs: 3000,
    });
    if (!duel.a.success || !duel.b.success) continue;
    out.releaseSkewUs.push(duel.releaseSkewUs);
    out.readySkewMs.push(duel.readySkewMs);
    out.timeA.push(duel.a.computeTimeMs);
    out.timeB.push(duel.b.computeTimeMs);
    if (duel.a.computeTimeMs < duel.b.computeTimeMs) out.aFaster++;
    out.rounds++;
  }
  return out;
}

interface SwapResult {
  rounds: number;
  xWinsWhenA: number;
  xWinsWhenB: number;
  timeXasA: number[];
  timeXasB: number[];
}

async function swapBatch(n: number): Promise<SwapResult> {
  const root = tmpDir('fairness-swap');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const sealX = sealPackage({ team: 'A', sourceDir: ALGO_X, sealRoot: sealedRoot, matchId: 'FAIR-SWAP' });
  const sealY = sealPackage({ team: 'B', sourceDir: ALGO_Y, sealRoot: sealedRoot, matchId: 'FAIR-SWAP' });
  assert(sealX.sealed && sealY.sealed, '两个算法包都应能密封');
  const pkgX = { packageDir: sealX.sealed!.sealedDir, entry: 'solver.py' };
  const pkgY = { packageDir: sealY.sealed!.sealedDir, entry: 'solver.py' };

  const out: SwapResult = { rounds: 0, xWinsWhenA: 0, xWinsWhenB: 0, timeXasA: [], timeXasB: [] };
  for (let i = 0; i < n; i++) {
    // 配对设计：同一张地图跑两种顺序，消除地图方差
    const map = generateMapOrNull({ seed: 5_000_011 + i * 10_009, pointCount: 8, difficulty: 'medium' });
    if (!map) continue;
    const core = coreFor(map);

    const duel1 = await runDuel({
      matchId: 'FAIR-SWAP',
      roundNumber: i * 2 + 1,
      sandboxRoot,
      teamA: { ...pkgX, payloadJson: runnerPayloadJson(core, 'A') },
      teamB: { ...pkgY, payloadJson: runnerPayloadJson(core, 'B') },
      denyReadPaths: [sealedRoot, PLATFORM_ROOT],
      timeoutMs: 3000,
    });
    const duel2 = await runDuel({
      matchId: 'FAIR-SWAP',
      roundNumber: i * 2 + 2,
      sandboxRoot,
      teamA: { ...pkgY, payloadJson: runnerPayloadJson(core, 'A') },
      teamB: { ...pkgX, payloadJson: runnerPayloadJson(core, 'B') },
      denyReadPaths: [sealedRoot, PLATFORM_ROOT],
      timeoutMs: 3000,
    });
    if (!duel1.a.success || !duel1.b.success || !duel2.a.success || !duel2.b.success) continue;

    const k1 = killsOf(map, duel1); // X=A, Y=B
    const k2 = killsOf(map, duel2); // X=B, Y=A
    if (k1.A > k1.B) out.xWinsWhenA += 1;
    else if (k1.A === k1.B) out.xWinsWhenA += 0.5;
    if (k2.B > k2.A) out.xWinsWhenB += 1;
    else if (k2.B === k2.A) out.xWinsWhenB += 0.5;

    out.timeXasA.push(duel1.a.computeTimeMs);
    out.timeXasB.push(duel2.b.computeTimeMs);
    out.rounds++;
  }
  return out;
}

test(`timing-fairness: 同算法对局 ${ROUNDS_ORDER} 轮 —— 释放偏差与耗时对称`, async () => {
  const b = await orderBatch(ROUNDS_ORDER);
  assert(b.rounds >= MIN_ROUNDS, `有效轮数必须 ≥ ${MIN_ROUNDS}，实际 ${b.rounds}`);

  const skew = [...b.releaseSkewUs].sort((x, y) => x - y);
  const ready = [...b.readySkewMs].sort((x, y) => x - y);
  const diffs = b.timeA.map((t, i) => t - b.timeB[i]);
  const aFasterRate = b.aFaster / b.rounds;

  console.log(
    `    [fairness] rounds=${b.rounds} releaseSkewUs(${describe(skew)}) ` +
      `readySkewMs(${describe(ready)}) timeDiffMs(median=${median(diffs).toFixed(3)} ` +
      `p95=${percentile([...diffs].sort((x, y) => x - y), 95).toFixed(3)}) ` +
      `medianTimeA=${median(b.timeA).toFixed(2)}ms medianTimeB=${median(b.timeB).toFixed(2)}ms ` +
      `aFasterRate=${aFasterRate.toFixed(3)}`
  );

  // 释放偏差：双方必须在同一个 GO 时刻释放
  assert(percentile(skew, 50) < 1000, `释放偏差中位数应 < 1ms，实际 ${percentile(skew, 50).toFixed(1)}µs`);
  assert(percentile(skew, 95) < 5000, `释放偏差 p95 应 < 5ms，实际 ${percentile(skew, 95).toFixed(1)}µs`);
  assert(skew[skew.length - 1] < 50_000, `释放偏差最大值应 < 50ms，实际 ${skew[skew.length - 1].toFixed(1)}µs`);

  // 同一算法两侧：谁更快的比例必须接近 0.5（P2-2）
  // 样本量不足时比例本身没有统计意义，只在正式轮数下断言。
  if (b.rounds >= 100) {
    assert(
      aFasterRate > 0.4 && aFasterRate < 0.6,
      `「A 更快」的比例必须接近 0.5，实际 ${aFasterRate.toFixed(3)}（存在顺序偏差）`
    );
    assert(
      Math.abs(median(diffs)) < 5,
      `两侧耗时差中位数应接近 0ms，实际 ${median(diffs).toFixed(2)}ms`
    );
  }
});

test(`timing-fairness: 配对换序 ${ROUNDS_SWAP}×2 轮 —— 胜率无顺序偏移`, async () => {
  const s = await swapBatch(ROUNDS_SWAP);
  assert(s.rounds >= MIN_ROUNDS, `有效配对数必须 ≥ ${MIN_ROUNDS}，实际 ${s.rounds}`);

  const rateA = s.xWinsWhenA / s.rounds;
  const rateB = s.xWinsWhenB / s.rounds;
  console.log(
    `    [fairness-swap] pairs=${s.rounds} X胜率(当A)=${rateA.toFixed(3)} X胜率(当B)=${rateB.toFixed(3)} ` +
      `Δ=${Math.abs(rateA - rateB).toFixed(3)} medianTimeX(A)=${median(s.timeXasA).toFixed(2)}ms ` +
      `medianTimeX(B)=${median(s.timeXasB).toFixed(2)}ms`
  );

  if (s.rounds >= 100) {
    assert(
      Math.abs(rateA - rateB) < 0.15,
      `同一算法换序后的胜率差必须 < 0.15，实际 ${Math.abs(rateA - rateB).toFixed(3)}（存在顺序偏差）`
    );
  }
  assert(
    Math.abs(median(s.timeXasA) - median(s.timeXasB)) < 50,
    `同一算法在两个位置上的耗时中位数差应 < 50ms，实际 ${Math.abs(
      median(s.timeXasA) - median(s.timeXasB)
    ).toFixed(2)}ms`
  );
});

test('timing-fairness: 双方 computeTimeMs 都相对同一个 release 时刻', async () => {
  // 结构性断言：runDuel 返回的 releaseSkewUs 是两个 GO 写入之间的偏差，
  // 若它远小于单次计算耗时，则说明计时基准是共享的（P1-10）。
  const root = tmpDir('fairness-shared');
  const sealedRoot = path.join(root, 'artifacts', 'sealed');
  const sandboxRoot = path.join(root, 'sandboxes');
  const seal = sealPackage({ team: 'A', sourceDir: STARTER, sealRoot: sealedRoot, matchId: 'FAIR-SHARED' });
  const map = generateMapOrNull({ seed: 424_242, pointCount: 8, difficulty: 'medium' });
  assert(map && seal.sealed, '前置条件应满足');
  const core = coreFor(map!);

  const duel = await runDuel({
    matchId: 'FAIR-SHARED',
    roundNumber: 1,
    sandboxRoot,
    teamA: { packageDir: seal.sealed!.sealedDir, entry: 'solver.py', payloadJson: runnerPayloadJson(core, 'A') },
    teamB: { packageDir: seal.sealed!.sealedDir, entry: 'solver.py', payloadJson: runnerPayloadJson(core, 'B') },
    denyReadPaths: [sealedRoot, PLATFORM_ROOT],
    timeoutMs: 3000,
  });
  assert(duel.a.success && duel.b.success, '双方应成功');
  assert(duel.releaseSkewUs < 5000, `释放偏差 ${duel.releaseSkewUs.toFixed(1)}µs 应远小于计算耗时`);
  assert(duel.readySkewMs >= 0, 'readySkewMs 应可测量');
  assertEqual(
    Math.abs(duel.a.computeTimeMs - duel.b.computeTimeMs) < 200,
    true,
    '同一算法的两侧耗时差应在 200ms 内'
  );
});

void runAll('timing-fairness');
