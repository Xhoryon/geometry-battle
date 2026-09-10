"""Round context: turn (public, reveal, team) into the geometry the search uses.

Everything the solver knows comes from the two public files.  The enemy
shooter's coordinates are looked up in `public.points` through
`reveal.shooters[other]`, which is exactly what the competition rules promise.
"""


class Ctx(object):
    __slots__ = (
        "team",
        "other",
        "direction",
        "xs",
        "ys",
        "length",
        "x_end",
        "obstacles",
        "records",
        "shooter_id",
        "enemy_shooter_id",
        "map_bounds",
        "match_id",
        "round",
        "budget_ms",
        "slack_ms",
    )

    def __repr__(self):  # pragma: no cover - debug aid
        return "<Ctx %s sx=%.3f sy=%.3f L=%.3f enemies=%d obstacles=%d>" % (
            self.team,
            self.xs,
            self.ys,
            self.length,
            len(self.records),
            len(self.obstacles),
        )


def build(team, public, reveal):
    by_id = {}
    for p in public.get("points") or ():
        by_id[p["id"]] = p

    shooters = reveal.get("shooters") or {}
    me = by_id[shooters[team]]
    other = "B" if team == "A" else "A"
    enemy_shooter_id = shooters.get(other)

    xs = float(me["x"])
    ys = float(me["y"])
    direction = 1.0 if team == "A" else -1.0

    bounds = public.get("map") or {}
    xmin = float(bounds.get("xmin", -20.0))
    xmax = float(bounds.get("xmax", 20.0))
    x_end = xmax if team == "A" else xmin
    length = abs(x_end - xs)
    if length < 0.5:
        # Degenerate (shooter pinned to the back wall): keep the scaling sane.
        length = 0.5

    ctx = Ctx()
    ctx.team = team
    ctx.other = other
    ctx.direction = direction
    ctx.xs = xs
    ctx.ys = ys
    ctx.length = length
    ctx.x_end = x_end
    ctx.obstacles = list(reveal.get("obstacles") or ())
    ctx.shooter_id = shooters[team]
    ctx.enemy_shooter_id = enemy_shooter_id
    ctx.map_bounds = (xmin, xmax, float(bounds.get("ymin", -12.0)), float(bounds.get("ymax", 12.0)))
    ctx.match_id = str(public.get("match_id", ""))
    ctx.round = int(public.get("round", 0) or 0)
    ctx.budget_ms = 1500.0
    ctx.slack_ms = 150.0

    records = []
    for p in public.get("points") or ():
        if p.get("team") == team:
            continue
        if not p.get("alive", True):
            continue
        x = float(p["x"])
        y = float(p["y"])
        records.append(
            {
                "id": p["id"],
                "x": x,
                "y": y,
                "ys": ys,
                "ahead": direction * (x - xs),
                "is_shooter": p["id"] == enemy_shooter_id,
            }
        )
    records.sort(key=lambda r: r["ahead"])
    ctx.records = records
    return ctx
