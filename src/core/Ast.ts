/**
 * Canonical AST — 唯一事实来源 (Single Source of Truth)
 *
 * Plan V1 §11-§14:
 *   - 攻击只能对应一个统一函数 y = f(x)
 *   - 禁止 Piecewise / if / switch / ?:
 *   - 禁止 min, max, floor, ceil, round, sign, abs, step, Heaviside
 *     （这些可以等价实现分段行为）
 *
 * 所有下游消费者（Judge / Validator / Visualizer / Replay）必须使用本模块，
 * 不允许存在第二套数学解释实现。
 */

import * as crypto from 'crypto';

// ============================================================================
// 规范节点类型（白名单）
// ============================================================================

export type CanonicalNodeType =
  | 'number'
  | 'variable'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'pow'
  | 'neg'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'sqrt'
  | 'log'
  | 'exp';

/** Plan V1 §13 明确禁止的构造（用于给出精确错误信息） */
export const FORBIDDEN_NODE_TYPES = [
  'if', 'else', 'switch', 'condition', 'ternary',
  'min', 'max', 'abs', 'floor', 'ceil', 'round', 'sign', 'step', 'heaviside',
  'lt', 'gt', 'lte', 'gte', 'eq', 'neq', 'and', 'or', 'not',
] as const;

const BINARY_OPS: ReadonlySet<string> = new Set(['add', 'sub', 'mul', 'div', 'pow']);
const UNARY_OPS: ReadonlySet<string> = new Set(['neg', 'sin', 'cos', 'tan', 'sqrt', 'log', 'exp']);

export const CANONICAL_OPS: ReadonlySet<string> = new Set([
  'number', 'variable', ...BINARY_OPS, ...UNARY_OPS,
]);

// ============================================================================
// 规范节点
// ============================================================================

export interface CanonicalNode {
  type: CanonicalNodeType;
  /** 仅 number 节点使用 */
  value?: number;
  /** 运算符参数；number/variable 无 args */
  args?: CanonicalNode[];
}

export type ErrorCode =
  | 'PARSE_ERROR'
  | 'NOT_AN_OBJECT'
  | 'UNSUPPORTED_OPERATOR'
  | 'FORBIDDEN_OPERATOR'
  | 'BAD_ARITY'
  | 'BAD_VALUE'
  | 'CONST_TOO_LARGE'
  | 'NODE_LIMIT'
  | 'DEPTH_LIMIT'
  | 'DOMAIN_ERROR'
  | 'NOT_FINITE'
  | 'DISCONTINUOUS'
  | 'NOT_C2'
  | 'CONVEXITY_LIMIT'
  | 'OSCILLATION_LIMIT'
  | 'NOT_THROUGH_SHOOTER'
  | 'EMPTY_DOMAIN'
  | 'OUTPUT_TOO_LARGE';

export interface AstIssue {
  code: ErrorCode;
  message: string;
  /** 出现问题的 x（若适用） */
  at?: number;
}

export interface ParseResult {
  ok: boolean;
  ast: CanonicalNode | null;
  issues: AstIssue[];
}

// ============================================================================
// 限制（Plan V1 §12/§15 + README）
// ============================================================================

export const LIMITS = {
  MAX_NODES: 128,
  MAX_DEPTH: 12,
  MAX_CONST_ABS: 1000,
  MAX_CONVEXITY_CHANGES: 100,
  /** 采样预算上限，防止病态函数耗尽 CPU */
  MAX_SAMPLES: 400_000,
  /** |f| 超过此值视为数值爆炸 */
  MAX_ABS_VALUE: 1e6,
} as const;

// ============================================================================
// 解析（严格）
// ============================================================================

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readType(node: Record<string, unknown>): string | null {
  // 规范键为 `type`；同时接受 Plan V1 §11 示例中的 `op` 作为别名。
  const t = node.type ?? node.op;
  return typeof t === 'string' ? t : null;
}

