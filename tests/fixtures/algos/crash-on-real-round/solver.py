"""Crash On Real Round —— **failure-path 测试夹具**，不是正式算法。

用途：在真比赛里确定性地造出一次 `CRASH`，好让 Web UI 的
「如实展示算法故障」这条路径有回归覆盖（Final Audit P0-8）。

原理：安装时的 decoy preflight 用 `round: 0`（见 `src/submission/LocalPreflight.ts`），
而正式比赛从 `round: 1` 开始（规范 §5）。于是这个算法
**能通过安装校验**，却在真比赛第一轮立刻异常退出。

    round 0（Preflight） → 交一条经过自己固定 Emitter 的合法直线
    round ≥ 1（正式轮）  → 不写 result.json，直接异常退出 → 引擎记 CRASH

这样测出来的不是「一个 mock 的 errorCode」，而是引擎真的跑了一次沙箱、
真的看到进程崩掉、真的把它翻译成人话送到大屏上。
"""

import argparse
import json
import os
import sys


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
        sys.stderr.write("fixture: intentional crash on a real round\n")
        raise SystemExit(3)

    # Preflight（round 0）：一条经过自己固定 Emitter 的水平直线，合法且平凡
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
