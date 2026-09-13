/**
 * stats —— V1.4 公平性实验共用的统计原语（纯函数，无依赖）
 *
 * 为什么自己写而不引库：仓库刻意零运行时依赖（tests/harness.ts 同理）；这里需要的
 * 都是教科书公式，且样本量在 10^2–10^4 量级，对数域的精确二项式足够、不需要近似库。
 *
 * 约定：所有 p 值都是**双侧**。二项检验用「双倍单侧尾」（保守，不依赖近似）；
 * Wilcoxon / KS 用大样本正态 / 渐近公式（n ≥ 30 时误差可忽略，n 更小时调用方自行标注）。
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 样本标准差（n−1） */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** 分位数（线性插值，输入不必有序） */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]): number => quantile(xs, 0.5);

/** 标准正态分布函数 Φ(z)，erfc 的 Chebyshev 近似（|误差| < 1.2e-7，Numerical Recipes erfcc） */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  const upper = 0.5 * erfc; // P(Z > |z|)
  return z >= 0 ? 1 - upper : upper;
}

/** 双侧正态 p 值 */
export function twoSidedNormalP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

function logChoose(n: number, k: number): number {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** Lanczos 近似的 ln Γ(x)，相对误差 ~1e-15 */
function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 二项 pmf，对数域计算 */
export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X ≤ k) */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
  return Math.min(1, s);
}

/**
 * 精确二项检验（双侧 = 2 × 较小的单侧尾，上限 1）。
 * 与 R 的 binom.test 在 p0 = 0.5 时一致（对称分布下双倍单侧尾 = 最小似然法）。
 */
export function binomTestTwoSided(k: number, n: number, p0 = 0.5): number {
  if (n === 0) return 1;
  const lower = binomCdf(k, n, p0);
  const upper = 1 - binomCdf(k - 1, n, p0);
  return Math.min(1, 2 * Math.min(lower, upper));
}

/** Clopper–Pearson 精确置信区间（默认 95%），对 p 二分求解二项 CDF */
export function clopperPearson(k: number, n: number, conf = 0.95): [number, number] {
  if (n === 0) return [0, 1];
  const alpha = 1 - conf;
  const solve = (target: (p: number) => number): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (target(mid) > 0) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  // 下界：P(X ≥ k | p) = α/2 ；上界：P(X ≤ k | p) = α/2
  const lower = k === 0 ? 0 : solve((p) => 1 - binomCdf(k - 1, n, p) - alpha / 2);
  const upper = k === n ? 1 : solve((p) => alpha / 2 - binomCdf(k, n, p));
  return [lower, upper];
}

export interface BinomialSummary {
  k: number;
  n: number;
  rate: number;
  ci95: [number, number];
  /** 双侧精确 p，H0: rate = 0.5 */
  pVsHalf: number;
}

export function binomialSummary(k: number, n: number): BinomialSummary {
  return { k, n, rate: n > 0 ? k / n : NaN, ci95: clopperPearson(k, n), pVsHalf: binomTestTwoSided(k, n, 0.5) };
}

export interface PairedSummary {
  n: number;
  meanA: number;
  meanB: number;
  meanDiff: number;
  sdDiff: number;
  /** 均值差的标准误 */
  se: number;
  /** 配对 t（正态近似 p，n ≥ 30） */
  t: number;
  pT: number;
  /** 符号检验：正 / 负 / 零 的个数与精确二项 p */
  nPos: number;
  nNeg: number;
  nZero: number;
  pSign: number;
  /** Wilcoxon 符号秩（正态近似，含结的方差修正与连续性修正） */
  wilcoxonZ: number;
  pWilcoxon: number;
  /** Cohen's d_z = meanDiff / sdDiff（配对效应量） */
  dz: number;
  /** 相对差：meanDiff / mean((A+B)/2)，分母为 0 时 NaN */
  relDiff: number;
}

/**
 * 配对比较 A_i vs B_i（d_i = A_i − B_i）。
 * 三个检验回答同一个问题但对分布形状的假设不同；效应量 d_z 决定「显著」是否「重要」。
 */
