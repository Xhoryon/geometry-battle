/**
 * algorithm-slot —— 固定算法槽位（规范 §2/§3/§4/§31/§32/§33/§41）
 *
 * 契约：
 *   1. 两个槽位结构完全一致，根目录必须有 `solver.py`；
 *   2. 替换槽位是**非破坏性**的：坏包在 staging/validate/preflight 任何一步
 *      失败，现有槽位都一个字节不变（§32）；
 *   3. 槽位元数据（.slots/、.staging/）不属于算法包，不进哈希、不进沙箱；
 *   4. 比赛开始后槽位冻结。
 *
 * 这里断言的是「失败路径不留痕」，比「成功路径能装上」更重要 ——
 * 后者坏一次只是重装，前者坏一次等于现场比赛没有算法可用。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { ENTRY_FILENAME } from '../src/submission/Manifest';
import { inspectPackage } from '../src/submission/Package';
import {
  SLOT_DIRS,
  SLOT_META_DIR,
  SLOT_STAGING_DIR,
  readSlot,
  slotDir,
  stageSlot,
} from '../src/submission/Slot';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';

const REPO_SLOTS = path.join(__dirname, '..', 'algorithms');

/** 最小合法算法：f(x) 为经过自己 Shooter 的水平线 */
const SOLVER_SOURCE = `${PY_ARGV_PRELUDE}${PY_EMIT}with open(args.public, "rb") as f:
    public_bytes = f.read()
public = json.loads(public_bytes.decode("utf-8"))
with open(args.reveal, "r") as f:
    reveal = json.load(f)
by_id = {p["id"]: p for p in public["points"]}
me = by_id[reveal["shooters"][args.team]]
emit({"type": "add", "args": [
    {"type": "number", "value": me["y"]},
    {"type": "mul", "args": [{"type": "number", "value": 0}, {"type": "variable", "value": "x"}]},
]})
`;

/** 结构合法但运行必然失败（规范 §31 的 preflight 就该拦住它） */
const CRASHING_SOURCE = `${PY_ARGV_PRELUDE}${PY_EMIT}raise SystemExit(3)\n`;

function makePkg(prefix: string, source: string, entryName = ENTRY_FILENAME): string {
  const dir = path.join(tmpDir(prefix), 'pkg');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, entryName), source);
  return dir;
}

/** 槽位内容的逐字节指纹：文件清单 + 每个文件的 sha256 */
function fingerprint(dir: string): string {
  const inspection = inspectPackage(dir);
  return inspection.files
    .map((f) => `${f.relPath}:${f.sha256}`)
    .sort()
    .join('\n');
}

function newEngine(root: string): MatchEngine {
  return new MatchEngine({
    matchId: 'SLOT-TEST',
    seed: 987_654,
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
    slotRoot: path.join(root, 'algorithms'),
  });
}

test('algorithm-slot: 仓库自带两个槽位结构完全一致（§2/§3/§41）', () => {
  for (const team of ['A', 'B'] as const) {
    const dir = slotDir(REPO_SLOTS, team);
    assert(fs.existsSync(path.join(dir, ENTRY_FILENAME)), `${SLOT_DIRS[team]} 必须存在 ${ENTRY_FILENAME}（§3）`);
    const state = readSlot(REPO_SLOTS, team);
    assertEqual(state.status, 'READY', `${SLOT_DIRS[team]} 必须是可用槽位`);
    assert(state.hash !== null && state.hash.length === 64, `${SLOT_DIRS[team]} 应能算出包哈希`);
  }
  const a = inspectPackage(slotDir(REPO_SLOTS, 'A')).files.map((f) => f.relPath);
  const b = inspectPackage(slotDir(REPO_SLOTS, 'B')).files.map((f) => f.relPath);
  assertEqual(a, b, '两个槽位结构必须完全一致（§2）');
  assertEqual(a, [ENTRY_FILENAME], `槽位根目录应只有固定入口，实际 ${a.join(',')}`);
});

