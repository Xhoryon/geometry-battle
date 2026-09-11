"""Candidate families, ordered from cheapest/most tactical to most expensive.

The split mirrors the design brief:

  Stage 1  tactical, closed form, a handful of solves -- the enemy-shooter
           assassination line and its immediate variants
  Stage 2  exact fits through small target combinations plus the parametric
           bend / trigonometric / composite families
  Stage 3  larger combinations and local refinement of whatever is winning

Every generator yields ``Candidate`` objects lazily; the orchestrator stops
consuming a generator as soon as its budget or early-return condition fires, so
cost is paid only for candidates actually looked at.
"""

import itertools
import math

from . import dsl as D
from .fit import solve_unit_polynomial, solve_line, solve_with_fixed_leading, well_spaced


class Candidate(object):
    __slots__ = ("ast", "tag", "meta", "nodes", "depth", "cost")

    def __init__(self, ast, tag, meta=None, cost=0):
        self.ast = ast
        self.tag = tag
        self.meta = meta or {}
        self.cost = cost
        ok, why = D.structural_ok(ast)
        if ok:
            self.nodes, self.depth = D.measure(ast)
        else:
            self.nodes = self.depth = -1
            self.meta["structural"] = why

    @property
    def usable(self):
        return self.nodes > 0


def _targets(w):
    """Enemy targets in the shooter frame, enemy shooter first."""
    esid = w.enemy_shooter_id()
    ts = []
    for p in w.enemies:
        v = (p["x"] - w.xs) / w.L
        d = p["y"] - w.ys
        ts.append({"id": p["id"], "v": v, "dy": d, "x": p["x"], "y": p["y"],
                   "is_shooter": p["id"] == esid})
    ts.sort(key=lambda t: (not t["is_shooter"], abs(t["v"])))
    return ts


def _from_coeffs(w, coeffs, tag, meta=None):
    if coeffs is None:
        return None
    if all(abs(c) <= D.MAX_CONST for c in coeffs):
        ast = D.horner(w.ys, w.xs, w.L, coeffs)
        ok, _why = D.structural_ok(ast)
        if ok:
            return Candidate(ast, tag, meta)
    ast = D.monomials(w.ys, w.xs, w.L, coeffs)
    ok, _why = D.structural_ok(ast)
    if ok:
        return Candidate(ast, tag, meta)
    return None


# ---------------------------------------------------------------------------
# Stage 1 -- tactical
# ---------------------------------------------------------------------------


def stage1(w):
    """Cheap, closed-form tactical shots.  Ordered by expected value."""
    ts = _targets(w)

    # 1. the assassination line: straight at the enemy shooter
    for t in ts:
        if t["is_shooter"]:
            c = _from_coeffs(w, solve_line(t["v"], t["dy"]), "line:shooter",
                             {"targets": [t["id"]]})
            if c:
                yield c

    # 2. a straight line at each remaining enemy
    for t in ts:
        if not t["is_shooter"]:
            c = _from_coeffs(w, solve_line(t["v"], t["dy"]), "line:%s" % t["id"],
                             {"targets": [t["id"]]})
            if c:
                yield c

    # 3. quadratics through (enemy shooter + one more) -- exact two-kill
    sh = [t for t in ts if t["is_shooter"]]
    rest = [t for t in ts if not t["is_shooter"]]
    if sh:
        s0 = sh[0]
        for t in rest:
            coeffs = solve_unit_polynomial([s0["v"], t["v"]], [s0["dy"], t["dy"]])
            c = _from_coeffs(w, coeffs, "quad:shooter+%s" % t["id"],
                             {"targets": [s0["id"], t["id"]]})
            if c:
                yield c
            coeffs = solve_unit_polynomial([t["v"], s0["v"]], [t["dy"], s0["dy"]])
            c = _from_coeffs(w, coeffs, "quad:%s+shooter" % t["id"],
                             {"targets": [t["id"], s0["id"]]})
            if c:
                yield c

    # 4. one-parameter bend family through a single target: degree 2 with a
    #    free leading coefficient.  Zero extra solve cost, and the extra
    #    curvature is a free obstacle-avoidance knob (the brief's point).
    for t in ts[:4]:
        v, dy = t["v"], t["dy"]
        if abs(v) < 1e-9:
            continue
        a1 = dy / v
        for alpha in (-1.5, -0.75, -0.35, 0.0, 0.35, 0.75, 1.5):
            c1 = a1 * (1.0 - alpha)
            c2 = a1 * alpha / v
            c = _from_coeffs(w, [0.0, c1, c2], "bend:%s/a=%.2f" % (t["id"], alpha),
                             {"targets": [t["id"]], "alpha": alpha})
            if c:
                yield c


