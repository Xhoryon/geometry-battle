你现在是 Geometry Battle V1.1 的 **Algorithm Playtest Developer**。

你的任务不是修改比赛平台，而是仅依据公开的：

```text
competitor-kit/
```

开发两套明显不同的参赛算法，用于第一次 Geometry Battle 算法对战测试。

禁止为了优化算法读取或依赖：

```text
src/
tests/
Plans/
Judge implementation
SandboxRunner implementation
Match engine internals
```

如果 `competitor-kit/` 缺少必要信息，记录问题，不要通过读取生产源码绕过公开接口。

---

## 1. 开发目录

只创建和修改：

```text
playtest/competitors/
├── solver-fast/
└── solver-optimizer/
```

结果和 benchmark 可写入：

```text
playtest/results/
```

不要修改：

```text
algorithms/team-a/
algorithms/team-b/
```

正式 Team Slot 等算法通过验证后再由平台安装。

---

# Algorithm A — Fast Tactical Solver

目录：

```text
playtest/competitors/solver-fast/
```

目标：

> 尽可能快速地产生稳定合法、具有战术价值的攻击函数。

优先级：

1. 合法率接近 100%
2. 计算时间尽可能低
3. 优先尝试击杀对方 Shooter
4. 快速寻找一杀
5. 低成本寻找双杀/多杀
6. 避免昂贵的全局搜索

优先探索低成本候选族，例如：

```text
linear
low-degree polynomial
simple trigonometric
small composite functions
```

算法应在发现一个已经具有较高战术价值的候选后考虑尽早停止搜索，而不是耗尽整个时间预算。

建议目标：

```text
typical runtime < 200 ms
```

这只是开发目标，不是比赛规则。

---

# Algorithm B — Optimization Solver

目录：

```text
playtest/competitors/solver-optimizer/
```

目标：

> 在官方时间预算内尽可能提高攻击函数质量，即使明显慢于 Fast Solver。

重点探索：

```text
multi-target fitting
polynomial search
trigonometric search
composite-function search
interpolation-style candidates
obstacle-aware scoring
candidate refinement
```

优先级：

1. 合法函数
2. 最大化有效击杀
3. multi-kill
4. Shooter kill
5. obstacle avoidance
6. 在官方 timeout 内尽可能扩大搜索

允许其使用明显更多计算时间。

但不得依赖 TIMEOUT 边缘作为正常运行状态。

---

# 2. 两套算法必须真正独立

不得：

```text
solver-optimizer import solver-fast
solver-fast import solver-optimizer
```

两套算法各自必须：

```text
独立 solver.py
独立 helper modules
独立策略
```

可以共享对官方 JSON/DSL 规则的理解，但不要通过一个“万能 solver + 两个参数”伪装成两种算法。

目标是得到两个真正不同的策略实现。

---

# 3. 固定公开接口

两套算法都必须严格遵循 `competitor-kit/` 中的：

```text
ALGORITHM_REQUIREMENTS.md
RUNTIME_MANIFEST.md
DSL_SPECIFICATION.md
JSON_SCHEMA.md
```

并使用官方：

```text
Local Validator
Preflight
```

不得修改公开规则。

---

# 4. 第一阶段 — Baseline

先让两个目录分别能够：

```text
Local Validator PASS
Official Preflight PASS
```

在开始优化前，各自先完成一个最简单、稳定的合法实现。

---

# 5. 第二阶段 — 策略开发

分别优化 Fast 和 Optimization 两条路线。

每次重大修改后重新：

```text
Local Validator
Preflight
```

不要最后才做兼容性测试。

---

# 6. 测试数据

至少覆盖：

```text
6v6
8v8
10v10
```

并覆盖：

```text
Team A
Team B
```

以及多种：

```text
0 obstacles
1 obstacle
multiple obstacles
different shooters
different point layouts
```

不得只针对一个固定 Seed 优化。

---

# 7. Benchmark

分别记录：

```text
median compute time
p95 compute time
maximum compute time
invalid count
timeout count
candidate count
selected AST size/depth
predicted kill count
Shooter-target frequency
```

如果公开工具无法提供某项指标，就不要读取 Judge 私有实现补齐，标为 unavailable。

---

# 8. Head-to-Head Playtest

两套算法都完成并通过 Preflight 后，安装到正式测试 Slot。

第一批测试至少进行：

```text
5 场 smoke matches
```

确认：

```text
0 CRASH
0 unexpected INVALID
0 unexpected TIMEOUT
```

然后进行批量对战。

每个测试地图尽量采用：

```text
Match 1:
Fast = Team A
Optimizer = Team B

Match 2:
Optimizer = Team A
Fast = Team B
```

使用相同地图条件进行 slot swap。

不要让算法根据对手源码特化。

---

# 9. 第一轮 Playtest 建议规模

至少覆盖：

```text
20–30 个有效地图条件
```

每个条件进行 A/B swap。

如果当前 Match 尚未正式实现 Stalemate Rule，则测试 Harness 可以设置外部安全回合上限，避免测试无限运行。

该外部上限仅用于 Playtest。

不得把它写成正式比赛规则。

---

# 10. Playtest 重点指标

记录至少：

```text
wins
draw / externally terminated matches
match length
compute time
first-shot rate
Shooter kills
shot cancellations
kills per valid shot
multi-kill rate
no-hit rounds
invalid shots
timeouts
long no-progress streaks
```

重点回答：

1. Fast Solver 是否因为速度优势明显压倒 Optimization Solver？
2. Optimization Solver 的 multi-kill / obstacle handling 是否能弥补速度劣势？
3. 两种算法在 Team A/B swap 后结果是否明显变化？
4. 是否频繁发生 Shooter assassination？
5. 是否频繁出现长期无击杀局面？
6. 两种算法是否真正表现出不同策略？

---

# 11. 不修改平台

在整个开发和 Playtest 过程中：

不要因为某一套算法表现不好就修改：

```text
timeout
TIE_EPS_MS
DSL rules
AST limits
convexity limit
Shooter rules
Judge
Hit logic
Obstacle logic
START gate
Sandbox
```

发现平台问题时：

记录问题。

不要在本任务内修复。

这样才能区分：

```text
algorithm weakness
```

和：

```text
platform/rule weakness
```

---

# 12. 最终交付

必须交付：

```text
playtest/competitors/solver-fast/
playtest/competitors/solver-optimizer/
```

以及：

```text
playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md
```

报告至少包含：

## Fast Solver
- strategy
- implementation structure
- Local Validator
- Preflight
- benchmark
- known weaknesses

## Optimization Solver
- strategy
- implementation structure
- Local Validator
- Preflight
- benchmark
- known weaknesses

## Head-to-Head
- number of matches
- A/B swaps
- wins
- match length
- timing
- kills
- Shooter kills
- cancellations
- invalid/timeouts
- no-progress behavior

## Findings
明确区分：

```text
Algorithm finding
Platform finding
Rule-design finding
Test limitation
```

不要自动修改平台。

---

# 13. 完成结论

最终只输出：

```text
DUAL ALGORITHM PLAYTEST DEVELOPMENT COMPLETE
READY FOR PLAYTEST REVIEW
```

不得因为其中一套算法获胜，就声称它是“最优算法”。