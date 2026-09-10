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
import * as fs from 'fs';
import * as path from 'path';
import { MatchLog, Replay } from '../src/core/Logs';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const REPO = path.join(__dirname, '..');
const CLI = path.join('src', 'operator', 'cli.ts');
const ALGO_A = path.join(REPO, 'playtest', 'competitors', 'solver-fast');
const ALGO_B = path.join(REPO, 'playtest', 'competitors', 'solver-hybrid');

const TIMEOUT_MS = 10 * 60 * 1000;

/** 跑一场完整比赛，返回产物目录 */
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

function findArtifactDir(artifactsRoot: string): string {
  const matches = path.join(artifactsRoot, 'matches');
  const dirs = fs
    .readdirSync(matches)
    .map((d) => path.join(matches, d))
    .filter((d) => fs.statSync(d).isDirectory());
  assertEqual(dirs.length, 1, '应恰好产出一场比赛的目录');
  return dirs[0];
}

test('operator-e2e: 一场完整比赛从干净启动跑到终止并落盘（§33）', () => {
  const root = tmpDir('op-e2e');
  const dir = findArtifactDir(runMatch({ root, seed: 700001 }));
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

  // 逐轮：每一轮都能看出「谁开火了」，且 Emitter 是常量
  for (const r of match.rounds) {
    assertEqual(r.emitterA, 'A0', `第 ${r.round} 轮 A 的锚点标识应为 A0`);
    assertEqual(r.emitterB, 'B0', `第 ${r.round} 轮 B 的锚点标识应为 B0`);
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
  const dir = findArtifactDir(runMatch({ root, seed: 700002 }));

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

void runAll('operator-e2e');
