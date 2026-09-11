/**
 * fixed-emitter —— 固定 Emitter 的结构语义（V1.1 Rule Revision 3 §2–§7/§9）
 *
 * 本套件取代旧的 `dual-shooter-selection`：那份契约（每轮从存活点里挑一个当
 * Shooter、锁定、下一轮重选）已随 §5 删除。取而代之要锁的是**新结构**：
 *
 *   1. Emitter 是**常量**，整场比赛不变，不由任何人选择（§2–§4）；
 *   2. Emitter **不是战斗点**：不计入存活数、不能作为胜利目标（§3/§9）；
 *   3. Emitter **不可击杀**：轨迹穿过它不产生任何击杀，它也不在任何点表里（§7）；
 *   4. 函数的锚点必须是 Emitter（§4）；
 *   5. Emitter 坐标从第 1 轮起就在 `public_state.json` 里，且双方字节相同（§6）；
 *   6. 引擎**不再提供**任何选点 API —— 旧语义在接口层面就不存在（§5/§8）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import { EMITTERS, FIELD } from '../src/core/Rules';
import { judgeShot } from '../src/core/Judge';
import { MatchEngine } from '../src/core/Match';
import { validateMap } from '../src/map/MapGenerator';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const SNIPER = path.join(__dirname, 'fixtures', 'algos', 'sniper');
const SLOW_SNIPER = path.join(__dirname, 'fixtures', 'algos', 'slow-sniper');

function lineAst(from: { x: number; y: number }, to: { x: number; y: number }): CanonicalNode {
  const dx = to.x - from.x;
  const m = Math.abs(dx) < 1e-9 ? 0 : (to.y - from.y) / dx;
  const r = parseCanonicalDSL({
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
  });
  assert(r.ok && r.ast, '构造的直线 AST 必须合法');
  return r.ast!;
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

function makeEngine(matchId: string, seed = 4242, pointCount = 6): MatchEngine {
  const root = tmpDir('fixed-emitter');
  return new MatchEngine({
    matchId,
    seed,
    pointCount,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
}

/** 走完上传 + preflight + startMatch */
async function ready(matchId: string, algoA = SNIPER, algoB = SLOW_SNIPER, seed = 4242) {
  const engine = makeEngine(matchId, seed);
  assert(engine.upload('A', algoA).ok, 'A 应能上传');
  assert(engine.upload('B', algoB).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  assert(engine.startMatch().ok, '开始比赛应成功');
  return engine;
}

// ===========================================================================
// 1. Emitter 是常量，整场不变
// ===========================================================================

test('fixed-emitter: Emitter 坐标是全局常量，且整场比赛不变', async () => {
  assertEqual(EMITTERS.A, { x: -18, y: 0 }, 'A 的 Emitter 必须是约定常量');
  assertEqual(EMITTERS.B, { x: 18, y: 0 }, 'B 的 Emitter 必须是约定常量');

  const engine = await ready('FE-CONST');
  const snap0 = engine.getSnapshot();
  assertEqual(snap0.emitters!.A.position, EMITTERS.A, '快照里的 A Emitter 必须等于常量');
  assertEqual(snap0.emitters!.B.position, EMITTERS.B, '快照里的 B Emitter 必须等于常量');

  // 跨多轮取一次：锚点必须逐轮完全相同
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await engine.runRound();
    seen.push(JSON.stringify(engine.getSnapshot().emitters));
    assertEqual(r.emitterA, 'A0', `第 ${r.round} 轮 A 的锚点标识应固定`);
    assertEqual(r.emitterB, 'B0', `第 ${r.round} 轮 B 的锚点标识应固定`);
    if (engine.endReason() !== 'NONE') break;
  }
  assert(seen.length > 1, '至少应跑过两轮');
  for (const s of seen) assertEqual(s, seen[0], 'Emitter 必须整场不变');
});

test('fixed-emitter: 地图携带的 Emitter 就是常量，且计入地图哈希', async () => {
  const engine = await ready('FE-MAP');
  const map = engine.getSnapshot().map!;
  assertEqual(map.emitterA, EMITTERS.A, '地图的 emitterA 必须等于常量');
  assertEqual(map.emitterB, EMITTERS.B, '地图的 emitterB 必须等于常量');
  assertEqual(map.stateHash.length, 64, '地图哈希应为 sha256');
});

