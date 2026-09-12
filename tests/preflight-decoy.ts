/**
 * preflight-decoy —— preflight 不得泄漏比赛世界（规范 §14/§15）
 *
 * preflight 是参赛代码**真正会跑**的一个窗口。如果它拿比赛种子生成地图，
 * 算法就能在 START 之前把本轮障碍物推出来 —— 这正是 V1.1 要消除的
 * preprocessing 泄漏。本套件断言：
 *   1. decoy 种子由 matchId 派生，与操作员 --seed 无关；
 *   2. 即使 --seed 恰好等于派生种子，decoy 世界也不会与比赛世界重合；
 *   3. 生成器微调后的**实际用种**同样不重合，且地图哈希逐字节不同；
 *   4. 审计日志记录 decoy 与比赛两个种子，可事后复核。
 */

import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { derivePreflightSeed } from '../src/core/InputProtocol';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ALGO_A = path.join(__dirname, 'fixtures', 'algos', 'precision-line');
const ALGO_B = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');
/** 故意写死锚点（y=0，即只经过 (-18,0)）的包 —— 用来证明 preflight 会拦下它 */
const HARDCODED = path.join(__dirname, 'fixtures', 'algos', 'hardcoded-anchor');

interface DecoyDetail {
  decoySeed: number;
  decoyMapSeed: number;
  decoyMapHash: string;
  matchSeed: number;
}

/** 建一台完成上传、等待 preflight 的引擎 */
function readyEngine(matchId: string, seed: number): MatchEngine {
  const root = tmpDir('decoy');
  const engine = new MatchEngine({
    matchId,
    seed,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', ALGO_A).ok, '上传 A 应成功');
  assert(engine.upload('B', ALGO_B).ok, '上传 B 应成功');
  return engine;
}

function decoyOf(detail: Record<string, unknown>): DecoyDetail {
  return detail as unknown as DecoyDetail;
}

test('preflight-decoy: decoy 种子由 matchId 派生，与操作员 --seed 无关（§14/§15）', async () => {
  const engine = readyEngine('DECOY-1', 4242);
  const r = await engine.preflight();
  assert(r.ok, `preflight 应通过: ${r.errors.join('; ')}`);

  const d = decoyOf(r.detail);
  assertEqual(d.decoySeed, derivePreflightSeed('DECOY-1'), 'decoy 种子必须由 matchId 派生');
  assert(d.decoySeed !== 4242, `decoy 种子不得等于比赛种子，实际 ${d.decoySeed}`);
  assertEqual(d.matchSeed, 4242, '审计里应记录操作员 seed');
  assertEqual(d.decoyMapSeed, d.decoySeed, '本用例的 decoy 种子无需微调');
});

test('preflight-decoy: --seed 撞上派生种子时换种子，绝不重合（§14/§15）', async () => {
  const matchId = 'DECOY-COLLIDE';
  const collideSeed = derivePreflightSeed(matchId);
  const engine = readyEngine(matchId, collideSeed);

  const r = await engine.preflight();
  assert(r.ok, `preflight 应通过: ${r.errors.join('; ')}`);
  const d = decoyOf(r.detail);

  assert(d.decoySeed !== collideSeed, `撞车时必须换种子，实际仍为 ${d.decoySeed}`);
  assert(d.decoyMapSeed !== collideSeed, 'decoy 实际用种不得等于比赛种子');

  // 比赛地图的实际用种（生成器可能微调）也必须与 decoy 不同
  assert(engine.startMatch().ok, '开始比赛应成功');
  engine.autoSelectEmitters();
  const matchMap = engine.getSnapshot().map;
  assert(matchMap, '开赛后应持有比赛地图');
  assert(d.decoyMapSeed !== matchMap.seed, 'decoy 实际用种不得等于比赛地图实际用种');
  assert(d.decoyMapHash !== matchMap.stateHash, 'decoy 世界不得与比赛世界同哈希');
});

test('preflight-decoy: 审计日志同时记录 decoy 与比赛种子（可复核）', async () => {
  const engine = readyEngine('DECOY-AUDIT', 777);
  const r = await engine.preflight();
  assert(r.ok, `preflight 应通过: ${r.errors.join('; ')}`);

  const events = engine.getArtifacts().auditLog.events.filter((e) => e.type === 'Preflight');
  assertEqual(events.length, 1, '应恰好有一条 Preflight 审计事件');
  const details = events[0].details as Record<string, unknown>;
  const d = decoyOf(r.detail);

  assertEqual(details.decoySeed, d.decoySeed, '审计与返回值的 decoy 种子必须一致');
  assertEqual(details.decoyMapHash, d.decoyMapHash, '审计与返回值的 decoy 地图哈希必须一致');
  assertEqual(details.matchSeed, 777, '审计必须记录比赛种子');
  assert(details.decoySeed !== details.matchSeed, '审计可证明两个种子不同');
});

test('preflight-decoy: decoy 世界的锚点取自 decoy 地图 —— 写死坐标的算法会被拦下', async () => {
  // 这条回归盯的是 V1.2 引入的一个**验证盲区**：
  //
  // 锚点从「平台常量」变成了「各队开赛前自选」。如果 decoy 世界仍下发常量，
  // 那么 preflight 只能验证「算法能跑」，验证不了「算法会从 public_state 读锚点」——
  // 一个写死 `-18` 的算法会顺利通过赛前校验，然后在正赛第一轮开始
  // **每轮 INVALID**（NOT_THROUGH_SHOOTER），现场才会发现。
  //
  // `hardcoded-anchor` 交出的函数恒为 y=0，即「只经过 (-18,0)」。
  const root = tmpDir('decoy-hardcode');
  const engine = new MatchEngine({
    matchId: 'DECOY-HARDCODE',
    seed: 12345,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', HARDCODED).ok, '上传写死坐标的包应成功（安装不校验锚点）');
  assert(engine.upload('B', HARDCODED).ok, '上传写死坐标的包应成功');

  const r = await engine.preflight();
  assertEqual(r.ok, false, '写死锚点的算法**必须**被 preflight 拦下');
  assert(
    r.errors.some((e) => e.includes('NOT_THROUGH_SHOOTER')),
    `拒绝原因必须点明 NOT_THROUGH_SHOOTER，实际: ${r.errors.join('; ')}`
  );
  // 也不能再拿常量坐标当借口 —— 报出来的必须是 decoy 世界里真实的锚点
  assert(
    !/f\(-18\)/.test(r.errors.join('; ')),
    `拒绝理由不得再出现常量锚点 -18（说明 decoy 又退回用常量了）: ${r.errors.join('; ')}`
  );

  // 正向对照：会读锚点的算法照样通过，否则上面只是「一律拒绝」
  const ok = readyEngine('DECOY-HARDCODE-OK', 12345);
  const okResult = await ok.preflight();
  assert(okResult.ok, `正常的算法应通过 preflight: ${okResult.errors.join('; ')}`);
});

void runAll('preflight-decoy');
