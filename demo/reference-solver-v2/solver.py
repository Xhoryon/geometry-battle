#!/usr/bin/env python3
"""Geometry Battle V1.1 —— Reference Solver v2（独立 demo / 联调用参考实现）

    python3 solver.py --team A|B --public <p> --reveal <r> --output <o>

这不是参赛作品，而是一份**开发演示与本地联调**用的参考实现：它把 V1.1 的
启动契约、DSL 白名单、Emitter 恒等式、原子写结果全部按规范实现，并且在策略层
修掉了旧 demo 算法的一个已知毛病 —— **连续多个回合瞄同一个位置**，
导致局面卡死、无进展。

与旧 demo 的区别（详见 README.md）：

    1. alive target filtering   只瞄 alive == true 的敌点，死点永不入选；
    2. per-round rescoring      每回合按当前局面重新生成、重新模拟、重新打分，
                                不缓存任何跨回合的选择（沙箱本来就禁止跨轮状态）；
    3. repeated-target penalty  由 `round` + 当前存活集合确定性推出的「轮换 slate」，
                                对疑似刚打过的目标降权；这是**惩罚**不是强制；
    4. no-progress penalty      击杀结果与曲线形状都与「最平凡那条直线」重合的候选，
                                直接跳过换下一条；
    5. fallback candidate       任何异常、任何空局面、任何搜索失败，都退到
                                `f ≡ y_emitter`（必然经过 Emitter、必然合法）。

本文件是唯一的正式入口（包根目录的 solver.py）。策略拆在三个同目录模块里，
平台会把包根目录加入 sys.path，因此直接 `import gb_select` 即可：

    gb_dsl.py         DSL 白名单节点 + 结构自检 + 平台求值器的 Python 镜像
    gb_world.py       局面模型 + Judge 规则的只读镜像（用于打分）
    gb_candidates.py  候选曲线族（直线 / 曲率族 / 正弦族 / Newton 插值 / 常函数）
    gb_select.py      轮换 slate、无进展抑制、打分与选枪

只用标准库（RUNTIME_MANIFEST §3：沙箱内第三方包为 0）。
"""

import argparse
import hashlib
import json
import os
import sys
import traceback

# 包根目录会被平台加入 sys.path（SandboxRunner 的 bootstrap），直接 import 即可。
from gb_candidates import flat
from gb_dsl import assert_emittable, evaluate
from gb_select import choose_shot
from gb_world import build_world

# 单轮上限 500 ms（Rule Revision 3 §11）。留出 180 ms 给写文件与解释器退出。
COMPUTE_BUDGET_MS = 320.0

# 最后兜底用的 Emitter 常量。它**只在输入完全读不出来**时才会用到；
# 正常路径一律从 public["emitters"][team] 读取（规范 §3：Emitter 是公开常量）。
LAST_RESORT_EMITTER = {"A": (-18.0, 0.0), "B": (18.0, 0.0)}


def log(message):
    """有限的调试输出走 stderr（stdout 不是结果通道，且有 256 KB 上限）。"""
    try:
        sys.stderr.write(str(message) + "\n")
    except Exception:
        pass


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Geometry Battle reference solver v2 (demo)")
    ap.add_argument("--team", required=True, choices=["A", "B"])
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    ap.add_argument("--output", required=True)
    return ap.parse_args(argv)


def emit(args, dsl):
    """唯一的正式输出通道：临时文件 + flush + fsync + 原子替换（§4 / S1）。"""
    result = {"schema_version": "1.1", "dsl": dsl}
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, args.output)


def fallback_ast(team, public):
    """保证合法的兜底函数：f ≡ y_emitter。

    常函数是 C^∞、凸性变号 0、处处有限，并且恒等于自己的 Emitter 纵坐标，
    因此 `|f(x_e) − y_e| = 0` —— 这是本实现唯一在**任何**情况下都不会失败的输出。
    """
    ye = None
    if isinstance(public, dict):
        try:
            ye = float((public.get("emitters") or {}).get(team, {}).get("y"))
        except (TypeError, ValueError):
            ye = None
    if ye is None or ye != ye or abs(ye) > 1000.0:
        ye = LAST_RESORT_EMITTER.get(team, (-18.0, 0.0))[1]
    return {"type": "number", "value": float(ye)}


def build_ast(team, public, reveal):
    """正常路径：解析局面 → 选枪 → 返回 (ast, diag)。"""
    world = build_world(team, public, reveal)
    candidate, diag = choose_shot(world, COMPUTE_BUDGET_MS)
    assert_emittable(candidate.ast)
    # 提交前再自检一次：f(x_emitter) 必须严格等于 y_emitter。
    residual = evaluate(candidate.ast, world.me_x) - world.me_y
    if abs(residual) > 1e-9:
        raise RuntimeError("Emitter 残差 %r 超过自留容差" % residual)
    diag["residual"] = residual
    return candidate.ast, diag


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    public = None
    reveal = {}
    try:
        with open(args.public, "rb") as fh:
            raw = fh.read()
        public = json.loads(raw.decode("utf-8"))
        with open(args.reveal, "r", encoding="utf-8") as fh:
            reveal = json.load(fh)
        if reveal.get("public_state_sha256") != hashlib.sha256(raw).hexdigest():
            # 平台 bootstrap 已经独立复核过绑定（不匹配根本不会放我们进来）。
            # 真到了这里说明输入不可信：给一个合法的兜底，绝不 CRASH。
            log("reference-v2: public_state_sha256 不匹配，使用兜底函数")
            emit(args, fallback_ast(args.team, public))
            return 0
    except Exception as exc:
        log("reference-v2: 输入读取失败 %r，使用兜底函数" % (exc,))
        emit(args, fallback_ast(args.team, public))
        return 0

    try:
        ast, diag = build_ast(args.team, public, reveal)
        log("GB_REF2 %s" % json.dumps(diag, sort_keys=True))
    except Exception:
        # 任何搜索期的异常都不允许变成 CRASH / TIMEOUT。
        log("reference-v2: 搜索失败，使用兜底函数\n" + traceback.format_exc(limit=3))
        ast = fallback_ast(args.team, public)

    emit(args, ast)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # 最后一道保险：绝不空手退出
        log("reference-v2 fatal: %r" % (exc,))
        try:
            parsed = parse_args(sys.argv[1:])
            emit(parsed, fallback_ast(parsed.team, None))
        except BaseException:
            pass
        sys.exit(1)
