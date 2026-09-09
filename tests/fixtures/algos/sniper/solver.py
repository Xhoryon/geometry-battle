"""Sniper —— 立即求解，直线瞄准敌方 Shooter。

V1.1 输入契约（Plans/Input/V1.1 — Algorithm Input Protocol.md §13）：
    python solver.py --team A --public /input/public_state.json --reveal /input/reveal_state.json
Shooter 在 reveal 里**只给 id**，坐标必须回到 public 的点表里查 ——
这正是两阶段协议的意义：public 阶段不含任何 Shooter 信息。
"""

import argparse
import hashlib
import json
import sys


def load_input():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    args = ap.parse_args()

    with open(args.public, "rb") as f:
        public_bytes = f.read()
    public = json.loads(public_bytes.decode("utf-8"))
    with open(args.reveal, "r") as f:
        reveal = json.load(f)

    # 自检：reveal 必须绑定到这份 public（错配即拒绝计算）
    if reveal.get("public_state_sha256") != hashlib.sha256(public_bytes).hexdigest():
        sys.stderr.write("input binding mismatch\n")
        raise SystemExit(2)
    return args.team, public, reveal


def shooter_of(public, reveal, team):
    by_id = {p["id"]: p for p in public["points"]}
    return by_id[reveal["shooters"][team]]


def num(v):
    return {"type": "number", "value": v}


def main():
    team, public, reveal = load_input()
    other = "B" if team == "A" else "A"
    me = shooter_of(public, reveal, team)
    tgt = shooter_of(public, reveal, other)
    dx = tgt["x"] - me["x"]
    m = 0.0 if abs(dx) < 1e-9 else (tgt["y"] - me["y"]) / dx
    dsl = {"type": "add", "args": [
        num(me["y"]),
        {"type": "mul", "args": [num(m), {"type": "sub", "args": [{"type": "variable", "value": "x"}, num(me["x"])]}]},
    ]}
    print(json.dumps({"dsl": dsl}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
