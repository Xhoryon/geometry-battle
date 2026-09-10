# Geometry Battle V1.1 — Revision 3 Final Completion Wave

本任务是 Geometry Battle V1.1 在 Final Competition Readiness Audit 前的最后一次大型开发阶段。

目标不是完成一个小 remediation。

目标是：

> 一次性完成剩余 Rule、Balance、Termination、Platform、Competitor Kit、Replay/Audit、UI/UX 与 Tournament Operations 工作，最终形成 V1.1 Release Candidate。

除非遇到未授权的重大玩法取舍，否则不要中途停止请求用户确认。

---

# 0. 工作方式

本轮采用：

```text
TARGETED DEVELOPMENT
→ INTERNAL CHECKPOINT
→ NEXT PHASE
→ FINAL FULL VERIFICATION
```

不要每修改一个模块就运行整套重型测试。

普通开发阶段：

```text
1 main agent
+
最多 3–5 个真正有必要的并行 subagents
```

禁止再次进行类似：

```text
43 agents
27 adversarial rebuttal groups
```

的大规模审计。

这种 heavy adversarial review 留给最终：

```text
V1.1 FINAL COMPETITION READINESS GATE
```

---

# 1. Baseline

首先记录：

```text
Branch
HEAD
Working tree
v1.0.0-competition
Revision 2 rule SHA
Revision 2 production SHA
Round-1 baseline SHA
Round-2 evidence SHA
Independent Rule Re-Gate report
```

确认：

```text
v1.0.0-competition → 26d7970
```

永久保持不动。

读取：

```text
Plans/Output/V1.1 Revision 2 Independent Rule Re-Gate.md
```

将其中：

```text
CONSOLIDATED REMAINING WORK
```

作为本轮输入之一。

---

# 2. Revision 3 — Fixed Shooter / Emitter

用户已经明确决定新的核心规则。

每支队伍拥有：

```text
ONE FIXED SHOOTER
```

它在整个 Match 中：

```text
固定
不可更换
不可死亡
不可被击杀
不可被消除
```

它本质上是：

```text
Permanent Function Emitter
```

建议内部和规范逐渐使用：

```text
Fixed Shooter
或
Emitter
```

避免继续与普通战斗 Point 混淆。

---

# 3. Fixed Shooter 不属于普通战斗点

推荐模型：

```text
Team A:
Emitter A0
Combat Points A1...An

Team B:
Emitter B0
Combat Points B1...Bn
```

Emitter：

```text
has coordinates
belongs to team
is function anchor
is permanent
is protected
```

但：

```text
does not count toward alive combat points
cannot be killed
cannot be eliminated
cannot be a victory target
```

如果当前 schema 将 Shooter 混在 `points[]` 内，不要求为了形式美观进行危险的大规模重构。

允许采用兼容模型，例如：

```text
role = "emitter"
protected = true
```

但整个系统必须能明确区分：

```text
Emitter
vs
Combat Point
```

不得再依赖“alive Shooter”这种旧语义。

---

# 4. Function Anchor

每轮 Team A 函数必须经过固定 A Emitter：

```text
|f(x_A0) - y_A0| <= 1e-6
```

Team B 同理。

Emitter 坐标：

```text
整个 Match 不变
```

算法不得每轮获得新的 Shooter。

---

# 5. 删除 Shooter Selection

正式比赛流程不再存在：

```text
human selects Shooter every round
SHOOTER LOCK
Shooter reveal
Shooter replacement
```

新的流程简化为：

```text
PUBLIC
→ REVEAL
→ START
→ COMPUTE
→ RESOLVE
```

如果障碍等信息仍需 Reveal 才公开，则保留：

```text
PUBLIC → REVEAL
```

但 Reveal 不再承担 Shooter reveal。

---

# 6. Emitter Information

由于 Emitter 是整个 Match 固定的公开结构：

其坐标应该从 Match 开始即可公开。

建议进入：

