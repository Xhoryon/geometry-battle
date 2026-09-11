/**
 * judge-console —— 裁判台渲染（Rule Revision 3 §24/§27）
 *
 * 纯渲染回归：控制台板与结果板必须**自足** —— 裁判看一眼就知道现在能做什么、
 * 刚才发生了什么、这一场怎么结束的。这里不驱动比赛，只核对「板子上有没有
 * 裁判需要的信息」以及「错误有没有被翻译成人话」。
 */

import * as path from 'path';
import { MatchEngine } from '../src/core/Match';
import { AuditLog, MatchLog } from '../src/core/Logs';
import {
  explainError,
  renderAuditSummary,
  renderJudgeConsole,
  renderMatchSummary,
  renderReplayIndex,
} from '../src/ui/JudgeConsole';
import { HARD_ROUND_LIMIT, STALEMATE_NO_PROGRESS_LIMIT } from '../src/core/Rules';
import { assert, assertEqual, runAll, test, tmpDir } from './harness';

const ACTIONS = [
  { key: 'v', label: '校验两份算法并把比赛置为就绪（Preflight）' },
  { key: 'g', label: 'START' },
];

function bareEngine(): MatchEngine {
  const root = tmpDir('judge-console');
  return new MatchEngine({
    matchId: 'JC-TEST',
    seed: 4242,
    pointCount: 6,
    difficulty: 'easy',
    artifactRoot: path.join(root, 'artifacts'),
    sandboxRoot: path.join(root, 'sandboxes'),
  });
}

test('judge-console: 控制台板列出裁判需要的一切', () => {
  const engine = bareEngine();
  const board = renderJudgeConsole({
    snap: engine.getSnapshot(),
    slots: {
      A: { team: 'A', installed: false, hash: null, preflightPassed: false },
      B: { team: 'B', installed: false, hash: null, preflightPassed: false },
    },
    lastRound: null,
    actions: ACTIONS,
  });

  assert(board.includes('JUDGE CONSOLE'), '必须标明这是裁判控制台');
  assert(board.includes('JC-TEST'), '必须显示比赛标识');
  assert(board.includes('Team A: NOT LOADED'), '必须显示 A 队算法的载入状态');
  assert(board.includes('Phase:'), '必须显示当前阶段');
  assert(board.includes('Alive combat points'), '必须显示存活战斗点数');
  for (const a of ACTIONS) {
    assert(board.includes(`[${a.key}]`), `必须列出动作 [${a.key}]`);
  }
  // 比赛尚未开始时也要有话说，而不是留白
  assert(board.includes('没有地图'), '未开赛时应明确说明原因');
});

test('judge-console: 载入算法后必须显示就绪状态与包哈希', () => {
  const engine = bareEngine();
  const board = renderJudgeConsole({
    snap: engine.getSnapshot(),
    slots: {
      A: { team: 'A', installed: true, hash: 'a'.repeat(64), preflightPassed: true },
      B: { team: 'B', installed: true, hash: 'b'.repeat(64), preflightPassed: false },
    },
    lastRound: null,
    actions: ACTIONS,
  });
  assert(board.includes('READY (preflight ✓)'), '通过校验的一方必须标为 READY');
  assert(board.includes('LOADED (preflight ✗)'), '未通过校验的一方必须如实标出');
  assert(board.includes('aaaaaaaaaaaaaaaa'), '应显示包哈希前缀供核对');
});

test('judge-console: 错误码必须被翻译成人话（§27）', () => {
  assertEqual(explainError(null, true), null, '一切正常时不应报错');
  assertEqual(explainError(null, false), '本轮没有执行攻击', '没开火也要说明');
  assert(explainError('TIMEOUT', false)!.includes('TIMEOUT'), 'TIMEOUT 必须被点名');
  assert(explainError('CRASH', false)!.includes('CRASH'), 'CRASH 必须被点名');
  assert(explainError('INVALID_DSL', false)!.includes('INVALID'), 'INVALID 必须被点名');
  // RUNNER_ABORT 必须说清「不是本队的错」—— 它正是为了这个才存在的（PLAT-4）
  assert(
    explainError('RUNNER_ABORT', false)!.includes('无过错'),
    'RUNNER_ABORT 必须明确说明本队无过错'
  );
  for (const code of ['TIMEOUT', 'CRASH', 'INVALID_DSL', 'CANCELLED', 'RUNNER_ABORT', 'WEIRD']) {
    const msg = explainError(code, false)!;
    assert(msg.length > 0 && !msg.includes('undefined'), `${code} 必须有可读解释`);
  }
});

test('judge-console: 上一轮结果必须逐项列出（谁先手 / 谁开火 / 杀了谁 / 错误）', () => {
  const engine = bareEngine();
  const board = renderJudgeConsole({
    snap: engine.getSnapshot(),
    slots: {
      A: { team: 'A', installed: true, hash: null, preflightPassed: true },
      B: { team: 'B', installed: true, hash: null, preflightPassed: true },
    },
    lastRound: {
      round: 3,
      firstSolver: 'A',
      attacksExecuted: ['A', 'B'],
      killed: ['B1', 'B2'],
      aliveAfter: { A: 4, B: 2 },
      errors: ['Team B: TIMEOUT —— 未在计算预算内交出 result.json'],
    },
    actions: ACTIONS,
  });
  assert(board.includes('Last round 3'), '必须标明是第几轮');
  assert(board.includes('first solver A'), '必须给出先手方');
  assert(board.includes('[A, B]'), '必须给出实际开火顺序');
  assert(board.includes('B1,B2'), '必须给出击杀列表');
  assert(board.includes('A=4  B=2'), '必须给出结算后的存活数');
  assert(board.includes('TIMEOUT'), '错误必须出现在板上，而不是只写进日志');
});

