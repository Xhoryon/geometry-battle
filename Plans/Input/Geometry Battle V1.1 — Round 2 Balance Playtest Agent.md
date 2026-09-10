你现在负责 Geometry Battle V1.1 的第二轮 Algorithm Balance Playtest。

本轮不是平台开发任务。

核心目标：

> 在冻结当前 Playtest Rules 的前提下，判断 Fast Tactical Solver 的统治究竟来自合理的算法 meta，还是当前 First Solver + Shooter Cancellation 规则导致策略空间过度收缩。

---

# 0. Rule Baseline

首先读取并记录：

```text
Plans/Input/Geometry Battle V1.1 Playtest Rules.md
```

该文件是本轮最高级别玩法规则输入。

本轮：

```text
READ AS FROZEN
```

不得修改它。

同时记录：

```text
Branch
HEAD
Rule baseline commit
Working tree
```

如果规则文件尚未提交：

STOP。

先报告：

```text
RULE BASELINE NOT COMMITTED
```

不要开始正式 Playtest。

---

# 1. 允许修改范围

允许创建和修改：

```text
playtest/competitors/solver-hybrid/
playtest/harness/
playtest/results/round-2/
```

如果为了补充测试报告需要，可创建：

```text
Plans/Output/
```

中的本轮 Handoff / Result。

不得修改：

```text
Plans/Input/Geometry Battle V1.1 Playtest Rules.md
competitor-kit/
solver-fast/
solver-optimizer/
src/
production Judge
Sandbox core
timing rules
DSL rules
```

Fast 和 Optimizer 都作为第一轮冻结算法使用。

---

# 2. Source Material

读取：

```text
Plans/Input/Geometry Battle V1.1 Playtest Rules.md
competitor-kit/
playtest/competitors/solver-fast/
playtest/competitors/solver-optimizer/
playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md
playtest/results/metrics.json
playtest/results/crosscheck.json
```

可以读取已有 playtest harness。

生产源码只允许在验证“平台异常”时由测试角色查看。

不得为了让 Hybrid 更强而读取 Judge 内部实现寻找未公开规则。

Hybrid 的开发规则来源必须是：

```text
Playtest Rules
+
competitor-kit/
```

---

# 3. 第一轮 Baseline

独立确认第一轮核心结果可以被现有产物支持：

```text
Fast      50 wins
Optimizer  0 wins
Draw      10
```

以及：

```text
Fast substantially faster
Optimizer frequently cancelled after Shooter elimination
0 INVALID
0 TIMEOUT
```

不要因为报告这么写就直接信。

从 raw / metrics 中核对。

如果无法复现：

记录：

```text
BASELINE REPRODUCTION ISSUE
```

不要继续做因果结论。

---

# 4. Arena Boundary

当前 Playtest Rules 已经明确：

```text
first arena boundary exit
→ attack terminates permanently
```

本轮不得重新设计这个规则。

确认：

```text
solver-fast
solver-optimizer
playtest harness
```

都按该公开规则工作。

如果已有算法内部之前根据隐藏 Judge 行为补丁修改过：

确认其行为现在与公开 Rule Baseline 一致。

---

# 5. 开发第三套算法

创建：

```text
playtest/competitors/solver-hybrid/
```

算法名称：

```text
Hybrid Tactical-First Anytime Optimizer
```

核心思想：

```text
Stage 1
Fast tactical search

        ↓

If strong Shooter-kill / high-value cheap shot exists:
EARLY RETURN

        ↓

Stage 2
Medium-cost multi-target search

        ↓

Stage 3
Remaining-time optimization
```

---

# 6. Hybrid Stage 1

首先用非常低成本搜索：

```text
Opponent Shooter kill
Simple one-kill
Cheap two-kill
High-value low-complexity trajectory
```

候选必须：

```text
legal
Shooter-compatible
arena-safe
obstacle-aware
DSL-valid
```

如果已经存在明显优秀战术解：

允许 Early Return。

目标是避免第一版 Optimizer：