test('algorithm-slot: staging/validate 拒绝坏包，现有槽位逐字节不变（§32）', async () => {
  const root = tmpDir('slot-reject');
  const engine = newEngine(root);
  const slotRoot = path.join(root, 'algorithms');

  const good = await engine.installAlgorithm('A', makePkg('slot-good', SOLVER_SOURCE));
  assert(good.ok, `合法包应能安装: ${good.errors.join('; ')}`);
  const before = fingerprint(slotDir(slotRoot, 'A'));
  const beforeState = readSlot(slotRoot, 'A');

  // 坏包：没有 solver.py（§3）
  const bad = path.join(tmpDir('slot-bad'), 'pkg');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'helper.py'), 'x = 1\n');
  const rejected = await engine.installAlgorithm('A', bad);
  assert(!rejected.ok, '缺少 solver.py 的包必须被拒绝');
  assertEqual(rejected.detail.stage, 'validate', '应在 validate 阶段就被拦下（不该跑到 preflight）');

  assertEqual(fingerprint(slotDir(slotRoot, 'A')), before, '失败的安装不得改动现有槽位（§32）');
  assertEqual(readSlot(slotRoot, 'A').hash, beforeState.hash, '槽位哈希必须保持不变');
  assertEqual(readSlot(slotRoot, 'A').status, 'READY', '槽位必须仍然可用');

  // 暂存区不得留下垃圾
  const staging = path.join(slotRoot, SLOT_STAGING_DIR);
  const leftovers = fs.existsSync(staging) ? fs.readdirSync(staging) : [];
  assertEqual(leftovers, [], `失败的上传不得残留暂存目录: ${leftovers.join(', ')}`);
});

test('algorithm-slot: 自定义入口被明确拒绝（§3/§4）', async () => {
  const root = tmpDir('slot-entry');
  const engine = newEngine(root);
  const pkg = makePkg('slot-main', SOLVER_SOURCE, 'main.py');

  const r = await engine.installAlgorithm('A', pkg);
  assert(!r.ok, '自定义入口 main.py 必须被拒绝（§4）');
  assert(
    r.errors.some((e) => e.includes(ENTRY_FILENAME)),
    `错误信息必须点明固定入口 ${ENTRY_FILENAME}，实际: ${r.errors.join('; ')}`
  );
  assertEqual(readSlot(path.join(root, 'algorithms'), 'A').status, 'EMPTY', '拒绝后槽位仍应为空');
});

test('algorithm-slot: preflight 失败不替换槽位（§31/§32/§34）', async () => {
  const root = tmpDir('slot-preflight');
  const engine = newEngine(root);
  const slotRoot = path.join(root, 'algorithms');

  const good = await engine.installAlgorithm('A', makePkg('slot-good2', SOLVER_SOURCE));
  assert(good.ok, `合法包应能安装: ${good.errors.join('; ')}`);
  const before = fingerprint(slotDir(slotRoot, 'A'));

  // 结构合法（有 solver.py）但一运行就退出非 0 → 只能靠 preflight 拦住
  const crashing = await engine.installAlgorithm('A', makePkg('slot-crash', CRASHING_SOURCE));
  assert(!crashing.ok, '运行必然失败的算法必须被拒绝');
  assertEqual(crashing.detail.stage, 'preflight', '应在 preflight 阶段被拦下');

  assertEqual(fingerprint(slotDir(slotRoot, 'A')), before, 'preflight 失败不得改动现有槽位（§32）');
  const staging = path.join(slotRoot, SLOT_STAGING_DIR);
  assertEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], [], '暂存目录必须被清理');
});

test('algorithm-slot: 成功安装写入哈希与 preflight 记录（§31/§33）', async () => {
  const root = tmpDir('slot-install');
  const engine = newEngine(root);
  const slotRoot = path.join(root, 'algorithms');

  const first = await engine.installAlgorithm('A', makePkg('slot-a1', SOLVER_SOURCE));
  assert(first.ok, `首次安装应成功: ${first.errors.join('; ')}`);
  const state1 = readSlot(slotRoot, 'A');
  assertEqual(state1.status, 'READY', '安装后槽位应为 READY');
  assertEqual(state1.entry, ENTRY_FILENAME, '入口必须固定为 solver.py');
  assertEqual(state1.hash, first.hash, '槽位哈希必须等于安装时报告的哈希');
  assert(state1.record !== null, '必须写入安装记录（§33 的 UI 数据源）');
  assertEqual(state1.record!.preflight.ok, true, '安装记录应标明 preflight 通过');
  assert(state1.record!.hash === first.hash, '安装记录里的哈希必须与槽位一致');

  // 换成另一个合法包：哈希必须变化（§32 的 replace 真的换了内容）
  const other = SOLVER_SOURCE.replace('"value": 0', '"value": 0.0');
  const second = await engine.installAlgorithm('A', makePkg('slot-a2', other));
  assert(second.ok, `替换安装应成功: ${second.errors.join('; ')}`);
  assert(second.hash !== first.hash, '内容不同的包必须得到不同的哈希');
  assertEqual(readSlot(slotRoot, 'A').hash, second.hash, '槽位应指向新包');
});

