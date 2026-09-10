"""Obstacle-aware screening and scoring of candidate functions.

A candidate is only ever *scored* after it has passed two gates:

  1. the structural gate (whitelist shape, nodes <= 128, depth <= 12,
     |constant| <= 1000), and
  2. the numerical gate, which replays the platform's legality checks over the
     whole attack interval: finite, |f| <= 1e6, |f'| <= 1e10, and at most 100
     sign changes of f''.

Only then do we count kills.  A point counts when it is strictly ahead of the
shooter, strictly before the first obstacle contact of the curve, and within
1e-6 of f at its own x -- the three conditions of the judge's hit rule.

Score = kills
      + SHOOTER_BONUS        when the enemy shooter is among the kills
      + clearance reward     (threading obstacles, saturating)
      - node penalty         (simpler ASTs win ties)
      - steepness penalty    (stay far away from the |f'| ceiling)

The evaluator used for scanning is pluggable: the search scores with a fast
specialised evaluator and only the finalists are re-scored end to end with the
compiled AST, which is the arithmetic the platform will actually run.
"""

import math

from . import astlib
from .evaluator import compile_derivs, compile_value
from .geometry import first_contact, min_clearance, INF

HIT_TOL = 1e-6
SHOOTER_BONUS = 2.0
CLEAR_WEIGHT = 0.40
CLEAR_CAP = 2.0
NODE_PENALTY = 0.004
MAX_ABS_F = 1e6
MAX_ABS_D1 = 1e10
CONVEXITY_LIMIT = 100
# Emitted candidates must beat this worst residual at the intended targets;
# the judge tolerance is 1e-6 and it is a different implementation.
RESIDUAL_TOL = 1e-9


class Score(object):
    __slots__ = (
        "value",
        "kills",
        "shooter_kill",
        "killed_ids",
        "clearance",
        "contact_u",
        "nodes",
        "depth",
        "max_slope",
        "residual",
    )

    def __init__(self, **kw):
        for slot in self.__slots__:
            setattr(self, slot, kw.get(slot))

    def key(self):
        """Ranking key.

        Kills come first: the assignment's priority order puts "maximise
        effective kills" above "shooter kill", and a match is won by
        elimination, so no amount of bonus or clearance may ever buy a
        candidate that lands one fewer point.  Within the same kill count the
        weighted value (shooter bonus, clearance margin, node and steepness
        penalties) decides, and simpler ASTs break exact ties.
        """
        return (
            self.kills,
            1 if self.shooter_kill else 0,
            round(self.value, 9),
            -self.nodes,
            -self.depth,
        )

    def __repr__(self):  # pragma: no cover - debug aid
        return "<Score v=%.4f kills=%d shooter=%s clear=%s nodes=%d>" % (
            self.value,
            self.kills,
            self.shooter_kill,
            "%.3f" % self.clearance if self.clearance is not None else "n/a",
            self.nodes,
        )


def screen_deriv(deriv, ctx, samples=48):
    """Legality screen over the attack interval using a derivative evaluator."""
    xs, length, direction = ctx.xs, ctx.length, ctx.direction
    max_f = 0.0
    max_d1 = 0.0
    prev_sign = 0
    sign_changes = 0
    steps = max(2, samples)
    for i in range(steps):
        x = xs + direction * (length * i / (steps - 1))
        try:
            v, d1, d2 = deriv(x)
        except Exception:
            return None
        if not (math.isfinite(v) and math.isfinite(d1) and math.isfinite(d2)):
            return None
        av = abs(v)
        ad1 = abs(d1)
        if av > max_f:
            max_f = av
        if ad1 > max_d1:
            max_d1 = ad1
        if av > MAX_ABS_F or ad1 > MAX_ABS_D1:
            return None
        sign = 1 if d2 > 0.0 else (-1 if d2 < 0.0 else 0)
        if sign and prev_sign and sign != prev_sign:
            sign_changes += 1
            if sign_changes > CONVEXITY_LIMIT:
                return None
        if sign:
            prev_sign = sign
    return {
        "max_f": max_f,
        "max_slope": max_d1,
        "sign_changes": sign_changes,
    }


