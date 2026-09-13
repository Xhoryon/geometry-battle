/**
 * mapstats —— 地图生成器的左右分布对称性（V1.4 任务书 §10「Map / Placement Bias」）
 *
 * 纯 TS、不起沙箱。对每个 (难度 × 点数) 单元生成 N 张地图（`generateMapOrNull`，记录种子回退），
 * 逐张计算 Team A / Team B 的**配对**几何指标，再做配对检验：
 *
 *   - 出生点：mean|x|（到中线距离）、mean y、mean|y|；
 *   - 障碍物间距：本队出生点到最近障碍物的 min / mean 间距、Emitter 到最近障碍物的间距；
 *   - 直线可达：从自动选定的 Emitter（本队第一个点，与 `autoSelectEmitters` 一致）出发，
 *     对每个敌方**战斗点**（对方第 2..n 点，第 1 点是对方 Emitter）用真实 `judgeShot` 结算一条
 *     经过 Emitter 与目标的直线 —— 目标出现在 hits 里即「直线可达」。这走的是生产的
 *     penetration / firstContactX / 出界截断，不是自写的射线几何；
 *   - 最近 / 平均敌人距离；
 *   - 障碍物：质心 x 的符号计数、x<0 与 x>0 的面积、与本队区域 [−20,−4] / [4,20] 的 x 投影重叠长度与面积。
 *
 * 另外对每张图算 mirror(map) 的同一组指标：
 *   (1) 逐位恒等检查 metrics(mirror(map)).A === metrics(map).B —— 这同时检验 mirrorMap 与指标函数本身
 *       （含真实 judgeShot）的镜像对称性；
 *   (2) KS 两样本比较「generator(seed) 的 A 侧分布」与「mirror(generator(seed)) 的 A 侧分布」。
 *
 * 预先登记的判定规则（不看数据先定）：
 *   每个指标：Wilcoxon 双侧 p < 0.001 / 指标数（Bonferroni）**且** |d_z| ≥ 0.05 → CONFIRMED；
 *   p 过线但 |d_z| < 0.05 → DETECTABLE_NEGLIGIBLE（可测到但无实际意义，如实列出）；否则 NOT_DETECTED。
 *   总结论：任一指标 CONFIRMED → MAP DISTRIBUTION BIAS: CONFIRMED；否则 DISPROVEN（给出本样本量的
 *   最小可检出效应 MDE）；样本不足（n < 1000）→ UNRESOLVED。
 *
 * 用法：npx ts-node experiments/v1.4-fairness/mapstats.ts [--seeds 3000] [--start 100000] [--stride 7919] [--out results/mapstats.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNode } from '../../src/core/Ast';
import { judgeShot } from '../../src/core/Judge';
import { FIELD } from '../../src/core/Rules';
import { Point } from '../../src/field/Field';
import { GeneratedMap, generateMapOrNull } from '../../src/map/MapGenerator';
import { Obstacle, distanceToObstacle } from '../../src/obstacle/Obstacle';
import * as M from '../../tests/mirror-helpers';
import { PairedSummary, fmt, fmtP, ksTwoSample, normalCdf, pairedSummary } from './stats';

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const POINTS: readonly number[] = [6, 8, 10];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { seeds: number; start: number; stride: number; out: string } {
  const opts = { seeds: 3000, start: 100_000, stride: 7919, out: path.join(__dirname, 'results', 'mapstats.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--seeds') opts.seeds = Number(v), i++;
    else if (a === '--start') opts.start = Number(v), i++;
    else if (a === '--stride') opts.stride = Number(v), i++;
    else if (a === '--out') opts.out = path.resolve(v), i++;
    else throw new Error(`未知参数 ${a}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

interface TeamMetrics {
  meanAbsX: number;
  meanY: number;
  meanAbsY: number;
  minClearance: number;
  meanClearance: number;
  emitterClearance: number;
  emitterAbsX: number;
  losCount: number;
  nearestEnemyDist: number;
  meanEnemyDist: number;
  zoneObstacleOverlapX: number;
  zoneObstacleArea: number;
}
const TEAM_METRIC_KEYS = [
  'meanAbsX', 'meanY', 'meanAbsY', 'minClearance', 'meanClearance', 'emitterClearance', 'emitterAbsX',
  'losCount', 'nearestEnemyDist', 'meanEnemyDist', 'zoneObstacleOverlapX', 'zoneObstacleArea',
] as const satisfies readonly (keyof TeamMetrics)[];

interface ObstacleMetrics {
  centroidLeft: number;
  centroidRight: number;
  centroidZero: number;
  areaLeft: number;
  areaRight: number;
}

interface MapMetrics {
  A: TeamMetrics;
  B: TeamMetrics;
  obstacles: ObstacleMetrics;
}

const num = (v: number): CanonicalNode => ({ type: 'number', value: v });
const X: CanonicalNode = { type: 'variable' };
/** 经过 (xe,ye) 与 (xt,yt) 的直线，A/B 同一写法 y = ye + m·(x − xe) —— 它对两队都是合法函数 */
function lineThrough(xe: number, ye: number, xt: number, yt: number): CanonicalNode {
  const m = (yt - ye) / (xt - xe);
  return { type: 'add', args: [num(ye), { type: 'mul', args: [num(m), { type: 'sub', args: [X, num(xe)] }] }] };
}

