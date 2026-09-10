#!/usr/bin/env python3
"""Geometry Battle V1.1 -- Hybrid Tactical-First Anytime Optimizer.

    python3 solver.py --team A|B --public <p> --reveal <r> --output <o>

This solver is an ANYTIME search: at every moment from the first few
milliseconds onward it already holds a legal, executable candidate, and it
keeps improving that candidate for as long as the clock allows.

    Stage 1  tactical, closed form, ~1 ms of work:
             the enemy-shooter assassination line, straight lines at every
             enemy, exact two-kill quadratics, and a one-parameter bend family.
             If any of these lands a decisive shot (enemy shooter + another
             kill, or a triple), we return IMMEDIATELY.

    Stage 2  medium-cost multi-target search: exact rational fits through every
             combination of up to three targets, plus trigonometric and
             composite families.

    Stage 3  only when Stage 1/2 failed to land a decisive shot: sweeps the
             free-curvature families over larger target combinations and
             refines whatever is currently winning.  Gated on weakness rather
             than on the clock alone, because measurement showed that once a
             decisive tactical shot exists, further curve fitting costs up to
             ~465 ms and changes the answer essentially never.

Stage 1 exists because of the lesson from the first playtest round: an
optimizer that spends 150 ms finding a beautiful curve simply loses to a
tactical solver that fires at 13 ms.  Here the tactical answer is produced
first and is good enough to fire; the optimizer only gets the time that is left
over after that.

Rules used, and only these: the frozen Playtest Rules (attack direction,
shooter pass-through, obstacle stop, arena-boundary stop, hit tolerance) and the
public competitor kit.  No Judge or sandbox internal is consulted.

Time budget: hard stop at 900 ms, well inside the 2000 ms platform limit, so the
legality screen and the atomic result write always have room.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gbhy.search import solve                      # noqa: E402
from gbhy.world import build_world, load_inputs    # noqa: E402

HARD_MS = float(os.environ.get("GB_HYBRID_HARD_MS", "900"))
DEBUG = os.environ.get("GB_HYBRID_DEBUG") == "1"


def emit(output_path, ast):
    """The only result channel: tmp + flush + fsync + atomic replace.

    The atomic replace is what the kit asks for, and it also means the timing
    anchor lands on the instant the content is complete rather than whenever
    the platform happens to notice the file.
    """
    tmp = output_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"schema_version": "1.1", "dsl": ast}, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, output_path)


def emit_diag(outcome, team):
    """One machine-readable stderr line: the per-stage search trace.

    Playtest-only.  This is how §9's "time spent / candidate count / best score
    / reason for early return" per stage is recorded without touching the
    platform.  A few hundred bytes, far under the 64 KB stderr cap.
    """
    try:
        best = outcome.result
        payload = {
            "solver": "hybrid",
            "team": team,
            "ms": round(outcome.total_ms, 3),
            "stop": outcome.stop_reason,
            "candidates": sum(s["candidates"] for s in outcome.stages),
            "stages": outcome.stages,
            "best": None,
        }
        if best is not None:
            payload["best"] = {
                "tag": best.tag,
                "kills": best.kills,
                "shooter_targeted": bool(best.shooter_hit),
                "nodes": best.nodes,
                "depth": best.depth,
                "stopReason": best.stop_reason,
            }
            payload["predicted_kills"] = best.kills
            payload["shooter_targeted"] = bool(best.shooter_hit)
        sys.stderr.write("GB_DIAG %s\n" % json.dumps(payload))
    except Exception:
        pass


def log(msg):
    if DEBUG:
        sys.stderr.write(msg + "\n")


def parse_args(argv):
    out = {}
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok in ("--team", "--public", "--reveal", "--output"):
            if i + 1 >= len(argv):
                raise SystemExit(2)
            out[tok[2:]] = argv[i + 1]
            i += 2
            continue
        i += 1
    for key in ("team", "public", "reveal", "output"):
        if key not in out:
            raise SystemExit(2)
    if out["team"] not in ("A", "B"):
        raise SystemExit(2)
    return out


def main(argv):
    args = parse_args(argv)
    public, reveal, _digest = load_inputs(args["public"], args["reveal"])
    outcome = solve(args["team"], public, reveal, deadline_ms=HARD_MS)
    emit(args["output"], outcome.ast)
    emit_diag(outcome, args["team"])
    log("hybrid: %s stop=%s in %.1f ms" % (
        outcome.result.tag if outcome.result else "?",
        outcome.stop_reason, outcome.total_ms))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except BaseException as exc:  # never die without a result file
        sys.stderr.write("solver-hybrid fatal: %r\n" % (exc,))
        try:
            args = parse_args(sys.argv[1:])
            public, reveal, _d = load_inputs(args["public"], args["reveal"])
            by_id = {p.get("id"): p for p in public.get("points", [])}
            me = (public.get("emitters") or {}).get(args["team"])
            ys = float(me["y"]) if me else 0.0
            emit(args["output"], {"type": "number", "value": ys})
        except BaseException:
            pass
        sys.exit(1)
