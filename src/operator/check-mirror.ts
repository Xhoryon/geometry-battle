#!/usr/bin/env node
/**
 * 镜像自检 —— 「同一份代码在 Team A 与 Team B 两侧是否表现一致？」（V1.4 Competitor Kit §6.2）
 *
 *     npx ts-node src/operator/check-mirror.ts ./my-algorithm
 *     npx ts-node src/operator/check-mirror.ts ./my-algorithm --json
 *
 * 参赛者的正式入口是 `competitor-kit/tools/check_mirror.py`（同一条路径的 Python 前端）。
 *
 * 这是一个**开发诊断**，不是正式规则：官方 Preflight 不运行它，它的结论也不会让任何提交被拒。
 * 它存在的理由是一类反复出现的 bug —— 算法只在 Team A（向 +x 打）那一侧调试过，
 * 换到 Team B 就崩溃、超时或交出非法函数。本地自检（validate_submission.py）虽然 A、B 各跑一次，
 * 但两次用的是**同一个**世界，「B 侧恰好也合法」不等于「B 侧打法与 A 侧对称」。
 *
 * 做法：
 *   1. 取本地自检用的 decoy 世界 W（`buildLocalDecoyWorld`，与 validate_submission 同一构造）；
 *   2. 构造它的镜像 M(W)：x → −x、A/B 互换、编号互换（B3 → A3）、障碍物按原顺序逐个镜像、
 *      锚点互换并镜像。A 组仍排在 B 组前面 —— 与引擎的自然序一致；
 *   3. 跑两对：〔A@W ↔ B@M(W)〕与〔B@W ↔ A@M(W)〕，每次都是真实沙箱（与本地自检同一条 runner 路径）；
 *   4. 两侧都经 parseCanonicalDSL + validateAttackFunction（各自正确的 firingDomain）；
 *   5. 比较**规范化后的几何**而不是 AST 字节：在原侧攻击范围的网格上求 max |f(x) − f_mirror(−x)|，
 *      再用 judgeShot 对镜像后的敌人集合结算，比较命中集合（编号换回）、阻挡障碍物与终止原因。
 *
 * 结论：
 *   PASS  两侧都合法且几何一致；
 *   WARN  两侧都合法但几何不同 —— 合法，只是提醒「你的算法不是镜像对称的，请确认这是有意的」
 *         （但两对配对的结算都不一致时会额外点名：那是「只会打 Team A」bug 的不崩溃形态 —— B 侧交了
 *         退化但合法的函数。退出码仍是 0，这里不改语义，只把它说出来）；
 *   FAIL  一侧合法而镜像侧不合法 / 崩溃 / 超时 —— 经典的「只会打 Team A」bug
 *         （两侧都失败同样记 FAIL，但那不是镜像问题：先去跑 validate_submission.py）。
 *
 * 退出码：0 = PASS / WARN；1 = FAIL；2 = 用法 / 环境错误。
 *
 * ⚠️ 判定规则**不在这里**：镜像只是搭世界；合法性与结算全部来自生产模块
 * （parseCanonicalDSL / validateAttackFunction / judgeShot）。禁止在本文件里添加任何判定逻辑。
 */

import * as path from 'path';
import { CanonicalNode, evaluateNode, parseCanonicalDSL } from '../core/Ast';
import { PublicStatePoint, buildPublicState, buildRevealState } from '../core/InputProtocol';
import { ShotOutcome, judgeShot } from '../core/Judge';
import { COMPUTE_TIMEOUT_MS, HIT_EPSILON, MEMORY_LIMIT_MB, firingDomain } from '../core/Rules';
import { validateAttackFunction } from '../core/Validator';
import { Point } from '../field/Field';
import { Obstacle } from '../obstacle/Obstacle';
import {
  cleanupSandbox,
  defaultSandboxRoot,
  parseResultFile,
  prepareSandbox,
  sandboxExecAvailable,
  spawnRunner,
} from '../runner';
import {
  LOCAL_PREFLIGHT_SEED,
  LocalDecoyWorld,
  assertDirectory,
  buildLocalDecoyWorld,
} from '../submission/LocalPreflight';
import { ENTRY_FILENAME } from '../submission/Manifest';
import { inspectPackage } from '../submission/Package';

type Team = 'A' | 'B';
type WorldLabel = 'original' | 'mirror';

