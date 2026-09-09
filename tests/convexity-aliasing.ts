/**
 * convexity-aliasing —— 抗混叠凸性计数
 *
 * 覆盖 Finding: P1-5（sin(125.66x) 在 h=0.05 下混叠 → 凸性计数 0）、
 *              P1-1（C²）、P1-2（凸性 ≤100）、P1-3（NaN/Inf）、P1-4（跳变）
 */

import { CanonicalNode, parseCanonicalDSL } from '../src/core/Ast';
import {
  countConvexityChanges,
  sampleStepFor,
  validateAttackFunction,
} from '../src/core/Validator';
import { assert, assertClose, runAll, test } from './harness';

const num = (v: number) => ({ type: 'number', value: v });
const x = () => ({ type: 'variable', value: 'x' });
const mul = (a: any, b: any) => ({ type: 'mul', args: [a, b] });
const add = (a: any, b: any) => ({ type: 'add', args: [a, b] });
const sin = (a: any) => ({ type: 'sin', args: [a] });
const pow = (a: any, b: any) => ({ type: 'pow', args: [a, b] });

function ast(node: unknown): CanonicalNode {
  const r = parseCanonicalDSL(node);
  assert(r.ok && r.ast, `AST 应合法: ${r.issues.map((i) => i.message).join('; ')}`);
  return r.ast!;
}

test('convexity-aliasing: 采样步长随频率上界自适应', () => {
  const slow = sampleStepFor(ast(add(sin(x()), num(0))), [0, 10]);
  const fast = sampleStepFor(ast(sin(mul(num(125.66), x()))), [0, 10]);
  assert(fast.h < slow.h, `高频函数步长应更小: fast=${fast.h} slow=${slow.h}`);
  assertClose(fast.h, Math.PI / (8 * 125.66), 1e-9, 'h 应为 π/(8ω)');
  assert(fast.omega > 100, `ω 应反映 125.66 的频率上界，实际 ${fast.omega}`);
});

test('convexity-aliasing: sin(125.66x) 必须被计出大量变号（旧实现为 0）', () => {
  const node = ast(sin(mul(num(125.66), x())));
  const { h } = sampleStepFor(node, [0, 10]);
  const { count } = countConvexityChanges(node, [0, 10], h);
  assert(count > 100, `混叠回归：凸性变化应为大量（>100），实际 ${count}`);
});

test('convexity-aliasing: 高频振荡函数被 validate 拒绝为 CONVEXITY_LIMIT', () => {
  const node = ast(add(num(0), sin(mul(num(125.66), x()))));
  const v = validateAttackFunction(node, [0, 10], { x: 0, y: 0 });
  assert(!v.valid, '高频振荡函数必须被拒绝');
  assert(
    v.issues.some((i) => i.code === 'CONVEXITY_LIMIT'),
    `应报 CONVEXITY_LIMIT，实际 ${v.issues.map((i) => i.code).join(',')}`
  );
  assert(v.metrics.convexityChanges > 100, '指标里应记录真实的凸性变化次数');
});

test('convexity-aliasing: 平滑函数不被误杀，且二阶导符号变化统计正确', () => {
  // 抛物线 y = x^2 在 [-5,5] 上恒凸 —— 0 次变号
  const parabola = ast(add(num(0), pow(x(), num(2))));
  const { h } = sampleStepFor(parabola, [-5, 5]);
  assertClose(countConvexityChanges(parabola, [-5, 5], h).count, 0, 0, '抛物线不应有凸性变号');

  // 三次函数 y = x^3 在 [-5,5] 上恰好变号一次
  const cubic = ast(add(num(0), pow(x(), num(3))));
  const c = countConvexityChanges(cubic, [-5, 5], sampleStepFor(cubic, [-5, 5]).h);
  assert(c.count >= 1 && c.count <= 3, `x^3 应变号 1 次左右，实际 ${c.count}`);
});

test('convexity-aliasing: 经过 Shooter 是硬性条件', () => {
  const off = ast(add(num(1), mul(num(0.5), x())));
  const v = validateAttackFunction(off, [0, 10], { x: 0, y: 0 });
  assert(!v.valid, '未经过 Shooter 的函数必须被拒绝');
  assert(v.issues.some((i) => i.code === 'NOT_THROUGH_SHOOTER'), '应报 NOT_THROUGH_SHOOTER');

  const through = ast(add(num(0), mul(num(0.5), x())));
  assert(validateAttackFunction(through, [0, 10], { x: 0, y: 0 }).valid, '经过 Shooter 的直线应通过');
});

test('convexity-aliasing: tan 的极点（跳变）被拒绝为 DISCONTINUOUS/NOT_C2', () => {
  // tan(x) 在 π/2 附近有极点；取区间跨越极点
  const node = ast(add(num(0), { type: 'tan', args: [x()] }));
  const v = validateAttackFunction(node, [1.4, 1.7], { x: 1.4, y: Math.tan(1.4) });
  assert(!v.valid, 'tan 极点区间必须被拒绝');
  const codes = v.issues.map((i) => i.code);
  assert(
    codes.some((c) => c === 'DISCONTINUOUS' || c === 'NOT_C2' || c === 'NOT_FINITE' || c === 'DOMAIN_ERROR'),
    `应因跳变/非有限被拒绝，实际 ${codes.join(',')}`
  );
});

test('convexity-aliasing: NaN / Infinity 被拒绝', () => {
  // 1/0 在 x=0 处发散
  const node = ast({ type: 'div', args: [num(1), x()] });
  const v = validateAttackFunction(node, [-1, 1], { x: 1, y: 1 });
  assert(!v.valid, '在 0 处发散的函数必须被拒绝');
  assert(v.issues.some((i) => i.code === 'NOT_FINITE' || i.code === 'DOMAIN_ERROR'), '应报 NOT_FINITE/DOMAIN_ERROR');

  // log 的定义域
  const logNode = ast({ type: 'log', args: [x()] });
  const lv = validateAttackFunction(logNode, [-2, 2], { x: 1, y: 0 });
  assert(!lv.valid, 'log 在负半轴无定义，必须被拒绝');
});

test('convexity-aliasing: 合法的平滑曲线通过完整校验', () => {
  const node = ast(add(num(2), add(mul(num(0.3), x()), mul(num(0.1), sin(x())))));
  const v = validateAttackFunction(node, [-10, 10], { x: 0, y: 2 });
  assert(v.valid, `合法曲线应通过: ${v.issues.map((i) => i.message).join('; ')}`);
  assert(v.metrics.sampleCount > 0, '应记录采样点数');
  assertClose(v.metrics.shooterResidual, 0, 1e-9, '射手残差应接近 0');
});

void runAll('convexity-aliasing');
