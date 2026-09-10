"""gb_dsl.py -- AST construction, structural screen and evaluation for the
Geometry Battle V1.1 function DSL.

This module is entirely self-contained (standard library only).  It knows the
*frozen* node whitelist from competitor-kit/DSL_SPECIFICATION.md:

    number, variable, add, sub, mul, div, pow, neg, sin, cos, tan, sqrt, log, exp

and the structural limits:

    nodes <= 128, depth <= 12, |constant| <= 1000 (finite)

The evaluator here is our *own* replica of the platform's evaluation
semantics.  It is deliberately written against the AST -- not against the
closed-form expression the AST was generated from -- because floating point
association inside the tree is what the judge actually sees.  Every candidate
we emit is checked with `eval_ast` at every intended target x, never with the
closed form.
"""

import math

# ---------------------------------------------------------------------------
# node constructors
# ---------------------------------------------------------------------------

BINARY_OPS = frozenset(("add", "sub", "mul", "div", "pow"))
UNARY_OPS = frozenset(("neg", "sin", "cos", "tan", "sqrt", "log", "exp"))
LEAF_OPS = frozenset(("number", "variable"))
WHITELIST = BINARY_OPS | UNARY_OPS | LEAF_OPS


def number(value):
    return {"type": "number", "value": float(value)}


def variable():
    return {"type": "variable", "value": "x"}


def binary(op, a, b):
    return {"type": op, "args": [a, b]}


def unary(op, a):
    return {"type": op, "args": [a]}


def u_node(xs):
    """The shared `x - xs` sub-expression (physically duplicated per term)."""
    return binary("sub", variable(), number(xs))


# ---------------------------------------------------------------------------
# structural screen (nodes / depth / arity / constant magnitude)
# ---------------------------------------------------------------------------

def measure(ast):
    """Return (nodes, depth) of an AST, or (-1, -1) if it is malformed.

    Depth follows the spec: a leaf has depth 1, every operator layer adds 1.
    Iterative, so a deeply nested hostile AST cannot blow the Python stack.
    """
    nodes = 0
    max_depth = 0
    # (node, depth)
    stack = [(ast, 1)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict):
            return -1, -1
        kind = node.get("type", node.get("op"))
        args = node.get("args")
        if kind in LEAF_OPS:
            nodes += 1
            if depth > max_depth:
                max_depth = depth
            if kind == "number":
                v = node.get("value")
                if not isinstance(v, (int, float)) or isinstance(v, bool):
                    return -1, -1
                v = float(v)
                if not (v == v) or v in (float("inf"), float("-inf")):
                    return -1, -1
                if abs(v) > 1000.0:
                    return -1, -1
            else:
                if node.get("value") != "x":
                    return -1, -1
            continue
        if kind in BINARY_OPS:
            want = 2
        elif kind in UNARY_OPS:
            want = 1
        else:
            return -1, -1
        if not isinstance(args, list) or len(args) != want:
            return -1, -1
        nodes += 1
        if depth > max_depth:
            max_depth = depth
        for child in args:
            stack.append((child, depth + 1))
    return nodes, max_depth


def structural_ok(ast, node_limit=128, depth_limit=12, const_limit=1000.0):
    """(ok, reason) structural legality screen, mirroring the official codes."""
    nodes = 0
    max_depth = 0
    stack = [(ast, 1)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict):
            return False, "NOT_AN_OBJECT"
        kind = node.get("type", node.get("op"))
        if kind in LEAF_OPS:
            nodes += 1
            if depth > max_depth:
                max_depth = depth
            if depth > depth_limit:
                return False, "DEPTH_LIMIT"
            if nodes > node_limit:
                return False, "NODE_LIMIT"
            if kind == "number":
                v = node.get("value")
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    return False, "BAD_VALUE"
                v = float(v)
                if v != v or v in (float("inf"), float("-inf")):
                    return False, "BAD_VALUE"
                if abs(v) > const_limit:
                    return False, "CONST_TOO_LARGE"
            else:
                if node.get("value") != "x":
                    return False, "BAD_VALUE"
            continue
        if kind in BINARY_OPS:
            want = 2
        elif kind in UNARY_OPS:
            want = 1
        else:
            if kind is None:
                return False, "NOT_AN_OBJECT"
            return False, "UNSUPPORTED_OPERATOR"
        args = node.get("args")
        if not isinstance(args, list) or len(args) != want:
            return False, "BAD_ARITY"
        nodes += 1
        if depth > max_depth:
            max_depth = depth
        if depth > depth_limit:
            return False, "DEPTH_LIMIT"
        if nodes > node_limit:
            return False, "NODE_LIMIT"
        for child in args:
            stack.append((child, depth + 1))
    return True, "OK"


