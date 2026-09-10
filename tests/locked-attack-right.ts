/**
 * locked-attack-right —— START 之后双方获得本轮独立且不可撤销的攻击权
 *
 * 规则沿革：
 *   - V1.0 / V1.1 Rev 1：先手击杀对方 Shooter ⇒ 对方本轮攻击被取消。
 *   - V1.1 Rev 2：取消规则废止，改为「锁定攻击权」；Shooter 成为数学发射锚点，
 *     但仍从每轮的存活点里选，仍可能被击杀。
 *   - **V1.1 Rev 3（本文件对齐的版本）**：发射锚点变成**固定 Emitter** ——
 *     整场不变、不可击杀、不是战斗点（§2–§4/§7）。因此「Shooter 死了攻击还打不打」
 *     这个问题在 Rev 3 下**不再存在**：Emitter 不会死。
 *
 * 那这个套件还测什么？测**锁定攻击权的实质**：
 *   - 双方合法函数都必须完成本轮攻击，不论对方这一轮打掉了什么；
 *   - 攻击不执行的唯一原因是算法侧 TIMEOUT / INVALID / CRASH；
 *   - 先手顺序由实测耗时决定，不是常量；
 *   - 双方同时归零判 DRAW，不得因为谁是先手就判谁赢。
 *
 * 「Emitter 不可击杀 / 不计入存活」这类**结构**断言在 `fixed-emitter` 套件里。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { EMITTERS } from '../src/core/Rules';
import { judgeShot } from '../src/core/Judge';
import { MatchEngine, PointState, resolveOrderedShots } from '../src/core/Match';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const SNIPER = path.join(__dirname, 'fixtures', 'algos', 'sniper');
const SLOW_SNIPER = path.join(__dirname, 'fixtures', 'algos', 'slow-sniper');

/** 造一条过两点、方向 +x 的直线 AST */
function lineAst(from: { x: number; y: number }, to: { x: number; y: number }): CanonicalNode {
  const dx = to.x - from.x;
  const m = Math.abs(dx) < 1e-9 ? 0 : (to.y - from.y) / dx;
  const node = {
    type: 'add',
    args: [
      { type: 'number', value: from.y },
      {
        type: 'mul',
        args: [
          { type: 'number', value: m },
          { type: 'sub', args: [{ type: 'variable', value: 'x' }, { type: 'number', value: from.x }] },
        ],
      },
    ],
  };
  const r = parseCanonicalDSL(node);
  assert(r.ok && r.ast, '构造的直线 AST 必须合法');
  return r.ast!;
}

function mkPoint(id: string, team: 'A' | 'B', x: number, y: number): PointState {
  return { id, team, position: { x, y }, alive: true };
}

// ---------------------------------------------------------------------------
// 内联算法包
// ---------------------------------------------------------------------------

function writePkg(dir: string, source: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name, version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
  fs.writeFileSync(path.join(dir, 'solver.py'), source);
  return dir;
}

/**
 * 「从固定 Emitter 瞄准存活敌人中 id 最小者画直线」——脚本化对局用。
 *
 * 双方用同一份代码：每一轮各自打掉对方一个战斗点，于是双方同步衰减。
 */
const AIM_LOWEST_ALIVE = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
enemy = "B" if args.team == "A" else "A"
targets = sorted((pt for pt in public["points"] if pt["team"] == enemy and pt["alive"]),
                 key=lambda pt: pt["id"])
if targets:
    t = targets[0]
    dx = t["x"] - me["x"]
    m = 0.0 if abs(dx) < 1e-9 else (t["y"] - me["y"]) / dx
else:
    m = 0.0
emit({"type": "add", "args": [
    {"type": "number", "value": me["y"]},
    {"type": "mul", "args": [
        {"type": "number", "value": m},
        {"type": "sub", "args": [{"type": "variable", "value": "x"},
                                 {"type": "number", "value": me["x"]}]}]}]})
`;

/**
 * R3 用的算法：preflight（decoy，`round == 0`）正常求解，正式回合睡到超时。
 *
 * 为什么按 round 分岔：preflight 复用同一个 timeoutMs，若在 decoy 世界也睡，
 * preflight 直接就失败了，根本走不到正式回合。`round == 0` 是 decoy 世界的
 * 既有判别标志（`tests/hostile-input.ts` 同款约定）。
 */
const TIMEOUT_IN_ROUND = `import json, os, time
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
enemy = "B" if args.team == "A" else "A"
targets = sorted((pt for pt in public["points"] if pt["team"] == enemy and pt["alive"]),
                 key=lambda pt: pt["id"])