```text
public_state.json
```

而不是 reveal_state。

例如语义：

```json
{
  "emitters": {
    "A": {"x": -18, "y": 0},
    "B": {"x": 18, "y": 0}
  }
}
```

具体 schema 根据现有架构最小修改。

A/B 收到 byte-identical JSON。

Team identity 仍只通过：

```text
--team A
--team B
```

决定。

---

# 7. Emitter Invulnerability

任何攻击轨迹经过敌方 Emitter：

```text
NO KILL
NO DAMAGE
NO ELIMINATION
```

Emitter 不应因为被轨迹穿过而改变状态。

不得产生：

```text
Shooter assassination
```

概念。

如果 hit engine 当前遍历全部 Point：

必须明确跳过：

```text
role == emitter
```

的 elimination。

---

# 8. Attack Rights

保留 Revision 2 的正确部分：

```text
START
→ both teams receive independent current-round attack rights
```

双方合法函数都允许完成本轮攻击。

不存在：

```text
Shot Cancellation
```

因为 Emitter 根本无法死亡。

因此从正式生产语义中继续清理：

```text
SHOT_CANCELLED
SHOOTER_ELIMINATED_CANCEL
Shooter death cancellation
```

历史报告可以保留。

生产规则不得重新出现。

---

# 9. Victory

一方胜负只看：

```text
Combat Points
```

如果：

```text
aliveCombatPointsA = 0
aliveCombatPointsB > 0
```

则：

```text
B WINS
```

反之亦然。

Emitter 永远不计入：

```text
aliveCombatPoints
```

---

# 10. Mutual Elimination

因为本轮双方攻击权锁定，如果同一 Round 结束后：

```text
aliveCombatPointsA = 0
AND
aliveCombatPointsB = 0
```

则：

```text
DRAW
endReason = MUTUAL_ELIMINATION
```

First Solver 不得因此自动获胜。

---

# 11. New Round Timeout

当前：

```text
ALGORITHM_TIMEOUT_MS = 2000
```

Revision 3 默认 Playtest candidate 改为：

```text
ALGORITHM_TIMEOUT_MS = 500
```

本轮需要进行：

```text
250ms
500ms
750ms
```

三档 benchmark。

目标是确认：

```text
500ms
```

是否能够：

- 支持现有合法算法正常完成；
- 明显改善 Match pacing；
- 防止超长复杂优化搜索；
- 保留合理策略空间。

不得自行恢复：

```text
2000ms
```

作为正式 Revision 3 默认值。

如果数据证明 500ms 对正常 reference solvers 产生明显非预期 TIMEOUT：

允许报告：

```text
750ms recommended
```

并给出数据。

否则保持：

```text
500ms
```

---

# 12. Frozen Solver Re-test

暂时不要修改：

```text
solver-fast
solver-optimizer
solver-hybrid
```

首先使用被冻结的三套算法重新测试 Revision 3。

因为我们需要测量：

```text
RULE EFFECT
```

而不是算法立即适应后的结果。

测试：

```text
Fast vs Optimizer
Fast vs Hybrid
Hybrid vs Optimizer
```

A/B swap。

开发阶段无需再次默认运行极大规模实验。

先使用：

```text
10–15 map conditions × swap
```

做快速筛查。

如果结果合理，再扩展关键 pairing。

---

# 13. Balance Objective

Revision 3 不要求三套 reference solvers 精确 50/50。

重点判断是否仍出现：

```text
50–0
38–2
37–3
```

这类明显 strategy collapse。

判断：

```text
Does Fast have a viable niche?
Does Optimizer have a viable niche?
Does Hybrid have a viable niche?
Does one family dominate almost independently of map/side?
```

---

# 14. Timing Value

500ms timeout 本身已经让运行效率成为算法设计约束。

保留：

```text
faster valid solver
→ first attack
```

但不要重新引入：

```text
faster solver
→ delete opponent attack
```

统计：

