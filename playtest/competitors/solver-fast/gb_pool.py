"""gb_pool.py -- the curated, ordered candidate pool.

Strategy shape (from the task specification):

  * every candidate is EXACT by construction -- an interpolating line, quadratic
    or cubic through chosen points, or a 1-parameter shape family solved so that
    it passes through the shooter and one chosen target exactly;
  * the pool is small, ordered by expected value, and walked lazily so the
    caller can stop the instant it holds something good enough.

Families, cheapest and most valuable first:

  1. straight line shooter -> enemy shooter          (assassination: cancels the
                                                      enemy round if we fire first)
  2. straight line shooter -> each alive enemy point
  3. quadratic through shooter + enemy shooter + one more point
  4. quadratic through shooter + two enemy points
  5. one-parameter bend family  f = ys + a u + b u^k,  k in {2,3,4}
     (the main obstacle-evasion tool: no search, just different bend shapes)
  6. cubic through shooter + enemy shooter + two points, and through triples
  7. a single exact sine through the shooter and one target

Nothing here searches: each family is a closed-form solve, so the cost per
candidate is a handful of floating point operations plus the geometry scan.
"""

import math

from gb_dsl import measure, poly_ast, sin_ast
from gb_cand import Cand

# bend magnitudes (mid-chord deviation, y units) tried for the shape family
BEND_KINDS = (2, 3, 4)
BEND_DEV = (2.0, -2.0, 4.0, -4.0, 1.0, -1.0, 6.0, -6.0)
# sine shapes: phi = omega * u_target, kept away from 0 and +-pi
SINE_PHIS = (0.55 * math.pi, 0.85 * math.pi, -0.55 * math.pi, -0.85 * math.pi,
             1.25 * math.pi, -1.25 * math.pi)


def _mkpoly(w, coeffs, targets, tag):
    ast = poly_ast(w.xs, w.ys, coeffs)
    nodes, depth = measure(ast)
    if nodes <= 0 or nodes > 128 or depth > 12:
        return None
    return Cand(0, w.xs, w.ys, coeffs, 0.0, 0.0, ast, nodes, depth, targets, tag)


def _mksin(w, amp, omega, targets, tag):
    ast = sin_ast(w.xs, w.ys, amp, omega)
    nodes, depth = measure(ast)
    if nodes <= 0 or nodes > 128 or depth > 12:
        return None
    return Cand(1, w.xs, w.ys, (0.0, 0.0, 0.0, 0.0), amp, omega, ast, nodes,
                depth, targets, tag)


# ---------------------------------------------------------------------------
# closed-form solves
# ---------------------------------------------------------------------------

def line_coeffs(ut, dy):
    return (dy / ut, 0.0, 0.0, 0.0)


def quad_coeffs(ua, dya, ub, dyb):
    """1 + c2 terms through (ua,dya) and (ub,dyb) with u the shooter offset.

    Solved via the chord slopes s = dy/u, which keeps the conditioning obvious:
        c2 = (sb - sa) / (ub - ua);   c1 = sa - c2*ua
    """
    sa = dya / ua
    sb = dyb / ub
    c2 = (sb - sa) / (ub - ua)
    c1 = sa - c2 * ua
    return (c1, c2, 0.0, 0.0)


def cubic_coeffs(ua, dya, ub, dyb, uc, dyc):
    """solution of c1 + c2 u + c3 u^2 = dy/u at three offsets."""
    sa = dya / ua
    sb = dyb / ub
    sc = dyc / uc
    da = sb - sa
    db = sc - sa
    a = ub - ua
    b = uc - ua
    # c2 + c3*(ub+ua) = da/a ;  c2 + c3*(uc+ua) = db/b
    ka = da / a
    kb = db / b
    c3 = (kb - ka) / (uc - ub)
    c2 = ka - c3 * (ub + ua)
    c1 = sa - c2 * ua - c3 * ua * ua
    return (c1, c2, c3, 0.0)


def bend_coeffs(k, ut, dy, dev):
    """f = ys + a u + b u^k with f(ut) = ys+dy and a mid-chord deviation `dev`."""
    if k == 2:
        b = -4.0 * dev / (ut * ut)
    elif k == 3:
        b = -8.0 * dev / (3.0 * ut * ut * ut)
    else:
        u2 = ut * ut
        b = -16.0 * dev / (7.0 * u2 * u2)
    a = (dy - b * (ut ** k)) / ut
    c = [0.0, 0.0, 0.0, 0.0]
    c[0] = a
    c[k - 1] = b
    return tuple(c)


def _coeff_sane(coeffs, maxc=1000.0):
    for c in coeffs:
        if c != c or c in (float("inf"), float("-inf")):
            return False
        if abs(c) > maxc:
            return False
    return True


# ---------------------------------------------------------------------------
# the pool
# ---------------------------------------------------------------------------