```text
花大量时间得到优秀函数
↓
尚未开火就被 Fast 击杀 Shooter
```

的问题。

---

# 7. Hybrid Stage 2

如果 Stage 1 没有找到高价值结果：

继续搜索：

```text
low-degree polynomial
trigonometric candidates
composite candidates
small target combinations
interpolation-style candidates
```

重点：

```text
multi-hit
Shooter kill
obstacle avoidance
arena boundary survival
```

---

# 8. Hybrid Stage 3

如果时间仍充足：

允许进行更深入：

```text
candidate refinement
larger target combinations
higher-quality curve fitting
```

但必须留出明显安全余量。

不得把正常运行设计成：

```text
1990–2000 ms
```

。

---

# 9. Hybrid 目标

它不应该只是复制 Fast。

也不应该只是给 Optimizer 增加：

```text
if shooter:
    ...
```

需要形成真正的：

```text
ANYTIME SEARCH
```

特性：

> 在任意较早时间停止，都已经拥有一个可执行的合法候选；随着计算继续，函数质量逐步提高。

记录各搜索阶段：

```text
time spent
candidate count
best score
reason for early return
```

用于测试分析。

---

# 10. Hybrid Validation

必须完成：

```text
Local Validator PASS
Official Preflight PASS
```

并验证：

```text
Team A
Team B
6v6
8v8
10v10
0 obstacles
1 obstacle
multiple obstacles
```

目标：

```text
0 unexpected INVALID
0 unexpected TIMEOUT
```

---

# 11. Current Rules Experiment

使用冻结正式 Playtest Rules。

进行：

```text
Fast vs Hybrid
Optimizer vs Hybrid
Fast vs Optimizer
```

Fast vs Optimizer 可以使用第一轮数据作为历史 baseline，

但至少用本轮地图集做一个可比复核子集。

---

# 12. A/B Swap

每个地图条件必须进行：

```text
X = Team A
Y = Team B
```

以及：

```text
Y = Team A
X = Team B
```

结果必须区分：

```text
algorithm effect
slot/team-side effect
```

---

# 13. 样本规模

第一阶段：

```text
15 map conditions × swap
```

作为筛查。

如果没有平台异常：

扩展关键：

```text
Fast vs Hybrid
```

到至少：

```text
30 conditions × swap
= 60 matches
```

其他 pair 根据运行成本尽量达到同级规模。

---

# 14. Current Rule Metrics

至少记录：

```text
wins
draws
match length
median compute time
p95 compute time
first-shot rate
Shooter kill rate
shot cancellation rate
kills per executed shot
multi-kill rate
no-hit round rate
no-progress streak
arena-boundary termination rate
obstacle termination rate
INVALID
TIMEOUT
CRASH
```

---

# 15. 关键判断：Hybrid 能不能追上 Fast

重点回答：

```text
Fast vs Hybrid
```

如果 Hybrid 明显缩小第一轮：

```text
Fast 50 / Optimizer 0
```

的差距，

则说明：

> 当前规则存在可适应的 Tactical Meta。

如果 Hybrid 即使加入 Tactical-first 后仍被 Fast 极端压制：

则进入对规则结构的更强怀疑。

---

# 16. Counterfactual A

在：

```text
playtest/harness/
```

内增加实验模式：

```text
CF-NO-CANCEL
```

仅用于实验。

该模式：

> First Shot 即使击杀对方 Shooter，只要后方算法已经产生合法函数，其攻击仍执行。

不得修改 production Judge。

不得修改正式 Rule Baseline。

---

# 17. Counterfactual B

增加：

```text
CF-SIMULTANEOUS
```

含义：

```text
both valid functions resolve
```

计算速度不决定：

```text
first attack
shot cancellation
```

其他：

```text
function
hit
obstacle
boundary
```

规则保持一致。

---

# 18. Harness Integrity

Counterfactual Harness 必须有：

```text
OFFICIAL MODE
```

在 OFFICIAL MODE 下：

```text
harness result
==
official platform result
```

先进行 cross-check。