test('fixed-emitter: validateMap 拒绝被障碍物封死的 Emitter', () => {
  // Emitter 被障碍物埋住 = 该队永远打不到任何东西，必须整局作废（§3）
  const bad = validateMap({
    seed: 1,
    teamA: [{ x: -10, y: 5 }],
    teamB: [{ x: 10, y: 5 }],
    emitterA: EMITTERS.A,
    emitterB: EMITTERS.B,
    obstacles: [{ type: 'circle', center: [EMITTERS.A.x, EMITTERS.A.y], radius: 1 }],
    stateHash: 'x',
  });
  assert(!bad.valid, 'Emitter 被障碍物埋住的地图必须非法');
  assert(
    bad.errors.some((e) => e.includes('Emitter A')),
    `错误信息必须点名 Emitter A，实际: ${bad.errors.join('; ')}`
  );
});

// ===========================================================================
// 2/3. Emitter 不是战斗点，也不可击杀
// ===========================================================================

test('fixed-emitter: Emitter 不是战斗点 —— 不计入存活数、不在点表里', async () => {
  const engine = await ready('FE-NOTPOINT', SNIPER, SLOW_SNIPER, 777);
  const snap = engine.getSnapshot();

  assertEqual(snap.points.length, 12, '6v6 应只有 12 个**战斗**点');
  for (const p of snap.points) {
    assert(!p.id.endsWith('0'), `点表里不得出现 Emitter（实际含 ${p.id}）`);
    assert(p.id !== 'A0' && p.id !== 'B0', `点表里不得出现 Emitter（实际含 ${p.id}）`);
  }
  assertEqual(snap.alive.A + snap.alive.B, 12, '存活数只数战斗点，不含 Emitter');
});

test('fixed-emitter: 轨迹穿过敌方 Emitter 不产生任何击杀（不可击杀）', () => {
  // A 的 Emitter 在 (-18,0)，B 的在 (18,0)。y = 0 这条直线正好穿过对方 Emitter。
  const ast = lineAst(EMITTERS.A, EMITTERS.B);
  const enemies = [{ id: 'B1', position: { x: 4, y: 5 } }]; // 不在弹道上
  const out = judgeShot(ast, EMITTERS.A, 'A', enemies, []);

  assert(!out.hits.includes('B0'), '敌方 Emitter 不得被命中');
  assert(!out.hits.includes('A0'), '己方 Emitter 当然也不得被命中');
  assertEqual(out.hits, [], '这条弹道上没有战斗点，因此不应有任何命中');

  // 轨迹本身仍然正常传播到场地边界（Emitter 不是障碍物）
  const endX = out.trajectory[out.trajectory.length - 1].x;
  assert(Math.abs(endX - FIELD.xMax) < 1e-6, `轨迹应到场地边界 x=${FIELD.xMax}，实际 ${endX}`);
});

test('fixed-emitter: 整场比赛结束后 Emitter 仍然"在"（它没有生死状态）', async () => {
  const engine = await ready('FE-IMMORTAL', SNIPER, SLOW_SNIPER, 909);
  const before = JSON.stringify(engine.getSnapshot().emitters);
  const r = await engine.runRound();

  for (const id of r.killed) {
    assert(id !== 'A0' && id !== 'B0', `击杀列表里不得出现 Emitter（实际含 ${id}）`);
  }
  assertEqual(JSON.stringify(engine.getSnapshot().emitters), before, 'Emitter 状态不得因战斗改变');
  // RoundLog 也没有任何「Emitter 是否存活」的字段 —— 那个问题在新规则下不存在
  assert(!('emitterAAliveAfterRound' in r.log), '日志不得出现「Emitter 存活」类字段');
});

// ===========================================================================
// 4. 函数的锚点必须是 Emitter
// ===========================================================================