def candidate_pool(w):
    """Yield candidates in priority order.  Lazy: the caller may stop early."""
    xs = w.xs
    ys = w.ys
    ens = w.enemies
    if not ens:
        return
    # order: enemy shooter first (it is worth 2 extra), then by proximity
    ordered = sorted(ens, key=lambda e: (0 if e[4] else 1, e[0]))
    top = ordered[:5]

    # ---- 1. lines (assassination first) ----------------------------------
    for prog, px, py, idx, is_es in ordered:
        ut = px - xs
        if abs(ut) < 1e-6:
            continue
        c = line_coeffs(ut, py - ys)
        if not _coeff_sane(c):
            continue
        cand = _mkpoly(w, c, [(px, py)], "line/es" if is_es else "line")
        if cand is not None:
            yield cand

    # ---- 2. quadratics through the enemy shooter + one more --------------
    es = None
    for e in ordered:
        if e[4]:
            es = e
            break
    if es is not None:
        ue = es[1] - xs
        dye = es[2] - ys
        for prog, px, py, idx, is_es in ordered:
            if is_es:
                continue
            ub = px - xs
            if abs(ue) < 0.3 or abs(ub) < 0.3 or abs(ub - ue) < 0.5:
                continue
            c = quad_coeffs(ue, dye, ub, py - ys)
            if not _coeff_sane(c):
                continue
            cand = _mkpoly(w, c, [(es[1], es[2]), (px, py)], "quad/es+pt")
            if cand is not None:
                yield cand

    # ---- 3. bend family around the most valuable targets -----------------
    for prog, px, py, idx, is_es in top:
        ut = px - xs
        if abs(ut) < 0.3:
            continue
        dy = py - ys
        for k in BEND_KINDS:
            for dev in BEND_DEV:
                c = bend_coeffs(k, ut, dy, dev)
                if not _coeff_sane(c):
                    continue
                cand = _mkpoly(w, c, [(px, py)], "bend k=%d d=%.1f" % (k, dev))
                if cand is not None:
                    yield cand

    # ---- 4. quadratics through pairs of nearby points --------------------
    lim = ordered[:6]
    for i in range(len(lim)):
        for j in range(i + 1, len(lim)):
            pa = lim[i]
            pb = lim[j]
            ua = pa[1] - xs
            ub = pb[1] - xs
            if abs(ua) < 0.3 or abs(ub) < 0.3 or abs(ub - ua) < 0.5:
                continue
            c = quad_coeffs(ua, pa[2] - ys, ub, pb[2] - ys)
            if not _coeff_sane(c):
                continue
            cand = _mkpoly(w, c, [(pa[1], pa[2]), (pb[1], pb[2])],
                           "quad/pair")
            if cand is not None:
                yield cand

    # ---- 5. cubics -------------------------------------------------------
    if es is not None:
        ue = es[1] - xs
        dye = es[2] - ys
        others = [e for e in ordered if not e[4]][:4]
        for i in range(len(others)):
            for j in range(i + 1, len(others)):
                pa = others[i]
                pb = others[j]
                us = (ue, pa[1] - xs, pb[1] - xs)
                dys = (dye, pa[2] - ys, pb[2] - ys)
                if min(abs(us[0]), abs(us[1]), abs(us[2])) < 0.3:
                    continue
                c = cubic_coeffs(us[0], dys[0], us[1], dys[1], us[2], dys[2])
                if not _coeff_sane(c):
                    continue
                cand = _mkpoly(w, c,
                               [(es[1], es[2]), (pa[1], pa[2]), (pb[1], pb[2])],
                               "cubic/es+2")
                if cand is not None:
                    yield cand
    tri = ordered[:4]
    for i in range(len(tri)):
        for j in range(i + 1, len(tri)):
            for k in range(j + 1, len(tri)):
                pa, pb, pc = tri[i], tri[j], tri[k]
                us = (pa[1] - xs, pb[1] - xs, pc[1] - xs)
                if min(abs(us[0]), abs(us[1]), abs(us[2])) < 0.3:
                    continue
                c = cubic_coeffs(us[0], pa[2] - ys, us[1], pb[2] - ys,
                                 us[2], pc[2] - ys)
                if not _coeff_sane(c):
                    continue
                cand = _mkpoly(w, c,
                               [(pa[1], pa[2]), (pb[1], pb[2]), (pc[1], pc[2])],
                               "cubic/triple")
                if cand is not None:
                    yield cand

    # ---- 6. exact sines --------------------------------------------------
    for prog, px, py, idx, is_es in top:
        ut = px - xs
        if abs(ut) < 0.3:
            continue
        dy = py - ys
        for phi in SINE_PHIS:
            omega = phi / ut
            s = math.sin(omega * ut)
            if abs(s) < 0.25:
                continue
            amp = dy / s
            if abs(amp) > 1000.0 or abs(amp) < 1e-9:
                continue
            if abs(omega) * w.ufar > 120.0:
                continue
            cand = _mksin(w, amp, omega, [(px, py)], "sin phi=%.2f" % phi)
            if cand is not None:
                yield cand


def fallback(w):
    """A trivially legal shot, always available: the straight line from the
    shooter to the enemy shooter (or the nearest alive enemy, or the enemy
    centroid).  A legal weak shot beats a TIMEOUT or an INVALID shot."""
    xs = w.xs
    ys = w.ys
    tx = None
    ty = None
    for e in w.enemies:
        if e[4]:
            tx, ty = e[1], e[2]
            break
    if tx is None:
        if not w.enemies:
            return None
        tx = sum(e[1] for e in w.enemies) / len(w.enemies)
        ty = sum(e[2] for e in w.enemies) / len(w.enemies)
    ut = tx - xs
    if abs(ut) < 1e-6:
        return None
    # clamp the slope so the curve stays inside the field
    dy = ty - ys
    slope = dy / ut
    if slope > 1.5:
        slope = 1.5
    elif slope < -1.5:
        slope = -1.5
    c = (slope, 0.0, 0.0, 0.0)
    return _mkpoly(w, c, [(xs + ut, ys + slope * ut)], "fallback")
