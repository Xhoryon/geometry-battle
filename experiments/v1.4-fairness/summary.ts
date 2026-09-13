/**
 * summary —— 自战 campaign 的记录形状与汇总（被 selfplay.ts 逐场调用、被 analyze.ts 离线复算）
 *
 * 汇总回答三件事：
 *   1. 槽位胜率：P(A 胜 | 分出胜负)，精确二项 CI 与 p（H0 = 0.5）；按 orig / mirror / 全部分层；
 *   2. 配对镜像检查：同一 seed 的 map 与 M(map) 两场，胜者互换、结束原因相同、逐回合 kills / blocked / result 互换；
 *      任一不满足即 violation，并附两场里出现过的错误码（TIMEOUT / INVALID / CRASH 是环境或 solver 原因，
 *      没有错误码却不镜像才是平台问题）；
 *   3. 先手：双方都交出合法解（result = COMPLETE）的回合里 P(firstSolver = A / B / tie)，二项 CI 与 p，
 *      aTimeMs / bTimeMs / (a − b) 的中位数与 p95，以及 A 更快的比例。
 */

import { BinomialSummary, binomialSummary, mean, median, quantile } from './stats';

export interface RoundRec {
  round: number;
  firstSolver: 'A' | 'B' | 'tie' | 'none';
  aTimeMs: number | null;
  bTimeMs: number | null;
  aKills: number;
  bKills: number;
  aBlocked: boolean;
  bBlocked: boolean;
  result: string;
  aErrorCode: string | null;
  bErrorCode: string | null;
  attacksExecuted: string;
}

export interface MatchRec {
  campaign: string;
  matchId: string;
  /** 请求的种子；`mapSeed` 是生成器实际落到的种子（回退时不同） */
  seed: number;
  mapSeed: number | null;
  mapHash: string | null;
  difficulty: string;
  points: number;
  variant: 'orig' | 'mirror';
  winner: 'A' | 'B' | 'draw' | null;
  endReason: string | null;
  rounds: number;
  finalAlive: { A: number; B: number } | null;
  kills: { A: number; B: number };
  multiKillRounds: { A: number; B: number };
  obstacleTerminations: { A: number; B: number };
  errorCodes: { A: Record<string, number>; B: Record<string, number> };
  timeouts: { A: number; B: number };
  invalids: { A: number; B: number };
  crashes: { A: number; B: number };
  completeRounds: number;
  firstSolver: { A: number; B: number; tie: number; none: number };
  emitters: { A: string; B: string } | null;
  durationSec: number;
  loadBefore: number[];
  loadAfter: number[];
  preflightOk: boolean;
  /** 非 null 表示这场没有正常打完（preflight 失败 / 引擎异常），不计入胜率 */
  failure: string | null;
  roundsDetail: RoundRec[];
}

export interface WinTally {
  matches: number;
  aWins: number;
  bWins: number;
  draws: number;
  decisive: number;
  aWinRate: BinomialSummary;
  endReasons: Record<string, number>;
  roundsMean: number;
  roundsMedian: number;
  kills: { A: number; B: number };
  multiKillRounds: { A: number; B: number };
  obstacleTerminations: { A: number; B: number };
  timeouts: { A: number; B: number };
  invalids: { A: number; B: number };
  crashes: { A: number; B: number };
  byDifficulty: Record<string, { matches: number; aWins: number; bWins: number; draws: number }>;
  byPoints: Record<string, { matches: number; aWins: number; bWins: number; draws: number }>;
}

export interface PairViolation {
  seed: number;
  orig: { winner: string | null; endReason: string | null; rounds: number; errorCodes: MatchRec['errorCodes'] };
  mirror: { winner: string | null; endReason: string | null; rounds: number; errorCodes: MatchRec['errorCodes'] };
  reasons: string[];
  perRoundMismatches: number;
  hadErrorCodes: boolean;
}

export interface PairCheck {
  pairs: number;
  ok: number;
  violations: PairViolation[];
  perRoundChecked: number;
  perRoundMismatches: number;
  /** winner(orig) → winner(mirror) 的转移计数 */
  winnerTransitions: Record<string, number>;
}

