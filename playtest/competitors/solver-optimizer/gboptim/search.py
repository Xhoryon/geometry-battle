"""The time-budgeted strategy search.

Strategy, in priority order
---------------------------
  1. a legal function everywhere (the fallback is built first and is always
     legal),
  2. maximise effective kills (points strictly ahead and strictly before the
     trajectory's first obstacle contact),
  3. multi-kill (exact interpolation through a chosen subset),
  4. shooter kill (the enemy shooter is looked up from the reveal data and is
     the first greedy seed),
  5. obstacle threading (clearance enters the score),
  6. widen the search as far as the official timeout allows.

Families searched
-----------------
  polynomials   ys + sum_k c_k V^k, V = (x - x_s)/L; subset selection by
                greedy seeding, local swap refinement and randomised restarts,
                plus a spare-degree sweep (one exact one-parameter family per
                subset) used to thread obstacles.
  trigonometric ys + a*sin(b*u) and ys + a*sin(b*u) + c*(1 - cos(d*u)), plus
                ys + a*u + c*sin(b*u); 1- and 2-point exact fits with the
                frequency swept over a guarded grid.
  composite     ys + a*u + b*(exp(c*u) - 1) and ys + a*u + b*(sqrt(1+c*u) - 1);
                linear in (a, b) for a swept shape parameter c, with explicit
                domain guards so exp cannot overflow and sqrt/log never see a
                non-positive argument.

All multi-target fits are solved in exact rational arithmetic (fractions) and
then re-verified against the arithmetic of the serialised AST.
"""

import math
import random
import time

from . import astlib, fit, scoring
from .evaluator import compile_value, compile_derivs

RESIDUAL_TOL = scoring.RESIDUAL_TOL
CHEAP_SCREEN = 48
CHEAP_CONTACT = 64
DENSE_SCREEN = 385
DENSE_CONTACT = 768
FINAL_SCREEN = 1025
FINAL_CONTACT = 2048

# Frequency grid for the trigonometric families, in half periods across the
# attack interval.  Kept small so the anti-aliasing sampler and the convexity
# counter are never stressed.
KS = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0)
# Shape grid for the composite families, as c * L.
EXPO_CL = (-3.0, -2.0, -1.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0)
SQRT_CL = (-0.9, -0.7, -0.5, -0.3, 0.25, 0.5, 1.0, 2.0, 4.0)


class Curve(object):
    """A candidate: the real AST plus the fast evaluator used to scan it."""

    __slots__ = ("ast", "fn", "deriv", "recs", "tag")

    def __init__(self, ast, fn, deriv, recs, tag):
        self.ast = ast
        self.fn = fn
        self.deriv = deriv
        self.recs = recs
        self.tag = tag


def make_poly_fast(coeffs, xs, ys, s):
    """Horner evaluator for ys + sum_k c_k V^k with V = s*(x - xs).

    Used for scanning only.  It is a faithful (a few ulp) model of the emitted
    AST, not a different function; the emitted candidate is always re-checked
    with the compiled AST before it can become the incumbent.
    """
    n = len(coeffs)
    c = [0.0] * (n + 1)
    for i in range(n):
        c[i + 1] = float(coeffs[i])

    def fn(x, c=c, xs=xs, ys=ys, s=s, n=n):
        v = s * (x - xs)
        p = c[n]
        for k in range(n - 1, -1, -1):
            p = p * v + c[k]
        return ys + p

    def deriv(x, c=c, xs=xs, ys=ys, s=s, n=n):
        v = s * (x - xs)
        p = c[n]
        dp = 0.0
        ddp = 0.0
        for k in range(n - 1, -1, -1):
            ddp = ddp * v + 2.0 * dp
            dp = dp * v + p
            p = p * v + c[k]
        return (ys + p, dp * s, ddp * s * s)

    return fn, deriv


