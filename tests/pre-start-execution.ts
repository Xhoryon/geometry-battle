/**
 * pre-start-execution —— START 前参赛代码绝不运行（规范 §14/§15/§25）
 *
 * 这是 V1.1 三大原则里最容易被「实现成看起来对」的一条：JSON 可以提前存在，
 * 但**执行环境不能提前执行参赛代码**。本套件用探针算法硬断言这件事。
 *
 * 探针在**模块顶层**（runpy 之前就执行的代码）写一个标记文件，因此：
 *   - 标记存在 ⇔ 参赛代码被执行过；
 *   - 只断言「标记不存在」是不够的 —— 必须配一条正向对照（GO 之后标记必须出现），
 *     否则探针写错路径也会让测试通过（假阳性防护）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import {
  PreparedSandbox,
  cleanupSandbox,
  prepareSandbox,
  spawnRunner,
} from '../src/runner/SandboxRunner';
import { RunnerInput } from '../src/runner/SandboxRunner';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';

const MARKER = 'STARTED.marker';

/** 模块顶层就写标记，然后才读输入、写出一个经过自己 Shooter 的合法 result.json */
const PROBE_SOURCE = `# ---- 参赛代码的第一行：START 之前绝不能被执行 ----
with open("${MARKER}", "w") as f:
    f.write("ran")

${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "rb") as f:
    public_bytes = f.read()
public = json.loads(public_bytes.decode("utf-8"))
with open(args.reveal, "r") as f:
    reveal = json.load(f)

by_id = {p["id"]: p for p in public["points"]}
me = public["emitters"][args.team]
# f(x) = y0 + 0 * x —— 严格经过自己的 Shooter
dsl = {
    "type": "add",
    "args": [
        {"type": "number", "value": me["y"]},
        {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
    ],
}
emit(dsl)
`;

function probePackage(): string {
  const dir = tmpDir('probe-pkg');
  fs.writeFileSync(path.join(dir, 'solver.py'), PROBE_SOURCE);
  return dir;
}

function input(): RunnerInput {
  const pub = buildPublicState({
    matchId: 'PRE-START',
    round: 1,
    points: [
      { id: 'A1', team: 'A', x: -12, y: 4, alive: true },
      { id: 'B1', team: 'B', x: 12, y: -4, alive: true },
    ],
  });
  const rev = buildRevealState({
    matchId: 'PRE-START',
    round: 1,
    publicStateSha256: pub.sha256,
    obstacles: [],
  });
  return { publicJson: pub.json, revealJson: rev.json };
}

function prepare(root: string, team: 'A' | 'B'): PreparedSandbox {
  return prepareSandbox({
    sandboxRoot: path.join(root, 'sandboxes'),
    matchId: 'PRE-START',
    roundNumber: 1,
    team,
    packageDir: probePackage(),
    entry: 'solver.py',
    input: input(),
    memoryLimitMb: 512,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('pre-start-execution: READY 之后不 GO，参赛代码一行都不执行（§14/§15）', async () => {
  const root = tmpDir('prestart');
  const sandboxes = { A: prepare(root, 'A'), B: prepare(root, 'B') };

  // 两份 JSON 在进程创建之前就存在 —— 规范 §15 明确允许（不允许的只有「执行」）
  for (const team of ['A', 'B'] as const) {
    const sb = sandboxes[team];
    assert(fs.existsSync(sb.publicPath), `${team}: public_state.json 必须提前存在（§15）`);
    assert(fs.existsSync(sb.revealPath), `${team}: reveal_state.json 必须提前存在（§15）`);
    assert(!fs.existsSync(path.join(sb.workDir, MARKER)), `${team}: 准备阶段不应有标记`);
  }

  const runners = (['A', 'B'] as const).map((team) =>
    spawnRunner({ team, sandbox: sandboxes[team], timeoutMs: 3000, memoryLimitMb: 512 })
  );

  try {
    for (const r of runners) await r.ready;

    // 给探针充分的机会去执行（若 bootstrap 门控失效，标记会在这段时间内出现）
    await sleep(500);

    for (const team of ['A', 'B'] as const) {
      const sb = sandboxes[team];
      assert(
        !fs.existsSync(path.join(sb.workDir, MARKER)),
        `${team}: START 前参赛代码绝不得执行（规范 §14/§15）`
      );
      // 进程必须仍然活着 —— 「没执行」不能是因为进程已经死了
      const runner = runners.find((r) => r.team === team)!;
      assertEqual(runner.proc.exitCode, null, `${team}: 未 GO 时进程必须仍然存活`);
    }

    // ---- 正向对照：GO 之后标记必须出现，否则上面的断言可能只是探针失效 ----
    for (const r of runners) r.release();
    const outcomes = await Promise.all(runners.map((r) => r.done));
    for (const outcome of outcomes) {
      assert(outcome.success, `${outcome.team}: 探针必须正常完成: ${outcome.error}`);
      assert(outcome.dslText !== null, `${outcome.team}: 探针必须写出合法的 result.json`);
    }
    for (const team of ['A', 'B'] as const) {
      assert(
        fs.existsSync(path.join(sandboxes[team].workDir, MARKER)),
        `${team}: GO 之后参赛代码必须执行（正向对照）`
      );
    }
  } finally {
    for (const r of runners) r.cancel();
    for (const team of ['A', 'B'] as const) cleanupSandbox(sandboxes[team].dir);
  }
});

test('pre-start-execution: 未 GO 就取消，参赛代码同样不执行', async () => {
  const root = tmpDir('prestart-cancel');
  const sb = prepare(root, 'A');
  const runner = spawnRunner({ team: 'A', sandbox: sb, timeoutMs: 3000, memoryLimitMb: 512 });

  await runner.ready;
  await sleep(200);
  assert(!fs.existsSync(path.join(sb.workDir, MARKER)), '取消前不应执行');

  runner.cancel();
  const outcome = await runner.done;
  await sleep(200);

  assert(!outcome.success, '被取消的进程不应报告成功');
  assert(
    !fs.existsSync(path.join(sb.workDir, MARKER)),
    '未 GO 就取消 —— 参赛代码绝不得执行（规范 §14/§15）'
  );
  cleanupSandbox(sb.dir);
});

void runAll('pre-start-execution');
