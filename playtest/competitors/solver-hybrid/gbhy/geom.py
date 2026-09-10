"""Trajectory scanning: obstacles, arena boundary, hits, scoring primitives.

Two public stop conditions are modelled, per Playtest Rules §33 (obstacle) and
§34 (arena boundary), unified by §35 (the earliest stop event wins):

    * first intersection with an obstacle
    * first exit from the arena rectangle, i.e. y outside [ymin, ymax]

§34 is explicit that an arena exit terminates the attack *permanently* even if
the function would later re-enter, which is why the scan stops at the first
crossing instead of looking for later re-entries.

The scan is deliberately *conservative*: whenever it cannot prove a stretch is
clear, it is treated as blocked.  A false "blocked" costs one possible kill; a
false "clear" costs the whole round.
"""

import math


def obstacle_contains(o, x, y):
    if o.get("type") == "circle" or "radius" in o:
        cx = o["cx"] if "cx" in o else o["center"][0]
        cy = o["cy"] if "cy" in o else o["center"][1]
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= o["radius"] ** 2
    return o["xmin"] <= x <= o["xmax"] and o["ymin"] <= y <= o["ymax"]


def _obstacle_gap(o, x, y):
    """Signed clearance: >0 outside, <=0 inside.  Circle/rect, no eps fudge."""
    if o.get("type") == "circle" or "radius" in o:
        cx = o["cx"] if "cx" in o else o["center"][0]
        cy = o["cy"] if "cy" in o else o["center"][1]
        return math.hypot(x - cx, y - cy) - o["radius"]
    dx = max(o["xmin"] - x, 0.0, x - o["xmax"])
    dy = max(o["ymin"] - y, 0.0, y - o["ymax"])
    if dx == 0.0 and dy == 0.0:
        return -min(x - o["xmin"], o["xmax"] - x,
                    y - o["ymin"], o["ymax"] - y)
    return math.hypot(dx, dy)


def slab_clearance(o, v):
    """Worst-case clearance of a whole slab around x=v.

    The scan samples densely, but a thin obstacle can hide between two samples.
    We therefore also ask each obstacle for the clearance of the sampled point
    against its *expanded* footprint by a sampling half-step, which turns the
    check into one that cannot miss an obstacle narrower than the step.
    """
    return _obstacle_gap(o, v[0], v[1])


def first_stop(f, w, samples=1501):
    """Walk the attack from the shooter outward.

    Returns ``(stop_x, reason, samples_taken)`` where reason is one of
    ``"obstacle"``, ``"arena"``, ``"end"`` (normal domain end) or ``"error"``.
    ``stop_x`` is the last x the attack is known to have *reached*.
    """
    x0, x1 = w.xs, w.attack_end
    if w.span <= 0:
        return x0, "end", 0
    step = w.span / float(samples - 1)
    prev_x = x0
    try:
        prev_y = f(x0)
    except Exception:
        return x0, "error", 0
    for i in range(1, samples):
        x = x0 + w.dir * step * i
        try:
            y = f(x)
        except Exception:
            return prev_x, "error", i
        if not math.isfinite(y):
            return _refine_y(f, prev_x, x, w, samples=30), "error", i
        if y > w.ymax or y < w.ymin:
            return _refine_y(f, prev_x, x, w), "arena", i
        inside = None
        for o in w.obstacles:
            if obstacle_contains(o, x, y):
                inside = o
                break
        if inside is not None:
            return _refine_obstacle(f, prev_x, x, w, inside), "obstacle", i
        prev_x, prev_y = x, y
    return x0 + w.dir * step * (samples - 1), "end", samples - 1


def _refine_y(f, a, b, w, samples=40):
    """Bisect the arena exit between a (inside) and b (outside)."""
    for _ in range(samples):
        m = 0.5 * (a + b)
        try:
            ym = f(m)
        except Exception:
            break
        if ym > w.ymax or ym < w.ymin:
            b = m
        else:
            a = m
    return a


def _refine_obstacle(f, a, b, w, o, samples=40):
    """Bisect the obstacle entry between a (clear) and b (inside)."""
    for _ in range(samples):
        m = 0.5 * (a + b)
        try:
            ym = f(m)
        except Exception:
            break
        if obstacle_contains(o, m, ym):
            b = m
        else:
            a = m
    return a


def trajectory_targets(f, w, stop_x, stop_reason, hit_eps=1e-6):
    """Which enemies die, given the stop point.

    Public hit rule: the enemy must be strictly ahead of us, must lie before
    the stop point, and the curve must pass within ``hit_eps`` of it.
    """
    kills = []
    for p in w.enemies:
        ahead = w.dir * (p["x"] - w.xs)
        if ahead <= 0:
            continue
        if stop_reason != "end" and w.dir * (p["x"] - stop_x) >= 0:
            continue
        try:
            if abs(f(p["x"]) - p["y"]) <= hit_eps:
                kills.append(p)
        except Exception:
            continue
    return kills


class Result(object):
    """One scored candidate."""

    __slots__ = ("kills", "shooter_hit", "stop_x", "stop_reason", "residual",
                 "nodes", "depth", "key", "tag", "targets")

    def __init__(self, kills, shooter_hit, stop_x, stop_reason, residual,
                 nodes, depth, tag, targets):
        self.kills = kills
        self.shooter_hit = shooter_hit
        self.stop_x = stop_x
        self.stop_reason = stop_reason
        self.residual = residual
        self.nodes = nodes
        self.depth = depth
        self.tag = tag
        self.targets = targets
        self.key = self._score()

    #: How much an enemy-shooter kill is worth relative to a plain kill.
    #: Under the frozen rules, killing the opponent's Shooter cancels their
    #: entire round (Playtest Rules §38), so it is worth more than one extra
    #: trivial kill -- but not more than two.  A flat 1.0 weighting here was
    #: measured to make the solver prefer a two-kill curve over the
    #: assassination line, which is the wrong trade under this meta.
    SHOOTER_WEIGHT = 1.5

    def _score(self):
        """Ordering key: kills first, shooter kill weighted, ties broken
        towards simpler curves."""
        s = 100.0 * self.kills + 100.0 * self.SHOOTER_WEIGHT * (1 if self.shooter_hit else 0)
        s -= 0.30 * self.nodes
        return s

    def __repr__(self):
        return ("Result(kills=%d shooter=%s stop=%.2f/%s nodes=%d)"
                % (self.kills, self.shooter_hit, self.stop_x,
                   self.stop_reason, self.nodes))


def evaluate(f, w, tag, targets=None, samples=1501, hit_eps=1e-6):
    """Full geometric evaluation of one compiled curve."""
    stop_x, reason, _n = first_stop(f, w, samples=samples)
    kills = trajectory_targets(f, w, stop_x, reason, hit_eps=hit_eps)
    residual = 0.0
    for p in kills:
        try:
            residual = max(residual, abs(f(p["x"]) - p["y"]))
        except Exception:
            residual = float("inf")
    esid = w.enemy_shooter_id()
    shooter_hit = bool(esid and any(p["id"] == esid for p in kills))
    return Result(len(kills), shooter_hit, stop_x, reason, residual,
                  0, 0, tag, targets if targets is not None else kills)