test('judge-console: 结果板区分 ELIMINATION 与各类判和，并标出终止原因', () => {
  const base: MatchLog = {
    schemaVersion: 1,
    protocolVersion: '1.1',
    matchId: 'JC-LOG',
    seed: 1,
    pointCount: 6,
    difficulty: 'easy',
    teamAName: 'Team A',
    teamBName: 'Team B',
    teamAPackageHash: null,
    teamBPackageHash: null,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:01:00.000Z',
    winner: 'A',
    endReason: 'ELIMINATION',
    rounds: [],
    finalAlive: { A: 3, B: 0 },
  };

  const win = renderMatchSummary(base);
  assert(win.includes('TEAM A WINS'), '一方全灭必须明确宣布胜者');
  assert(win.includes('ELIMINATION'), '必须给出终止原因');

  const stale = renderMatchSummary({ ...base, winner: 'draw', endReason: 'STALEMATE' });
  assert(stale.includes('MATCH DRAW'), '僵持必须判和');
  assert(stale.includes(`连续零击杀回合`), '必须解释僵持是什么');
  assert(stale.includes(String(STALEMATE_NO_PROGRESS_LIMIT)), '必须给出实际阈值');

  const hard = renderMatchSummary({ ...base, winner: 'draw', endReason: 'HARD_ROUND_LIMIT' });
  assert(hard.includes('MATCH DRAW'), '硬上限同样判和');
  assert(hard.includes(String(HARD_ROUND_LIMIT)), '必须给出实际硬上限');

  const mutual = renderMatchSummary({ ...base, winner: 'draw', endReason: 'MUTUAL_ELIMINATION' });
  assert(mutual.includes('MATCH DRAW'), '同归于尽必须判和');
  assert(
    !mutual.includes('TEAM A WINS') && !mutual.includes('TEAM B WINS'),
    '同归于尽**不得**因为谁是先手就判谁胜'
  );
});

test('judge-console: 审计摘要给的是可读的事件统计，不是原始 JSON', () => {
  const audit: AuditLog = {
    schemaVersion: 1,
    matchId: 'JC-AUDIT',
    events: [
      { at: 't', seq: 1, type: 'MatchCreated', details: {} },
      { at: 't', seq: 2, type: 'RoundComputeStart', details: {} },
      { at: 't', seq: 3, type: 'RoundComputeStart', details: {} },
      { at: 't', seq: 4, type: 'MatchEnded', details: {} },
    ],
  };
  const board = renderAuditSummary(audit);
  assert(board.includes('JC-AUDIT'), '必须标明是哪一场');
  assert(board.includes('×2'), '必须给出事件计数');
  assert(board.includes('events 4'), '必须给出事件总数');
  assert(!board.includes('{'), '审计摘要不得直接倾倒 JSON');
  assert(board.includes('#1') && board.includes('#4'), '必须给出首尾事件序号，证明序列完整');
});

test('judge-console: 回放索引逐轮一行，空回放不崩', () => {
  const idx = renderReplayIndex({
    schemaVersion: 1,
    matchId: 'JC-REPLAY',
    seed: 1,
    teamAName: 'A',
    teamBName: 'B',
    winner: 'draw',
    endReason: 'STALEMATE',
    frames: [
      {
        round: 1,
        phase: 'ROUND_RESULT',
        publicStateHash: 'x',
        revealStateHash: 'x',
        roundStateHash: 'x',
        obstacles: [],
        aliveBefore: [],
        emitters: null,
        functionA: null,
        functionB: null,
        functionMathA: null,
        functionMathB: null,
        trajectoryA: [],
        trajectoryB: [],
        hitsA: [],
        hitsB: [],
        killed: ['B1'],
        blockedA: null,
        blockedB: null,
        timerA: null,
        timerB: null,
        cancelledA: false,
        cancelledB: false,
        firstSolver: 'A',
        attacksExecuted: ['A'],
        mutualElimination: false,
        endReason: 'NONE',
        noProgressStreak: 0,
        aliveAfter: [],
      },
    ],
  });
  assert(idx.includes('JC-REPLAY'), '必须标明是哪一场');
  assert(idx.includes('STALEMATE'), '必须给出终止原因');
  assert(idx.includes('R 1') || idx.includes('R1'), '必须逐轮列出');
  assert(idx.includes('B1'), '必须给出该轮击杀');

  const empty = renderReplayIndex({
    schemaVersion: 1, matchId: 'JC-EMPTY', seed: 1, teamAName: 'A', teamBName: 'B',
    winner: 'draw', endReason: 'NONE', frames: [],
  });
  assert(empty.includes('JC-EMPTY'), '空回放也必须正常渲染，不得抛错');
});

void runAll('judge-console');
