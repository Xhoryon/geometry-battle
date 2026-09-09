"""
Team Starter Algorithm
最小算法示例 - Plan 2 Phase A
"""

import json
import sys
import math


def solve(round_state):
    """
    主入口函数 - 每 round 被调用一次

    输入: round_state (dict)
    输出: DSL JSON (str)
    """
    team_id = round_state.get('team_id', 'A')
    shooters = round_state.get('shooters', [])
    enemies = round_state.get('enemies', [])

    # 简单策略：直接向中间画线 + sin 扰动
    # y = 0.1 * x + 0.5 * sin(0.3 * x) + base_y

    base_y = 0
    if shooters:
        base_y = shooters[0]['position']['y']

    # 构建简单 DSL
    dsl = {
        "type": "add",
        "args": [
            {"type": "mul", "args": [{"type": "number", "value": 0.1}, {"type": "variable", "value": "x"}]},
            {"type": "mul", "args": [{"type": "number", "value": 0.5}, {"type": "sin", "args": [{"type": "mul", "args": [{"type": "number", "value": 0.3}, {"type": "variable", "value": "x"}]}]}]},
            {"type": "number", "value": base_y}
        ]
    }

    return json.dumps({"dsl": dsl})


if __name__ == "__main__":
    # 从 stdin 读取 round_state
    input_json = sys.stdin.read().strip()
    if input_json:
        round_state = json.loads(input_json)
        result = solve(round_state)
        print(result)
