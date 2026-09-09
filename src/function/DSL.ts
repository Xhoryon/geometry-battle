/**
 * 函数 DSL/AST 格式
 * Plan V1: 使用 AST 而不是字符串公式
 */

export type ASTNodeType =
  | 'number'
  | 'variable'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'neg'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'abs'
  | 'sqrt'
  | 'log'
  | 'exp'
  | 'pow'
  | 'floor'
  | 'ceil'
  | 'round'
  | 'sign'
  | 'min'
  | 'max'
  | 'if';

export interface ASTNode {
  type: ASTNodeType;
  value?: number | string;
  args?: ASTNode[];
  condition?: ASTNode;
  then?: ASTNode;
  else?: ASTNode;
}

export interface DSLValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  ast: ASTNode | null;
}

// 类型守卫
function isNumberNode(node: ASTNode): boolean {
  return node.type === 'number';
}

function isVariableNode(node: ASTNode): boolean {
  return node.type === 'variable';
}

function isUnaryNode(node: ASTNode): boolean {
  return ['neg', 'sin', 'cos', 'tan', 'abs', 'sqrt', 'log', 'exp', 'floor', 'ceil', 'round', 'sign'].includes(node.type);
}

function isBinaryNode(node: ASTNode): boolean {
  return ['add', 'sub', 'mul', 'div', 'pow', 'min', 'max'].includes(node.type);
}

function isIfNode(node: ASTNode): boolean {
  return node.type === 'if';
}

function assertNumberNode(node: ASTNode): asserts node is ASTNode & { type: 'number'; value: number } {
  if (!isNumberNode(node)) throw new Error(`Expected number node, got ${node.type}`);
}

function assertVariableNode(node: ASTNode): asserts node is ASTNode & { type: 'variable'; value: string } {
  if (!isVariableNode(node)) throw new Error(`Expected variable node, got ${node.type}`);
}

function assertUnaryNode(node: ASTNode): asserts node is ASTNode & { type: string; args: [ASTNode] } {
  if (!isUnaryNode(node)) throw new Error(`Expected unary node, got ${node.type}`);
  if (!node.args || node.args.length !== 1) throw new Error(`Unary node needs 1 arg`);
}

function assertBinaryNode(node: ASTNode): asserts node is ASTNode & { type: string; args: [ASTNode, ASTNode] } {
  if (!isBinaryNode(node)) throw new Error(`Expected binary node, got ${node.type}`);
  if (!node.args || node.args.length !== 2) throw new Error(`Binary node needs 2 args`);
}

function assertIfNode(node: ASTNode): asserts node is ASTNode & { type: 'if'; condition: ASTNode; then: ASTNode; else: ASTNode } {
  if (!isIfNode(node)) throw new Error(`Expected if node, got ${node.type}`);
  if (!node.condition || !node.then || !node.else) throw new Error(`If node missing fields`);
}

export function parseDSL(json: string): DSLValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const obj = JSON.parse(json);
    const ast = validateNode(obj, errors);

    if (errors.length > 0) {
      return { valid: false, errors, warnings, ast: null };
    }

    if (ast) {
      const complexity = analyzeComplexity(ast);
      if (complexity.nodeCount > 128) {
        errors.push(`AST 节点数 ${complexity.nodeCount} 超过限制 128`);
      }
      if (complexity.depth > 12) {
        errors.push(`AST 深度 ${complexity.depth} 超过限制 12`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      ast: ast || null,
    };
  } catch (e) {
    errors.push(`DSL 解析失败: ${e}`);
    return { valid: false, errors, warnings, ast: null };
  }
}

