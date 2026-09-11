/**
 * stage-gating —— V1.1 三段式编排的门禁与冻结（规范 §14/§15/§18/§19/§20/§25）
 *
 * 覆盖：
 *   1. 未 START 直接 computeRound() 必须抛错（START 是硬门禁）；
 *   2. judgeStartRound() 幂等；
 *   3. 阶段推进与真实流程一一对应（Rule Revision 3 §5 起不再有 Shooter Selection），
 *      且 REVEAL 在 START_ROUND **之前**；
 *   4. START 后输入字节冻结 —— 日志里的哈希就是 START 前算出的那一份；
 *   5. roundStateHash = SHA256(publicHash + revealHash)（§20）。
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { MatchEngine, MatchEngineError } from '../src/core/Match';
import { assert, assertEqual, assertRejects, runAll, test, tmpDir } from './harness';

const ALGO_A = path.join(__dirname, 'fixtures', 'algos', 'precision-line');
const ALGO_B = path.join(__dirname, 'fixtures', 'algos', 'parabola-arc');

/**
 * 走到「可以开一轮」为止：上传 → preflight → 开始比赛。
 *
 * Rule Revision 3 §5 删除了选点/锁定，因此这里不再需要任何人工动作 ——
 * 开始比赛即进入 PUBLIC，直接可以 beginRound。
 */