def screen(ast, ctx, samples=48):
    """Structural + numerical gate for a candidate AST."""
    if not astlib.structural_ok(ast):
        return None
    try:
        deriv = compile_derivs(ast)
    except Exception:
        return None
    meta = screen_deriv(deriv, ctx, samples=samples)
    if meta is None:
        return None
    try:
        at_shooter = compile_value(ast)(ctx.xs)
    except Exception:
        return None
    if at_shooter is None or abs(at_shooter - ctx.ys) > HIT_TOL:
        return None
    meta["nodes"] = astlib.node_count(ast)
    meta["depth"] = astlib.depth(ast)
    meta["max_const"] = astlib.max_abs_const(ast)
    return meta


def count_kills(fn, ctx, contact_u):
    kills = 0
    shooter_kill = False
    killed_ids = []
    for rec in ctx.records:
        ahead = rec["ahead"]
        if ahead <= 0.0:
            continue
        if contact_u is not None and ahead >= contact_u:
            continue
        try:
            got = fn(rec["x"])
        except Exception:
            got = None
        if got is None:
            continue
        if abs(got - rec["y"]) <= HIT_TOL:
            kills += 1
            killed_ids.append(rec["id"])
            if rec["is_shooter"]:
                shooter_kill = True
    return kills, shooter_kill, killed_ids


def build_score(ctx, fn, meta, contact_u, kills, shooter_kill, killed_ids):
    clearance = None
    if ctx.obstacles and contact_u is None:
        clearance = min_clearance(fn, ctx, samples=64)
    clear_reward = 0.0
    if clearance is not None and clearance > 0.0 and math.isfinite(clearance):
        clear_reward = CLEAR_WEIGHT * min(clearance, CLEAR_CAP) / CLEAR_CAP

    slope = max(meta["max_slope"], 1.0)
    slope_penalty = 0.05 * max(0.0, math.log10(slope) - 3.0)
    if slope_penalty > 0.4:
        slope_penalty = 0.4

    value = (
        kills
        + (SHOOTER_BONUS if shooter_kill else 0.0)
        + clear_reward
        - NODE_PENALTY * meta["nodes"]
        - slope_penalty
    )
    return Score(
        value=value,
        kills=kills,
        shooter_kill=shooter_kill,
        killed_ids=killed_ids,
        clearance=clearance,
        contact_u=contact_u,
        nodes=meta["nodes"],
        depth=meta["depth"],
        max_slope=meta["max_slope"],
        residual=None,
    )


def evaluate(ast, ctx, fn=None, deriv=None, meta=None, contact_samples=64, screen_samples=48):
    """Score a candidate.  `fn`/`deriv` default to the compiled AST."""
    if meta is None:
        if deriv is None:
            if not astlib.structural_ok(ast):
                return None
            try:
                deriv = compile_derivs(ast)
            except Exception:
                return None
        meta = screen_deriv(deriv, ctx, samples=screen_samples)
        if meta is None:
            return None
        meta["nodes"] = astlib.node_count(ast)
        meta["depth"] = astlib.depth(ast)
        try:
            at_shooter = compile_value(ast)(ctx.xs)
        except Exception:
            return None
        if at_shooter is None or abs(at_shooter - ctx.ys) > HIT_TOL:
            return None
    if fn is None:
        try:
            fn = compile_value(ast)
        except Exception:
            return None

    contact_u = first_contact(fn, ctx, samples=contact_samples)
    kills, shooter_kill, killed_ids = count_kills(fn, ctx, contact_u)
    return build_score(ctx, fn, meta, contact_u, kills, shooter_kill, killed_ids)


def worst_residual(fn, records):
    """Worst |f(x_p) - y_p| over the intended targets, using `fn`."""
    worst = 0.0
    for rec in records:
        try:
            got = fn(rec["x"])
        except Exception:
            return None
        if got is None or not math.isfinite(got):
            return None
        d = abs(got - rec["y"])
        if d > worst:
            worst = d
    return worst
