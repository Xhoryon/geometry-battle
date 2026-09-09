"""
Arc Sweep —— E2E / 回归验证用算法包（此前未被正式流程硬编码）

与 parabola-arc 的差异（保证是两个真正不同的算法，而不是同一份代码换名字）：
    - 目标排序：按「x 距离最近」优先（parabola-arc 按 y 距离最近）
    - 曲率网格：更密（12 个 K，含正负），并覆盖更大的 |K|
    - 兜底策略：取全网格中「最小穿透深度最大」的那条曲线

曲率族：f(x) = y_s + m*(x - x_s) + K*(x - x_s)^2，m 由「经过目标」解出。
可见性判定与 Canonical Judge 的 penetration 语义一致，粗采样先否、细采样复核。
"""

import json
import math
import sys

KS = (-0.12, -0.06, -0.03, -0.015, 0.0, 0.01, 0.015, 0.02, 0.03, 0.05, 0.08, 0.12)
MARGIN = 0.03
FINE_STEP = 0.004
COARSE_MAX_SAMPLES = 2000
FINE_MAX_SAMPLES = 20000


def num(v):
    return {"type": "number", "value": v}


def var():
    return {"type": "variable", "value": "x"}


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
    """与 Canonical Judge 的 penetration() 逐条对齐。"""
    t = ob.get("type")
    if t == "circle":
        cx, cy = ob["center"]
        return max(0.0, math.hypot(px - cx, py - cy) - ob["radius"])
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


def clearance(f, sx, tx, obstacles, field, step, max_samples):
    span = abs(tx - sx)
    if span < 1e-12:
        return float("inf")
    n = min(max_samples, int(span / step) + 2)
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


def visibility(f, sx, tx, obstacles, field):
    span = abs(tx - sx)
    coarse = max(0.02, span / COARSE_MAX_SAMPLES)
    c = clearance(f, sx, tx, obstacles, field, coarse, COARSE_MAX_SAMPLES + 2)
    if c < MARGIN:
        return c
    return clearance(f, sx, tx, obstacles, field, FINE_STEP, FINE_MAX_SAMPLES)


def build(sx, sy, tx, ty, k):
    dx = tx - sx
    m = 0.0 if abs(dx) < 1e-9 else (ty - sy) / dx - k * dx
    shift = {"type": "sub", "args": [var(), num(sx)]}
    linear = {"type": "mul", "args": [num(m), shift]}
    quad = {"type": "mul", "args": [num(k), {"type": "pow", "args": [shift, num(2)]}]}
    dsl = {"type": "add", "args": [num(sy), {"type": "add", "args": [linear, quad]}]}
    return dsl, (lambda x, sx=sx, sy=sy, m=m, k=k: sy + m * (x - sx) + k * (x - sx) ** 2)


def main():
    state = json.loads(sys.stdin.read().strip())
    team = state["team_id"]
    me = state["shooters"][team]["position"]
    sx, sy = me["x"], me["y"]
    obstacles = state.get("obstacles") or []
    field = state.get("field") or {"y_min": -12, "y_max": 12}
    enemies = [p for p in state["points"] if p["team"] != team and p.get("position")]

    if not enemies:
        dsl, _ = build(sx, sy, sx, sy, 0.0)
        print(json.dumps({"dsl": dsl}))
        return 0

    # 与 parabola-arc 的差异：目标按 x 距离最近优先
    ranked = sorted(
        enemies,
        key=lambda p: (abs(p["position"]["x"] - sx), abs(p["position"]["y"] - sy)),
    )

    best = None  # (clearance, dsl)
    for tgt in ranked:
        tx, ty = tgt["position"]["x"], tgt["position"]["y"]
        for k in KS:
            dsl, f = build(sx, sy, tx, ty, k)
            c = visibility(f, sx, tx, obstacles, field)
            if c >= MARGIN:
                print(json.dumps({"dsl": dsl}))
                return 0
            if best is None or c > best[0]:
                best = (c, dsl)

    print(json.dumps({"dsl": best[1]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
