/**
 * Canonical Validator — 唯一函数合法性判定
 *
 * 修复的 Finding：
 *   P1-1  C² 连续性检查不存在
 *   P1-2  凸性 ≤100 未在提交路径上强制执行
 *   P1-3  NaN/Infinity 未被拒绝
 *   P1-4  连续性检查无法发现跳变
 *   P1-5  采样混叠使凸性归零（sin(125.66x) → 计数 0）
 *   P2-7  非法运算符未被拒绝
 *
 * 关键设计：采样步长由「抗混叠频率上界」推导，而不是拍脑袋的 0.05。
 */

import {
  AstIssue,
  CanonicalNode,
  LIMITS,
  analyzeComplexity,
  analyzeRange,
  evaluateNode,
  oscillationBound,
  derivative1,
  derivative2,
} from './Ast';
import { HIT_EPSILON } from './Rules';

export interface FunctionMetrics {
  nodeCount: number;
  depth: number;
  /** 抗混叠频率上界 ω */
  omega: number;
  /** 实际采样步长 */
  sampleStep: number;
  /** 实际采样点数 */
  sampleCount: number;
  /** 二阶导符号变化次数 */
  convexityChanges: number;
  /** 采样区间内 |f| 最大值 */
  maxAbsValue: number;
  /** 采样区间内 |f'| 最大值 */
  maxAbsSlope: number;
  /** 采样区间内 |f''| 最大值 */
  maxAbsCurvature: number;
  /** f(x_s) - y_s */
  shooterResidual: number;
}

export interface FunctionValidation {
  valid: boolean;
  issues: AstIssue[];
  metrics: FunctionMetrics;
}

const BASE_STEP = 0.01;
/** Nyquist 安全系数：每个最高频半周期至少 8 个采样点 */
const NYQUIST_DIVISOR = 8;
/** 跳变检测最大递归深度 */
const MAX_JUMP_DEPTH = 14;

function jumpTolerance(scale: number, h: number, order: 0 | 1 | 2): number {
  // 中心差分噪声 ~ eps_mach * scale / h^order；取 1e7 倍安全裕度
  return 1e-8 * scale / Math.pow(h, order);
}

/**
 * 递归跳变检测。
 *
 * 连续函数在区间二分时 |Δf| 会随之下降；真正的跳变在任意尺度上都保留同样幅度。
 */
export function detectJump(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
  depth = 0
): boolean {
  const fa = f(a);
  const fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return true;

  const delta = Math.abs(fb - fa);
  if (delta <= tol) return false;
  if (depth >= MAX_JUMP_DEPTH) return true;

  const m = (a + b) / 2;
  const fm = f(m);
  if (!Number.isFinite(fm)) return true;

  const dl = Math.abs(fm - fa);
  const dr = Math.abs(fb - fm);
  if (Math.max(dl, dr) > 0.9 * delta) {
    return detectJump(f, a, m, tol, depth + 1) || detectJump(f, m, b, tol, depth + 1);
  }
  return false;
}

/**
 * 采样步长：h = min(BASE_STEP, π / (8·ω))
 *
 * 这是 P1-5 的根治手段：sin(125.66x) 在旧实现里用 h=0.05 采样 800 点覆盖
 * 约 1600 个半周期，完全混叠 → 凸性计数 0。现在 ω=125.66 → h=0.003125。
 */
export function sampleStepFor(ast: CanonicalNode, domain: [number, number]): { h: number; omega: number; n: number } {
  const omega = oscillationBound(ast, domain);
  const h = Number.isFinite(omega) && omega > 0
    ? Math.min(BASE_STEP, Math.PI / (NYQUIST_DIVISOR * omega))
    : BASE_STEP;
  const span = domain[1] - domain[0];
  const n = Math.floor(span / h) + 1;
  return { h, omega, n };
}

/**
 * 凸性变化计数（抗混叠 + 噪声地板）。
 */