/**
 * 几何一致的容差：与命中判定同量级（HIT_EPSILON）。
 * 镜像 x → −x 在 IEEE-754 下是精确运算，一个真正对称的算法在这里的偏差是 1e-12 量级；
 * 取 1e-6 是为了不把「浮点舍入」误报成「不对称」，同时任何肉眼可见的打法差异都远大于它。
 */
export const MIRROR_GEOMETRY_TOL = HIT_EPSILON;
/** 几何比对的网格点数（覆盖整个攻击范围，端点都取到） */
export const MIRROR_GRID_SAMPLES = 2001;

export type RunStage = 'startup' | 'result' | 'dsl' | 'legality' | 'timeout' | 'ok';

export interface MirrorRun {
  team: Team;
  world: WorldLabel;
  shooter: Point;
  domain: [number, number];
  ok: boolean;
  stage: RunStage;
  detail: string;
  errors: string[];
  computeTimeMs: number | null;
  ast: CanonicalNode | null;
}

export interface JudgeSummary {
  hits: string[];
  blockedObstacle: string | null;
  endReason: string;
}

export interface MirrorPair {
  /** 1 = A@原世界 ↔ B@镜像；2 = B@原世界 ↔ A@镜像 */
  index: 1 | 2;
  original: MirrorRun;
  mirror: MirrorRun;
  status: 'PASS' | 'WARN' | 'FAIL';
  /** 两侧都合法时才有：原侧攻击范围网格上的 max |f(x) − f_mirror(−x)| */
  geometry: { maxDeltaY: number; samples: number; nonFinite: number } | null;
  /** 两侧都合法时才有：judgeShot 结算（镜像侧的命中编号已换回原侧编号） */
  judge: { original: JudgeSummary; mirror: JudgeSummary; same: boolean } | null;
  notes: string[];
}

export interface MirrorReport {
  verdict: 'PASS' | 'WARN' | 'FAIL';
  dir: string;
  packageHash: string | null;
  world: { seed: number; mapSeed: number; points: number; obstacles: number };
  pairs: MirrorPair[];
}

export interface MirrorOptions {
  timeoutMs?: number;
  memoryLimitMb?: number;
  sandboxRoot?: string;
  /** decoy 种子（默认与本地自检相同） */
  seed?: number;
  denyReadPaths?: string[];
}

/** 环境 / 用法层面的失败（退出码 2）：与「算法有问题」严格分开 */
export class MirrorEnvironmentError extends Error {}

// ============================================================================
// 镜像变换
// ============================================================================

