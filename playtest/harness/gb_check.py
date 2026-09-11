#!/usr/bin/env python3
"""
Geometry Battle V1.1 -- independent playtest checker.

Two jobs, both PLAYTEST-ONLY (no platform source is read):

1. crosscheck
   Re-derive, from the PUBLIC rules only, what should have been hit in every
   round of every archived match, and compare that with what the platform
   recorded in match.json (aHits / bHits / aKills / bKills / aBlocked / ...).
   This validates the playtest's own model of the mechanics against the real
   engine, black-box. If the model disagrees anywhere, the model is wrong and
   the report must say so.

2. screen
   Run a competitor package directly on a set of worlds and apply the public
   legality screen plus the public hit rule to whatever it emits. Used to
   measure candidate quality on worlds the platform never saw, and to catch
   INVALID-shaped output before it ever reaches a match.

The rules implemented here come from:
  competitor-kit/DSL_SPECIFICATION.md   (AST whitelist, limits, legality)
  competitor-kit/ALGORITHM_REQUIREMENTS.md section 6 and root README section 6
                                        (field, attack interval, hit, obstacle)
"""

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import hashlib

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

HIT_EPS = 1e-6
SHOOTER_EPS = 1e-6
MAX_ABS_F = 1e6
MAX_ABS_DF = 1e10
MAX_CONVEXITY_CHANGES = 100

LEAF = {"number", "variable"}
UNARY = {"neg", "sin", "cos", "tan", "sqrt", "log", "exp"}
BINARY = {"add", "sub", "mul", "div", "pow"}
WHITELIST = LEAF | UNARY | BINARY


# ---------------------------------------------------------------------------
# DSL: compile an AST to a python callable (public semantics, double precision)
# ---------------------------------------------------------------------------


class DslError(Exception):
    pass


def check_ast(node, depth=1, counter=None):
    """Structural whitelist check. Returns (nodes, depth)."""
    if counter is None:
        counter = [0]
    if not isinstance(node, dict):
        raise DslError("NOT_AN_OBJECT")
    t = node.get("type", node.get("op"))
    if t not in WHITELIST:
        raise DslError("UNSUPPORTED_OPERATOR:" + str(t))
    counter[0] += 1
    if depth > 12:
        raise DslError("DEPTH_LIMIT")
    if t == "number":
        v = node.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
            raise DslError("BAD_VALUE")
        if abs(v) > 1000:
            raise DslError("CONST_TOO_LARGE")
        return 1, 1
    if t == "variable":
        if node.get("value") != "x":
            raise DslError("BAD_VALUE")
        return 1, 1
    args = node.get("args")
    need = 1 if t in UNARY else 2
    if not isinstance(args, list) or len(args) != need:
        raise DslError("BAD_ARITY:" + t)
    n = 1
    d = 0
    for a in args:
        cn, cd = check_ast(a, depth + 1, counter)
        n += cn
        d = max(d, cd)
    if counter[0] > 128:
        raise DslError("NODE_LIMIT")
    return n, d + 1


def compile_ast(node):
    t = node.get("type", node.get("op"))
    if t == "number":
        v = float(node["value"])
        return lambda x, _v=v: _v
    if t == "variable":
        return lambda x: x
    if t == "add":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) + b(x)
    if t == "sub":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) - b(x)
    if t == "mul":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) * b(x)
    if t == "div":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) / b(x)
    if t == "pow":
        a, b = compile_ast(node["args"][0]), compile_ast(node["args"][1])
        return lambda x: a(x) ** b(x)
    if t == "neg":
        a = compile_ast(node["args"][0])
        return lambda x: -a(x)
    if t == "sin":
        a = compile_ast(node["args"][0])
        return lambda x: math.sin(a(x))
    if t == "cos":
        a = compile_ast(node["args"][0])
        return lambda x: math.cos(a(x))
    if t == "tan":
        a = compile_ast(node["args"][0])
        return lambda x: math.tan(a(x))
    if t == "sqrt":
        a = compile_ast(node["args"][0])
        return lambda x: math.sqrt(a(x))
    if t == "log":
        a = compile_ast(node["args"][0])
        return lambda x: math.log(a(x))
    if t == "exp":
        a = compile_ast(node["args"][0])
        return lambda x: math.exp(a(x))
    raise DslError("UNSUPPORTED_OPERATOR:" + str(t))


# ---------------------------------------------------------------------------
# mechanics
# ---------------------------------------------------------------------------


def direction(team):
    return 1.0 if team == "A" else -1.0


def attack_interval(team, xs):
    return (xs, 20.0) if team == "A" else (-20.0, xs)


