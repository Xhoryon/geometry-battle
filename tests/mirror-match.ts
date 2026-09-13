/**
 * mirror-match —— 平台镜像公平性 Level 6：真沙箱整场对局（V1.4 任务书 §7）
 *
 * symmetry-probe vs symmetry-probe 在 map(seed) 上打一整场；再让引擎拿到 M(map(seed))
 * 打第二场。probe 在局部前进坐标里计算，镜像输入必然给出逐位镜像的函数
 * （见 tests/fixtures/algos/symmetry-probe/solver.py 头部证明），因此两场之间任何
 * **语义**差异都只能来自平台：引擎 / 校验 / 输入协议 / 沙箱。
 *
 * 引擎怎么拿到镜像地图：Match.ts 以 CommonJS 导入 `generateMapOrNull`，这里替换该模块
 * 导出对象上的属性，让第二场的每次调用（含 preflight 的 decoy 世界）都返回镜像图。
 * 替换是否真的生效由断言证明：引擎快照里的地图 / Emitter 必须与 mirrorMap 逐字段相等。
 *
 * firstSolver 允许不同（它取决于两个沙箱的实际耗时），只记录不断言。
 * 沙箱里 probe 若 TIMEOUT / CRASH / INVALID，用例以 'environment/probe' 明确失败并带负载，
 * 而不是把一场「一方没出手」的比赛当成通过。
 */

import * as os from 'os';
import * as path from 'path';
import { CanonicalNode, evaluateNode } from '../src/core/Ast';
import { MatchLog, Replay } from '../src/core/Logs';
import { MatchEngine } from '../src/core/Match';
import { Point } from '../src/field/Field';
import { GeneratedMap, MapConfig, generateMapOrNull } from '../src/map/MapGenerator';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import * as M from './mirror-helpers';

const PROBE = path.join(__dirname, 'fixtures', 'algos', 'symmetry-probe');

// Match.ts 编译后按属性访问 `MapGenerator_1.generateMapOrNull`，替换导出对象上的属性即可生效。
// 原函数先捕获：本文件自己算地图时也必须用未替换的版本。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MG = require('../src/map/MapGenerator') as { generateMapOrNull: typeof generateMapOrNull };
const ORIGINAL_GENERATE = MG.generateMapOrNull;

async function withMirroredGenerator<T>(fn: () => Promise<T>): Promise<T> {
  MG.generateMapOrNull = (cfg: MapConfig) => {
    const map = ORIGINAL_GENERATE(cfg);
    return map ? M.mirrorMap(map) : null;
  };
  try {
    return await fn();
  } finally {
    MG.generateMapOrNull = ORIGINAL_GENERATE;
  }
}

interface Played {
  log: MatchLog;
  replay: Replay;
  map: GeneratedMap;
  emitters: { A: { id: string; position: Point }; B: { id: string; position: Point } };
}