function parseNode(raw: unknown, issues: AstIssue[], depth: number): CanonicalNode | null {
  // 深度守卫必须发生在递归**之前**（P0-A / Re-Gate Cycle 1）。
  //
  // 原实现把 MAX_DEPTH 检查放在 analyzeComplexity(ast) 之后 —— 那时递归下降
  // 已经把整棵树建好，一个 6000 层的 `neg` 链（约 120 KB，远低于 stdout 上限）
  // 会先把 V8 调用栈打爆，抛出的 RangeError 逃出 parseCanonicalDSL，
  // 让整个操作台进程崩溃、整场比赛无法完成、产物为零。
  // 在这里提前拒绝，递归深度被硬性限制在 MAX_DEPTH+1 帧以内。
  if (depth > LIMITS.MAX_DEPTH) {
    issues.push({
      code: 'DEPTH_LIMIT',
      message: `AST 深度超过限制 ${LIMITS.MAX_DEPTH}（在第 ${depth} 层拒绝，未展开）`,
    });
    return null;
  }

  if (!isPlainObject(raw)) {
    issues.push({ code: 'NOT_AN_OBJECT', message: 'AST 节点必须是对象' });
    return null;
  }

  const type = readType(raw);
  if (!type) {
    issues.push({ code: 'NOT_AN_OBJECT', message: 'AST 节点缺少 type 字段' });
    return null;
  }

  if ((FORBIDDEN_NODE_TYPES as readonly string[]).includes(type)) {
    issues.push({
      code: 'FORBIDDEN_OPERATOR',
      message: `运算符 "${type}" 被 Plan V1 §13 禁止（可用于构造分段行为）`,
    });
    return null;
  }

  if (!CANONICAL_OPS.has(type)) {
    issues.push({ code: 'UNSUPPORTED_OPERATOR', message: `不支持的运算符: ${type}` });
    return null;
  }

  if (type === 'number') {
    const v = raw.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ code: 'BAD_VALUE', message: 'number 节点的 value 必须是有限数值' });
      return null;
    }
    if (Math.abs(v) > LIMITS.MAX_CONST_ABS) {
      issues.push({
        code: 'CONST_TOO_LARGE',
        message: `常数 ${v} 绝对值超过限制 ${LIMITS.MAX_CONST_ABS}`,
      });
      return null;
    }
    return { type: 'number', value: v };
  }

  if (type === 'variable') {
    // V1.1 Competitor Kit §7：value 必须**显式**给出且必须为 "x"。
    // 旧实现把缺失的 value 静默当成 x（连 {"name":"y"} 也会被当成 x），
    // 属于静默歧义 —— 冻结格式要求任何偏差都必须显式 INVALID。
    const v = raw.value;
    if (v === undefined) {
      issues.push({
        code: 'BAD_VALUE',
        message: 'variable 节点必须显式给出 value: "x"（缺失 value 或使用其它键名一律非法）',
      });
      return null;
    }
    if (v !== 'x') {
      issues.push({ code: 'BAD_VALUE', message: `variable 节点只支持变量 "x"，收到 ${JSON.stringify(v)}` });
      return null;
    }
    return { type: 'variable' };
  }

  const args = raw.args;
  const expected = BINARY_OPS.has(type) ? 2 : 1;
  if (!Array.isArray(args) || args.length !== expected) {
    issues.push({
      code: 'BAD_ARITY',
      message: `${type} 需要 ${expected} 个参数，收到 ${Array.isArray(args) ? args.length : '非数组'}`,
    });
    return null;
  }

  const parsedArgs: CanonicalNode[] = [];
  for (const a of args) {
    const child = parseNode(a, issues, depth + 1);
    if (!child) return null;
    parsedArgs.push(child);
  }

  return { type: type as CanonicalNodeType, args: parsedArgs };
}

/**
 * 解析并结构校验 DSL。数值/连续/凸性校验见 Validator.ts。
 *
 * 本函数是「绝不抛出」的边界（P0-A）：调用方（Preflight / runRound /
 * onFirstResult / 回放）都不带 try/catch，任何逃逸的异常都会中止整场比赛
 * 并丢掉全部产物。因此这里把一切未预期异常收敛成 PARSE_ERROR。
 */