export interface FirstSolverStats {
  completeRounds: number;
  A: number;
  B: number;
  tie: number;
  /** 在 A/B 分出先后的回合里 P(A 先) */
  aFirstOfDecided: BinomialSummary;
  tieRate: number;
  times: {
    aMedian: number;
    aP95: number;
    bMedian: number;
    bP95: number;
    diffMean: number;
    diffMedian: number;
    diffP05: number;
    diffP95: number;
    aFasterFraction: number;
  };
}

export interface CampaignSummary {
  campaign: string;
  pkg: string;
  packageName: string | null;
  packageHash: string | null;
  args: Record<string, unknown>;
  generatedAt: string;
  durationSec: number;
  hostLoad: { before: number[]; after: number[] };
  matches: number;
  failed: number;
  failures: { seed: number; variant: string; failure: string }[];
  byVariant: { all: WinTally; orig: WinTally; mirror: WinTally | null };
  pairCheck: PairCheck | null;
  firstSolver: { all: FirstSolverStats; orig: FirstSolverStats; mirror: FirstSolverStats | null };
  /** 每场的紧凑行（不含逐回合明细；明细在 raw 目录的 records.json） */
  matchRows: Omit<MatchRec, 'roundsDetail' | 'errorCodes' | 'loadBefore' | 'loadAfter'>[];
}

const bump = (rec: Record<string, number>, key: string): void => {
  rec[key] = (rec[key] ?? 0) + 1;
};

export function tally(records: readonly MatchRec[]): WinTally {
  const ok = records.filter((r) => r.failure === null);
  const t: WinTally = {
    matches: ok.length,
    aWins: 0,
    bWins: 0,
    draws: 0,
    decisive: 0,
    aWinRate: binomialSummary(0, 0),
    endReasons: {},
    roundsMean: mean(ok.map((r) => r.rounds)),
    roundsMedian: median(ok.map((r) => r.rounds)),
    kills: { A: 0, B: 0 },
    multiKillRounds: { A: 0, B: 0 },
    obstacleTerminations: { A: 0, B: 0 },
    timeouts: { A: 0, B: 0 },
    invalids: { A: 0, B: 0 },
    crashes: { A: 0, B: 0 },
    byDifficulty: {},
    byPoints: {},
  };
  for (const r of ok) {
    if (r.winner === 'A') t.aWins++;
    else if (r.winner === 'B') t.bWins++;
    else t.draws++;
    bump(t.endReasons, r.endReason ?? 'null');
    for (const team of ['A', 'B'] as const) {
      t.kills[team] += r.kills[team];
      t.multiKillRounds[team] += r.multiKillRounds[team];
      t.obstacleTerminations[team] += r.obstacleTerminations[team];
      t.timeouts[team] += r.timeouts[team];
      t.invalids[team] += r.invalids[team];
      t.crashes[team] += r.crashes[team];
    }
    for (const [rec, key] of [[t.byDifficulty, r.difficulty], [t.byPoints, `${r.points}p`]] as const) {
      const cell = (rec[key] ??= { matches: 0, aWins: 0, bWins: 0, draws: 0 });
      cell.matches++;
      if (r.winner === 'A') cell.aWins++;
      else if (r.winner === 'B') cell.bWins++;
      else cell.draws++;
    }
  }
  t.decisive = t.aWins + t.bWins;
  t.aWinRate = binomialSummary(t.aWins, t.decisive);
  return t;
}

const swapWinner = (w: string | null): string | null => (w === 'A' ? 'B' : w === 'B' ? 'A' : w);
const swapResult = (r: string): string =>
  r.endsWith('_A') ? `${r.slice(0, -2)}_B` : r.endsWith('_B') ? `${r.slice(0, -2)}_A` : r;
const hasErrors = (r: MatchRec): boolean => Object.keys(r.errorCodes.A).length + Object.keys(r.errorCodes.B).length > 0;

