/**
 * locked-attack-right —— START 之后双方获得本轮独立且不可撤销的攻击权
 *
 * V1.1 规则修订（Plans/Input/Geometry Battle V1.1 — Shooter Cancellation Rule
 * Amendment & Rebalance.md）§2/§3/§8/§9/§10/§17：
 *
 *   旧规则：先手击杀对方 Shooter ⇒ 对方本轮攻击被取消。
 *   新规则：Shooter 只是本轮攻击函数的**数学发射锚点**，不要求存活到攻击执行瞬间。
 *           攻击不执行的唯一原因是算法侧 TIMEOUT / INVALID / CRASH。
 *
 * 本套件取代旧的 `shooter-cancel`。旧套件里「因取消而必然成立」的断言按规则修订
 * §18 归类为 *obsolete due to authorized rule change*，逐条改写为新语义；
 * 与规则无关的覆盖（并列先手、方向约束）原样保留。
 *
 * 用例编号对应规则修订 §17 的 R1–R8。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
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

/** 找一个「A1 到 B1 的直线不被障碍物阻挡」的种子 */
function findClearSeed(pointCount = 6): { seed: number; a: any; b: any; obstacles: any[] } {
  for (let seed = 1; seed < 4000; seed++) {
    const map = generateMapOrNull({ seed, pointCount, difficulty: 'easy' });
    if (!map) continue;
    const a = map.teamA[0];
    const b = map.teamB[0];
    const outcome = judgeShot(lineAst(a, b), a, 'A', [{ id: 'B1', position: b }], map.obstacles);
    if (outcome.hits.includes('B1') && !outcome.blocked) {
      return { seed, a, b, obstacles: map.obstacles };
    }
  }
  throw new Error('未能找到 A1→B1 直线畅通的种子');
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
 * 「瞄准存活敌人中 id 最小者画直线」——脚本化对局用。
 *
 * 双方用同一份代码：每一轮各自把对方的 Shooter 打成筛子，于是每轮双方各少一个点。
 */
const AIM_LOWEST_ALIVE = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
me = by_id[reveal["shooters"][args.team]]
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
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
me = by_id[reveal["shooters"][args.team]]
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
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {pt["id"]: pt for pt in public["points"]}
me = by_id[reveal["shooters"][args.team]]
if public.get("round", 0) != 0:
    emit({"type": "variable", "value": "y"})
else:
    emit({"type": "add", "args": [
        {"type": "number", "value": me["y"]},
        {"type": "mul", "args": [{"type": "number", "value": 0.0},
                                 {"type": "variable", "value": "x"}]}]})
`;

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

  assert(engine.selectShooter('A', 'A1').ok, 'A1 应可被选中');
  assert(engine.lockShooter('A').ok, 'A 应可锁定');
  assert(engine.selectShooter('B', 'B1').ok, 'B1 应可被选中');
  assert(engine.lockShooter('B').ok, 'B 应可锁定');

  const result = await engine.runRound();
  return { engine, result };
}

// ===========================================================================
// R1 —— 先手击杀对方 Shooter，已有合法解的后手仍然开火
// ===========================================================================

test('R1: 先手击杀对方 Shooter 后，后手仍然开火（结构性）', () => {
  // 旧的 P2-B 用例断言的是反面（「守卫必须可达」）。规则修订后守卫本身已删除，
  // 这条回归锁的是新语义：Shooter 死了，攻击照打。
  const points = [mkPoint('A1', 'A', -10, 0), mkPoint('B1', 'B', 10, 0), mkPoint('B2', 'B', 15, 5)];
  const shooters = { A: points[0], B: points[1] };
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points,
    shooters,
    ast: {
      A: lineAst({ x: -10, y: 0 }, { x: 10, y: 0 }), // A 命中 B1（B 的 Shooter）
      B: lineAst({ x: 10, y: 0 }, { x: -10, y: 0 }), // B 命中 A1
    },
    obstacles: [],
  });

  assert(r.shots.A !== null, '先手方必须完成射击');
  assert(r.killed.includes('B1'), 'A 的射击必须击杀 B 的 Shooter');
  assertEqual(
    r.shooterAliveAtAttack.B,
    false,
    '前提：B 攻击执行时它的 Shooter 已经死了'
  );
  assert(
    r.shots.B !== null,
    'Shooter 在攻击执行前被击杀 **不再**取消本队的攻击 —— B 必须开火'
  );
  assert(r.killed.includes('A1'), 'B 的攻击必须真的落地（命中 A1），而不是被跳过');
  assertEqual(points.find((p) => p.id === 'B2')!.alive, true, 'B2 不在弹道上，不应被误杀');
});

// ===========================================================================
// R5（结构性）—— 双方 Shooter 互杀，两次攻击都结算
// ===========================================================================

test('R5: 双方 Shooter 互相击杀时，两次攻击都结算', () => {
  const points = [mkPoint('A1', 'A', -10, 0), mkPoint('B1', 'B', 10, 0)];
  const r = resolveOrderedShots({
    order: ['A', 'B'],
    simultaneous: false,
    points,
    shooters: { A: points[0], B: points[1] },
    ast: {
      A: lineAst({ x: -10, y: 0 }, { x: 10, y: 0 }),
      B: lineAst({ x: 10, y: 0 }, { x: -10, y: 0 }),
    },
    obstacles: [],
  });

  assert(r.shots.A !== null && r.shots.B !== null, '双方都必须开火');
  assertEqual([...r.killed].sort(), ['A1', 'B1'], '两边的 Shooter 都应阵亡');
  assertEqual(r.shooterAliveAtAttack.A, true, '先手开火时自己的 Shooter 还活着');
  assertEqual(r.shooterAliveAtAttack.B, false, '后手开火时它的 Shooter 已被击杀');
  assertEqual(points.filter((p) => p.alive).length, 0, '双方点数都应归零');
});

// ===========================================================================
// R2 —— 先手击杀对方 Shooter，后手稍后才返回合法解，仍然开火（端到端）
// ===========================================================================

test('R2: 后手在其 Shooter 阵亡后才返回合法解 —— 仍然开火', async () => {
  const clear = findClearSeed();
  const { result } = await playOneRound('LOCKED-R2', clear.seed, SNIPER, SLOW_SNIPER);

  assertEqual(result.firstSolver, 'A', 'A（立即求解）应是先手');
  assert(result.hits.A.includes('B1'), `A 应命中 B1，实际 [${result.hits.A.join(',')}]`);
  assert(result.killed.includes('B1'), 'B1 应被击杀');

  assertEqual(result.log.attacksExecuted, ['A', 'B'], '两次攻击都必须执行');
  assertEqual(
    result.log.shooterAliveAtAttack.B,
    false,
    '日志必须能证明 B 开火时它的 Shooter 已经死了'
  );
  assert(result.hits.B.length > 0, `B 的攻击必须落到实地，实际 [${result.hits.B.join(',')}]`);
  assertEqual(result.cancelled.B, false, '规则修订后不存在取消');
  assertEqual(result.log.cancelledB, false, '日志中 B 也不得被记成取消');
  assert(result.log.result !== 'CANCELLED_B', '结果码不得再出现 CANCELLED_B');
});

// ===========================================================================
// R3 —— 先手击杀对方 Shooter，后手超时 → 不攻击，原因是 TIMEOUT 不是 CANCELLED
// ===========================================================================

test('R3: 后手超时 —— 不攻击，原因是 TIMEOUT 而不是 CANCELLED', async () => {
  const clear = findClearSeed();
  const root = tmpDir('locked-r3');
  const slowPkg = writePkg(path.join(root, 'slow'), TIMEOUT_IN_ROUND, 'timeout-in-round');

  const { result } = await playOneRound('LOCKED-R3', clear.seed, SNIPER, slowPkg, 2000);

  assert(result.killed.includes('B1'), '先手仍应击杀 B 的 Shooter');
  assertEqual(result.log.bErrorCode, 'TIMEOUT', 'B 的错误码必须是 TIMEOUT');
  assertEqual(result.log.result, 'TIMEOUT_B', '回合结果码必须是 TIMEOUT_B');
  assertEqual(result.cancelled.B, false, 'TIMEOUT 绝不能被记成取消');
  assert(result.log.result !== 'CANCELLED_B', 'TIMEOUT ≠ 取消');
  assertEqual(result.log.attacksExecuted, ['A'], 'B 没有合法解 —— 不应出现在执行列表里');
  assertEqual(result.hits.B.length, 0, 'B 不得产生任何命中');
});

// ===========================================================================
// R4 —— 先手击杀对方 Shooter，后手输出非法 → 不攻击
// ===========================================================================

test('R4: 后手输出非法 —— 不攻击，且不是取消', async () => {
  const clear = findClearSeed();
  const root = tmpDir('locked-r4');
  const badPkg = writePkg(path.join(root, 'bad'), INVALID_IN_ROUND, 'invalid-in-round');

  const { result } = await playOneRound('LOCKED-R4', clear.seed, SNIPER, badPkg);

  assert(result.killed.includes('B1'), '先手仍应击杀 B 的 Shooter');
  assertEqual(result.log.result, 'INVALID_B', '回合结果码必须是 INVALID_B');
  assertEqual(result.cancelled.B, false, 'INVALID 绝不能被记成取消');
  assert(result.log.result !== 'CANCELLED_B', 'INVALID ≠ 取消');
  assertEqual(result.log.attacksExecuted, ['A'], 'B 没有合法解 —— 不应出现在执行列表里');
  assertEqual(result.hits.B.length, 0, 'B 不得产生任何命中');
});

// ===========================================================================
// R5 + R6 端到端 —— 脚本化对局：每轮双方 Shooter 互杀，最终同归于尽 → 平局
// ===========================================================================

/**
 * 找一个种子，使「A_k 打 B_k、B_k 打 A_k」（k = 1..6）全部弹道畅通、
 * 且**恰好**只命中目标本身（不顺手多杀）。
 *
 * 这样每一轮双方各损失一个点，第 6 轮结束后双方同时归零 ——
 * 确定性的 MUTUAL_ELIMINATION 局面，不依赖运气。
 */
function findScriptedSeed(): { seed: number; map: any } {
  for (let seed = 1; seed < 8000; seed++) {
    const map = generateMapOrNull({ seed, pointCount: 6, difficulty: 'easy' });
    if (!map) continue;
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) {
      const a = map.teamA[k];
      const b = map.teamB[k];
      const enemyOfA = map.teamB.slice(k).map((p, i) => ({ id: `B${k + i + 1}`, position: p }));
      const enemyOfB = map.teamA.slice(k).map((p, i) => ({ id: `A${k + i + 1}`, position: p }));
      const ra = judgeShot(lineAst(a, b), a, 'A', enemyOfA, map.obstacles);
      const rb = judgeShot(lineAst(b, a), b, 'B', enemyOfB, map.obstacles);
      if (ra.blocked || rb.blocked) ok = false;
      else if (ra.hits.length !== 1 || ra.hits[0] !== `B${k + 1}`) ok = false;
      else if (rb.hits.length !== 1 || rb.hits[0] !== `A${k + 1}`) ok = false;
    }
    if (ok) return { seed, map };
  }
  throw new Error('未找到可用于同归于尽脚本的种子');
}

test('R6: 同一轮结束后双方同时归零 —— MUTUAL_ELIMINATION / DRAW', async () => {
  const { seed } = findScriptedSeed();
  const root = tmpDir('locked-r6');
  const pkg = writePkg(path.join(root, 'aim-lowest'), AIM_LOWEST_ALIVE, 'aim-lowest');

  const engine = makeEngine({ matchId: 'LOCKED-R6', seed });
  assert(engine.upload('A', pkg).ok, 'A 应能上传');
  assert(engine.upload('B', pkg).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  engine.startMatch();

  const rounds: Awaited<ReturnType<MatchEngine['runRound']>>[] = [];
  for (let k = 1; k <= 6; k++) {
    assert(engine.selectShooter('A', `A${k}`).ok, `第 ${k} 轮 A${k} 应可被选中`);
    assert(engine.lockShooter('A').ok, `第 ${k} 轮 A 应可锁定`);
    assert(engine.selectShooter('B', `B${k}`).ok, `第 ${k} 轮 B${k} 应可被选中`);
    assert(engine.lockShooter('B').ok, `第 ${k} 轮 B 应可锁定`);
    rounds.push(await engine.runRound());
  }

  // 每一轮：双方 Shooter 互杀、两次攻击都落地（R5 的事实基础）
  for (const r of rounds) {
    // 先手顺序由实测耗时决定，两种顺序都合法 —— 只要求「两次都执行」
    assertEqual(
      [...r.log.attacksExecuted].sort(),
      ['A', 'B'],
      `第 ${r.round} 轮两次攻击都必须执行，实际 [${r.log.attacksExecuted.join(',')}]`
    );
    assert(r.killed.includes(r.shooterA), `第 ${r.round} 轮 A 的 Shooter 应阵亡`);
    assert(r.killed.includes(r.shooterB), `第 ${r.round} 轮 B 的 Shooter 应阵亡`);
    if (r.firstSolver !== 'tie') {
      const second = r.log.attacksExecuted[1];
      assertEqual(
        r.log.shooterAliveAtAttack[second],
        false,
        `第 ${r.round} 轮：后手 ${second} 开火时它的 Shooter 已被先手击杀`
      );
    }
  }

  const last = rounds[rounds.length - 1];
  assertEqual(last.aliveAfter, { A: 0, B: 0 }, '第 6 轮结束后双方都应归零');
  assertEqual(last.mutualElimination, true, '该轮必须被标记为同归于尽');
  assertEqual(
    last.winner,
    'draw',
    '同归于尽必须判平局 —— 不得因为 A 是先手就把胜利判给 A'
  );
  assertEqual(engine.getWinner(), 'draw', '最终胜者必须是 draw');
  assertEqual(engine.endReason(), 'MUTUAL_ELIMINATION', '结束原因必须是 MUTUAL_ELIMINATION');
  assertEqual(engine.getMatchLog().endReason, 'MUTUAL_ELIMINATION', '落盘日志必须记录结束原因');
  assertEqual(engine.getMatchLog().winner, 'draw', '落盘日志的 winner 必须是 draw');
});

// ===========================================================================
// R7 —— 本轮阵亡的 Shooter 下一轮不可再选
// ===========================================================================

test('R7: 本轮阵亡的 Shooter 下一轮不可再被选中', async () => {
  const clear = findClearSeed();
  const { engine } = await playOneRound('LOCKED-R7', clear.seed, SNIPER, SLOW_SNIPER);

  const snap = engine.getSnapshot();
  const b1 = snap.points.find((p) => p.id === 'B1');
  assert(b1 && !b1.alive, 'B1 应已被击杀');
  assertEqual(snap.shooters.B, null, '规则修订不引入同轮/自动替换 —— 下一轮必须重新人工选点');

  if (snap.phase !== 'MATCH_END') {
    const r = engine.selectShooter('B', 'B1');
    assert(!r.ok, '已死亡的 B1 不应能被选为 Shooter');
  }
});

// ===========================================================================
// R8 —— 同轮不进行 Shooter Replacement
// ===========================================================================

test('R8: Shooter 阵亡后本轮不做任何替换（不重选、不重算）', async () => {
  const clear = findClearSeed();
  const { result } = await playOneRound('LOCKED-R8', clear.seed, SNIPER, SLOW_SNIPER);

  assertEqual(result.shooterB, 'B1', 'B 本轮用的必须仍是 START 快照里的 Shooter');
  assertEqual(result.log.shooterB, 'B1', '日志必须记录 START 时的 Shooter');
  assertEqual(
    result.log.shooterAliveAtAttack.B,
    false,
    '前提：B 开火时 B1 已阵亡 —— 即便如此也没有换人'
  );
  // 单轮单次计算：B 的耗时仍是它第一次计算的耗时，不存在第二次计算
  assert(result.computeTimeMs.B !== null, 'B 仍只有一次计算的耗时记录');
  // 没有第二次计算 ⇒ 没有第二次输入的哈希，本轮 public/reveal 只有一份
  assertEqual(
    result.log.publicStateHash,
    result.publicStateHash,
    '本轮输入必须仍是那一份冻结字节'
  );
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
    shooters: { A: points[0], B: points[1] },
    ast: {
      A: lineAst({ x: -10, y: 0 }, { x: 10, y: 0 }),
      B: lineAst({ x: 10, y: 0 }, { x: -10, y: 0 }),
    },
    obstacles: [],
  });
  assert(r.shots.A !== null && r.shots.B !== null, '并列先手时双方都必须开火');
  assert(r.killed.includes('A1') && r.killed.includes('B1'), '双方都应被击杀');
  assertEqual(
    r.shooterAliveAtAttack,
    { A: true, B: true },
    '并列先手都基于开战前快照 —— 双方开火时各自 Shooter 都还活着'
  );
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
