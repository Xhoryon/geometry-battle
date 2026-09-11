#!/usr/bin/env python3
"""Geometry Battle V1.1 -- Round 2 three-way algorithm balance harness.

PLAYTEST-ONLY.  Drives the official operator CLI as a black box and derives
every metric from the artefacts the platform itself writes.  No Judge /
Validator / SandboxRunner source is read, and nothing under algorithms/ or
src/ is touched.

Difference from ``gb_playtest.py`` (round 1): the round-1 harness hard-coded
the pair (solver-fast, solver-optimizer).  Round 2 needs an arbitrary set of
pairs among three algorithms, each with the two slot arrangements, so the
comparison can be made in one consistent frame.

Usage
-----
  python3 playtest/harness/gb_round2.py install --pair fast-vs-hybrid
  python3 playtest/harness/gb_round2.py run \
      --pair fast-vs-hybrid --conditions playtest/harness/conditions-round2.json \
      --out playtest/results/round-2/raw/fast-vs-hybrid --max-rounds 30
  python3 playtest/harness/gb_round2.py analyze \
      --raw playtest/results/round-2/raw/fast-vs-hybrid \
      --out playtest/results/round-2/metrics-fast-vs-hybrid.json
"""

import argparse
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gb_check  # noqa: E402  -- the black-box mechanics model, validated 866/866

ALGORITHMS = {
    "fast": "playtest/competitors/solver-fast",
    "optimizer": "playtest/competitors/solver-optimizer",
    "hybrid": "playtest/competitors/solver-hybrid",
}

ART_RE = re.compile(r"Artifacts:\s*(\S+)")


def sh(cmd, timeout=3600):
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=REPO, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout)
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), time.time() - t0


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, path)


def pct(values, q):
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
    return {"n": len(values), "median": round(statistics.median(values), 3),
            "p95": round(pct(values, 0.95), 3), "max": round(float(max(values)), 3),
            "mean": round(float(statistics.mean(values)), 3)}


def pair_algorithms(pair):
    a, b = pair.split("-vs-")
    if a not in ALGORITHMS or b not in ALGORITHMS:
        raise SystemExit("unknown pair %r" % pair)
    return a, b


def slot_roots(pair):
    """Two arrangements, named '<slug>-A' after whichever algorithm sits in A."""
    a, b = pair_algorithms(pair)
    return [(a + "-A", "A", a, b), (b + "-A", "A", b, a)]


def slots_dir(pair):
    return os.path.abspath(os.path.join(REPO, "playtest", "slots", "round-2", pair))


# ---------------------------------------------------------------------------


def cmd_install(args):
    pair = args.pair
    root_all = slots_dir(pair)
    report = {}
    for label, _slot, a_alg, b_alg in slot_roots(pair):
        root = os.path.join(root_all, label)
        if os.path.isdir(root):
            shutil.rmtree(root)
        os.makedirs(root)
        cmd = CLI + ["--auto", "--slots", root,
                     "--a", os.path.abspath(os.path.join(REPO, ALGORITHMS[a_alg])),
                     "--b", os.path.abspath(os.path.join(REPO, ALGORITHMS[b_alg])),
                     "--seed", "5", "--points", "6", "--max-rounds", "1"]
        print("[install] %s/%s : A=%s B=%s" % (pair, label, a_alg, b_alg))
        rc, out, secs = sh(cmd)
        passed = "Preflight" in out and "PASSED" in out
        report[label] = {"rc": rc, "seconds": round(secs, 2),
                         "preflight_passed": passed, "output": out}
        print("[install] %s rc=%d preflight_passed=%s (%.1fs)" % (label, rc, passed, secs))
    write_json(os.path.join(root_all, "install-report.json"), report)
    return 0


