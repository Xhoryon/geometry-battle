"""gb_dsl —— 函数 DSL 的构造工具与「平台求值器」的 Python 镜像。

本模块只做两件事：

1. 提供白名单节点的构造函数（`num` / `var` / `add` / ... ），任何非法常数
   （NaN / inf / |v| > 1000）在构造期就被拒绝 —— 宁可在打分前丢掉候选，
   也绝不把非法 AST 交给平台（V1.1 §5 / DSL_SPECIFICATION §6）。

2. 提供 `evaluate()`：逐字镜像 `src/core/Ast.ts` 的 `evaluateNode()`。
   候选曲线同时以「Python 可调用对象」与「AST」两种形式存在：
   前者用于搜索期的高频打分，后者是最终提交物。`agrees_with_ast()` 用采样点
   核对两者一致，保证「打中了」的结论对提交的 AST 同样成立。

不依赖任何第三方库（RUNTIME_MANIFEST §3：第三方包为 0）。
"""

import math

# 与 src/core/Ast.ts 的 LIMITS 保持一致。
MAX_NODES = 128
MAX_DEPTH = 12
MAX_CONST_ABS = 1000

# 自留的安全余量：只输出「远低于上限」的树，避免边界情形被平台拒收。
SAFE_NODES = 120
SAFE_DEPTH = 11


class DslError(ValueError):
    """构造期发现非法的常数 / 结构。候选会被丢弃，不会中断求解。"""


# ---------------------------------------------------------------------------
# 白名单节点（DSL_SPECIFICATION §3 的 14 种）
# ---------------------------------------------------------------------------

def num(value):
    v = float(value)
    if not math.isfinite(v):
        raise DslError("非有限常数: %r" % (value,))
    if abs(v) > MAX_CONST_ABS:
        raise DslError("常数超限 |%r| > %d" % (value, MAX_CONST_ABS))
    return {"type": "number", "value": v}


def var():
    # 冻结形态：必须显式写 "value": "x"（DSL_SPECIFICATION §3）。
    return {"type": "variable", "value": "x"}


def add(a, b):
    return {"type": "add", "args": [a, b]}


def sub(a, b):
    return {"type": "sub", "args": [a, b]}


def mul(a, b):
    return {"type": "mul", "args": [a, b]}


def neg(a):
    return {"type": "neg", "args": [a]}


def sin(a):
    return {"type": "sin", "args": [a]}


def cos(a):
    return {"type": "cos", "args": [a]}


def powi(base, exponent):
    """整数次幂 —— 平台对整数指数的区间分析是精确的（Ast.ts analyzeRange）。"""
    if not isinstance(exponent, int):
        raise DslError("只允许整数指数")
    return {"type": "pow", "args": [base, num(exponent)]}


# ---------------------------------------------------------------------------
# 结构自检
# ---------------------------------------------------------------------------

def complexity(node):
    """返回 (节点数, 深度)，与 Ast.ts 的 analyzeComplexity 同定义。"""
    if node["type"] in ("number", "variable"):
        return 1, 1
    nodes = 1
    depth = 0
    for child in node["args"]:
        c_nodes, c_depth = complexity(child)
        nodes += c_nodes
        if c_depth > depth:
            depth = c_depth
    return nodes, depth + 1


def assert_emittable(node):
    """最终出口前的最后一道闸：结构必须远低于平台上限。"""
    nodes, depth = complexity(node)
    if nodes > SAFE_NODES:
        raise DslError("节点数 %d 超过自留上限 %d" % (nodes, SAFE_NODES))
    if depth > SAFE_DEPTH:
        raise DslError("深度 %d 超过自留上限 %d" % (depth, SAFE_DEPTH))
    return nodes, depth


# ---------------------------------------------------------------------------
# 求值器（逐字镜像 src/core/Ast.ts 的 evaluateNode）
# ---------------------------------------------------------------------------

def evaluate(node, x):
    t = node["type"]
    if t == "number":
        return node["value"]
    if t == "variable":
        return x
    if t == "neg":
        return -evaluate(node["args"][0], x)
    if t == "sin":
        return math.sin(evaluate(node["args"][0], x))
    if t == "cos":
        return math.cos(evaluate(node["args"][0], x))
    if t == "sqrt":
        return math.sqrt(evaluate(node["args"][0], x))
    if t == "log":
        return math.log(evaluate(node["args"][0], x))
    if t == "exp":
        return math.exp(evaluate(node["args"][0], x))
    if t == "pow":
        return math.pow(evaluate(node["args"][0], x), evaluate(node["args"][1], x))
    a = evaluate(node["args"][0], x)
    b = evaluate(node["args"][1], x)
    if t == "add":
        return a + b
    if t == "sub":
        return a - b
    if t == "mul":
        return a * b
    if t == "div":
        return a / b
    return float("nan")


def agrees_with_ast(closure, ast, samples, tol=1e-9):
    """核对「搜索用的闭包」与「要提交的 AST」是同一个函数。

    两者由同一组系数生成，本检查是最后一道保险：一旦出现分歧（例如某个
    系数在闭包里被优化成另一种等价写法而在 AST 里没有），该候选立即作废。
    """
    for x in samples:
        try:
            a = closure(x)
            b = evaluate(ast, x)
        except Exception:
            return False
        if not (math.isfinite(a) and math.isfinite(b)):
            return False
        scale = max(1.0, abs(a), abs(b))
        if abs(a - b) > tol * scale:
            return False
    return True