export function pairCheck(records: readonly MatchRec[]): PairCheck | null {
  const mirrors = records.filter((r) => r.variant === 'mirror' && r.failure === null);
  if (mirrors.length === 0) return null;
  const origBySeed = new Map(records.filter((r) => r.variant === 'orig' && r.failure === null).map((r) => [r.seed, r]));
  const out: PairCheck = { pairs: 0, ok: 0, violations: [], perRoundChecked: 0, perRoundMismatches: 0, winnerTransitions: {} };
  for (const m of mirrors) {
    const o = origBySeed.get(m.seed);
    if (!o) continue;
    out.pairs++;
    bump(out.winnerTransitions, `${o.winner}→${m.winner}`);
    const reasons: string[] = [];
    if (m.winner !== swapWinner(o.winner)) reasons.push(`winner ${o.winner}→${m.winner}（应为 ${swapWinner(o.winner)}）`);
    if (m.endReason !== o.endReason) reasons.push(`endReason ${o.endReason} vs ${m.endReason}`);
    if (m.rounds !== o.rounds) reasons.push(`rounds ${o.rounds} vs ${m.rounds}`);
    if (o.finalAlive && m.finalAlive && (m.finalAlive.A !== o.finalAlive.B || m.finalAlive.B !== o.finalAlive.A)) {
      reasons.push(`finalAlive ${JSON.stringify(o.finalAlive)} vs ${JSON.stringify(m.finalAlive)}`);
    }
    let perRound = 0;
    const n = Math.min(o.roundsDetail.length, m.roundsDetail.length);
    for (let i = 0; i < n; i++) {
      const a = o.roundsDetail[i];
      const b = m.roundsDetail[i];
      out.perRoundChecked++;
      const same =
        b.aKills === a.bKills && b.bKills === a.aKills && b.aBlocked === a.bBlocked && b.bBlocked === a.aBlocked && b.result === swapResult(a.result);
      if (!same) perRound++;
    }
    if (perRound > 0) reasons.push(`${perRound} 个回合的 kills/blocked/result 不互为镜像`);
    out.perRoundMismatches += perRound;
    if (reasons.length === 0) out.ok++;
    else {
      out.violations.push({
        seed: m.seed,
        orig: { winner: o.winner, endReason: o.endReason, rounds: o.rounds, errorCodes: o.errorCodes },
        mirror: { winner: m.winner, endReason: m.endReason, rounds: m.rounds, errorCodes: m.errorCodes },
        reasons,
        perRoundMismatches: perRound,
        hadErrorCodes: hasErrors(o) || hasErrors(m),
      });
    }
  }
  return out;
}

export function firstSolverStats(records: readonly MatchRec[]): FirstSolverStats {
  const rounds = records.filter((r) => r.failure === null).flatMap((r) => r.roundsDetail).filter((x) => x.result === 'COMPLETE' && x.aTimeMs !== null && x.bTimeMs !== null);
  let A = 0;
  let B = 0;
  let tie = 0;
  const a: number[] = [];
  const b: number[] = [];
  const diff: number[] = [];
  let aFaster = 0;
  for (const x of rounds) {
    if (x.firstSolver === 'A') A++;
    else if (x.firstSolver === 'B') B++;
    else if (x.firstSolver === 'tie') tie++;
    a.push(x.aTimeMs!);
    b.push(x.bTimeMs!);
    diff.push(x.aTimeMs! - x.bTimeMs!);
    if (x.aTimeMs! < x.bTimeMs!) aFaster++;
  }
  return {
    completeRounds: rounds.length,
    A,
    B,
    tie,
    aFirstOfDecided: binomialSummary(A, A + B),
    tieRate: rounds.length > 0 ? tie / rounds.length : NaN,
    times: {
      aMedian: median(a),
      aP95: quantile(a, 0.95),
      bMedian: median(b),
      bP95: quantile(b, 0.95),
      diffMean: mean(diff),
      diffMedian: median(diff),
      diffP05: quantile(diff, 0.05),
      diffP95: quantile(diff, 0.95),
      aFasterFraction: rounds.length > 0 ? aFaster / rounds.length : NaN,
    },
  };
}

export function summarize(
  records: readonly MatchRec[],
  meta: { campaign: string; pkg: string; packageName: string | null; packageHash: string | null; args: Record<string, unknown>; loadBefore: number[]; loadAfter: number[]; durationSec: number }
): CampaignSummary {
  const orig = records.filter((r) => r.variant === 'orig');
  const mirror = records.filter((r) => r.variant === 'mirror');
  return {
    campaign: meta.campaign,
    pkg: meta.pkg,
    packageName: meta.packageName,
    packageHash: meta.packageHash,
    args: meta.args,
    generatedAt: new Date().toISOString(),
    durationSec: meta.durationSec,
    hostLoad: { before: meta.loadBefore, after: meta.loadAfter },
    matches: records.length,
    failed: records.filter((r) => r.failure !== null).length,
    failures: records.filter((r) => r.failure !== null).map((r) => ({ seed: r.seed, variant: r.variant, failure: r.failure! })),
    byVariant: { all: tally(records), orig: tally(orig), mirror: mirror.length ? tally(mirror) : null },
    pairCheck: pairCheck(records),
    firstSolver: { all: firstSolverStats(records), orig: firstSolverStats(orig), mirror: mirror.length ? firstSolverStats(mirror) : null },
    matchRows: records.map(({ roundsDetail: _r, errorCodes: _e, loadBefore: _lb, loadAfter: _la, ...rest }) => rest),
  };
}