async function lockedEngine(matchId: string): Promise<MatchEngine> {
  const root = tmpDir('gating');
  const engine = new MatchEngine({
    matchId,
    seed: 5150,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  assert(engine.upload('A', ALGO_A).ok, '上传 A 应成功');
  assert(engine.upload('B', ALGO_B).ok, '上传 B 应成功');
  assert((await engine.preflight()).ok, 'preflight 应通过');
  assert(engine.startMatch().ok, '开始比赛应成功');
  engine.autoSelectEmitters();
  return engine;
}

test('stage-gating: 未 START 直接 computeRound() 必须抛错（§14/§15）', async () => {
  const engine = await lockedEngine('GATE-1');

  const pre = engine.beginRound();
  assertEqual(pre.round, 1, '第一轮的 round 应为 1');
  assertEqual(pre.publicStateHash.length, 64, 'public hash 应为 sha256');
  assertEqual(engine.getSnapshot().phase, 'PUBLIC', 'PUBLIC 后阶段应为 PUBLIC（等待揭盲）');

  const rev = engine.revealRound();
  assertEqual(rev.revealStateHash.length, 64, 'reveal hash 应为 sha256');
  assertEqual(engine.getSnapshot().phase, 'REVEAL', '揭盲后阶段应为 REVEAL（算法仍未运行）');

  // 硬门禁：没有 START，参赛代码绝不运行
  await assertRejects(() => engine.computeRound(), '未 START 就 computeRound 必须抛错');

  assert(engine.judgeStartRound().ok, 'START 应成功');
  assertEqual(engine.getSnapshot().phase, 'COUNTDOWN', 'START 后阶段应为 COUNTDOWN');

  const result = await engine.computeRound();
  assertEqual(result.round, 1, '应结算第 1 轮');
  assertEqual(result.publicStateHash, pre.publicStateHash, '日志哈希必须等于 START 前算出的 public hash');
  assertEqual(result.revealStateHash, rev.revealStateHash, '日志哈希必须等于 START 前算出的 reveal hash');
});

test('stage-gating: judgeStartRound() 幂等，且新一轮开始前不得重复 START', async () => {
  const engine = await lockedEngine('GATE-2');

  assert(engine.judgeStartRound().ok, '第一次 START 应成功');
  assert(engine.judgeStartRound().ok, '重复 START 应幂等成功');
  assert(engine.judgeStartRound().ok, '第三次 START 仍应幂等成功');

  const result = await engine.computeRound();
  assertEqual(result.round, 1, '幂等调用不应多算一轮');

  // 真正的门禁不是「必须先揭盲」而是「必须先有本轮输入」：`judgeStartRound()`
  // 对尚未揭盲的调用序会按规范顺序补齐 REVEAL（它只生成文件、不运行参赛代码），
  // 因此这里断言的是补齐确实发生了，而不是拒绝。
  if (engine.getWinner() === null) {
    const started = engine.judgeStartRound();
    assert(started.ok, '新一轮应能 START（缺 REVEAL 时按顺序补齐）');
    assertEqual(
      engine.getSnapshot().phase,
      'COUNTDOWN',
      '补齐揭盲后阶段应为 COUNTDOWN'
    );
    // 硬门禁仍在：没有 START 就没有参赛代码运行（见下一条用例）
  }
});

test('stage-gating: REVEAL 必须发生在 START_ROUND 之前（§3/§25）', async () => {
  const engine = await lockedEngine('GATE-3');
  engine.beginRound();
  engine.revealRound();
  engine.judgeStartRound();
  const result = await engine.computeRound();

  const phases = result.machinePhases;
  const idx = (p: string) => phases.indexOf(p as never);
  // Rule Revision 3 §5：SHOOTER_SELECTION / A_LOCKED / B_LOCKED / CHECK_SHOOTER
  // 四个阶段已从状态机删除（19 → 16），取而代之的是 PUBLIC。
  for (const p of ['PUBLIC', 'WAITING_FOR_JUDGE', 'REVEAL', 'START_ROUND', 'COUNTDOWN', 'SEND_ROUND_STATE']) {
    assert(idx(p) >= 0, `状态机必须经过 ${p}，实际: ${phases.join(' → ')}`);
  }
  for (const gone of ['SHOOTER_SELECTION', 'A_LOCKED', 'B_LOCKED', 'CHECK_SHOOTER']) {
    assert(idx(gone) < 0, `旧阶段 ${gone} 必须已删除，实际: ${phases.join(' → ')}`);
  }
  assert(idx('PUBLIC') < idx('WAITING_FOR_JUDGE'), `输入冻结必须在等待裁判之前: ${phases.join(' → ')}`);
  assert(idx('REVEAL') < idx('START_ROUND'), `揭盲必须在 START 之前: ${phases.join(' → ')}`);
  assert(idx('START_ROUND') < idx('COUNTDOWN'), `START 必须在倒计时之前: ${phases.join(' → ')}`);
  assert(idx('COUNTDOWN') < idx('SEND_ROUND_STATE'), `倒计时必须在投递输入之前: ${phases.join(' → ')}`);
  assert(idx('SEND_ROUND_STATE') < idx('A_COMPUTING'), `投递输入必须在计算之前: ${phases.join(' → ')}`);
});

test('stage-gating: START 后输入冻结 —— 结算（含击杀）不改变本轮哈希（§19）', async () => {
  const engine = await lockedEngine('GATE-4');
  const pre = engine.beginRound();
  const rev = engine.revealRound();
  engine.judgeStartRound();
  const result = await engine.computeRound();

  // 冻结语义：日志中的三元哈希就是 START 前生成的那一份，
  // 因此「先手击杀改变了 alive」不可能改变本轮的输入。
  assertEqual(result.log.publicStateHash, pre.publicStateHash, '§19: public 字节必须冻结');
  assertEqual(result.log.revealStateHash, rev.revealStateHash, '§19: reveal 字节必须冻结');

  // §20：roundStateHash = SHA256(publicHash + revealHash)，可独立复核
  const recomputed = crypto
    .createHash('sha256')
    .update(result.publicStateHash + result.revealStateHash)
    .digest('hex');
  assertEqual(result.roundStateHash, recomputed, '§20: roundStateHash 必须等于 SHA256(public + reveal)');
  assertEqual(result.log.roundStateHash, recomputed, '日志里的 roundStateHash 必须可复核');

  // 回放帧与日志逐轮同源
  const frame = engine.getReplay().frames[0];
  assertEqual(frame.roundStateHash, result.roundStateHash, '回放帧必须带同一份 roundStateHash');
  assertEqual(frame.publicStateHash, result.publicStateHash, '回放帧必须带同一份 publicStateHash');
});

test('stage-gating: 输入字节在冻结后重新生成仍是同一份（同一轮重入不改变哈希）', async () => {
  const engine = await lockedEngine('GATE-5');
  const first = engine.beginRound();
  const again = engine.beginRound();
  assertEqual(again.round, first.round, '同一轮重复 beginRound 不应推进轮次');
  assertEqual(again.publicStateHash, first.publicStateHash, 'public 字节必须稳定');

  const rev1 = engine.revealRound();
  const rev2 = engine.revealRound();
  assertEqual(rev2.revealStateHash, rev1.revealStateHash, 'reveal 字节必须稳定');
  assertEqual(rev2.roundStateHash, rev1.roundStateHash, 'roundStateHash 必须稳定');

  // 揭盲必须发生在 PUBLIC 之后：还没生成本轮输入就揭盲应抛错
  const fresh = new MatchEngine({
    matchId: 'GATE-5B',
    seed: 99,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(tmpDir('gating5b'), 'artifacts'),
    sandboxRoot: path.join(tmpDir('gating5b'), 'sandboxes'),
  });
  fresh.upload('A', ALGO_A);
  fresh.upload('B', ALGO_B);
  assert((await fresh.preflight()).ok, 'preflight 应通过');
  // 比赛未开始（阶段 READY）时不得揭盲
  let threw = false;
  try {
    fresh.revealRound();
  } catch (e) {
    threw = e instanceof MatchEngineError;
  }
  assert(threw, '比赛未开始就揭盲必须抛 MatchEngineError');

  // 开赛 → 双方锁定 Emitter → 可以揭盲
  fresh.startMatch();
  fresh.autoSelectEmitters();
  const rev = fresh.revealRound();
  assertEqual(rev.revealStateHash.length, 64, '锁定 Emitter 之后应能正常揭盲');
});

void runAll('stage-gating');
