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
    """发射锚点 = 固定 Emitter（Rule Revision 3 §4）。

    Emitter 的坐标**直接在 public_state.json 里**，不再是 reveal 里的一个 id、
    也不再从 points 表里查 —— 它整场比赛固定、不可死亡、不是战斗点（§3/§6）。
    """
    return public["emitters"][team]


def first_enemy(public, team):
    """aim 的目标：**敌方**存活战斗点里 id 最小的那个（team 是本队）。

    Revision 3 之前这里瞄的是「敌方 Shooter」—— 那条规则下击杀对方 Shooter
    可以取消对方整轮攻击，是一击必杀。现在发射锚点是不可击杀的 Emitter，
    该概念已不存在（§7 明文禁止 Shooter assassination），因此改为普通战斗点。
    """
    foes = sorted((p for p in public["points"]
                   if p["team"] != team and p.get("alive", True)), key=lambda p: p["id"])
    return foes[0] if foes else None


def num(v):
    return {"type": "number", "value": v}


def main():
    time.sleep(0.4)
    args, public, reveal = load_input()
    team = args.team
    other = "B" if team == "A" else "A"
    me = shooter_of(public, reveal, team)
    # 注意传的是 team 而不是 other：first_enemy 自己会取「非本队」的点。
    tgt = first_enemy(public, team)
    if tgt is None:
        # 没有可打的战斗点（理论上比赛已结束）—— 交一条只穿过 Emitter 的常函数
        tgt = me
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
