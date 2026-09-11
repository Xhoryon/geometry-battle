/**
 * fixed-emitter —— 发射锚点的结构语义
 *
 * 规则沿革：
 *   - Rev 1 / Rev 2：每轮从本方存活点里选一个 Shooter，可能被击杀。
 *   - Rev 3：锚点变成**全局常量** `(-18,0)` / `(18,0)`，整场不变、不可击杀、不是战斗点。
 *   - **V1.2（本文件对齐的版本）**：锚点改为**每队在开赛前从自己的初始点里选一个**，
 *     各自独立选择、**双方锁定之前互不可见**；双方都锁定后公开，整场不可更换。
 *
 * 变的是「它从哪来」，不变的是 Rev 3 确立的实质（本套件逐条锁死）：
 *
 *   1. 锚点在**一场比赛内是固定的**，锁定后不可更换；
 *   2. 它**不是战斗点**：不计入存活数、不能作为胜利目标；
 *   3. 它**不可击杀**：轨迹穿过它不产生任何击杀，它也不在任何点表里；
 *   4. 函数的锚点必须是它（`|f(x_e) − y_e| ≤ 1e-6`）；
 *   5. 锁定之前，它不出现在任何会被参赛代码读到的输入里（public_state）。
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

/** 走完上传 + preflight + startMatch，停在 EMITTER_SELECT 阶段 */
async function readyToSelect(matchId: string, algoA = SNIPER, algoB = SLOW_SNIPER, seed = 4242) {
  const engine = makeEngine(matchId, seed);
  assert(engine.upload('A', algoA).ok, 'A 应能上传');
  assert(engine.upload('B', algoB).ok, 'B 应能上传');
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  assert(engine.startMatch().ok, '开始比赛应成功');
  return engine;
}

// ===========================================================================
// 1. 选择阶段：双方独立、锁定前互不可见
// ===========================================================================

test('fixed-emitter: 开赛后必须各自选定 Emitter 并锁定，才能进入 READY', async () => {
  const engine = await readyToSelect('FE-SELECT');
  assertEqual(engine.getSnapshot().phase, 'EMITTER_SELECT', '开赛后应停在 Emitter 选择阶段');
  assertEqual(engine.emittersRevealed(), false, '尚未锁定，锚点不可见');

  // 锁一方不够
  assert(engine.selectEmitter('A', 'A1').ok, 'A 应能选择');
  assert(engine.lockEmitter('A').ok, 'A 应能锁定');
  assertEqual(engine.getSnapshot().phase, 'EMITTER_SELECT', '只锁一方不得进入 READY');
  assertEqual(engine.emittersRevealed(), false, '只锁一方，锚点仍不可见');
  assert(engine.emitterCandidates('B').length > 0, 'B 仍应有候选（A 的选择不影响它）');

  // 锁双方 → READY
  assert(engine.selectEmitter('B', 'B2').ok, 'B 应能选择');
  assert(engine.lockEmitter('B').ok, 'B 应能锁定');
  assertEqual(engine.getSnapshot().phase, 'READY', '双方锁定后应进入 READY');
  assertEqual(engine.emittersRevealed(), true, '双方锁定后锚点公开');
  assertEqual(engine.getEmitters().A.id, 'A1', 'A 的锚点应是它选的那个点');
  assertEqual(engine.getEmitters().B.id, 'B2', 'B 的锚点应是它选的那个点');
});

test('fixed-emitter: 锁定之后不可更换（整场不可变）', async () => {
  const engine = await readyToSelect('FE-IMMUTABLE');
  engine.selectEmitter('A', 'A1');
  engine.lockEmitter('A');
  assert(!engine.selectEmitter('A', 'A2').ok, '锁定后不得改选');
  assert(!engine.lockEmitter('A').ok, '不得重复锁定');

  engine.selectEmitter('B', 'B1');
  engine.lockEmitter('B');
  const before = JSON.stringify(engine.getEmitters());
  // 跑一整轮之后锚点必须一模一样
  await engine.runRound();
  assertEqual(JSON.stringify(engine.getEmitters()), before, '整场锚点不得变化');
});