```text
compute time
first solver
kills
wins
```

判断速度是否仍存在实际价值。

---

# 15. Stalemate Measurement

固定 Emitter 规则和新 timeout 稳定后，再重新测 Stalemate。

不要使用旧 cancellation / Revision 2 的 threshold 直接冻结。

收集：

```text
consecutive zero-kill rounds
match length
alive-point state
repeated state signatures
```

特别检测：

```text
absorbing no-progress state
```

即连续多个 Round：

```text
alive set unchanged
```

且攻击行为重复或无有效击杀。

---

# 16. Stalemate Rule

本轮必须最终给出并实现 V1.1 Stalemate Rule。

优先设计为容易解释、容易 Judge、容易 Replay 的规则。

推荐从：

```text
NO-PROGRESS LIMIT
+
HARD ROUND LIMIT
```

中选择。

阈值必须依据 Revision 3 数据。

不得继续无限比赛。

如果达到 Stalemate：

优先：

```text
MATCH DRAW
```

除非规则证据强烈支持一个简单、无争议的 tiebreak。

不要创造复杂隐藏评分系统。

---

# 17. Hard Termination Guarantee

最终必须满足：

> Every valid Geometry Battle match terminates in finite time.

必须证明所有 Match 至少由以下之一结束：

```text
ELIMINATION
MUTUAL_ELIMINATION
STALEMATE
HARD_ROUND_LIMIT
```

具体 end reason 根据最终设计。

---

# 18. Resolve Independent Audit P1

一次性关闭：

```text
RC-1
RC-2
CK-1
PLAT-1
```

但使用 Revision 3 新规则作为最终语义。

RC-1：

全面搜索并删除/历史化所有旧 Shooter cancellation 现行文案。

RC-2：

统一 Match Win / Mutual Elimination。

CK-1：

Competitor Kit 完整同步 Revision 3。

PLAT-1：

按独立 Auditor 裁决：

```text
OUTDATED TEST
```

更新 `algorithm-slot` test 和对应 README。

不要删除合法 `manifest.json`。

---

# 19. Arena Boundary

Competitor Kit 必须明确公开：

```text
first arena boundary exit
→ trajectory permanently terminates
```

包含：

```text
x boundary
y boundary
```

的实际官方语义。

不得要求参赛者通过 Judge 源码发现。

---

# 20. aBlocked

按独立审计裁决：

```text
internal diagnostic
```

无需公开变量名。

但对应公开规则：

```text
obstacle first-contact termination
```

必须完整。

---

# 21. startSkew

按 Independent Audit：

```text
OPTIONAL
```

不作为 Solver 输入。

如果容易实现，则将：

```text
startSkew
```

补充到：

```text
Replay metadata / MatchLog
```

如果需要大规模架构修改：

可保留现有 AuditLog 记录并在 Final Report 说明。

不要为了 optional telemetry 引入新风险。

---

# 22. Replay / Audit

Replay 必须正确表达 Revision 3：

```text
fixed emitters
combat points
first solver
attack order
trajectory
kills
remaining combat points
stalemate
mutual elimination
match winner
```

不得继续出现旧：

```text
Shooter killed
Shot cancelled
New Shooter selected
```

语义。

---

# 23. UI/UX

完成可实际操作的比赛 UI。

至少包含：

```text
Match Setup
Team A Algorithm
Team B Algorithm
Arena
Fixed Emitters
Combat Points
Obstacle display
Reveal
START
Round status
Compute status
First solver
Attack trajectory
Kills
Alive combat count
Round result
Match result
Replay
```

---

# 24. Judge Console

Judge 应能够：

```text
create/load match
load Team A/B algorithms
validate both algorithms
show readiness
reveal hidden round information
press START
observe compute state
observe attacks
advance rounds
see match termination
open replay/audit
```

不得要求 Judge 使用开发 CLI 完成正常赛事操作。

---

# 25. Audience Screen

制作适合现场展示的 spectator view。

