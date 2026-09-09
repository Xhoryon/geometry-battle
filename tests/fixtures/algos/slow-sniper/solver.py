"""Sniper —— 延迟 400ms 后求解，直线瞄准敌方 Shooter。"""
import json
import sys
import time


def num(v):
    return {"type": "number", "value": v}


def main():
    time.sleep(0.4)
    s = json.loads(sys.stdin.read().strip())
    team = s["team_id"]
    other = "B" if team == "A" else "A"
    me = s["shooters"][team]["position"]
    tgt = s["shooters"][other]["position"]
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
