/**
 * result-ipc —— 结果通道契约（规范 §24/§25/§26/§27/§28/§29/§30）
 *
 * 这是 V1.1 的 IPC 冻结面，逐条对应：
 *   §24  stdout 不是结果通道；
 *   §25  result.json 的形态；
 *   §26  只允许 schema_version 与 dsl 两个键；
 *   §27  原子写（Judge 只监听 result.json 出现）；
 *   §28  2000ms deadline：deadline 前形成完整合法文件 → OUTPUT RECEIVED，否则 TIMEOUT；
 *   §29  非法结果统一进入 INVALID SHOT，且每回合 ONE OUTPUT ONLY（不能重新提交）；
 *   §30  stdout 可被捕获/限长/忽略，stderr 允许有限 debug。
 *
 * 关于 §28/§29 的分界（实现口径，测试一并钉住）：
 *   进程**退出时**留下一个完整但不合法的 result.json → INVALID_OUTPUT（§29）；
 *   deadline 前从未出现完整合法的 result.json（含只写了半截就卡住） → TIMEOUT（§28）。
 *   两者都不是「成功」，但错误码必须可区分，否则现场无法判断是算法写错了还是根本没写出来。
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import {
  PreparedSandbox,
  RunnerInput,
  cleanupSandbox,
  prepareSandbox,
  spawnRunner,
} from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { PY_ARGV_PRELUDE } from './protocol-fixture';

/** 自己的 Shooter 永远在 A1，坐标固定，便于构造确定性的 DSL */
const SHOOTER_Y = 4;

function input(): RunnerInput {
  const pub = buildPublicState({
    matchId: 'RESULT-IPC',
    round: 1,
    points: [
      { id: 'A1', team: 'A', x: -12, y: SHOOTER_Y, alive: true },
      { id: 'B1', team: 'B', x: 12, y: -4, alive: true },
    ],
  });
  const rev = buildRevealState({
    matchId: 'RESULT-IPC',
    round: 1,
    publicStateSha256: pub.sha256,
    shooters: { A: 'A1', B: 'B1' },
    obstacles: [],
  });
  return { publicJson: pub.json, revealJson: rev.json };
}

/** 与 SDK 模板同构的 emit：tmp + fsync + 原子 rename（§27） */
const EMIT = `def emit(payload):
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, args.output)
`;

const PRELUDE = `import json, os, sys\n${PY_ARGV_PRELUDE}`;

function pkg(prefix: string, source: string): string {
  const dir = path.join(tmpDir(prefix), 'pkg');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'solver.py'), source);
  return dir;
}

interface Ran {
  sandbox: PreparedSandbox;
  outcome: Awaited<ReturnType<ReturnType<typeof spawnRunner>['done']['then']>>;
}

async function run(root: string, source: string, timeoutMs = 4000) {
  const sandbox = prepareSandbox({
    sandboxRoot: path.join(root, 'sandboxes'),
    matchId: 'RESULT-IPC',
    roundNumber: 1,
    team: 'A',
    packageDir: pkg(path.basename(root), source),
    entry: 'solver.py',
    input: input(),
    memoryLimitMb: 512,
  });
  const runner = spawnRunner({ team: 'A', sandbox, timeoutMs, memoryLimitMb: 512 });
  await runner.ready;
  runner.release();
  const outcome = await runner.done;
  return { sandbox, outcome };
}

/** 一份语法完整、语义合法的 result.json 文本（数字 222 作为「来自文件」的标记） */
const VALID_RESULT = JSON.stringify({
  schema_version: '1.1',
  dsl: {
    type: 'add',
    args: [
      { type: 'number', value: 222 },
      { type: 'mul', args: [{ type: 'number', value: 0 }, { type: 'variable', value: 'x' }] },
    ],
  },
});

