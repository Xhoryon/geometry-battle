"""
Symmetry Probe —— 平台镜像公平性审计专用的**测试 fixture**（V1.4）

它不是选手，也不该会赢：存在的唯一目的是让「镜像输入 → 逐位镜像的输出」可证明，
从而把引擎（Judge / Validator / Match / 沙箱）从 solver 里隔离出来单独审计。

⚠️ 只能出现在 tests/ 与 experiments/ 里，绝不能作为 Tournament Mode 的内置选手暴露。

镜像可证明的做法：一切几何都在**局部前进坐标** u 里算：
    Team A: u = x − xe        Team B: u = xe − x
于是双方都是 forward = +u。IEEE-754 下取负精确、加法可交换，所以
    (−xe) − (−x) == x − xe    逐位成立，
镜像输入下 u 空间里的每个中间量都逐位相同。输出 AST 唯一的差别是 u 子表达式
写成 sub(x, xe)（A）还是 sub(xe, x)（B），其余常数全部来自 u 空间。
Judge 侧同样成立：evaluate(sub(xe', x'), −x) = (−xe) − (−x) = x − xe，与 A 逐位一致。

策略（确定性，无随机，无时间依赖）：
  1. 存活敌人按 (u, |y − ye|, id) 排序，u ≤ 0（在身后）剔除；
  2. 依次对前 MAX_TARGETS 个目标尝试固定网格 K 的抛物线 y = ye + m·u + K·u²，
     m 由「经过目标」解出；路径在 u 空间等距采样，碰障碍物（与 Judge 的
     penetration 语义一致，留 MARGIN）或先离开场地即弃；
  3. 全部失败 → 到首目标的直线（可能被挡，那也是合法输出）；无敌人 → 水平线 y = ye。
"""

import argparse
import hashlib
import json
import math
import os
import sys

MARGIN = 0.05
SAMPLES = 64
MAX_TARGETS = 4
K_GRID = (0.0, 0.03, -0.03, 0.08, -0.08, 0.15, -0.15)


def emit(args, dsl):
    """唯一的正式输出通道：tmp + 原子 rename，且**只有**两个键（规范 §25/§26/§27）。"""
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
    with open(args.reveal, "r", encoding="utf-8") as f:
        reveal = json.load(f)
    if reveal.get("public_state_sha256") != hashlib.sha256(public_bytes).hexdigest():
        sys.stderr.write("input binding mismatch\n")
        raise SystemExit(2)
    return args, public, reveal


def num(v):
    return {"type": "number", "value": v}


VAR = {"type": "variable", "value": "x"}


def main():
    args, public, reveal = load_input()
    team = args.team
    me = public["emitters"][team]
    xe, ye = me["x"], me["y"]
    fy_min, fy_max = public["map"]["ymin"], public["map"]["ymax"]

    # 局部前进坐标：A 向 +x 前进，B 向 −x 前进，统一成 forward = +u
    if team == "A":
        to_u = lambda x: x - xe
    else:
        to_u = lambda x: xe - x

    def u_expr():
        # 这是 AST 里唯一与队别有关的地方
        if team == "A":
            return {"type": "sub", "args": [VAR, num(xe)]}
        return {"type": "sub", "args": [num(xe), VAR]}

    # 障碍物搬进 u 空间（矩形的 u 区间端点排序，不引入算术）
    rects, circles = [], []
    for ob in reveal.get("obstacles") or []:
        t = ob.get("type")
        if t == "rectangle":
            a, b = to_u(ob["xmin"]), to_u(ob["xmax"])
            rects.append((min(a, b), max(a, b), ob["ymin"], ob["ymax"]))
        elif t == "circle":
            circles.append((to_u(ob["cx"]), ob["cy"], ob["radius"]))

    def penetration_min(u, y):
        best = float("inf")
        for ulo, uhi, ymin, ymax in rects:
            dx = max(ulo - u, 0.0, u - uhi)
            dy = max(ymin - y, 0.0, y - ymax)
            d = math.hypot(dx, dy)
            if d < best:
                best = d
        for uc, cy, r in circles:
            d = max(0.0, math.hypot(u - uc, y - cy) - r)
            if d < best:
                best = d
        return best

    def path_clear(m, k, ut):
        for i in range(SAMPLES + 1):
            u = ut * i / SAMPLES
            y = ye + m * u + k * u * u
            if y < fy_min or y > fy_max:
                return False
            if penetration_min(u, y) <= MARGIN:
                return False
        return True

    enemies = []
    for p in public["points"]:
        if p["team"] == team or not p.get("alive", True):
            continue
        u = to_u(p["x"])
        if u <= 1e-9:
            continue
        enemies.append((u, abs(p["y"] - ye), p["id"], p["y"]))
    enemies.sort()

    if not enemies:
        sys.stderr.write('GBREPORT:{"kind":"horizontal"}\n')
        emit(args, {"type": "add", "args": [num(ye), {"type": "mul", "args": [num(0.0), u_expr()]}]})
        return 0

    def line(m):
        return {"type": "add", "args": [num(ye), {"type": "mul", "args": [num(m), u_expr()]}]}

    def parabola(m, k):
        quad = {"type": "mul", "args": [num(k), {"type": "pow", "args": [u_expr(), num(2)]}]}
        return {"type": "add", "args": [num(ye), {"type": "add", "args": [{"type": "mul", "args": [num(m), u_expr()]}, quad]}]}

    for ut, _dy, tid, yt in enemies[:MAX_TARGETS]:
        for k in K_GRID:
            m = (yt - ye - k * ut * ut) / ut
            if path_clear(m, k, ut):
                sys.stderr.write('GBREPORT:{"kind":"%s","target":"%s","k":%r}\n' % ("line" if k == 0.0 else "parabola", tid, k))
                emit(args, line(m) if k == 0.0 else parabola(m, k))
                return 0

    ut, _dy, tid, yt = enemies[0]
    sys.stderr.write('GBREPORT:{"kind":"fallback-line","target":"%s"}\n' % tid)
    emit(args, line((yt - ye) / ut))
    return 0


if __name__ == "__main__":
    sys.exit(main())