def obstacle_hit(o, x, y):
    """Is the point (x,y) inside this obstacle?"""
    if o.get("type") == "circle" or "radius" in o:
        cx = o["cx"] if "cx" in o else o["center"][0]
        cy = o["cy"] if "cy" in o else o["center"][1]
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= o["radius"] ** 2
    return o["xmin"] <= x <= o["xmax"] and o["ymin"] <= y <= o["ymax"]


def first_contact(f, team, xs, obstacles, samples=2001, ymin=-12.0, ymax=12.0):
    """First x (in attack direction) where the trajectory dies.

    The trajectory terminates at the first of: (a) the point (x, f(x)) inside
    an obstacle, or (b) the curve leaving the field rectangle y in [ymin, ymax].
    Returns (contact_x or None, terminating_obstacle or None)."""
    d = direction(team)
    lo, hi = attack_interval(team, xs)
    # sample from the shooter outward; stop at the first termination
    span = hi - lo
    if span <= 0:
        return None, None
    step = span / (samples - 1)
    prev_x = xs
    for i in range(samples):
        x = xs + d * step * i
        if i == 0:
            continue
        try:
            y = f(x)
        except Exception:
            return None, None
        if y is not None and (y > ymax or y < ymin):
            a, b = prev_x, x
            for _ in range(40):
                m = 0.5 * (a + b)
                try:
                    ym = f(m)
                except Exception:
                    break
                if ym is None or ym > ymax or ym < ymin:
                    b = m
                else:
                    a = m
            return b, None
        inside = any(obstacle_hit(o, x, y) for o in obstacles)
        if inside:
            # bisect between prev_x and x for a sharper contact point
            a, b = prev_x, x
            for _ in range(40):
                m = 0.5 * (a + b)
                try:
                    ym = f(m)
                except Exception:
                    break
                if any(obstacle_hit(o, m, ym) for o in obstacles):
                    b = m
                else:
                    a = m
            return b, True
        prev_x = x
    return None, None


def predicted_hits(f, team, shooter_id, points, obstacles):
    """Apply the public hit rule. Returns list of point ids that die."""
    by_id = {p["id"]: p for p in points}
    s = by_id[shooter_id]
    xs = s["x"]
    d = direction(team)
    contact, _ = first_contact(f, team, xs, obstacles)
    hits = []
    for p in points:
        if p["team"] == team:
            continue
        if not p.get("alive", True):
            continue
        ahead = d * (p["x"] - xs)
        if ahead <= 0:
            continue
        if contact is not None and d * (p["x"] - contact) >= 0:
            continue
        try:
            if abs(f(p["x"]) - p["y"]) <= HIT_EPS:
                hits.append(p["id"])
        except Exception:
            continue
    return hits, contact


def screen_legality(f, team, xs, ys, samples=4001):
    """Public legality screen. Returns (ok, list_of_problems)."""
    problems = []
    lo, hi = attack_interval(team, xs)
    if hi - lo <= 0:
        return False, ["EMPTY_DOMAIN"]
    try:
        v0 = f(xs)
    except Exception as exc:
        return False, ["DOMAIN_ERROR_AT_SHOOTER:" + repr(exc)]
    if abs(v0 - ys) > SHOOTER_EPS:
        problems.append("NOT_THROUGH_SHOOTER:%.3e" % abs(v0 - ys))
    step = (hi - lo) / (samples - 1)
    prev = None
    prev_prev = None
    convex_sign = 0
    changes = 0
    prev_sign = 0
    for i in range(samples):
        x = xs + direction(team) * step * i
        try:
            y = f(x)
        except Exception as exc:
            problems.append("DOMAIN_ERROR:%r@%.4f" % (exc, x))
            return False, problems
        if not math.isfinite(y):
            problems.append("NOT_FINITE@%.4f" % x)
            return False, problems
        if abs(y) > MAX_ABS_F:
            problems.append("NOT_FINITE:abs>1e6@%.4f" % x)
            return False, problems
        if prev is not None:
            slope = (y - prev) / step if step else 0.0
            if abs(slope) > MAX_ABS_DF:
                problems.append("NOT_C2:slope@%.4f" % x)
                return False, problems
            if prev_prev is not None:
                curv = (y - 2 * prev + prev_prev) / (step * step)
                s = 1 if curv > 1e-9 else (-1 if curv < -1e-9 else 0)
                if s != 0 and prev_sign != 0 and s != prev_sign:
                    changes += 1
                if s != 0:
                    prev_sign = s
        prev_prev = prev
        prev = y
    if changes > MAX_CONVEXITY_CHANGES:
        problems.append("CONVEXITY_LIMIT:%d" % changes)
    return (len(problems) == 0), problems


# ---------------------------------------------------------------------------
# worlds
# ---------------------------------------------------------------------------


def public_bytes(public):
    return json.dumps(public, separators=(",", ":")).encode("utf-8")


def bind(public, reveal):
    reveal["public_state_sha256"] = hashlib.sha256(public_bytes(public)).hexdigest()
    return reveal