def cmd_run(args):
    pair = args.pair
    conds = read_json(args.conditions)["conditions"]
    out_dir = os.path.abspath(args.out)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    root_all = slots_dir(pair)
    summaries = []
    for cond in conds:
        for label, _slot, _a, _b in slot_roots(pair):
            dest = os.path.join(out_dir, "%s__%s" % (cond["label"], label))
            if os.path.isfile(os.path.join(dest, "match.json")):
                summaries.append(read_json(os.path.join(dest, "summary.json")))
                print("[run] skip (archived): %s" % os.path.basename(dest))
                continue
            cmd = CLI + ["--auto", "--slots", os.path.join(root_all, label),
                         "--seed", str(cond["seed"]), "--points", str(cond["points"]),
                         "--difficulty", cond["difficulty"], "--max-rounds", str(args.max_rounds)]
            # Rule Revision 3 §11 的 timeout benchmark 需要在不改默认值的前提下
            # 扫 250 / 500 / 750 三档 —— CLI 的 --timeout 是唯一开关。
            if getattr(args, "timeout", None):
                cmd += ["--timeout", str(args.timeout)]
            rc, out, secs = sh(cmd)
            m = ART_RE.search(out)
            os.makedirs(dest, exist_ok=True)
            with open(os.path.join(dest, "console.log"), "w", encoding="utf-8") as fh:
                fh.write(out)
            if not m:
                print("[run] !! no artefact path for %s (rc=%d)" % (os.path.basename(dest), rc))
                write_json(os.path.join(dest, "PLATFORM_CONTAMINATED.json"),
                           {"rc": rc, "label": cond["label"], "arrangement": label,
                            "reason": "no artefact path in CLI output"})
                continue
            art = m.group(1)
            for name in ("match.json", "replay.json", "audit.json"):
                src = os.path.join(art, name)
                if os.path.isfile(src):
                    shutil.copy2(src, os.path.join(dest, name))
            match = read_json(os.path.join(dest, "match.json"))
            summary = {
                "label": cond["label"], "arrangement": label, "condition": cond,
                "slotMap": {s: alg for s, alg in
                            (("A", None), ("B", None))},
                "matchId": match.get("matchId"), "winner": match.get("winner"),
                "finalAlive": match.get("finalAlive"),
                "rounds": len(match.get("rounds") or []),
                "maxRounds": args.max_rounds,
                "exhausted": (len(match.get("rounds") or []) >= args.max_rounds
                              and match.get("winner") == "draw"),
                "wallSeconds": round(secs, 2), "artifactDir": art,
            }
            write_json(os.path.join(dest, "summary.json"), summary)
            summaries.append(summary)
            print("[run] %-46s winner=%-4s rounds=%2d (%.1fs)" % (
                os.path.basename(dest), summary["winner"], summary["rounds"], secs))
    write_json(os.path.join(out_dir, "run-summary.json"),
               {"conditions": len(conds), "matches": len(summaries), "summaries": summaries})
    print("[run] %d matches across %d conditions" % (len(summaries), len(conds)))
    return 0


# ---------------------------------------------------------------------------
# analysis
# ---------------------------------------------------------------------------


def new_acc():
    return {"rounds": 0, "shotsValid": 0, "invalid": 0, "timeout": 0, "crashed": 0,
            "kills": 0, "shooterKills": 0, "multiKills": 0, "noHitRounds": 0,
            "blocked": 0, "cancelled": 0, "firstSolver": 0, "times": [],
            "nodes": [], "depths": [], "hitsBeforeStop": [],
            # Locked Attack Right: rounds where this side's shot executed even
            # though its own Shooter had just been killed by the first solver.
            "posthumousShots": 0}


def accumulate(acc, side, entry):
    acc["rounds"] += 1
    if side["cancelled"]:
        acc["cancelled"] += 1
    err = side["errorCode"]
    up = str(err).upper() if err is not None else ""
    if err is not None and up != "CANCELLED":
        if "TIMEOUT" in up:
            acc["timeout"] += 1
        elif "CRASH" in up:
            acc["crashed"] += 1
        else:
            acc["invalid"] += 1
    elif err is None and side["kills"] is not None:
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
    if side.get("posthumous"):
        acc["posthumousShots"] += 1
    if side["stopReason"]:
        acc["hitsBeforeStop"].append(side["stopReason"])
    if entry["firstSolver"] == side["slot"]:
        acc["firstSolver"] += 1


