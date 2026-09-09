/**
 * hostile-input —— 恶意 / 病态算法输入下的平台健壮性
 *
 * 覆盖 Finding（Re-Gate Cycle 1）：
 *   P0-A  深度约 6000 的嵌套 AST（约 144 KB，远低于 256 KB stdout 上限）
 *         会让宿主抛出未捕获的 RangeError，整场比赛中止且零落盘
 *   P1-A  产物只在整场结束后一次性落盘 → 中止即丢失全部日志
 *
 * 判定标准是「平台自己活下来了」，不是「算法选择不发坏」：
 * 恶意包在真实沙箱里跑、经正式 CLI / MatchEngine 驱动，
 * 断言平台不崩溃、把恶意输出判为非法、并且每回合都留下产物。
 *
 * Cycle 2 追加：区分「缺少 dsl 字段」与「DSL 嵌套过深」两种失败原因
 * （JSON.parse / JSON.stringify 都是递归实现，超深载荷会在序列化阶段抛
 *  RangeError；早期实现把它和格式错误混为一谈，诊断归因错误）。
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ROOT = path.join(__dirname, '..');
const STARTER = path.join(ROOT, 'starter');

/**
 * Python 表达式：求值为深度 N 的 neg 链 DSL JSON 文本（约 144 KB）。
 * 注意返回的是**源码片段**而非 JSON 本身 —— 直接内联 JSON 会让 solver.py 语法错误。
 */
function deepDslPyExpr(depth: number): string {
  return (
    `'{"dsl":' + '{"type":"neg","args":[' * ${depth} + ` +
    `'{"type":"number","value":1}' + ']}' * ${depth} + '}'`
  );
}

/** Python 表达式：求值为 N 层嵌套数组的 JSON（20 万字节，低于 256 KB stdout 上限） */
function hugeJsonPyExpr(depth: number): string {
  return `'{"dsl":' + '[' * ${depth} + ']' * ${depth} + '}'`;
}

function writeManifest(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name, version: '1.0.0', entry: 'solver.py', language: 'python' })
  );
}

/**
 * 恶意包：round 0（Preflight）输出合法小 AST 以通过预检，
 * 之后每回合输出 `payloadExpr` 求值出的恶意载荷。
 * payloadExpr 是 Python 表达式，求值结果应为一段 JSON 文本。
 */
function writeRoundGatedPackage(dir: string, name: string, payloadExpr: string): void {
  writeManifest(dir, name);
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    `import json, sys
state = json.loads(sys.stdin.readline())
team = state["team_id"]
y0 = state["shooters"][team]["position"]["y"]
if state.get("round", 0) == 0:
    sys.stdout.write(json.dumps({"dsl": {"type": "number", "value": y0}}) + "\\n")
else:
    sys.stdout.write(${payloadExpr} + "\\n")
`
  );
}

/** 恶意包：连 Preflight 都输出超深 AST */
function writeAlwaysDeepPackage(dir: string, depth: number): void {
  writeManifest(dir, 'always-deep');
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    `import sys
sys.stdin.readline()
N = ${depth}
sys.stdout.write('{"dsl":' + '{"type":"neg","args":[' * N + '{"type":"number","value":1}' + ']}' * N + "}\\n")
`
  );
}

/** 无害但对局的陪练包：永远输出一条经过自己 Shooter 的水平线（打不中任何人） */
function writeHarmlessPackage(dir: string): void {
  writeManifest(dir, 'harmless');
  fs.writeFileSync(
    path.join(dir, 'solver.py'),
    `import json, sys
state = json.loads(sys.stdin.readline())
team = state["team_id"]
y0 = state["shooters"][team]["position"]["y"]
sys.stdout.write(json.dumps({"dsl": {"type": "number", "value": y0}}) + "\\n")
`
  );
}

interface EngineRun {
  engine: MatchEngine;
  result: Awaited<ReturnType<MatchEngine['runRound']>>;
  artifactDir: string;
}

