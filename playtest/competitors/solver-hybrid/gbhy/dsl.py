"""DSL construction, measurement and the public legality screen.

The whitelist and the limits are taken from
``competitor-kit/DSL_SPECIFICATION.md`` (14 node types, 128 nodes, depth 12,
|const| <= 1000, convexity sign changes <= 100, |f'| <= 1e10, |f| <= 1e6,
domain must stay real over the attack interval).

Every curve this package emits is written in the *incremental* form the kit
recommends:

    V       = (x - x_s) / L          with L = |attack_end - x_s|
    f(x)    = y_s + g(V),  g(0) = 0

so ``f(x_s) == y_s`` holds identically and cannot drift into the 1e-6
shooter tolerance.  ``L`` also normalises the interval to V in [-1, 1], which
keeps polynomial coefficients small enough to respect the |const| <= 1000 rule
without any rescaling tricks.
"""

import math

LEAF = ("number", "variable")
UNARY = ("neg", "sin", "cos", "tan", "sqrt", "log", "exp")
BINARY = ("add", "sub", "mul", "div", "pow")

MAX_NODES = 128
MAX_DEPTH = 12
MAX_CONST = 1000.0
MAX_ABS_F = 1e6
MAX_ABS_DF = 1e10
MAX_CONVEXITY_CHANGES = 100
SHOOTER_EPS = 1e-6
HIT_EPS = 1e-6


class DslError(Exception):
    pass


# ---------------------------------------------------------------------------
# node builders
# ---------------------------------------------------------------------------


def number(v):
    return {"type": "number", "value": float(v)}


def variable():
    return {"type": "variable", "value": "x"}


def _n(name):
    def build(*args):
        return {"type": name, "args": list(args)}
    return build


add, sub, mul, div, pow_ = (_n("add"), _n("sub"), _n("mul"),
                            _n("div"), _n("pow"))
neg, sin, cos, tan, sqrt, log, exp = (_n("neg"), _n("sin"), _n("cos"),
                                      _n("tan"), _n("sqrt"), _n("log"),
                                      _n("exp"))


def v_offset(xs, L):
    """V = (x - x_s) / L -- the normalised offset from our own shooter."""
    return div(sub(variable(), number(xs)), number(L))


def linear(ys, xs, L, c1):
    """y_s + c1 * V."""
    return add(number(ys), mul(number(c1), v_offset(xs, L)))


def horner(ys, xs, L, coeffs):
    """y_s + c1*V + c2*V^2 + ... built in Horner form (cheapest in nodes).

    ``coeffs`` is the full list including the (ignored) constant term, so a
    polynomial through the shooter is just ``coeffs[0] = 0``.
    """
    cs = list(coeffs)
    while cs and cs[0] == 0.0:
        cs.pop(0)
    if not cs:
        return number(ys)
    V = v_offset(xs, L)
    acc = number(cs[-1])
    for c in reversed(cs[:-1]):
        acc = add(number(c), mul(V, acc))
    return add(number(ys), mul(V, acc))


def monomials(ys, xs, L, coeffs):
    """y_s + sum a_k * V^k, kept as a flat sum.

    Used when a Horner chain would be too deep; Horner is preferred otherwise.
    """
    V = v_offset(xs, L)
    terms = []
    for k, c in enumerate(coeffs):
        if k == 0 or c == 0.0:
            continue
        if k == 1:
            terms.append(mul(number(c), V))
        else:
            terms.append(mul(number(c), pow_(V, number(k))))
    if not terms:
        return number(ys)
    acc = terms[0]
    for t in terms[1:]:
        acc = add(acc, t)
    return add(number(ys), acc)


# ---------------------------------------------------------------------------
# measurement / structure
# ---------------------------------------------------------------------------


def measure(node):
    """(nodes, depth); leaves are depth 1, mirroring the kit's definition."""
    t = node.get("type", node.get("op"))
    if t in LEAF:
        return 1, 1
    n, d = 1, 0
    for a in node.get("args") or []:
        cn, cd = measure(a)
        n += cn
        d = max(d, cd)
    return n, d + 1


def max_abs_const(node):
    t = node.get("type", node.get("op"))
    best = 0.0
    if t == "number":
        v = node.get("value")
        if isinstance(v, (int, float)):
            best = abs(float(v))
    for a in (node.get("args") or []):
        best = max(best, max_abs_const(a))
    return best