重点：

```text
large arena
team identification
fixed emitter
combat points
trajectory animation
current round
alive count
first solver
winner/result
```

隐藏：

```text
developer diagnostics
filesystem paths
raw JSON
internal stack traces
```

---

# 26. Team Interface

因为 Shooter 不再由玩家选择：

Team 端不再需要每 Round Shooter controller。

简化为：

```text
Algorithm installed
Team ready
Match status
```

如果已有 Shooter Selection UI：

删除、禁用或改造成只读 Fixed Emitter 展示。

---

# 27. Error UX

正式 UI 至少能清楚表达：

```text
INVALID
TIMEOUT
CRASH
algorithm not ready
bad result
match setup error
```

不要只在 terminal 看错误。

---

# 28. Development Testing Policy

开发过程中采用 change-impact testing。

如果没有修改 Timing：

```text
不要每阶段重跑完整 timing-fairness matrix
```

如果没有修改 Sandbox：

```text
不要每阶段重跑超长 cross-round-cheat
```

如果没有修改 DSL：

```text
不要重复完整 DSL stress
```

每阶段只运行：

```text
targeted tests
+
small smoke match set
```

---

# 29. Internal Checkpoints

每个大阶段完成后记录：

```text
changes
targeted tests
known findings
risk
```

但如果没有重大 blocker：

```text
DO NOT STOP FOR USER
```

自动进入下一阶段。

---

# 30. Development Log

继续维护完整：

```text
docs/development_log.md
```

至少记录：

```text
目标
修改
理由
文件变化
测试
问题
风险
下一步
```

---

# 31. Final Full Regression

只有当所有开发阶段完成后，统一运行一次完整验证：

```text
typecheck
full regression
algorithm-slot
input protocol
runner isolation
cross-round state
timing fairness
DSL
boundary
obstacle
locked attack
fixed emitter
mutual elimination
stalemate
replay
audit
UI smoke/E2E
```

目标：

```text
ALL REQUIRED SUITES PASS
```

---

# 32. Final Playtest

最终 Release Candidate 再进行完整 playtest。

至少使用：

```text
Fast
Optimizer
Hybrid
```

以及：

```text
multiple maps
A/B swap
6v6
8v8
10v10
different obstacle configurations
```

统计：

```text
wins
draws
timeouts
invalids
match length
no-progress
first solver
kills per attack
multi-kill
mutual elimination
stalemate
```

---

# 33. Tournament Rehearsal

至少执行一场完整模拟赛事：

```text
clean launch
→ load algorithms
→ validation
→ match setup
→ reveal
→ START
→ multiple rounds
→ termination
→ replay
→ audit
→ reset
→ next match
```

验证不需要开发者介入正常流程。

---

# 34. Release Candidate

全部完成后形成：

```text
V1.1 RELEASE CANDIDATE
```

记录：

```text
RC SHA
Rule SHA
Competitor Kit SHA
UI SHA
test results
playtest results
known nonblocking limitations
```

不得自行创建或移动：

```text
v1.1.0-competition
```

---

# 35. Final Deliverables

生成：

```text
Plans/Output/V1.1 Completion Wave Report.md
```

以及：

```text
Plans/Output/V1.1 Release Candidate Handoff.md
```

报告必须明确：

```text
What changed
Revision 3 final rules
500ms timing decision
Stalemate decision
Platform fixes
Competitor Kit
UI/UX
Tournament operations
Full regression
Final playtest
Known limitations
Release Candidate SHA
```

---

# 36. Final State

如果所有 Completion Wave 工作完成：

```text
GEOMETRY BATTLE V1.1 COMPLETION WAVE COMPLETE
RELEASE CANDIDATE READY
READY FOR FINAL COMPETITION READINESS AUDIT
```

不得自行宣布：

```text
TOURNAMENT READY
```

最终 Tournament Ready 必须由下一轮 Fresh Independent Auditor 裁决。