if public.get("round", 0) != 0:
    time.sleep(10.0)
if targets:
    t = targets[0]
    dx = t["x"] - me["x"]
    m = 0.0 if abs(dx) < 1e-9 else (t["y"] - me["y"]) / dx
else:
    m = 0.0
emit({"type": "add", "args": [
    {"type": "number", "value": me["y"]},
    {"type": "mul", "args": [
        {"type": "number", "value": m},
        {"type": "sub", "args": [{"type": "variable", "value": "x"},
                                 {"type": "number", "value": me["x"]}]}]}]})
`;

/** R4 用的算法：preflight 正常，正式回合输出非法 DSL（variable 的 value 不是 "x"） */
const INVALID_IN_ROUND = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
if public.get("round", 0) != 0:
    emit({"type": "variable", "value": "y"})
else:
    emit({"type": "add", "args": [
        {"type": "number", "value": me["y"]},
        {"type": "mul", "args": [{"type": "number", "value": 0.0},
                                 {"type": "variable", "value": "x"}]}]})
`;


/**
 * 找一个「从固定 Emitter 出发的狙击线畅通且确实命中」的种子。
 *
 * 发射锚点改成常量之后，能否命中完全取决于该局的地图 —— 因此必须搜种子，
 * 不能像旧版那样假定「A1→B1 直线」总有解。
 */
function findEmitterHitSeed(): number {
  for (let seed = 1; seed < 20000; seed++) {
    const map = generateMapOrNull({ seed, pointCount: 6, difficulty: 'easy' });
    if (!map) continue;
    const enemies = map.teamB.map((p, i) => ({ id: `B${i + 1}`, position: p }));
    const out = judgeShot(lineAst(EMITTERS.A, map.teamB[0]), EMITTERS.A, 'A', enemies, map.obstacles);
    if (!out.blocked && out.hits.includes('B1')) return seed;
  }
  throw new Error('未找到「Emitter A → B1」畅通且命中的种子');
}

/** 找一个「双方都能从各自 Emitter 命中对方」的种子（R6 之外的端到端用例用） */
function findMutualHitSeed(): number {
  for (let seed = 1; seed < 20000; seed++) {
    const map = generateMapOrNull({ seed, pointCount: 6, difficulty: 'easy' });
    if (!map) continue;
    const ea = map.teamB.map((p, i) => ({ id: `B${i + 1}`, position: p }));
    const eb = map.teamA.map((p, i) => ({ id: `A${i + 1}`, position: p }));
    const oa = judgeShot(lineAst(EMITTERS.A, map.teamB[0]), EMITTERS.A, 'A', ea, map.obstacles);
    const ob = judgeShot(lineAst(EMITTERS.B, map.teamA[0]), EMITTERS.B, 'B', eb, map.obstacles);
    if (!oa.blocked && oa.hits.includes('B1') && !ob.blocked && ob.hits.includes('A1')) return seed;
  }
  throw new Error('未找到双方都能命中的种子');
}

// ---------------------------------------------------------------------------
// 引擎驱动
// ---------------------------------------------------------------------------

interface EngineOpts {
  matchId: string;
  seed: number;
  pointCount?: number;
  timeoutMs?: number;
}

