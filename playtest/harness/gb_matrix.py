#!/usr/bin/env python3
"""Offline robustness matrix for a competitor package.

Why this exists
---------------
Task §10 asks for validation across Team A / Team B, 6v6 / 8v8 / 10v10 and
0 / 1 / multiple obstacles.  The two ends of that matrix are NOT reachable
through the public operator CLI: probing ``--obstacles 0`` and ``--obstacles 1``
is rejected as unknown options, and ``--difficulty`` only maps to easy=2,
medium=4, hard=6.  A platform-level match on a 0- or 1-obstacle map therefore
cannot be produced without reaching into the map generator, which is platform
internals and out of bounds here.

What CAN be done, and is done here, is the algorithm-side half: synthesise
worlds of the missing shapes, run the package on them exactly the way the
sandbox does, and apply the public legality screen plus the black-box hit model.
That is enough to answer "0 unexpected INVALID / 0 unexpected TIMEOUT" for
those shapes; it is not a substitute for a platform match and is reported as a
test limitation, not as platform evidence.

PLAYTEST-ONLY.  Read-only with respect to the repo; runs a solver in a temp dir.
"""

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gb_check  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# From competitor-kit/ALGORITHM_REQUIREMENTS.md §6: team zones and the field.
A_X = (-20.0, -4.0)
B_X = (4.0, 20.0)
Y = (-12.0, 12.0)
MID_X = (-4.0, 4.0)


def make_world(seed, points_per_team, obstacles):
    """One synthetic world.  Points avoid the obstacle band, obstacles sit in it."""
    rng = random.Random(seed)
    pts = []
    for team, (x0, x1) in (("A", A_X), ("B", B_X)):
        for i in range(points_per_team):
            pts.append({"id": "%s%d" % (team, i + 1), "team": team,
                        "x": round(rng.uniform(x0, x1), 6),
                        "y": round(rng.uniform(*Y), 6),
                        "alive": True})
    obs = []
    for i in range(obstacles):
        if rng.random() < 0.5:
            cx = rng.uniform(*MID_X)
            cy = rng.uniform(*Y)
            r = rng.uniform(1.0, 3.5)
            obs.append({"id": "O%d" % (i + 1), "type": "circle",
                        "cx": round(cx, 6), "cy": round(cy, 6), "radius": round(r, 6)})
        else:
            w = rng.uniform(1.5, 5.0)
            h = rng.uniform(1.5, 5.0)
            cx = rng.uniform(*MID_X)
            cy = rng.uniform(*Y)
            obs.append({"id": "O%d" % (i + 1), "type": "rectangle",
                        "xmin": round(cx - w / 2, 6), "xmax": round(cx + w / 2, 6),
                        "ymin": round(cy - h / 2, 6), "ymax": round(cy + h / 2, 6)})
    return pts, obs


def build(seed, pts, obs, shooters):
    public = {"schema_version": "1.1", "match_id": "MATRIX-%d" % seed, "round": 1,
              "map": {"xmin": -20.0, "xmax": 20.0, "ymin": -12.0, "ymax": 12.0},
              "points": pts}
    reveal = {"schema_version": "1.1", "match_id": "MATRIX-%d" % seed, "round": 1,
              "shooters": shooters, "obstacles": obs}
    gb_check.bind(public, reveal)
    return public, reveal


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", required=True)
    ap.add_argument("--seeds", type=int, default=25, help="worlds per shape")
    ap.add_argument("--obstacles", default="0,1,2,4,6")
    ap.add_argument("--teams", default="6,8,10")
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    pkg = os.path.abspath(args.pkg)
    obs_counts = [int(x) for x in args.obstacles.split(",")]
    team_sizes = [int(x) for x in args.teams.split(",")]

    rows = []
    illegal = 0
    timeouts = 0
    nofile = 0
    times = []
    first_seed = 90000
    for n_obs in obs_counts:
        for n_pts in team_sizes:
            for k in range(args.seeds):
                seed = first_seed + n_obs * 1000 + n_pts * 10 + k
                pts, obs = make_world(seed, n_pts, n_obs)
                for team in ("A", "B"):
                    shooters = {"A": "A1", "B": "B1"}
                    public, reveal = build(seed, pts, obs, shooters)
                    res = gb_check.run_solver(pkg, team, public, reveal,
                                              timeout=args.timeout)
                    row = {"seed": seed, "obstacles": n_obs, "points": n_pts,
                           "team": team, "rc": res.get("rc"),
                           "wallMs": round(res.get("wallMs", 0.0), 2)}
                    if res.get("error") == "TIMEOUT":
                        timeouts += 1
                        row["error"] = "TIMEOUT"
                    elif "error" in res:
                        nofile += 1
                        row["error"] = res["error"]
                    else:
                        out = res["result"]
                        dsl = out.get("dsl")
                        if isinstance(dsl, str):
                            dsl = json.loads(dsl)
                        try:
                            ok_struct, why = _structural(dsl)
                        except Exception as exc:
                            ok_struct, why = False, repr(exc)
                        if not ok_struct:
                            illegal += 1
                            row["ast_error"] = why
                        else:
                            f = gb_check.compile_ast(dsl)
                            sid = shooters[team]
                            by = {p["id"]: p for p in pts}
                            s = by[sid]
                            legal, probs = gb_check.screen_legality(f, team, s["x"], s["y"])
                            row["legal"] = legal
                            if not legal:
                                illegal += 1
                                row["problems"] = probs[:4]
                            hits, _c = gb_check.predicted_hits(f, team, sid, pts, obs)
                            row["hits"] = sorted(hits)
                    times.append(row["wallMs"])
                    rows.append(row)

    times.sort()

    def q(p):
        if not times:
            return None
        return round(times[min(len(times) - 1, int(len(times) * p))], 2)

    print("=" * 74)
    print("OFFLINE ROBUSTNESS MATRIX  (algorithm-side; see module docstring)")
    print("  package : %s" % pkg)
    print("  shapes  : obstacles %s  x  points %s  x  teams A,B  x  %d seeds"
          % (obs_counts, team_sizes, args.seeds))
    print("=" * 74)
    print("  runs                 : %d" % len(rows))
    print("  illegal / ast errors : %d" % illegal)
    print("  timeouts             : %d" % timeouts)
    print("  crashed / no result  : %d" % nofile)
    print("  wallMs median/p95/max: %s / %s / %s" % (q(0.5), q(0.95), times[-1] if times else None))
    by_shape = {}
    for r in rows:
        k = (r["obstacles"], r["points"])
        d = by_shape.setdefault(k, {"runs": 0, "bad": 0, "hits": 0})
        d["runs"] += 1
        if r.get("error") or r.get("ast_error") or r.get("legal") is False:
            d["bad"] += 1
        d["hits"] += len(r.get("hits") or [])
    print("  per shape (obstacles, points) -> runs / bad / mean predicted kills")
    for k in sorted(by_shape):
        d = by_shape[k]
        print("    %-12s runs=%3d bad=%d meanKills=%.2f"
              % (str(k), d["runs"], d["bad"], d["hits"] / max(1, d["runs"])))
    print("=" * 74)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"package": pkg, "illegal": illegal, "timeouts": timeouts,
                       "noResult": nofile, "rows": rows}, fh,
                      ensure_ascii=False, indent=2, sort_keys=True)
    return 0 if (illegal == 0 and timeouts == 0 and nofile == 0) else 1


def _structural(dsl):
    try:
        n, d = gb_check.check_ast(dsl)
    except Exception as exc:
        return False, str(exc)
    return True, ""


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