def fallback_ast(ctx):
    """A straight line that is legal by construction -- the safety net.

    Aimed at the enemy shooter (known exactly from the reveal data), else at
    the enemy centroid, and finally flattened to keep it inside the field.  A
    straight line is C-infinity, has zero convexity sign changes and needs
    almost no sampler resolution, so it can never fail the legality screen.
    """
    ys, xs, length = ctx.ys, ctx.xs, ctx.length
    target = None
    for rec in ctx.records:
        if rec["is_shooter"]:
            target = rec
            break
    if target is None and ctx.records:
        cx = sum(r["x"] for r in ctx.records) / len(ctx.records)
        cy = sum(r["y"] for r in ctx.records) / len(ctx.records)
        target = {"x": cx, "y": cy}
    if target is None:
        return astlib.poly_ast(ys, xs, length, [0.0])

    dx = target["x"] - xs
    dy = target["y"] - ys
    slope = dy / dx if abs(dx) > 1e-9 else 0.0
    ymin, ymax = ctx.map_bounds[2], ctx.map_bounds[3]
    reach = ctx.direction * length
    end_y = ys + slope * reach
    if end_y > ymax:
        slope = (ymax - ys) / reach
    elif end_y < ymin:
        slope = (ymin - ys) / reach
    c1 = slope * length
    if c1 > 999.0:
        c1 = 999.0
    elif c1 < -999.0:
        c1 = -999.0
    return astlib.poly_ast(ys, xs, length, [c1])