function makeEngine(o: EngineOpts): MatchEngine {
  const root = tmpDir('locked-attack');
  return new MatchEngine({
    matchId: o.matchId,
    seed: o.seed,
    pointCount: o.pointCount ?? 6,
    difficulty: 'easy',
    timeoutMs: o.timeoutMs,
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
}

async function playOneRound(
  matchId: string,
  seed: number,
  algoA: string,
  algoB: string,
  timeoutMs?: number
): Promise<{ engine: MatchEngine; result: Awaited<ReturnType<MatchEngine['runRound']>> }> {
  const engine = makeEngine({ matchId, seed, timeoutMs });
  assert(engine.upload('A', algoA).ok, 'A 应能上传');
  assert(engine.upload('B', algoB).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  engine.startMatch();

  // Rule Revision 3 §5：没有任何选点/锁定动作，直接开一轮。
  const result = await engine.runRound();
  return { engine, result };
}

// ===========================================================================
// R1 —— 先手打掉对方一个战斗点，后手的攻击照样执行（结构性）
// ===========================================================================

test('R1: 先手打掉对方战斗点后，后手的攻击仍然执行（结构性）', () => {
  const points = [mkPoint('A1', 'A', -10, 0), mkPoint('B1', 'B', 10, 0), mkPoint('B2', 'B', 15, 5)];
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points,
    ast: {
      A: lineAst(EMITTERS.A, { x: 10, y: 0 }), // A 命中 B1
      B: lineAst(EMITTERS.B, { x: -10, y: 0 }), // B 命中 A1
    },
    obstacles: [],
    emitters: { A: EMITTERS.A, B: EMITTERS.B },
  });

  assert(r.shots.A !== null, '先手方必须完成射击');
  assert(r.killed.includes('B1'), 'A 的射击必须击杀 B1');
  assert(
    r.shots.B !== null,
    '先手打掉了对方一个点 **不再**影响对方本轮的攻击 —— B 必须开火'
  );
  assert(r.killed.includes('A1'), 'B 的攻击必须真的落地（命中 A1），而不是被跳过');
  assertEqual(points.find((p) => p.id === 'B2')!.alive, true, 'B2 不在弹道上，不应被误杀');
});

test('R5: 双方互相击杀时，两次攻击都结算', () => {
  const points = [mkPoint('A1', 'A', -10, 0), mkPoint('B1', 'B', 10, 0)];
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points,
    ast: {
      A: lineAst(EMITTERS.A, { x: 10, y: 0 }),
      B: lineAst(EMITTERS.B, { x: -10, y: 0 }),
    },
    obstacles: [],
    emitters: { A: EMITTERS.A, B: EMITTERS.B },
  });

  assert(r.shots.A !== null && r.shots.B !== null, '双方都必须开火');
  assertEqual([...r.killed].sort(), ['A1', 'B1'], '两边的战斗点都应阵亡');
  assertEqual(points.filter((p) => p.alive).length, 0, '双方战斗点都应归零');
});

// ===========================================================================
// R2 —— 后手慢一拍交卷，仍然开火（端到端）
// ===========================================================================

test('R2: 后手较晚才交出合法解 —— 仍然开火', async () => {
  const { result } = await playOneRound('LOCKED-R2', findMutualHitSeed(), SNIPER, SLOW_SNIPER);

  assertEqual(result.firstSolver, 'A', 'A（立即求解）应是先手');
  assert(result.killed.length > 0, `先手应至少击杀一个战斗点，实际 [${result.killed.join(',')}]`);
  assertEqual(result.log.attacksExecuted, ['A', 'B'], '两次攻击都必须执行');
  assert(result.hits.B.length > 0, `B 的攻击必须落到实地，实际 [${result.hits.B.join(',')}]`);
  assertEqual(result.cancelled.B, false, 'Rev 2 起不存在取消；Rev 3 下 Emitter 根本不会死');
  assertEqual(result.log.cancelledB, false, '日志中 B 也不得被记成取消');
  assert(result.log.result !== 'CANCELLED_B', '结果码不得再出现 CANCELLED_B');
});

// ===========================================================================
// R3 —— 后手超时 → 不攻击，原因是 TIMEOUT 不是 CANCELLED
// ===========================================================================

test('R3: 后手超时 —— 不攻击，原因是 TIMEOUT 而不是 CANCELLED', async () => {
  const root = tmpDir('locked-r3');
  const slowPkg = writePkg(path.join(root, 'slow'), TIMEOUT_IN_ROUND, 'timeout-in-round');

  const { result } = await playOneRound('LOCKED-R3', findEmitterHitSeed(), SNIPER, slowPkg, 2000);

  assertEqual(result.log.bErrorCode, 'TIMEOUT', 'B 的错误码必须是 TIMEOUT');
  assertEqual(result.log.result, 'TIMEOUT_B', '回合结果码必须是 TIMEOUT_B');
  assertEqual(result.cancelled.B, false, 'TIMEOUT 绝不能被记成取消');
  assert(result.log.result !== 'CANCELLED_B', 'TIMEOUT ≠ 取消');
  assertEqual(result.log.attacksExecuted, ['A'], 'B 没有合法解 —— 不应出现在执行列表里');
  assertEqual(result.hits.B.length, 0, 'B 不得产生任何命中');
});

// ===========================================================================
// R4 —— 后手输出非法 → 不攻击
// ===========================================================================

