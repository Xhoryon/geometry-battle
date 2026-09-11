"""gb_geom.py -- obstacle geometry and the conservative trajectory scan.

The platform terminates a trajectory at the first x where (x, f(x)) touches any
obstacle (boundary contact counts).  Points *strictly before* that x can be
killed; points at or after it cannot.

We only ever need a boolean per candidate target:

    "is there a contact with any obstacle at some x in (x_start, x_target]?"

so the scan below answers exactly that, and it answers it *conservatively*:
when the test is inconclusive we report a contact.  A false "blocked" costs us
one kill; a false "clear" would make us emit a shot that scores nothing, which
is strictly worse.

Method
------
Over a sub-interval [xa, xb] with ya = f(xa) and L a rigorous bound on |f'|
over that sub-interval, every point of the curve lies inside the *tunnel*

    [xa, xb] x [ya - L*(xb-xa), ya + L*(xb-xa)]

If the tunnel misses an obstacle, the curve misses it too.  If the tunnel hits,
we bisect and retry; at the recursion floor we declare contact at xa.  Because
the tunnel shrinks geometrically, the only sub-intervals that recurse deeply are
those that genuinely touch an obstacle, so the cost stays tiny.
"""

import math

INF = float("inf")

# recursion floor: 2**-28 of the sub-interval width, plus a node budget so a
# pathological candidate can never blow the time budget here.
_MAX_DEPTH = 28
# budget for one whole candidate (shared by every span the scorer walks)
NODE_BUDGET = 1500


def prepare(obstacles):
    """Normalise the reveal obstacle list into flat tuples with precomputed
    radius squares.  Unknown obstacle types are dropped (we cannot reason about
    them; the spec only defines rectangle and circle)."""
    out = []
    for ob in obstacles or []:
        kind = ob.get("type")
        try:
            if kind == "rectangle":
                x0 = float(ob["xmin"])
                x1 = float(ob["xmax"])
                y0 = float(ob["ymin"])
                y1 = float(ob["ymax"])
                if x0 > x1:
                    x0, x1 = x1, x0
                if y0 > y1:
                    y0, y1 = y1, y0
                out.append(("R", x0, x1, y0, y1))
            elif kind == "circle":
                cx = float(ob["cx"])
                cy = float(ob["cy"])
                r = float(ob["radius"])
                if r < 0.0:
                    r = -r
                out.append(("C", cx, cy, r * r, r))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def tunnel_hits(xlo, xhi, ylo, yhi, obstacles):
    """True if the closed box [xlo,xhi] x [ylo,yhi] touches any obstacle.

    Boundary contact counts (spec: "on the boundary counts as contact"), hence
    the <= comparisons and the <= r^2 circle test.
    """
    for ob in obstacles:
        if ob[0] == "R":
            if xlo <= ob[2] and xhi >= ob[1] and ylo <= ob[4] and yhi >= ob[3]:
                return True
        else:
            cx = ob[1]
            cy = ob[2]
            r2 = ob[3]
            dx = 0.0
            if cx < xlo:
                dx = xlo - cx
            elif cx > xhi:
                dx = cx - xhi
            dy = 0.0
            if cy < ylo:
                dy = ylo - cy
            elif cy > yhi:
                dy = cy - yhi
            if dx * dx + dy * dy <= r2:
                return True
    return False


def vertical_margin(x, y, obstacles):
    """Signed *vertical* clearance of the point (x, y): positive = outside,
    negative = inside.  Used only as a tie-break, never for the block test."""
    best = INF
    for ob in obstacles:
        if ob[0] == "R":
            x0, x1, y0, y1 = ob[1], ob[2], ob[3], ob[4]
            if x0 <= x <= x1:
                m = y0 - y if y < y0 else (y - y1 if y > y1 else -min(y - y0, y1 - y))
            else:
                m = math.hypot(max(x0 - x, 0.0, x - x1), 0.0)
            if m < best:
                best = m
        else:
            cx, cy, r = ob[1], ob[2], ob[4]
            dx = x - cx
            if -r < dx < r:
                half = math.sqrt(r * r - dx * dx)
                m = abs(y - cy) - half
            else:
                m = math.hypot(max(abs(dx) - r, 0.0), 0.0)
            if m < best:
                best = m
    return best


