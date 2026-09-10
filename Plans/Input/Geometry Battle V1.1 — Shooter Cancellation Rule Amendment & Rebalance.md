# Geometry Battle V1.1 — Shooter Cancellation Rule Amendment & Rebalance

## Role

你现在负责一次经过用户明确授权的：

```text
RULE AMENDMENT
```

本轮不是自由规则设计。

用户已经决定：

> 当前 Shooter 被击杀后，不应自动取消该队本轮已经开始的攻击。

你的任务是将这一决定准确落实到：

- Playtest Rules；
- production Judge / Match orchestration；
- Competitor Kit；
- tests；
- replay/audit；
- playtest harness；

然后重新进行 Algorithm Balance Playtest。

---

# 1. Baseline

首先记录当前：

```text
Branch
HEAD
Working tree
RULE_BASELINE_SHA
ROUND1_BASELINE_SHA
Round-2 result SHA
v1.0.0-competition
```

必须确认：

```text
v1.0.0-competition → 26d7970
```

保持不动。

本次修改属于：

```text
V1.1 Playtest Rule Amendment
```

不得回写或移动 V1.0 tag。

---

# 2. 新 §38 正式规则

旧规则：

```text
First Solver kills opponent Shooter
→ opponent shot cancelled
```

废止。

新规则冻结为：

> **START 之后，双方获得本轮独立且不可撤销的攻击权。**

具体：

```text
START
↓
Team A attack right locked
Team B attack right locked
↓
Both algorithms compute from immutable Round Snapshot
```

如果 A 先攻击并击杀 B Shooter：

```text
B Shooter
→ dies normally

BUT

B current-round attack right
→ remains valid
```

B 不重新选择 Shooter。

B 不重新计算 Round State。

B 的函数仍必须经过：

```text
START 时原始 Shooter
```

---

# 3. Shooter 的新语义

Shooter 在一个 Round 中定义为：

> 本轮攻击函数的数学发射锚点。

而不是：

> 必须存活到攻击执行瞬间，否则攻击失效的枪手。

因此：

```text
START snapshot Shooter = B4
```

则 B 的函数始终必须满足：

```text
f(x_B4) = y_B4
```

即使 B4 在 B 攻击执行前被 A 击杀。

---

# 4. 不进行同轮 Shooter Replacement

明确禁止实现：

```text
Shooter dies
→ randomly choose another alive point
→ reuse old function
```

也禁止：

```text
Shooter dies
→ select replacement
→ rerun algorithm
```

原因：

- 原函数通常不经过新 Shooter；
- 会破坏 immutable Round Snapshot；
- 会产生第二次计算；
- 会造成新的 timing definition；
- 会引入随机性；
- 会改变双方获得的信息。

因此：

```text
NO SAME-ROUND SHOOTER REPLACEMENT
```

---

# 5. 下一轮 Shooter

如果当前 Shooter 在本 Round 死亡：

```text
alive = false
```

那么下一轮：

```text
cannot be selected
```

人类仍按正常 Shooter Selection 流程，从剩余存活点中重新选择。

不要自动随机指定下一轮 Shooter。

---

# 6. Attack Order 保留

本轮**不要取消速度机制**。

继续：

```text
faster valid solver
→ attacks first

slower valid solver
→ attacks second
```

因此计算速度仍然有正式价值。

例如：

```text
A computes in 25 ms
B computes in 180 ms
```

A 仍然先攻击。

只是：

```text
A kills B Shooter
```

不再删除 B 整个本轮攻击。

---

# 7. Immutable Snapshot 保留

START 后冻结：

```text
points
alive state
shooters
obstacles
public state
reveal state
```

后手算法不因为第一击结果重新计算。

例如：

```text
START:
B2 alive
B4 alive
B6 alive

A attacks:
kills B2 and B4

B attack:
still uses START snapshot
```

但 Judge 在实际执行 B 的攻击时：

已经死亡的敌我 Point 不能再次被“复活”。

需要明确区分：

```text
Algorithm Input Snapshot
```

与：

```text
Live Resolution State
```

---

# 8. 双方同时死亡

新规则下可能出现：

```text
A attacks first
→ kills all B

B already has current-round attack right
→ B attacks second
→ kills all A
```

旧 cancellation 规则下这种情况可能不存在。

因此必须正式定义：

## Mutual Elimination

如果一个 Round 结算完成后：

```text
aliveA = 0
AND
aliveB = 0
```

则：

```text
MATCH DRAW
```

建议 end reason：

```text
MUTUAL_ELIMINATION
```

不得因为 A 是 First Solver 就自动判 A 赢。

---

# 9. 如果后手算法尚未完成

关键规则：

Shooter 死亡后：

