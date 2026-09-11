"""Timeout On Real Round —— **failure-path 测试夹具**，不是正式算法。

与 `crash-on-real-round` 同一原理（Preflight 用 round 0、正式轮从 round 1 开始），
区别只在于失败方式：这里在正式轮睡过 500 ms 的计算预算，
于是引擎在 deadline 处杀掉它并记 `TIMEOUT`。

    round 0（Preflight） → 立刻交出合法函数
    round ≥ 1（正式轮）  → sleep 2s → 超出 500ms 预算 → 引擎记 TIMEOUT

用于验证 Web UI 对 `TIMEOUT` 的展示路径（Final Audit P0-8）。
"""

import argparse
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    ap.add_argument("--output", required=True)
    a = ap.parse_args()

    public = json.load(open(a.public, encoding="utf-8"))

    if int(public.get("round", 0)) >= 1:
        # 远超 500ms 预算：引擎会在 deadline 处杀掉本进程并记 TIMEOUT
        time.sleep(2.0)
        sys.exit(1)

    e = public["emitters"][a.team]
    dsl = {
        "type": "add",
        "args": [
            {"type": "number", "value": e["y"]},
            {"type": "mul", "args": [
                {"type": "number", "value": 0.0},
                {"type": "sub", "args": [
                    {"type": "variable", "value": "x"},
                    {"type": "number", "value": e["x"]},
                ]},
            ]},
        ],
    }
    emit(a, dsl)
    return 0


if __name__ == "__main__":
    sys.exit(main())
