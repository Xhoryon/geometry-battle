"""
Precision Line —— E2E 验证用算法包

策略：在所有存活敌人中按「y 距离最近」排序，选第一个**弹道畅通**的目标，
画直线 f(x) = y_s + m * (x - x_s)。

为什么要做可见性判定：障碍物在 reveal 阶段才公开，不做判定的直线会被挡下
（Plan V1 §22：第一次接触之后不再造成伤害），比赛就永远打不完。
可见性判定使用与 Canonical Judge 完全一致的 penetration 语义
（src/core/Judge.ts: penetration()），采样步长 0.01，保留 0.02 安全边界，
因此「算法认为可见」⇒「Judge 一定判定 HIT」。

V1.1 输入契约：--team / --public / --reveal 三个参数，障碍物只在 reveal 里，
圆形的字段是扁平的 cx / cy / radius（规范 §8）。

DSL: f(x) = y_s + m * (x - x_s)
"""

import argparse
import hashlib
import json
import os
import math
import sys

MARGIN = 0.02
STEP = 0.01
MAX_SAMPLES = 20000


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


def enemies_of(public, team):
    return [p for p in public["points"] if p["team"] != team and p.get("alive", True)]


def field_of(public):
    m = public["map"]
    return {"y_min": m["ymin"], "y_max": m["ymax"]}


def num(v):
    return {"type": "number", "value": v}


def _seg_dist(px, py, x1, y1, x2, y2):
    vx, vy = x2 - x1, y2 - y1
    l2 = vx * vx + vy * vy
    if l2 == 0.0:
        return math.hypot(px - x1, py - y1)
    u = max(0.0, min(1.0, ((px - x1) * vx + (py - y1) * vy) / l2))
    return math.hypot(px - (x1 + u * vx), py - (y1 + u * vy))


def _in_poly(px, py, vs):
    inside = False
    n = len(vs)
    j = n - 1
    for i in range(n):
        xi, yi = vs[i]
        xj, yj = vs[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def penetration(px, py, ob):
    """与 Canonical Judge 的 penetration() 逐条对齐（V1.1 字段形态）。"""
    t = ob.get("type")
    if t == "circle":
        return max(0.0, math.hypot(px - ob["cx"], py - ob["cy"]) - ob["radius"])
    if t == "rectangle":
        dx = max(ob["xmin"] - px, 0.0, px - ob["xmax"])
        dy = max(ob["ymin"] - py, 0.0, py - ob["ymax"])
        return math.hypot(dx, dy)
    if t == "segment":
        return max(0.0, _seg_dist(px, py, ob["x1"], ob["y1"], ob["x2"], ob["y2"]) - 1e-3)
    if t == "polygon":
        vs = ob["vertices"]
        if _in_poly(px, py, vs):
            return 0.0
        n = len(vs)
        return min(
            _seg_dist(px, py, vs[i][0], vs[i][1], vs[(i + 1) % n][0], vs[(i + 1) % n][1])
            for i in range(n)
        )
    return 0.0


def clearance(f, sx, tx, obstacles, field):
    """轨迹 [sx, tx] 上的最小穿透深度；离开场地 / 非有限值记为 0。"""
    span = abs(tx - sx)
    if span < 1e-12:
        return float("inf")
    n = min(MAX_SAMPLES, int(span / STEP) + 2)
    best = float("inf")
    for i in range(n + 1):
        x = sx + (tx - sx) * i / n
        y = f(x)
        if not math.isfinite(y):
            return 0.0
        if y < field["y_min"] or y > field["y_max"]:
            return 0.0
        for ob in obstacles:
            p = penetration(x, y, ob)
            if p < best:
                best = p
                if best <= MARGIN:
                    return best
    return best


def build(sx, sy, tx, ty):
    dx = tx - sx
    m = 0.0 if abs(dx) < 1e-9 else (ty - sy) / dx
    dsl = {
        "type": "add",
        "args": [
            num(sy),
            {
                "type": "mul",
                "args": [num(m), {"type": "sub", "args": [{"type": "variable", "value": "x"}, num(sx)]}],
            },
        ],
    }
    return dsl, (lambda x, sx=sx, sy=sy, m=m: sy + m * (x - sx))


def main():
    args, public, reveal = load_input()
    team = args.team
    me = shooter_of(public, reveal, team)
    sx, sy = me["x"], me["y"]
    obstacles = reveal.get("obstacles") or []
    field = field_of(public)
    enemies = enemies_of(public, team)

    if not enemies:
        dsl, _ = build(sx, sy, sx, sy)
        emit(args, dsl)
        return 0

    ranked = sorted(
        enemies,
        key=lambda p: (abs(p["y"] - sy), (p["x"] - sx) ** 2),
    )

    best = None  # (clearance, dsl) —— 全被挡时的兜底
    for tgt in ranked:
        tx, ty = tgt["x"], tgt["y"]
        dsl, f = build(sx, sy, tx, ty)
        c = clearance(f, sx, tx, obstacles, field)
        if c >= MARGIN:
            emit(args, dsl)
            return 0
        if best is None or c > best[0]:
            best = (c, dsl)

    emit(args, best[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
