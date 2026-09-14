# solver-optimizer — Algorithm B (Optimization Solver)

**中文** | [English](./README.zh-CN.md)

几何斗殴 V1.1 playtest 参赛算法。在官方时间预算内最大化攻击函数质量 — 设计上明显慢于快速求解器。

## 策略

真正的时间预算搜索，覆盖多个族，全部构造精确：

* **精确多目标插值** — `f(x) = y_s + Σ c_k·V^k`，`V = (x−x_s)/L`，在 `fractions.Fraction` 中求解（Newton 差商 → 单项式）并针对发射 AST 的算术进行 Richardson 细化。度数阶梯最高到 K = 10（一轮有 ≤ 10 个敌方点）。
* **子集选择** — 贪心播种（敌方射手优先），局部交换细化，从 `match_id + round + team` 确定性播种的随机重启。
* **剩余度扫描** — 过定子集有一个自由首系数；搜索扫描这个真实的单参数族以穿越间隙。
* **三角族** — `a·sin(b·u)`、`a·sin(b·u) + c·(1−cos(d·u))`、`a·u + c·sin(b·u)`；在保护的频率网格上进行 1 点和 2 点精确拟合。
* **复合族** — `a·u + b·(exp(c·u)−1)` 和 `a·u + b·(√(1+c·u)−1)`，带显式域保护（exp 溢出、sqrt/log 非正）。
* **障碍感知评分** — 严格在轨迹终止前击杀，射手奖励，通过奖励，节点和陡度惩罚。

后备方案（穿过敌方射手的合法直线）首先评估，如果没有更好的存活则总是获胜。

## 预算

`config.json` → `budget_ms`（默认 1500）+ `slack_ms`（默认 150）；官方 2000 ms 超时从不是正常操作状态。缺失或损坏的 `config.json` 安全回退。

## 结构

```
solver.py        入口点、配置、原子发射、诊断
config.json      budget_ms / slack_ms
gboptim/
  astlib.py      DSL 构建器 + 结构限制
  evaluator.py   独立 AST 求值器（值 + 解析一阶/二阶导数）
  geometry.py    障碍有向距离 + 首次接触
  fit.py         精确有理插值 + 细化
  scoring.py     障碍感知筛查 + 评分
  search.py      时间预算搜索
  world.py       (public, reveal, team) → 棋盘
```

与 `solver-fast` 独立 — 包之间无导入。