test('fixed-emitter: 函数必须经过自己的 Emitter（瞄战斗点当锚点会被拒）', async () => {
  // 这条算法把函数锚在**敌方第一个战斗点的 y** 上 —— 它在几何上「瞄着一个点」，
  // 但不是自己的 Emitter。锚点判定用的必须是固定 Emitter，因此它必然因
  // NOT_THROUGH_SHOOTER 被 Preflight 拒。
  //
  // （防守：若该点的 y 恰好等于 Emitter 的 y，就把常数抬 3 —— 以免这条用例
  //   因为「正好落在 Emitter 上」而假通过。）
  const wrongAnchor = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
enemy = "B" if args.team == "A" else "A"
foes = sorted((p for p in public["points"] if p["team"] == enemy and p.get("alive", True)),
              key=lambda p: p["id"])
y = foes[0]["y"] if foes else 0.0
if abs(y - me["y"]) < 1e-9:
    y = y + 3.0
emit({"type": "add", "args": [
    {"type": "number", "value": y},
    {"type": "mul", "args": [{"type": "number", "value": 0.0},
                             {"type": "variable", "value": "x"}]}]})
`;
  const root = tmpDir('fe-wrong-anchor');
  const pkg = writePkg(path.join(root, 'pkg'), wrongAnchor, 'wrong-anchor');

  const engine = makeEngine('FE-ANCHOR', 4242);
  assert(engine.upload('A', pkg).ok, '上传应成功');
  assert(engine.upload('B', SLOW_SNIPER).ok, '上传应成功');
  // Preflight 就会拦下它：锚点错 = 函数不合法
  const pre = await engine.preflight();
  assert(!pre.ok, '锚在战斗点上的算法必须被 Preflight 拒绝');
  assert(
    pre.errors.some((e) => e.includes('NOT_THROUGH_SHOOTER')),
    `拒绝原因必须点明 NOT_THROUGH_SHOOTER，实际: ${pre.errors.join('; ')}`
  );
});

test('fixed-emitter: 经过自己 Emitter 的常函数合法（锚点判定用的是 Emitter 坐标）', () => {
  const ast = lineAst(EMITTERS.A, { x: EMITTERS.A.x, y: EMITTERS.A.y }); // 过 Emitter 的常函数
  const out = judgeShot(ast, EMITTERS.A, 'A', [{ id: 'B1', position: { x: 4, y: EMITTERS.A.y } }], []);
  assertEqual(out.hits, ['B1'], 'y = y_emitter 的常函数应命中同 y 的敌人');
});

// ===========================================================================
// 5. Emitter 在 public_state 里，双方字节相同
// ===========================================================================

test('fixed-emitter: Emitter 从第 1 轮起就在 public_state，且 A/B 字节相同', async () => {
  const engine = await ready('FE-PUBLIC');
  const pre = engine.beginRound();
  assertEqual(pre.round, 1, '第一轮应为 1');

  // 按协议重算这一轮的 public_state：Emitter 必须直接出现在里面（§6）
  const map = engine.getSnapshot().map!;
  const built = buildPublicState({
    matchId: 'FE-PUBLIC',
    round: 1,
    emitters: { A: map.emitterA, B: map.emitterB },
    points: [],
  });
  const pub = JSON.parse(built.json);
  assertEqual(pub.emitters, { A: { x: -18, y: 0 }, B: { x: 18, y: 0 } }, 'public 必须直接给出 Emitter 坐标');

  // reveal 不再承担任何 Shooter/Emitter 信息（§5/§6）
  const rev = buildRevealState({
    matchId: 'FE-PUBLIC',
    round: 1,
    publicStateSha256: built.sha256,
    obstacles: map.obstacles,
  });
  assert(!rev.json.includes('shooters'), 'reveal 不得再含 shooters');
  assert(!rev.json.includes('emitter'), 'Emitter 属 public，不得出现在 reveal');

  // 同一轮重复构造必须字节稳定（哈希可复核）
  const again = buildPublicState({
    matchId: 'FE-PUBLIC',
    round: 1,
    emitters: { A: map.emitterA, B: map.emitterB },
    points: [],
  });
  assertEqual(again.sha256, built.sha256, '同一轮重复构造必须得到同一份字节');
});

// ===========================================================================
// 6. 引擎不再提供选点 API
// ===========================================================================

test('fixed-emitter: 引擎不再暴露任何 Shooter 选择 API（§5）', async () => {
  const engine = await ready('FE-NOAPI');
  const e = engine as unknown as Record<string, unknown>;
  for (const gone of ['selectShooter', 'lockShooter']) {
    assert(!(gone in e), `MatchEngine 不得再暴露 ${gone}（Rule Revision 3 §5 已删除该流程）`);
  }
  // 快照里也不再有 shooters / locked
  const snap = engine.getSnapshot() as unknown as Record<string, unknown>;
  assert(!('shooters' in snap), '快照不得再有 shooters 字段');
  assert(!('locked' in snap), '快照不得再有 locked 字段');
  assert('emitters' in snap, '快照必须提供 emitters');
});

test('fixed-emitter: 一轮不需要任何人工动作即可跑完（流程只剩 PUBLIC→REVEAL→START→COMPUTE）', async () => {
  const engine = await ready('FE-NOACTION', SNIPER, SLOW_SNIPER, 1234);
  const r = await engine.runRound(); // 唯一的显式调用
  assertEqual(r.round, 1, '应结算第 1 轮');
  assertEqual(r.log.attacksExecuted.length >= 1, true, '至少有一方执行了攻击');
  const phases = r.machinePhases;
  assert(phases.includes('PUBLIC'), `状态机必须经过 PUBLIC，实际 ${phases.join(' → ')}`);
  assert(!phases.includes('SHOOTER_SELECTION' as never), '状态机不得再有 SHOOTER_SELECTION');
});

void runAll('fixed-emitter');
