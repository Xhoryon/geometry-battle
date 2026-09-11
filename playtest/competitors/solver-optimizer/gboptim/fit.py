"""Exact multi-target interpolation.

We fit  f(x) = y_s + sum_{k=1..K} c_k * V^k   with  V = (x - x_s) / L  through a
chosen subset of enemy points.  Because every term carries a factor of V, the
constant term is structurally zero and f(x_s) = y_s holds exactly.

Solving strategy
----------------
Writing P(V) = V * Q(V) with deg Q = K - 1, the conditions P(V_i) = dy_i become

    Q(V_i) = dy_i / V_i

i.e. a *standard* polynomial interpolation problem, which we solve with Newton
divided differences followed by an exact Newton -> monomial conversion.  All of
it is done in `fractions.Fraction`, so the coefficients are exact rationals;
only afterwards are they rounded to float.

That O(m^2) exact route is both faster and better conditioned than eliminating
an m x m monomial Vandermonde (which the degree ladder would otherwise need to
redo for every subset).  Dividing out a free leading coefficient is linear in
that coefficient, so the same machinery gives an exact one-parameter family:

    P(V) = V * Q_0(V) + t * V * Q_1(V)

Float rounding is then repaired by a short Richardson refinement against the
*same arithmetic the emitted AST performs* (see `ast_terms` / `eval_terms`),
and the caller finally re-verifies the serialised tree with the real evaluator.
"""

from fractions import Fraction

# Residual the search is willing to emit: the judge tolerance is 1e-6 and the
# judge is a different implementation, so we insist on three orders of margin.
RESIDUAL_TOL = 1e-9
REFINE_TOL = 5e-13


def _interpolate(nodes, values):
    """Exact monomial coefficients (ascending) of the interpolating polynomial."""
    pairs = sorted(zip(nodes, values), key=lambda p: p[0])
    m = len(pairs)
    if m == 0:
        return []
    xs = [p[0] for p in pairs]
    for i in range(1, m):
        if xs[i] == xs[i - 1]:
            return None  # repeated abscissa -> singular system
    d = [p[1] for p in pairs]
    for j in range(1, m):
        for i in range(m - 1, j - 1, -1):
            d[i] = (d[i] - d[i - 1]) / (xs[i] - xs[i - j])
    mono = [Fraction(0)] * m
    poly = [Fraction(1)]
    for j in range(m):
        dj = d[j]
        if dj:
            for k, p in enumerate(poly):
                mono[k] += dj * p
        if j == m - 1:
            break
        node = xs[j]
        nxt = [Fraction(0)] * (len(poly) + 1)
        for k, p in enumerate(poly):
            nxt[k + 1] += p
            nxt[k] -= p * node
        poly = nxt
    return mono


def ast_terms(coeffs):
    """Emission order used by astlib.poly_ast: smallest |c| first, k = index+1."""
    return sorted(
        ((abs(float(c)), i + 1, float(c)) for i, c in enumerate(coeffs) if c != 0.0),
        key=lambda t: t[0],
    )


def _balanced(values):
    """Exact replay of astlib.balanced_sum over already-evaluated terms."""
    n = len(values)
    if n == 0:
        return 0.0
    if n == 1:
        return values[0]
    mid = n // 2
    return _balanced(values[:mid]) + _balanced(values[mid:])


def eval_terms(terms, v):
    """Bit-faithful replay of the emitted AST's arithmetic at V = v.

    Terms are `c * V**k` multiplied exactly as the AST does, then summed with
    the same balanced-split recursion astlib.balanced_sum produces.  Double
    addition is deterministic, so this is not an approximation of the AST: it
    is the same sequence of operations.
    """
    if not terms:
        return 0.0
    return _balanced([c * (v ** k) for _, k, c in terms])


def eval_coeffs(coeffs, v):
    return eval_terms(ast_terms(coeffs), v)