```text
do NOT terminate slower solver merely because Shooter died
```

它仍然拥有自己的完整官方计算 deadline。

例如：

```text
A result = 30 ms
A attacks at ~30 ms
kills B Shooter

B still computing
```

B 应继续到：

```text
its own 2000 ms timeout
```

如果 B 在 deadline 内返回合法函数：

```text
B attack executes
```

如果：

```text
TIMEOUT
INVALID
CRASH
```

则正常不攻击。

---

# 10. Runner Process Behavior

删除旧有：

```text
opponent Shooter killed
→ terminate slower runner
```

行为。

新的进程生命周期只由：

```text
valid result
timeout
crash
invalid output
normal cleanup
```

决定。

Shooter death 不再是 Runner termination signal。

---

# 11. 正式状态名称

旧：

```text
SHOT_CANCELLED
SHOOTER_ELIMINATED_CANCEL
```

如果只服务于旧规则，应从当前生产状态路径中移除或标记为历史兼容。

新增/保留：

```text
SHOOTER_ELIMINATED
```

但它只表示：

```text
the shooter point died
```

不能再隐含：

```text
current attack cancelled
```

---

# 12. Audit / MatchLog

每 Round 应能记录：

```text
firstSolver
firstAttack
secondAttack
shooterAAliveAfterRound
shooterBAliveAfterRound
mutualElimination
```

如果 Shooter 在第二击前死亡但第二击仍执行，应可从日志明确证明。

例如：

```json
{
  "firstSolver": "A",
  "aShooterKilledBeforeBOwnAttack": true,
  "bAttackExecuted": true
}
```

字段名以当前日志模型为准，不要复制一套冗余语义。

---

# 13. Replay

Replay 必须展示：

```text
A attacks first
↓
B Shooter eliminated
↓
B attack still executes
```

UI 不得继续显示：

```text
SHOT CANCELLED
```

除非攻击真正因为：

```text
TIMEOUT / INVALID / CRASH
```

不存在。

---

# 14. 更新 Rule Baseline

修改：

```text
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

§38 应改为新的：

```text
Locked Attack Right
```

或等价名称。

§39 的 Balance Review / CF-NO-CANCEL 描述也需要更新。

因为 No-Cancel 不再只是 Counterfactual：

> 它现在成为新的正式 V1.1 Playtest Rule。

保留历史说明：

```text
Previous playtest rule:
Shooter elimination cancelled the opponent shot.

Round-2 evidence showed this produced strong cancellation dominance.

