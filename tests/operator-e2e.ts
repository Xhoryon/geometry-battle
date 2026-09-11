/**
 * operator-e2e —— 正式操作台的端到端演练（Rule Revision 3 §24/§25/§27/§33）
 *
 * 这不是引擎单测，而是**赛事流程演练**：真的把 `src/operator/cli.ts` 当子进程跑，
 * 走一遍裁判/工作人员会走的完整路径：
 *
 *     干净启动 → 载入算法 → 校验 → 建赛 → 揭盲 → START → 多回合
 *     → 终止 → 回放 → 审计 → 重置 → 下一场
 *
 * 断言的是：**不需要开发者介入**就能跑完，且观众屏不会泄漏开发者诊断。
 */

import { execFileSync, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MatchLog, Replay } from '../src/core/Logs';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const CLI = path.join('src', 'operator', 'cli.ts');
const ALGO_A = path.join(REPO, 'playtest', 'competitors', 'solver-fast');
const ALGO_B = path.join(REPO, 'playtest', 'competitors', 'solver-hybrid');

const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 跑一场完整比赛，返回**这场比赛**的产物目录。
 *
 * 注意 CLI 的 `Artifacts:` 打的就是 `matches/<matchId>` 这一层，
 * 不是 artifacts 根目录 —— 早先这里多套了一层 `matches/` 才去找，于是 ENOENT。
 */
function runMatch(opts: { root: string; seed: number; extra?: string[] }): string {
  const artifacts = path.join(opts.root, 'artifacts');
  const r = spawnSync(
    'npx',
    [
      'ts-node',
      CLI,
      '--a', ALGO_A,
      '--b', ALGO_B,
      '--slots', path.join(opts.root, 'algorithms'),
      '--artifacts', artifacts,
      '--seed', String(opts.seed),
      '--points', '6',
      '--difficulty', 'easy',
      '--auto',
      ...(opts.extra ?? []),
    ],
    { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT_MS }
  );
  assertEqual(r.status, 0, `操作台应正常退出。stderr/stdout:\n${r.stdout}\n${r.stderr}`);
  const m = /Artifacts:\s*(\S+)/.exec(r.stdout);
  assert(m, `操作台必须报告产物目录，实际输出:\n${r.stdout}`);
  return m![1];
}

function readMatch(dir: string): MatchLog {
  return JSON.parse(fs.readFileSync(path.join(dir, 'match.json'), 'utf-8')) as MatchLog;
}

test('operator-e2e: 一场完整比赛从干净启动跑到终止并落盘（§33）', () => {
  const root = tmpDir('op-e2e');
  const dir = runMatch({ root, seed: 700001 });
  const match = readMatch(dir);

  // 终止保证：四类 endReason 之一，且一定是有限回合
  assert(
    ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(match.endReason),
    `比赛必须以四类终止方式之一结束，实际 ${match.endReason}`
  );
  assert(match.rounds.length >= 1 && match.rounds.length <= 60, `回合数应在 1..60，实际 ${match.rounds.length}`);
  assert(['A', 'B', 'draw'].includes(match.winner), `winner 必须是 A/B/draw，实际 ${match.winner}`);

  // 三件产物齐备
  for (const name of ['match.json', 'audit.json', 'replay.json']) {
    assert(fs.existsSync(path.join(dir, name)), `产物必须包含 ${name}`);
  }

  // V1.2 §一：锚点不再是平台常量（旧断言的 'A0'/'B0' 已随规则修正案作废）。
  // 现在要证明的是三件事：开赛前已锁定、整场不变、且确实是**本队自己的点**。
  assert(match.emitters, '比赛落盘必须带上本场双方锁定的 Emitter');
  const emitterA = match.emitters.A.id;
  const emitterB = match.emitters.B.id;
  assert(/^A\d+$/.test(emitterA), `A 的锚点应取自 A 队自己的点，实际 ${emitterA}`);
  assert(/^B\d+$/.test(emitterB), `B 的锚点应取自 B 队自己的点，实际 ${emitterB}`);

  // 逐轮：每一轮都能看出「谁开火了」；锚点整场固定，不允许中途漂移
  for (const r of match.rounds) {
    assertEqual(r.emitterA, emitterA, `第 ${r.round} 轮 A 的锚点应恒为本场锁定的 ${emitterA}`);
    assertEqual(r.emitterB, emitterB, `第 ${r.round} 轮 B 的锚点应恒为本场锁定的 ${emitterB}`);
    assert(r.attacksExecuted.length >= 1, `第 ${r.round} 轮至少应有一方执行攻击`);
    assert(typeof r.noProgressStreak === 'number', '每轮必须记录连续零击杀回合数');
  }

  // 审计日志必须完整
  const audit = JSON.parse(fs.readFileSync(path.join(dir, 'audit.json'), 'utf-8'));
  const types = (audit.events as { type: string }[]).map((e) => e.type);
  for (const required of ['MatchCreated', 'RoundComputeStart', 'MatchEnded']) {
    assert(types.includes(required), `审计日志必须包含 ${required}`);
  }
  // 旧语义不得出现在审计事件里
  for (const gone of ['ShotCancelled', 'ShooterSelected', 'ShooterLocked', 'BothLocked']) {
    assert(!types.includes(gone), `审计日志不得再出现旧事件 ${gone}（Rule Revision 3 §5/§8）`);
  }
});

