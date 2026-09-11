"""An independent evaluator for the Geometry Battle DSL.

The platform judges `|f(x_p) - y_p| <= 1e-6` with its own implementation and a
1e-6 tolerance.  We therefore never trust the algebra that produced a
candidate: every emitted AST is re-evaluated here, on the exact tree we are
about to serialise, before it leaves the process.

Design notes
------------
* The AST is compiled once into a tree of Python closures, so the hot loop
  (hundreds of candidates x hundreds of sample points) pays dict dispatch only
  at compile time.
* `compile_derivs` returns value, first and second derivative analytically
  (forward-mode second order AD).  That is what the legality screen needs:
  finiteness, |f| <= 1e6, |f'| <= 1e10 and the convexity sign-change count.
* `pow` is only ever emitted with a small non-negative integer exponent, and
  that case is compiled to the `**` operator, matching how a double-precision
  evaluator would compute it.  The general `pow(a, b)` path exists only so the
  registry is complete; it is never produced by our builders.
"""

import math


class DomainError(Exception):
    """Raised when a node hits a domain violation (div0 / sqrt<0 / log<=0)."""


_INT_MAX = 32


def _pow_float(base, expo):
    """base ** expo restricted to plain floats; complex results are an error."""
    try:
        value = base ** expo
    except (OverflowError, ZeroDivisionError, ValueError):
        raise DomainError("pow")
    if isinstance(value, complex):
        raise DomainError("pow")
    return value


def compile_value(node):
    kind = node["type"]
    if kind == "number":
        value = float(node["value"])
        return lambda x, _v=value: _v
    if kind == "variable":
        return lambda x: x
    if kind == "add":
        a = compile_value(node["args"][0])
        b = compile_value(node["args"][1])
        return lambda x, _a=a, _b=b: _a(x) + _b(x)
    if kind == "sub":
        a = compile_value(node["args"][0])
        b = compile_value(node["args"][1])
        return lambda x, _a=a, _b=b: _a(x) - _b(x)
    if kind == "mul":
        a = compile_value(node["args"][0])
        b = compile_value(node["args"][1])
        return lambda x, _a=a, _b=b: _a(x) * _b(x)
    if kind == "div":
        a = compile_value(node["args"][0])
        b = compile_value(node["args"][1])

        def _div(x, _a=a, _b=b):
            denom = _b(x)
            if denom == 0.0:
                raise DomainError("div by zero")
            return _a(x) / denom

        return _div
    if kind == "pow":
        a = compile_value(node["args"][0])
        expo_node = node["args"][1]
        if expo_node["type"] == "number":
            e = float(expo_node["value"])
            if e.is_integer() and 0.0 <= e <= _INT_MAX:
                k = int(e)
                if k == 0:
                    return lambda x: 1.0
                if k == 1:
                    return a
                return lambda x, _a=a, _k=k: _pow_float(_a(x), _k)
        b = compile_value(expo_node)
        return lambda x, _a=a, _b=b: math.pow(_a(x), _b(x))
    if kind == "neg":
        a = compile_value(node["args"][0])
        return lambda x, _a=a: -_a(x)
    if kind == "sin":
        a = compile_value(node["args"][0])
        return lambda x, _a=a: math.sin(_a(x))
    if kind == "cos":
        a = compile_value(node["args"][0])
        return lambda x, _a=a: math.cos(_a(x))
    if kind == "tan":
        a = compile_value(node["args"][0])

        def _tan(x, _a=a):
            v = _a(x)
            out = math.tan(v)
            if not math.isfinite(out):
                raise DomainError("tan pole")
            return out

        return _tan
    if kind == "sqrt":
        a = compile_value(node["args"][0])

        def _sqrt(x, _a=a):
            v = _a(x)
            if v < 0.0:
                raise DomainError("sqrt of negative")
            return math.sqrt(v)

        return _sqrt
    if kind == "log":
        a = compile_value(node["args"][0])

        def _log(x, _a=a):
            v = _a(x)
            if v <= 0.0:
                raise DomainError("log of non-positive")
            return math.log(v)

        return _log
    if kind == "exp":
        a = compile_value(node["args"][0])

        def _exp(x, _a=a):
            v = _a(x)
            if v > 709.0:
                raise DomainError("exp overflow")
            return math.exp(v)

        return _exp
    raise DomainError("unsupported node %r" % (kind,))