function validateNode(node: any, errors: string[]): ASTNode | null {
  if (!node || typeof node !== 'object') {
    errors.push('AST 节点必须是对象');
    return null;
  }

  if (isNumberNode(node)) {
    if (typeof node.value !== 'number') {
      errors.push('number 节点需要 number 类型的 value');
      return null;
    }
    if (Math.abs(node.value) > 1000) {
      errors.push(`常数 ${node.value} 超过限制 1000`);
    }
    return { type: 'number', value: node.value };
  }

  if (isVariableNode(node)) {
    return { type: 'variable', value: 'x' };
  }

  if (isIfNode(node)) {
    const cond = validateNode(node.condition, errors);
    const th = validateNode(node.then, errors);
    const el = validateNode(node.else, errors);
    if (!cond || !th || !el) {
      errors.push('if 节点验证失败');
      return null;
    }
    return { type: 'if', condition: cond, then: th, else: el };
  }

  if (isUnaryNode(node)) {
    if (!node.args || !Array.isArray(node.args) || node.args.length !== 1) {
      errors.push(`${node.type} 需要 1 个参数`);
      return null;
    }
    const child = validateNode(node.args[0], errors);
    if (!child) return null;
    return { type: node.type as ASTNodeType, args: [child] };
  }

  if (isBinaryNode(node)) {
    if (!node.args || !Array.isArray(node.args) || node.args.length !== 2) {
      errors.push(`${node.type} 需要 2 个参数`);
      return null;
    }
    const left = validateNode(node.args[0], errors);
    const right = validateNode(node.args[1], errors);
    if (!left || !right) return null;
    return { type: node.type as ASTNodeType, args: [left, right] };
  }

  errors.push(`未知节点类型: ${node.type}`);
  return null;
}

export function analyzeComplexity(node: ASTNode): { nodeCount: number; depth: number } {
  if (isNumberNode(node) || isVariableNode(node)) {
    return { nodeCount: 1, depth: 1 };
  }

  if (isIfNode(node)) {
    const c = analyzeComplexity(node.condition as ASTNode);
    const t = analyzeComplexity(node.then as ASTNode);
    const e = analyzeComplexity(node.else as ASTNode);
    return {
      nodeCount: 1 + c.nodeCount + t.nodeCount + e.nodeCount,
      depth: 1 + Math.max(c.depth, t.depth, e.depth),
    };
  }

  if (isUnaryNode(node)) {
    const child = analyzeComplexity(node.args![0] as ASTNode);
    return { nodeCount: 1 + child.nodeCount, depth: 1 + child.depth };
  }

  // binary
  const left = analyzeComplexity(node.args![0] as ASTNode);
  const right = analyzeComplexity(node.args![1] as ASTNode);
  return {
    nodeCount: 1 + left.nodeCount + right.nodeCount,
    depth: 1 + Math.max(left.depth, right.depth),
  };
}

export function evaluateAST(node: ASTNode, x: number): number {
  if (isNumberNode(node)) {
    return node.value as number;
  }

  if (isVariableNode(node)) {
    return x;
  }

  if (isIfNode(node)) {
    return evaluateAST(node.condition as ASTNode, x) >= 0
      ? evaluateAST(node.then as ASTNode, x)
      : evaluateAST(node.else as ASTNode, x);
  }

  if (isUnaryNode(node)) {
    const arg = node.args![0] as ASTNode;
    switch (node.type) {
      case 'neg': return -evaluateAST(arg, x);
      case 'sin': return Math.sin(evaluateAST(arg, x));
      case 'cos': return Math.cos(evaluateAST(arg, x));
      case 'tan': return Math.tan(evaluateAST(arg, x));
      case 'abs': return Math.abs(evaluateAST(arg, x));
      case 'sqrt': return Math.sqrt(evaluateAST(arg, x));
      case 'log': return Math.log(evaluateAST(arg, x));
      case 'exp': return Math.exp(evaluateAST(arg, x));
      case 'floor': return Math.floor(evaluateAST(arg, x));
      case 'ceil': return Math.ceil(evaluateAST(arg, x));
      case 'round': return Math.round(evaluateAST(arg, x));
      case 'sign': return Math.sign(evaluateAST(arg, x));
      default: return NaN;
    }
  }

  // binary
  const left = node.args![0] as ASTNode;
  const right = node.args![1] as ASTNode;
  switch (node.type) {
    case 'add': return evaluateAST(left, x) + evaluateAST(right, x);
    case 'sub': return evaluateAST(left, x) - evaluateAST(right, x);
    case 'mul': return evaluateAST(left, x) * evaluateAST(right, x);
    case 'div': return evaluateAST(left, x) / evaluateAST(right, x);
    case 'pow': return Math.pow(evaluateAST(left, x), evaluateAST(right, x));
    case 'min': return Math.min(evaluateAST(left, x), evaluateAST(right, x));
    case 'max': return Math.max(evaluateAST(left, x), evaluateAST(right, x));
    default: return NaN;
  }
}