function other(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

/** 编号互换：A3 ↔ B3。编号里的数字保留 —— 镜像世界里 A1 不存在当且仅当原世界里 B1 不存在 */
export function mirrorId(id: string): string {
  if (id.startsWith('A')) return `B${id.slice(1)}`;
  if (id.startsWith('B')) return `A${id.slice(1)}`;
  return id;
}

function mirrorPoint(p: Point): Point {
  return { x: -p.x, y: p.y };
}

/** 障碍物镜像：只翻 x，保持类型与顺序（顺序决定 reveal 里的 O1..On 编号与 judge 的 obstacleIndex） */
export function mirrorObstacle(o: Obstacle): Obstacle {
  switch (o.type) {
    case 'rectangle':
      return { type: 'rectangle', xmin: -o.xmax, xmax: -o.xmin, ymin: o.ymin, ymax: o.ymax };
    case 'circle':
      return { type: 'circle', center: [-o.center[0], o.center[1]], radius: o.radius };
    case 'segment':
      return { type: 'segment', x1: -o.x1, y1: o.y1, x2: -o.x2, y2: o.y2 };
    case 'polygon':
      return { type: 'polygon', vertices: o.vertices.map(([x, y]) => [-x, y] as [number, number]) };
  }
}

/**
 * 整个世界的镜像：x → −x、队别互换、编号互换、锚点互换。
 * 点表仍是「A 组在前、B 组在后、组内保持原相对顺序」—— 与引擎自然序同构，
 * 这样镜像世界里数组的形状与正式输入一模一样，不会给算法额外的提示。
 */
export function mirrorWorld(w: LocalDecoyWorld): LocalDecoyWorld {
  const flip = (p: PublicStatePoint): PublicStatePoint => ({
    id: mirrorId(p.id),
    team: other(p.team),
    x: -p.x,
    y: p.y,
    alive: p.alive,
  });
  const newA = w.points.filter((p) => p.team === 'B').map(flip);
  const newB = w.points.filter((p) => p.team === 'A').map(flip);
  return {
    seed: w.seed,
    mapSeed: w.mapSeed,
    emitters: { A: mirrorPoint(w.emitters.B), B: mirrorPoint(w.emitters.A) },
    points: [...newA, ...newB],
    obstacles: w.obstacles.map(mirrorObstacle),
  };
}

// ============================================================================
// 跑一侧（真实沙箱，与 LocalPreflight.checkOneTeam 同一条路径）
// ============================================================================

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

async function runOne(
  team: Team,
  world: LocalDecoyWorld,
  label: WorldLabel,
  dir: string,
  opts: Required<Pick<MirrorOptions, 'timeoutMs' | 'memoryLimitMb' | 'sandboxRoot' | 'denyReadPaths'>>
): Promise<MirrorRun> {
  const shooter = world.emitters[team];
  const domain = firingDomain(shooter.x, team);
  const base = { team, world: label, shooter, domain, computeTimeMs: null as number | null, ast: null as CanonicalNode | null };
  const failed = (stage: RunStage, detail: string, errors: string[], computeTimeMs: number | null = null): MirrorRun => ({
    ...base,
    ok: false,
    stage,
    detail,
    errors,
    computeTimeMs,
  });

  const matchId = `check-mirror-${process.pid}-${label}`;
  const publicState = buildPublicState({ matchId, round: 0, emitters: world.emitters, points: world.points });
  const revealState = buildRevealState({
    matchId,
    round: 0,
    publicStateSha256: publicState.sha256,
    obstacles: world.obstacles,
  });

  const sandbox = prepareSandbox({
    sandboxRoot: opts.sandboxRoot,
    matchId,
    roundNumber: 0,
    team,
    packageDir: dir,
    entry: ENTRY_FILENAME,
    input: { publicJson: publicState.json, revealJson: revealState.json },
    memoryLimitMb: opts.memoryLimitMb,
    denyReadPaths: opts.denyReadPaths,
  });

  try {
    const runner = spawnRunner({ team, sandbox, timeoutMs: opts.timeoutMs, memoryLimitMb: opts.memoryLimitMb });
    try {
      await runner.ready;
    } catch (e) {
      runner.cancel();
      const outcome = await runner.done;
      return failed('startup', 'READY 握手失败 / READY handshake failed', [
        (e as Error).message || outcome.error || 'READY 握手失败',
      ]);
    }
    runner.release();
    const outcome = await runner.done;

    if (!outcome.success || outcome.resultJson === null) {
      const stage: RunStage = outcome.errorCode === 'TIMEOUT' ? 'timeout' : 'result';
      return failed(
        stage,
        `未产出合法结果 / no legal result（errorCode=${outcome.errorCode}）`,
        [outcome.error ?? '未知错误'],
        outcome.computeTimeMs
      );
    }
    const parsed = parseResultFile(outcome.resultJson);
    if (!parsed.ok) {
      return failed('result', 'result.json 结构不合法 / malformed result.json', [parsed.error], outcome.computeTimeMs);
    }
    const dsl = parseCanonicalDSL(parsed.dslText);
    if (!dsl.ok || !dsl.ast) {
      return failed(
        'dsl',
        'DSL 结构不合法 / DSL rejected by the parser',
        dsl.issues.map((i) => `${i.code}: ${i.message}`),
        outcome.computeTimeMs
      );
    }
    const legality = validateAttackFunction(dsl.ast, domain, shooter);
    if (!legality.valid) {
      return failed(
        'legality',
        `函数在攻击范围 [${fmt(domain[0])}, ${fmt(domain[1])}] 上不合法 / illegal on the firing domain`,
        legality.issues.map((i) => `${i.code}: ${i.message}`),
        outcome.computeTimeMs
      );
    }
    if (outcome.computeTimeMs > opts.timeoutMs) {
      return failed(
        'timeout',
        `耗时 ${outcome.computeTimeMs.toFixed(1)} ms 超过上限 ${opts.timeoutMs} ms / over budget`,
        [],
        outcome.computeTimeMs
      );
    }
    return {
      ...base,
      ok: true,
      stage: 'ok',
      detail:
        `f(${fmt(shooter.x)}) = ${fmt(shooter.y)}，攻击范围 [${fmt(domain[0])}, ${fmt(domain[1])}]，` +
        `耗时 ${outcome.computeTimeMs.toFixed(1)} ms`,
      errors: [],
      computeTimeMs: outcome.computeTimeMs,
      ast: dsl.ast,
    };
  } finally {
    cleanupSandbox(sandbox.dir);
  }
}

// ============================================================================
// 比对：规范化几何 + Judge 结算
// ============================================================================

function summarizeShot(o: ShotOutcome, relabel: (id: string) => string): JudgeSummary {
  return {
    hits: o.hits.map(relabel).sort(),
    blockedObstacle: o.blocked ? `O${o.blocked.obstacleIndex + 1}` : null,
    endReason: o.endReason,
  };
}

function sameJudge(a: JudgeSummary, b: JudgeSummary): boolean {
  return (
    a.hits.length === b.hits.length &&
    a.hits.every((id, i) => id === b.hits[i]) &&
    a.blockedObstacle === b.blockedObstacle &&
    a.endReason === b.endReason
  );
}

function comparePair(
  index: 1 | 2,
  original: MirrorRun,
  mirror: MirrorRun,
  worldO: LocalDecoyWorld,
  worldM: LocalDecoyWorld
): MirrorPair {
  const notes: string[] = [];

  if (!original.ok || !mirror.ok) {
    if (original.ok !== mirror.ok) {
      const bad = original.ok ? mirror : original;
      notes.push(
        `Team ${bad.team} @ ${bad.world === 'original' ? '原世界' : '镜像世界'} 失败（${bad.detail}），` +
          `而镜像侧合法 —— 典型的「只在一侧调试过」bug / one side fails while its mirror is legal`
      );
    } else {
      notes.push('两侧都失败：这不是镜像问题，请先运行 validate_submission.py / both sides fail — not a mirror issue');
    }
    return { index, original, mirror, status: 'FAIL', geometry: null, judge: null, notes };
  }

  // ---- 几何：原侧攻击范围上的网格，比较 f(x) 与 f_mirror(−x) ----
  const [lo, hi] = original.domain;
  let maxDeltaY = 0;
  let nonFinite = 0;
  for (let i = 0; i < MIRROR_GRID_SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / (MIRROR_GRID_SAMPLES - 1);
    const y1 = evaluateNode(original.ast!, x);
    const y2 = evaluateNode(mirror.ast!, -x);
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) {
      nonFinite++;
      continue;
    }
    const d = Math.abs(y1 - y2);
    if (d > maxDeltaY) maxDeltaY = d;
  }
  const geometry = { maxDeltaY, samples: MIRROR_GRID_SAMPLES, nonFinite };

  // ---- Judge：各自对自己世界里的敌人结算，镜像侧编号换回后比较 ----
  const enemiesOf = (w: LocalDecoyWorld, team: Team) =>
    w.points.filter((p) => p.team !== team && p.alive).map((p) => ({ id: p.id, position: { x: p.x, y: p.y } }));
  const shotO = judgeShot(original.ast!, original.shooter, original.team, enemiesOf(worldO, original.team), worldO.obstacles);
  const shotM = judgeShot(mirror.ast!, mirror.shooter, mirror.team, enemiesOf(worldM, mirror.team), worldM.obstacles);
  const judgeO = summarizeShot(shotO, (id) => id);
  const judgeM = summarizeShot(shotM, mirrorId);
  const judge = { original: judgeO, mirror: judgeM, same: sameJudge(judgeO, judgeM) };

  const geometrySame = nonFinite === 0 && maxDeltaY <= MIRROR_GEOMETRY_TOL;
  if (!geometrySame) {
    notes.push(
      `几何不一致：max |f(x) − f_mirror(−x)| = ${maxDeltaY.toExponential(2)}` +
        (nonFinite > 0 ? `，${nonFinite} 个网格点非有限` : '') +
        ' / geometry differs'
    );
  }
  if (!judge.same) {
    notes.push(
      `结算不一致：hits {${judgeO.hits.join(',')}} ↔ {${judgeM.hits.join(',')}}，` +
        `blocked ${judgeO.blockedObstacle ?? '-'} ↔ ${judgeM.blockedObstacle ?? '-'}，` +
        `end ${judgeO.endReason} ↔ ${judgeM.endReason} / judge outcome differs`
    );
  }
  return {
    index,
    original,
    mirror,
    status: geometrySame && judge.same ? 'PASS' : 'WARN',
    geometry,
    judge,
    notes,
  };
}