如果不能达到：

```text
100% agreement
```

不要运行 Counterfactual 统计。

先报告 Harness discrepancy。

---

# 19. Shooter Cancellation Effect

量化：

```text
Official Fast win rate
vs
CF-NO-CANCEL Fast win rate
```

以及 Hybrid / Optimizer 的变化。

同时记录：

```text
cancelled rounds
cancelled function predicted quality
```

只使用可公开/已有 playtest 数据能可靠获得的指标。

---

# 20. Speed Effect

比较：

```text
Official
vs
CF-SIMULTANEOUS
```

回答：

> 当速度不再影响执行顺序时，Fast、Hybrid、Optimizer 的相对强弱是否明显改变？

---

# 21. No-progress

使用全部有效 Match 收集：

```text
consecutive zero-kill rounds
```

计算：

```text
P50
P75
P90
P95
P99
MAX
```

并计算 Match Length 相同分位数。

---

# 22. Stalemate

本轮不得实现正式 Stalemate Rule。

只回答：

> 当前数据是否已经足够支持一个合理阈值？

如果 YES：

给出：

```text
candidate no-progress threshold
candidate hard round limit
```

以及数据依据。

不要修改 production。

---

# 23. Platform Failure Handling

当前已有一条待观察问题：

```text
occasional cross-round sandbox teardown hang
```

本轮如果再次发生：

保存：

```text
seed
match
round
process state
sandbox state
logs
```

并将对应批次标为：

```text
PLATFORM-CONTAMINATED
```

不要把它当算法失败。

不要在本轮修生产平台。

如果重复出现并影响批量统计：

停止大样本测试。

---

# 24. Timing

不得修改：

```text
TIE_EPS_MS
timing fairness threshold
release semantics
result timing semantics
```

记录真实：

```text
start skew
compute times
first-shot frequencies
```

如果发现稳定 Team A / Team B 方向偏置：

分类为：

```text
PLATFORM FINDING
```

不要自己修。

---

# 25. Rule Health Verdict

最终根据数据选择：

```text
HEALTHY
```

或：

```text
TACTICALLY ADAPTIVE
```

或：

```text
SPEED-DOMINATED
```

或：

```text
CANCELLATION-DOMINATED
```

或：

```text
STRUCTURALLY COLLAPSED
```

必须解释数据依据。

---

# 26. Interpretation

特别区分：

```text
ALGORITHM FINDING
PLATFORM FINDING
RULE-DESIGN FINDING
DOCUMENTATION FINDING
TEST LIMITATION
```

不要混在一起。

---

# 27. 不修改规则

即使 Counterfactual 显示：

```text
No-Cancel much more balanced
```

也不能直接改正式：

```text
Shooter Cancellation
```

规则。

只能提出候选修改供用户决定。

---

# 28. 最终报告

生成：

```text
playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md
```

包含：

```text
Executive Summary
Baseline Reproduction
Hybrid Design
Hybrid Benchmark
Current-rule Results
Fast vs Hybrid
Optimizer vs Hybrid
Slot Swap
Counterfactual No-Cancel
Counterfactual Simultaneous
Cancellation Effect
Speed Effect
No-progress Distribution
Match Length Distribution
Platform Findings
Rule-design Findings
Limitations
Rule Health Verdict
Recommendations
```

---

# 29. 最终必须回答

A.

```text
Did Hybrid materially close the gap to Fast?
YES / NO
```

B.

```text
Is Shooter Cancellation a major contributor to Fast dominance?
YES / NO / INCONCLUSIVE
```

C.

```text
Does first-solver speed excessively suppress function quality?
YES / NO / INCONCLUSIVE
```

D.

```text
Should the official rules change before proceeding toward tournament freeze?
YES / NO
```

E.

```text
Is there enough evidence to define a Stalemate Rule?
YES / NO
```

如果 D/E 为 YES：

只提出建议。

不要实施。

---

# 30. Completion

最终只输出：

```text
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW
```

不要进入 UI 开发。

不要自动开展 Round 3。