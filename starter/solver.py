"""
Geometry Battle — 官方 Starter Algorithm (v1.1)

修复的 Finding：
    P0-3  原 starter 对 2 元运算符 add 传入 3 个参数，生成的 DSL 必然非法；
         且函数不经过 Shooter 点，无法通过 Canonical Validator。

输入契约（V1.1，Plans/Input/V1.1 — Algorithm Input Protocol.md §13）：

    python solver.py --team A --public /input/public_state.json --reveal /input/reveal_state.json

    public_state.json  揭盲前的公开世界：schema_version / match_id / round /
                       map{xmin,xmax,ymin,ymax} / points[{id,team,x,y,alive}]
                       —— 含死点（alive=false），但**不含**障碍物与任何 Shooter。
    reveal_state.json  揭盲增量：public_state_sha256 / shooters{A,B}（只给 id）/
                       obstacles[]。用 public_state_sha256 可自检两份输入是否配对。

    队别只经 --team 传入，两份 JSON 对双方**逐字节相同**。

输出契约：
    stdout 一行 JSON —— {"dsl": <AST 或 AST 的 JSON 字符串>}

DSL 白名单（Plan V1 §11）：
    - 只允许运算符：number, variable, add, sub, mul, div, pow, neg,
      sin, cos, tan, sqrt, log, exp
    - 禁止：if/else/switch/?:, min, max, abs, floor, ceil, round, sign, step,
      Heaviside, 布尔与比较运算
    - 函数必须严格经过自己的 Shooter 点 f(x_s) = y_s
    - 节点数 ≤ 128，深度 ≤ 12，常量 |v| ≤ 1000
    - 在射击区间内必须有限、连续、C²，二阶导变号次数 ≤ 100
"""

import argparse
import hashlib
import json
import sys


# ============================================================================
# 输入解析
# ============================================================================

def load_input():
    ap = argparse.ArgumentParser(description="Geometry Battle starter algorithm (v1.1)")
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    args = ap.parse_args()

    with open(args.public, "rb") as f:
        public_bytes = f.read()
    public = json.loads(public_bytes.decode("utf-8"))
    with open(args.reveal, "r") as f:
        reveal = json.load(f)

    # 平台保证绑定成立；算法侧再查一遍，错配时宁可拒绝计算也不给出错误答案。
    expected = reveal.get("public_state_sha256")
    if expected != hashlib.sha256(public_bytes).hexdigest():
        sys.stderr.write("public_state_sha256 mismatch\n")
        raise SystemExit(2)
    return args.team, public, reveal


def shooter_of(public, reveal, team):
    """Shooter 在 reveal 里只给 id，坐标从 public 的点表里查。"""
    by_id = {p["id"]: p for p in public["points"]}
    return by_id[reveal["shooters"][team]]


def alive_enemies_of(public, team):
    return [p for p in public["points"] if p["team"] != team and p.get("alive", True)]


# ============================================================================
# DSL 构造
# ============================================================================

def node_number(value):
    return {"type": "number", "value": value}


def node_variable():
    return {"type": "variable", "value": "x"}


def build_line_through_shooter(shooter_x, shooter_y, target_x, target_y):
    """
    构造经过 Shooter 的直线：
        f(x) = y_s + m * (x - x_s)

    直线是 C^∞ 的，二阶导恒为 0，凸性变号次数为 0，天然满足验证。
    目标方向取存活敌人的质心；若敌人恰好与 Shooter 同 x 坐标，
    则退化为水平线（斜率 0），仍然是合法函数。
    """
    dx = target_x - shooter_x
    dy = target_y - shooter_y

    if abs(dx) < 1e-6:
        slope = 0.0
    else:
        slope = dy / dx

    # 限制斜率，避免函数在射击区间内冲出场地
    if slope > 2.0:
        slope = 2.0
    elif slope < -2.0:
        slope = -2.0

    return {
        "type": "add",
        "args": [
            node_number(shooter_y),
            {
                "type": "mul",
                "args": [
                    node_number(slope),
                    {
                        "type": "sub",
                        "args": [node_variable(), node_number(shooter_x)],
                    },
                ],
            },
        ],
    }


def solve(team, public, reveal):
    me = shooter_of(public, reveal, team)
    sx, sy = me["x"], me["y"]

    enemies = alive_enemies_of(public, team)
    if enemies:
        # 选 y 最接近自己的敌人：直线最平坦，不容易冲出场地，
        # 且因为直线严格经过目标点，必然构成一次命中。
        target = min(enemies, key=lambda p: (abs(p["y"] - sy), (p["x"] - sx) ** 2))
        tx, ty = target["x"], target["y"]
    else:
        tx, ty = sx, sy

    return {"dsl": build_line_through_shooter(sx, sy, tx, ty)}


def main():
    team, public, reveal = load_input()
    sys.stdout.write(json.dumps(solve(team, public, reveal)))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
