"""Sniper —— 延迟 400ms 后求解，直线瞄准敌方 Shooter。

V1.1 输入契约见 sniper/solver.py。延迟发生在**参赛入口内部**，
因此计时仍然落在 GO 之后（bootstrap 在收到 GO 之前不会执行本文件）。
"""

import argparse
import hashlib
import json
import os
import sys
import time


def emit(args, dsl):
    """唯一的正式输出通道：tmp + 原子 rename（规范 §25/§27）。"""
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"schema_version": "1.1", "dsl": dsl}, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, args.output)


def load_input():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.public, "rb") as f:
        public_bytes = f.read()
    public = json.loads(public_bytes.decode("utf-8"))
    with open(args.reveal, "r") as f:
        reveal = json.load(f)

    if reveal.get("public_state_sha256") != hashlib.sha256(public_bytes).hexdigest():
        sys.stderr.write("input binding mismatch\n")
        raise SystemExit(2)
    return args, public, reveal


def shooter_of(public, reveal, team):
    by_id = {p["id"]: p for p in public["points"]}
    return by_id[reveal["shooters"][team]]


def num(v):
    return {"type": "number", "value": v}


def main():
    time.sleep(0.4)
    args, public, reveal = load_input()
    team = args.team
    other = "B" if team == "A" else "A"
    me = shooter_of(public, reveal, team)
    tgt = shooter_of(public, reveal, other)
    dx = tgt["x"] - me["x"]
    m = 0.0 if abs(dx) < 1e-9 else (tgt["y"] - me["y"]) / dx
    dsl = {"type": "add", "args": [
        num(me["y"]),
        {"type": "mul", "args": [num(m), {"type": "sub", "args": [{"type": "variable", "value": "x"}, num(me["x"])]}]},
    ]}
    emit(args, dsl)
    return 0


if __name__ == "__main__":
    sys.exit(main())
