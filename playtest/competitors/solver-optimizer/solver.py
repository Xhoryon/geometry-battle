#!/usr/bin/env python3
"""Geometry Battle V1.1 -- optimization solver (Team A / Team B).

Startup contract (competitor-kit/ALGORITHM_REQUIREMENTS.md section 2):

    python3 solver.py --team A|B --public <p> --reveal <r> --output <o>

Input is files only, the result goes to --output only, and the whole round
must fit in 2000 ms measured from the GO token.

This solver spends far more compute than the fast one would: it runs an exact
rational interpolation search over subsets of the enemy points, a degree
ladder, trigonometric and composite families, and an obstacle-aware score.  The
budget is an internal deadline (config.json -> budget_ms, default 1500 ms) plus
a write-out slack, so the official 2000 ms timeout is never a normal operating
state.

The companion package `solver-fast` is not imported, referenced or required:
every helper lives in ./gboptim/.
"""

import argparse
import hashlib
import json
import os
import sys
import time

# Timed from the first line of our own module: the interpreter start-up before
# this point is not ours to control, and the slack below absorbs it.
_T0 = time.perf_counter()

_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)

from gboptim import astlib, search, world  # noqa: E402

DEFAULT_BUDGET_MS = 1500.0
DEFAULT_SLACK_MS = 150.0
MIN_BUDGET_MS = 200.0
MAX_BUDGET_MS = 1800.0


def load_config(pkg_dir):
    """Read the optional config.json next to solver.py.

    A missing, unreadable or malformed file must never crash the solver, so
    every failure path falls back to the defaults.
    """
    config = {"budget_ms": DEFAULT_BUDGET_MS, "slack_ms": DEFAULT_SLACK_MS}
    try:
        path = os.path.join(pkg_dir, "config.json")
        with open(path, "r") as handle:
            raw = json.load(handle)
        if not isinstance(raw, dict):
            return config
        for key in ("budget_ms", "slack_ms"):
            value = raw.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            value = float(value)
            if value != value or value in (float("inf"), float("-inf")):
                continue
            if key == "budget_ms":
                config[key] = min(max(value, MIN_BUDGET_MS), MAX_BUDGET_MS)
            else:
                config[key] = min(max(value, 0.0), 1500.0)
    except Exception:
        return config
    return config


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Geometry Battle V1.1 optimization solver")
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    ap.add_argument("--output", required=True)
    return ap.parse_args(argv)


def load_inputs(args):
    with open(args.public, "rb") as handle:
        public_bytes = handle.read()
    public = json.loads(public_bytes.decode("utf-8"))
    with open(args.reveal, "r") as handle:
        reveal = json.load(handle)
    expected = reveal.get("public_state_sha256")
    if expected is not None:
        if hashlib.sha256(public_bytes).hexdigest() != expected:
            sys.stderr.write("public_state_sha256 mismatch\n")
            raise SystemExit(2)
    return public, reveal


def emit(args, dsl):
    """The only result channel: temp file + flush + fsync + atomic replace."""
    payload = {"schema_version": "1.1", "dsl": dsl}
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, args.output)


def derive_seed(ctx):
    """Deterministic PRNG seed from information that is actually in the input.

    The spec suggests match_id + round + team; the hidden map seed is not
    available to a competitor and is deliberately not guessed at.
    """
    material = "|".join(
        [str(ctx.match_id), str(ctx.round), str(ctx.team), str(len(ctx.records))]
    ).encode("utf-8")
    return int(hashlib.sha256(material).hexdigest()[:16], 16)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    config = load_config(_PKG_DIR)
    budget_ms = config["budget_ms"]
    slack_ms = config["slack_ms"]

    public, reveal = load_inputs(args)
    ctx = world.build(args.team, public, reveal)
    ctx.budget_ms = budget_ms
    ctx.slack_ms = slack_ms

    deadline = _T0 + budget_ms / 1000.0
    seed = derive_seed(ctx)
    dsl, stats = search.run(ctx, deadline, seed)

    emit(args, dsl)

    elapsed_ms = (time.perf_counter() - _T0) * 1000.0
    sys.stderr.write(
        "[solver-optimizer] team=%s best_kills=%s nodes=%s phase=%s "
        "candidates=%s fits=%s adopted=%s elapsed=%.1fms budget=%.0fms\n"
        % (
            args.team,
            stats.get("best_kills"),
            stats.get("best_nodes"),
            stats.get("phase"),
            stats.get("candidates"),
            stats.get("fits"),
            stats.get("adopted"),
            elapsed_ms,
            budget_ms,
        )
    )
    # Machine-readable diagnostics for the playtest benchmark (stderr, a few
    # bytes, well under the cap).  Reported so the benchmark can record the
    # candidate count, predicted kills and shooter-target frequency without
    # reading platform internals.
    try:
        sys.stderr.write(
            "GB_DIAG %s\n"
            % json.dumps(
                {
                    "candidates": int(stats.get("candidates", 0)),
                    "accepted": int(stats.get("adopted", 0)),
                    "predicted_kills": stats.get("best_kills", 0),
                    "shooter_targeted": bool(stats.get("best_shooter_kill")),
                    "tag": stats.get("phase", ""),
                    "ms": round(elapsed_ms, 3),
                }
            )
        )
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