export function pairedSummary(a: readonly number[], b: readonly number[]): PairedSummary {
  if (a.length !== b.length) throw new Error(`pairedSummary: 长度不等 ${a.length} vs ${b.length}`);
  const n = a.length;
  const d = a.map((x, i) => x - b[i]);
  const md = mean(d);
  const sdd = sd(d);
  const se = sdd / Math.sqrt(n);
  const t = se > 0 ? md / se : md === 0 ? 0 : Infinity;
  let nPos = 0;
  let nNeg = 0;
  let nZero = 0;
  for (const x of d) {
    if (x > 0) nPos++;
    else if (x < 0) nNeg++;
    else nZero++;
  }
  const pSign = binomTestTwoSided(nPos, nPos + nNeg, 0.5);
  const w = wilcoxonSignedRank(d);
  // 有符号指标（如 mean y）的配对均值本身趟在 0 附近，相对差没有意义：分母小于差的标准差时给 NaN
  const mid = mean(a.map((x, i) => (x + b[i]) / 2));
  const relOk = Math.abs(mid) > sdd;
  return {
    n,
    meanA: mean(a),
    meanB: mean(b),
    meanDiff: md,
    sdDiff: sdd,
    se,
    t,
    pT: Number.isFinite(t) ? twoSidedNormalP(t) : 0,
    nPos,
    nNeg,
    nZero,
    pSign,
    wilcoxonZ: w.z,
    pWilcoxon: w.p,
    dz: sdd > 0 ? md / sdd : md === 0 ? 0 : Infinity,
    relDiff: relOk ? md / mid : NaN,
  };
}

/** Wilcoxon 符号秩：零差剔除，|d| 同值取平均秩，方差按结修正，连续性修正 0.5 */
export function wilcoxonSignedRank(d: readonly number[]): { z: number; p: number; wPlus: number; n: number } {
  const nz = d.filter((x) => x !== 0);
  const n = nz.length;
  if (n === 0) return { z: 0, p: 1, wPlus: 0, n: 0 };
  const idx = nz.map((x, i) => ({ abs: Math.abs(x), sign: Math.sign(x), i })).sort((p, q) => p.abs - q.abs);
  const ranks = new Array<number>(n);
  let tieCorrection = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && idx[j + 1].abs === idx[i].abs) j++;
    const avg = (i + j + 2) / 2; // 1-based 平均秩
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    const t = j - i + 1;
    if (t > 1) tieCorrection += t * t * t - t;
    i = j + 1;
  }
  let wPlus = 0;
  for (let i = 0; i < n; i++) if (nz[i] > 0) wPlus += ranks[i];
  const mu = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  if (variance <= 0) return { z: 0, p: 1, wPlus, n };
  const diff = wPlus - mu;
  const z = (diff - Math.sign(diff) * 0.5) / Math.sqrt(variance);
  return { z, p: twoSidedNormalP(z), wPlus, n };
}

/** 两样本 Kolmogorov–Smirnov：D 与渐近双侧 p（Stephens 修正的 Kolmogorov 分布） */
export function ksTwoSample(a: readonly number[], b: readonly number[]): { d: number; p: number; n1: number; n2: number } {
  const s1 = [...a].sort((x, y) => x - y);
  const s2 = [...b].sort((x, y) => x - y);
  const n1 = s1.length;
  const n2 = s2.length;
  if (n1 === 0 || n2 === 0) return { d: NaN, p: NaN, n1, n2 };
  let i = 0;
  let j = 0;
  let dmax = 0;
  while (i < n1 && j < n2) {
    const x = Math.min(s1[i], s2[j]);
    while (i < n1 && s1[i] <= x) i++;
    while (j < n2 && s2[j] <= x) j++;
    dmax = Math.max(dmax, Math.abs(i / n1 - j / n2));
  }
  const ne = Math.sqrt((n1 * n2) / (n1 + n2));
  const lambda = (ne + 0.12 + 0.11 / ne) * dmax;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    const term = 2 * (k % 2 === 1 ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
    p += term;
    if (Math.abs(term) < 1e-12) break;
  }
  return { d: dmax, p: Math.max(0, Math.min(1, p)), n1, n2 };
}

/** 把 p 值排版成可读字符串（极小值给量级，不给 0） */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return 'NaN';
  if (p < 1e-12) return '<1e-12';
  if (p < 1e-4) return p.toExponential(1);
  return p.toFixed(4);
}

export function fmt(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(digits);
}
