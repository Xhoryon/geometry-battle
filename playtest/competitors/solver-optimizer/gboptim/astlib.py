"""DSL node construction and structural analysis.

The DSL (competitor-kit/DSL_SPECIFICATION.md section 3) allows exactly 14 node
types.  Everything the solver emits is built here so that the structural limits
(node count <= 128, depth <= 12, |constant| <= 1000) are enforced in one place.

Shape facts used by the search (u = x - x_s, s = 1 / L):

    V          = s * u                              ->  5 nodes, depth 3
    pow(V, k)                                       ->  7 nodes, depth 4
    c_k * pow(V, k)                                 ->  9 nodes, depth 5
    c_1 * V                                         ->  7 nodes, depth 4

so a degree-K polynomial written as  ys + sum_k c_k V^k  costs

    1 + 1 + 7 + 9*(K-1) + (K-1)  =  10*K - 1  nodes,
    depth = 5 + ceil(log2(K)) + 1.

K = 12 -> 119 nodes, depth 10: comfortably inside both limits.  Because a round
has at most 10 enemy points there is never a reason to exceed K = 10.
"""

NODE_LIMIT = 128
DEPTH_LIMIT = 12
CONST_LIMIT = 1000.0

WHITELIST = frozenset(
    [
        "number",
        "variable",
        "add",
        "sub",
        "mul",
        "div",
        "pow",
        "neg",
        "sin",
        "cos",
        "tan",
        "sqrt",
        "log",
        "exp",
    ]
)


# --------------------------------------------------------------------------
# node builders
# --------------------------------------------------------------------------
def num(value):
    return {"type": "number", "value": float(value)}


def var():
    return {"type": "variable", "value": "x"}


def op(kind, *args):
    return {"type": kind, "args": list(args)}


def add(a, b):
    return {"type": "add", "args": [a, b]}


def sub(a, b):
    return {"type": "sub", "args": [a, b]}


def mul(a, b):
    return {"type": "mul", "args": [a, b]}


def neg(a):
    return {"type": "neg", "args": [a]}


def node_pow(a, b):
    return {"type": "pow", "args": [a, b]}


def fn1(kind, a):
    return {"type": kind, "args": [a]}


# --------------------------------------------------------------------------
# structural analysis
# --------------------------------------------------------------------------
def node_count(node):
    args = node.get("args")
    if not args:
        return 1
    total = 1
    for child in args:
        total += node_count(child)
    return total


def depth(node):
    args = node.get("args")
    if not args:
        return 1
    return 1 + max(depth(child) for child in args)


def max_abs_const(node):
    best = 0.0
    stack = [node]
    while stack:
        cur = stack.pop()
        if cur.get("type") == "number":
            v = abs(float(cur["value"]))
            if v > best:
                best = v
        elif cur.get("type") == "variable":
            if cur.get("value") != "x":
                return float("inf")
        stack.extend(cur.get("args") or ())
    return best


def structural_ok(node):
    """True when the AST satisfies every structural rule the parser checks."""
    if node_count(node) > NODE_LIMIT:
        return False
    if depth(node) > DEPTH_LIMIT:
        return False
    if max_abs_const(node) > CONST_LIMIT:
        return False
    return True


# --------------------------------------------------------------------------
# generic shapes
# --------------------------------------------------------------------------
def balanced_sum(nodes):
    """Balanced binary tree of `add` nodes -- keeps depth at ceil(log2 n)."""
    if not nodes:
        return num(0.0)
    if len(nodes) == 1:
        return nodes[0]
    mid = len(nodes) // 2
    return add(balanced_sum(nodes[:mid]), balanced_sum(nodes[mid:]))


def _scaled_u(xs, length):
    """V = (x - x_s) / L, i.e. the attack interval u in [0, L] mapped to [0, 1]."""
    return mul(num(1.0 / length), sub(var(), num(xs)))


def poly_ast(ys, xs, length, coeffs):
    """f(x) = y_s + sum_k coeffs[k-1] * ((x - x_s) / L)^k.

    Every term carries a factor of V and V(x_s) = 0, so f(x_s) = y_s is an
    exact floating point identity.  Terms are emitted smallest-magnitude first
    into a balanced summation tree: pairwise summation then aggregates the
    small (and possibly cancelling) contributions before the large ones.
    """
    terms = []
    indexed = [(abs(float(c)), i, float(c)) for i, c in enumerate(coeffs)]
    indexed.sort(key=lambda t: t[0])
    for _, i, c in indexed:
        if c == 0.0:
            continue
        k = i + 1
        base = _scaled_u(xs, length)
        if k == 1:
            power = base
        else:
            power = node_pow(base, num(k))
        terms.append(mul(num(c), power))
    if not terms:
        return num(ys)
    return add(num(ys), balanced_sum(terms))


def trig_ast(ys, xs, a, b, c=None, d=None):
    """f(x) = y_s + a*sin(b*u) [+ c*(1 - cos(d*u))], u = x - x_s.

    Both sin(b*0) and (1 - cos(d*0)) vanish, so f(x_s) = y_s is exact.
    """
    body = mul(num(a), fn1("sin", mul(num(b), sub(var(), num(xs)))))
    if c is not None and d is not None:
        second = mul(
            num(c),
            sub(num(1.0), fn1("cos", mul(num(d), sub(var(), num(xs))))),
        )
        body = add(body, second)
    return add(num(ys), body)


def exp_ast(ys, xs, a, b, c):
    """f(x) = y_s + a*u + b*(exp(c*u) - 1), u = x - x_s."""
    u = sub(var(), num(xs))
    return add(
        num(ys),
        add(
            mul(num(a), sub(var(), num(xs))),
            mul(
                num(b),
                sub(fn1("exp", mul(num(c), sub(var(), num(xs)))), num(1.0)),
            ),
        ),
    )


def sqrt_ast(ys, xs, a, b, c):
    """f(x) = y_s + a*u + b*(sqrt(1 + c*u) - 1), u = x - x_s, 1 + c*u > 0."""
    return add(
        num(ys),
        add(
            mul(num(a), sub(var(), num(xs))),
            mul(
                num(b),
                sub(
                    fn1("sqrt", add(num(1.0), mul(num(c), sub(var(), num(xs))))),
                    num(1.0),
                ),
            ),
        ),
    )