def _contact(f, dfb, xs, xa, xb, ya, obstacles, depth, budget):
    """First contact x inside [xa, xb], or None if provably clear.

    The caller may pass xa > xb (team B walks the attack interval backwards,
    toward -x).  We normalise the interval up front so the tunnel box always
    has xlo <= xhi and ylo <= yhi; `h` stays a positive width and `r` a
    positive half-height.
    """
    if budget[0] <= 0:
        return xa  # out of budget -> conservative
    budget[0] -= 1
    h = abs(xb - xa)
    lo = xa if xa <= xb else xb
    hi = xb if xa <= xb else xa
    r = dfb(lo - xs, hi - xs) * h
    if not tunnel_hits(lo, hi, ya - r, ya + r, obstacles):
        return None
    if depth >= _MAX_DEPTH or h <= 1e-12:
        return lo
    xm = 0.5 * (xa + xb)
    ym = f(xm)
    c = _contact(f, dfb, xs, xa, xm, ya, obstacles, depth + 1, budget)
    if c is not None:
        return c
    return _contact(f, dfb, xs, xm, xb, ym, obstacles, depth + 1, budget)


def scan_field_exit(f, dfb, xs, x_from, x_to, ymin, ymax, budget, max_steps=512):
    """First x in [x_from, x_to] where the curve leaves the field, or None.

    The platform's trajectory dies the moment it leaves the field rectangle
    (y outside [ymin, ymax]), exactly as it dies on an obstacle.  This uses the
    same Lipschitz-tunnel idea as the obstacle scan: over a sub-span the curve
    lies within a tunnel of half-height L*h around its left value, so a tunnel
    fully inside the field cannot have exited; a tunnel that pokes outside is
    bisected.  Conservative: an inconclusive span reports an exit.
    """
    span = abs(x_to - x_from)
    if span <= 0.0:
        return None
    L = dfb(min(x_from - xs, x_to - xs), max(x_from - xs, x_to - xs))
    if not (L == L) or L < 0.0 or L > 1e12:
        return x_from
    h_des = 0.5 / L if L > 1e-9 else span
    h = max(h_des, span / max_steps)
    n = int(math.ceil(span / h))
    if n < 1:
        n = 1
    step = span / n
    forward = x_to > x_from
    xa = x_from
    ya = f(xa)
    if ya is not None and (ya > ymax or ya < ymin):
        return x_from
    for _ in range(n):
        xb = xa + step if forward else xa - step
        if forward and xb > x_to:
            xb = x_to
        if not forward and xb < x_to:
            xb = x_to
        rr = L * abs(xb - xa)
        if ya + rr > ymax or ya - rr < ymin:
            # the tunnel pokes outside the field, so the curve may have
            # exited somewhere in [xa, xb]; bisect for the first crossing.
            lo, hi = xa, xb
            for _ in range(48):
                m = 0.5 * (lo + hi)
                ym = f(m)
                if ym is None or ym > ymax or ym < ymin:
                    hi = m
                else:
                    lo = m
            return hi
        xa = xb
        ya = f(xa)
        if ya > ymax or ya < ymin:
            return xa
    return None


def scan_clear(f, dfb, xs, x_from, x_to, obstacles, budget, max_steps=96):
    """Walk the curve from x_from to x_to and report the first contact.

    Returns (contact_x or None, min_vertical_margin).  `contact_x is None`
    means "provably clear over the whole scanned span" (relative to the
    Lipschitz bound, which is rigorous for the candidates we build).

    `budget` is a one-element list shared by every span of one candidate, so a
    single pathological curve cannot cost more than its share of the budget.
    """
    span = abs(x_to - x_from)
    if span <= 0.0:
        return None, INF
    if not obstacles:
        # still report a margin-free clear walk; no sampling needed
        return None, INF
    # local Lipschitz bound over the whole span at coarse level
    L = dfb(min(x_from - xs, x_to - xs), max(x_from - xs, x_to - xs))
    if not (L == L) or L < 0.0:
        return x_from, -INF
    if L > 1e12:
        return x_from, -INF
    # step: keep the coarse tunnel half-height <= ~0.35, but never exceed the
    # step budget.  A steep curve therefore gets a proportionally looser (more
    # conservative) walk -- never a false "clear".
    h_des = 0.35 / L if L > 1e-9 else span
    h = max(h_des, span / max_steps)
    n = int(math.ceil(span / h))
    if n < 1:
        n = 1
    step = span / n
    min_margin = INF
    forward = x_to > x_from
    xa = x_from
    ya = f(xa)
    for _ in range(n):
        xb = xa + step if forward else xa - step
        if forward and xb > x_to:
            xb = x_to
        if not forward and xb < x_to:
            xb = x_to
        c = _contact(f, dfb, xs, xa, xb, ya, obstacles, 0, budget)
        if c is not None:
            return c, min_margin
        m = vertical_margin(xa, ya, obstacles)
        if m < min_margin:
            min_margin = m
        xa = xb
        ya = f(xa)
    m = vertical_margin(xa, ya, obstacles)
    if m < min_margin:
        min_margin = m
    return None, min_margin