def worlds_from_raw(raw_dir):
    worlds = []
    for name in sorted(os.listdir(raw_dir)):
        d = os.path.join(raw_dir, name)
        p = os.path.join(d, "replay.json")
        if not os.path.isfile(p):
            continue
        rp = json.load(open(p, encoding="utf-8"))
        for f in rp.get("frames") or []:
            if f.get("phase") != "ROUND_RESULT":
                continue
            obstacles = []
            for o in f.get("obstacles") or []:
                if o.get("type") == "circle" and "center" in o:
                    obstacles.append({"id": "O", "type": "circle",
                                      "cx": o["center"][0], "cy": o["center"][1],
                                      "radius": o["radius"]})
                else:
                    obstacles.append({"id": "O", "type": "rectangle",
                                      "xmin": o["xmin"], "xmax": o["xmax"],
                                      "ymin": o["ymin"], "ymax": o["ymax"]})
            pts = [{"id": q["id"], "team": q["team"], "x": q["position"]["x"],
                    "y": q["position"]["y"], "alive": True}
                   for q in (f.get("aliveBefore") or [])]
            public = {"schema_version": "1.1", "match_id": rp.get("matchId"),
                      "round": f.get("round"),
                      "map": {"xmin": -20, "xmax": 20, "ymin": -12, "ymax": 12},
                      "points": pts}
            reveal = {"schema_version": "1.1", "match_id": rp.get("matchId"),
                      "round": f.get("round"), "public_state_sha256": "",
                      "shooters": {"A": (f.get("shooterA") or {}).get("id"),
                                   "B": (f.get("shooterB") or {}).get("id")},
                      "obstacles": obstacles}
            bind(public, reveal)
            worlds.append({"name": "%s-r%s" % (name, f.get("round")),
                           "public": public, "reveal": reveal,
                           "recordedHits": {"A": [h["id"] for h in (f.get("hitsA") or [])],
                                            "B": [h["id"] for h in (f.get("hitsB") or [])]},
                           "recordedFunctions": {"A": f.get("functionA"), "B": f.get("functionB")},
                           "blockedA": f.get("blockedA"), "blockedB": f.get("blockedB")})
    return worlds


# ---------------------------------------------------------------------------
# crosscheck
# ---------------------------------------------------------------------------


def cmd_crosscheck(args):
    worlds = worlds_from_raw(os.path.abspath(args.raw))
    if args.limit:
        worlds = worlds[:args.limit]
    total = 0
    agree = 0
    mismatches = []
    contact_stats = {"none": 0, "blocked": 0}
    for w in worlds:
        points = w["public"]["points"]
        obstacles = w["reveal"]["obstacles"]
        for team in ("A", "B"):
            fn = w["recordedFunctions"][team]
            if fn is None:
                continue
            total += 1
            try:
                f = compile_ast(fn)
            except Exception as exc:
                mismatches.append({"world": w["name"], "team": team,
                                   "why": "compile failed: %r" % exc})
                continue
            sid = w["reveal"]["shooters"][team]
            got, contact = predicted_hits(f, team, sid, points, obstacles)
            want = w["recordedHits"][team]
            if contact is None:
                contact_stats["none"] += 1
            else:
                contact_stats["blocked"] += 1
            if sorted(got) == sorted(want):
                agree += 1
            else:
                mismatches.append({
                    "world": w["name"], "team": team,
                    "model_says": sorted(got), "platform_says": sorted(want),
                    "contact_x": contact,
                    "shooters": w["reveal"]["shooters"],
                })
    print("[crosscheck] rounds compared = %d, model agrees = %d (%.1f%%)" % (
        total, agree, 100.0 * agree / max(1, total)))
    print("[crosscheck] trajectory terminated: by obstacle=%d, ran to field edge=%d" % (
        contact_stats["blocked"], contact_stats["none"]))
    if mismatches:
        print("[crosscheck] MISMATCHES (%d):" % len(mismatches))
        for m in mismatches[:15]:
            print("   ", json.dumps(m, ensure_ascii=False)[:300])
    else:
        print("[crosscheck] no mismatches -- the playtest mechanics model matches the engine on every archived round")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"total": total, "agree": agree, "mismatches": mismatches,
                       "contactStats": contact_stats}, fh, ensure_ascii=False, indent=2)
    return 0 if not mismatches else 1


# ---------------------------------------------------------------------------
# screen a package
# ---------------------------------------------------------------------------


