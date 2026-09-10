"""
Geometry Battle V1.1 — 审计用参赛算法（FIRST-TRY COMPATIBILITY 探针）

本文件只依据**公开资料**编写，未参考平台生产源码：
  - 《Geometry Battle V1.1 — 参赛算法开发要求》
  - README.md 的「算法协议」「DSL 白名单」「限制规则」章节
  - starter/solver.py 模板

算法策略刻意保持简单（本审计不评估策略优劣）：
  读取 Shooter 与存活敌人 → 取 |dy| 最小的敌人 → 构造严格经过 Shooter 的直线。
  直线是 C^∞，二阶导恒为 0，凸性变号 0 次，天然满足全部函数合法性规则。

接口依据（逐条对应文档章节）：
  §4  入口固定为根目录 solver.py
  §7  --team / --public / --reveal / --output 四个参数
  §8  --team 只可能是 "A" / "B"
  §9-§14 public_state.json / reveal_state.json 的结构与增量语义
  §28 输出路径由 --output 给出，不得假设绝对路径
  §29 结果只有 schema_version 与 dsl 两个键
  §38 函数必须严格经过 Shooter f(x_s) = y_s
  §40 返回完整 f(x)，不做方向裁剪
  §52 tmp + 原子 rename 提交
  §54 stdout 不是 IPC
"""

import argparse
import hashlib
import json
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--team", required=True)
    parser.add_argument("--public", required=True)
    parser.add_argument("--reveal", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def load_inputs(args):
    with open(args.public, "rb") as f:
        public_bytes = f.read()
    public_state = json.loads(public_bytes.decode("utf-8"))
    with open(args.reveal, "r", encoding="utf-8") as f:
        reveal_state = json.load(f)

    # §15：普通算法不需要自行验证 Hash，但允许验证。这里验证一次，
    # 错配时宁可拒绝计算（宁可无解，也不要基于错配输入给出答案）。
    expected = reveal_state.get("public_state_sha256")
    actual = hashlib.sha256(public_bytes).hexdigest()
    if expected is not None and expected != actual:
        sys.stderr.write("public_state_sha256 mismatch\n")
        raise SystemExit(2)
    return public_state, reveal_state


def number(value):
    return {"type": "number", "value": value}


def variable():
    # README §3：variable 的 value 必须是 "x"
    return {"type": "variable", "value": "x"}


def line_through_shooter(sx, sy, tx, ty):
    """f(x) = y_s + m * (x - x_s)，严格经过 Shooter，C^∞。"""
    dx = tx - sx
    dy = ty - sy
    slope = 0.0 if abs(dx) < 1e-9 else dy / dx
    # 限制斜率，避免在射击区间内冲出场地（-12..12）
    slope = max(-2.0, min(2.0, slope))
    return {
        "type": "add",
        "args": [
            number(sy),
            {
                "type": "mul",
                "args": [
                    number(slope),
                    {"type": "sub", "args": [variable(), number(sx)]},
                ],
            },
        ],
    }


def solve(team, public_state, reveal_state):
    by_id = {p["id"]: p for p in public_state["points"]}

    # §71：Shooter 编号不固定，必须从 reveal 的 shooters 里读 id，再回 public 查坐标
    shooter = by_id[reveal_state["shooters"][team]]
    sx, sy = shooter["x"], shooter["y"]

    # §11：points 含死点，必须按 alive 过滤
    enemies = [
        p for p in public_state["points"]
        if p["team"] != team and p["alive"]
    ]

    if not enemies:
        # §77：没有优秀函数时，输出一个合法保守函数通常比 Crash 更好
        return line_through_shooter(sx, sy, sx, sy)

    target = min(enemies, key=lambda p: (abs(p["y"] - sy), (p["x"] - sx) ** 2))
    return line_through_shooter(sx, sy, target["x"], target["y"])


def emit(output_path, dsl):
    """§52：tmp + 完整写入 + 原子 rename。"""
    result = {"schema_version": "1.1", "dsl": dsl}
    tmp = output_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, output_path)


def main():
    args = parse_args()
    public_state, reveal_state = load_inputs(args)
    emit(args.output, solve(args.team, public_state, reveal_state))
    return 0


if __name__ == "__main__":
    sys.exit(main())