// ============================================================================
// 入口
// ============================================================================

export async function checkMirror(dir: string, opts: MirrorOptions = {}): Promise<MirrorReport> {
  const target = path.resolve(dir);
  const timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
  const memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;
  const sandboxRoot = opts.sandboxRoot ?? defaultSandboxRoot();
  const seed = opts.seed ?? LOCAL_PREFLIGHT_SEED;
  const repoRoot = path.resolve(__dirname, '..', '..');
  const denyReadPaths = opts.denyReadPaths ?? [repoRoot, target];

  // 环境与包结构问题不是「镜像问题」，一律作为环境错误抛出（退出码 2），
  // 让参赛者先去跑 validate_submission.py —— 那边的报错分节更细。
  if (!sandboxExecAvailable()) {
    throw new MirrorEnvironmentError('当前机器无法启用 sandbox-exec，镜像自检结论不可信；请在与比赛相同的 macOS 环境运行');
  }
  const inspection = inspectPackage(target);
  if (!inspection.valid || !inspection.files.some((f) => f.relPath === ENTRY_FILENAME)) {
    throw new MirrorEnvironmentError(
      `算法包结构不合法，先运行 validate_submission.py：${inspection.errors.join('; ') || `缺少 ${ENTRY_FILENAME}`}`
    );
  }
  const worldO = buildLocalDecoyWorld(seed);
  if (!worldO) throw new MirrorEnvironmentError(`seed=${seed} 无法生成 decoy 世界`);
  const worldM = mirrorWorld(worldO);

  const runOpts = { timeoutMs, memoryLimitMb, sandboxRoot, denyReadPaths };
  // 顺序执行：四次沙箱并行会互相抢 CPU，把「慢」误报成「超时」。
  const aO = await runOne('A', worldO, 'original', target, runOpts);
  const bM = await runOne('B', worldM, 'mirror', target, runOpts);
  const bO = await runOne('B', worldO, 'original', target, runOpts);
  const aM = await runOne('A', worldM, 'mirror', target, runOpts);

  const pairs: MirrorPair[] = [comparePair(1, aO, bM, worldO, worldM), comparePair(2, bO, aM, worldO, worldM)];
  const verdict = pairs.some((p) => p.status === 'FAIL') ? 'FAIL' : pairs.some((p) => p.status === 'WARN') ? 'WARN' : 'PASS';

  return {
    verdict,
    dir: target,
    packageHash: inspection.hash,
    world: { seed, mapSeed: worldO.mapSeed, points: worldO.points.length, obstacles: worldO.obstacles.length },
    pairs,
  };
}

