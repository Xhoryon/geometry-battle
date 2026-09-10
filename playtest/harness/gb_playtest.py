#!/usr/bin/env python3
"""
Geometry Battle V1.1 -- Dual Algorithm Playtest Harness.

This is PLAYTEST-ONLY tooling. It does not modify the platform, the rules,
the slots under algorithms/, or either competitor package. It drives the
official operator CLI as a black box, archives the artefacts the platform
itself produces, and derives the playtest metrics from those artefacts.

Everything it reports comes from:
  * the operator CLI console output (match id, artefact path, final summary)
  * artifacts/matches/<id>/match.json   (per round: times, ASTs, hits, kills,
                                         blocks, cancellations, error codes)
  * artifacts/matches/<id>/replay.json  (per round: obstacles, positions,
                                         shooters, hits, trajectories)

No Judge / Validator / SandboxRunner source is read.

Usage
-----
  python3 playtest/harness/gb_playtest.py install \
      --fast playtest/competitors/solver-fast \
      --optimizer playtest/competitors/solver-optimizer

  python3 playtest/harness/gb_playtest.py run \
      --conditions playtest/harness/conditions.json \
      --out playtest/results/raw \
      --max-rounds 30

  python3 playtest/harness/gb_playtest.py analyze \
      --raw playtest/results/raw \
      --out playtest/results

  python3 playtest/harness/gb_playtest.py bench \
      --worlds playtest/results/raw \
      --fast playtest/competitors/solver-fast \
      --optimizer playtest/competitors/solver-optimizer \
      --out playtest/results/bench
"""

import argparse
import ast as pyast
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CLI = ["npx", "--no-install", "ts-node", "src/operator/cli.ts"]

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def die(msg, code=2):
    sys.stderr.write(msg.rstrip() + "\n")
    return code


def sh(cmd, cwd=REPO, timeout=3600):
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout)
    out = proc.stdout.decode("utf-8", "replace")
    return proc.returncode, out, time.time() - t0


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, path)