class Searcher(object):
    def __init__(self, ctx, deadline, seed):
        self.ctx = ctx
        self.deadline = deadline
        self.rng = random.Random(seed)
        self.targets = [r for r in ctx.records if r["ahead"] > 0.0]
        self.ts = fit.TargetSet(ctx.xs, ctx.length, self.targets) if self.targets else None
        self.best_ast = None
        self.best_score = None
        self.best_residual = None
        self.cheap_key = None
        self.stats = {
            "candidates": 0,
            "fits": 0,
            "adopted": 0,
            "phase": "-",
        }

    # ------------------------------------------------------------------
    # budget
    # ------------------------------------------------------------------
    def out_of_time(self):
        return time.perf_counter() >= self.deadline

    # ------------------------------------------------------------------
    # incumbent management
    # ------------------------------------------------------------------
    def consider(self, ast, fn, deriv, recs):
        """Cheap score; on a new best, re-verify with the real AST first."""
        if ast is None or self.out_of_time():
            return None
        self.stats["candidates"] += 1
        meta = scoring.screen_deriv(deriv, self.ctx, samples=CHEAP_SCREEN)
        if meta is None:
            return None
        meta["nodes"] = astlib.node_count(ast)
        meta["depth"] = astlib.depth(ast)
        sc = scoring.evaluate(
            ast,
            self.ctx,
            fn=fn,
            deriv=deriv,
            meta=meta,
            contact_samples=CHEAP_CONTACT,
            screen_samples=CHEAP_SCREEN,
        )
        if sc is None:
            return None
        key = sc.key()
        if self.cheap_key is None or key > self.cheap_key:
            self.cheap_key = key
            self.adopt(ast, recs)
        return sc

    def adopt(self, ast, recs):
        """Dense re-verification of a new incumbent, with the compiled AST."""
        meta = scoring.screen(ast, self.ctx, samples=DENSE_SCREEN)
        if meta is None:
            return False
        try:
            fn = compile_value(ast)
        except Exception:
            return False
        residual = None
        if recs:
            residual = scoring.worst_residual(fn, recs)
            if residual is None or residual > RESIDUAL_TOL:
                return False
        sc = scoring.evaluate(
            ast,
            self.ctx,
            fn=fn,
            meta=meta,
            contact_samples=DENSE_CONTACT,
            screen_samples=DENSE_SCREEN,
        )
        if sc is None:
            return False
        if residual is not None:
            sc.residual = residual
        if self.best_score is None or sc.key() > self.best_score.key():
            self.best_ast = ast
            self.best_score = sc
            self.best_residual = residual
            self.stats["adopted"] += 1
            return True
        return False

    def finalize(self, fallback):
        """Densest possible check of the winner; fall back if it fails."""
        ast = self.best_ast
        if ast is not None:
            meta = scoring.screen(ast, self.ctx, samples=FINAL_SCREEN)
            if meta is not None:
                try:
                    fn = compile_value(ast)
                except Exception:
                    fn = None
                if fn is not None:
                    sc = scoring.evaluate(
                        ast,
                        self.ctx,
                        fn=fn,
                        meta=meta,
                        contact_samples=FINAL_CONTACT,
                        screen_samples=FINAL_SCREEN,
                    )
                    if sc is not None:
                        self.best_score = sc
                        return ast, sc
        return fallback, None

    # ------------------------------------------------------------------
    # polynomial family
    # ------------------------------------------------------------------
    def poly_curve(self, idxs, extra_t=None):
        recs = [self.targets[i] for i in idxs]
        if extra_t is None:
            coeffs = self.ts.exact_fit(idxs)
            self.stats["fits"] += 1
            if coeffs is None:
                return None
            if fit.coeff_magnitudes(coeffs) > astlib.CONST_LIMIT:
                return None
            coeffs = fit.refine(recs, coeffs)
            if fit.coeff_magnitudes(coeffs) > astlib.CONST_LIMIT:
                return None
            if fit.residual_of(coeffs, recs) > RESIDUAL_TOL:
                return None
        else:
            pair = self.ts.exact_fit(idxs, extra=True)
            self.stats["fits"] += 1
            if pair is None:
                return None
            c0, c1 = pair
            # c(t) = c0 + t*c1 for the fitted degrees, and the spare degree
            # itself carries the free parameter t.
            coeffs = [a + extra_t * b for a, b in zip(c0, c1)] + [extra_t]
            if fit.coeff_magnitudes(coeffs) > astlib.CONST_LIMIT:
                return None
            coeffs = fit.refine(recs, coeffs)
            if fit.coeff_magnitudes(coeffs) > astlib.CONST_LIMIT:
                return None
            if fit.residual_of(coeffs, recs) > RESIDUAL_TOL:
                return None
        ast = astlib.poly_ast(self.ctx.ys, self.ctx.xs, self.ctx.length, coeffs)
        if not astlib.structural_ok(ast):
            return None
        fn, deriv = make_poly_fast(
            coeffs, self.ctx.xs, self.ctx.ys, 1.0 / self.ctx.length
        )
        return Curve(ast, fn, deriv, recs, "poly")

    def try_poly(self, idxs, extra_t=None):
        curve = self.poly_curve(idxs, extra_t)
        if curve is None:
            return None
        return self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    # ------------------------------------------------------------------
    # non-polynomial families
    # ------------------------------------------------------------------
    def _curve_from_ast(self, ast, recs, tag):
        try:
            fn = compile_value(ast)
            deriv = compile_derivs(ast)
        except Exception:
            return None
        return Curve(ast, fn, deriv, recs, tag)

    def trig1_sweep(self, i):
        rec = self.targets[i]
        xs, ys = self.ctx.xs, self.ctx.ys
        u = rec["x"] - xs
        dy = rec["y"] - ys
        length = self.ctx.length
        for k in KS:
            if self.out_of_time():
                return
            b = k * math.pi / length
            s = math.sin(b * u)
            if abs(s) < 1e-9:
                continue
            a = dy / s
            if abs(a) > astlib.CONST_LIMIT:
                continue
            ast = astlib.trig_ast(ys, xs, a, b)
            if not astlib.structural_ok(ast):
                continue
            curve = self._curve_from_ast(ast, [rec], "trig1")
            if curve is None:
                continue
            if scoring.worst_residual(curve.fn, [rec]) > RESIDUAL_TOL:
                continue
            self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    def trig2_sweep(self, i, j):
        """ys + a*sin(b*u) + c*(1 - cos(d*u)) through two exact targets."""
        ri, rj = self.targets[i], self.targets[j]
        xs, ys = self.ctx.xs, self.ctx.ys
        length = self.ctx.length
        ui, uj = ri["x"] - xs, rj["x"] - xs
        di, dj = ri["y"] - ys, rj["y"] - ys
        for kb in KS:
            if self.out_of_time():
                return
            b = kb * math.pi / length
            sbi, sbj = math.sin(b * ui), math.sin(b * uj)
            for kd in KS:
                d = kd * math.pi / length
                ci, cj = 1.0 - math.cos(d * ui), 1.0 - math.cos(d * uj)
                solved = fit.float_solve2(sbi, ci, sbj, cj, di, dj)
                if solved is None:
                    continue
                a, c = solved
                if abs(a) > astlib.CONST_LIMIT or abs(c) > astlib.CONST_LIMIT:
                    continue
                ast = astlib.trig_ast(ys, xs, a, b, c, d)
                if not astlib.structural_ok(ast):
                    continue
                curve = self._curve_from_ast(ast, [ri, rj], "trig2")
                if curve is None:
                    continue
                if scoring.worst_residual(curve.fn, [ri, rj]) > RESIDUAL_TOL:
                    continue
                self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    def trig_lin_sweep(self, i, j):
        """ys + a*u + c*sin(b*u) through two exact targets."""
        ri, rj = self.targets[i], self.targets[j]
        xs, ys = self.ctx.xs, self.ctx.ys
        length = self.ctx.length
        ui, uj = ri["x"] - xs, rj["x"] - xs
        di, dj = ri["y"] - ys, rj["y"] - ys
        for kb in KS:
            if self.out_of_time():
                return
            b = kb * math.pi / length
            solved = fit.float_solve2(ui, math.sin(b * ui), uj, math.sin(b * uj), di, dj)
            if solved is None:
                continue
            a, c = solved
            if abs(a) > astlib.CONST_LIMIT or abs(c) > astlib.CONST_LIMIT:
                continue
            # ys + a*u + c*sin(b*u)
            ast = astlib.add(
                astlib.num(ys),
                astlib.add(
                    astlib.mul(astlib.num(a), astlib.sub(astlib.var(), astlib.num(xs))),
                    astlib.mul(
                        astlib.num(c),
                        astlib.fn1(
                            "sin",
                            astlib.mul(astlib.num(b), astlib.sub(astlib.var(), astlib.num(xs))),
                        ),
                    ),
                ),
            )
            if not astlib.structural_ok(ast):
                continue
            curve = self._curve_from_ast(ast, [ri, rj], "triglin")
            if curve is None:
                continue
            if scoring.worst_residual(curve.fn, [ri, rj]) > RESIDUAL_TOL:
                continue
            self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    def exp_sweep(self, i, j):
        ri, rj = self.targets[i], self.targets[j]
        xs, ys = self.ctx.xs, self.ctx.ys
        length = self.ctx.length
        ui, uj = ri["x"] - xs, rj["x"] - xs
        di, dj = ri["y"] - ys, rj["y"] - ys
        for cl in EXPO_CL:
            if self.out_of_time():
                return
            c = cl / length
            ei, ej = math.exp(c * ui) - 1.0, math.exp(c * uj) - 1.0
            solved = fit.float_solve2(ui, ei, uj, ej, di, dj)
            if solved is None:
                continue
            a, b = solved
            if abs(a) > astlib.CONST_LIMIT or abs(b) > astlib.CONST_LIMIT:
                continue
            ast = astlib.exp_ast(ys, xs, a, b, c)
            if not astlib.structural_ok(ast):
                continue
            curve = self._curve_from_ast(ast, [ri, rj], "exp")
            if curve is None:
                continue
            if scoring.worst_residual(curve.fn, [ri, rj]) > RESIDUAL_TOL:
                continue
            self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    def sqrt_sweep(self, i, j):
        ri, rj = self.targets[i], self.targets[j]
        xs, ys = self.ctx.xs, self.ctx.ys
        length = self.ctx.length
        ui, uj = ri["x"] - xs, rj["x"] - xs
        di, dj = ri["y"] - ys, rj["y"] - ys
        # x - x_s spans [0, L] for team A and [-L, 0] for team B; the sqrt
        # argument 1 + c*(x - x_s) is linear, so its minimum sits at an end.
        span_min = min(0.0, self.ctx.direction * length)
        for cl in SQRT_CL:
            if self.out_of_time():
                return
            c = cl / length
            if 1.0 + c * span_min <= 1e-6:
                continue
            si = math.sqrt(1.0 + c * ui) - 1.0
            sj = math.sqrt(1.0 + c * uj) - 1.0
            solved = fit.float_solve2(ui, si, uj, sj, di, dj)
            if solved is None:
                continue
            a, b = solved
            if abs(a) > astlib.CONST_LIMIT or abs(b) > astlib.CONST_LIMIT:
                continue
            ast = astlib.sqrt_ast(ys, xs, a, b, c)
            if not astlib.structural_ok(ast):
                continue
            curve = self._curve_from_ast(ast, [ri, rj], "sqrt")
            if curve is None:
                continue
            if scoring.worst_residual(curve.fn, [ri, rj]) > RESIDUAL_TOL:
                continue
            self.consider(curve.ast, curve.fn, curve.deriv, curve.recs)

    # ------------------------------------------------------------------
    # subset search
    # ------------------------------------------------------------------
    def greedy(self, order):
        chosen = []
        best_key = None
        for idx in order:
            if self.out_of_time():
                break
            trial = chosen + [idx]
            sc = self.try_poly(trial)
            if sc is None:
                continue
            if best_key is None or sc.key() > best_key:
                chosen = trial
                best_key = sc.key()
        return chosen

    def refine_subset(self, start, rounds=3):
        best = list(start)
        sc = self.try_poly(best)
        best_key = sc.key() if sc is not None else None
        n = len(self.targets)
        for _ in range(rounds):
            improved = False
            for j in range(len(best)):
                if self.out_of_time():
                    return best
                trial = best[:j] + best[j + 1:]
                if not trial:
                    continue
                s = self.try_poly(trial)
                if s is not None and (best_key is None or s.key() > best_key):
                    best, best_key, improved = trial, s.key(), True
            for idx in range(n):
                if self.out_of_time():
                    return best
                if idx in best:
                    continue
                trial = best + [idx]
                s = self.try_poly(trial)
                if s is not None and (best_key is None or s.key() > best_key):
                    best, best_key, improved = trial, s.key(), True
            if not improved:
                break
        return best

    def spare_degree(self, idxs, deadline):
        """Sweep the one spare degree of an over-determined subset.

        With |S| = m and degree m+1 the coefficients are an exact affine
        function of the leading coefficient t, so this sweeps a genuine
        one-parameter family of interpolants -- all of them pass exactly
        through every chosen target, but each routes differently around the
        obstacles.
        """
        best = None
        low, high = -120.0, 120.0
        for base in (0.0, 1.0, 3.0, 10.0, 30.0):
            for sign in (1.0, -1.0):
                for step in (1.0, 1.0 / 3.0, 0.1, 0.01):
                    if self.out_of_time() or time.perf_counter() >= deadline:
                        return best
                    t = sign * base * step
                    if t < low or t > high:
                        continue
                    sc = self.try_poly(idxs, extra_t=t)
                    if sc is not None and (best is None or sc.key() > best[0]):
                        best = (sc.key(), t)
        # local climb around the best t found so far
        if best is not None:
            _, t = best
            for step in (3.0, 1.0, 0.3, 0.1, 0.03):
                if self.out_of_time() or time.perf_counter() >= deadline:
                    break
                for sign in (1.0, -1.0):
                    trial_t = t + sign * step
                    if trial_t < low or trial_t > high:
                        continue
                    sc = self.try_poly(idxs, extra_t=trial_t)
                    if sc is not None and sc.key() > best[0]:
                        best = (sc.key(), trial_t)
                        t = trial_t
        return best

    # ------------------------------------------------------------------
    # driver
    # ------------------------------------------------------------------
    def search(self):
        if self.ts is None:
            return
        n = len(self.targets)
        shooter_idx = None
        for i, rec in enumerate(self.targets):
            if rec["is_shooter"]:
                shooter_idx = i
                break

        # --- phase 1: single-target fits give the heuristic order ---------
        self.stats["phase"] = "singles"
        single_key = {}
        for i in range(n):
            if self.out_of_time():
                break
            sc = self.try_poly([i])
            if sc is not None:
                single_key[i] = sc.key()
        order = sorted(single_key, key=lambda i: single_key[i], reverse=True) + [
            i for i in range(n) if i not in single_key
        ]
        if shooter_idx is not None:
            order = [shooter_idx] + [i for i in order if i != shooter_idx]

        # --- phase 2: greedy seeding + local refinement -------------------
        self.stats["phase"] = "greedy"
        chosen = self.greedy(order)
        if chosen and not self.out_of_time():
            chosen = self.refine_subset(chosen)

        # --- phase 3: spare degree on the promising subsets --------------
        self.stats["phase"] = "spare-degree"
        pool = []
        if chosen:
            pool.append(sorted(chosen))
        for seed in order[:3]:
            cand = sorted(self.greedy([seed] + [i for i in order if i != seed]))
            if cand and cand not in pool:
                pool.append(cand)
        now = time.perf_counter()
        spare_budget_end = now + (self.deadline - now) * 0.55
        for idxs in pool:
            if self.out_of_time() or time.perf_counter() >= spare_budget_end:
                break
            if len(idxs) >= min(n, 9):
                continue
            self.spare_degree(idxs, spare_budget_end)

        # --- phase 4: randomised restarts --------------------------------
        self.stats["phase"] = "restarts"
        restarts = 0
        pool_sets = set(tuple(sorted(p)) for p in pool)
        while not self.out_of_time() and restarts < 24:
            restarts += 1
            tail = [i for i in range(n) if i != shooter_idx]
            self.rng.shuffle(tail)
            seed_order = ([shooter_idx] if shooter_idx is not None else []) + tail
            cand = sorted(self.greedy(seed_order))
            if cand and tuple(cand) not in pool_sets:
                pool_sets.add(tuple(cand))
                pool.append(cand)
                if len(pool) > 10:
                    pool.pop(1)
            # spend a little of the restart budget on spare degrees too
            if cand and restarts % 3 == 0 and len(cand) < min(n, 9):
                self.spare_degree(cand, min(self.deadline, time.perf_counter() + 0.05))

        # --- phase 5: trigonometric + composite families ------------------
        self.stats["phase"] = "families"
        remaining = self.deadline - time.perf_counter()
        if remaining > 0.0:
            fam_end = time.perf_counter() + remaining * 0.8
            top = order[:4]
            pairs = []
            for a in range(len(top)):
                for b in range(a + 1, len(top)):
                    pairs.append((top[a], top[b]))
            for i in range(n):
                if self.out_of_time() or time.perf_counter() >= fam_end:
                    break
                self.trig1_sweep(i)
            for (i, j) in pairs:
                if self.out_of_time() or time.perf_counter() >= fam_end:
                    break
                self.trig2_sweep(i, j)
                self.trig_lin_sweep(i, j)
                self.exp_sweep(i, j)
                self.sqrt_sweep(i, j)


def run(ctx, deadline, seed):
    """Search until `deadline`; return the best verified AST.

    The fallback is evaluated first, so even a pathological round (no enemies,
    no time, every family rejected) still returns a legal function.
    """
    searcher = Searcher(ctx, deadline, seed)
    fallback = fallback_ast(ctx)
    try:
        fn = compile_value(fallback)
        deriv = compile_derivs(fallback)
    except Exception:
        fn = deriv = None
    if fn is not None:
        searcher.consider(fallback, fn, deriv, None)
    try:
        searcher.search()
    except Exception:
        # Never let a search-side surprise cost the round its legal shot.
        pass
    best, score = searcher.finalize(fallback)
    searcher.stats["best_value"] = score.value if score is not None else 0.0
    searcher.stats["best_kills"] = score.kills if score is not None else 0
    searcher.stats["best_shooter_kill"] = bool(score.shooter_kill) if score is not None else False
    searcher.stats["best_nodes"] = score.nodes if score is not None else 0
    searcher.stats["best_depth"] = score.depth if score is not None else 0
    return best, searcher.stats