function xExtent(o: Obstacle): [number, number] {
  switch (o.type) {
    case 'rectangle': return [o.xmin, o.xmax];
    case 'circle': return [o.center[0] - o.radius, o.center[0] + o.radius];
    case 'segment': return [Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)];
    case 'polygon': { const xs = o.vertices.map((v) => v[0]); return [Math.min(...xs), Math.max(...xs)]; }
  }
}

function centroidX(o: Obstacle): number {
  switch (o.type) {
    case 'rectangle': return (o.xmin + o.xmax) / 2;
    case 'circle': return o.center[0];
    case 'segment': return (o.x1 + o.x2) / 2;
    case 'polygon': return o.vertices.reduce((s, v) => s + v[0], 0) / o.vertices.length;
  }
}

/**
 * 障碍物落在半平面 x < c 里的面积（矩形精确裁剪；圆用弓形公式，d 为圆心到边界的带符号距离）。
 *
 * 右侧面积**不能**写成 `area − areaLeftOf`：那会在最后一位 ulp 上破坏镜像恒等
 * （smoke run 里 180 张图有 99 处这种假差异）。左右各用一套互为镜像的表达式 ——
 * IEEE-754 下取负精确、`min(−a, c) = −max(a, −c)`、`(−a) − (−b) = b − a`，于是
 * areaRightOf(o, c) 与 areaLeftOf(mirror(o), −c) 逐位相同。
 */
function areaLeftOf(o: Obstacle, c: number): number {
  switch (o.type) {
    case 'rectangle': {
      const w = Math.max(0, Math.min(o.xmax, c) - o.xmin);
      return w * (o.ymax - o.ymin);
    }
    case 'circle': {
      const r = o.radius;
      const d = o.center[0] - c;
      if (d <= -r) return Math.PI * r * r;
      if (d >= r) return 0;
      return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
    }
    default: return 0;
  }
}

/** 半平面 x > c 里的面积，表达式与 areaLeftOf 互为镜像（见上） */
function areaRightOf(o: Obstacle, c: number): number {
  switch (o.type) {
    case 'rectangle': {
      const w = Math.max(0, o.xmax - Math.max(o.xmin, c));
      return w * (o.ymax - o.ymin);
    }
    case 'circle': {
      const r = o.radius;
      const d = o.center[0] - c;
      if (d >= r) return Math.PI * r * r;
      if (d <= -r) return 0;
      return r * r * Math.acos(-d / r) + d * Math.sqrt(r * r - d * d);
    }
    default: return 0;
  }
}

const overlapLen = (a: [number, number], b: [number, number]): number => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