class TargetSet(object):
    """Pre-computed exact/float data for the enemy points of one round."""

    def __init__(self, xs, length, records):
        self.xs = xs
        self.length = length
        self.records = records
        for rec in records:
            # V exactly as the AST computes it: (1/L) * (x - x_s)
            v = (1.0 / length) * (rec["x"] - xs)
            rec["V"] = v
            rec["dy"] = rec["y"] - rec["ys"]
            rec["Vf"] = Fraction(v)
            rec["dyf"] = Fraction(rec["dy"])

    def _rows(self, idxs):
        return [self.records[i] for i in idxs]

    def exact_fit(self, idxs, extra=False):
        """Exact coefficients for the targets `idxs`.

        Returns (coeffs, family) where `coeffs` is the list [c_1 .. c_K] as
        floats.  With extra=False K = len(idxs); with extra=True there is one
        spare degree and `coeffs` is (c0, c1) satisfying c(t) = c0 + t * c1.
        Returns None when the system is singular.
        """
        rows = self._rows(idxs)
        m = len(rows)
        if m == 0:
            return None
        nodes = [r["Vf"] for r in rows]
        if any(n == 0 for n in nodes):
            return None
        base_vals = [r["dyf"] / r["Vf"] for r in rows]

        if not extra:
            mono = _interpolate(nodes, base_vals)
            if mono is None:
                return None
            # P = V * Q  ->  c_k = mono[k-1]
            coeffs = [float(c) for c in mono]
            return coeffs

        # P(V) = V*Q(V) + t*V^(m+1)  ->  Q(V_i) = dy_i/V_i - t * V_i^m
        part1 = [-(r["Vf"] ** m) for r in rows]
        mono0 = _interpolate(nodes, base_vals)
        mono1 = _interpolate(nodes, part1)
        if mono0 is None or mono1 is None:
            return None
        c0 = [float(c) for c in mono0]
        c1 = [float(c) for c in mono1]
        return (c0, c1)


def refine(idxs_records, coeffs, iterations=3):
    """Richardson-refine float coefficients against the emitted AST arithmetic.

    The exact solve gives the true rational coefficients; rounding them to
    double and replaying the AST's own operation order leaves a residual of a
    few ulp.  Solving the *same* interpolation problem for that residual and
    adding the correction cancels most of it -- usually to the last bit or two.

    `idxs_records` is the list of records used for the fit.  Returns the
    improved coefficient list (same length as `coeffs`).
    """
    if not coeffs:
        return coeffs
    nodes = [r["Vf"] for r in idxs_records]
    cur = list(coeffs)
    for _ in range(iterations):
        terms = ast_terms(cur)
        residual = []
        worst = 0.0
        for rec in idxs_records:
            r = rec["dy"] - eval_terms(terms, rec["V"])
            ar = abs(r)
            if ar > worst:
                worst = ar
            residual.append(r)
        if worst <= REFINE_TOL:
            break
        rhs = [Fraction(r) / rec["Vf"] for r, rec in zip(residual, idxs_records)]
        mono = _interpolate(nodes, rhs)
        if mono is None:
            break
        # `cur` may carry one more (spare-degree) coefficient than `mono`.
        new = [cur[i] + (float(mono[i]) if i < len(mono) else 0.0) for i in range(len(cur))]
        if new == cur:
            break
        cur = new
    return cur


def residual_of(coeffs, records):
    """Worst |f(x_p) - y_p| over `records` using the emitted AST arithmetic."""
    terms = ast_terms(coeffs)
    worst = 0.0
    for rec in records:
        r = abs(rec["dy"] - eval_terms(terms, rec["V"]))
        if r > worst:
            worst = r
    return worst


def coeff_magnitudes(coeffs):
    return max((abs(c) for c in coeffs), default=0.0)


def float_solve2(a11, a12, a21, a22, b1, b2):
    """Exact 2x2 solve used by the trigonometric / composite families."""
    det = Fraction(a11) * Fraction(a22) - Fraction(a12) * Fraction(a21)
    if det == 0:
        return None
    x1 = (Fraction(b1) * Fraction(a22) - Fraction(a12) * Fraction(b2)) / det
    x2 = (Fraction(a11) * Fraction(b2) - Fraction(b1) * Fraction(a21)) / det
    return (float(x1), float(x2))