test('algorithm-slot: 槽位元数据不属于算法包（不进哈希、不进沙箱）', async () => {
  const root = tmpDir('slot-meta');
  const engine = newEngine(root);
  const slotRoot = path.join(root, 'algorithms');
  const source = makePkg('slot-meta-src', SOLVER_SOURCE);

  const installed = await engine.installAlgorithm('A', source);
  assert(installed.ok, `安装应成功: ${installed.errors.join('; ')}`);

  // 元数据写在槽位**之外**
  const metaFile = path.join(slotRoot, SLOT_META_DIR, `${SLOT_DIRS.A}.json`);
  assert(fs.existsSync(metaFile), `安装记录应写在 ${metaFile}`);
  assert(!fs.existsSync(path.join(slotDir(slotRoot, 'A'), '.slot.json')), '元数据不得落进槽位目录');

  const files = inspectPackage(slotDir(slotRoot, 'A')).files.map((f) => f.relPath);
  assert(!files.some((f) => f.includes(SLOT_META_DIR)), `算法包不得包含元数据文件: ${files.join(',')}`);

  // 槽位哈希必须等于「把槽位当成普通包再算一次」的结果（幂等）
  const restaged = stageSlot({ slotRoot, team: 'A', sourceDir: slotDir(slotRoot, 'A') });
  assert(restaged.ok, '槽位自身必须是一个合法算法包');
  assertEqual(restaged.ok && restaged.stage.hash, readSlot(slotRoot, 'A').hash, '槽位哈希必须稳定');
});

test('algorithm-slot: 空槽位是正常状态，不是错误', () => {
  const root = tmpDir('slot-empty');
  const slotRoot = path.join(root, 'algorithms');
  const state = readSlot(slotRoot, 'B');
  assertEqual(state.status, 'EMPTY', '未上传的槽位应为 EMPTY');
  assertEqual(state.errors, [], 'EMPTY 不应被当作校验错误');
  assertEqual(state.hash, null, '空槽位没有哈希');
});

test('algorithm-slot: 比赛开始后槽位冻结（§32）', async () => {
  const root = tmpDir('slot-freeze');
  const engine = newEngine(root);
  const slotRoot = path.join(root, 'algorithms');

  for (const team of ['A', 'B'] as const) {
    const r = await engine.installAlgorithm(team, makePkg(`slot-freeze-${team}`, SOLVER_SOURCE));
    assert(r.ok, `Team ${team} 安装应成功: ${r.errors.join('; ')}`);
  }
  for (const team of ['A', 'B'] as const) {
    const up = engine.upload(team, slotDir(slotRoot, team));
    assert(up.ok, `Team ${team} 上传应成功: ${up.errors.join('; ')}`);
  }
  const pre = await engine.preflight();
  assert(pre.ok, `preflight 应通过: ${pre.errors.join('; ')}`);
  const started = engine.startMatch();
  assert(started.ok, `开赛应成功: ${started.errors.join('; ')}`);

  const before = fingerprint(slotDir(slotRoot, 'A'));
  const late = await engine.installAlgorithm('A', makePkg('slot-late', SOLVER_SOURCE));
  assert(!late.ok, '比赛开始后不得替换槽位（§32）');
  assertEqual(late.detail.stage, 'phase', '应在阶段守卫处被拒绝');
  assertEqual(fingerprint(slotDir(slotRoot, 'A')), before, '被拒绝的替换不得改动槽位');
});

void runAll('algorithm-slot');