function teamMetrics(team: 'A' | 'B', own: Point[], enemy: Point[], obstacles: Obstacle[]): TeamMetrics {
  const emitter = own[0];
  const combatEnemies = enemy.slice(1); // 对方第 1 点是对方 Emitter，不是战斗点
  const clearances = own.map((p) => Math.min(...obstacles.map((o) => distanceToObstacle(p, o))));
  const enemies = combatEnemies.map((p, i) => ({ id: `${team === 'A' ? 'B' : 'A'}${i + 2}`, position: p }));
  let los = 0;
  for (const e of enemies) {
    const ast = lineThrough(emitter.x, emitter.y, e.position.x, e.position.y);
    const outcome = judgeShot(ast, emitter, team, enemies, obstacles);
    if (outcome.hits.includes(e.id)) los++;
  }
  const dists = combatEnemies.map((p) => Math.hypot(p.x - emitter.x, p.y - emitter.y));
  const zone: [number, number] = team === 'A' ? FIELD.teamAXRange : FIELD.teamBXRange;
  let overlap = 0;
  let zoneArea = 0;
  for (const o of obstacles) {
    overlap += overlapLen(xExtent(o), zone);
    // A 区 = x < −4 的部分；B 区 = x > 4 的部分（两式互为镜像，见 areaRightOf）
    zoneArea += team === 'A' ? areaLeftOf(o, zone[1]) : areaRightOf(o, zone[0]);
  }
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    meanAbsX: avg(own.map((p) => Math.abs(p.x))),
    meanY: avg(own.map((p) => p.y)),
    meanAbsY: avg(own.map((p) => Math.abs(p.y))),
    minClearance: Math.min(...clearances),
    meanClearance: avg(clearances),
    emitterClearance: clearances[0],
    emitterAbsX: Math.abs(emitter.x),
    losCount: los,
    nearestEnemyDist: Math.min(...dists),
    meanEnemyDist: avg(dists),
    zoneObstacleOverlapX: overlap,
    zoneObstacleArea: zoneArea,
  };
}