export function countConvexityChanges(
  ast: CanonicalNode,
  domain: [number, number],
  h: number
): { count: number; maxAbsCurvature: number } {
  const f = (x: number) => evaluateNode(ast, x);
  let prevSign = 0;
  let count = 0;
  let maxAbsCurvature = 0;

  for (let x = domain[0]; x <= domain[1] + 1e-12; x += h) {
    const f0 = f(x);
    const fm = f(x - h);
    const fp = f(x + h);
    if (!Number.isFinite(f0) || !Number.isFinite(fm) || !Number.isFinite(fp)) continue;

    const scale = Math.max(1, Math.abs(f0), Math.abs(fm), Math.abs(fp));
    const curvEps = 1e-8 * scale / (h * h);
    const d2 = (fp - 2 * f0 + fm) / (h * h);
    if (!Number.isFinite(d2)) continue;

    maxAbsCurvature = Math.max(maxAbsCurvature, Math.abs(d2));
    const sign = Math.abs(d2) <= curvEps ? 0 : d2 > 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== 0 && sign !== prevSign) count++;
    if (sign !== 0) prevSign = sign;
  }

  return { count, maxAbsCurvature };
}

/**
 * 对已结构合法的 AST 做完整数值校验。
 *
 * @param domain  有效攻击范围（A: [x_s, 20]，B: [-20, x_s]）
 * @param shooter 本轮发射点（必须位于轨迹上）
 */
