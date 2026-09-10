"""Exact interpolation of a curve through chosen targets.

All fits are done on the normalised offset

    V = (x - x_s) / L,   g(V) = f(x) - y_s,   g(0) = 0

so "through our own shooter" is structural rather than a numerical accident.

Polynomial coefficients are solved with ``fractions.Fraction`` and only cast to
float at the very end.  That matters: a float Gauss solve on a near-singular
Vandermonde can leave a ~1e-7 residual at a target, which is inside the 1e-6
hit tolerance but leaves almost no margin.  Exact rationals reduce the residual
to a single final rounding.
"""

from fractions import Fraction

_DENOM = 10 ** 12


def solve_unit_polynomial(vals, dys):
    """Coefficients c_1..c_k with ``sum c_i * V^i == dy`` at every sample.

    ``vals`` are the normalised offsets (none may be zero), ``dys`` the
    matching required rises.  Returns ``[0, c1, ..., ck]`` -- the constant term
    is always zero because g(0) = 0.  Returns None if the system is singular.
    """
    n = len(vals)
    if n == 0:
        return [0.0]
    A = []
    for v, dy in zip(vals, dys):
        vf = Fraction(float(v)).limit_denominator(_DENOM)
        row = [vf ** k for k in range(1, n + 1)]
        row.append(Fraction(float(dy)).limit_denominator(_DENOM))
        A.append(row)

    for col in range(n):
        piv = next((r for r in range(col, n) if A[r][col] != 0), None)
        if piv is None:
            return None
        A[col], A[piv] = A[piv], A[col]
        pv = A[col][col]
        A[col] = [x / pv for x in A[col]]
        for r in range(n):
            if r == col or A[r][col] == 0:
                continue
            f = A[r][col]
            A[r] = [a - f * b for a, b in zip(A[r], A[col])]

    return [0.0] + [float(A[i][n]) for i in range(n)]


def solve_with_fixed_leading(vals, dys, alpha, degree=None):
    """Exact fit through every sample, with the top coefficient pinned to alpha.

    Solving for the leading coefficient instead of pinning it is what destroys
    the fit when targets cluster in V: the Vandermonde becomes near-singular and
    the solved coefficients blow past the |const| <= 1000 rule.  Pinning the
    leading term and solving for the rest keeps the system one degree smaller
    and well behaved, and the pinned value becomes a free knob that sweeps the
    curve around obstacles.

    Returns ``[0, c1, ..., c_{degree-1}, alpha]`` or None.
    """
    n = len(vals)
    if n == 0:
        return [0.0]
    degree = degree if degree is not None else n
    m = degree - 1
    if m <= 0:
        return None
    A = []
    for v, dy in zip(vals, dys):
        vf = Fraction(float(v)).limit_denominator(_DENOM)
        row = [vf ** k for k in range(1, m + 1)]
        rhs = Fraction(float(dy)).limit_denominator(_DENOM) - \
            Fraction(float(alpha)).limit_denominator(_DENOM) * vf ** degree
        row.append(rhs)
        A.append(row)
    if len(A) != m:
        return None
    for col in range(m):
        piv = next((r for r in range(col, m) if A[r][col] != 0), None)
        if piv is None:
            return None
        A[col], A[piv] = A[piv], A[col]
        pv = A[col][col]
        A[col] = [x / pv for x in A[col]]
        for r in range(m):
            if r == col or A[r][col] == 0:
                continue
            f = A[r][col]
            A[r] = [a - f * b for a, b in zip(A[r], A[col])]
    coeffs = [0.0] + [float(A[i][m]) for i in range(m)] + [float(alpha)]
    return coeffs


def well_spaced(vals, min_gap=0.05):
    """Conditioning guard: are the sample offsets far enough apart to fit?"""
    vs = sorted(float(v) for v in vals)
    return all(vs[i + 1] - vs[i] >= min_gap for i in range(len(vs) - 1))


def solve_line(v, dy):
    """g(V) = c1 * V hitting one target exactly."""
    if abs(float(v)) < 1e-12:
        return None
    return [0.0, float(dy) / float(v)]


def resample_poly(coeffs, vals):
    """Evaluate sum c_i V^i exactly enough to report a residual."""
    out = []
    for v in vals:
        v = float(v)
        acc = 0.0
        for k in range(len(coeffs) - 1, -1, -1):
            acc = acc * v + coeffs[k]
        out.append(acc)
    return out
