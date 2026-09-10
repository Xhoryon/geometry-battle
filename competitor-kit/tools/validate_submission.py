#!/usr/bin/env python3
"""
Geometry Battle V1.1 — 本地自检工具（参赛者入口）

    python3 competitor-kit/tools/validate_submission.py ./my-algorithm
    python3 competitor-kit/tools/validate_submission.py ./my-algorithm --team A

它会用**与官方 Preflight 完全相同的判定代码**检查你的算法包，逐项报告：

    Entrypoint / Package / CLI / startup / Runtime / Input
    Result JSON / DSL / Function legality / Timeout

退出码：0 = 全部通过；1 = 有分节失败；2 = 用法/环境错误。

实现说明（重要）
----------------
判定逻辑**没有**用 Python 重写。本脚本是一个前端，它调用仓库里
`src/operator/validate-submission.ts`，后者调用的又是生产模块本身：

    inspectPackage / buildPublicState / buildRevealState / prepareSandbox
    spawnRunner / parseResultFile / parseCanonicalDSL / validateAttackFunction

因此「本地自检规则 == 官方 Preflight 规则」是**同一份代码**的必然结果，
而不是两份需要人工同步的规则表（V1.1 Competitor Kit §12）。

依赖：Node.js（仓库自带）。首次运行会由 npx 使用仓库内的 ts-node。
"""

import os
import shutil
import subprocess
import sys

# 本文件位于 <repo>/competitor-kit/tools/validate_submission.py
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENTRY = os.path.join("src", "operator", "validate-submission.ts")


def die(message, code=2):
    sys.stderr.write(message.rstrip() + "\n")
    return code


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        sys.stderr.write(__doc__.strip() + "\n")
        return 2 if not argv else 0

    entry_path = os.path.join(REPO_ROOT, ENTRY)
    if not os.path.isfile(entry_path):
        return die(
            "找不到自检内核: {}\n"
            "请确认本工具是从比赛仓库的 competitor-kit/tools/ 目录运行的"
            "（即仓库结构未被改动）。".format(entry_path)
        )

    npx = shutil.which("npx")
    if npx is None:
        return die(
            "找不到 npx（Node.js）。本地自检需要 Node.js —— 比赛仓库自带运行时，\n"
            "请先安装 Node.js，或在有 Node 的机器上运行本工具。\n"
            "你也可以直接运行: npx ts-node {} <算法目录>".format(ENTRY)
        )

    cmd = [npx, "--no-install", "ts-node", ENTRY] + list(argv)
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT)
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        return die("无法启动自检进程: {}".format(exc))
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