export function validateAttackFunction(
  ast: CanonicalNode,
  domain: [number, number],
  shooter: { x: number; y: number },
  epsilon: number = HIT_EPSILON
): FunctionValidation {
  const issues: AstIssue[] = [];
  const complexity = analyzeComplexity(ast);

  const metrics: FunctionMetrics = {
    nodeCount: complexity.nodeCount,
    depth: complexity.depth,
    omega: 0,
    sampleStep: 0,
    sampleCount: 0,
    convexityChanges: 0,
    maxAbsValue: 0,
    maxAbsSlope: 0,
    maxAbsCurvature: 0,
    shooterResidual: NaN,
  };

  if (!(domain[1] > domain[0])) {
    issues.push({ code: 'EMPTY_DOMAIN', message: `有效攻击范围为空: [${domain[0]}, ${domain[1]}]` });
    return { valid: false, issues, metrics };
  }

  // ---- 1. 必须经过 Shooter（Plan V1 §20）----
  const yAtShooter = evaluateNode(ast, shooter.x);
  metrics.shooterResidual = yAtShooter - shooter.y;
  if (!Number.isFinite(yAtShooter)) {
    issues.push({
      code: 'NOT_FINITE',
      message: `f(x_s) 非有限值 (${yAtShooter}) at x=${shooter.x}`,
      at: shooter.x,
    });
  } else if (Math.abs(metrics.shooterResidual) > epsilon) {
    issues.push({
      code: 'NOT_THROUGH_SHOOTER',
      // 消息正文用现行术语 Emitter。错误**码**保留原样：它是对外可见的稳定标识，
      // 已被测试与 competitor-kit 文档引用，改名属于契约变更，不在这里顺手做。
      message: `f(${shooter.x}) = ${yAtShooter}，与 Emitter y = ${shooter.y} 相差 ${Math.abs(metrics.shooterResidual).toExponential(3)} > ε=${epsilon}`,
      at: shooter.x,
    });
  }

  // ---- 2. 定义域（区间算术）----
  const range = analyzeRange(ast, domain);
  if (range.domainIssue) {
    issues.push({ code: 'DOMAIN_ERROR', message: `定义域问题: ${range.domainIssue}` });
  }

  // ---- 3. 采样步长（抗混叠）----
  const { h, omega, n } = sampleStepFor(ast, domain);
  metrics.omega = omega;
  metrics.sampleStep = h;
  metrics.sampleCount = n;

  if (!Number.isFinite(omega)) {
    issues.push({ code: 'OSCILLATION_LIMIT', message: '函数振荡频率无界，无法可靠采样' });
    return { valid: false, issues, metrics };
  }
  if (n > LIMITS.MAX_SAMPLES) {
    issues.push({
      code: 'OSCILLATION_LIMIT',
      message: `抗混叠采样需要 ${n} 个点（预算 ${LIMITS.MAX_SAMPLES}），函数振荡过快`,
    });
    return { valid: false, issues, metrics };
  }

  // ---- 4. 有限性扫描 ----
  const f = (x: number) => evaluateNode(ast, x);
  for (let i = 0; i < n; i++) {
    const x = Math.min(domain[0] + i * h, domain[1]);
    const y = f(x);
    if (!Number.isFinite(y)) {
      issues.push({ code: 'NOT_FINITE', message: `x=${x.toFixed(6)} 处 f(x)=${y}`, at: x });
      return { valid: false, issues, metrics };
    }
    const ay = Math.abs(y);
    if (ay > metrics.maxAbsValue) metrics.maxAbsValue = ay;
    if (ay > LIMITS.MAX_ABS_VALUE) {
      issues.push({
        code: 'NOT_FINITE',
        message: `x=${x.toFixed(6)} 处 |f(x)|=${ay.toExponential(3)} 超过数值上限`,
        at: x,
      });
      return { valid: false, issues, metrics };
    }
  }

  const scale = Math.max(1, metrics.maxAbsValue);

  // ---- 5. 连续性 / C¹ / C² 跳变检测 ----
  const jumpTolF = jumpTolerance(scale, h, 0);
  const jumpTolD1 = jumpTolerance(scale, h, 1);
  const jumpTolD2 = jumpTolerance(scale, h, 2);
  const d1 = (x: number) => derivative1(ast, x, h);
  const d2 = (x: number) => derivative2(ast, x, h);

  // 网格上抽样检测（步长 8h），避免 O(n·2^depth)
  const stride = 8;
  for (let i = 0; i + stride < n; i += stride) {
    const a = Math.min(domain[0] + i * h, domain[1]);
    const b = Math.min(domain[0] + (i + stride) * h, domain[1]);
    if (b <= a) break;

    if (detectJump(f, a, b, jumpTolF)) {
      issues.push({
        code: 'DISCONTINUOUS',
        message: `函数在 x≈${a.toFixed(4)} 附近不连续`,
        at: a,
      });
      return { valid: false, issues, metrics };
    }
    if (detectJump(d1, a, b, jumpTolD1)) {
      issues.push({
        code: 'NOT_C2',
        message: `一阶导数在 x≈${a.toFixed(4)} 附近不连续（不满足 C¹）`,
        at: a,
      });
      return { valid: false, issues, metrics };
    }
    if (detectJump(d2, a, b, jumpTolD2)) {
      issues.push({
        code: 'NOT_C2',
        message: `二阶导数在 x≈${a.toFixed(4)} 附近不连续（不满足 C²）`,
        at: a,
      });
      return { valid: false, issues, metrics };
    }
  }

  // 斜率上界（用于异常陡峭判定）
  for (let i = 0; i < n; i += 4) {
    const x = Math.min(domain[0] + i * h, domain[1]);
    const s = Math.abs(d1(x));
    if (Number.isFinite(s)) metrics.maxAbsSlope = Math.max(metrics.maxAbsSlope, s);
  }
  if (metrics.maxAbsSlope > 1e10) {
    issues.push({
      code: 'NOT_C2',
      message: `一阶导数绝对值上界 ${metrics.maxAbsSlope.toExponential(3)} 过大`,
    });
    return { valid: false, issues, metrics };
  }

  // ---- 6. 凸性变化 ≤ 100 ----
  const convexity = countConvexityChanges(ast, domain, h);
  metrics.convexityChanges = convexity.count;
  metrics.maxAbsCurvature = convexity.maxAbsCurvature;

  if (convexity.count > LIMITS.MAX_CONVEXITY_CHANGES) {
    issues.push({
      code: 'CONVEXITY_LIMIT',
      message: `凸性变化次数 ${convexity.count} 超过限制 ${LIMITS.MAX_CONVEXITY_CHANGES}`,
    });
    return { valid: false, issues, metrics };
  }

  return { valid: issues.length === 0, issues, metrics };
}
