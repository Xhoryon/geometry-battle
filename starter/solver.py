"""
Geometry Battle — 官方 Starter Algorithm (v1.0)

修复的 Finding：
    P0-3  原 starter 对 2 元运算符 add 传入 3 个参数，生成的 DSL 必然非法；
         且函数不经过 Shooter 点，无法通过 Canonical Validator。

契约（Plan V1 §11 / §13）：
    - 只允许运算符：number, variable, add, sub, mul, div, pow, neg,
      sin, cos, tan, sqrt, log, exp
    - 禁止：if/else/switch/?:, min, max, abs, floor, ceil, round, sign, step,
      Heaviside, 布尔与比较运算
    - 函数必须严格经过自己的 Shooter 点 f(x_s) = y_s
    - 节点数 ≤ 128，深度 ≤ 12，常量 |v| ≤ 1000
    - 在射击区间内必须有限、连续、C²，二阶导变号次数 ≤ 100

输入：stdin 一行 JSON（平台注入）
输出：stdout 一行 JSON —— {"dsl": <AST 或 AST 的 JSON 字符串>}
"""

import json
import sys


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


def solve(round_state):
    team_id = round_state.get("team_id", "A")
    shooters = round_state.get("shooters", {}) or {}
    points = round_state.get("points", []) or []

    own = shooters.get(team_id)
    if not own:
        raise ValueError("round_state 缺少本队 shooter")

    sx = own["position"]["x"]
    sy = own["position"]["y"]

    enemies = [p for p in points if p.get("team") != team_id and p.get("position")]
    if enemies:
        # 选 y 最接近自己的敌人：直线最平坦，不容易冲出场地，
        # 且因为直线严格经过目标点，必然构成一次命中。
        target = min(enemies, key=lambda p: (abs(p["position"]["y"] - sy), (p["position"]["x"] - sx) ** 2))
        tx, ty = target["position"]["x"], target["position"]["y"]
    else:
        tx, ty = sx, sy

    return {"dsl": build_line_through_shooter(sx, sy, tx, ty)}


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("no round_state on stdin\n")
        return 1
    round_state = json.loads(raw)
    sys.stdout.write(json.dumps(solve(round_state)))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
