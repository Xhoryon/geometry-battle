#!/usr/bin/env python3
"""Geometry Battle V1.1 -- Algorithm A, the FAST TACTICAL SOLVER.

    python3 solver.py --team A|B --public <p> --reveal <r> --output <o>

Strategy in one paragraph: build a small, ordered pool of curves that are EXACT
by construction (lines, quadratics, cubics and 1-parameter bend families, all
passing through our own shooter identically), score each one with a conservative
obstacle scan, and stop the moment the pool yields something good enough.  No
global search, no randomised descent, no sampling of the whole field: the whole
solve is a few hundred closed-form solves plus a bounded geometric scan.  Every
emitted curve has been screened for legality by our own validator replica and
checked for residual at its intended targets with our own AST evaluator.

Time budget: typical < 200 ms, hard internal cap well below the 2000 ms the
platform allows, so writing the result always fits.
"""

import json
import math
import os
import sys
import time

from gb_cand import RESIDUAL_MAX, evaluate
from gb_dsl import measure, number
from gb_pool import candidate_pool, fallback
from gb_screen import cheap_screen, full_screen
from gb_world import build_world, load_inputs, screen_interval

# --- time budget (milliseconds, measured from process start) ----------------
SOFT_STOP_MS = 250.0     # stop early once we hold an enemy-shooter kill
HARD_CAP_MS = 600.0      # never walk the pool beyond this
DEBUG = os.environ.get("GB_FAST_DEBUG") == "1"


def _log(msg):
    if DEBUG:
        sys.stderr.write(msg + "\n")


def emit(output_path, ast):
    """The only result channel: tmp + flush + fsync + atomic replace."""
    tmp = output_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"schema_version": "1.1", "dsl": ast}, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, output_path)


def _emit_diag(info):
    """One machine-readable diagnostics line on stderr (a few bytes, well under
    the 64 KB cap).  Playtest-only: lets the benchmark record candidate counts,
    the predicted kill count and whether the enemy shooter was targeted, without
    ever reading platform internals."""
    try:
        sys.stderr.write("GB_DIAG %s\n" % json.dumps({
            "candidates": int(info.get("tried", 0)),
            "accepted": int(info.get("accepted", 0)),
            "predicted_kills": info.get("hits", -1),
            "shooter_targeted": bool(info.get("shooter")),
            "tag": info.get("tag", ""),
            "stop": info.get("stop", ""),
            "ms": round(float(info.get("ms", 0.0)), 3),
        }))
    except Exception:
        pass


def constant_fallback(w, public):
    """A curve that is legal no matter what: the horizontal line through the
    shooter.  Used only when the world is degenerate (no reachable enemy)."""
    ys = w.ys if w is not None else 0.0
    ast = number(ys)
    nodes, depth = measure(ast)
    return ast, nodes, depth


def choose(team, public, reveal):
    """Return (ast, info).  Always returns something legally screened."""
    t0 = time.monotonic()
    w = build_world(team, public, reveal)
    if w is None:
        raise ValueError("cannot locate own shooter")
    x0, x1 = screen_interval(w, public)

    best = None
    best_score = None
    tried = 0
    accepted = 0
    stop_reason = "pool exhausted"

    if w.enemies:
        for cand in candidate_pool(w):
            if time.monotonic() - t0 > HARD_CAP_MS * 1e-3:
                stop_reason = "hard cap"
                break
            tried += 1
            ok, _why = cheap_screen(cand, w.xs, x0, x1)
            if not ok:
                continue
            sc = evaluate(cand, w)
            if sc is None or sc.target_res > RESIDUAL_MAX:
                continue
            accepted += 1
            if best_score is None or sc.key > best_score.key:
                best = cand
                best_score = sc
            # ---- early stops (exactly the policy from the task spec) ----
            if sc.shooter_hit and sc.hits >= 2:
                stop_reason = "shooter + another"
                break
            if sc.hits >= 3:
                stop_reason = "triple kill"
                break
            if (best_score is not None and best_score.shooter_hit
                    and (time.monotonic() - t0) * 1e3 > SOFT_STOP_MS):
                stop_reason = "shooter kill + soft cap"
                break

    # ---- emission gate -----------------------------------------------------
    if best is not None:
        ok, why = full_screen(best, w.xs, x0, x1)
        if ok:
            _log("fast: emit %s hits=%d shooter=%s res=%.2e in %.1f ms (%d/%d)"
                 % (best.tag, best_score.hits, best_score.shooter_hit,
                    best_score.target_res, (time.monotonic() - t0) * 1e3,
                    accepted, tried))
            return best.ast, {
                "tag": best.tag, "hits": best_score.hits,
                "shooter": best_score.shooter_hit,
                "nodes": best.nodes, "accepted": accepted, "tried": tried,
                "stop": stop_reason,
                "ms": (time.monotonic() - t0) * 1e3,
            }
        _log("fast: best rejected by full screen: %s" % why)

    fb = fallback(w)
    if fb is not None:
        ok, why = full_screen(fb, w.xs, x0, x1)
        if ok:
            _log("fast: emit fallback in %.1f ms" % ((time.monotonic() - t0) * 1e3))
            return fb.ast, {"tag": "fallback", "hits": -1, "shooter": False,
                            "nodes": fb.nodes, "accepted": accepted,
                            "tried": tried, "stop": stop_reason,
                            "ms": (time.monotonic() - t0) * 1e3}
        _log("fast: fallback rejected: %s" % why)

    ast, _n, _d = constant_fallback(w, public)
    _log("fast: emit constant in %.1f ms" % ((time.monotonic() - t0) * 1e3))
    return ast, {"tag": "constant", "hits": -1, "shooter": False, "nodes": 1,
                 "accepted": accepted, "tried": tried, "stop": stop_reason,
                 "ms": (time.monotonic() - t0) * 1e3}


def parse_args(argv):
    team = None
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
    team = out["team"]
    if team not in ("A", "B"):
        raise SystemExit(2)
    return out


def main(argv):
    args = parse_args(argv)
    public, reveal, _digest = load_inputs(args["public"], args["reveal"])
    ast, info = choose(args["team"], public, reveal)
    emit(args["output"], ast)
    _emit_diag(info)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except BaseException as exc:  # last-ditch: never die without a result file
        sys.stderr.write("solver-fast fatal: %r\n" % (exc,))
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
