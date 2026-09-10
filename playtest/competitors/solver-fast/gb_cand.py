"""gb_cand.py -- candidate curves, their closed forms and their evaluation.

A candidate is one finished, exactly-constructed curve.  Two families:

  * kind 0 -- polynomial in u = x - xs,  f(x) = ys + c1 u + c2 u^2 + c3 u^3 + c4 u^4
  * kind 1 -- single sine,               f(x) = ys + amp * sin(omega * u)

Every candidate passes through the shooter by construction (the term list has
no constant term), so `f(xs) == ys` is an exact floating point identity.

`evaluate()` is the scorer: it walks the alive enemies in order of increasing
distance along the attack direction, answers the conservative obstacle question
for each span, and counts kills.  The hit test uses `eval_ast` -- the tree the
judge sees -- never the closed form.
"""

import math

from gb_dsl import eval_ast
from gb_geom import NODE_BUDGET, scan_clear, scan_field_exit

INF = float("inf")
HIT_EPS = 1e-6
RESIDUAL_MAX = 1e-9


class Cand(object):
    __slots__ = ("kind", "xs", "ys", "c", "amp", "omega", "ast",
                 "nodes", "depth", "targets", "tag")

    def __init__(self, kind, xs, ys, c, amp, omega, ast, nodes, depth,
                 targets, tag):
        self.kind = kind
        self.xs = xs
        self.ys = ys
        self.c = c
        self.amp = amp
        self.omega = omega
        self.ast = ast
        self.nodes = nodes
        self.depth = depth
        self.targets = targets
        self.tag = tag

    def f(self, x):
        if self.kind == 0:
            c = self.c
            u = x - self.xs
            return self.ys + u * (c[0] + u * (c[1] + u * (c[2] + u * c[3])))
        u = x - self.xs
        return self.ys + self.amp * math.sin(self.omega * u)

    def dfb(self, u0, u1):
        """Rigorous bound on |f'(x)| for u in [u0, u1]."""
        if self.kind == 0:
            c = self.c
            m = abs(u0)
            n = abs(u1)
            if n > m:
                m = n
            return (abs(c[0]) + m * (2.0 * abs(c[1])
                    + m * (3.0 * abs(c[2]) + m * 4.0 * abs(c[3]))))
        return abs(self.amp * self.omega)


class World(object):
    __slots__ = ("xs", "ys", "d", "enemies", "obstacles", "ufar", "es_idx",
                 "es_alive", "my_id", "n_enemies", "ymin", "ymax")

    def __init__(self, xs, ys, d, enemies, obstacles, ufar, es_idx, es_alive,
                 my_id, ymin, ymax):
        self.xs = xs
        self.ys = ys
        self.d = d
        self.enemies = enemies          # [(prog, px, py, idx, is_es)] ascending
        self.obstacles = obstacles
        self.ufar = ufar
        self.es_idx = es_idx
        self.es_alive = es_alive
        self.my_id = my_id
        self.n_enemies = len(enemies)
        self.ymin = ymin
        self.ymax = ymax


class Score(object):
    __slots__ = ("hits", "shooter_hit", "margin", "contact", "target_res",
                 "total", "nodes", "depth", "key")

    def __init__(self, hits, shooter_hit, margin, contact, target_res, nodes,
                 depth, d):
        self.hits = hits
        self.shooter_hit = shooter_hit
        self.margin = margin
        self.contact = contact
        self.target_res = target_res
        self.nodes = nodes
        self.depth = depth
        self.total = hits + (2 if shooter_hit else 0)
        # ranking key, larger is better
        # "earlier first contact along the attack direction" wins a tie:
        # prog = d * (x - xs) grows with distance travelled down-range.
        crank = INF if contact is None else -(d * contact)
        self.key = (self.total, margin, crank, -nodes)


def evaluate(cand, w):
    """Score a candidate against the world.  Conservative throughout.

    Returns a Score, or None if the AST evaluation blew up.

    `Score.target_res` is the worst residual at the *constructed* targets --
    the gate the caller applies before emission.  Residuals at points the curve
    merely passes close to are not counted here; those are the 1e-6 hit test.
    """
    f = cand.f
    dfb = cand.dfb
    ast = cand.ast
    xs = w.xs
    o = w.obstacles
    cursor = xs
    hits = 0
    shooter_hit = False
    contact = None
    margin = INF
    budget = [NODE_BUDGET]
    # Field-exit termination: the trajectory dies the moment it leaves the
    # field rectangle, exactly like an obstacle contact.  Computed once over
    # the whole attack interval (the same budget is shared, so it stays cheap).
    x_end = xs + w.d * w.ufar
    field_exit = scan_field_exit(f, dfb, xs, xs, x_end, w.ymin, w.ymax, budget)
    for prog, px, py, idx, is_es in w.enemies:
        if field_exit is not None and w.d * (px - field_exit) >= 0:
            contact = field_exit
            break
        cx, m = scan_clear(f, dfb, xs, cursor, px, o, budget)
        if m < margin:
            margin = m
        if cx is not None:
            contact = cx
            break
        v = eval_ast(ast, px)
        if v != v:
            return None
        r = v - py
        if r < 0.0:
            r = -r
        if r <= HIT_EPS:
            hits += 1
            if is_es:
                shooter_hit = True
        cursor = px
    # intended-target residual, computed on the tree the judge will walk
    target_res = 0.0
    for px, py in cand.targets:
        v = eval_ast(ast, px)
        if v != v:
            return None
        r = v - py
        if r < 0.0:
            r = -r
        if r > target_res:
            target_res = r
    return Score(hits, shooter_hit, margin, contact, target_res, cand.nodes,
                 cand.depth, w.d)
