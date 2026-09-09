/**
 * dsl-contract —— 官方 DSL 契约（Plan V1 §11 / §13）
 *
 * 覆盖 Finding: P0-3（契约不一致）、P1-6（非法运算符）、P2-7、P2-21
 */

import {
  CANONICAL_OPS,
  FORBIDDEN_NODE_TYPES,
  LIMITS,
  analyzeComplexity,
  canonicalJson,
  evaluateNode,
  parseCanonicalDSL,
  toMathString,
} from '../src/core/Ast';
import { assert, assertClose, assertEqual, runAll, test } from './harness';

const num = (v: number) => ({ type: 'number', value: v });
const x = () => ({ type: 'variable', value: 'x' });

test('dsl-contract: 白名单运算符全部被接受', () => {
  const samples: Record<string, unknown> = {
    number: num(2),
    variable: x(),
    add: { type: 'add', args: [num(1), num(2)] },
    sub: { type: 'sub', args: [num(1), num(2)] },
    mul: { type: 'mul', args: [num(1), num(2)] },
    div: { type: 'div', args: [num(1), num(2)] },
    pow: { type: 'pow', args: [num(2), num(3)] },
    neg: { type: 'neg', args: [num(2)] },
    sin: { type: 'sin', args: [x()] },
    cos: { type: 'cos', args: [x()] },
    tan: { type: 'tan', args: [x()] },
    sqrt: { type: 'sqrt', args: [num(4)] },
    log: { type: 'log', args: [num(4)] },
    exp: { type: 'exp', args: [x()] },
  };
  for (const [op, node] of Object.entries(samples)) {
    assert(CANONICAL_OPS.has(op), `${op} 应在白名单中`);
    const r = parseCanonicalDSL(node);
    assert(r.ok, `${op} 应被接受，实际: ${r.issues.map((i) => i.code).join(',')}`);
  }
});

test('dsl-contract: 禁止的运算符全部被拒绝', () => {
  for (const op of FORBIDDEN_NODE_TYPES) {
    const r = parseCanonicalDSL({ type: op, args: [num(1), num(2)] });
    assert(!r.ok, `禁止的运算符 ${op} 必须被拒绝`);
    const codes = r.issues.map((i) => i.code);
    assert(
      codes.includes('FORBIDDEN_OPERATOR') || codes.includes('UNSUPPORTED_OPERATOR'),
      `${op} 应报 FORBIDDEN_OPERATOR/UNSUPPORTED_OPERATOR，实际 ${codes.join(',')}`
    );
  }
});

test('dsl-contract: 未知名运算符被拒绝', () => {
  const r = parseCanonicalDSL({ type: 'frobnicate', args: [num(1)] });
  assert(!r.ok, '未知运算符必须被拒绝');
  assert(r.issues.some((i) => i.code === 'UNSUPPORTED_OPERATOR'), '应报 UNSUPPORTED_OPERATOR');
});

test('dsl-contract: 元数（arity）必须精确匹配', () => {
  // add 只接受 2 个参数 —— 这正是旧 starter 的 P0-3 根因
  assert(!parseCanonicalDSL({ type: 'add', args: [num(1), num(2), num(3)] }).ok, 'add 不接受 3 个参数');
  assert(!parseCanonicalDSL({ type: 'add', args: [num(1)] }).ok, 'add 不接受 1 个参数');
  assert(!parseCanonicalDSL({ type: 'sin', args: [num(1), num(2)] }).ok, 'sin 不接受 2 个参数');
  assert(parseCanonicalDSL({ type: 'add', args: [num(1), num(2)] }).ok, 'add 接受 2 个参数');
});

test('dsl-contract: 支持 op 作为 type 的别名（Plan V1 §11 示例）', () => {
  const r = parseCanonicalDSL({ op: 'add', args: [{ op: 'number', value: 1 }, { op: 'variable', value: 'x' }] });
  assert(r.ok, `op 别名应被接受: ${r.issues.map((i) => i.message).join('; ')}`);
  assertClose(evaluateNode(r.ast!, 3), 4, 1e-12, 'op 别名求值应正确');
});

