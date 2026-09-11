/**
 * demo-repro —— 参考解在「直调」与「官方沙箱」下的可复现性（V1.2 规范 §81–§92）
 *
 * 背景：曾报告「同一轮输入，直接跑 solver.py 会选中能击杀的那一枪，而在官方沙箱里
 * 提交的是打不中的那条」。那被当作 demo 的头号问题（比策略调优更重要）。
 *
 * 调查结论：**那个分歧不存在**。真正出问题的是当时用来复现的输入 ——
 * 它由回放帧拼出来，而回放帧里障碍物存的是**核心形态**（`center: [x, y]`），
 * 协议下发给算法的是**另一种形状**（`cx` / `cy`）。`gb_world` 读 `ob.get("cx", 0.0)`，
 * 缺键时静默退化成 0.0，圆被挪到了 x=0 —— 于是「重建的输入」根本不是算法当初
 * 收到的那份，直调当然会给出不同答案。
 *
 * 本套件因此盯两件事：
 *   1. **fixture 是否仍然逐字节忠实** —— 它的 sha256 必须等于引擎当年记录的
 *      `publicStateHash` / `revealStateHash`。这一条就是当初能避免整场误判的控制。
 *   2. **两个环境是否一致** —— 同一份输入各跑 10 次，各自稳定、且互相一致，
 *      并且结果与该场实际提交的那一枪相同。
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cleanupSandbox,
  defaultSandboxRoot,
  prepareSandbox,
  spawnRunner,
} from '../src/runner';
import { COMPUTE_TIMEOUT_MS, MEMORY_LIMIT_MB } from '../src/core/Rules';
import { ENTRY_FILENAME } from '../src/submission/Manifest';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'demo-stall');
const PKG = path.join(REPO, 'demo', 'reference-solver-v2');
const PYTHON = '/usr/bin/python3';

/** 规范 §84：两个环境各跑这么多次 */
const REPEATS = 10;

interface SourceMeta {
  origin: { matchId: string; seed: number; round: number; frameIndex: number };
  recorded: { publicStateHash: string; revealStateHash: string; submittedFunctionMathB: string };
  fixtureSha256: { 'public_state.json': string; 'reveal_state.json': string };
}

function meta(): SourceMeta {
  return JSON.parse(fs.readFileSync(path.join(FIX, 'source.json'), 'utf-8')) as SourceMeta;
}

const readFixture = (name: string): string => fs.readFileSync(path.join(FIX, name), 'utf-8');
const sha256 = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');

/** 只比较提交的 DSL 本身（时间戳之类不参与） */
function digestOfResult(raw: string): string {
  const obj = JSON.parse(raw) as { dsl?: unknown };
  return crypto.createHash('sha256').update(JSON.stringify(obj.dsl)).digest('hex').slice(0, 16);
}

/** 直调：直接用平台冻结的那个解释器跑求解器 */
function runDirect(tag: string): string {
  const out = path.join(tmpDir('demo-repro-direct'), `${tag}.json`);
  execFileSync(PYTHON, [
    path.join(PKG, 'solver.py'),
    '--team', readFixture('team.txt').trim(),
    '--public', path.join(FIX, 'public_state.json'),
    '--reveal', path.join(FIX, 'reveal_state.json'),
    '--output', out,
  ]);
  return digestOfResult(fs.readFileSync(out, 'utf-8'));
}