test('R4: 后手输出非法 —— 不攻击，且不是取消', async () => {
  const root = tmpDir('locked-r4');
  const badPkg = writePkg(path.join(root, 'bad'), INVALID_IN_ROUND, 'invalid-in-round');

  const { result } = await playOneRound('LOCKED-R4', findEmitterHitSeed(), SNIPER, badPkg);

  assertEqual(result.log.result, 'INVALID_B', '回合结果码必须是 INVALID_B');
  assertEqual(result.cancelled.B, false, 'INVALID 绝不能被记成取消');
  assert(result.log.result !== 'CANCELLED_B', 'INVALID ≠ 取消');
  assertEqual(result.log.attacksExecuted, ['A'], 'B 没有合法解 —— 不应出现在执行列表里');
  assertEqual(result.hits.B.length, 0, 'B 不得产生任何命中');
});

// ===========================================================================
// VER-1（Re-Gate Cycle 2 记录的洞）—— 先手顺序必须由**实测耗时**决定
// ===========================================================================

test('VER-1: A 慢 B 快时，先手必须是 B（先手顺序不是常量）', async () => {
  // 负向回归：此前套件里 A 用的算法天然更快，因此「先手恒为 A」的实现也能全绿
  // （Re-Gate Cycle 2 VER-1 记录的逃逸）。这里把慢的放在 A 位，先手必须翻过来。
  const root = tmpDir('locked-ver1');
  const slowSrc = AIM_LOWEST_ALIVE.replace('import json, os\n', 'import json, os, time\ntime.sleep(0.25)\n');
  const slow = writePkg(path.join(root, 'slow'), slowSrc, 'slow-a');
  const fast = writePkg(path.join(root, 'fast'), AIM_LOWEST_ALIVE, 'fast-b');

  const { result } = await playOneRound('LOCKED-VER1', 880011, slow, fast);

  assertEqual(result.firstSolver, 'B', 'A 慢 B 快时先手必须是 B —— 先手不是常量');
  assertEqual(
    result.log.attacksExecuted[0],
    'B',
    `实际执行顺序必须由先手开始，实际 [${result.log.attacksExecuted.join(',')}]`
  );
  assert(result.log.aTimeMs !== null && result.log.bTimeMs !== null, '双方都应有实测耗时');
  assert(
    (result.log.bTimeMs as number) < (result.log.aTimeMs as number),
    `B 的耗时必须显著更短：A=${result.log.aTimeMs}ms B=${result.log.bTimeMs}ms`
  );
});

// ===========================================================================
// R6 端到端 —— 脚本化对局：每轮双方各掉一个点，最终同归于尽 → 平局
// ===========================================================================

/**
 * 找一个种子，使「从固定 Emitter 到每个敌方战斗点的直线」全部畅通、
 * 且**恰好**只命中目标本身（不顺手多杀）。
 *
 * 发射锚点是常量（±18, 0），因此这里的几何比对旧版简单得多：
 * 只要每个方向上的射线不穿过第二个点即可。
 */
function findScriptedSeed(): number {
  for (let seed = 1; seed < 20000; seed++) {
    const map = generateMapOrNull({ seed, pointCount: 6, difficulty: 'easy' });
    if (!map) continue;
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) {
      const enemyOfA = map.teamB.slice(k).map((p, i) => ({ id: `B${k + i + 1}`, position: p }));
      const enemyOfB = map.teamA.slice(k).map((p, i) => ({ id: `A${k + i + 1}`, position: p }));
      const ra = judgeShot(lineAst(EMITTERS.A, map.teamB[k]), EMITTERS.A, 'A', enemyOfA, map.obstacles);
      const rb = judgeShot(lineAst(EMITTERS.B, map.teamA[k]), EMITTERS.B, 'B', enemyOfB, map.obstacles);
      if (ra.blocked || rb.blocked) ok = false;
      else if (ra.hits.length !== 1 || ra.hits[0] !== `B${k + 1}`) ok = false;
      else if (rb.hits.length !== 1 || rb.hits[0] !== `A${k + 1}`) ok = false;
    }
    if (ok) return seed;
  }
  throw new Error('未找到可用于同归于尽脚本的种子');
}

