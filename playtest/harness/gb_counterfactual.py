#!/usr/bin/env python3
"""Counterfactual harness for the Shooter-Cancellation balance question.

PLAYTEST-ONLY.  Nothing here touches the production Judge, the frozen rules,
the algorithm slots or ``src/``.  The whole module is built on the black-box
mechanics model in ``gb_check.py``, which round 1 validated against the real
engine on 866/866 archived rounds.

Three jobs
----------
``verify``      OFFICIAL MODE agreement (task §18).

    Replay every archived match through the model using the platform's own
    recorded per-round data (functions, first solver, shooters, obstacles,
    pre-round alive sets) and re-derive hits, kills, blocked flags,
    cancellation predicates, post-round alive counts and the match winner.
    Compare against what the platform recorded.  If this is not 100%
    agreement, no counterfactual statistic may be reported.

``rounds``      Round-level counterfactual attribution.

    For every archived round, obtain BOTH sides' functions -- the recorded one
    where the platform recorded it, and by re-running the algorithm offline
    where no function was ever recorded -- then resolve the round again and ask
    what the REPEALED cancellation rule would have suppressed.  Under Locked
    Attack Right the platform no longer records a cancellation flag, so the
    legacy predicate is re-derived from the first solver's recorded hits.
    This isolates what the old rule WOULD have cost each algorithm, on exactly
    the worlds the real matches used.

``simulate``    Forward-simulated counterfactual matches.

    Play whole matches under CF rules.  The world evolves under the
    counterfactual, so round k's obstacles are taken from the official match's
    round k (obstacles are a property of the map sequence, not of who is alive)
    while the alive sets follow the counterfactual.  Shooters follow the
    auto-selection rule inferred from the archive: lowest surviving index.

Modes  (RENAMED by the Shooter Rule Revision -- read this before using --modes)
------------------------------------------------------------------------------
The rule amendment of 2026-09-10 made Locked Attack Right the PRODUCTION rule:
shooter elimination no longer cancels the opponent's attack.  What used to be a
counterfactual is now just the rules, so the mode names had to move:

``locked-attack``     THE PRODUCTION RULE, modelled offline.  Kept so the model
                      can be cross-checked against the new official results --
                      it is a fidelity check, NOT a counterfactual.  (This is
                      the mode that used to be called ``cf-no-cancel``; the old
                      name is retired because it is no longer a counterfactual
                      and must never be confused with one.)
``cf-legacy-cancel``  THE ONLY REMAINING COUNTERFACTUAL: the repealed rule,
                      re-added.  If the first solver's shot kills the second
                      solver's Shooter, the second side's shot is cancelled.
                      Production must never use this.
``cf-simultaneous``   §36 and §38 both removed: there is no first solver at all.
                      Both legal functions resolve against the START snapshot.

                      All three are OUTCOME-EQUIVALENT BY CONSTRUCTION except
                      for the cancellation branch itself, not by discovery.
                      Under §40/§41 the round snapshot is frozen at START and
                      the second solver does not recompute, so the two
                      functions always resolve against the same state; ordering
                      has no channel of influence other than the cancellation
                      rule.  Running them anyway checks that the model encodes
                      that faithfully -- it is not independent evidence.

§21 of the amendment brief requires the old ``CF-NO-CANCEL`` naming to be
archived as a *historical counterfactual*; this docstring is that record.

Note on documented ambiguity: the frozen specification names CF-NO-CANCEL and
CF-SIMULTANEOUS and states their purpose (§39/§55) but deliberately does NOT
define their exact semantics.  The definitions above are this harness's, they
are recorded here, and §55 forbids recording any of these results as official
match results.
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gb_check  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

ALGORITHMS = {
    "fast": "playtest/competitors/solver-fast",
    "optimizer": "playtest/competitors/solver-optimizer",
    "hybrid": "playtest/competitors/solver-hybrid",
}


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


def _id_of(h):
    """Hits appear as bare id strings in match.json and as {id,...} objects in
    replay.json frames.  Accept both."""
    return h["id"] if isinstance(h, dict) else h


def obstacles_of(frame):
    out = []
    for o in (frame.get("obstacles") or []):
        if o.get("type") == "circle" and "center" in o:
            out.append({"id": "O", "type": "circle", "cx": o["center"][0],
                        "cy": o["center"][1], "radius": o["radius"]})
        else:
            out.append({"id": "O", "type": "rectangle", "xmin": o["xmin"],
                        "xmax": o["xmax"], "ymin": o["ymin"], "ymax": o["ymax"]})
    return out


def points_of(frame):
    return [{"id": q["id"], "team": q["team"], "x": q["position"]["x"],
             "y": q["position"]["y"]} for q in (frame.get("aliveBefore") or [])]


def lowest_alive(points, team, alive):
    """Auto shooter selection, inferred from the archive (1170/1170 rounds)."""
    idx = [p for p in points if p["team"] == team and p["id"] in alive]
    if not idx:
        return None
    return min(idx, key=lambda p: int(p["id"][1:]))["id"]


def build_world(match_id, rnd, points, alive, obstacles, shooters, xmin, xmax, ymin, ymax):
    pub_points = [dict(p, alive=(p["id"] in alive)) for p in points]
    public = {"schema_version": "1.1", "match_id": match_id, "round": rnd,
              "map": {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax},
              "points": pub_points}
    reveal = {"schema_version": "1.1", "match_id": match_id, "round": rnd,
              "shooters": shooters, "obstacles": obstacles}
    gb_check.bind(public, reveal)
    return public, reveal


def resolve(fn, team, shooter_id, points, alive, obstacles):
    """Hits produced by one function against one snapshot.

    Returns (hits, contact_x, obstacle_blocked).  ``obstacle_blocked`` is True
    only when the trajectory actually died on an obstacle -- a trajectory that
    ran off the arena instead also has a contact x but is NOT blocked.  The
    two are different engine fields (Playtest Rules §33 vs §34) and conflating
    them is what the earlier revision of this check got wrong.
    """
    if fn is None or shooter_id is None:
        return None, None, False, None
    by_id = {p["id"]: p for p in points}
    s = by_id.get(shooter_id)
    if s is None:
        return None, None, False, None
    live = [dict(p, alive=(p["id"] in alive)) for p in points]
    try:
        f = gb_check.compile_ast(fn)
    except Exception:
        return None, None, False, None
    hits, contact = gb_check.predicted_hits(f, team, shooter_id, live, obstacles)
    _, obstacle = gb_check.first_contact(f, team, s["x"], obstacles)
    stop_x = contact
    if stop_x is None:
        stop_x = 20.0 if team == "A" else -20.0
    return hits, contact, bool(obstacle), stop_x


# ---------------------------------------------------------------------------
# verify -- OFFICIAL MODE agreement
# ---------------------------------------------------------------------------


def cmd_verify(args):
    root = os.path.abspath(args.raw)
    total_rounds = 0
    sides_executed = 0
    mismatches = []
    cancel_checks = 0
    cancel_mismatch = 0
    legacy_cancel_pressure = 0
    stop_checks = 0
    stop_mismatch = 0
    blocked_disagreements = 0
    alive_checks = 0
    alive_mismatch = 0
    winner_checks = 0
    winner_mismatch = 0

    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not (os.path.isfile(os.path.join(d, "match.json"))
                and os.path.isfile(os.path.join(d, "replay.json"))):
            continue
        match = read_json(os.path.join(d, "match.json"))
        replay = read_json(os.path.join(d, "replay.json"))
        frames = {f.get("round"): f for f in (replay.get("frames") or [])}
        alive = set(p["id"] for p in (frames[min(frames)]["aliveBefore"]))
        points = points_of(frames[min(frames)])
        xmin, xmax = -20.0, 20.0
        ymin, ymax = -12.0, 12.0
        prev_alive = set(alive)

        for r in match["rounds"]:
            rnd = r["round"]
            frame = frames.get(rnd) or {}
            obstacles = obstacles_of(frame)
            total_rounds += 1
            shooters = {"A": r.get("shooterA"), "B": r.get("shooterB")}

            derived = {}
            for slot in ("A", "B"):
                fn = r.get(slot.lower() + "Function")
                if isinstance(fn, str):
                    try:
                        fn = json.loads(fn)
                    except Exception:
                        fn = None
                hits, contact, blocked, stop_x = resolve(
                    fn, slot, shooters[slot], points, prev_alive, obstacles)
                derived[slot] = (fn, hits, contact, blocked)
                # Strongest available check on the mechanics model: the platform
                # records its own trajectory, so compare our predicted stop
                # point with the last point it actually walked to.
                traj = frame.get("trajectory" + slot) or []
                if traj:
                    traj_end = traj[-1]["x"]
                    stop_checks += 1
                    if abs(stop_x - traj_end) > args.stop_tol:
                        stop_mismatch += 1
                        mismatches.append({"match": name, "round": rnd, "slot": slot,
                                           "why": "trajectory stop x",
                                           "model": round(stop_x, 6),
                                           "platform": round(traj_end, 6)})
                if fn is None:
                    continue
                sides_executed += 1
                recorded = sorted(_id_of(h) for h in (r.get(slot.lower() + "Hits") or []))
                if hits is None or sorted(hits) != recorded:
                    mismatches.append({"match": name, "round": rnd, "slot": slot,
                                       "model": sorted(hits or []), "platform": recorded})
                # The blocked flag is DISCLOSED, not asserted.  See the
                # docstring: it is a descriptive platform field whose exact
                # predicate is not public, and nothing downstream consumes it.
                if blocked != bool(r.get(slot.lower() + "Blocked")):
                    blocked_disagreements += 1

            # Cancellation predicate, REVISED with the rule amendment.
            #
            # Under Locked Attack Right a shooter kill no longer cancels
            # anything, so the platform must NEVER record a cancellation.  The
            # predicate that used to be asserted (first solver killed the
            # opponent's Shooter => cancelled) is now the *legacy* predicate:
            # we still evaluate it, but only to count how much pressure the
            # repealed rule would have applied on these worlds.  That count is
            # evidence for the rebalance report, NOT a disagreement.
            fs = r.get("firstSolver")
            if fs in ("A", "B"):
                other = "B" if fs == "A" else "A"
                cancel_checks += 1
                fs_hits = r.get(fs.lower() + "Hits") or []
                legacy_would_cancel = shooters[other] in [_id_of(h) for h in fs_hits]
                if legacy_would_cancel:
                    legacy_cancel_pressure += 1
                act_cancel = bool(r.get("cancelled" + other))
                if act_cancel:
                    cancel_mismatch += 1
                    mismatches.append({"match": name, "round": rnd,
                                       "why": "cancellation recorded under "
                                              "Locked Attack Right",
                                       "model": False, "platform": act_cancel})

            # alive arithmetic
            alive_checks += 1
            killed = set()
            for slot in ("A", "B"):
                for h in (r.get(slot.lower() + "Hits") or []):
                    killed.add(_id_of(h))
            expect = prev_alive - killed
            got = set()
            for p in (frame.get("aliveAfter") or []):
                got.add(_id_of(p))
            if not got:
                got = None
            if got is not None and got != expect:
                alive_mismatch += 1
                mismatches.append({"match": name, "round": rnd, "why": "aliveAfter",
                                   "model": sorted(expect), "platform": sorted(got)})
            prev_alive = expect

        winner_checks += 1
        fa = match.get("finalAlive") or {}
        pred = None
        if fa:
            if fa.get("A") and not fa.get("B"):
                pred = "A"
            elif fa.get("B") and not fa.get("A"):
                pred = "B"
            else:
                pred = "draw"
        if pred is not None and pred != match.get("winner"):
            winner_mismatch += 1
            mismatches.append({"match": name, "why": "winner", "model": pred,
                               "platform": match.get("winner")})

    print("=" * 72)
    print("OFFICIAL MODE AGREEMENT  (task §18)")
    print("=" * 72)
    hit_mm = len([m for m in mismatches if m.get("why") is None])
    print("  rounds replayed              : %d" % total_rounds)
    print("  side-shots re-derived        : %d" % sides_executed)
    print("  hit-list mismatches          : %d" % hit_mm)
    print("  trajectory stop-x checks     : %d  mismatches: %d  (tolerance %g)"
          % (stop_checks, stop_mismatch, args.stop_tol))
    print("  cancellation checks          : %d  mismatches: %d" % (cancel_checks, cancel_mismatch))
    print("  legacy rule would have fired : %d  (%.1f%% of checked rounds -- "
          "informational, the repealed rule is gone)"
          % (legacy_cancel_pressure,
             100.0 * legacy_cancel_pressure / max(1, cancel_checks)))
    print("  aliveAfter checks            : %d  mismatches: %d" % (alive_checks, alive_mismatch))
    print("  winner checks                : %d  mismatches: %d" % (winner_checks, winner_mismatch))
    print("  blocked-flag disagreements   : %d  (INFORMATIONAL -- a descriptive"
          % blocked_disagreements)
    print("                                 platform field, not consumed downstream)")
    ok = (hit_mm == 0 and stop_mismatch == 0 and cancel_mismatch == 0
          and alive_mismatch == 0 and winner_mismatch == 0)
    print("  RESULT: %s" % ("100% AGREEMENT on every quantity the counterfactual "
                            "consumes" if ok else "DISCREPANCY"))
    if mismatches:
        print("  first 10 mismatches:")
        for m in mismatches[:10]:
            print("   ", json.dumps(m, ensure_ascii=False)[:220])
        print("  !! Counterfactual statistics MUST NOT be reported until this is clean.")
    print("=" * 72)
    if args.out:
        write_json(args.out, {"rounds": total_rounds, "sidesExecuted": sides_executed,
                              "stopChecks": stop_checks, "stopMismatch": stop_mismatch,
                              "stopTol": args.stop_tol,
                              "blockedDisagreements": blocked_disagreements,
                              "cancelChecks": cancel_checks, "cancelMismatch": cancel_mismatch,
                              "legacyCancelPressure": legacy_cancel_pressure,
                              "aliveChecks": alive_checks, "aliveMismatch": alive_mismatch,
                              "winnerChecks": winner_checks, "winnerMismatch": winner_mismatch,
                              "mismatches": mismatches, "agreement": ok})
    return 0 if ok else 1


# ---------------------------------------------------------------------------
# functions per round, with offline re-runs where the platform never recorded one
# ---------------------------------------------------------------------------


class FunctionProvider(object):
    """Supplies every side's function for every round of an archived match.

    Recorded functions are used verbatim.  Where the platform cancelled a side
    and therefore never recorded its curve, the algorithm is re-run offline on
    exactly that round's (public, reveal) pair, so the counterfactual has a
    real answer to "what would it have fired?" rather than a guess.

    Runs are memoised on a cache key so repeated counterfactual passes over the
    same match do not pay twice.
    """

    def __init__(self, cache_path=None):
        self.cache = {}
        self.cache_path = cache_path
        self.reruns = 0
        self.hits = 0
        self.wall_ms = []
        self.last_ms = {}
        if cache_path and os.path.isfile(cache_path):
            try:
                self.cache = read_json(cache_path)
            except Exception:
                self.cache = {}

    def save(self):
        if self.cache_path:
            write_json(self.cache_path, self.cache)

    def function(self, match_id, rnd, slot, alg, public, reveal, recorded, scope=""):
        if recorded is not None:
            self.hits += 1
            return recorded
        # The scope separates simulation branches.  The same (match, round,
        # slot, algorithm) key means a *different world* under a different
        # counterfactual mode or slot arrangement, so without it one branch's
        # answer would silently be reused by another.
        key = "%s|%d|%s|%s|%s" % (match_id, rnd, slot, alg, scope)
        if key in self.cache:
            self.hits += 1
            return self.cache[key]
        pkg = os.path.abspath(os.path.join(REPO, ALGORITHMS[alg]))
        t0 = time.time()
        res = gb_check.run_solver(pkg, slot, public, reveal, timeout=30.0)
        wall = (time.time() - t0) * 1e3
        self.wall_ms.append(wall)
        # Offline wall time is the only timing signal available without the
        # platform's own GO-anchored clock.  It is used ONLY to order the two
        # shots inside cf-no-cancel, where the order cannot change the outcome
        # (both shots resolve against the same snapshot) -- so a coarse proxy
        # is sufficient and no statistical claim rests on it.
        self.last_ms[scope + "|" + slot] = wall
        self.reruns += 1
        fn = None
        if isinstance(res.get("result"), dict):
            fn = res["result"].get("dsl")
            if isinstance(fn, str):
                try:
                    fn = json.loads(fn)
                except Exception:
                    fn = None
        self.cache[key] = fn
        return fn


# ---------------------------------------------------------------------------
# round-level counterfactual attribution
# ---------------------------------------------------------------------------


def cmd_rounds(args):
    pairs = args.pair
    root = os.path.abspath(args.raw)
    a_alg, b_alg = pairs.split("-vs-")
    import gb_round2
    # Round 1 labelled its slot arrangements "opt-A"; round 2 labels them
    # "optimizer-A".  Accept both spellings so the same analysis runs over
    # either archive.
    alias = {"optimizer": "opt"}
    label_to_slots = {}
    for label, _slot, al, bl in gb_round2.slot_roots(pairs):
        m = {"A": al, "B": bl}
        label_to_slots[label] = m
        label_to_slots[alias.get(al, al) + "-A"] = m

    provider = FunctionProvider(args.cache)
    per_alg = {a_alg: _acc(), b_alg: _acc()}
    detail = []

    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not (os.path.isfile(os.path.join(d, "match.json"))
                and os.path.isfile(os.path.join(d, "replay.json"))):
            continue
        match = read_json(os.path.join(d, "match.json"))
        replay = read_json(os.path.join(d, "replay.json"))
        summary = read_json(os.path.join(d, "summary.json"))
        slot_alg = label_to_slots[summary["arrangement"]]
        frames = {f.get("round"): f for f in (replay.get("frames") or [])}
        order = sorted(frames)
        if not order:
            continue
        points = points_of(frames[order[0]])
        # Points that were still standing when the OFFICIAL match ended.  Used
        # to separate "kills the cancelled shot would really have scored" from
        # "kills on points that died anyway".
        final_alive = set(p["id"] for p in (frames[order[-1]].get("aliveAfter") or []))

        for r in match["rounds"]:
            rnd = r["round"]
            frame = frames.get(rnd)
            if frame is None:
                continue
            obstacles = obstacles_of(frame)
            shooters = {"A": r.get("shooterA"), "B": r.get("shooterB")}
            # THE OFFICIAL WORLD for this round.  Each round is evaluated on
            # exactly the state the real match used, so a re-run solver sees
            # what it would have seen and the "would have hit" answer is
            # about this round rather than about a counterfactually evolved
            # board.  (An earlier revision carried a counterfactual alive set
            # forward here, which biased the counts downwards.)
            alive = set(p["id"] for p in frame["aliveBefore"])
            public, reveal = build_world(match.get("matchId"), rnd, points, alive,
                                         obstacles, shooters, -20, 20, -12, 12)
            # REVERSED ATTRIBUTION.  The platform no longer records cancellation
            # (Locked Attack Right), so "what did the old rule cost?" can no
            # longer be read off a platform flag.  We re-derive it ourselves:
            # the legacy rule fired exactly when the first solver's recorded
            # hits included the other side's Shooter.  Everything else is
            # unchanged -- we still resolve both sides on the official world.
            fs = r.get("firstSolver")
            legacy_cancel = {"A": False, "B": False}
            if fs in ("A", "B"):
                other = "B" if fs == "A" else "A"
                fs_hits = [_id_of(h) for h in (r.get(fs.lower() + "Hits") or [])]
                legacy_cancel[other] = shooters[other] in fs_hits

            for slot in ("A", "B"):
                alg = slot_alg[slot]
                a = per_alg[alg]
                a["rounds"] += 1
                rec_fn = r.get(slot.lower() + "Function")
                if isinstance(rec_fn, str):
                    try:
                        rec_fn = json.loads(rec_fn)
                    except Exception:
                        rec_fn = None
                fn = provider.function(match.get("matchId"), rnd, slot, alg,
                                       public, reveal, rec_fn)
                hits, contact, _blk, _stop = resolve(fn, slot, shooters[slot], points,
                                                     alive, obstacles)
                enemy_shooter = shooters["B" if slot == "A" else "A"]
                if fn is None:
                    a["noFunction"] += 1
                    continue
                if legacy_cancel[slot]:
                    gained = list(hits or [])
                    a["legacyCancelledRounds"] += 1
                    a["legacyCancelledKillsIfExecuted"] += len(gained)
                    a["legacyCancelledKillsOnFinalSurvivors"] += sum(
                        1 for h in gained if h in final_alive)
                    a["legacyCancelledKillEvents"].extend(gained)
                    if gained:
                        a["legacyCancelledRoundsWithKills"] += 1
                    if enemy_shooter in gained:
                        a["legacyCancelledShooterKills"] += 1
                    a["legacyCancelledTimes"].append(r.get(slot.lower() + "TimeMs"))
                else:
                    a["executedRounds"] += 1
            detail.append({"match": name, "round": rnd,
                           "officialAliveBefore": sorted(alive),
                           "legacyCancel": sorted(t for t in ("A", "B") if legacy_cancel[t])})

    provider.save()
    print("=" * 72)
    print("ROUND-LEVEL COUNTERFACTUAL  (Legacy-Cancel attribution, official worlds)")
    print("=" * 72)
    for alg in (a_alg, b_alg):
        a = per_alg[alg]
        lost = a["legacyCancelledKillsIfExecuted"]
        surv = a["legacyCancelledKillsOnFinalSurvivors"]
        print("  %-10s rounds=%d executed=%d  wouldBeLegacyCancelled=%d (%.1f%%)"
              % (alg, a["rounds"], a["executedRounds"], a["legacyCancelledRounds"],
                 100.0 * a["legacyCancelledRounds"] / max(1, a["rounds"])))
        print("             killsLostToLegacyCancellation=%d  ofWhichOnPointsThatSurvived=%d (%.1f%%)"
              % (lost, surv, 100.0 * surv / lost if lost else 0.0))
        print("             shooterKillsLostToLegacyCancellation=%d"
              % a["legacyCancelledShooterKills"])
    print("  offline solver re-runs: %d   recorded functions reused: %d"
          % (provider.reruns, provider.hits))
    print("=" * 72)
    if args.out:
        write_json(args.out, {"pair": pairs, "perAlgorithm": per_alg,
                              "reruns": provider.reruns, "reused": provider.hits,
                              "detail": detail})
    return 0


def _acc():
    return {"rounds": 0, "noFunction": 0, "executedRounds": 0,
            "legacyCancelledRounds": 0,
            "legacyCancelledRoundsWithKills": 0,
            "legacyCancelledKillsIfExecuted": 0,
            "legacyCancelledKillsOnFinalSurvivors": 0,
            "legacyCancelledShooterKills": 0,
            "legacyCancelledTimes": [], "legacyCancelledKillEvents": []}


# ---------------------------------------------------------------------------
# forward-simulated counterfactual matches
# ---------------------------------------------------------------------------


def cmd_simulate(args):
    a_alg, b_alg = args.pair.split("-vs-")
    conditions = read_json(args.conditions)["conditions"]
    out_dir = os.path.abspath(args.out)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    provider = FunctionProvider(args.cache)
    ref_root = os.path.abspath(args.ref_root)
    results = []
    for cond in conditions:
        for arr in ("%s-A" % a_alg, "%s-A" % b_alg):
            slot_alg = {"A": a_alg if arr.startswith(a_alg) else b_alg,
                        "B": b_alg if arr.startswith(a_alg) else a_alg}
            for mode in args.modes:
                key = "%s__%s__%s" % (cond["label"], arr, mode)
                dest = os.path.join(out_dir, key)
                if os.path.isfile(os.path.join(dest, "result.json")) and not args.force:
                    results.append(read_json(os.path.join(dest, "result.json")))
                    continue
                rec = _simulate_one(cond, arr, slot_alg, mode, provider,
                                    args.max_rounds, args.pair, ref_root)
                rec["label"] = cond["label"]
                rec["arrangement"] = arr
                rec["mode"] = mode
                write_json(os.path.join(dest, "result.json"), rec)
                results.append(rec)
                print("[sim] %-52s winner=%-4s rounds=%2d" % (
                    key, rec["winner"], rec["rounds"]))
    provider.save()
    write_json(os.path.join(out_dir, "sim-summary.json"),
               {"pair": args.pair, "modes": args.modes, "n": len(results),
                "results": results, "reruns": provider.reruns})
    print("[sim] %d simulated matches; offline solver runs: %d" % (len(results), provider.reruns))
    return 0


def _simulate_one(cond, arr, slot_alg, mode, provider, max_rounds, pair, ref_root):
    """Play one match under CF rules, on the official map sequence."""
    # Obstacles and the starting layout come from the official match for this
    # condition.  Obstacles cannot be regenerated offline (that would mean
    # replicating the map generator, which is platform internals), so the
    # counterfactual runs on the official map sequence: same obstacles per
    # round index, same fixed point positions, with only the alive sets free to
    # diverge under the counterfactual.  Points never move in this game, so
    # this is exact rather than an approximation.
    ref = os.path.join(ref_root, pair, "%s__%s" % (cond["label"], arr))
    if not os.path.isfile(os.path.join(ref, "replay.json")):
        return {"winner": "unavailable", "rounds": 0,
                "reason": "no archived replay for %s__%s" % (cond["label"], arr)}
    replay = read_json(os.path.join(ref, "replay.json"))
    match = read_json(os.path.join(ref, "match.json"))
    frames = {f.get("round"): f for f in (replay.get("frames") or [])}
    order = sorted(frames)
    points = points_of(frames[order[0]])
    obstacles_by_round = {r: obstacles_of(frames[r]) for r in order}
    last_obstacles = obstacles_of(frames[order[-1]])

    alive = set(p["id"] for p in frames[order[0]]["aliveBefore"])
    match_id = match.get("matchId")
    kills_by_round = []
    silenced = 0      # cf-legacy-cancel: second shots the repealed rule suppresses
    posthumous = 0    # locked-attack: second shots that fire with a dead Shooter
    shot_count = {"A": 0, "B": 0}
    for rnd in range(1, max_rounds + 1):
        obstacles = obstacles_by_round.get(rnd, last_obstacles)
        shooters = {"A": lowest_alive(points, "A", alive),
                    "B": lowest_alive(points, "B", alive)}
        if shooters["A"] is None or shooters["B"] is None:
            break
        public, reveal = build_world(match_id, rnd, points, alive, obstacles,
                                     shooters, -20, 20, -12, 12)
        scope = "%s|%s" % (mode, arr)
        fns, hits, fired = {}, {}, {}
        for slot in ("A", "B"):
            fns[slot] = provider.function(match_id, rnd, slot, slot_alg[slot],
                                          public, reveal, None, scope=scope)
            h, _c, _b, _sx = resolve(fns[slot], slot, shooters[slot], points, alive, obstacles)
            hits[slot] = set(h or [])
            fired[slot] = fns[slot] is not None

        # ---- The modes are written as separate branches for clarity, but the
        # ---- ones WITHOUT a cancellation branch are OUTCOME-EQUIVALENT BY
        # ---- CONSTRUCTION, and that is a fact about the rules rather than an
        # ---- empirical discovery: §40/§41 freeze the round snapshot, so each
        # ---- side's function resolves against the same START state no matter
        # ---- who is deemed first.  "Who goes first" therefore has no channel
        # ---- through which to change the result except the cancellation
        # ---- branch itself.  Running them anyway is a check that the
        # ---- implementation faithfully encodes that model -- not independent
        # ---- evidence that the equivalence holds.
        # ---- After the rule amendment, `locked-attack` IS production and
        # ---- `cf-legacy-cancel` is the only true counterfactual.
        if mode == "cf-simultaneous":
            # No first solver exists at all: both legal functions resolve
            # against the frozen START snapshot.  Order never enters.
            killed = set()
            for slot in ("A", "B"):
                if fired[slot]:
                    killed |= hits[slot]
        else:
            # §36 First Solver and the frozen snapshot are kept.  The two
            # branches below differ ONLY in the repealed §38 branch.
            order = sorted(("A", "B"),
                           key=lambda s: provider.last_ms.get(scope + "|" + s, 0.0))
            killed = set()
            for idx, slot in enumerate(order):
                if not fired[slot]:
                    continue
                shooter_dead = shooters[slot] in killed
                if idx == 1 and shooter_dead:
                    if mode == "cf-legacy-cancel":
                        # THE ONLY REMAINING COUNTERFACTUAL: the repealed rule
                        # suppresses this shot because its own Shooter was
                        # killed by the first solver.  Production never does
                        # this.
                        silenced += 1
                        continue
                    # locked-attack (== production): the locked attack right
                    # survives the Shooter's death, so the shot executes.
                    posthumous += 1
                killed |= hits[slot]
        alive = alive - killed
        kills_by_round.append(sorted(killed))
        if (not any(p["team"] == "A" and p["id"] in alive for p in points)
                or not any(p["team"] == "B" and p["id"] in alive for p in points)):
            break
    a_alive = any(p["team"] == "A" and p["id"] in alive for p in points)
    b_alive = any(p["team"] == "B" and p["id"] in alive for p in points)
    winner = "A" if (a_alive and not b_alive) else ("B" if (b_alive and not a_alive) else "draw")
    return {"winner": winner,
            "winnerAlgorithm": (slot_alg[winner] if winner in ("A", "B") else "draw"),
            "rounds": len(kills_by_round), "killsByRound": kills_by_round,
            "totalKills": sum(len(k) for k in kills_by_round),
            "silencedShots": silenced, "posthumousShots": posthumous,
            "slotAlgorithm": slot_alg,
            "finalAlive": sorted(alive), "reference": os.path.basename(ref)}


# ---------------------------------------------------------------------------


def main(argv):
    ap = argparse.ArgumentParser(description="Round-2 counterfactual harness")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("verify")
    p.add_argument("--raw", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--stop-tol", type=float, default=5e-3, dest="stop_tol")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("rounds")
    p.add_argument("--pair", required=True)
    p.add_argument("--raw", required=True)
    p.add_argument("--cache", default=None)
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_rounds)

    p = sub.add_parser("simulate")
    p.add_argument("--pair", required=True)
    p.add_argument("--conditions", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--modes", nargs="+",
                   default=["locked-attack", "cf-legacy-cancel"])
    p.add_argument("--cache", default=None)
    p.add_argument("--ref-root",
                   default="playtest/results/shooter-rule-revision/raw",
                   dest="ref_root")
    p.add_argument("--max-rounds", type=int, default=30, dest="max_rounds")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_simulate)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