# ---------------------------------------------------------------------------
# Stage 2 -- multi-target exact fits + parametric families
# ---------------------------------------------------------------------------


def stage2_subsets(w, max_k=3):
    """Exact polynomial fits through every combination up to ``max_k`` points.

    Combinations containing the enemy shooter come first, because a shot that
    removes the opponent's shooter also removes their whole round.
    """
    ts = _targets(w)
    if not ts:
        return
    sh = [t for t in ts if t["is_shooter"]]
    rest = [t for t in ts if not t["is_shooter"]]
    combos = []
    for k in range(2, max_k + 1):
        for extra in itertools.combinations(rest, k - 1):
            if sh:
                combos.append((sh[0],) + extra)
        for sub in itertools.combinations(rest, k):
            combos.append(sub)
    for sub in combos:
        vals = [t["v"] for t in sub]
        dys = [t["dy"] for t in sub]
        if any(abs(v) < 1e-12 for v in vals):
            continue
        # Targets that are nearly coincident in V make the Vandermonde
        # singular and the solved coefficients explode past the |const|
        # <= 1000 rule.  Skip them instead of paying for a doomed solve.
        if not well_spaced(vals):
            continue
        coeffs = solve_unit_polynomial(vals, dys)
        c = _from_coeffs(w, coeffs, "poly%d:%s" % (len(sub), "+".join(t["id"] for t in sub)),
                         {"targets": [t["id"] for t in sub]})
        if c:
            yield c


def stage2_trig(w):
    """y_s + a*sin(b*V) and y_s + a*V + b*sin(c*V) through one target."""
    ts = _targets(w)
    for t in ts[:3]:
        v, dy = t["v"], t["dy"]
        if abs(v) < 1e-9:
            continue
        for b in (0.5, 1.0, 1.5707963267948966, 2.0, 3.0):
            s = math.sin(b * v)
            if abs(s) < 1e-2:
                continue
            a = dy / s
            if abs(a) > D.MAX_CONST:
                continue
            ast = D.add(D.number(w.ys),
                        D.mul(D.number(a), D.sin(D.mul(D.number(b), D.v_offset(w.xs, w.L)))))
            c = Candidate(ast, "sin:%s/b=%.2f" % (t["id"], b), {"targets": [t["id"]]})
            if c.usable:
                yield c
    for t in ts[:3]:
        v, dy = t["v"], t["dy"]
        if abs(v) < 1e-9:
            continue
        for c3 in (0.5, 1.0, 2.0):
            s = math.sin(c3 * v)
            if abs(s) < 1e-2:
                continue
            b = (dy - v) / s
            if abs(b) > D.MAX_CONST:
                continue
            V = D.v_offset(w.xs, w.L)
            ast = D.add(D.number(w.ys),
                        D.add(D.mul(D.number(1.0), V),
                              D.mul(D.number(b), D.sin(D.mul(D.number(c3), V)))))
            cand = Candidate(ast, "sinmix:%s/c=%.2f" % (t["id"], c3),
                             {"targets": [t["id"]]})
            if cand.usable:
                yield cand


def stage2_composite(w):
    """a*V + b*(exp(c*V) - 1) and a*V + b*(sqrt(1 + c*V) - 1)."""
    ts = _targets(w)
    for t in ts[:3]:
        v, dy = t["v"], t["dy"]
        if abs(v) < 1e-9:
            continue
        for cc in (-2.0, -1.0, -0.5, 0.5, 1.0, 2.0):
            try:
                e = math.exp(cc * v) - 1.0
            except Exception:
                continue
            if abs(e) < 1e-6:
                continue
            b = (dy - v) / e
            if abs(b) > D.MAX_CONST:
                continue
            V = D.v_offset(w.xs, w.L)
            ast = D.add(D.number(w.ys),
                        D.add(V, D.mul(D.number(b),
                                       D.sub(D.exp(D.mul(D.number(cc), V)),
                                             D.number(1.0)))))
            cand = Candidate(ast, "expmix:%s/c=%.2f" % (t["id"], cc),
                             {"targets": [t["id"]]})
            if cand.usable:
                yield cand
        for cc in (-0.5, -0.25, 0.25, 0.5):
            if 1.0 + cc * v <= 1e-6:
                continue
            e = math.sqrt(1.0 + cc * v) - 1.0
            if abs(e) < 1e-6:
                continue
            b = (dy - v) / e
            if abs(b) > D.MAX_CONST:
                continue
            V = D.v_offset(w.xs, w.L)
            ast = D.add(D.number(w.ys),
                        D.add(V, D.mul(D.number(b),
                                       D.sub(D.sqrt(D.add(D.number(1.0),
                                                          D.mul(D.number(cc), V))),
                                             D.number(1.0)))))
            cand = Candidate(ast, "sqrtmix:%s/c=%.2f" % (t["id"], cc),
                             {"targets": [t["id"]]})
            if cand.usable:
                yield cand