test('R6: 同一轮结束后双方同时归零 —— MUTUAL_ELIMINATION / DRAW', async () => {
  const seed = findScriptedSeed();
  const pkg = writePkg(path.join(tmpDir('locked-r6'), 'aim-lowest'), AIM_LOWEST_ALIVE, 'aim-lowest');

  const engine = makeEngine({ matchId: 'LOCKED-R6', seed });
  assert(engine.upload('A', pkg).ok, 'A 应能上传');
  assert(engine.upload('B', pkg).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  engine.startMatch();

  const rounds: Awaited<ReturnType<MatchEngine['runRound']>>[] = [];
  for (let k = 1; k <= 6; k++) {
    // 没有任何选点动作 —— 每轮直接跑（Rule Revision 3 §5）
    rounds.push(await engine.runRound());
  }

  for (const r of rounds) {
    assertEqual(
      [...r.log.attacksExecuted].sort(),
      ['A', 'B'],
      `第 ${r.round} 轮两次攻击都必须执行，实际 [${r.log.attacksExecuted.join(',')}]`
    );
    assertEqual(r.killed.length, 2, `第 ${r.round} 轮双方应各掉一个点，实际 [${r.killed.join(',')}]`);
  }

  const last = rounds[rounds.length - 1];
  assertEqual(last.aliveAfter, { A: 0, B: 0 }, '第 6 轮结束后双方都应归零');
  assertEqual(last.mutualElimination, true, '该轮必须被标记为同归于尽');
  assertEqual(last.winner, 'draw', '同归于尽必须判平局 —— 不得因为 A 是先手就判 A 胜');
  assertEqual(engine.getWinner(), 'draw', '最终胜者必须是 draw');
  assertEqual(engine.endReason(), 'MUTUAL_ELIMINATION', '结束原因必须是 MUTUAL_ELIMINATION');
  assertEqual(engine.getMatchLog().endReason, 'MUTUAL_ELIMINATION', '落盘日志必须记录结束原因');
  assertEqual(engine.getMatchLog().winner, 'draw', '落盘日志的 winner 必须是 draw');
});

// ===========================================================================
// R8 —— 每轮锚点恒为同一 Emitter：没有第二次计算，也没有重选
// ===========================================================================

test('R8: 每轮的发射锚点都是同一个固定 Emitter（不重选、不重算）', async () => {
  const { engine, result } = await playOneRound('LOCKED-R8', findEmitterHitSeed(), SNIPER, SLOW_SNIPER);

  assertEqual(result.emitterA, 'A0', 'A 的锚点标识整场固定');
  assertEqual(result.emitterB, 'B0', 'B 的锚点标识整场固定');
  assertEqual(result.log.emitterA, 'A0', '日志必须记录同一个锚点');

  const snap = engine.getSnapshot();
  assertEqual(snap.emitters!.A.position, EMITTERS.A, '锚点坐标必须等于全局常量');
  assertEqual(snap.emitters!.B.position, EMITTERS.B, '锚点坐标必须等于全局常量');

  // 单轮单次计算：只有一个耗时记录，输入哈希也只有一份
  assert(result.computeTimeMs.B !== null, 'B 仍只有一次计算的耗时记录');
  assertEqual(result.log.publicStateHash, result.publicStateHash, '本轮输入必须仍是那一份冻结字节');
});

// ===========================================================================
// 与规则无关、随本套件保留的既有覆盖
// ===========================================================================

test('并列先手时双方基于同一快照同时开火', () => {
  const points = [mkPoint('A1', 'A', -10, 0), mkPoint('B1', 'B', 10, 0)];
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: true,
    points,
    ast: {
      A: lineAst(EMITTERS.A, { x: 10, y: 0 }),
      B: lineAst(EMITTERS.B, { x: -10, y: 0 }),
    },
    obstacles: [],
    emitters: { A: EMITTERS.A, B: EMITTERS.B },
  });
  assert(r.shots.A !== null && r.shots.B !== null, '并列先手时双方都必须开火');
  assert(r.killed.includes('A1') && r.killed.includes('B1'), '双方都应被击杀');
  assertEqual(points.filter((p) => p.alive).length, 0, '击杀在双方都结算后统一应用');
});

test('反向攻击不会命中自己后方的敌人', () => {
  const ast = lineAst({ x: -10, y: 0 }, { x: 10, y: 0 });
  const outcome = judgeShot(
    ast,
    { x: -10, y: 0 },
    'A',
    [
      { id: 'BEHIND', position: { x: -15, y: 0 } },
      { id: 'AHEAD', position: { x: 5, y: 0 } },
    ],
    []
  );
  assert(outcome.hits.includes('AHEAD'), '正前方的敌人应被命中');
  assert(!outcome.hits.includes('BEHIND'), '身后的敌人不应被命中');
});

void runAll('locked-attack-right');