# ---------------------------------------------------------------------------
# evaluation (our replica of platform semantics)
# ---------------------------------------------------------------------------

def _pow(a, b):
    # integer exponents take the integer path, exactly like the tree the
    # platform walks when `pow` carries an integral `number` exponent.
    if b == 2.0:
        return a * a
    if b == 3.0:
        return a * a * a
    return a ** b


def eval_ast(ast, x):
    """Evaluate an AST at x.  Returns float('nan') on any domain error.

    Recursive, but only ever called on candidates we built (depth <= 12), so
    the recursion is bounded by the structural limit.
    """
    try:
        return _eval(ast, x)
    except (ValueError, ZeroDivisionError, OverflowError, TypeError,
            ArithmeticError):
        return float("nan")


def _eval(node, x):
    kind = node["type"]
    if kind == "number":
        return float(node["value"])
    if kind == "variable":
        return x
    if kind == "add":
        a = node["args"]
        return _eval(a[0], x) + _eval(a[1], x)
    if kind == "sub":
        a = node["args"]
        return _eval(a[0], x) - _eval(a[1], x)
    if kind == "mul":
        a = node["args"]
        return _eval(a[0], x) * _eval(a[1], x)
    if kind == "div":
        a = node["args"]
        return _eval(a[0], x) / _eval(a[1], x)
    if kind == "pow":
        a = node["args"]
        return _pow(_eval(a[0], x), _eval(a[1], x))
    if kind == "neg":
        return -_eval(node["args"][0], x)
    if kind == "sin":
        return math.sin(_eval(node["args"][0], x))
    if kind == "cos":
        return math.cos(_eval(node["args"][0], x))
    if kind == "tan":
        return math.tan(_eval(node["args"][0], x))
    if kind == "sqrt":
        return math.sqrt(_eval(node["args"][0], x))
    if kind == "log":
        return math.log(_eval(node["args"][0], x))
    if kind == "exp":
        return math.exp(_eval(node["args"][0], x))
    raise ValueError("unsupported operator: %r" % (kind,))


# ---------------------------------------------------------------------------
# polynomial AST construction
# ---------------------------------------------------------------------------

def poly_ast(xs, ys, coeffs):
    """Build `f(x) = ys + sum_k c_k * (x - xs)^k` from a dense coeff list.

    `coeffs` is indexed by exponent - 1: coeffs[0] is the coefficient of
    (x - xs), coeffs[1] of (x - xs)^2, and so on.  Zero coefficients are
    dropped so the AST stays as small as possible.

    The sum is a *balanced* binary tree: with <= 4 terms the depth stays far
    below the limit and the rounding profile is deterministic.
    """
    terms = []
    for idx, c in enumerate(coeffs):
        if c == 0.0 or c != c:
            continue
        k = idx + 1
        if k == 1:
            core = u_node(xs)
        else:
            core = binary("pow", u_node(xs), number(k))
        terms.append(binary("mul", number(c), core))
    if not terms:
        return number(ys)
    # balanced pairing over the ordered term list
    layer = terms
    while len(layer) > 1:
        nxt = []
        for i in range(0, len(layer) - 1, 2):
            nxt.append(binary("add", layer[i], layer[i + 1]))
        if len(layer) & 1:
            nxt.append(layer[-1])
        layer = nxt
    return binary("add", number(ys), layer[0])


def sin_ast(xs, ys, amp, omega):
    """Build `f(x) = ys + amp * sin(omega * (x - xs))`."""
    inner = binary("mul", number(omega), u_node(xs))
    return binary("add", number(ys), binary("mul", number(amp), unary("sin", inner)))