test('fixed-emitter: 锁定**之前**可以改选，且对手看不到改了什么（§73）', async () => {
  // 规格 §24：锁定前选手可以改选别的本方候选，UI 必须如实反映当前选择。
  // 与「锁定后不可更换」是一对 —— 两条都要有，否则「锁定」的语义不完整。
  const engine = await readyToSelect('FE-RESELECT');

  assert(engine.selectEmitter('A', 'A1').ok, 'A 应能选 A1');
  assertEqual(engine.getSnapshot().emitterSelection.A.selected!.id, 'A1', '选择应为 A1');

  // 改选 —— 未锁定，必须允许
  assert(engine.selectEmitter('A', 'A3').ok, '锁定前应能改选');
  assertEqual(engine.getSnapshot().emitterSelection.A.selected!.id, 'A3', '改选后应变成 A3');

  // 改选过程对 B 依然不可见：只知道「A 还没锁」
  const sel = engine.getSnapshot().emitterSelection;
  assertEqual(sel.A.locked, false, '改选不会顺带锁定');
  assertEqual(sel.B.selected, null, 'B 仍未选择');
  assertEqual(sel.revealed, false, '整体仍未公开');
  assertEqual(engine.getSnapshot().emitters, null, '未公开时快照不得带出任何锚点坐标');

  // 锁定之后才定死
  assert(engine.lockEmitter('A').ok, 'A 应能锁定');
  assert(!engine.selectEmitter('A', 'A4').ok, '锁定后不得再改选');
  assertEqual(engine.getSnapshot().emitterSelection.A.selected!.id, 'A3', '锁定的就是改选后的那个');
});

test('fixed-emitter: 只能选自己队的点', async () => {
  const engine = await readyToSelect('FE-OWN');
  assert(!engine.selectEmitter('A', 'B1').ok, 'A 不得选 B 的点');
  assert(!engine.selectEmitter('A', 'NOPE').ok, '不得选不存在的点');
  assert(engine.selectEmitter('A', 'A3').ok, 'A 应能选自己的点');
  assertEqual(engine.getSnapshot().emitterSelection.A.selected!.id, 'A3', '选择应被记录');
});

test('fixed-emitter: 未锁定之前不得开赛、不得揭盲、不得出输入', async () => {
  const engine = await readyToSelect('FE-GATE');
  engine.selectEmitter('A', 'A1');
  engine.lockEmitter('A'); // 只锁一方

  assert(!engine.judgeStartRound().ok, '未锁定前不得 START');
  assert(!engine.emittersRevealed(), '未锁定前锚点不可见');

  let threw = false;
  try {
    engine.beginRound();
  } catch {
    threw = true;
  }
  assert(threw, '未锁定前不得开始本轮 —— 否则输入里就没有锚点坐标');
});

test('fixed-emitter: 双方锁定前互不可见 —— 但引擎内部记录双方的选择', async () => {
  const engine = await readyToSelect('FE-HIDDEN');
  engine.selectEmitter('A', 'A1');
  engine.lockEmitter('A');

  const sel = engine.getSnapshot().emitterSelection;
  assertEqual(sel.A.locked, true, 'A 自己已锁定');
  assertEqual(sel.A.selected!.id, 'A1', 'A 能看到自己的选择');
  assertEqual(sel.B.locked, false, 'B 尚未锁定');
  assertEqual(sel.B.selected, null, 'B 尚未选择');
  assertEqual(sel.revealed, false, '整体尚未公开');
  // emitters 在双方锁定前为 null —— 任何投影都不可能提前泄漏
  assertEqual(engine.getSnapshot().emitters, null, '未公开时快照的 emitters 必须为 null');
});

// ===========================================================================
// 2. Emitter 不是战斗点，也不可击杀
// ===========================================================================

test('fixed-emitter: 被选中的点从战斗点集合里移除（其余才是 Combat Points）', async () => {
  const engine = await readyToSelect('FE-NOTPOINT', SNIPER, SLOW_SNIPER, 777);
  assertEqual(engine.emitterCandidates('A').length, 6, '选择前 A 有 6 个候选');

  engine.selectEmitter('A', 'A1');
  engine.lockEmitter('A');
  engine.selectEmitter('B', 'B1');
  engine.lockEmitter('B');

  const after = engine.getSnapshot();
  assertEqual(after.points.filter((p) => p.team === 'A').length, 5, 'A 的锚点应被移出战斗点');
  assertEqual(after.points.filter((p) => p.team === 'B').length, 5, 'B 的锚点应被移出战斗点');
  assert(!after.points.some((p) => p.id === 'A1' || p.id === 'B1'), '锚点不得留在 points 里');
  assertEqual(after.alive.A + after.alive.B, 10, '存活数只数战斗点，不含锚点');
});

test('fixed-emitter: 轨迹穿过敌方 Emitter 不产生任何击杀', () => {
  const ast = lineAst(EMITTERS.A, EMITTERS.B);
  const enemies = [{ id: 'B1', position: { x: 4, y: 5 } }];
  const out = judgeShot(ast, EMITTERS.A, 'A', enemies, []);
  assert(!out.hits.includes('B0') && !out.hits.includes('A0'), '锚点不得被命中');
  assertEqual(out.hits, [], '这条弹道上没有战斗点，不应有任何命中');
  const endX = out.trajectory[out.trajectory.length - 1].x;
  assert(Math.abs(endX - FIELD.xMax) < 1e-6, '锚点不是障碍物，轨迹应正常传到场地边界');
});

