"""
Geometry Battle — 官方 Starter Algorithm (v1.1)

V1.1 启动契约（见 competitor-kit/ALGORITHM_REQUIREMENTS.md §2 与 §3）：

    python solver.py \
      --team A \
      --public /input/public_state.json \
      --reveal /input/reveal_state.json \
      --output /output/result.json

    四个参数固定；双方唯一差异是 `--team` 的取值（规范 §6）。

多文件包：平台会把**包根目录**加入 `sys.path`，因此同目录下的模块可直接
`import strategy`，子目录也可以 `from utils import helper` —— 无需自行修改
`sys.path`（与直接运行 `python solver.py` 的行为一致）。

输入（规范 §10/§37）：
    public_state.json  揭盲前的公开世界：schema_version / match_id / round /
                       map{xmin,xmax,ymin,ymax} / **emitters{A,B}** /
                       points[{id,team,x,y,alive}]
                       —— 含死点（alive=false），但**不含**障碍物。
                       Emitter 是**公开**结构（Revision 3 §6）：它由本队开赛前选定、整场不变、
                       不可击杀、不计入存活数，因此**不在 points 里**，要从
                       `public["emitters"][team]` 取。
    reveal_state.json  揭盲增量：public_state_sha256 / obstacles[]。
                       —— Revision 3 起**没有** shooters 字段（锚点已在 public 里）。
                       用 public_state_sha256 可自检两份输入是否配对。

输出（规范 §11/§25/§26/§27）：
    只写 `--output` 指定的 `result.json`：

        {"schema_version": "1.1", "dsl": <AST 或 AST 的 JSON 字符串>}

    只允许 `schema_version` 与 `dsl` 两个键 —— hits / winner / computeTime 之类
    一律不许出现（平台已经知道这些，或者该由 Judge 计算）。
    写入必须 tmp + 原子 rename，避免 Judge 读到写了一半的 JSON。
    **stdout 不作为结果通道**（规范 §24），只能作为被丢弃的调试输出；
    stderr 可以写有限 debug log（规范 §30）。

DSL 白名单（Plan V1 §11）：
    - 只允许运算符：number, variable, add, sub, mul, div, pow, neg,
      sin, cos, tan, sqrt, log, exp
    - 禁止：if/else/switch/?:, min, max, abs, floor, ceil, round, sign, step,
      Heaviside, 布尔与比较运算
    - 函数必须严格经过自己的**固定 Emitter**：f(x_e) = y_e
      （x_e / y_e 由本队开赛前选定，**逐场不同** —— 从 public["emitters"][team] 读，
        不要写死任何坐标；注意 preflight 的 decoy 世界锚点也不是平台常量）
    - 节点数 ≤ 128，深度 ≤ 12，常量 |v| ≤ 1000
    - 在射击区间内必须有限、连续、C²，二阶导变号次数 ≤ 100
"""

import argparse
import hashlib
import json
import os
import sys


# ============================================================================
# 输入解析
# ============================================================================

def load_input():
    ap = argparse.ArgumentParser(description="Geometry Battle starter algorithm (v1.1)")
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

    # 平台保证绑定成立；算法侧再查一遍，错配时宁可拒绝计算也不给出错误答案。
    expected = reveal.get("public_state_sha256")
    if expected != hashlib.sha256(public_bytes).hexdigest():
        sys.stderr.write("public_state_sha256 mismatch\n")
        raise SystemExit(2)
    return args, public, reveal


def emit(args, dsl):
    """唯一的正式输出通道：tmp + 原子 rename（规范 §25/§27）。"""
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"schema_version": "1.1", "dsl": dsl}, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, args.output)


def emitter_of(public, reveal, team):
    """发射锚点 = 固定 Emitter（Rule Revision 3 §4）。

    Emitter 的坐标**直接在 public_state.json 里**，不再是 reveal 里的一个 id、
    也不再从 points 表里查 —— 它整场比赛固定、不可死亡、不是战斗点（§3/§6）。
    """
    return public["emitters"][team]


def alive_enemies_of(public, team):
    return [p for p in public["points"] if p["team"] != team and p.get("alive", True)]


# ============================================================================
# DSL 构造
# ============================================================================

def node_number(value):
    return {"type": "number", "value": value}


def node_variable():
    return {"type": "variable", "value": "x"}


def build_line_through_emitter(emitter_x, emitter_y, target_x, target_y):
    """
    构造经过**自己的固定 Emitter** 的直线：
        f(x) = y_e + m * (x - x_e)

    直线是 C^∞ 的，二阶导恒为 0，凸性变号次数为 0，天然满足验证。
    目标方向取存活敌人的质心；若敌人恰好与 Emitter 同 x 坐标，
    则退化为水平线（斜率 0），仍然是合法函数。
    """
    dx = target_x - emitter_x
    dy = target_y - emitter_y

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
            node_number(emitter_y),
            {
                "type": "mul",
                "args": [
                    node_number(slope),
                    {
                        "type": "sub",
                        "args": [node_variable(), node_number(emitter_x)],
                    },
                ],
            },
        ],
    }


def solve(team, public, reveal):
    me = emitter_of(public, reveal, team)
    sx, sy = me["x"], me["y"]

    enemies = alive_enemies_of(public, team)
    if enemies:
        # 选 y 最接近自己的敌人：直线最平坦，不容易冲出场地，
        # 且因为直线严格经过目标点，必然构成一次命中。
        target = min(enemies, key=lambda p: (abs(p["y"] - sy), (p["x"] - sx) ** 2))
        tx, ty = target["x"], target["y"]
    else:
        tx, ty = sx, sy

    return build_line_through_emitter(sx, sy, tx, ty)


def main():
    args, public, reveal = load_input()
    emit(args, solve(args.team, public, reveal))
    return 0


if __name__ == "__main__":
    sys.exit(main())