export function parseCanonicalDSL(input: string | unknown): ParseResult {
  try {
    return parseCanonicalDSLInner(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      ast: null,
      issues: [{ code: 'PARSE_ERROR', message: `AST 解析异常（已收敛，不中断比赛）: ${msg}` }],
    };
  }
}

function parseCanonicalDSLInner(input: string | unknown): ParseResult {
  const issues: AstIssue[] = [];
  let raw: unknown;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { ok: false, ast: null, issues: [{ code: 'PARSE_ERROR', message: 'DSL 为空' }] };
    }
    try {
      raw = JSON.parse(trimmed);
    } catch (e) {
      return {
        ok: false,
        ast: null,
        issues: [{ code: 'PARSE_ERROR', message: `DSL JSON 解析失败: ${(e as Error).message}` }],
      };
    }
  } else {
    raw = input;
  }

  const ast = parseNode(raw, issues, 1);
  if (!ast || issues.length > 0) {
    return { ok: false, ast: null, issues };
  }

  const complexity = analyzeComplexity(ast);
  if (complexity.nodeCount > LIMITS.MAX_NODES) {
    issues.push({
      code: 'NODE_LIMIT',
      message: `AST 节点数 ${complexity.nodeCount} 超过限制 ${LIMITS.MAX_NODES}`,
    });
  }
  if (complexity.depth > LIMITS.MAX_DEPTH) {
    issues.push({
      code: 'DEPTH_LIMIT',
      message: `AST 深度 ${complexity.depth} 超过限制 ${LIMITS.MAX_DEPTH}`,
    });
  }

  return { ok: issues.length === 0, ast: issues.length === 0 ? ast : null, issues };
}

// ============================================================================
// 复杂度
// ============================================================================

export function analyzeComplexity(node: CanonicalNode): { nodeCount: number; depth: number } {
  if (node.type === 'number' || node.type === 'variable') {
    return { nodeCount: 1, depth: 1 };
  }
  let nodeCount = 1;
  let depth = 0;
  for (const a of node.args!) {
    const c = analyzeComplexity(a);
    nodeCount += c.nodeCount;
    depth = Math.max(depth, c.depth);
  }
  return { nodeCount, depth: depth + 1 };
}

// ============================================================================
// 求值（唯一实现）
// ============================================================================

export function evaluateNode(node: CanonicalNode, x: number): number {
  switch (node.type) {
    case 'number':
      return node.value!;
    case 'variable':
      return x;
    case 'neg':
      return -evaluateNode(node.args![0], x);
    case 'sin':
      return Math.sin(evaluateNode(node.args![0], x));
    case 'cos':
      return Math.cos(evaluateNode(node.args![0], x));
    case 'tan':
      return Math.tan(evaluateNode(node.args![0], x));
    case 'sqrt':
      return Math.sqrt(evaluateNode(node.args![0], x));
    case 'log':
      return Math.log(evaluateNode(node.args![0], x));
    case 'exp':
      return Math.exp(evaluateNode(node.args![0], x));
    default: {
      const a = evaluateNode(node.args![0], x);
      const b = evaluateNode(node.args![1], x);
      switch (node.type) {
        case 'add': return a + b;
        case 'sub': return a - b;
        case 'mul': return a * b;
        case 'div': return a / b;
        case 'pow': return Math.pow(a, b);
        default: return NaN;
      }
    }
  }
}

/** 一阶导（中心差分） */
export function derivative1(node: CanonicalNode, x: number, h: number): number {
  return (evaluateNode(node, x + h) - evaluateNode(node, x - h)) / (2 * h);
}

/** 二阶导（中心差分） */
export function derivative2(node: CanonicalNode, x: number, h: number): number {
  return (evaluateNode(node, x + h) - 2 * evaluateNode(node, x) + evaluateNode(node, x - h)) / (h * h);
}