def finalise_acc(acc):
    out = dict(acc)
    out["timeStats"] = ms_stats(acc["times"])
    out["nodeStats"] = ms_stats(acc["nodes"])
    out["depthStats"] = ms_stats(acc["depths"])
    out["stopReasonCounts"] = {k: acc["hitsBeforeStop"].count(k)
                               for k in set(acc["hitsBeforeStop"])}
    out["killsPerValidShot"] = (round(acc["kills"] / acc["shotsValid"], 3)
                                if acc["shotsValid"] else None)
    n = acc["rounds"] or 1
    out["multiKillRate"] = round(acc["multiKills"] / n, 4)
    out["noHitRate"] = round(acc["noHitRounds"] / n, 4)
    out["firstShotRate"] = round(acc["firstSolver"] / n, 4)
    out["shooterKillRate"] = round(acc["shooterKills"] / n, 4)
    # BY DESIGN 0 under Locked Attack Right -- the field is kept so the value
    # moving to exactly 0 is itself the regression evidence.
    out["shotCancellationRate"] = round(acc["cancelled"] / n, 4)
    out["posthumousShotRate"] = round(acc["posthumousShots"] / n, 4)
    out["arenaBoundaryTerminationRate"] = round(
        acc["hitsBeforeStop"].count("arena") / n, 4)
    out["obstacleTerminationRate"] = round(
        acc["hitsBeforeStop"].count("obstacle") / n, 4)
    del out["times"]
    del out["hitsBeforeStop"]
    return out


