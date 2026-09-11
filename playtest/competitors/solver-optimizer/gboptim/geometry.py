"""Obstacle geometry: signed distance and first-contact (trajectory end).

The trajectory is the graph y = f(x) drawn from the shooter in the attack
direction.  It terminates at the first x where the point (x, f(x)) lies inside
any obstacle -- boundary contact counts.  Everything at or after that x is
unreachable, so scoring a candidate means finding that x.

We work with a *signed* distance to each obstacle: positive outside, negative
inside, zero exactly on the boundary.  Clearance of the curve is the minimum of
that distance over the traversed interval, which is the quantity the search
rewards (threading a gap) and uses as a tie-break.
"""

import math

INF = float("inf")


def obstacle_signed_distance(x, y, ob):
    """Signed distance from (x, y) to one obstacle; < 0 means inside."""
    if ob.get("type") == "circle":
        return math.hypot(x - ob["cx"], y - ob["cy"]) - ob["radius"]
    # rectangle
    dx = max(ob["xmin"] - x, 0.0, x - ob["xmax"])
    dy = max(ob["ymin"] - y, 0.0, y - ob["ymax"])
    if dx > 0.0 or dy > 0.0:
        return math.hypot(dx, dy)
    # inside: negative distance to the nearest edge
    return -min(x - ob["xmin"], ob["xmax"] - x, y - ob["ymin"], ob["ymax"] - y)


def clearance(x, y, obstacles):
    """Minimum signed distance over the whole obstacle set (inf when empty)."""
    best = INF
    for ob in obstacles:
        d = obstacle_signed_distance(x, y, ob)
        if d < best:
            best = d
            if best <= 0.0:
                return best
    return best


def first_contact(fn, ctx, samples=192, refine=60):
    """First u >= 0 (arc length along +attack direction) where the trajectory
    dies: either it leaves the field rectangle (y outside [ymin, ymax]) or it
    touches an obstacle -- whichever comes first.

    Returns None when the curve reaches the far edge of the field untouched.
    `fn` is the compiled value function.  The caller supplies ctx with .xs,
    .direction, .length, .obstacles and .map_bounds.

    The scan is coarse (a candidate is scored many times); when a bracket is
    found we bisect, so the returned contact point is accurate even though the
    scan is not.  A dip narrower than one scan step could in principle be
    missed -- the final verification pass re-runs this with a much denser scan.
    """
    obstacles = ctx.obstacles
    xs = ctx.xs
    d = ctx.direction
    length = ctx.length
    ymin = ctx.map_bounds[2]
    ymax = ctx.map_bounds[3]

    prev_u = 0.0
    prev_x = xs
    prev_y = fn(prev_x)
    if prev_y is None:
        return 0.0
    if prev_y > ymax or prev_y < ymin:
        return 0.0
    prev_c = clearance(prev_x, prev_y, obstacles) if obstacles else INF
    if prev_c <= 0.0:
        return 0.0
    for i in range(1, samples + 1):
        u = length * i / samples
        x = xs + d * u
        y = fn(x)
        if y is None:
            # A domain fault inside the attacked range invalidates the
            # candidate anyway; treat it as an immediate stop.
            return u
        if y > ymax or y < ymin:
            lo_u, hi_u = prev_u, u
            for _ in range(refine):
                mid_u = 0.5 * (lo_u + hi_u)
                my = fn(xs + d * mid_u)
                if my is None or my > ymax or my < ymin:
                    hi_u = mid_u
                else:
                    lo_u = mid_u
            return hi_u
        if obstacles:
            cur_c = clearance(x, y, obstacles)
            if cur_c <= 0.0:
                lo_u, hi_u = prev_u, u
                for _ in range(refine):
                    mid_u = 0.5 * (lo_u + hi_u)
                    my = fn(xs + d * mid_u)
                    if my is None:
                        hi_u = mid_u
                        continue
                    if clearance(xs + d * mid_u, my, obstacles) <= 0.0:
                        hi_u = mid_u
                    else:
                        lo_u = mid_u
                return hi_u
            prev_c = cur_c
        prev_u = u
    return None


def min_clearance(fn, ctx, samples=192, upto=None):
    """Minimum clearance of the curve over [0, upto] (or the whole interval)."""
    obstacles = ctx.obstacles
    if not obstacles:
        return INF
    xs = ctx.xs
    d = ctx.direction
    length = ctx.length if upto is None else min(upto, ctx.length)
    best = INF
    if length <= 0.0:
        return INF
    for i in range(samples + 1):
        u = length * i / samples
        x = xs + d * u
        y = fn(x)
        if y is None:
            return -INF
        c = clearance(x, y, obstacles)
        if c < best:
            best = c
    return best
