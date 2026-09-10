"""gb_world.py -- turn the two input JSON files into the board we reason about.

Everything in here is straight from competitor-kit/JSON_SCHEMA.md; nothing is
assumed about point counts, ids, obstacle counts or map size beyond the fields
the schema guarantees.
"""

import hashlib
import json
import math

from gb_cand import World
from gb_geom import prepare

DEFAULT_MAP = {"xmin": -20.0, "xmax": 20.0, "ymin": -12.0, "ymax": 12.0}


def load_inputs(public_path, reveal_path):
    """Read both files; verify the sha256 binding the platform advertises."""
    with open(public_path, "rb") as fh:
        raw = fh.read()
    public = json.loads(raw.decode("utf-8"))
    with open(reveal_path, "r", encoding="utf-8") as fh:
        reveal = json.load(fh)
    digest = hashlib.sha256(raw).hexdigest()
    expected = reveal.get("public_state_sha256")
    if expected is not None and expected != digest:
        raise ValueError("public_state_sha256 mismatch")
    return public, reveal, digest


def map_bounds(public):
    m = public.get("map") or {}
    try:
        return (float(m["xmin"]), float(m["xmax"]),
                float(m["ymin"]), float(m["ymax"]))
    except (KeyError, TypeError, ValueError):
        return (DEFAULT_MAP["xmin"], DEFAULT_MAP["xmax"],
                DEFAULT_MAP["ymin"], DEFAULT_MAP["ymax"])


def build_world(team, public, reveal):
    """Build the board, or return None if the input is unusable."""
    d = 1.0 if team == "A" else -1.0
    points = public.get("points") or []
    by_id = {}
    for p in points:
        pid = p.get("id")
        if isinstance(pid, str):
            by_id[pid] = p

    # ---- Rule Revision 3 I/O 适配（唯一改动）----
    # 发射锚点从「reveal.shooters 里的 id → 查 public.points」改成
    # 「public.emitters 直接给坐标」。策略 / 搜索 / 打分一律未改。
    # `shooters` 仍按旧字段读，因此在新输入下恒为空 →
    # `enemy_shooter_id` 恒为 None，即「刺杀敌方 Shooter」的加成分支自然失效
    # （Revision 3 下 Emitter 不可击杀、也不在 points 里，本就无此目标）。
    shooters = reveal.get("shooters") or {}
    me = (public.get("emitters") or {}).get(team)
    if me is None:
        return None
    xs = float(me["x"])
    ys = float(me["y"])

    foe = "B" if team == "A" else "A"
    foe_shooter_id = shooters.get(foe)

    enemies = []
    for p in points:
        if p.get("team") == team:
            continue
        if not p.get("alive", True):
            continue
        try:
            px = float(p["x"])
            py = float(p["y"])
        except (KeyError, TypeError, ValueError):
            continue
        prog = d * (px - xs)
        if prog <= 1e-9:
            continue  # behind the shooter -> not a legal target
        pid = p.get("id")
        enemies.append((prog, px, py, pid, pid == foe_shooter_id))
    enemies.sort(key=lambda e: e[0])

    xmin, xmax, ymin, ymax = map_bounds(public)
    obstacles = prepare(reveal.get("obstacles"))
    if d > 0:
        ufar = xmax - xs
    else:
        ufar = xs - xmin
    es_alive = any(e[4] for e in enemies)
    return World(xs, ys, d, enemies, obstacles, ufar, -1, es_alive,
                 me.get("id"), ymin, ymax)


def screen_interval(w, public):
    """The legal attack interval: A -> [xs, xmax], B -> [xmin, xs].

    Returned as (x0, x1) with x0 always the shooter end, so the caller can walk
    it in either direction without special cases.
    """
    xmin, xmax, _ymin, _ymax = map_bounds(public)
    if w.d > 0:
        return w.xs, xmax
    return xmin, w.xs


def in_field(w, public, x):
    xmin, xmax, _ymin, _ymax = map_bounds(public)
    return xmin - 1e-9 <= x <= xmax + 1e-9


def finite(v):
    return v == v and v not in (float("inf"), float("-inf")) and not math.isnan(v)