def cmd_analyze(args):
    raw = os.path.abspath(args.raw)
    pair = args.pair
    a_alg, b_alg = pair_algorithms(pair)
    label_to_slots = {lbl: {slot: alg for slot, alg in (("A", al), ("B", bl))}
                      for lbl, slot, al, bl in slot_roots(pair)}

    records = []
    for name in sorted(os.listdir(raw)):
        d = os.path.join(raw, name)
        if not (os.path.isfile(os.path.join(d, "match.json"))
                and os.path.isfile(os.path.join(d, "summary.json"))):
            continue
        match = read_json(os.path.join(d, "match.json"))
        summary = read_json(os.path.join(d, "summary.json"))
        arrangement = summary["arrangement"]
        slot_alg = label_to_slots[arrangement]
        replay = read_json(os.path.join(d, "replay.json"))
        frames = {f.get("round"): f for f in (replay.get("frames") or [])}
        rec = {"label": summary["label"], "arrangement": arrangement,
               "condition": summary["condition"], "matchId": match.get("matchId"),
               "winner": match.get("winner"), "winnerAlgorithm": None,
               "rounds": len(match.get("rounds") or []),
               "maxRounds": summary["maxRounds"], "exhausted": summary["exhausted"],
               "finalAlive": match.get("finalAlive"), "slotAlgorithm": slot_alg,
               "endReason": match.get("endReason"),
               "mutualElimination": match.get("endReason") == "MUTUAL_ELIMINATION",
               "perRound": [], "perAlgorithm": {a_alg: new_acc(), b_alg: new_acc()}}
        if match.get("winner") in ("A", "B"):
            rec["winnerAlgorithm"] = slot_alg[match["winner"]]
        rounds = match.get("rounds") or []
        rec["mapSeed"] = (rounds or [{}])[0].get("mapSeed")
        rec["mapHash"] = (rounds or [{}])[0].get("mapHash")
        rec["pointCount"] = match.get("pointCount")
        rec["difficulty"] = match.get("difficulty")
        for r in rounds:
            frame = frames.get(r.get("round")) or {}
            attacks = r.get("attacksExecuted")
            alive_at_attack = r.get("shooterAliveAtAttack") or {}
            entry = {"round": r.get("round"), "firstSolver": r.get("firstSolver"),
                     "result": r.get("result"), "shooterA": r.get("shooterA"),
                     "shooterB": r.get("shooterB"),
                     "attacksExecuted": attacks or [],
                     "shooterAliveAtAttack": alive_at_attack,
                     "mutualElimination": bool(r.get("mutualElimination")),
                     "obstacleCount": len(frame.get("obstacles") or [])}
            for slot in ("A", "B"):
                alg = slot_alg[slot]
                s = slot.lower()
                fn = r.get(s + "Function")
                if isinstance(fn, str):
                    try:
                        fn = json.loads(fn)
                    except Exception:
                        fn = None
                nodes = depth = None
                if isinstance(fn, dict):
                    stack = [(fn, 1)]
                    nodes = 0
                    depth = 0
                    while stack:
                        nd, dd = stack.pop()
                        nodes += 1
                        depth = max(depth, dd)
                        for ch in (nd.get("args") or []):
                            stack.append((ch, dd + 1))
                hits = r.get(s + "Hits") or []
                enemy_shooter = r.get("shooterB" if slot == "A" else "shooterA")
                entry[alg] = {
                    "slot": slot, "timeMs": r.get(s + "TimeMs"), "nodes": nodes,
                    "depth": depth, "hits": hits, "kills": r.get(s + "Kills"),
                    "blocked": r.get(s + "Blocked"), "cancelled": bool(r.get("cancelled" + slot)),
                    "errorCode": r.get(s + "ErrorCode"), "enemyShooter": enemy_shooter,
                    "killedEnemyShooter": enemy_shooter in hits,
                    "multiKill": (r.get(s + "Kills") or 0) >= 2,
                    # This side's shot executed while its own Shooter was dead.
                    "posthumous": alive_at_attack.get(slot) is False and slot in (attacks or []),
                    "stopReason": _stop_reason(r, slot, frame),
                }
            rec["perRound"].append(entry)
            for alg in (a_alg, b_alg):
                accumulate(rec["perAlgorithm"][alg], entry[alg], entry)
        streak = longest = 0
        for e in rec["perRound"]:
            if (e[a_alg]["kills"] or 0) + (e[b_alg]["kills"] or 0) == 0:
                streak += 1
                longest = max(longest, streak)
            else:
                streak = 0
        rec["longestNoKillStreak"] = longest
        records.append(rec)

    if not records:
        return die("no archived matches under %s" % raw)

    agg = {a_alg: new_acc(), b_alg: new_acc()}
    agg_by_arr = {}
    wins = {a_alg: 0, b_alg: 0, "draw": 0}
    by_arrangement = {}
    by_condition = {}
    for rec in records:
        if rec["winner"] == "draw":
            wins["draw"] += 1
        else:
            wins[rec["winnerAlgorithm"]] += 1
        for alg in (a_alg, b_alg):
            for e in rec["perRound"]:
                accumulate(agg[alg], e[alg], e)
        arr = rec["arrangement"]
        agg_by_arr.setdefault(arr, {a_alg: new_acc(), b_alg: new_acc()})
        for alg in (a_alg, b_alg):
            for e in rec["perRound"]:
                accumulate(agg_by_arr[arr][alg], e[alg], e)
        by_arrangement.setdefault(arr, {a_alg: 0, b_alg: 0, "draw": 0})
        if rec["winner"] == "draw":
            by_arrangement[arr]["draw"] += 1
        else:
            by_arrangement[arr][rec["winnerAlgorithm"]] += 1
        c = by_condition.setdefault(rec["label"], {
            "label": rec["label"], "pointCount": rec["pointCount"],
            "difficulty": rec["difficulty"], "mapSeed": rec["mapSeed"],
            "mapHash": rec["mapHash"], "runs": []})
        c["runs"].append({"arrangement": arr, "winner": rec["winner"],
                          "winnerAlgorithm": rec["winnerAlgorithm"],
                          "rounds": rec["rounds"], "exhausted": rec["exhausted"]})

    swap_consistent = swap_flipped = 0
    for c in by_condition.values():
        w = [r["winnerAlgorithm"] for r in c["runs"] if r["winnerAlgorithm"]]
        if len(c["runs"]) == 2 and len(w) == 2:
            if w[0] == w[1]:
                swap_consistent += 1
            else:
                swap_flipped += 1

    result = {
        "pair": pair, "algorithmA": a_alg, "algorithmB": b_alg,
        "matches": len(records),
        "conditions": len(set(r["label"] for r in records)),
        "distinctMapHashes": len(set(r["mapHash"] for r in records if r.get("mapHash"))),
        "wins": wins, "winsByArrangement": by_arrangement,
        "mutualEliminationMatches": sum(1 for r in records if r["mutualElimination"]),
        "endReasons": {k: sum(1 for r in records if r["endReason"] == k)
                       for k in sorted(set(r["endReason"] for r in records),
                                       key=lambda x: str(x))},
        "algorithms": {alg: finalise_acc(agg[alg]) for alg in (a_alg, b_alg)},
        "algorithmsByArrangement": {arr: {alg: finalise_acc(agg_by_arr[arr][alg])
                                          for alg in (a_alg, b_alg)}
                                    for arr in agg_by_arr},
        "matchLength": ms_stats([r["rounds"] for r in records]),
        "exhaustedMatches": sum(1 for r in records if r["exhausted"]),
        "swapConsistent": swap_consistent, "swapFlipped": swap_flipped,
        "noProgressStreaks": [r["longestNoKillStreak"] for r in records],
        "byCondition": by_condition, "records": records,
    }
    write_json(args.out, result)
    print("[analyze] %s: %d matches, wins=%s" % (pair, len(records), wins))
    for alg in (a_alg, b_alg):
        x = result["algorithms"][alg]
        print("  %-10s rounds=%4d valid=%4d invalid=%d timeout=%d crashed=%d cancelled=%4d "
              "kills=%4d shooterKills=%3d firstShotRate=%s" % (
                  alg, x["rounds"], x["shotsValid"], x["invalid"], x["timeout"],
                  x["crashed"], x["cancelled"], x["kills"], x["shooterKills"],
                  x["firstShotRate"]))
    return 0