/** 用 MatchEngine 跑一回合（正式路径，无任何测试后门） */
async function runOneRoundWith(
  matchId: string,
  algoA: string,
  algoB: string,
  seed = 20260909
): Promise<EngineRun> {
  const root = tmpDir('hostile');
  const engine = new MatchEngine({
    matchId,
    seed,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  const upA = engine.upload('A', algoA);
  assert(upA.ok, `A 上传应成功: ${upA.errors.join('; ')}`);
  const upB = engine.upload('B', algoB);
  assert(upB.ok, `B 上传应成功: ${upB.errors.join('; ')}`);

  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);

  assert(engine.startMatch().ok, 'startMatch 应成功');
  assert(engine.selectShooter('A', 'A1').ok, 'A1 应可被选中');
  assert(engine.lockShooter('A').ok, 'A 应可锁定');
  assert(engine.selectShooter('B', 'B1').ok, 'B1 应可被选中');
  assert(engine.lockShooter('B').ok, 'B 应可锁定');
  assert(engine.judgeStartRound().ok, '应可 START ROUND');

  const result = await engine.runRound();
  return { engine, result, artifactDir: engine.getArtifactDir() };
}

/** 用正式 Preflight 路径跑一次，返回结果（不抛异常） */
async function preflightWith(matchId: string, algoA: string, algoB: string) {
  const root = tmpDir('hostile-preflight');
  const engine = new MatchEngine({
    matchId,
    seed: 20260909,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
  engine.upload('A', algoA);
  engine.upload('B', algoB);
  return engine.preflight();
}

test('hostile-input: 深度 6000 的 AST 被记为 INVALID，而不是让引擎崩溃（P0-A 回归）', async () => {
  const hostile = path.join(tmpDir('hostile-src'), 'deep');
  writeRoundGatedPackage(hostile, 'deep-ast', deepDslPyExpr(6000));

  const { result } = await runOneRoundWith('HOSTILE-DEEP-ENGINE', hostile, STARTER);

  assertEqual(result.log.aErrorCode, 'INVALID_OUTPUT', 'A 的输出应被判为非法（不含可解析 DSL）');
  assertEqual(result.log.result, 'INVALID_A', '回合结果应记为 INVALID_A');
  assert(result.log.bFunction !== null, 'B 的合法输出不应被 A 影响');
  assert(result.log.round === 1, '该回合应正常完成并记录');
});

test('hostile-input: 超深 AST 在 Preflight 被干净拒绝且归因正确（P0-A 回归）', async () => {
  const alwaysDeep = path.join(tmpDir('hostile-src'), 'always-deep');
  writeAlwaysDeepPackage(alwaysDeep, 6000);

  // 关键：必须返回失败，而不是抛出 RangeError
  const pre = await preflightWith('HOSTILE-DEEP-PREFLIGHT', alwaysDeep, STARTER);
  assert(!pre.ok, '超深 AST 的包必须 Preflight 失败');

  const aError = pre.errors.find((e) => e.startsWith('A '));
  assert(aError, `失败必须归因到 A 队，实际: ${pre.errors.join('; ')}`);
  assert(
    /^A 算法(无法正常运行|输出不合法)/.test(aError!),
    `A 的失败原因必须是「输出不可用」，实际: ${aError}`
  );
  // JSON.parse / JSON.stringify 都是递归实现：6000 层时抛点取决于当时剩余栈深，
  // 因此只断言「原因指向嵌套深度」，不断言是解析阶段还是序列化阶段抛的。
  assert(
    /嵌套过深|不是合法 DSL|缺少 dsl 字段/.test(aError!),
    `A 的失败原因必须指向载荷本身，实际: ${aError}`
  );
  assert(
    !/Maximum call stack size exceeded/.test(aError!) || /嵌套过深/.test(aError!),
    `不得把宿主栈溢出当成正常结果泄漏给用户，实际: ${aError}`
  );
});

test('hostile-input: 刚好超过深度上限的 AST 被确定性拒绝（P0-A 深度守卫）', async () => {
  // 40 层：远低于 JSON.parse / JSON.stringify 的递归上限，
  // 因此失败一定来自 AST 深度守卫本身，而不是 V8 的栈溢出 —— 可确定性断言。
  const deep40 = path.join(tmpDir('hostile-src'), 'deep-40');
  writeAlwaysDeepPackage(deep40, 40);

  const pre = await preflightWith('HOSTILE-DEPTH-GUARD', deep40, STARTER);
  assert(!pre.ok, '超过深度上限的 AST 必须 Preflight 失败');
  const aError = pre.errors.find((e) => e.startsWith('A ')) ?? '';
  assert(
    aError.startsWith('A 算法输出不合法'),
    `深度守卫应在 DSL 校验阶段生效，实际: ${pre.errors.join('; ')}`
  );
  // 承重断言（Re-Gate Cycle 2 审计 D-2）：必须由**递归之前**的深度守卫拒绝。
  // 只断言「输出不合法」是不承重的 —— 去掉守卫后 40 层 AST 会被解析通过，
  // 随后因不过 Shooter 被拒，文案同样是「输出不合法」。
  // `在第 N 层拒绝` 只可能来自 parseNode 入口处的守卫。
  assert(
    /在第 \d+ 层拒绝/.test(aError),
    `必须由递归前的深度守卫拒绝（诊断需指明拒绝层号），实际: ${aError}`
  );
  assert(
    !/相差/.test(aError),
    `不得先解析成功再以 Shooter 校验拒绝（那意味着守卫没有前置），实际: ${aError}`
  );
});

test('hostile-input: 输出可解析但非法时，错误码与回合结果一致（D-3 回归）', async () => {
  // Re-Gate Cycle 2 审计 D-3：运行器成功、但 DSL 非法（例如使用被禁算子）时，
  // 曾出现 result=INVALID_A 而 aErrorCode=null —— 日志自相矛盾。
  // 这里用「结构合法但含被禁算子」的载荷确定性地复现该路径。
  const forbidden = path.join(tmpDir('hostile-src'), 'forbidden');
  // round 0（Preflight）输出合法小 AST 以通过预检，正式回合再输出被禁算子
  const forbiddenExpr =
    'json.dumps({"dsl": {"type": "add", "args": [' +
    '{"type": "number", "value": y0}, ' +
    '{"type": "mul", "args": [{"type": "number", "value": 0}, ' +
    '{"type": "floor", "args": [{"type": "variable", "value": "x"}]}]}]}})';
  writeRoundGatedPackage(forbidden, 'forbidden-op', forbiddenExpr);

  const { result } = await runOneRoundWith('HOSTILE-FORBIDDEN-OP', forbidden, STARTER);
  assertEqual(result.log.result, 'INVALID_A', '含被禁算子的输出应记为 INVALID_A');
  assertEqual(
    result.log.aErrorCode,
    'INVALID_DSL',
    'aErrorCode 必须与 INVALID_A 一致，不得为 null（D-3）'
  );
  assertEqual(result.log.aFunction, null, '非法函数不得进入日志的函数字段');
  assert(result.log.bFunction !== null, 'B 的合法输出不应被影响');
});

test('hostile-input: 超长嵌套 JSON 输出被干净拒绝（P0-A 回归）', async () => {
  const huge = path.join(tmpDir('hostile-src'), 'huge');
  writeRoundGatedPackage(huge, 'huge-json', hugeJsonPyExpr(100_000));

  const { result } = await runOneRoundWith('HOSTILE-HUGE-JSON', huge, STARTER);
  assert(!result.log.aFunction, '超长 JSON 不应产出合法函数');
  assertEqual(result.log.result, 'INVALID_A', '回合结果应记为 INVALID_A');
});

test('hostile-input: 正式操作台在中止前已逐回合落盘（P0-A + P1-A 回归）', async () => {
  const root = tmpDir('hostile-cli');
  const hostile = path.join(root, 'deep-src');
  const harmless = path.join(root, 'harmless-src');
  const artifacts = path.join(root, 'artifacts');
  writeRoundGatedPackage(hostile, 'deep-ast', deepDslPyExpr(6000));
  writeHarmlessPackage(harmless);

  const proc = spawn(
    'npx',
    [
      'ts-node', 'src/operator/cli.ts',
      '--a', hostile,
      '--b', harmless,
      '--seed', '20260909',
      '--points', '6',
      '--difficulty', 'easy',
      '--artifacts', artifacts,
      '--auto',
    ],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let out = '';
  proc.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
  proc.stderr?.on('data', (c: Buffer) => { out += c.toString(); });

  // 轮询：等待至少一回合落盘（对局本身是僵局，不会自然结束）
  const deadline = Date.now() + 60_000;
  let rounds = -1;
  let dir = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(path.join(artifacts, 'matches'))) {
      const ids = fs.readdirSync(path.join(artifacts, 'matches'));
      for (const id of ids) {
        const f = path.join(artifacts, 'matches', id, 'match.json');
        if (!fs.existsSync(f)) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
          if (Array.isArray(parsed.rounds) && parsed.rounds.length >= 1) {
            rounds = parsed.rounds.length;
            dir = path.join(artifacts, 'matches', id);
          }
        } catch {
          /* 可能正在写入，下一轮再试 */
        }
      }
    }
    if (rounds >= 1) break;
    if (proc.exitCode !== null) break; // 进程自己退出了，也结束轮询
    await new Promise((r) => setTimeout(r, 250));
  }

  // 模拟「比赛中止」：杀掉整个进程组
  try {
    if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  proc.kill('SIGKILL');

  assert(!out.includes('Maximum call stack size exceeded'), `操作台不得崩溃:\n${out.slice(-1500)}`);
  assert(rounds >= 1, `中止前必须已落盘至少一个回合（P1-A），实际 rounds=${rounds}\n输出:\n${out.slice(-1500)}`);
  for (const f of ['match.json', 'audit.json', 'replay.json']) {
    assert(fs.existsSync(path.join(dir, f)), `产物必须包含 ${f}`);
  }
  const replay = JSON.parse(fs.readFileSync(path.join(dir, 'replay.json'), 'utf-8'));
  assert(replay.frames.length >= 1, '回放必须至少有一帧');
});

void runAll('hostile-input');