def compile_derivs(node):
    """Compile to `f(x) -> (value, d1, d2)`."""
    kind = node["type"]
    if kind == "number":
        value = float(node["value"])
        return lambda x, _v=value: (_v, 0.0, 0.0)
    if kind == "variable":
        return lambda x: (x, 1.0, 0.0)
    if kind == "add":
        a = compile_derivs(node["args"][0])
        b = compile_derivs(node["args"][1])

        def _add(x, _a=a, _b=b):
            av, a1, a2 = _a(x)
            bv, b1, b2 = _b(x)
            return (av + bv, a1 + b1, a2 + b2)

        return _add
    if kind == "sub":
        a = compile_derivs(node["args"][0])
        b = compile_derivs(node["args"][1])

        def _sub(x, _a=a, _b=b):
            av, a1, a2 = _a(x)
            bv, b1, b2 = _b(x)
            return (av - bv, a1 - b1, a2 - b2)

        return _sub
    if kind == "mul":
        a = compile_derivs(node["args"][0])
        b = compile_derivs(node["args"][1])

        def _mul(x, _a=a, _b=b):
            av, a1, a2 = _a(x)
            bv, b1, b2 = _b(x)
            return (
                av * bv,
                a1 * bv + av * b1,
                a2 * bv + 2.0 * a1 * b1 + av * b2,
            )

        return _mul
    if kind == "div":
        a = compile_derivs(node["args"][0])
        b = compile_derivs(node["args"][1])

        def _div(x, _a=a, _b=b):
            av, a1, a2 = _a(x)
            bv, b1, b2 = _b(x)
            if bv == 0.0:
                raise DomainError("div by zero")
            inv = 1.0 / bv
            q1 = (a1 * bv - av * b1) * inv * inv
            q2 = (a2 * bv - av * b2) * inv * inv - 2.0 * b1 * q1 * inv
            return (av * inv, q1, q2)

        return _div
    if kind == "pow":
        a = compile_derivs(node["args"][0])
        expo_node = node["args"][1]
        integer_exp = None
        if expo_node["type"] == "number":
            e = float(expo_node["value"])
            if e.is_integer() and 0.0 <= e <= _INT_MAX:
                integer_exp = int(e)
        if integer_exp is None:
            raise DomainError("non-integer pow is never emitted")
        k = integer_exp
        if k == 0:
            return lambda x: (1.0, 0.0, 0.0)

        def _pow(x, _a=a, _k=k):
            av, a1, a2 = _a(x)
            if _k == 1:
                return (av, a1, a2)
            vm1 = _pow_float(av, _k - 1)
            value = vm1 * av
            d1 = _k * vm1 * a1
            if _k == 2:
                d2 = 2.0 * a1 * a1 + 2.0 * av * a2
            else:
                d2 = _k * vm1 * a2 + _k * (_k - 1) * _pow_float(av, _k - 2) * a1 * a1
            return (value, d1, d2)

        return _pow
    if kind == "neg":
        a = compile_derivs(node["args"][0])

        def _neg(x, _a=a):
            v, d1, d2 = _a(x)
            return (-v, -d1, -d2)

        return _neg
    if kind == "sin":
        a = compile_derivs(node["args"][0])

        def _sin(x, _a=a):
            av, a1, a2 = _a(x)
            s = math.sin(av)
            c = math.cos(av)
            return (s, c * a1, -s * a1 * a1 + c * a2)

        return _sin
    if kind == "cos":
        a = compile_derivs(node["args"][0])

        def _cos(x, _a=a):
            av, a1, a2 = _a(x)
            s = math.sin(av)
            c = math.cos(av)
            return (c, -s * a1, -c * a1 * a1 - s * a2)

        return _cos
    if kind == "tan":
        a = compile_derivs(node["args"][0])

        def _tan(x, _a=a):
            av, a1, a2 = _a(x)
            t = math.tan(av)
            if not math.isfinite(t):
                raise DomainError("tan pole")
            s = 1.0 + t * t
            return (t, s * a1, 2.0 * t * s * a1 * a1 + s * a2)

        return _tan
    if kind == "sqrt":
        a = compile_derivs(node["args"][0])

        def _sqrt(x, _a=a):
            av, a1, a2 = _a(x)
            if av < 0.0:
                raise DomainError("sqrt of negative")
            root = math.sqrt(av)
            if root == 0.0:
                raise DomainError("sqrt at zero (cusp)")
            return (root, a1 / (2.0 * root), a2 / (2.0 * root) - a1 * a1 / (4.0 * root ** 3))

        return _sqrt
    if kind == "log":
        a = compile_derivs(node["args"][0])

        def _log(x, _a=a):
            av, a1, a2 = _a(x)
            if av <= 0.0:
                raise DomainError("log of non-positive")
            return (math.log(av), a1 / av, a2 / av - a1 * a1 / (av * av))

        return _log
    if kind == "exp":
        a = compile_derivs(node["args"][0])

        def _exp(x, _a=a):
            av, a1, a2 = _a(x)
            if av > 709.0:
                raise DomainError("exp overflow")
            e = math.exp(av)
            return (e, e * a1, e * (a1 * a1 + a2))

        return _exp
    raise DomainError("unsupported node %r" % (kind,))


def eval_value(fn, x):
    """Evaluate a compiled value function, mapping domain faults to None."""
    try:
        out = fn(x)
    except (DomainError, ValueError, OverflowError, ZeroDivisionError):
        return None
    if isinstance(out, complex) or not isinstance(out, float):
        return None
    if not math.isfinite(out):
        return None
    return out