/** 两对配对都跑到了结算、且两对的结算都不一致（见 formatReport 的 WARN 分支） */
export function judgeDiffersOnEveryPair(report: MirrorReport): boolean {
  return report.pairs.length > 0 && report.pairs.every((p) => p.judge !== null && !p.judge.same);
}

/** 退出码：PASS / WARN 都是 0 —— WARN 是合法的，只是提醒 */
export function exitCodeFor(report: MirrorReport): 0 | 1 {
  return report.verdict === 'FAIL' ? 1 : 0;
}

/** 人类可读报告（中英双语；CLI / 测试共用） */
export function formatReport(report: MirrorReport): string {
  const lines: string[] = [];
  // 「原世界 original」与「镜像世界 mirror」在等宽 + CJK 双宽下同为 15 列，无需再补空格
  const worldName = (w: WorldLabel): string => (w === 'original' ? '原世界 original' : '镜像世界 mirror');
  lines.push('Geometry Battle — 镜像自检 / Mirror self-check');
  lines.push('（开发诊断，官方 Preflight 不运行它 / development diagnostic — the official Preflight does not run it）');
  lines.push(`算法目录 / package: ${report.dir}`);
  lines.push(
    `decoy 世界 / decoy world: seed=${report.world.seed}（地图种子 ${report.world.mapSeed}，` +
      `${report.world.points} 点 / ${report.world.obstacles} 障碍物）`
  );
  lines.push(`包哈希 / package hash: ${report.packageHash ?? '(不可用)'}`);
  lines.push('');
  lines.push('── 镜像一致性 / Mirror consistency ──');
  for (const p of report.pairs) {
    lines.push(
      `配对 ${p.index} / Pair ${p.index}: Team ${p.original.team} @ 原世界 original  ↔  Team ${p.mirror.team} @ 镜像世界 mirror`
    );
    for (const r of [p.original, p.mirror]) {
      lines.push(`  Team ${r.team} @ ${worldName(r.world)}  ${(r.ok ? 'OK' : 'FAIL').padEnd(4)} ${r.detail}`);
      // CRASH 的 traceback 是多行的：续行缩进到 ↳ 之后，别让它顶格混进分节
      for (const e of r.errors) lines.push(`      ↳ ${e.split('\n').join('\n        ')}`);
    }
    if (p.geometry) {
      lines.push(
        `  几何 / geometry                 max |f(x) − f_mirror(−x)| = ${p.geometry.maxDeltaY.toExponential(2)}` +
          `（${p.geometry.samples} 采样点 / samples，容差 / tolerance ${MIRROR_GEOMETRY_TOL}）`
      );
    }
    if (p.judge) {
      const o = p.judge.original;
      const m = p.judge.mirror;
      lines.push(
        `  判定 / judge                    hits {${o.hits.join(',')}} ↔ {${m.hits.join(',')}}（镜像侧编号已换回 / relabelled），` +
          `blocked ${o.blockedObstacle ?? '-'} ↔ ${m.blockedObstacle ?? '-'}，end ${o.endReason} ↔ ${m.endReason}`
      );
    }
    for (const n of p.notes) lines.push(`      ↳ ${n}`);
    lines.push(`  → ${p.status}`);
  }
  lines.push('');
  switch (report.verdict) {
    case 'PASS':
      lines.push('MIRROR PASS — 两侧都合法且几何一致 / both sides legal and geometrically identical');
      break;
    case 'WARN':
      lines.push(
        'MIRROR WARN — 两侧都合法，但几何不同：你的算法不是镜像对称的，请确认这是有意为之 / ' +
          'both sides are legal but the geometry differs: your solver is not mirror-symmetric; make sure it is intentional'
      );
      // 两对都「结算不一致」不是普通的不对称：B 侧筛不到敌人后交了退化函数，命中 / 阻挡 / 终止原因全变了。
      // 这正是本工具要抓的 bug 的不崩溃形态 —— 退出码按契约仍是 0，但必须在结论里点名。
      if (judgeDiffersOnEveryPair(report)) {
        lines.push(
          '  ↳ 两对配对的结算都不一致（命中 / 阻挡 / 终止原因）：这是「只会打 Team A」bug 的不崩溃形态 —— 请像 FAIL 一样认真对待 / ' +
            'the judge outcome differs on both pairs: this is the non-crashing form of the Team-A-only bug — treat it as seriously as FAIL'
        );
      }
      break;
    case 'FAIL':
      lines.push(
        'MIRROR FAIL — 一侧合法而镜像侧失败（崩溃 / 超时 / 非法函数）：同一份提交必须在 Team A 与 Team B 两侧都能正确运行 / ' +
          'one side is legal while its mirror fails: the same submission must run correctly as Team A and as Team B'
      );
      break;
  }
  return lines.join('\n');
}