export function describe(s: CampaignSummary): string {
  const lines: string[] = [];
  const w = (label: string, t: WinTally) =>
    lines.push(
      `${label}: ${t.matches} 场  A ${t.aWins} / B ${t.bWins} / draw ${t.draws}  P(A胜|分胜负)=${t.aWinRate.rate.toFixed(3)} CI95 [${t.aWinRate.ci95.map((v) => v.toFixed(3)).join(', ')}] p=${t.aWinRate.pVsHalf.toExponential(2)}  回合均 ${t.roundsMean.toFixed(1)}  kills A/B ${t.kills.A}/${t.kills.B}  多杀回合 ${t.multiKillRounds.A}/${t.multiKillRounds.B}  障碍截断 ${t.obstacleTerminations.A}/${t.obstacleTerminations.B}  TIMEOUT ${t.timeouts.A}/${t.timeouts.B} INVALID ${t.invalids.A}/${t.invalids.B} CRASH ${t.crashes.A}/${t.crashes.B}  endReasons ${JSON.stringify(t.endReasons)}`
    );
  lines.push(`campaign ${s.campaign}  pkg=${s.pkg}  name=${s.packageName}  hash=${s.packageHash}  失败场次 ${s.failed}/${s.matches}  load ${s.hostLoad.before.map((v) => v.toFixed(2)).join('/')} → ${s.hostLoad.after.map((v) => v.toFixed(2)).join('/')}  ${s.durationSec.toFixed(0)}s`);
  w('ALL   ', s.byVariant.all);
  w('ORIG  ', s.byVariant.orig);
  if (s.byVariant.mirror) w('MIRROR', s.byVariant.mirror);
  if (s.pairCheck) {
    lines.push(`配对镜像检查: ${s.pairCheck.ok}/${s.pairCheck.pairs} 对通过；逐回合 ${s.pairCheck.perRoundMismatches}/${s.pairCheck.perRoundChecked} 不镜像；winner 转移 ${JSON.stringify(s.pairCheck.winnerTransitions)}`);
    for (const v of s.pairCheck.violations) lines.push(`  ✗ seed=${v.seed} ${v.reasons.join('; ')}  错误码: ${v.hadErrorCodes ? JSON.stringify({ orig: v.orig.errorCodes, mirror: v.mirror.errorCodes }) : '无'}`);
  }
  const f = (label: string, x: FirstSolverStats) =>
    lines.push(
      `firstSolver ${label}: COMPLETE 回合 ${x.completeRounds}  A ${x.A} / B ${x.B} / tie ${x.tie}  P(A先|非tie)=${x.aFirstOfDecided.rate.toFixed(3)} CI95 [${x.aFirstOfDecided.ci95.map((v) => v.toFixed(3)).join(', ')}] p=${x.aFirstOfDecided.pVsHalf.toExponential(2)}  aTime med/p95 ${x.times.aMedian.toFixed(2)}/${x.times.aP95.toFixed(2)}  bTime ${x.times.bMedian.toFixed(2)}/${x.times.bP95.toFixed(2)}  a−b mean/med/p05/p95 ${x.times.diffMean.toFixed(3)}/${x.times.diffMedian.toFixed(3)}/${x.times.diffP05.toFixed(3)}/${x.times.diffP95.toFixed(3)}  A更快 ${x.times.aFasterFraction.toFixed(3)}`
    );
  f('ALL   ', s.firstSolver.all);
  f('ORIG  ', s.firstSolver.orig);
  if (s.firstSolver.mirror) f('MIRROR', s.firstSolver.mirror);
  return lines.join('\n');
}