test('result-ipc: stdout 不是结果通道（§24）', async () => {
  const root = tmpDir('ipc-stdout-only');
  // stdout 打出一份完美结果，但**从不**写 result.json
  const { sandbox, outcome } = await run(
    root,
    `${PRELUDE}sys.stdout.write(${JSON.stringify(VALID_RESULT)} + "\\n")
sys.stdout.flush()
import time
time.sleep(0.3)
`
  );
  assert(!outcome.success, 'stdout 上的结果不得被当作比赛结果（§24）');
  assertEqual(outcome.errorCode, 'INVALID_OUTPUT', '未生成 output/result.json 应报 INVALID_OUTPUT');
  assertEqual(outcome.dslText, null, '不得从 stdout 回填 dslText');
  assert(outcome.stdout.includes('222'), 'stdout 仍应被留档（供诊断），只是不参与判定');
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: 结果只认文件，stdout 内容被忽略（§24/§30）', async () => {
  const root = tmpDir('ipc-file-wins');
  // stdout 与文件各写一份**不同**的 DSL：文件里是 222，stdout 里是 111
  const { sandbox, outcome } = await run(
    root,
    `${PRELUDE}${EMIT}sys.stdout.write(json.dumps({"schema_version": "1.1", "dsl": {"type": "number", "value": 111}}))
sys.stdout.flush()
emit(${JSON.stringify(VALID_RESULT)})
`
  );
  assert(outcome.success, `应正常完成: ${outcome.errorCode} ${outcome.error}`);
  assert(outcome.dslText !== null && outcome.dslText.includes('222'), '判定必须用文件里的 DSL');
  assert(!outcome.dslText!.includes('111'), 'stdout 里的 DSL 绝不能进入判定');
  assertEqual(outcome.resultJson, VALID_RESULT, 'resultJson 必须是文件的确切字节');
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: result.json 多一个键即非法（§26）', async () => {
  const root = tmpDir('ipc-extra-key');
  const withExtra = JSON.stringify({ schema_version: '1.1', dsl: { type: 'number', value: 222 }, hits: ['B1'] });
  const { sandbox, outcome } = await run(root, `${PRELUDE}${EMIT}emit(${JSON.stringify(withExtra)})\n`);
  assert(!outcome.success, '多余字段必须被拒绝（§26）');
  assertEqual(outcome.errorCode, 'INVALID_OUTPUT', '应报 INVALID_OUTPUT');
  assert(
    (outcome.error ?? '').includes('schema_version'),
    `错误信息应点明允许的键，实际: ${outcome.error}`
  );
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: schema_version 必须精确为 "1.1"（§25）', async () => {
  const root = tmpDir('ipc-version');
  const wrong = JSON.stringify({ schema_version: '1.0', dsl: { type: 'number', value: 222 } });
  const { sandbox, outcome } = await run(root, `${PRELUDE}${EMIT}emit(${JSON.stringify(wrong)})\n`);
  assert(!outcome.success, '错误的 schema_version 必须被拒绝');
  assertEqual(outcome.errorCode, 'INVALID_OUTPUT', '应报 INVALID_OUTPUT');
  assert((outcome.error ?? '').includes('1.1'), `错误信息应点明 1.1，实际: ${outcome.error}`);
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: 缺 dsl / 顶层不是对象 一律非法（§25/§29）', async () => {
  const root = tmpDir('ipc-shape');
  const cases: [string, string][] = [
    ['缺 dsl', JSON.stringify({ schema_version: '1.1' })],
    ['顶层是数组', JSON.stringify([{ schema_version: '1.1', dsl: { type: 'number', value: 1 } }])],
    ['dsl 为 null', JSON.stringify({ schema_version: '1.1', dsl: null })],
  ];
  for (const [label, payload] of cases) {
    const { sandbox, outcome } = await run(
      path.join(root, label.replace(/\s/g, '-')),
      `${PRELUDE}${EMIT}emit(${JSON.stringify(payload)})\n`
    );
    assert(!outcome.success, `${label} 必须被拒绝`);
    assertEqual(outcome.errorCode, 'INVALID_OUTPUT', `${label} 应报 INVALID_OUTPUT`);
    cleanupSandbox(sandbox.dir);
  }
});

test('result-ipc: 半截 JSON 到 deadline 仍是 TIMEOUT（§28）', async () => {
  const root = tmpDir('ipc-partial');
  // 直接写 result.json（不是原子写）然后卡住：文件存在但永远不完整
  const { sandbox, outcome } = await run(
    root,
    `${PRELUDE}with open(args.output, "w", encoding="utf-8") as f:
    f.write('{"schema_version": "1.1", "dsl": {"type": "number"')
    f.flush()
    os.fsync(f.fileno())
import time
time.sleep(30)
`,
    1200
  );
  assert(!outcome.success, '不完整的结果不得算作完成');
  assertEqual(outcome.errorCode, 'TIMEOUT', 'deadline 前未形成完整合法文件应报 TIMEOUT（§28）');
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: 完整但不合法的结果在退出时报 INVALID_OUTPUT（§29）', async () => {
  const root = tmpDir('ipc-invalid-final');
  // 半截 JSON 后立刻正常退出：进程结束时文件状态就是最终状态
  const { sandbox, outcome } = await run(
    root,
    `${PRELUDE}with open(args.output, "w", encoding="utf-8") as f:
    f.write('{"schema_version": "1.1", "dsl": {"type": "number"')
sys.exit(0)
`
  );
  assert(!outcome.success, '不完整的 JSON 不得算作完成');
  assertEqual(outcome.errorCode, 'INVALID_OUTPUT', '进程退出时留下非法结果应报 INVALID_OUTPUT（§29）');
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: 写完结果后不退出也不拖到 deadline（§27/§28）', async () => {
  const root = tmpDir('ipc-one-output');
  const started = Date.now();
  const { sandbox, outcome } = await run(
    root,
    `${PRELUDE}${EMIT}emit(${JSON.stringify(VALID_RESULT)})
import time
time.sleep(30)
`,
    5000
  );
  const elapsed = Date.now() - started;
  assert(outcome.success, `写入合法结果后应立即判定成功: ${outcome.errorCode} ${outcome.error}`);
  assert(elapsed < 3000, `不得等到 deadline 才返回，实际 ${elapsed}ms`);
  // ONE OUTPUT ONLY：结果一旦被接收就结束，不存在「再写一次」的机会
  assert(outcome.computeTimeMs < 2000, `计时应在 deadline 之内，实际 ${outcome.computeTimeMs}ms`);
  cleanupSandbox(sandbox.dir);
});

test('result-ipc: 只 sleep 不产出 → TIMEOUT，且耗时贴近 deadline（§28）', async () => {
  const root = tmpDir('ipc-timeout');
  const timeoutMs = 1200;
  const { sandbox, outcome } = await run(root, `${PRELUDE}import time\ntime.sleep(30)\n`, timeoutMs);
  assertEqual(outcome.errorCode, 'TIMEOUT', '未产出结果应报 TIMEOUT');
  assert(
    outcome.computeTimeMs >= timeoutMs - 200,
    `耗时应从本方 GO 起算并贴近 deadline，实际 ${outcome.computeTimeMs}ms（deadline ${timeoutMs}ms）`
  );
  cleanupSandbox(sandbox.dir);
});

void runAll('result-ipc');