export function checkContinuity(
  node: ASTNode,
  xStart: number,
  xEnd: number,
  step: number = 0.01
): { continuous: boolean; issues: string[] } {
  const issues: string[] = [];

  for (let x = xStart; x <= xEnd; x += step) {
    const y = evaluateAST(node, x);
    if (!isFinite(y)) {
      issues.push(`x=${x.toFixed(2)}: y=${y}`);
    }
    if (isNaN(y)) {
      issues.push(`x=${x.toFixed(2)}: y=NaN`);
    }
  }

  return { continuous: issues.length === 0, issues };
}

export function countConvexityChanges(
  node: ASTNode,
  xStart: number,
  xEnd: number,
  step: number = 0.05
): { count: number; changes: number[] } {
  const changes: number[] = [];
  let prevSign = 0;

  for (let x = xStart; x <= xEnd; x += step) {
    const h = step;
    const f = (xi: number) => evaluateAST(node, xi);
    const secondDerivative = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);

    if (isFinite(secondDerivative) && !isNaN(secondDerivative)) {
      const currentSign = secondDerivative > 0 ? 1 : secondDerivative < 0 ? -1 : 0;
      if (prevSign !== 0 && currentSign !== 0 && prevSign !== currentSign) {
        changes.push(x);
      }
      prevSign = currentSign;
    }
  }

  return { count: changes.length, changes };
}

export function astToString(node: ASTNode): string {
  if (isNumberNode(node)) {
    return String(node.value);
  }

  if (isVariableNode(node)) {
    return 'x';
  }

  if (isIfNode(node)) {
    return `(if ${astToString(node.condition as ASTNode)} then ${astToString(node.then as ASTNode)} else ${astToString(node.else as ASTNode)})`;
  }

  if (isUnaryNode(node)) {
    const arg = node.args![0] as ASTNode;
    switch (node.type) {
      case 'neg': return `(-${astToString(arg)})`;
      case 'sin': return `sin(${astToString(arg)})`;
      case 'cos': return `cos(${astToString(arg)})`;
      case 'tan': return `tan(${astToString(arg)})`;
      case 'abs': return `abs(${astToString(arg)})`;
      case 'sqrt': return `sqrt(${astToString(arg)})`;
      case 'log': return `log(${astToString(arg)})`;
      case 'exp': return `exp(${astToString(arg)})`;
      case 'floor': return `floor(${astToString(arg)})`;
      case 'ceil': return `ceil(${astToString(arg)})`;
      case 'round': return `round(${astToString(arg)})`;
      case 'sign': return `sign(${astToString(arg)})`;
      default: return '?';
    }
  }

  // binary
  const left = node.args![0] as ASTNode;
  const right = node.args![1] as ASTNode;
  switch (node.type) {
    case 'add': return `(${astToString(left)} + ${astToString(right)})`;
    case 'sub': return `(${astToString(left)} - ${astToString(right)})`;
    case 'mul': return `(${astToString(left)} * ${astToString(right)})`;
    case 'div': return `(${astToString(left)} / ${astToString(right)})`;
    case 'pow': return `pow(${astToString(left)}, ${astToString(right)})`;
    case 'min': return `min(${astToString(left)}, ${astToString(right)})`;
    case 'max': return `max(${astToString(left)}, ${astToString(right)})`;
    default: return '?';
  }
}