// ============================================================================
// CLI
// ============================================================================

function usage(): never {
  process.stderr.write(
    [
      '用法: npx ts-node src/operator/check-mirror.ts <算法目录> [选项]',
      '',
      '把算法分别以 Team A / Team B 放进一个 decoy 世界及其镜像世界里跑，比较两侧的几何与结算是否一致。',
      '这是开发诊断，不是正式规则；官方 Preflight 不运行它。',
      '',
      '选项:',
      `  --timeout <ms>        单轮超时（默认 ${COMPUTE_TIMEOUT_MS}，即正式比赛的冻结值）`,
      `  --seed <n>            decoy 种子（默认 ${LOCAL_PREFLIGHT_SEED}，与本地自检相同）`,
      '  --sandbox-root <dir>  沙箱根目录（默认系统临时目录）',
      '  --json                以 JSON 输出完整报告',
      '',
      '退出码: 0 = PASS / WARN；1 = FAIL；2 = 用法 / 环境错误',
      '',
    ].join('\n')
  );
  process.exit(2);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) usage();

  const opts: MirrorOptions = {};
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') {
      opts.timeoutMs = Number(argv[++i]);
      if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) usage();
    } else if (a === '--seed') {
      opts.seed = Number(argv[++i]);
      if (!Number.isInteger(opts.seed)) usage();
    } else if (a === '--sandbox-root') {
      opts.sandboxRoot = argv[++i];
      if (!opts.sandboxRoot) usage();
    } else if (a === '--json') {
      asJson = true;
    } else if (a.startsWith('--')) {
      usage();
    }
  }

  try {
    assertDirectory(target);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  let report: MirrorReport;
  try {
    report = await checkMirror(target, opts);
  } catch (e) {
    if (e instanceof MirrorEnvironmentError) {
      process.stderr.write(`${e.message}\n`);
      return 2;
    }
    throw e;
  }

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `\n${formatReport(report)}\n`);
  return exitCodeFor(report);
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`镜像自检异常: ${(e as Error).stack ?? String(e)}\n`);
      process.exit(2);
    });
}