Rule amended by human decision.
```

不要删除历史证据。

---

# 15. Competitor Kit

同步公开说明。

参赛者必须明确知道：

> 击杀对方 Shooter 不会取消对方本轮已经获得的攻击。

但仍可攻击 Shooter，因为：

```text
it removes an opponent point
```

并影响未来 Round。

不要再告诉算法作者：

```text
Shooter assassination may cancel the opponent shot
```

---

# 16. Algorithm strategy implications

不要修改：

```text
solver-fast
solver-optimizer
solver-hybrid
```

来适应新规则。

第一轮 Rebalance 必须使用**原冻结算法**。

这样才能测量：

> 纯规则变化造成了什么结果。

算法适应放到后续 Round。

---

# 17. Permanent Regression Tests

至少新增/更新以下回归：

### R1

```text
A attacks first
kills B Shooter
B already has valid result
→ B still attacks
```

### R2

```text
A attacks first
kills B Shooter
B still computing
B later returns valid result before timeout
→ B attacks
```

### R3

```text
A kills B Shooter
B times out
→ no B attack
```

原因必须是：

```text
TIMEOUT
```

而不是：

```text
CANCELLED
```

### R4

```text
A kills B Shooter
B returns INVALID
→ no B attack
```

### R5

```text
both Shooters kill each other
→ both attacks may resolve
```

### R6

```text
both teams reach 0 alive after same Round
→ MUTUAL_ELIMINATION / DRAW
```

### R7

```text
dead Shooter
→ unavailable next Round
```

### R8

```text
no same-round replacement
```

---

# 18. Existing Regression Review

检查旧测试中所有：

```text
cancel
cancellation
shooter eliminated
runner terminated
```

断言。

分类：

```text
obsolete due to authorized rule change
still valid
historical only
```

可以修改因本次正式规则变更而必然失效的旧测试。

但不得借机修改：

```text
timing fairness
DSL
Hit
Obstacle
Boundary
START
Sandbox
```

无关断言。

---

# 19. Typecheck + Full Regression

运行：

```text
npm run typecheck
npm test
```

必须记录所有结果。

如果出现与本次规则无关的失败：

不要静默修复。

先定级。

---

# 20. Rebalance Playtest

生产规则实现通过后，使用被冻结的：

```text
solver-fast
solver-optimizer
solver-hybrid
```

重新运行相同/可比地图集。

核心 pairing：

```text
Fast vs Optimizer
Fast vs Hybrid
Hybrid vs Optimizer
```

每个 pairing：

```text
30 map conditions × A/B swap
= 60 matches
```

建议总计：

```text
180 matches
```

---

# 21. 不使用旧 CF-NO-CANCEL 作为正式结果

因为现在：

```text
NO-CANCEL
```

已经成为生产规则。

旧：

```text
CF-NO-CANCEL
```

应重新命名/归档为：

```text
historical counterfactual
```

不得和新的 production result 混淆。

---

# 22. 新 Counterfactual

如果需要保留旧规则作为对照：

可以在 playtest harness 中定义：

```text
CF-LEGACY-CANCEL
```

即：

```text
Shooter killed before second attack
→ second attack cancelled
```

只用于比较旧规则。

生产不得使用。

---

# 23. Rebalance Metrics

统计：

```text
wins
draws
mutual elimination
match length
first-shot rate
shooter kill rate
kills per shot
multi-kill
INVALID
TIMEOUT
CRASH
no-hit rounds
no-progress streak
```

旧指标：

```text
shot cancellation rate
```

在新规则下应为：

```text
0 by design
```

不要把 TIMEOUT 等算作 cancellation。

---

# 24. 最重要的平衡问题

回答：

### A

删除 Shooter cancellation 后：

```text
Fast
Optimizer
Hybrid
```

是否都存在非零、非偶然的竞争能力？

### B

Fast 的低延迟是否仍然有明显收益？

### C

Optimizer 的函数质量是否现在过度强势？

### D

Hybrid 是否成为最稳定的折中策略？

### E

是否出现大量：

```text
MUTUAL_ELIMINATION
```

？

---

# 25. 不立即优化算法

如果新规则下 Optimizer 大胜：

不要直接修改算法。

先报告。

因为这一轮目的就是测：

```text
RULE EFFECT
```

而不是：

```text
ADAPTED META
```

---

# 26. Stalemate

继续：

```text
DEFER
```

不要本轮正式实现。

但重新收集：

```text
match length
no-progress streak
```

因为新规则可能显著改变其分布。

---

# 27. Arena Boundary

保持当前正式规则：

```text
first boundary exit
→ permanent trajectory termination
```

不得修改。

确保 Competitor Kit 已准确公开。

---

# 28. Rule Version

建议将修改后的测试规则标记：

```text
Geometry Battle V1.1 Playtest Rules — Revision 2
```

而不是：

```text
V1.2
```

因为当前仍处于 V1.1 tournament-freeze 前的 Balance Playtest。

---

# 29. Commits

建议至少拆成：

```text
docs(rules): amend shooter elimination semantics
```

```text
feat(v1.1): preserve locked attack after shooter elimination
```

```text
test(playtest): rebalance after cancellation rule amendment
```

不要把规则、生产实现和 180 场结果塞成一个 commit。

---

# 30. Independent Rule Re-Gate

规则修改和 Rebalance 完成后，不要开发 UI。

先交给 Fresh READ-ONLY Auditor，确认：

```text
Rule document
==
Competitor Kit
==
production Judge
==
tests
==
Replay
```

并检查旧 cancellation 路径是否残留。

---

# 31. Final Report

生成：

```text
playtest/results/shooter-rule-revision/
SHOOTER_RULE_REBALANCE_REPORT.md
```

必须包含：

```text
Old Rule
New Rule
Reason for Change
Implementation Diff Scope
Regression Evidence
Fast vs Optimizer
Fast vs Hybrid
Hybrid vs Optimizer
Mutual Elimination
Timing
Match Length
No-progress
Platform Findings
Rule Health
Remaining Open Questions
```

---

# 32. Final Verdict Questions

必须回答：

```text
1. Did removal of shot cancellation resolve the observed strategy collapse?
YES / NO / INCONCLUSIVE
```

```text
2. Does computation speed still have meaningful competitive value?
YES / NO
```

```text
3. Did function-quality optimization become excessively dominant?
YES / NO / INCONCLUSIVE
```

```text
4. Is the revised Shooter rule suitable to remain the V1.1 playtest baseline?
YES / NO
```

```text
5. Should Stalemate measurement be the next rule task?
YES / NO
```

---

# 33. Completion State

开发方最终只能输出：

```text
SHOOTER RULE REVISION & REBALANCE COMPLETE
READY FOR INDEPENDENT RULE RE-GATE
```

不得自行宣布：

```text
TOURNAMENT READY
```