# ---------------------------------------------------------------------------
# Stage 3 -- refinement
# ---------------------------------------------------------------------------


_ALPHAS = (-6.0, -3.0, -1.6, -0.8, -0.35, 0.35, 0.8, 1.6, 3.0, 6.0)


def stage3_larger(w, max_k=5):
    """Exact fits through bigger, well-spaced target combinations."""
    ts = _targets(w)
    sh = [t for t in ts if t["is_shooter"]]
    rest = [t for t in ts if not t["is_shooter"]]
    combos = []
    for k in range(4, max_k + 1):
        for extra in itertools.combinations(rest, k - 1):
            if sh:
                combos.append((sh[0],) + extra)
    for sub in combos:
        vals = [t["v"] for t in sub]
        if any(abs(v) < 1e-12 for v in vals) or not well_spaced(vals, 0.06):
            continue
        coeffs = solve_unit_polynomial(vals, [t["dy"] for t in sub])
        c = _from_coeffs(w, coeffs,
                         "poly%d:%s" % (len(sub), "+".join(t["id"] for t in sub)),
                         {"targets": [t["id"] for t in sub]})
        if c:
            yield c


def stage3_free_leading(w, size=3, alphas=_ALPHAS):
    """Exact through ``size`` targets with the leading coefficient as a free knob.

    This is the well-conditioned way to spend the remaining time.  Instead of
    demanding an exact fit through a larger, clustered set (which is numerically
    hopeless -- the solved coefficients blow past the |const| <= 1000 rule), we
    hold the curve through the targets we care about and sweep the one remaining
    degree of freedom.  Each alpha is a different amount of curvature, which is
    exactly the obstacle-avoidance knob the tactical family uses, generalised to
    more pinned targets.
    """
    ts = _targets(w)
    sh = [t for t in ts if t["is_shooter"]]
    rest = [t for t in ts if not t["is_shooter"]]
    combos = []
    for k in (size, size + 1):
        for extra in itertools.combinations(rest, k - 1):
            if sh:
                combos.append((sh[0],) + extra)
    for sub in combos:
        vals = [t["v"] for t in sub]
        dys = [t["dy"] for t in sub]
        if any(abs(v) < 1e-12 for v in vals) or not well_spaced(vals, 0.04):
            continue
        for alpha in alphas:
            coeffs = solve_with_fixed_leading(vals, dys, alpha, degree=len(sub) + 1)
            c = _from_coeffs(
                w, coeffs,
                "lead%d:a=%.2f:%s" % (len(sub), alpha, "+".join(t["id"] for t in sub)),
                {"targets": [t["id"] for t in sub], "alpha": alpha})
            if c:
                yield c


def stage3_refine(w, best_meta, alphas=_ALPHAS):
    """Local sweep around whatever family is currently winning.

    Refines the bend parameter of the winning candidate rather than restarting,
    so the last few milliseconds go into sharpening the answer instead of
    resampling the whole space.
    """
    tag = best_meta.get("tag") or ""
    if not tag.startswith("bend:"):
        return
    target = best_meta.get("targets") or []
    if not target:
        return
    ts = {t["id"]: t for t in _targets(w)}
    t = ts.get(target[0])
    if t is None or abs(t["v"]) < 1e-9:
        return
    v, dy = t["v"], t["dy"]
    a1 = dy / v
    base = float(best_meta.get("alpha") or 0.0)
    for i in range(1, 25):
        for sign in (-1.0, 1.0):
            alpha = base + sign * i * 0.12
            if abs(alpha) > 8.0:
                continue
            c1 = a1 * (1.0 - alpha)
            c2 = a1 * alpha / v
            c = _from_coeffs(w, [0.0, c1, c2],
                             "bend:%s/a=%.3f" % (t["id"], alpha),
                             {"targets": [t["id"]], "alpha": alpha})
            if c:
                yield c