test('operator-e2e: 回放是只读的，且能表达 Revision 3 的终局（§22）', () => {
  const root = tmpDir('op-replay');
  const dir = runMatch({ root, seed: 700002 });

  const r = spawnSync('npx', ['ts-node', CLI, '--replay', dir], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  assertEqual(r.status, 0, `回放应正常退出，实际 stderr:\n${r.stderr}`);
  const out = r.stdout;

  assert(out.includes('REPLAY'), '回放输出必须标明这是回放');
  assert(out.includes('Emitter A='), '回放必须展示固定 Emitter（不再有 Shooter）');
  for (const gone of ['Shooter A=', 'SHOT CANCELLED', 'New Shooter']) {
    assert(!out.includes(gone), `回放不得再出现旧语义「${gone}」`);
  }
  // 结束原因必须能表达出来（含 Stalemate / 同归于尽）
  const match = readMatch(dir);
  if (match.endReason === 'STALEMATE') {
    assert(out.includes('STALEMATE'), '僵持局必须在回放里明确标出');
  }
  if (match.endReason === 'MUTUAL_ELIMINATION') {
    assert(out.includes('MUTUAL ELIMINATION'), '同归于尽必须在回放里明确标出');
  }
  assert(out.includes('未重新运行任何算法'), '回放必须声明它没有重跑算法');
});

test('operator-e2e: 观众模式隐藏开发者诊断（§25）', () => {
  const root = tmpDir('op-audience');
  const artifacts = path.join(root, 'artifacts');
  const r = spawnSync(
    'npx',
    [
      'ts-node', CLI,
      '--a', ALGO_A, '--b', ALGO_B,
      '--slots', path.join(root, 'algorithms'),
      '--artifacts', artifacts,
      '--seed', '700003', '--points', '6', '--difficulty', 'easy',
      '--auto', '--audience',
    ],
    { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT_MS }
  );
  assertEqual(r.status, 0, `观众模式应正常退出，实际 stderr:\n${r.stderr}`);
  const out = r.stdout;

  // 观众屏必须画出场与固定 Emitter
  assert(out.includes('Ⓐ') && out.includes('Ⓑ'), '观众屏必须画出双方固定 Emitter');
  assert(out.includes('ROUND 1'), '观众屏必须显示当前回合');

  // 但不得泄漏开发者诊断
  assert(!out.includes('Artifacts:'), '观众模式不得打印产物路径');
  assert(!/\/Users\/|\/var\/folders\//.test(out), '观众模式不得打印文件系统路径');
  assert(!out.includes('sha256 ='), '观众模式不得打印状态哈希');
  assert(!out.includes('decoy seed'), '观众模式不得打印 decoy seed');

  // 同时：非观众模式仍要给出这些信息（否则上面的断言是空转）
  const plain = spawnSync(
    'npx',
    [
      'ts-node', CLI,
      '--a', ALGO_A, '--b', ALGO_B,
      '--slots', path.join(root, 'algorithms2'),
      '--artifacts', path.join(root, 'artifacts2'),
      '--seed', '700004', '--points', '6', '--difficulty', 'easy', '--auto',
    ],
    { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT_MS }
  );
  assertEqual(plain.status, 0, `普通模式应正常退出:\n${plain.stderr}`);
  assert(plain.stdout.includes('Artifacts:'), '普通模式必须给出产物路径（对照）');
});

test('operator-e2e: 操作台可重复使用 —— 同一入口连打两场（§33 的 reset → 下一场）', () => {
  const root = tmpDir('op-two');
  const first = runMatch({ root, seed: 700005 });
  const second = runMatch({ root, seed: 700006 });

  assert(first !== second, '两场比赛必须落在不同的产物目录');
  const a = readMatch(first);
  const b = readMatch(second);
  assert(a.matchId !== b.matchId, '两场比赛的 matchId 必须不同');
  // 第二场不受第一场影响：同样满足终止保证
  assert(
    ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(b.endReason),
    `第二场同样必须正常终止，实际 ${b.endReason}`
  );

  // 回放仍然只读且自包含（删掉算法包之后照样能读）
  const replay: Replay = JSON.parse(fs.readFileSync(path.join(second, 'replay.json'), 'utf-8'));
  assertEqual(replay.frames.length, b.rounds.length, '回放帧数必须等于回合数');
  assertEqual(replay.endReason, b.endReason, '回放必须记录同一个结束原因');
});

// ===========================================================================
// 工作区保护（回归）
// ===========================================================================

/** 目录的逐文件 sha256 指纹 */
function fingerprintDir(dir: string): string {
  const entries: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === '.staging' || name === '.slots') continue; // 槽位元数据本就可变
      const full = path.join(d, name);
      const r = path.join(rel, name);
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else entries.push(`${r}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  if (!fs.existsSync(dir)) return '(missing)';
  walk(dir, '');
  return entries.join('\n');
}

test('operator-e2e: 测试不得改写仓库里的固定算法槽位（工作区保护）', () => {
  // 上面每一条 judge/operator 用例都会走「安装 → 替换槽位」流水线。
  // 如果有一条忘了传 --slots，参赛算法就会被真的装进受跟踪的 algorithms/ ——
  // 那是必须立刻变红的错误，而不是等到 `git status` 才发现。
  const repoSlots = path.join(REPO, 'algorithms');
  const fp = fingerprintDir(repoSlots);
  assert(
    fp !== '(missing)',
    '仓库固定槽位 algorithms/ 必须存在（它出厂即 starter 的副本）'
  );
  // 出厂状态 = starter 的副本：每个槽位只应有 manifest.json 与 solver.py
  for (const team of ['team-a', 'team-b']) {
    const files = fs.readdirSync(path.join(repoSlots, team)).filter((f) => !f.startsWith('.'));
    assertEqual(files.sort(), ['manifest.json', 'solver.py'], `${team} 必须仍是出厂状态`);
    const same = fs
      .readFileSync(path.join(repoSlots, team, 'solver.py'))
      .equals(fs.readFileSync(path.join(REPO, 'starter', 'solver.py')));
    assert(same, `${team}/solver.py 必须与 starter 逐字节相同`);
  }
});

void runAll('operator-e2e');

// ===========================================================================
// 正式裁判入口（Rule Revision 3 §24/§33）
//
// 上面几条走的是底层操作台 `cli.ts`。这里走**面向裁判的入口** `judge.ts` ——
// 它存在的意义就是「裁判不需要记 flag、不需要知道路径也能开一场正规比赛」。
// ===========================================================================

const JUDGE = path.join('src', 'operator', 'judge.ts');

interface JudgeRun {
  status: number | null;
  stdout: string;
  stderr: string;
  matchDirs: string[];
}

/**
 * 跑裁判台。
 *
 * **`--slots` 一律指向临时目录**：安装流水线会真的改写槽位根目录，
 * 用仓库内的 `algorithms/` 会把参赛算法装进受跟踪的工作区
 * （`hostile-input` 曾经踩过同一个坑）。这里连同下面的
 * 「仓库槽位不得被测试改写」断言一起，把这类事故钉死。
 */
function runJudge(root: string, extra: string[]): JudgeRun {
  const artifacts = path.join(root, 'artifacts');
  const r = spawnSync(
    'npx',
    [
      'ts-node', JUDGE, '--auto',
      '--artifacts', artifacts,
      '--slots', path.join(root, 'algorithms'),
      '--points', '6', '--difficulty', 'easy',
      ...extra,
    ],
    { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT_MS }
  );
  const matches = path.join(artifacts, 'matches');
  const matchDirs = fs.existsSync(matches)
    ? fs
        .readdirSync(matches)
        .map((d) => path.join(matches, d))
        .filter((d) => fs.existsSync(path.join(d, 'match.json')))
    : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, matchDirs };
}

test('judge: 只给 --auto 就能开一场正规比赛（不需要 --a/--b，不需要开发 flag）', () => {
  const root = tmpDir('judge-solo');
  // 把仓库出厂槽位复制到临时目录，复刻「裁判直接开赛」的默认路径，
  // 但绝不写回仓库（见 runJudge 的说明）。
  fs.cpSync(path.join(REPO, 'algorithms'), path.join(root, 'algorithms'), { recursive: true });
  const run = runJudge(root, []);

  assertEqual(run.status, 0, `裁判台应正常退出:\n${run.stdout}\n${run.stderr}`);
  assertEqual(run.matchDirs.length, 1, '应产出恰好一场比赛的产物');

  // 控制台板必须给出裁判需要的一切
  assert(run.stdout.includes('JUDGE CONSOLE'), '应打印裁判控制台板');
  assert(run.stdout.includes('Team A: READY'), '应显示 Team A 的就绪状态');
  assert(run.stdout.includes('Team B: READY'), '应显示 Team B 的就绪状态');
  assert(run.stdout.includes('MATCH RESULT'), '终局应打印比赛结果板');
  assert(run.stdout.includes('End reason:'), '结果板必须给出终止原因');
  assert(run.stdout.includes('AUDIT'), '应能直接查看审计摘要');

  const log = readMatch(run.matchDirs[0]);
  assert(
    ['ELIMINATION', 'MUTUAL_ELIMINATION', 'STALEMATE', 'HARD_ROUND_LIMIT'].includes(log.endReason),
    `必须以四类终止方式之一结束，实际 ${log.endReason}`
  );
  for (const name of ['match.json', 'audit.json', 'replay.json']) {
    assert(fs.existsSync(path.join(run.matchDirs[0], name)), `产物必须包含 ${name}`);
  }
});

test('judge: 一场结束后重置并直接开下一场（§33 的 reset → next match）', () => {
  const root = tmpDir('judge-two');
  // 用两个参考算法跑两场：既走「载入算法」的安装路径，又能快速分出胜负
  const run = runJudge(root, ['--matches', '2', '--a', ALGO_A, '--b', ALGO_B]);

  assertEqual(run.status, 0, `裁判台应正常退出:\n${run.stderr}`);
  assertEqual(run.matchDirs.length, 2, '同一会话里应产出两场比赛的产物');
  const ids = run.matchDirs.map((d) => readMatch(d).matchId);
  assert(ids[0] !== ids[1], '两场必须是不同的 matchId');
  for (const d of run.matchDirs) {
    const log = readMatch(d);
    assert(log.rounds.length >= 1, '每场都应至少跑过一轮');
    assert(fs.existsSync(path.join(d, 'replay.json')), '每场都应有回放');
  }
  assert(run.stdout.includes('比赛 2 就绪'), '应明确打印「第二场已就绪」');
});

test('judge: 现场大屏模式不含任何开发者诊断（§25）', () => {
  const root = tmpDir('judge-spectator');
  const run = runJudge(root, ['--spectator', '--no-anim', '--a', ALGO_A, '--b', ALGO_B]);

  assertEqual(run.status, 0, `大屏模式应正常退出:\n${run.stderr}`);
  const out = run.stdout;
  assert(out.includes('ROUND'), '大屏必须显示当前回合');
  assert(out.includes('Ⓐ') && out.includes('Ⓑ'), '大屏必须画出固定 Emitter');
  assert(!/\/Users\/|\/var\/folders\//.test(out), '大屏不得出现文件系统路径');
  assert(!out.includes('sha256'), '大屏不得出现哈希');
  assert(!out.includes('JUDGE CONSOLE'), '大屏不显示裁判控制台（那是裁判的东西）');
});
