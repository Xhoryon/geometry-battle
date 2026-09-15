// Gate 0 无害探针：只使用合成数据、临时目录和现有 Runner，不修改被审源码。
const fs = require('fs');
const path = require('path');
const os = require('os');
if (!process.env.GB_AUDIT_BASELINE) throw new Error('请显式指定隔离基线 GB_AUDIT_BASELINE');
const root = path.resolve(process.env.GB_AUDIT_BASELINE);
const { judgeShot } = require(path.join(root, 'src/core/Judge'));
const { parseCanonicalDSL } = require(path.join(root, 'src/core/Ast'));
const { validateAttackFunction } = require(path.join(root, 'src/core/Validator'));
const { FROZEN_RUNTIME, checkRuntime } = require(path.join(root, 'src/submission/Runtime'));
const { buildPublicState, buildRevealState } = require(path.join(root, 'src/core/InputProtocol'));
const { prepareSandbox, spawnRunner, cleanupSandbox } = require(path.join(root, 'src/runner/SandboxRunner'));
const { PY_ARGV_PRELUDE, PY_EMIT } = require(path.join(root, 'tests/protocol-fixture'));
const observed = {};

async function runFixture(name, source, timeoutMs = 500, blockHostMs = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-gate0-benign-'));
  const pkg = path.join(dir, 'pkg');
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, 'solver.py'), PY_ARGV_PRELUDE + PY_EMIT + source);
  const pub = buildPublicState({ matchId: name, round: 1, points: [] });
  const rev = buildRevealState({ matchId: name, round: 1, publicStateSha256: pub.sha256, obstacles: [] });
  const sb = prepareSandbox({ sandboxRoot: path.join(dir, 'sandbox'), matchId: name, roundNumber: 1, team: 'A', packageDir: pkg, entry: 'solver.py', input: { publicJson: pub.json, revealJson: rev.json }, memoryLimitMb: 512 });
  let runner;
  try {
    runner = spawnRunner({ team: 'A', sandbox: sb, timeoutMs, memoryLimitMb: 512 });
    await runner.ready;
    runner.release();
    // 只挂起本探针宿主线程，模拟忙碌事件循环；不烧 CPU、不影响别的服务。
    if (blockHostMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, blockHostMs);
    const result = await runner.done;
    return { success: result.success, errorCode: result.errorCode, computeTimeMs: result.computeTimeMs, stderr: result.stderr.trim(), isolation: result.isolation };
  } finally {
    if (runner) runner.cancel();
    cleanupSandbox(sb.dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  observed.geometry = [];
  for (const delta of [0, 1e-6, 0.1]) {
    const c = Math.SQRT2 - delta;
    const parsed = parseCanonicalDSL({ type: 'add', args: [{ type: 'variable', value: 'x' }, { type: 'number', value: c }] });
    if (!parsed.ast) throw new Error('探针 AST 解析失败');
    const emitter = { x: -6, y: -6 + c };
    const v = validateAttackFunction(parsed.ast, [-6, 20], emitter);
    const shot = judgeShot(parsed.ast, emitter, 'A', [{ id: 'B1', position: { x: 6, y: 6 + c } }], [{ type: 'circle', center: [0, 0], radius: 1 }]);
    observed.geometry.push({ delta, line: `y=x+${c}`, centerToLineDistance: Math.abs(c) / Math.SQRT2, valid: v.valid, issues: v.issues.map(i => i.code), blocked: shot.blocked !== null, killed: shot.killed, endReason: shot.endReason });
  }
  observed.platformCheck = checkRuntime(FROZEN_RUNTIME, { python: FROZEN_RUNTIME.python, implementation: FROZEN_RUNTIME.implementation, platform: 'linux', packages: {}, probed: true });
  observed.thread = await runFixture('THREAD-BOUNDARY', 'import threading\nitems=[]\ndef work():\n    items.append("executed")\nt=threading.Thread(target=work)\nt.start()\nt.join()\nsys.stderr.write(json.dumps({"worker_executed":items == ["executed"]}) + "\\n")\nemit({"type":"number","value":0})\n', 3000);
  const delayed = 'import time\ntime.sleep(0.65)\nemit({"type":"number","value":0})\n';
  observed.timeoutControl = await runFixture('TIMEOUT-CONTROL', delayed);
  observed.timeoutBlockedHost = await runFixture('TIMEOUT-HOST-PAUSE', delayed, 500, 1000);
  fs.writeFileSync(path.join(__dirname, 'boundary-probes.json'), JSON.stringify(observed, null, 2) + '\n');
  console.log(JSON.stringify(observed, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