def pct(values, q):
    """Simple nearest-rank percentile on a sorted copy."""
    if not values:
        return None
    xs = sorted(values)
    if len(xs) == 1:
        return float(xs[0])
    k = (len(xs) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return float(xs[lo] + (xs[hi] - xs[lo]) * (k - lo))


def ms_stats(values):
    values = [v for v in values if isinstance(v, (int, float))]
    if not values:
        return {"n": 0, "median": None, "p95": None, "max": None, "mean": None}
    return {
        "n": len(values),
        "median": round(statistics.median(values), 3),
        "p95": round(pct(values, 0.95), 3),
        "max": round(float(max(values)), 3),
        "mean": round(float(statistics.mean(values)), 3),
    }


# ---------------------------------------------------------------------------
# AST helpers (public DSL only -- competitor-kit/DSL_SPECIFICATION.md)
# ---------------------------------------------------------------------------

UNARY = {"neg", "sin", "cos", "tan", "sqrt", "log", "exp"}
BINARY = {"add", "sub", "mul", "div", "pow"}
LEAF = {"number", "variable"}


def ast_stats(node):
    """Return (nodes, depth) for a DSL AST. Leaves have depth 1."""
    if not isinstance(node, dict):
        return 0, 0
    t = node.get("type", node.get("op"))
    if t in LEAF:
        return 1, 1
    args = node.get("args") or []
    n = 1
    d = 0
    for a in args:
        cn, cd = ast_stats(a)
        n += cn
        d = max(d, cd)
    return n, d + 1


def ast_max_const(node):
    if not isinstance(node, dict):
        return 0.0
    t = node.get("type", node.get("op"))
    best = 0.0
    if t == "number":
        v = node.get("value")
        if isinstance(v, (int, float)):
            best = abs(float(v))
    for a in (node.get("args") or []):
        best = max(best, ast_max_const(a))
    return best


def parse_fn(raw):
    """match.json stores the function as a JSON string; the platform also
    accepts an AST object. Handle both, quietly returning None on garbage."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------


def cmd_install(args):
    """Install both packages once per slot arrangement.

    Two slot roots are maintained so that the head-to-head can be run with the
    roles swapped WITHOUT touching algorithms/team-a or algorithms/team-b:

        <slots>/fast-A/   team-a = solver-fast,        team-b = solver-optimizer
        <slots>/opt-A/    team-a = solver-optimizer,   team-b = solver-fast

    Installing goes through the platform's own staging -> validate -> preflight
    -> hash -> seal -> replace pipeline, so the preflight output captured here
    is the official Preflight.
    """
    slots_root = os.path.abspath(args.slots)
    report = {}
    for label, a_dir, b_dir in (
        ("fast-A", args.fast, args.optimizer),
        ("opt-A", args.optimizer, args.fast),
    ):
        root = os.path.join(slots_root, label)
        if os.path.isdir(root):
            shutil.rmtree(root)
        os.makedirs(root)
        cmd = CLI + ["--auto", "--slots", root, "--a", os.path.abspath(a_dir),
                     "--b", os.path.abspath(b_dir), "--seed", "5",
                     "--points", "6", "--max-rounds", "1"]
        print("[install] %s : A=%s B=%s" % (label, a_dir, b_dir))
        rc, out, secs = sh(cmd)
        report[label] = {"rc": rc, "seconds": round(secs, 2), "output": out}
        passed = "Preflight" in out and "PASSED" in out
        print("[install] %s rc=%d preflight_passed=%s (%.1fs)" % (label, rc, passed, secs))
    write_json(os.path.join(slots_root, "install-report.json"), report)
    print("[install] slot roots written under %s" % slots_root)
    return 0


# ---------------------------------------------------------------------------
# run matches
# ---------------------------------------------------------------------------


def load_conditions(path):
    if path and os.path.isfile(path):
        return read_json(path)["conditions"]
    # built-in default condition set: 30 map conditions, mixed sizes and densities
    conds = []
    seeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010,
             1111, 1212, 1313, 1414, 1515, 1616, 1717, 1818, 1919, 2020,
             2121, 2222, 2323, 2424]
    for i, s in enumerate(seeds):
        pts = [6, 8, 10][i % 3]
        conds.append({"seed": s, "points": pts, "difficulty": "medium"})
    for i, s in enumerate([3131, 3232, 3333, 3434, 3535, 3636]):
        pts = [6, 8, 10][i % 3]
        conds.append({"seed": s, "points": pts, "difficulty": ["easy", "hard"][i % 2]})
    for c in conds:
        c["label"] = "s%d-p%d-%s" % (c["seed"], c["points"], c["difficulty"])
    return conds


ART_RE = re.compile(r"Artifacts:\s*(\S+)")


def run_one(slot_root, cond, arrangement, out_dir, max_rounds):
    """One match. arrangement is 'fast-A' (fast in slot A) or 'opt-A'."""
    label = "%s__%s" % (cond["label"], arrangement)
    dest = os.path.join(out_dir, label)
    if os.path.isfile(os.path.join(dest, "match.json")):
        print("[run] skip (already archived): %s" % label)
        return read_json(os.path.join(dest, "summary.json"))
    cmd = CLI + ["--auto", "--slots", os.path.abspath(os.path.join(slot_root, arrangement)),
                 "--seed", str(cond["seed"]), "--points", str(cond["points"]),
                 "--difficulty", cond["difficulty"], "--max-rounds", str(max_rounds)]
    rc, out, secs = sh(cmd)
    m = ART_RE.search(out)
    if not m:
        print("[run] !! no artefact path in output for %s" % label)
        os.makedirs(dest, exist_ok=True)
        with open(os.path.join(dest, "console.log"), "w", encoding="utf-8") as f:
            f.write(out)
        return None
    art = m.group(1)
    os.makedirs(dest, exist_ok=True)
    for name in ("match.json", "replay.json", "audit.json"):
        src = os.path.join(art, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, name))
    with open(os.path.join(dest, "console.log"), "w", encoding="utf-8") as f:
        f.write(out)
    match = read_json(os.path.join(dest, "match.json"))
    summary = {
        "label": cond["label"],
        "arrangement": arrangement,
        "condition": cond,
        "matchId": match.get("matchId"),
        "winner": match.get("winner"),
        "finalAlive": match.get("finalAlive"),
        "rounds": len(match.get("rounds") or []),
        "maxRounds": max_rounds,
        "exhausted": (len(match.get("rounds") or []) >= max_rounds and match.get("winner") == "draw"),
        "wallSeconds": round(secs, 2),
        "artifactDir": art,
    }
    write_json(os.path.join(dest, "summary.json"), summary)
    print("[run] %-46s winner=%-4s rounds=%2d (%.1fs)" % (
        label, summary["winner"], summary["rounds"], secs))
    return summary


def cmd_run(args):
    conds = load_conditions(args.conditions)
    out_dir = os.path.abspath(args.out)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    summaries = []
    for cond in conds:
        for arrangement in ("fast-A", "opt-A"):
            s = run_one(args.slots, cond, arrangement, out_dir, args.max_rounds)
            if s:
                summaries.append(s)
    write_json(os.path.join(out_dir, "run-summary.json"),
               {"conditions": len(conds), "matches": len(summaries), "summaries": summaries})
    print("[run] %d matches across %d conditions" % (len(summaries), len(conds)))
    return 0


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------


def algorithm_of(arrangement, slot):
    """Map (arrangement, slot) -> algorithm name."""
    if arrangement == "fast-A":
        return "fast" if slot == "A" else "optimizer"
    return "optimizer" if slot == "A" else "fast"


def analyse_match(dest):
    """Extract every playtest metric from one archived match."""
    match = read_json(os.path.join(dest, "match.json"))
    summary = read_json(os.path.join(dest, "summary.json"))
    replay = read_json(os.path.join(dest, "replay.json"))
    frames = {(f.get("round")): f for f in replay.get("frames") or []}

    n_rounds = len(match.get("rounds") or [])
    rec = {
        "label": summary["label"],
        "arrangement": summary["arrangement"],
        "condition": summary["condition"],
        "matchId": match.get("matchId"),
        "winner": match.get("winner"),
        "winnerAlgorithm": None,
        "rounds": n_rounds,
        "maxRounds": summary["maxRounds"],
        "exhausted": n_rounds >= summary["maxRounds"] and match.get("winner") == "draw",
        "finalAlive": match.get("finalAlive"),
        "perRound": [],
        "perAlgorithm": {
            "fast": new_alg_acc(),
            "optimizer": new_alg_acc(),
        },
    }
    if match.get("winner") in ("A", "B"):
        rec["winnerAlgorithm"] = algorithm_of(summary["arrangement"], match["winner"])

    rec["mapSeed"] = (match.get("rounds") or [{}])[0].get("mapSeed")
    rec["mapHash"] = (match.get("rounds") or [{}])[0].get("mapHash")
    rec["pointCount"] = match.get("pointCount")
    rec["difficulty"] = match.get("difficulty")

    for r in match.get("rounds") or []:
        rnd = r.get("round")
        frame = frames.get(rnd) or {}
        entry = {
            "round": rnd,
            "firstSolver": r.get("firstSolver"),
            "result": r.get("result"),
            "shooterA": r.get("shooterA"),
            "shooterB": r.get("shooterB"),
            "obstacleCount": len(frame.get("obstacles") or []),
        }
        for slot in ("A", "B"):
            alg = algorithm_of(summary["arrangement"], slot)
            s = slot.lower()
            fn = parse_fn(r.get(s + "Function"))
            nodes, depth = ast_stats(fn) if fn else (None, None)
            hits = r.get(s + "Hits") or []
            enemy_shooter = r.get("shooterB" if slot == "A" else "shooterA")
            t = r.get(s + "TimeMs")
            err = r.get(s + "ErrorCode")
            blocked = r.get(s + "Blocked")
            cancelled = r.get("cancelled" + slot)
            entry[alg] = {
                "slot": slot,
                "timeMs": t,
                "nodes": nodes,
                "depth": depth,
                "maxConst": round(ast_max_const(fn), 3) if fn else None,
                "hits": hits,
                "kills": r.get(s + "Kills"),
                "blocked": blocked,
                "cancelled": bool(cancelled),
                "errorCode": err,
                "enemyShooter": enemy_shooter,
                "killedEnemyShooter": enemy_shooter in hits,
                "multiKill": (r.get(s + "Kills") or 0) >= 2,
                "functionMath": r.get(s + "FunctionMath"),
            }
        rec["perRound"].append(entry)
        for alg in ("fast", "optimizer"):
            accumulate(rec["perAlgorithm"][alg], entry[alg], entry)

    # no-progress streak on the whole match
    streak = 0
    longest = 0
    for e in rec["perRound"]:
        kills = (e["fast"]["kills"] or 0) + (e["optimizer"]["kills"] or 0)
        if kills == 0:
            streak += 1
            longest = max(longest, streak)
        else:
            streak = 0
    rec["longestNoKillStreak"] = longest
    for alg in ("fast", "optimizer"):
        rec["perAlgorithm"][alg]["longestNoKillStreak"] = longest
    return rec


def new_alg_acc():
    return {
        "rounds": 0, "shotsValid": 0, "invalid": 0, "timeout": 0,
        "kills": 0, "shooterKills": 0, "multiKills": 0, "noHitRounds": 0,
        "blocked": 0, "cancelled": 0, "firstSolver": 0, "times": [],
        "nodes": [], "depths": [],
    }


def accumulate(acc, side, entry):
    acc["rounds"] += 1
    if side["cancelled"]:
        acc["cancelled"] += 1
    err = side["errorCode"]
    err_upper = str(err).upper() if err is not None else ""
    if err is not None and err_upper != "CANCELLED":
        # a real failure (INVALID / TIMEOUT / anything else the platform emits)
        if "TIMEOUT" in err_upper:
            acc["timeout"] += 1
        else:
            acc["invalid"] += 1
    elif err is None and side["kills"] is not None:
        # only rounds the platform actually executed count as a valid shot
        acc["shotsValid"] += 1
    if isinstance(side["timeMs"], (int, float)) and side["timeMs"] >= 0:
        acc["times"].append(side["timeMs"])
    if side["nodes"]:
        acc["nodes"].append(side["nodes"])
        acc["depths"].append(side["depth"])
    acc["kills"] += side["kills"] or 0
    if side["killedEnemyShooter"]:
        acc["shooterKills"] += 1
    if side["multiKill"]:
        acc["multiKills"] += 1
    if not side["hits"]:
        acc["noHitRounds"] += 1
    if side["blocked"]:
        acc["blocked"] += 1
    if entry["firstSolver"] == side["slot"]:
        acc["firstSolver"] += 1


def finalise_acc(acc):
    out = dict(acc)
    out["timeStats"] = ms_stats(acc["times"])
    out["nodeStats"] = ms_stats(acc["nodes"])
    out["depthStats"] = ms_stats(acc["depths"])
    out["killsPerValidShot"] = round(acc["kills"] / acc["shotsValid"], 3) if acc["shotsValid"] else None
    out["multiKillRate"] = round(acc["multiKills"] / acc["rounds"], 4) if acc["rounds"] else None
    out["noHitRate"] = round(acc["noHitRounds"] / acc["rounds"], 4) if acc["rounds"] else None
    out["firstShotRate"] = round(acc["firstSolver"] / acc["rounds"], 4) if acc["rounds"] else None
    out["shooterKillRate"] = round(acc["shooterKills"] / acc["rounds"], 4) if acc["rounds"] else None
    del out["times"]
    return out


def cmd_analyze(args):
    raw = os.path.abspath(args.raw)
    out_dir = os.path.abspath(args.out)
    records = []
    for name in sorted(os.listdir(raw)):
        d = os.path.join(raw, name)
        if os.path.isfile(os.path.join(d, "match.json")) and os.path.isfile(os.path.join(d, "summary.json")):
            records.append(analyse_match(d))
    if not records:
        return die("no archived matches under %s" % raw)

    agg = {"fast": new_alg_acc(), "optimizer": new_alg_acc()}
    agg_by_arr = {"fast-A": {"fast": new_alg_acc(), "optimizer": new_alg_acc()},
                  "opt-A": {"fast": new_alg_acc(), "optimizer": new_alg_acc()}}
    wins = {"fast": 0, "optimizer": 0, "draw": 0}
    by_arrangement = {}
    by_condition = {}
    for rec in records:
        if rec["winner"] == "draw":
            wins["draw"] += 1
        else:
            wins[rec["winnerAlgorithm"]] += 1
        for alg in ("fast", "optimizer"):
            for e in rec["perRound"]:
                accumulate(agg[alg], e[alg], e)
                accumulate(agg_by_arr[rec["arrangement"]][alg], e[alg], e)
        key = rec["arrangement"]
        by_arrangement.setdefault(key, {"fast": 0, "optimizer": 0, "draw": 0})
        if rec["winner"] == "draw":
            by_arrangement[key]["draw"] += 1
        else:
            by_arrangement[key][rec["winnerAlgorithm"]] += 1
        c = by_condition.setdefault(rec["label"], {
            "label": rec["label"], "pointCount": rec["pointCount"],
            "difficulty": rec["difficulty"], "mapSeed": rec["mapSeed"],
            "mapHash": rec["mapHash"], "runs": []})
        final_fast = None
        final_opt = None
        for e in reversed(rec["perRound"]):
            final_fast = e["fast"]["slot"]
            final_opt = e["optimizer"]["slot"]
            break
        c["runs"].append({
            "arrangement": rec["arrangement"],
            "winner": rec["winner"],
            "winnerAlgorithm": rec["winnerAlgorithm"],
            "rounds": rec["rounds"],
            "exhausted": rec["exhausted"],
            "fastSlot": final_fast, "optimizerSlot": final_opt,
        })

    # per-condition agreement between the two swap arrangements
    swap_consistent = 0
    swap_flipped = 0
    for c in by_condition.values():
        winners = [r["winnerAlgorithm"] for r in c["runs"] if r["winnerAlgorithm"]]
        if len(c["runs"]) == 2 and len(winners) == 2:
            if winners[0] == winners[1]:
                swap_consistent += 1
            else:
                swap_flipped += 1

    result = {
        "matches": len(records),
        "conditions": len(set(r["label"] for r in records)),
        "distinctMapHashes": len(set(r["mapHash"] for r in records if r.get("mapHash"))),
        "wins": wins,
        "winsByArrangement": by_arrangement,
        "algorithms": {alg: finalise_acc(agg[alg]) for alg in ("fast", "optimizer")},
        "algorithmsByArrangement": {
            arr: {alg: finalise_acc(agg_by_arr[arr][alg]) for alg in ("fast", "optimizer")}
            for arr in agg_by_arr},
        "matchLength": ms_stats([r["rounds"] for r in records]),
        "exhaustedMatches": sum(1 for r in records if r["exhausted"]),
        "swapConsistent": swap_consistent,
        "swapFlipped": swap_flipped,
        "byCondition": by_condition,
        "records": records,
    }
    write_json(os.path.join(out_dir, "metrics.json"), result)
    print_analysis(result)
    print("[analyze] wrote %s" % os.path.join(out_dir, "metrics.json"))
    return 0


def print_analysis(res):
    print("=" * 72)
    print("DUAL ALGORITHM PLAYTEST -- AGGREGATE")
    print("=" * 72)
    print("matches=%d  conditions=%d  distinctMaps=%d  exhausted(max-rounds)=%d  matchLength median=%s p95=%s max=%s" % (
        res["matches"], res["conditions"], res["distinctMapHashes"], res["exhaustedMatches"],
        res["matchLength"]["median"], res["matchLength"]["p95"], res["matchLength"]["max"]))
    print("wins (by algorithm): %s" % res["wins"])
    print("wins (by slot arrangement): %s" % res["winsByArrangement"])
    print("swap agreement: consistent=%d flipped=%d (of %d conditions with both sides decided)" % (
        res["swapConsistent"], res["swapFlipped"],
        res["swapConsistent"] + res["swapFlipped"]))
    for alg in ("fast", "optimizer"):
        a = res["algorithms"][alg]
        print("-" * 72)
        print("%-10s rounds=%d valid=%d invalid=%d timeout=%d cancelled=%d blocked=%d" % (
            alg, a["rounds"], a["shotsValid"], a["invalid"], a["timeout"], a["cancelled"], a["blocked"]))
        print("%-10s kills=%d shooterKills=%d multiKills=%d noHit=%d killsPerValidShot=%s" % (
            "", a["kills"], a["shooterKills"], a["multiKills"], a["noHitRounds"], a["killsPerValidShot"]))
        print("%-10s firstShotRate=%s shooterKillRate=%s multiKillRate=%s noHitRate=%s" % (
            "", a["firstShotRate"], a["shooterKillRate"], a["multiKillRate"], a["noHitRate"]))
        t = a["timeStats"]
        print("%-10s timeMs median=%s p95=%s max=%s" % ("", t["median"], t["p95"], t["max"]))
        print("%-10s astNodes median=%s  astDepth median=%s" % (
            "", a["nodeStats"]["median"], a["depthStats"]["median"]))
    print("-" * 72)
    print("per slot arrangement (Team A / Team B swap check):")
    for arr in sorted(res["algorithmsByArrangement"]):
        for alg in ("fast", "optimizer"):
            a = res["algorithmsByArrangement"][arr][alg]
            print("  %-6s %-10s rounds=%3d kills=%3d shooterKills=%2d firstShotRate=%s noHitRate=%s timeMedian=%s" % (
                arr, alg, a["rounds"], a["kills"], a["shooterKills"],
                a["firstShotRate"], a["noHitRate"], a["timeStats"]["median"]))


# ---------------------------------------------------------------------------
# bench: direct invocation, official sandbox not involved
# ---------------------------------------------------------------------------


def worlds_from_raw(raw_dir):
    """Rebuild (public_state, reveal_state) pairs from archived replay frames.

    This uses the platform's own recorded worlds, so the distributions match
    real matches. The binding sha256 is recomputed by us -- the package only
    checks that the two files agree, which is exactly what the platform does.
    """
    import hashlib
    worlds = []
    for name in sorted(os.listdir(raw_dir)):
        d = os.path.join(raw_dir, name)
        p = os.path.join(d, "replay.json")
        if not os.path.isfile(p):
            continue
        rp = read_json(p)
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
            pts = []
            for q in f.get("aliveBefore") or []:
                pts.append({"id": q["id"], "team": q["team"],
                            "x": q["position"]["x"], "y": q["position"]["y"],
                            "alive": True})
            if len(pts) != 16:
                pass
            public = {
                "schema_version": "1.1",
                "match_id": rp.get("matchId"),
                "round": f.get("round"),
                "map": {"xmin": -20, "xmax": 20, "ymin": -12, "ymax": 12},
                "points": pts,
            }
            raw_bytes = json.dumps(public, separators=(",", ":")).encode("utf-8")
            reveal = {
                "schema_version": "1.1",
                "match_id": rp.get("matchId"),
                "round": f.get("round"),
                "public_state_sha256": hashlib.sha256(raw_bytes).hexdigest(),
                "shooters": {"A": (f.get("shooterA") or {}).get("id"),
                             "B": (f.get("shooterB") or {}).get("id")},
                "obstacles": obstacles,
            }
            worlds.append({"name": "%s-r%s" % (name, f.get("round")),
                           "public": public, "reveal": reveal})
    return worlds


def cmd_bench(args):
    import tempfile
    out_dir = os.path.abspath(args.out)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    worlds = worlds_from_raw(os.path.abspath(args.worlds))
    if args.limit:
        worlds = worlds[:args.limit]
    print("[bench] %d worlds" % len(worlds))
    results = {}
    for name, pkg in (("fast", args.fast), ("optimizer", args.optimizer)):
        pkg = os.path.abspath(pkg)
        rows = []
        solver = os.path.join(pkg, "solver.py")
        for w in worlds:
            with tempfile.TemporaryDirectory() as td:
                pf = os.path.join(td, "public_state.json")
                rf = os.path.join(td, "reveal_state.json")
                with open(pf, "wb") as f:
                    f.write(json.dumps(w["public"], separators=(",", ":")).encode("utf-8"))
                with open(rf, "w", encoding="utf-8") as f:
                    json.dump(w["reveal"], f)
                for team in ("A", "B"):
                    of = os.path.join(td, "result.json")
                    cmd = ["/usr/bin/python3", solver, "--team", team,
                           "--public", pf, "--reveal", rf, "--output", of]
                    t0 = time.time()
                    try:
                        proc = subprocess.run(cmd, cwd=td, stdout=subprocess.PIPE,
                                              stderr=subprocess.PIPE, timeout=args.timeout)
                        rc = proc.returncode
                        err = proc.stderr.decode("utf-8", "replace")
                    except subprocess.TimeoutExpired:
                        rc, err = 124, ""
                    dt = (time.time() - t0) * 1000.0
                    row = {"world": w["name"], "team": team, "rc": rc,
                           "wallMs": round(dt, 3), "ok": False}
                    if os.path.isfile(of):
                        try:
                            res = read_json(of)
                            keys = sorted(res.keys())
                            row["keys"] = keys
                            fn = res.get("dsl")
                            if isinstance(fn, str):
                                fn = json.loads(fn)
                            n, d = ast_stats(fn)
                            row["nodes"], row["depth"] = n, d
                            row["ok"] = keys == ["dsl", "schema_version"] and res.get("schema_version") == "1.1"
                        except Exception as exc:
                            row["error"] = repr(exc)
                    diag = None
                    for line in err.splitlines():
                        if line.startswith("GB_DIAG "):
                            try:
                                diag = json.loads(line[len("GB_DIAG "):])
                            except Exception:
                                pass
                    if diag:
                        row["diag"] = diag
                    rows.append(row)
        results[name] = {
            "package": pkg,
            "runs": len(rows),
            "failures": sum(1 for r in rows if not r["ok"]),
            "wallMs": ms_stats([r["wallMs"] for r in rows]),
            "nodes": ms_stats([r["nodes"] for r in rows if r.get("nodes")]),
            "depths": ms_stats([r["depth"] for r in rows if r.get("depth")]),
            "candidateCount": ms_stats([r["diag"]["candidates"] for r in rows
                                        if r.get("diag") and "candidates" in r["diag"]]),
            "shooterTargeted": (
                sum(1 for r in rows if r.get("diag") and r["diag"].get("shooter_targeted")) /
                max(1, sum(1 for r in rows if r.get("diag") and "shooter_targeted" in r["diag"]))
            ),
            "diagAvailable": sum(1 for r in rows if r.get("diag")),
            "rows": rows,
        }
        write_json(os.path.join(out_dir, "bench-%s.json" % name), results[name])
        r = results[name]
        print("[bench] %-10s runs=%d failures=%d wallMs median=%s p95=%s max=%s diag=%d" % (
            name, r["runs"], r["failures"], r["wallMs"]["median"], r["wallMs"]["p95"],
            r["wallMs"]["max"], r["diagAvailable"]))
    write_json(os.path.join(out_dir, "bench.json"), results)
    return 0


# ---------------------------------------------------------------------------


def main(argv):
    ap = argparse.ArgumentParser(description="Geometry Battle dual algorithm playtest harness")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("install")
    p.add_argument("--fast", required=True)
    p.add_argument("--optimizer", required=True)
    p.add_argument("--slots", default="playtest/slots")
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("run")
    p.add_argument("--conditions", default=None)
    p.add_argument("--slots", default="playtest/slots")
    p.add_argument("--out", default="playtest/results/raw")
    p.add_argument("--max-rounds", type=int, default=30, dest="max_rounds")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("analyze")
    p.add_argument("--raw", default="playtest/results/raw")
    p.add_argument("--out", default="playtest/results")
    p.set_defaults(func=cmd_analyze)

    p = sub.add_parser("bench")
    p.add_argument("--worlds", default="playtest/results/raw")
    p.add_argument("--fast", required=True)
    p.add_argument("--optimizer", required=True)
    p.add_argument("--out", default="playtest/results/bench")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--timeout", type=float, default=20.0)
    p.set_defaults(func=cmd_bench)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
