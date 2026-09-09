# 几何斗殴 - V1 Platform

**AI Vibecoding 函数图像比赛系统**

---

## 概述

几何斗殴是一个算法对抗比赛平台，双方队伍各提供一个算法程序，通过函数图像进行对抗。

比赛核心：给定双方 shooter 位置，算法计算出 `y = f(x)` 函数，函数图像首先击中对方 shooter 者获胜。

---

## 快速开始

### 1. 准备算法包

```
team-xxx/
├── manifest.json
└── solver.py
```

**manifest.json 示例：**
```json
{
  "name": "My Team",
  "version": "1.0",
  "entry": "solver.py",
  "language": "python"
}
```

**solver.py 示例：**
```python
import json
import sys

def solve(round_state):
    # round_state 包含:
    # - team_id: 'A' 或 'B'
    # - shooters: [{id, position}]
    # - enemies: [{id, position}]
    # - obstacles: [...]
    # - team_a_x_range: [-20, -4]
    # - team_b_x_range: [4, 20]

    # 构建 DSL AST
    dsl = {
        "type": "add",
        "args": [
            {"type": "mul", "args": [{"type": "number", "value": 0.3}, {"type": "variable", "value": "x"}]},
            {"type": "sin", "args": [{"type": "mul", "args": [{"type": "number", "value": 0.5}, {"type": "variable", "value": "x"}]}]}
        ]
    }

    return json.dumps({"dsl": dsl})

if __name__ == "__main__":
    input_json = sys.stdin.read().strip()
    if input_json:
        result = solve(json.loads(input_json))
        print(result)
```

### 2. DSL 格式

```json
{
  "type": "操作类型",
  "args": [参数数组],
  "value": 数值 (仅 number 类型)
}
```

**支持的操作：**
- `number`: 常数，如 `{"type": "number", "value": 1.5}`
- `variable`: 变量 x，如 `{"type": "variable", "value": "x"}`
- `add`, `sub`, `mul`, `div`: 二元运算
- `neg`, `sin`, `cos`, `tan`, `abs`, `sqrt`, `log`, `exp`: 一元运算
- `pow`, `min`, `max`: 二元运算
- `if`: 条件表达式 `{"type": "if", "condition": ..., "then": ..., "else": ...}`

### 3. 限制规则

| 限制 | 值 |
|------|-----|
| AST 节点数 | ≤ 128 |
| AST 深度 | ≤ 12 |
| 凸性变化次数 | ≤ 100 |
| 计算超时 | 2000ms |

---

## 项目结构

```
geometry-battle/
├── src/
│   ├── function/         # DSL/AST 核心
│   ├── competition/      # 比赛控制器
│   ├── submission/      # 算法提交系统
│   ├── runner/          # 算法运行器
│   ├── map/            # 地图生成器
│   ├── replay/         # 日志与回放
│   ├── ui/             # UI 组件
│   └── visualizer/     # 可视化
├── starter/            # 示例算法
└── Plans/             # 设计文档
```

---

## API 文档

### MatchController

```typescript
import { MatchController } from './competition/MatchController';

const match = new MatchController('Team A', 'Team B', seed);

// 上传算法
match.uploadTeamA('/path/to/package', 'solver.py');
match.uploadTeamB('/path/to/package', 'solver.py');

// 生成地图
match.generateMap(8, 'medium');

// 选择 Shooter
match.selectShooter('A', 'A3');
match.selectShooter('B', 'B5');

// 开始回合
match.judgeStart();

// 执行计算
const { resultA, resultB } = await match.executeCompute();

// 执行攻击
const { hitsA, hitsB, winner } = match.executeShots();

// 结束回合
const roundLog = match.finishRound();

// 获取结果
const winner = match.getWinner();
const matchLog = match.getMatchLog();
```

### DSL 函数

```typescript
import { parseDSL, evaluateAST, analyzeComplexity, countConvexityChanges } from './function/DSL';

const result = parseDSL(dslJson);
if (result.valid && result.ast) {
  const y = evaluateAST(result.ast, x);
  const complexity = analyzeComplexity(result.ast);
  const convexity = countConvexityChanges(result.ast, -20, 20);
}
```

### 地图生成

```typescript
import { generateMap, validateMap } from './map/MapGenerator';

const map = generateMap({ seed: 12345, pointCount: 8, difficulty: 'medium' });
const validation = validateMap(map);
```

---

## 比赛流程

1. **Match Setup**: 上传双方算法包
2. **Generate Map**: 生成/加载比赛地图
3. **Shooter Selection**: 双方选择 shooter
4. **Lock In**: 确认选择
5. **Judge START ROUND**: 裁判开始回合
6. **Countdown**: 3, 2, 1
7. **Reveal**: 揭盲，显示 shooter
8. **Computing**: 双方算法同时计算
9. **Shot**: 执行攻击
10. **Round Result**: 显示回合结果
11. **Next Round / Match End**: 继续或结束

---

## 运行测试

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行演示
npx ts-node src/index.ts

# 运行 UI 演示
npx ts-node src/demo-full-ui.ts

# 运行地图压力测试
npx ts-node src/map-stress-test.ts

# 运行 E2E 测试
npx ts-node src/e2e-test.ts
```
