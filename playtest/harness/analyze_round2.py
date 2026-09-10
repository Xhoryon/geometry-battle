#!/usr/bin/env python3
"""Round-2 balance analysis: fold the three pair runs and the counterfactuals
into one machine-readable summary plus a readable digest.

PLAYTEST-ONLY and pure post-processing: it reads archives, runs nothing.

Sections produced (numbered to match the task brief)
----------------------------------------------------
  pairs            per-pair wins, per-algorithm metrics, slot-swap consistency
  metrics          §14 metric block per algorithm
  noprogress       §21 consecutive zero-kill streak quantiles
  matchlength      §21 match length quantiles
  cf               §19/§20 official vs CF-NO-CANCEL vs CF-SIMULTANEOUS
"""

import argparse
import json
import os
import statistics
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ROUND2 = os.path.join(REPO, "playtest", "results", "round-2")


def read_json(p):
    with open(p, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(p, o):
    d = os.path.dirname(os.path.abspath(p))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(o, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, p)


def quantiles(values, ps=(0.50, 0.75, 0.90, 0.95, 0.99)):
    xs = sorted(values)
    out = {"n": len(xs), "min": (xs[0] if xs else None), "max": (xs[-1] if xs else None)}
    for p in ps:
        out["p%d" % round(p * 100)] = _q(xs, p)
    out["mean"] = round(statistics.mean(xs), 3) if xs else None
    return out


def _q(xs, p):
    if not xs:
        return None
    if len(xs) == 1:
        return float(xs[0])
    k = (len(xs) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return round(float(xs[lo] + (xs[hi] - xs[lo]) * (k - lo)), 3)


PAIRS = ["fast-vs-hybrid", "optimizer-vs-hybrid", "fast-vs-optimizer"]


def load_pairs():
    out = {}
    for pair in PAIRS:
        p = os.path.join(ROUND2, "metrics-%s.json" % pair)
        if os.path.isfile(p):
            out[pair] = read_json(p)
    return out


def pair_block(m):
    a, b = m["algorithmA"], m["algorithmB"]
    return {
        "algorithmA": a, "algorithmB": b,
        "matches": m["matches"], "conditions": m["conditions"],
        "distinctMapHashes": m["distinctMapHashes"],
        "wins": m["wins"], "winsByArrangement": m["winsByArrangement"],
        "swapConsistent": m["swapConsistent"], "swapFlipped": m["swapFlipped"],
        "exhaustedMatches": m["exhaustedMatches"],
        "matchLength": m["matchLength"],
        "algorithms": m["algorithms"],
        "algorithmsByArrangement": m["algorithmsByArrangement"],
    }


def metric_block(a):
    """§14 metric list, per algorithm."""
    return {
        "wins": a.get("wins"),
        "rounds": a["rounds"],
        "shotsValid": a["shotsValid"],
        "invalid": a["invalid"], "timeout": a["timeout"], "crashed": a["crashed"],
        "cancelled": a["cancelled"],
        "shotCancellationRate": a["shotCancellationRate"],
        "matchCancellationNote": None,
        "computeTimeMs": a["timeStats"],
        "firstShotRate": a["firstShotRate"],
        "shooterKillRate": a["shooterKillRate"],
        "kills": a["kills"], "shooterKills": a["shooterKills"],
        "killsPerValidShot": a["killsPerValidShot"],
        "multiKillRate": a["multiKillRate"], "multiKills": a["multiKills"],
        "noHitRate": a["noHitRate"], "noHitRounds": a["noHitRounds"],
        "blocked": a["blocked"],
        "obstacleTerminationRate": a["obstacleTerminationRate"],
        "arenaBoundaryTerminationRate": a["arenaBoundaryTerminationRate"],
        "astNodes": a["nodeStats"], "astDepth": a["depthStats"],
    }


def build_summary(pairs):
    out = {"pairs": {}, "metrics": {}, "noprogress": {}, "matchlength": {}}
    for pair, m in pairs.items():
        out["pairs"][pair] = pair_block(m)

    per_alg = {}
    streaks = []
    lengths = []
    for pair, m in pairs.items():
        for alg, a in m["algorithms"].items():
            per_alg.setdefault(alg, []).append((pair, a))
        streaks += m.get("noProgressStreaks", [])
        lengths += [r["rounds"] for r in m["records"]]

    for alg, entries in per_alg.items():
        # a coarse merge: sums for counts, and the worst-case stat for the rest
        merged = {"sources": [p for p, _ in entries]}
        for key in ("rounds", "shotsValid", "invalid", "timeout", "crashed",
                    "cancelled", "kills", "shooterKills", "multiKills", "noHitRounds",
                    "blocked", "firstSolver"):
            merged[key] = sum(a[key] for _p, a in entries)
        n = merged["rounds"] or 1
        merged["shotCancellationRate"] = round(merged["cancelled"] / n, 4)
        merged["firstShotRate"] = round(merged["firstSolver"] / n, 4)
        merged["shooterKillRate"] = round(merged["shooterKills"] / n, 4)
        merged["multiKillRate"] = round(merged["multiKills"] / n, 4)
        merged["noHitRate"] = round(merged["noHitRounds"] / n, 4)
        merged["killsPerValidShot"] = (round(merged["kills"] / merged["shotsValid"], 4)
                                       if merged["shotsValid"] else None)
        merged["computeTimeMs"] = _pooled_time(entries)
        merged["obstacleTerminationRate"] = round(
            sum(a["obstacleTerminationRate"] * a["rounds"] for _p, a in entries) / n, 4)
        merged["arenaBoundaryTerminationRate"] = round(
            sum(a["arenaBoundaryTerminationRate"] * a["rounds"] for _p, a in entries) / n, 4)
        out["metrics"][alg] = merged

    out["noprogress"] = quantiles(streaks)
    out["matchlength"] = quantiles(lengths)
    return out


def _pooled_time(entries):
    """Reconstruct a pooled time distribution from per-pair summaries.

    Only the summary statistics survive in metrics.json, so the pooled view is
    a median-of-medians and a max-of-max.  Recorded explicitly so the report
    does not present it as a recomputed distribution.
    """
    med = [a["timeStats"]["median"] for _p, a in entries if a["timeStats"]["median"]]
    p95 = [a["timeStats"]["p95"] for _p, a in entries if a["timeStats"]["p95"]]
    mx = [a["timeStats"]["max"] for _p, a in entries if a["timeStats"]["max"]]
    return {"median_of_medians": round(statistics.median(med), 3) if med else None,
            "p95_of_p95": round(max(p95), 3) if p95 else None,
            "max": round(max(mx), 3) if mx else None,
            "note": "pooled from per-pair summaries, not recomputed from raw samples"}


def load_cf():
    """Counterfactual results, if the CF stage has run."""
    out = {}
    for pair in PAIRS:
        p = os.path.join(ROUND2, "cf", "sim-%s.json" % pair)
        if os.path.isfile(p):
            out[pair] = read_json(p)
        r = os.path.join(ROUND2, "cf", "rounds-%s.json" % pair)
        if os.path.isfile(r):
            out.setdefault(pair, {})["roundLevel"] = read_json(r)
    return out


def cf_block(cf):
    """§19/§20: official vs CF-NO-CANCEL vs CF-SIMULTANEOUS."""
    out = {}
    for pair, data in cf.items():
        modes = {}
        sim = data if isinstance(data, dict) and "results" in data else data.get("results")
        results = (sim or {}).get("results") if isinstance(sim, dict) else None
        if not results:
            continue
        for mode in ("cf-no-cancel", "cf-simultaneous"):
            wins = {}
            n = 0
            silenced = 0
            kills = 0
            for r in results:
                if r.get("mode") != mode:
                    continue
                n += 1
                wins[r.get("winnerAlgorithm", "unknown")] = \
                    wins.get(r.get("winnerAlgorithm", "unknown"), 0) + 1
                silenced += r.get("silencedShots", 0)
                kills += r.get("totalKills", 0)
            modes[mode] = {"matches": n, "wins": wins, "silencedShots": silenced,
                           "totalKills": kills}
        identical = _mode_identity(results)
        out[pair] = {"modes": modes, "modeIdentity": identical,
                     "roundLevel": data.get("roundLevel")}
    return out


def _mode_identity(results):
    """Do CF-NO-CANCEL and CF-SIMULTANEOUS ever disagree on outcome?

    Keyed on (label, arrangement): the two modes are run over the same
    conditions, so a disagreement would show up as a differing winner or a
    differing kill list.
    """
    by = {}
    for r in results:
        by.setdefault((r.get("label"), r.get("arrangement")), {})[r.get("mode")] = r
    same = diff = 0
    diffs = []
    for key, d in by.items():
        a, b = d.get("cf-no-cancel"), d.get("cf-simultaneous")
        if not a or not b:
            continue
        if a.get("winner") == b.get("winner") and a.get("totalKills") == b.get("totalKills"):
            same += 1
        else:
            diff += 1
            diffs.append({"key": key, "noCancel": a.get("winner"),
                          "simultaneous": b.get("winner")})
    return {"compared": same + diff, "identical": same, "differing": diff,
            "examples": diffs[:10]}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROUND2, "round-2-summary.json"))
    args = ap.parse_args(argv)

    pairs = load_pairs()
    if not pairs:
        print("no pair metrics found under %s" % ROUND2)
        return 2
    summary = build_summary(pairs)
    summary["cf"] = cf_block(load_cf())
    write_json(args.out, summary)

    print("=" * 78)
    print("ROUND 2 -- SUMMARY")
    print("=" * 78)
    for pair, m in pairs.items():
        print("%-22s matches=%3d conditions=%2d  wins=%s  swap consistent=%d flipped=%d"
              % (pair, m["matches"], m["conditions"], m["wins"],
                 m["swapConsistent"], m["swapFlipped"]))
        for alg in (m["algorithmA"], m["algorithmB"]):
            a = m["algorithms"][alg]
            print("    %-10s rounds=%4d valid=%4d invalid=%d timeout=%d crashed=%d "
                  "cancelled=%4d kills=%4d firstShot=%s shooterKill=%s timeMed=%s"
                  % (alg, a["rounds"], a["shotsValid"], a["invalid"], a["timeout"],
                     a["crashed"], a["cancelled"], a["kills"], a["firstShotRate"],
                     a["shooterKillRate"], a["timeStats"]["median"]))
    print("-" * 78)
    print("no-progress streak quantiles: %s" % summary["noprogress"])
    print("match length quantiles      : %s" % summary["matchlength"])
    print("-" * 78)
    for pair, cf in summary["cf"].items():
        for mode, d in (cf.get("modes") or {}).items():
            print("%-22s %-18s matches=%3d wins=%s silenced=%d"
                  % (pair, mode, d["matches"], d["wins"], d["silencedShots"]))
        ident = cf.get("modeIdentity") or {}
        if ident.get("compared"):
            print("%-22s mode identity: identical=%d differing=%d"
                  % (pair, ident["identical"], ident["differing"]))
    print("=" * 78)
    print("wrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