// ============================================================================
// 规范化序列化 / 哈希
// ============================================================================

/** 确定性 JSON（键顺序固定），用于哈希与回放 */
export function canonicalJson(node: CanonicalNode): string {
  if (node.type === 'number') return `{"type":"number","value":${numToCanonical(node.value!)}}`;
  if (node.type === 'variable') return `{"type":"variable"}`;
  return `{"type":"${node.type}","args":[${node.args!.map(canonicalJson).join(',')}]}`;
}

function numToCanonical(v: number): string {
  if (Object.is(v, -0)) return '0';
  return String(v);
}

export function hashNode(node: CanonicalNode): string {
  return crypto.createHash('sha256').update(canonicalJson(node)).digest('hex');
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ============================================================================
// 数学显示字符串
// ============================================================================

export function toMathString(node: CanonicalNode, parentPrec = 0): string {
  const wrap = (s: string, myPrec: number) => (myPrec < parentPrec ? `(${s})` : s);

  switch (node.type) {
    case 'number': return numToCanonical(node.value!);
    case 'variable': return 'x';
    case 'neg': return wrap(`-${toMathString(node.args![0], 3)}`, 3);
    case 'sin': return `sin(${toMathString(node.args![0], 0)})`;
    case 'cos': return `cos(${toMathString(node.args![0], 0)})`;
    case 'tan': return `tan(${toMathString(node.args![0], 0)})`;
    case 'sqrt': return `sqrt(${toMathString(node.args![0], 0)})`;
    case 'log': return `log(${toMathString(node.args![0], 0)})`;
    case 'exp': return `exp(${toMathString(node.args![0], 0)})`;
    case 'pow': return wrap(`pow(${toMathString(node.args![0], 0)}, ${toMathString(node.args![1], 0)})`, 4);
    case 'add': return wrap(`${toMathString(node.args![0], 1)} + ${toMathString(node.args![1], 2)}`, 1);
    case 'sub': return wrap(`${toMathString(node.args![0], 1)} - ${toMathString(node.args![1], 2)}`, 1);
    case 'mul': return wrap(`${toMathString(node.args![0], 2)} * ${toMathString(node.args![1], 3)}`, 2);
    case 'div': return wrap(`${toMathString(node.args![0], 2)} / ${toMathString(node.args![1], 3)}`, 2);
    default: return '?';
  }
}

// ============================================================================
// 区间算术 —— 用于推导导数上界（抗混叠）与定义域检查
// ============================================================================

export interface Interval {
  lo: number;
  hi: number;
}

const UNBOUNDED: Interval = { lo: -Infinity, hi: Infinity };

function iv(lo: number, hi: number): Interval {
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function addIv(a: Interval, b: Interval): Interval {
  return iv(a.lo + b.lo, a.hi + b.hi);
}

function subIv(a: Interval, b: Interval): Interval {
  return iv(a.lo - b.hi, a.hi - b.lo);
}

function mulIv(a: Interval, b: Interval): Interval {
  const c = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  if (c.some((v) => !Number.isFinite(v))) return UNBOUNDED;
  return iv(Math.min(...c), Math.max(...c));
}

function divIv(a: Interval, b: Interval): Interval {
  if (b.lo <= 0 && b.hi >= 0) return UNBOUNDED;
  const c = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
  if (c.some((v) => !Number.isFinite(v))) return UNBOUNDED;
  return iv(Math.min(...c), Math.max(...c));
}

function absMax(i: Interval): number {
  if (!Number.isFinite(i.lo) || !Number.isFinite(i.hi)) return Infinity;
  return Math.max(Math.abs(i.lo), Math.abs(i.hi));
}

/** 值区间 + 导数区间（导数区间为保守上界） */
export interface RangeInfo {
  value: Interval;
  deriv: Interval;
  /** 定义域问题（sqrt/log 负数、除零等） */
  domainIssue: string | null;
}

export function analyzeRange(node: CanonicalNode, domain: [number, number]): RangeInfo {
  switch (node.type) {
    case 'number': {
      // 常量必须返回自身的值区间，而不是 0 ——
      // 否则 mul/add 的区间算术会把所有常量当成 0，
      // 使 oscillationBound 恒为 0、抗混叠步长退化为固定 0.01（P1-5 根因残留）。
      const v = node.value ?? 0;
      return { value: iv(v, v), deriv: { lo: 0, hi: 0 }, domainIssue: null };
    }
    case 'variable':
      return { value: iv(domain[0], domain[1]), deriv: { lo: 1, hi: 1 }, domainIssue: null };
    default:
      break;
  }

  if (node.type === 'add' || node.type === 'sub') {
    const a = analyzeRange(node.args![0], domain);
    const b = analyzeRange(node.args![1], domain);
    return {
      value: node.type === 'add' ? addIv(a.value, b.value) : subIv(a.value, b.value),
      deriv: node.type === 'add' ? addIv(a.deriv, b.deriv) : subIv(a.deriv, b.deriv),
      domainIssue: a.domainIssue ?? b.domainIssue,
    };
  }

  if (node.type === 'mul') {
    const a = analyzeRange(node.args![0], domain);
    const b = analyzeRange(node.args![1], domain);
    // (a*b)' = a'*b + a*b'
    return {
      value: mulIv(a.value, b.value),
      deriv: addIv(mulIv(a.deriv, b.value), mulIv(a.value, b.deriv)),
      domainIssue: a.domainIssue ?? b.domainIssue,
    };
  }

  if (node.type === 'div') {
    const a = analyzeRange(node.args![0], domain);
    const b = analyzeRange(node.args![1], domain);
    const q = divIv(a.value, b.value);
    const bSq = mulIv(b.value, b.value);
    const num = subIv(mulIv(a.deriv, b.value), mulIv(a.value, b.deriv));
    const issue =
      a.domainIssue ??
      b.domainIssue ??
      (b.value.lo <= 0 && b.value.hi >= 0 ? `除数区间跨越 0（[${b.value.lo}, ${b.value.hi}]）` : null);
    return { value: q, deriv: divIv(num, bSq), domainIssue: issue };
  }

  if (node.type === 'neg') {
    const a = analyzeRange(node.args![0], domain);
    return { value: iv(-a.value.hi, -a.value.lo), deriv: iv(-a.deriv.hi, -a.deriv.lo), domainIssue: a.domainIssue };
  }

  if (node.type === 'sin' || node.type === 'cos') {
    const a = analyzeRange(node.args![0], domain);
    // |d/dx sin(g)| = |cos(g) * g'| <= |g'|
    const m = absMax(a.deriv);
    return {
      value: { lo: -1, hi: 1 },
      deriv: Number.isFinite(m) ? iv(-m, m) : UNBOUNDED,
      domainIssue: a.domainIssue,
    };
  }

  if (node.type === 'tan') {
    const a = analyzeRange(node.args![0], domain);
    // tan 在 arg 区间跨越 π/2 + kπ 时无界
    const span = a.value.hi - a.value.lo;
    const poles = Number.isFinite(span) && span < Math.PI * 1e5
      ? Math.abs(Math.floor((a.value.hi + Math.PI / 2) / Math.PI) - Math.floor((a.value.lo + Math.PI / 2) / Math.PI)) > 0
      : true;
    if (poles || !Number.isFinite(a.value.lo)) {
      return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: a.domainIssue ?? 'tan 参数区间包含极点' };
    }
    const lo = Math.tan(a.value.lo);
    const hi = Math.tan(a.value.hi);
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    const dMax = Number.isFinite(m) ? Math.min(m * m + 1, 1e12) : Infinity;
    return {
      value: iv(lo, hi),
      deriv: Number.isFinite(dMax) ? iv(-dMax, dMax) : UNBOUNDED,
      domainIssue: a.domainIssue,
    };
  }

  if (node.type === 'sqrt') {
    const a = analyzeRange(node.args![0], domain);
    if (a.value.lo < 0) {
      return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: `sqrt 参数区间含负值（[${a.value.lo}, ${a.value.hi}]）` };
    }
    const lo = Math.sqrt(a.value.lo);
    const hi = Math.sqrt(a.value.hi);
    // d/dx sqrt(g) = g' / (2 sqrt(g))，g→0 时无界
    const denom = 2 * lo;
    const m = absMax(a.deriv);
    const dMax = denom > 0 ? m / denom : Infinity;
    return {
      value: iv(lo, hi),
      deriv: Number.isFinite(dMax) ? iv(-dMax, dMax) : UNBOUNDED,
      domainIssue: a.domainIssue,
    };
  }

  if (node.type === 'log') {
    const a = analyzeRange(node.args![0], domain);
    if (a.value.lo <= 0) {
      return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: `log 参数区间含非正值（[${a.value.lo}, ${a.value.hi}]）` };
    }
    const lo = Math.log(a.value.lo);
    const hi = Math.log(a.value.hi);
    const m = absMax(a.deriv);
    const dMax = m / a.value.lo;
    return {
      value: iv(lo, hi),
      deriv: Number.isFinite(dMax) ? iv(-dMax, dMax) : UNBOUNDED,
      domainIssue: a.domainIssue,
    };
  }

  if (node.type === 'exp') {
    const a = analyzeRange(node.args![0], domain);
    if (a.value.hi > 700) {
      return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: 'exp 参数区间过大（数值溢出）' };
    }
    const lo = Math.exp(a.value.lo);
    const hi = Math.exp(a.value.hi);
    const m = absMax(a.deriv);
    const dMax = hi * m;
    return {
      value: iv(lo, hi),
      deriv: Number.isFinite(dMax) ? iv(-dMax, dMax) : UNBOUNDED,
      domainIssue: a.domainIssue,
    };
  }

  if (node.type === 'pow') {
    const base = node.args![0];
    const expNode = node.args![1];
    const a = analyzeRange(base, domain);
    if (expNode.type === 'number' && Number.isInteger(expNode.value)) {
      const n = expNode.value!;
      const b = analyzeRange(expNode, domain);
      if (n === 0) return { value: { lo: 1, hi: 1 }, deriv: { lo: 0, hi: 0 }, domainIssue: a.domainIssue };
      const pows = [Math.pow(a.value.lo, n), Math.pow(a.value.hi, n)];
      if (pows.some((v) => !Number.isFinite(v))) return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: a.domainIssue };
      const value = n % 2 === 0 ? iv(0, Math.max(...pows)) : iv(Math.min(...pows), Math.max(...pows));
      // d/dx g^n = n * g^(n-1) * g'
      const gm = absMax(a.value);
      const dMag = Math.abs(n) * Math.pow(Math.max(gm, 1e-12), n - 1) * absMax(a.deriv);
      return {
        value,
        deriv: Number.isFinite(dMag) ? iv(-dMag, dMag) : UNBOUNDED,
        domainIssue: a.domainIssue,
      };
    }
    // 非整数指数：保守视为无界
    const b = analyzeRange(expNode, domain);
    return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: a.domainIssue ?? b.domainIssue };
  }

  return { value: UNBOUNDED, deriv: UNBOUNDED, domainIssue: '未知节点类型' };
}

/**
 * 抗混叠频率上界：所有 sin/cos/tan 参数导数绝对上界之和。
 * 用于推导采样步长 h <= π / (8 * omega)。
 */
export function oscillationBound(node: CanonicalNode, domain: [number, number]): number {
  let total = 0;
  const walk = (n: CanonicalNode) => {
    if (n.type === 'sin' || n.type === 'cos' || n.type === 'tan') {
      const r = analyzeRange(n.args![0], domain);
      const m = absMax(r.deriv);
      total += Number.isFinite(m) ? m : Infinity;
    }
    if (n.args) n.args.forEach(walk);
  };
  walk(node);
  return total;
}

export function absBound(node: CanonicalNode, domain: [number, number]): number {
  return absMax(analyzeRange(node, domain).value);
}