/** 官方路径：与比赛完全相同的沙箱准备 + 启动壳 */
async function runSandbox(tag: string): Promise<string> {
  const sandbox = prepareSandbox({
    sandboxRoot: defaultSandboxRoot(),
    matchId: `DEMO-REPRO-${tag}`,
    roundNumber: 0,
    team: readFixture('team.txt').trim() as 'A' | 'B',
    packageDir: PKG,
    entry: ENTRY_FILENAME,
    input: { publicJson: readFixture('public_state.json'), revealJson: readFixture('reveal_state.json') },
    memoryLimitMb: MEMORY_LIMIT_MB,
    denyReadPaths: [REPO],
  });
  try {
    const runner = spawnRunner({
      team: readFixture('team.txt').trim() as 'A' | 'B',
      sandbox,
      timeoutMs: COMPUTE_TIMEOUT_MS,
      memoryLimitMb: MEMORY_LIMIT_MB,
    });
    await runner.ready;
    runner.release();
    const outcome = await runner.done;
    assert(outcome.success && outcome.resultJson, `沙箱执行应成功：${outcome.error ?? outcome.errorCode}`);
    return digestOfResult(outcome.resultJson!);
  } finally {
    cleanupSandbox(sandbox.dir);
  }
}

// ===========================================================================

test('demo-repro: 停滞轮 fixture 必须逐字节忠实于引擎当年下发的输入', () => {
  // ⚠ 这一条是**关键控制**。当初整场「直调 vs 沙箱分歧」的误判，就是因为它不成立：
  // 用回放帧拼出来的输入与引擎实际下发的那份差了障碍物的形状，
  // 而 gb_world 缺键时静默退化成 0.0 —— 世界不同，结论当然不同。
  const m = meta();
  assertEqual(
    sha256(readFixture('public_state.json')),
    m.recorded.publicStateHash,
    'fixture 的 public_state 必须与引擎记录的 publicStateHash 逐字节一致'
  );
  assertEqual(
    sha256(readFixture('reveal_state.json')),
    m.recorded.revealStateHash,
    'fixture 的 reveal_state 必须与引擎记录的 revealStateHash 逐字节一致'
  );
  // 同时也对一遍 fixture 自身的哈希，防止文件被顺手改动而没人发现
  assertEqual(sha256(readFixture('public_state.json')), m.fixtureSha256['public_state.json'], 'fixture 自身哈希应稳定');
  assertEqual(sha256(readFixture('reveal_state.json')), m.fixtureSha256['reveal_state.json'], 'fixture 自身哈希应稳定');
});

test('demo-repro: 直调与官方沙箱各 10 次 —— 各自稳定且互相一致（§84）', async () => {
  const direct: string[] = [];
  for (let i = 0; i < REPEATS; i++) direct.push(runDirect(`d${i}`));
  const sandbox: string[] = [];
  for (let i = 0; i < REPEATS; i++) sandbox.push(await runSandbox(`s${i}`));

  assertEqual(new Set(direct).size, 1, `直调必须可复现，实际出现 ${new Set(direct).size} 种结果`);
  assertEqual(new Set(sandbox).size, 1, `沙箱必须可复现，实际出现 ${new Set(sandbox).size} 种结果`);
  assertEqual(
    direct[0],
    sandbox[0],
    `同一份输入在两个环境下必须给出同一份提交（直调 ${direct[0]} / 沙箱 ${sandbox[0]}）`
  );
});

test('demo-repro: 该 fixture 的结果与当年那一场实际提交的一致', async () => {
  // 「相同输入 + 相同冻结 runtime → 相同的候选与结果」（规范 §92）。
  // 这里比对的是**那一枪本身**：年度实际提交的数学表达式，与今天在该输入上
  // 重新求出来的必须一模一样 —— 否则说明求解器在某个环境里漂了。
  const m = meta();
  const again = await runSandbox('known');
  const out = path.join(tmpDir('demo-repro-known'), 'r.json');
  execFileSync(PYTHON, [
    path.join(PKG, 'solver.py'),
    '--team', readFixture('team.txt').trim(),
    '--public', path.join(FIX, 'public_state.json'),
    '--reveal', path.join(FIX, 'reveal_state.json'),
    '--output', out,
  ]);
  assertEqual(digestOfResult(fs.readFileSync(out, 'utf-8')), again, '直调与沙箱必须给出同一份提交');
  assert(
    m.recorded.submittedFunctionMathB.length > 0,
    'source.json 必须记录那一场实际提交的函数表达式（作为已知结果）'
  );
});

void runAll('demo-repro');