function mapMetrics(map: GeneratedMap): MapMetrics {
  const obs: ObstacleMetrics = { centroidLeft: 0, centroidRight: 0, centroidZero: 0, areaLeft: 0, areaRight: 0 };
  for (const o of map.obstacles) {
    const cx = centroidX(o);
    if (cx < 0) obs.centroidLeft++;
    else if (cx > 0) obs.centroidRight++;
    else obs.centroidZero++;
    obs.areaLeft += areaLeftOf(o, 0);
    obs.areaRight += areaRightOf(o, 0);
  }
  return {
    A: teamMetrics('A', map.teamA, map.teamB, map.obstacles),
    B: teamMetrics('B', map.teamB, map.teamA, map.obstacles),
    obstacles: obs,
  };
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

type Verdict = 'CONFIRMED' | 'DETECTABLE_NEGLIGIBLE' | 'NOT_DETECTED';

interface MetricReport extends PairedSummary {
  metric: string;
  /** KS：generator(seed) 的 A 侧 vs mirror(generator(seed)) 的 A 侧 */
  ksD: number;
  ksP: number;
  verdict: Verdict;
}

class Collector {
  readonly a = new Map<string, number[]>();
  readonly b = new Map<string, number[]>();
  readonly mirrorA = new Map<string, number[]>();
  constructor() {
    for (const k of TEAM_METRIC_KEYS) {
      this.a.set(k, []);
      this.b.set(k, []);
      this.mirrorA.set(k, []);
    }
    for (const k of ['obstacleArea', 'obstacleCentroidCount']) {
      this.a.set(k, []);
      this.b.set(k, []);
      this.mirrorA.set(k, []);
    }
  }
  add(m: MapMetrics, mm: MapMetrics): void {
    for (const k of TEAM_METRIC_KEYS) {
      this.a.get(k)!.push(m.A[k]);
      this.b.get(k)!.push(m.B[k]);
      this.mirrorA.get(k)!.push(mm.A[k]);
    }
    // 障碍物层面的「A 侧 = 左半场」
    this.a.get('obstacleArea')!.push(m.obstacles.areaLeft);
    this.b.get('obstacleArea')!.push(m.obstacles.areaRight);
    this.mirrorA.get('obstacleArea')!.push(mm.obstacles.areaLeft);
    this.a.get('obstacleCentroidCount')!.push(m.obstacles.centroidLeft);
    this.b.get('obstacleCentroidCount')!.push(m.obstacles.centroidRight);
    this.mirrorA.get('obstacleCentroidCount')!.push(mm.obstacles.centroidLeft);
  }
  get n(): number {
    return this.a.get('meanAbsX')!.length;
  }
  report(alpha: number, effectMin: number): MetricReport[] {
    const out: MetricReport[] = [];
    for (const [metric, xs] of this.a) {
      const ys = this.b.get(metric)!;
      const ps = pairedSummary(xs, ys);
      const ks = ksTwoSample(xs, this.mirrorA.get(metric)!);
      const verdict: Verdict =
        ps.pWilcoxon < alpha ? (Math.abs(ps.dz) >= effectMin ? 'CONFIRMED' : 'DETECTABLE_NEGLIGIBLE') : 'NOT_DETECTED';
      out.push({ metric, ...ps, ksD: ks.d, ksP: ks.p, verdict });
    }
    return out;
  }
}

function printTable(title: string, rows: MetricReport[]): void {
  console.log(`\n${title}  (n=${rows[0]?.n ?? 0})`);
  const head = ['metric', 'meanA', 'meanB', 'A−B', 'rel', 'd_z', 'p_t', 'p_sign', 'p_W', '+/−/0', 'KS D', 'KS p', 'verdict'];
  console.log(head.map((h, i) => h.padEnd(i === 0 ? 22 : 10)).join(' '));
  for (const r of rows) {
    console.log(
      [
        r.metric.padEnd(22),
        fmt(r.meanA).padEnd(10),
        fmt(r.meanB).padEnd(10),
        fmt(r.meanDiff, 5).padEnd(10),
        (Number.isFinite(r.relDiff) ? (r.relDiff * 100).toFixed(3) + '%' : 'NaN').padEnd(10),
        fmt(r.dz).padEnd(10),
        fmtP(r.pT).padEnd(10),
        fmtP(r.pSign).padEnd(10),
        fmtP(r.pWilcoxon).padEnd(10),
        `${r.nPos}/${r.nNeg}/${r.nZero}`.padEnd(10),
        fmt(r.ksD).padEnd(10),
        fmtP(r.ksP).padEnd(10),
        r.verdict,
      ].join(' ')
    );
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const pooled = new Collector();
  const byDifficulty = new Map<Difficulty, Collector>(DIFFICULTIES.map((d) => [d, new Collector()]));
  const byCell = new Map<string, Collector>();
  let requested = 0;
  let nulls = 0;
  let fallbacks = 0;
  let maxShift = 0;
  const shiftHistogram: Record<string, number> = {};
  let duplicates = 0;
  let identityMismatches = 0;
  const identityExamples: string[] = [];
  const seen = new Set<string>();

  let cellIndex = 0;
  for (const difficulty of DIFFICULTIES) {
    for (const pointCount of POINTS) {
      const cellKey = `${difficulty}/${pointCount}p`;
      const cell = new Collector();
      byCell.set(cellKey, cell);
      for (let i = 0; i < opts.seeds; i++) {
        const seed = opts.start + cellIndex * 1_000_003 + i * opts.stride;
        requested++;
        const map = generateMapOrNull({ seed, pointCount, difficulty });
        if (!map) {
          nulls++;
          continue;
        }
        if (map.seed !== seed) {
          fallbacks++;
          const shift = map.seed - seed;
          maxShift = Math.max(maxShift, shift);
          const bucket = shift <= 1 ? '1' : shift <= 4 ? '2-4' : shift <= 16 ? '5-16' : shift <= 64 ? '17-64' : '>64';
          shiftHistogram[bucket] = (shiftHistogram[bucket] ?? 0) + 1;
        }
        // 回退会让相邻请求落到同一张图；成对统计不能重复计同一张图
        const key = `${cellKey}/${map.seed}`;
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);

        const m = mapMetrics(map);
        const mm = mapMetrics(M.mirrorMap(map));
        for (const k of TEAM_METRIC_KEYS) {
          if (mm.A[k] !== m.B[k] || mm.B[k] !== m.A[k]) {
            identityMismatches++;
            if (identityExamples.length < 5) identityExamples.push(`${cellKey} seed=${map.seed} ${k}: mirror.A=${mm.A[k]} orig.B=${m.B[k]} mirror.B=${mm.B[k]} orig.A=${m.A[k]}`);
          }
        }
        if (mm.obstacles.areaLeft !== m.obstacles.areaRight || mm.obstacles.centroidLeft !== m.obstacles.centroidRight) {
          identityMismatches++;
          if (identityExamples.length < 5) identityExamples.push(`${cellKey} seed=${map.seed} obstacles: ${JSON.stringify(mm.obstacles)} vs ${JSON.stringify(m.obstacles)}`);
        }
        pooled.add(m, mm);
        byDifficulty.get(difficulty)!.add(m, mm);
        cell.add(m, mm);
        if (pooled.n % 1000 === 0) console.log(`  … ${pooled.n} 张地图（${cellKey}），${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      cellIndex++;
    }
  }

  const nMetrics = pooled.a.size;
  const alpha = 0.001 / nMetrics;
  const effectMin = 0.05;
  const pooledRows = pooled.report(alpha, effectMin);
  printTable('POOLED  (A 侧 vs B 侧，配对；KS = generator vs mirror(generator) 的 A 侧分布)', pooledRows);
  const perDifficulty: Record<string, MetricReport[]> = {};
  for (const [d, c] of byDifficulty) {
    perDifficulty[d] = c.report(alpha, effectMin);
    printTable(`difficulty=${d}`, perDifficulty[d]);
  }
  const perCell: Record<string, MetricReport[]> = {};
  for (const [k, c] of byCell) perCell[k] = c.report(alpha, effectMin);

  // 最小可检出效应（双侧 α，功效 80%）：d_z ≈ (z_{1−α/2} + z_{0.8}) / √n
  const zAlpha = invNormal(1 - alpha / 2);
  const mde = (zAlpha + 0.8416) / Math.sqrt(pooled.n);

  const confirmed = pooledRows.filter((r) => r.verdict === 'CONFIRMED').map((r) => r.metric);
  const negligible = pooledRows.filter((r) => r.verdict === 'DETECTABLE_NEGLIGIBLE').map((r) => r.metric);
  const verdict =
    pooled.n < 1000 ? 'UNRESOLVED' : confirmed.length > 0 ? 'CONFIRMED' : 'DISPROVEN';

  const result = {
    generatedAt: new Date().toISOString(),
    durationSec: (Date.now() - t0) / 1000,
    config: { seedsPerCell: opts.seeds, start: opts.start, stride: opts.stride, difficulties: DIFFICULTIES, points: POINTS },
    requested,
    maps: pooled.n,
    nulls,
    fallbacks: { count: fallbacks, rate: fallbacks / requested, maxShift, histogram: shiftHistogram },
    duplicatesSkipped: duplicates,
    mirrorIdentity: { mismatches: identityMismatches, examples: identityExamples },
    decisionRule: { alphaBonferroni: alpha, effectMin, nMetrics, mdeDz80Power: mde },
    verdict,
    confirmedMetrics: confirmed,
    detectableNegligibleMetrics: negligible,
    pooled: pooledRows,
    byDifficulty: perDifficulty,
    byCell: perCell,
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(result, null, 2));

  console.log(`\n地图 ${pooled.n}（请求 ${requested}，null ${nulls}，种子回退 ${fallbacks} 次 = ${(100 * fallbacks / requested).toFixed(2)}%，最大回退 ${maxShift}，重复跳过 ${duplicates}）`);
  console.log(`镜像恒等检查（metrics(mirror(map)).A === metrics(map).B 逐位）：不匹配 ${identityMismatches}`);
  for (const e of identityExamples) console.log(`    ${e}`);
  console.log(`判定规则：Wilcoxon p < ${alpha.toExponential(2)}（=0.001/${nMetrics}）且 |d_z| ≥ ${effectMin}；本样本量 MDE(d_z, 80% 功效) ≈ ${mde.toFixed(4)}`);
  console.log(`MAP DISTRIBUTION BIAS: ${verdict}${confirmed.length ? ' —— ' + confirmed.join(', ') : ''}${negligible.length ? ' （可测到但可忽略: ' + negligible.join(', ') + '）' : ''}`);
  console.log(`结果：${opts.out}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}

/** 标准正态分位数（Acklam 有理近似，|误差| < 1.2e-9） */
function invNormal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// normalCdf 只在自检里用：invNormal 与 normalCdf 互为反函数
if (Math.abs(normalCdf(invNormal(0.975)) - 0.975) > 1e-6) throw new Error('invNormal/normalCdf 自检失败');

main();