def structural_ok(node):
    """Cheap structural check: whitelist, arity, node/depth/const limits."""
    try:
        n, d = measure(node)
    except Exception:
        return False, "MALFORMED"
    if n > MAX_NODES:
        return False, "NODE_LIMIT:%d" % n
    if d > MAX_DEPTH:
        return False, "DEPTH_LIMIT:%d" % d
    if max_abs_const(node) > MAX_CONST:
        return False, "CONST_TOO_LARGE"
    try:
        _walk(node)
    except DslError as exc:
        return False, str(exc)
    return True, ""


def _walk(node):
    t = node.get("type", node.get("op"))
    if t == "number":
        v = node.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
            raise DslError("BAD_VALUE")
        return
    if t == "variable":
        if node.get("value") != "x":
            raise DslError("BAD_VALUE")
        return
    if t not in UNARY and t not in BINARY:
        raise DslError("UNSUPPORTED_OPERATOR:" + str(t))
    args = node.get("args")
    need = 1 if t in UNARY else 2
    if not isinstance(args, list) or len(args) != need:
        raise DslError("BAD_ARITY:" + str(t))
    for a in args:
        _walk(a)


def compile_ast(node):
    """Compile to a callable.  No eval -- a small explicit interpreter."""
    t = node.get("type", node.get("op"))
    if t == "number":
        v = float(node["value"])
        return lambda x, _v=v: _v
    if t == "variable":
        return lambda x: x
    if t == "add":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) + b(x)
    if t == "sub":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) - b(x)
    if t == "mul":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) * b(x)
    if t == "div":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) / b(x)
    if t == "pow":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) ** b(x)
    if t == "neg":
        a = compile_ast(node["args"][0])
        return lambda x: -a(x)
    if t == "sin":
        a = compile_ast(node["args"][0])
        return lambda x: math.sin(a(x))
    if t == "cos":
        a = compile_ast(node["args"][0])
        return lambda x: math.cos(a(x))
    if t == "tan":
        a = compile_ast(node["args"][0])
        return lambda x: math.tan(a(x))
    if t == "sqrt":
        a = compile_ast(node["args"][0])
        return lambda x: math.sqrt(a(x))
    if t == "log":
        a = compile_ast(node["args"][0])
        return lambda x: math.log(a(x))
    if t == "exp":
        a = compile_ast(node["args"][0])
        return lambda x: math.exp(a(x))
    raise DslError("UNSUPPORTED_OPERATOR:" + str(t))


# ---------------------------------------------------------------------------
# legality screen over the attack interval
# ---------------------------------------------------------------------------


def screen(f, xs, ys, x0, x1, samples=2001):
    """Public function-legality screen.  Returns (ok, [problems]).

    Mirrors DSL_SPECIFICATION.md §7: finite values, |f| <= 1e6, no domain
    error, slope bounded, convexity sign changes <= 100.  The shooter
    pass-through is checked too, though by construction it is exact.
    """
    problems = []
    if x1 - x0 <= 0:
        return False, ["EMPTY_DOMAIN"]
    try:
        v0 = f(xs)
    except Exception as exc:
        return False, ["DOMAIN_ERROR_AT_SHOOTER:%r" % (exc,)]
    if not math.isfinite(v0) or abs(v0 - ys) > SHOOTER_EPS:
        problems.append("NOT_THROUGH_SHOOTER:%.3e" % abs(v0 - ys))
        return False, problems

    step = (x1 - x0) / float(samples - 1)
    prev = prev_prev = None
    prev_sign = 0
    changes = 0
    for i in range(samples):
        x = x0 + step * i
        try:
            y = f(x)
        except Exception as exc:
            problems.append("DOMAIN_ERROR:%r@%.4f" % (exc, x))
            return False, problems
        if not math.isfinite(y):
            problems.append("NOT_FINITE@%.4f" % x)
            return False, problems
        if abs(y) > MAX_ABS_F:
            problems.append("NOT_FINITE:abs>1e6@%.4f" % x)
            return False, problems
        if prev is not None:
            slope = (y - prev) / step if step else 0.0
            if abs(slope) > MAX_ABS_DF:
                problems.append("NOT_C2:slope@%.4f" % x)
                return False, problems
            if prev_prev is not None:
                curv = (y - 2.0 * prev + prev_prev) / (step * step)
                s = 1 if curv > 1e-9 else (-1 if curv < -1e-9 else 0)
                if s != 0 and prev_sign != 0 and s != prev_sign:
                    changes += 1
                if s != 0:
                    prev_sign = s
        prev_prev, prev = prev, y
    if changes > MAX_CONVEXITY_CHANGES:
        problems.append("CONVEXITY_LIMIT:%d" % changes)
        return False, problems
    return (len(problems) == 0), problems