test('fixed-emitter: 整场比赛结束后锚点状态不变', async () => {
  const engine = await readyToSelect('FE-IMMORTAL', SNIPER, SLOW_SNIPER, 909);
  engine.selectEmitter('A', 'A2');
  engine.lockEmitter('A');
  engine.selectEmitter('B', 'B3');
  engine.lockEmitter('B');
  const before = JSON.stringify(engine.getEmitters());

  const r = await engine.runRound();
  for (const id of r.killed) {
    assert(id !== 'A2' && id !== 'B3', `击杀列表里不得出现 Emitter（实际含 ${id}）`);
  }
  assertEqual(JSON.stringify(engine.getEmitters()), before, '锚点不得因战斗改变');
  assert(!('emitterAAliveAfterRound' in r.log), '日志不得出现「Emitter 存活」类字段');
});

// ===========================================================================
// 3. 函数锚点
// ===========================================================================

test('fixed-emitter: 函数必须经过本队自己的 Emitter', async () => {
  // 这条算法锚在**自己队的另一个点**上（decoy 世界里的第二个本队点），
  // 而不是平台给的那个锚点 → Preflight 必须以 NOT_THROUGH_SHOOTER 拒绝。
  const wrongAnchor = `import json, os
${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "r") as f:
    public = json.load(f)
me = public["emitters"][args.team]
own = [p for p in public["points"] if p["team"] == args.team]
t = own[1] if len(own) > 1 else own[0]
y = t["y"]
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
  const pre = await engine.preflight();
  assert(!pre.ok, '锚在别的点上的算法必须被 Preflight 拒绝');
  assert(
    pre.errors.some((e) => e.includes('NOT_THROUGH_SHOOTER')),
    `拒绝原因必须点明 NOT_THROUGH_SHOOTER，实际: ${pre.errors.join('; ')}`
  );
});

// ===========================================================================
// 4. 公开契约
// ===========================================================================

test('fixed-emitter: 锚点坐标随 public_state 下发，且双方字节相同', async () => {
  const engine = await readyToSelect('FE-PUBLIC');
  engine.selectEmitter('A', 'A4');
  engine.lockEmitter('A');
  engine.selectEmitter('B', 'B5');
  engine.lockEmitter('B');

  const em = engine.getEmitters();
  const pre = engine.beginRound();

  // 用**协议构造器**按引擎快照重算这一轮的 public_state，再拿哈希与引擎比对 ——
  // 哈希相等即证明引擎下发的正是这份字节（不依赖任何测试专用后门）。
  const snap = engine.getSnapshot();
  const built = buildPublicState({
    matchId: 'FE-PUBLIC',
    round: pre.round,
    emitters: { A: em.A.position, B: em.B.position },
    points: snap.points.map((p) => ({
      id: p.id,
      team: p.team,
      x: p.position.x,
      y: p.position.y,
      alive: p.alive,
    })),
  });
  assertEqual(built.sha256, pre.publicStateHash, '引擎下发的 public_state 必须就是这份字节');

  const parsed = JSON.parse(built.json);
  assertEqual(parsed.emitters.A, { x: em.A.position.x, y: em.A.position.y }, 'public 必须给出 A 的锚点坐标');
  assertEqual(parsed.emitters.B, { x: em.B.position.x, y: em.B.position.y }, 'public 必须给出 B 的锚点坐标');
  assert(
    !parsed.points.some((p: { id: string }) => p.id === 'A4' || p.id === 'B5'),
    '锚点被移出战斗点：points 里不得有它'
  );

  // reveal 仍然只含障碍物
  const rev = engine.revealRound();
  assertEqual(rev.revealStateHash.length, 64, '揭盲应产出哈希');
  const revParsed = JSON.parse(
    buildRevealState({
      matchId: 'FE-PUBLIC',
      round: pre.round,
      publicStateSha256: built.sha256,
      obstacles: snap.map!.obstacles,
    }).json
  );
  assert(!('shooters' in revParsed), 'reveal 不得含 shooters');
  assert(!('emitter' in revParsed) && !('emitters' in revParsed), '锚点属 public，不得出现在 reveal');
});

// ===========================================================================
// 5. 地图层的锚点公平性（Rev 3 的校验保留，作用于 decoy 常量）
// ===========================================================================

test('fixed-emitter: validateMap 拒绝被障碍物埋住的 Emitter 常量（decoy 用）', () => {
  const bad = validateMap({
    seed: 1,
    teamA: [{ x: -10, y: 5 }],
    teamB: [{ x: 10, y: 5 }],
    emitterA: EMITTERS.A,
    emitterB: EMITTERS.B,
    obstacles: [{ type: 'circle', center: [EMITTERS.A.x, EMITTERS.A.y], radius: 1 }],
    stateHash: 'x',
  });
  assert(!bad.valid, 'Emitter 常量被障碍物埋住的地图必须非法');
});

void runAll('fixed-emitter');