def _stop_reason(r, slot, frame):
    """Why did this trajectory stop: 'obstacle', 'arena', 'end' or 'none'?

    Determined by running the *recorded* function through the independent
    black-box mechanics model (``gb_check``), not by guessing from flags.  The
    model was validated against the platform on 866/866 archived rounds in
    round 1, so this is the same answer the engine gave, without reading it.
    """
    fn = r.get(slot.lower() + "Function")
    if isinstance(fn, str):
        try:
            fn = json.loads(fn)
        except Exception:
            return "unparsed"
    if not isinstance(fn, dict):
        return "none"
    sid = r.get("shooterA" if slot == "A" else "shooterB")
    if not sid:
        return "none"
    pts = {p["id"]: p for p in (frame.get("aliveBefore") or [])}
    me = pts.get(sid)
    if me is None:
        return "none"
    obstacles = []
    for o in (frame.get("obstacles") or []):
        if o.get("type") == "circle" and "center" in o:
            obstacles.append({"type": "circle", "cx": o["center"][0],
                              "cy": o["center"][1], "radius": o["radius"]})
        else:
            obstacles.append({"type": "rectangle", "xmin": o["xmin"],
                              "xmax": o["xmax"], "ymin": o["ymin"], "ymax": o["ymax"]})
    try:
        f = gb_check.compile_ast(fn)
        contact, obstacle = gb_check.first_contact(
            f, slot, me["position"]["x"], obstacles)
    except Exception:
        return "unparsed"
    if contact is None:
        return "end"
    return "obstacle" if obstacle else "arena"


def die(msg, code=2):
    sys.stderr.write(msg.rstrip() + "\n")
    return code


def main(argv):
    ap = argparse.ArgumentParser(description="Geometry Battle round-2 balance harness")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("install")
    p.add_argument("--pair", required=True)
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("run")
    p.add_argument("--pair", required=True)
    p.add_argument("--conditions", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-rounds", type=int, default=30, dest="max_rounds")
    p.add_argument("--timeout", type=int, default=None,
                   help="单轮计算超时（ms）。省略则用平台默认值")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("analyze")
    p.add_argument("--pair", required=True)
    p.add_argument("--raw", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_analyze)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
