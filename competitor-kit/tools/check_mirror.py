#!/usr/bin/env python3
"""
Geometry Battle — 镜像自检工具（参赛者入口，开发诊断）

    python3 competitor-kit/tools/check_mirror.py ./my-algorithm
    python3 competitor-kit/tools/check_mirror.py ./my-algorithm --json
    python3 competitor-kit/tools/check_mirror.py ./my-algorithm --timeout 500

它回答一个问题：**同一份代码在 Team A 与 Team B 两侧是否表现一致？**
做法是把本地自检用的 decoy 世界整个镜像（x → −x、A/B 互换、编号互换、障碍物按序镜像），
让你的算法以 A 跑原世界、以 B 跑镜像世界（以及反过来的一对），然后比较两侧
**规范化后的几何**（f_A(x) 对 f_B(−x)）与 Judge 的结算结果 —— 不比 AST 字节。

结论与退出码：
    PASS  0  两侧都合法且几何一致
    WARN  0  两侧都合法但几何不同 —— 合法，只是提醒「你的算法不是镜像对称的，请确认这是有意的」
    FAIL  1  一侧合法而镜像侧崩溃 / 超时 / 非法 —— 经典的「只会打 Team A」bug
          2  用法 / 环境错误（目录不存在、包结构不合法、sandbox-exec 不可用……）

**这是开发诊断，不是正式规则。** 官方 Preflight 不运行它，它的结论也不会让任何提交被拒；
正式的接口与函数合法性检查仍以 validate_submission.py（== 官方 Preflight）为准。

实现说明（重要）
----------------
判定逻辑**没有**用 Python 重写。本脚本是一个前端，它调用仓库里
`src/operator/check-mirror.ts`，后者搭镜像世界、跑真实沙箱，而合法性与结算调用的都是
生产模块本身（parseCanonicalDSL / validateAttackFunction / judgeShot）。

依赖：Node.js（仓库自带）。首次运行会由 npx 使用仓库内的 ts-node。
"""

import os
import shutil
import subprocess
import sys

# 本文件位于 <repo>/competitor-kit/tools/check_mirror.py
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENTRY = os.path.join("src", "operator", "check-mirror.ts")


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
            "找不到镜像自检内核: {}\n"
            "请确认本工具是从比赛仓库的 competitor-kit/tools/ 目录运行的"
            "（即仓库结构未被改动）。".format(entry_path)
        )

    npx = shutil.which("npx")
    if npx is None:
        return die(
            "找不到 npx（Node.js）。镜像自检需要 Node.js —— 比赛仓库自带运行时，\n"
            "请先安装 Node.js，或在有 Node 的机器上运行本工具。\n"
            "你也可以直接运行: npx ts-node {} <算法目录>".format(ENTRY)
        )

    cmd = [npx, "--no-install", "ts-node", ENTRY] + list(argv)
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT)
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        return die("无法启动镜像自检进程: {}".format(exc))
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
