"""gb_screen.py -- our own legality screen over the attack interval.

Two levels:

  cheap_screen(cand, world)  closed-form scan over a coarse grid.  Runs on every
                             candidate the pool produces; rejects the hopeless
                             ones before they reach the (more expensive)
                             geometry scan.
  full_screen(cand, world)   AST-level scan over a dense grid, on the candidate
                             we are actually about to emit.  This is the one
                             that gates emission: nothing leaves this solver
                             without passing it.

Checks mirror competitor-kit/DSL_SPECIFICATION.md section 7:
finite, |f| <= 1e6, |f'| <= 1e10, convexity sign changes <= 100, sampler budget
(we bound oscillation analytically instead of counting samples), plus the
structural limits nodes <= 128 / depth <= 12 / |constant| <= 1000.
"""

import math

from gb_dsl import eval_ast, structural_ok

F_MAX = 1e6
DF_MAX = 1e10
CONVEXITY_MAX = 100
# the anti-aliasing sampler budget is 400000 points; a curve whose total phase
# span is bounded by this cannot come anywhere near it.
MAX_PHASE_SPAN = 120.0


def _coeff_stats(cand, u0, u1, n):
    """max |g|, max |g'|, convexity sign changes of the closed form."""
    c = cand.c
    c1, c2, c3, c4 = c[0], c[1], c[2], c[3]
    if cand.kind != 0:
        amp = cand.amp
        om = cand.omega
        phase = om * (u1 - u0)
        sign_changes = int(abs(phase) / math.pi) + 2
        return (abs(amp), abs(amp * om), sign_changes)
    span = u1 - u0
    if span < 0.0:
        span = -span
    step = span / n if n else span
    max_g = 0.0
    max_d = 0.0
    prev_s = 0
    changes = 0
    u = u0
    for _ in range(n + 1):
        # g(u)
        g = u * (c1 + u * (c2 + u * (c3 + u * c4)))
        if g < 0.0:
            g = -g
        if g > max_g:
            max_g = g
        d = c1 + u * (2.0 * c2 + u * (3.0 * c3 + u * 4.0 * c4))
        if d < 0.0:
            d = -d
        if d > max_d:
            max_d = d
        s = 2.0 * c2 + u * (6.0 * c3 + u * 12.0 * c4)
        if s > 1e-9:
            sg = 1
        elif s < -1e-9:
            sg = -1
        else:
            sg = 0
        if sg != 0:
            if prev_s != 0 and sg != prev_s:
                changes += 1
            prev_s = sg
        u += step
    return max_g, max_d, changes


def cheap_screen(cand, xs, x0, x1):
    """(ok, reason).  Coarse closed-form scan; never emits anything itself."""
    ok, why = structural_ok(cand.ast)
    if not ok:
        return False, why
    if not (xs == xs):
        return False, "BAD_VALUE"
    u0 = x0 - xs
    u1 = x1 - xs
    max_g, max_d, changes = _coeff_stats(cand, u0, u1, 48)
    if not (max_g == max_g) or not (max_d == max_d):
        return False, "NOT_FINITE"
    if max_g + abs(cand.ys) > F_MAX:
        return False, "NOT_FINITE"
    if max_d > DF_MAX:
        return False, "NOT_C2"
    if changes > CONVEXITY_MAX:
        return False, "CONVEXITY_LIMIT"
    return True, "OK"


def full_screen(cand, xs, x0, x1, samples=401):
    """Dense AST-level screen.  Gates emission."""
    ok, why = structural_ok(cand.ast)
    if not ok:
        return False, why
    if cand.nodes > 128 or cand.depth > 12:
        return False, "NODE_LIMIT"
    span = x1 - x0
    if span == 0.0:
        span = 1.0
    step = span / samples
    x = x0
    for _ in range(samples + 1):
        v = eval_ast(cand.ast, x)
        if v != v or v == float("inf") or v == float("-inf"):
            return False, "NOT_FINITE"
        if v > F_MAX or v < -F_MAX:
            return False, "NOT_FINITE"
        x += step
    max_g, max_d, changes = _coeff_stats(cand, x0 - xs, x1 - xs, samples)
    if max_d > DF_MAX:
        return False, "NOT_C2"
    if changes > CONVEXITY_MAX:
        return False, "CONVEXITY_LIMIT"
    if cand.kind != 0 and abs(cand.omega) * abs(span) > MAX_PHASE_SPAN:
        return False, "OSCILLATION_LIMIT"
    return True, "OK"