test('dsl-contract: 节点数 / 深度 / 常量上限', () => {
  // 深度：左深链超过 MAX_DEPTH
  let deep: any = x();
  for (let i = 0; i < LIMITS.MAX_DEPTH + 2; i++) deep = { type: 'sin', args: [deep] };
  assert(!parseCanonicalDSL(deep).ok, '超过深度上限必须被拒绝');

  // 常量
  assert(!parseCanonicalDSL(num(LIMITS.MAX_CONST_ABS + 1)).ok, '超上限常量必须被拒绝');
  assert(parseCanonicalDSL(num(LIMITS.MAX_CONST_ABS)).ok, '上限内的常量应被接受');
  assert(!parseCanonicalDSL(num(NaN)).ok, 'NaN 常量必须被拒绝');
  assert(!parseCanonicalDSL(num(Infinity)).ok, 'Infinity 常量必须被拒绝');

  // 节点数：构造一棵足够大的平衡树
  let big: any = x();
  for (let i = 0; i < 8; i++) big = { type: 'add', args: [big, big] };
  const complexity = analyzeComplexity(big);
  assert(complexity.nodeCount > LIMITS.MAX_NODES, '测试树应当超过节点上限');
  assert(!parseCanonicalDSL(big).ok, '超过节点上限必须被拒绝');
});

test('dsl-contract: 非对象 / 空输入 / 非法 JSON 都被干净拒绝', () => {
  assert(!parseCanonicalDSL('').ok, '空字符串必须被拒绝');
  assert(!parseCanonicalDSL('not json').ok, '非法 JSON 必须被拒绝');
  assert(!parseCanonicalDSL('null').ok, 'null 必须被拒绝');
  assert(!parseCanonicalDSL('42').ok, '裸数字必须被拒绝');
  assert(!parseCanonicalDSL('[]').ok, '数组必须被拒绝');
  assert(!parseCanonicalDSL({ args: [num(1), num(2)] }).ok, '缺少 type 必须被拒绝');
});

test('dsl-contract: canonicalJson 与 toMathString 是确定性的', () => {
  const a = { type: 'add', args: [num(1), { type: 'mul', args: [num(2), x()] }] };
  const b = { args: [num(1), { args: [num(2), x()], type: 'mul' }], type: 'add' } as any;
  assertEqual(canonicalJson(parseCanonicalDSL(a).ast!), canonicalJson(parseCanonicalDSL(b).ast!), '键顺序不应影响规范化');
  const text = toMathString(parseCanonicalDSL(a).ast!);
  assert(text.includes('x'), '公式文本应包含 x');
  assertClose(evaluateNode(parseCanonicalDSL(a).ast!, 5), 11, 1e-12, '求值应为 1+2*5');
});

test('dsl-contract: 官方 Starter 输出的是合法 DSL（P0-3 回归）', async () => {
  const { execFileSync } = await import('child_process');
  const path = await import('path');
  const starter = path.join(__dirname, '..', 'starter', 'solver.py');
  const payload = JSON.stringify({
    team_id: 'A',
    shooters: { A: { id: 'A1', position: { x: -12, y: 3 } }, B: { id: 'B1', position: { x: 12, y: -3 } } },
    points: [
      { id: 'A1', team: 'A', position: { x: -12, y: 3 } },
      { id: 'B1', team: 'B', position: { x: 12, y: -3 } },
    ],
  });
  const out = execFileSync('/usr/bin/python3', [starter], { input: payload, encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  const r = parseCanonicalDSL(typeof parsed.dsl === 'string' ? parsed.dsl : JSON.stringify(parsed.dsl));
  assert(r.ok, `官方 Starter 的 DSL 必须合法: ${r.issues.map((i) => i.message).join('; ')}`);
  assertClose(evaluateNode(r.ast!, -12), 3, 1e-9, 'Starter 函数必须经过自己的 Shooter');
});

void runAll('dsl-contract');