interface Scenario {
  seed: number;
  pointCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

const SCENARIOS: Scenario[] = [
  { seed: 20260913, pointCount: 6, difficulty: 'easy' },
  { seed: 4242, pointCount: 8, difficulty: 'medium' },
  { seed: 31337, pointCount: 8, difficulty: 'hard' },
  { seed: 777031, pointCount: 6, difficulty: 'hard' },
];

const loadNow = () => `load=${os.loadavg().map((v) => v.toFixed(2)).join('/')}`;

async function playProbeMatch(s: Scenario, tag: string): Promise<Played> {
  const root = tmpDir(`mirror-${tag}`);
  const engine = new MatchEngine({
    matchId: `MIRROR-${s.seed}`,
    seed: s.seed,
    pointCount: s.pointCount,
    difficulty: s.difficulty,
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    slotRoot: path.join(root, 'slots'),
  });
  const upA = engine.upload('A', PROBE);
  assert(upA.ok, `上传 A 失败: ${upA.errors.join('; ')}`);
  const upB = engine.upload('B', PROBE);
  assert(upB.ok, `上传 B 失败: ${upB.errors.join('; ')}`);
  const pre = await engine.preflight();
  assert(pre.ok, `environment/probe: preflight 失败（${loadNow()}）: ${pre.errors.join('; ')}`);
  const started = engine.startMatch();
  assert(started.ok, `开始比赛失败: ${started.errors.join('; ')}`);
  engine.autoSelectEmitters();
  const map = engine.getSnapshot().map;
  assert(map !== null, '开赛后应有地图');
  const emitters = engine.getEmitters();

  let guard = 0;
  while (engine.getWinner() === null && engine.endReason() === 'NONE') {
    const r = await engine.runRound();
    // 环境护栏：probe 是确定性的、< 20 ms 的纯 Python；任何失败码都说明是机器负载或沙箱环境，
    // 这种回合里一方没出手，镜像比较就失去了意义 —— 明确失败，不静默放过。
    for (const team of ['A', 'B'] as const) {
      const code = team === 'A' ? r.log.aErrorCode : r.log.bErrorCode;
      assert(
        code === null,
        `environment/probe: seed=${s.seed} ${tag} 第 ${r.round} 轮 ${team} 失败码 ${code}（result=${r.log.result}，${loadNow()}，耗时 A=${r.computeTimeMs.A} B=${r.computeTimeMs.B} ms）`
      );
    }
    assert(++guard <= 70, `回合数异常（>70），HARD_ROUND_LIMIT 应已终止比赛`);
  }
  return { log: engine.getMatchLog(), replay: engine.getReplay(), map: map!, emitters };
}

const swapWinner = (w: 'A' | 'B' | 'draw'): 'A' | 'B' | 'draw' => (w === 'draw' ? 'draw' : M.swapTeam(w));
const sorted = (ids: readonly string[]) => [...ids].sort();

function assertMirroredPoint(actual: Point | null, expected: Point | null, tol: number, what: string): void {
  assertEqual(actual === null, expected === null, `${what}: 有/无`);
  if (!actual || !expected) return;
  assert(Math.abs(actual.x + expected.x) <= tol && Math.abs(actual.y - expected.y) <= tol, `${what}: 应为镜像点 ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
}

/** 两个 AST 在镜像采样点上逐位同值：f'(−x) === f(x) */
function assertMirroredFunction(fMirror: unknown, fOrig: unknown, what: string): void {
  assertEqual(fMirror === null, fOrig === null, `${what}: 函数有/无`);
  if (!fMirror || !fOrig) return;
  for (let k = 0; k <= 80; k++) {
    const x = -20 + k * 0.5;
    const a = evaluateNode(fOrig as CanonicalNode, x);
    const b = evaluateNode(fMirror as CanonicalNode, M.mirrorX(x));
    assert(a === b, `${what}: f'(−x) 应与 f(x) 逐位相等 (x=${x}: ${a} vs ${b})`);
  }
}

interface Tally {
  rounds: number;
  kills: number;
  trajectoryPoints: number;
  bitExactX: number;
  firstSolver: Record<string, number>;
}

function comparePair(orig: Played, mirror: Played, s: Scenario, tally: Tally): void {
  const tag = `seed=${s.seed}/${s.difficulty}/${s.pointCount}p`;

  // ---- 替换真的生效了：引擎拿到的是镜像世界 ----
  assertEqual(mirror.map, M.mirrorMap(orig.map), `${tag}: 第二场的地图必须是第一场的镜像（生成器替换未生效？）`);
  assertEqual(mirror.emitters.A.position, M.mirrorPoint(orig.emitters.B.position), `${tag}: Emitter A' = M(Emitter B)`);
  assertEqual(mirror.emitters.B.position, M.mirrorPoint(orig.emitters.A.position), `${tag}: Emitter B' = M(Emitter A)`);

  // ---- 终局 ----
  assertEqual(mirror.log.winner, swapWinner(orig.log.winner), `${tag}: 胜者应互换（draw 不变）`);
  assertEqual(mirror.log.endReason, orig.log.endReason, `${tag}: 结束原因`);
  assertEqual(mirror.log.rounds.length, orig.log.rounds.length, `${tag}: 回合数`);
  assertEqual(mirror.log.finalAlive, { A: orig.log.finalAlive.B, B: orig.log.finalAlive.A }, `${tag}: 最终存活互换`);
  assertEqual(mirror.replay.frames.length, orig.replay.frames.length, `${tag}: 回放帧数`);

  // ---- 逐回合 ----
  for (let i = 0; i < orig.log.rounds.length; i++) {
    const o = orig.log.rounds[i];
    const m = mirror.log.rounds[i];
    const rt = `${tag} 第 ${o.round} 轮`;
    assertEqual(m.round, o.round, `${rt}: 回合号`);
    assertEqual(m.aKills, o.bKills, `${rt}: aKills' = bKills`);
    assertEqual(m.bKills, o.aKills, `${rt}: bKills' = aKills`);
    assertEqual(m.aHits, o.bHits.map(M.mirrorId), `${rt}: aHits' = relabel(bHits)（含传播顺序）`);
    assertEqual(m.bHits, o.aHits.map(M.mirrorId), `${rt}: bHits' = relabel(aHits)`);
    assertEqual(m.aBlocked, o.bBlocked, `${rt}: aBlocked' = bBlocked`);
    assertEqual(m.bBlocked, o.aBlocked, `${rt}: bBlocked' = aBlocked`);
    assertEqual({ A: m.aliveAAfter, B: m.aliveBAfter }, { A: o.aliveBAfter, B: o.aliveAAfter }, `${rt}: 存活数互换`);
    assertEqual(m.attacksExecuted.length, o.attacksExecuted.length, `${rt}: 出手次数`);
    assertEqual(m.mutualElimination, o.mutualElimination, `${rt}: 同归于尽`);
    assertEqual(m.noProgressStreak, o.noProgressStreak, `${rt}: 僵持计数`);
    tally.firstSolver[`${o.firstSolver}→${m.firstSolver}`] = (tally.firstSolver[`${o.firstSolver}→${m.firstSolver}`] ?? 0) + 1;
    tally.rounds++;
    tally.kills += o.aKills + o.bKills;

    const of = orig.replay.frames[i];
    const mf = mirror.replay.frames[i];
    assertEqual(sorted(mf.killed), sorted(of.killed.map(M.mirrorId)), `${rt}: 回放 killed 重标后相等`);
    assertMirroredFunction(mf.functionA, of.functionB, `${rt}: functionA' ↔ functionB`);
    assertMirroredFunction(mf.functionB, of.functionA, `${rt}: functionB' ↔ functionA`);
    for (const [mine, theirs, label] of [
      [mf.trajectoryA, of.trajectoryB, 'trajectoryA\' ↔ trajectoryB'],
      [mf.trajectoryB, of.trajectoryA, 'trajectoryB\' ↔ trajectoryA'],
    ] as const) {
      assertEqual(mine.length, theirs.length, `${rt}: ${label} 点数`);
      for (let k = 0; k < mine.length; k++) {
        assertMirroredPoint(mine[k], theirs[k], 1e-9, `${rt}: ${label} 点 ${k}`);
        if (mine[k].x + theirs[k].x === 0 && mine[k].y === theirs[k].y) tally.bitExactX++;
        tally.trajectoryPoints++;
      }
    }
    for (const [mine, theirs, label] of [
      [mf.hitsA, of.hitsB, 'hitsA\' ↔ hitsB'],
      [mf.hitsB, of.hitsA, 'hitsB\' ↔ hitsA'],
    ] as const) {
      assertEqual(mine.map((h) => h.id), theirs.map((h) => M.mirrorId(h.id)), `${rt}: ${label} id 顺序`);
      for (let k = 0; k < mine.length; k++) assertMirroredPoint(mine[k].at, theirs[k].at, 1e-9, `${rt}: ${label} 命中点 ${k}`);
    }
    assertMirroredPoint(mf.blockedA, of.blockedB, 1e-9, `${rt}: blockedA' ↔ blockedB`);
    assertMirroredPoint(mf.blockedB, of.blockedA, 1e-9, `${rt}: blockedB' ↔ blockedA`);
    assertEqual(mf.aliveBefore.map((p) => ({ id: p.id, team: p.team, position: p.position })).sort((a, b) => a.id.localeCompare(b.id)),
      of.aliveBefore.map((p) => ({ id: M.mirrorId(p.id), team: M.swapTeam(p.team), position: M.mirrorPoint(p.position) })).sort((a, b) => a.id.localeCompare(b.id)),
      `${rt}: 开战前存活名单镜像`);
  }
}

test('L6: symmetry-probe 自战 —— 引擎在 map(seed) 与 M(map(seed)) 上给出镜像的整场结果', async () => {
  console.log(`      开始：${loadNow()}`);
  const tally: Tally = { rounds: 0, kills: 0, trajectoryPoints: 0, bitExactX: 0, firstSolver: {} };
  const lines: string[] = [];
  for (const s of SCENARIOS) {
    const t0 = Date.now();
    const orig = await playProbeMatch(s, 'orig');
    const mirror = await withMirroredGenerator(() => playProbeMatch(s, 'mirror'));
    assert(MG.generateMapOrNull === ORIGINAL_GENERATE, '生成器替换必须在第二场后还原');
    comparePair(orig, mirror, s, tally);
    lines.push(
      `seed=${s.seed} ${s.difficulty} ${s.pointCount}p: winner ${orig.log.winner}→${mirror.log.winner}, ` +
        `${orig.log.endReason}, ${orig.log.rounds.length} 轮, firstSolver ${orig.log.rounds.map((r) => r.firstSolver).join('')} | ${mirror.log.rounds.map((r) => r.firstSolver).join('')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
  }
  for (const l of lines) console.log(`      ${l}`);
  console.log(
    `      合计 ${tally.rounds} 回合 / ${tally.kills} 次击杀 / 回放轨迹点 ${tally.trajectoryPoints}（逐位镜像 ${tally.bitExactX}）；` +
      `firstSolver 原→镜 ${JSON.stringify(tally.firstSolver)}；结束：${loadNow()}`
  );
  assert(tally.kills > 0, '整场自战没有任何击杀，Level 6 没有判别力（检查 probe / 地图）');
});

void runAll('mirror-match');