def run_solver(pkg, team, public, reveal, timeout=20.0):
    with tempfile.TemporaryDirectory() as td:
        pf = os.path.join(td, "public_state.json")
        rf = os.path.join(td, "reveal_state.json")
        of = os.path.join(td, "result.json")
        with open(pf, "wb") as fh:
            fh.write(public_bytes(public))
        with open(rf, "w", encoding="utf-8") as fh:
            json.dump(reveal, fh)
        cmd = ["/usr/bin/python3", os.path.join(os.path.abspath(pkg), "solver.py"),
               "--team", team, "--public", pf, "--reveal", rf, "--output", of]
        t0 = time.time()
        try:
            proc = subprocess.run(cmd, cwd=td, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, timeout=timeout)
            rc, err = proc.returncode, proc.stderr.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            return {"rc": 124, "wallMs": (time.time() - t0) * 1000.0, "error": "TIMEOUT"}
        dt = (time.time() - t0) * 1000.0
        if not os.path.isfile(of):
            return {"rc": rc, "wallMs": dt, "error": "NO_RESULT_FILE", "stderr": err[-400:]}
        try:
            res = json.load(open(of, encoding="utf-8"))
        except Exception as exc:
            return {"rc": rc, "wallMs": dt, "error": "BAD_JSON:%r" % exc}
        diag = None
        for line in err.splitlines():
            if line.startswith("GB_DIAG "):
                try:
                    diag = json.loads(line[8:])
                except Exception:
                    pass
        return {"rc": rc, "wallMs": dt, "result": res, "stderr": err[-400:], "diag": diag}


def cmd_screen(args):
    if args.worlds:
        worlds = worlds_from_raw(os.path.abspath(args.worlds))
    else:
        worlds = []
    if args.json_worlds:
        worlds += json.load(open(args.json_worlds, encoding="utf-8"))
    if args.limit:
        worlds = worlds[:args.limit]
    pkg = os.path.abspath(args.pkg)
    rows = []
    for w in worlds:
        for team in args.teams:
            r = run_solver(pkg, team, w["public"], w["reveal"], args.timeout)
            row = {"world": w["name"], "team": team, "rc": r.get("rc"),
                   "wallMs": round(r.get("wallMs", 0), 2)}
            if "error" in r:
                row["error"] = r["error"]
            else:
                res = r["result"]
                row["keys"] = sorted(res.keys())
                dsl = res.get("dsl")
                if isinstance(dsl, str):
                    dsl = json.loads(dsl)
                try:
                    n, d = check_ast(dsl)
                    row["nodes"], row["depth"] = n, d
                except DslError as exc:
                    row["ast_error"] = str(exc)
                    rows.append(row)
                    continue
                f = compile_ast(dsl)
                sid = w["reveal"]["shooters"][team]
                by_id = {p["id"]: p for p in w["public"]["points"]}
                s = by_id[sid]
                ok, probs = screen_legality(f, team, s["x"], s["y"])
                row["legal"] = ok
                if not ok:
                    row["problems"] = probs[:5]
                hits, contact = predicted_hits(f, team, sid, w["public"]["points"],
                                               w["reveal"]["obstacles"])
                row["hits"] = sorted(hits)
                row["enemyShooterHit"] = w["reveal"]["shooters"]["B" if team == "A" else "A"] in hits
                row["blocked"] = contact is not None
                if w.get("recordedHits"):
                    row["platformHits"] = sorted(w["recordedHits"][team])
            if r.get("diag"):
                row["diag"] = r["diag"]
            rows.append(row)
    bad = [r for r in rows if r.get("error") or r.get("ast_error") or r.get("legal") is False]
    times = [r["wallMs"] for r in rows]
    print("[screen] %s: runs=%d illegal_or_broken=%d" % (pkg, len(rows), len(bad)))
    if times:
        xs = sorted(times)
        print("[screen] wallMs median=%.1f p95=%.1f max=%.1f" % (
            xs[len(xs) // 2], xs[min(len(xs) - 1, int(len(xs) * 0.95))], xs[-1]))
    hit_counts = [len(r.get("hits") or []) for r in rows if "hits" in r]
    if hit_counts:
        nz = sum(1 for h in hit_counts if h > 0)
        print("[screen] predicted kills: mean=%.2f  rounds with >=1 kill=%d/%d  shooter-hit rounds=%d" % (
            sum(hit_counts) / len(hit_counts), nz, len(hit_counts),
            sum(1 for r in rows if r.get("enemyShooterHit"))))
    for r in bad[:20]:
        print("[screen]   BAD", json.dumps(r, ensure_ascii=False)[:320])
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"package": pkg, "rows": rows}, fh, ensure_ascii=False, indent=2)
    return 0


# ---------------------------------------------------------------------------


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("crosscheck")
    p.add_argument("--raw", default="playtest/results/raw")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_crosscheck)

    p = sub.add_parser("screen")
    p.add_argument("--pkg", required=True)
    p.add_argument("--worlds", default=None)
    p.add_argument("--json-worlds", dest="json_worlds", default=None)
    p.add_argument("--teams", default="AB")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--timeout", type=float, default=20.0)
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_screen)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
