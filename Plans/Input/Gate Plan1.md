# Geometry Battle V1 — Final Competition Readiness Re-Gate

项目路径：

```text
/Users/jiayihuang/Downloads/几何斗殴/
```

当前状态：

```text
V1 FEATURE COMPLETE
```

本轮任务不是继续开发功能，而是对现有 V1 做一次独立的正式比赛就绪审核。

## 核心原则

本轮默认 **READ-ONLY AUDIT**。

除非为了运行测试必须生成临时文件，否则：

- 不修改生产代码；
- 不重构；
- 不优化；
- 不新增功能；
- 不修改规则；
- 不改变配置以让测试“通过”；
- 不修复发现的问题。

如果发现问题，只记录证据、严重程度和建议修复方向。

审核结束后再由下一轮开发任务处理。

---

# 1. 首先确认仓库状态

记录：

```text
Current branch
HEAD SHA
git status
modified/untracked files
```

如果目录不是 Git 仓库，也明确记录。

确认：

- 工作区是否 clean；
- 当前实际审核的是哪个版本；
- `dist/` 与源码是否对应当前版本；
- 是否存在未提交但影响运行的代码或配置。

最终报告必须写出明确的审计基线。

---

# 2. 读取现有设计和实现

检查：

```text
README.md
Plans/
src/
starter/
package configuration
test configuration
runner configuration
```

重点确认现有实现与 V1 规则一致，而不是只相信 README 或开发摘要。

当前声称已经完成：

- DSL/AST parser
- AST evaluator
- C² continuity validation
- convexity-change validation ≤100
- AST nodes ≤128
- AST depth ≤12
- obstacle collision
- 17-stage Round state machine
- 2000ms compute timeout
- deterministic map generator
- Algorithm Runner
- MatchLog
- AuditLog
- UI

这些都需要基于代码和实际运行重新确认。

---

# 3. 不要只重复已有单元测试

本轮重点不是：

```text
tests pass
```

而是：

> 这些模块连接到完整正式比赛流程以后是否仍然正确。

优先进行 integration / end-to-end verification。

已有单元测试可以运行，但不能作为唯一 PASS 证据。

---

# 4. Function / DSL Re-Gate

验证至少包括：

## 合法情况

- linear function
- quadratic / polynomial
- trigonometric
- composite function
- Fourier-style finite expression
- function through shooter
- near AST complexity limit
- exactly 100 convexity changes

## 非法情况

- malformed DSL
- unsupported operator
- AST Nodes = 129
- AST Depth = 13
- convexity changes = 101
- discontinuous function
- non-C² function
- NaN
- Infinity
- undefined numerical result
- function not passing through Shooter
- piecewise / hidden conditional behavior if DSL prohibits it

确认：

```text
INVALID function
```

只能产生一次：

```text
INVALID_SHOT
```

不能允许算法重新提交第二次答案。

---

# 5. Judge / Collision Re-Gate

确认 Judge 是比赛唯一 Source of Truth。

验证：

### Point hit

- single hit
- multi-hit
- zero hit

### Obstacles

- obstacle before enemy
- obstacle after enemy
- multiple obstacles
- first obstacle correctly terminates attack
- enemy behind obstacle survives

### Direction

Team A：

```text
left → right
```

Team B：

```text
right → left
```

确认函数另一方向的延伸不会造成击杀。

### Numerical consistency

确认：

- Hit tolerance 仅用于数值误差；
- Visual line width 不参与命中；
- UI/Canvas 不参与碰撞；
- Judge 使用完整精度。

---

# 6. Canonical AST 一致性

检查数据流是否类似：

```text
Algorithm DSL
    ↓
parse once
    ↓
Canonical AST
    ├── Judge
    └── Visualizer
```

重点检查是否存在：

```text
Judge 使用一种 parser/evaluator
Frontend 又独立解析一遍 DSL
```

如果存在两套数学解释实现，需要标记风险。

Visualizer 可以为了绘制进行采样，但不能重新决定：

- Hit
- obstacle collision
- kill order

这些结果必须来自 Judge。

---

# 7. Algorithm Upload / Submission Flow

不要只使用项目自带 starter algorithm。

创建或使用两份**此前没有硬编码进系统的独立测试算法包**。

通过正式用户流程测试：

```text
Upload Team A
Upload Team B
↓
Package validation
↓
Entrypoint validation
↓
Preflight
↓
READY
```

确认无需：

- 修改源码；
- 修改 JSON；
- 手工复制文件进入特定目录；
- DevTools 改状态；
- CLI 手工注入比赛数据。

如果目前平台并不存在真正的上传能力，而只是读取固定路径，必须明确指出。

检查：

- invalid ZIP/package
- missing entrypoint
- syntax error
- runtime error
- invalid DSL output
- package replacement
- hash regeneration

---

# 8. Algorithm Package Hash

确认算法经过 Preflight 后有稳定的：

```text
SHA-256
```

并且 MatchLog 中记录：

```text
Team A package hash
Team B package hash
```

比赛开始后，不应该能在不重新验证的情况下替换算法。

---

# 9. Runner Isolation — 本轮最高优先级之一

当前摘要称：

```text
Algorithm Runner ✅ Python subprocess
```

不要因此直接判定隔离已经成立。

确认 subprocess 到底能够访问什么。

尝试设计安全测试算法检查：

### Filesystem

算法是否能够：

- 写 `/tmp`
- 写项目目录
- 写 home
- 读取其他 Team algorithm
- 读取 Judge source/config
- 读取上一 Round 保存的数据

### Process

算法是否能够：

- spawn child process
- 留下 background process
- Round 结束后继续运行

### Network

算法是否能够访问外部网络或本地网络接口。

### Environment

算法是否能够读取不应该获得的：

- secrets
- internal paths
- hidden match information
- environment variables

如果当前系统只是：

```python
subprocess.Popen(...)
```

+ timeout，

但没有真正的 sandbox/security boundary，

不要把这一项判为 PASS。

请区分：

```text
Runner works
```

和：

```text
Runner isolation verified
```

---

# 10. Cross-Round State / No Preprocessing

这是正式比赛公平性的核心要求。

设计一个专门尝试作弊的算法：

Round 1：

```text
尝试保存数据
```

Round 2：

```text
尝试读取 Round 1 保存的数据
```

测试可能渠道：

- file
- /tmp
- environment
- parent/child process
- daemon
- module/global state
- local socket
- shared memory（若环境允许）

V1 要求：

```text
Round N end
↓
algorithm environment destroyed
↓
Round N+1
fresh environment
```

如果存在可重复利用的跨 Round 状态：

```text
FAIL / CONDITIONAL
```

不能忽略。

---

# 11. RoundState Equality

在同一个 Round 内确认：

```text
Team A input
==
Team B input
```

要求尽量验证到：

```text
serialized bytes or canonical hash identical
```

并检查双方日志记录：

```text
same RoundState hash
```

Team 身份如果由 Runner slot 提供，不应为了 A/B 修改公共 RoundState 内容。

记录实际结果。

---

# 12. Simultaneous Start

检查真实执行路径：

```text
A Runner READY
B Runner READY
↓
barrier
↓
release both
```

测量：

```text
start skew
```

不要只看状态机逻辑。

运行多次，例如至少：

```text
100 rounds
```

统计：

- min
- median
- p95
- max

如果原目标为 ≤1ms，但真实环境无法做到，不要硬判失败。

需要报告实际分布并判断：

> 是否足以对正式比赛造成可测量的不公平。

---

# 13. Timing Definition

确认官方算法时间到底从哪里开始、哪里结束。

必须保证双方一致。

确认：

- imports 是否计时；
- initialization 是否计时；
- solve 是否计时；
- serialization 是否计时；
- DSL validation 是否计时。

至少明确实际实现。

不要让 A/B 使用不同的计时路径。

---

# 14. 2000ms Timeout

验证：

```text
1990ms result → accepted
>2000ms → timeout
```

以及：

```text
infinite loop
sleep
child process
```

是否能被可靠终止。

Round 结束后确认不存在遗留进程。

---

# 15. First Solver Ordering

构造两个已知耗时的算法，例如：

```text
A ≈100ms
B ≈300ms
```

确认：

```text
A fires first
```

再反转：

```text
A ≈300ms
B ≈100ms
```

确认：

```text
B fires first
```

然后测试接近情况。

Judge 必须使用内部高精度结果，而不是 UI 四舍五入后的时间决定顺序。

---

# 16. Shooter Elimination

专门构造场景：

```text
A solves first
↓
A trajectory kills B shooter
↓
B has not fired
```

预期：

```text
B SHOOTER ELIMINATED
B SHOT CANCELLED
```

确认：

- B Runner 被终止；
- 不再等待完整 2000ms；
- B 本 Round 不产生攻击；
- Round 正常继续；
- MatchLog 正确记录 cancellation。

---

# 17. 17-Stage Round State Machine Integration

不要只验证状态对象能手动 transition。

完整真实运行至少一轮：

```text
ROUND INTRO
→ SELECT
→ LOCK
→ WAITING
→ START
→ COUNTDOWN
→ REVEAL
→ COMPUTE
→ FIRST RESULT
→ FIRST SHOT
→ SECOND RESULT / CANCEL
→ SECOND SHOT
→ ROUND RESULT
→ WAITING
→ NEXT ROUND
```

根据项目实际 17 个状态逐一核对。

确认不存在：

- unreachable state
- skipped mandatory state
- illegal transition
- deadlock
- auto-start next Round

---

# 18. Human Shooter Selection

确认：

- 人工选择；
- A/B 独立；
- 对方在 Reveal 前不可看到选择；
- dead point 不可选择；
- Lock 后不可修改；
- 双方 Lock 后仍需等待 Judge；
- 不自动 START ROUND。

---

# 19. Manual Judge Control

确认至少：

```text
START ROUND
NEXT ROUND
PAUSE / RESUME（若 V1 已实现）
END MATCH
```

符合规则。

特别确认：

```text
双方 READY
```

不会自动触发 Round。

现场必须能够由主持人控制：

```text
ROUND N
3
2
1
START
```

---

# 20. Map Generator Re-Gate

当前报告：

```text
3000 / 3000 passed
```

本轮重新独立验证。

至少确认：

- deterministic seed
- same seed → same map
- 6 vs 6
- 7 vs 7
- 8 vs 8
- 9 vs 9
- 10 vs 10
- equal Team counts
- coordinates inside legal range
- no illegal spawn
- minimum point distance
- no spawn inside obstacle
- Generator cannot hang/crash

如果方便，再运行一批新的 seeds，不要只重复原测试集合。

---

# 21. Full Match — 最关键 E2E

从**干净启动平台**开始。

使用两份独立算法包。

完整执行：

```text
launch platform
↓
upload A
↓
upload B
↓
preflight
↓
generate/load map
↓
START MATCH
↓
human shooter selection
↓
A/B LOCK
↓
manual START ROUND
↓
Reveal
↓
Compute
↓
Shot
↓
Round result
↓
manual NEXT ROUND
↓
...
↓
one team reaches 0 alive
↓
WINNER
```

全过程禁止：

- 修改源码；
- 修改内部 JSON；
- 修改数据库；
- DevTools 强改 state；
- CLI 注入比赛结果；
- 手工跳 state；
- 重启某个模块来逃过 Bug。

这场比赛必须真正完成到 Winner。

---

# 22. Audience UI

确认正式 Audience View 至少能正确表现：

- ROUND N
- all alive points
- point IDs
- shooter
- obstacles
- A/B computing
- compute time
- function expression
- trajectory
- hits
- shooter elimination
- remaining points
- round result
- winner

如果当前所谓：

```text
UI ✅ Console 渲染
```

实际只是开发 Console，而不是可以用于投影的大屏界面，

必须明确指出：

```text
UI infrastructure exists
but competition audience UI not complete
```

不要因为“组件能 render”就自动给 V1 Competition UI PASS。

---

# 23. Function Animation

检查：

- 从 Shooter 开始；
- 沿函数逐渐延长；
- 不瞬间出现整条曲线；
- 速度具有比赛观感；
- 约数百毫秒而非几秒；
- Team A / B 方向正确；
- Hit 按传播顺序出现；
- obstacle 处停止；
- Judge 已经确定结果后才播放。

Animation 不得反过来决定 Judge Result。

---

# 24. Replay

完整比赛结束后：

```text
close / restart platform
```

然后：

```text
load replay
```

不得重新运行任何 Team algorithm。

检查：

- Round 数量；
- Shooter；
- function；
- timing；
- hit order；
- obstacle stop；
- cancellations；
- winner；

与原正式比赛一致。

Replay 必须基于已记录结果。

---

# 25. MatchLog / AuditLog

检查至少包含：

### MatchLog

- match ID
- map seed
- Team A algorithm hash
- Team B algorithm hash
- each Round state hash
- shooters
- functions / function hash
- execution times
- hits
- cancellation
- timeout / invalid
- final result

### AuditLog

- algorithm upload
- replacement
- validation
- match start
- judge actions
- restart/pause if applicable
- platform error
- match end

检查日志不是“有类定义但实际正式 Match 没写进去”。

---

# 26. Restart / Clean State

完整比赛后关闭平台。

重新打开。

开始第二场全新 Match。

确认上一场比赛不会污染：

- points
- shooters
- Runner
- Round state
- cache
- algorithm output
- UI
- timers

---

# 27. Source vs dist

项目存在：

```text
src/
dist/
```

确认真正运行的正式比赛版本对应当前源码。

避免出现：

```text
src fixed
dist stale
```

或者：

```text
tests run against src
competition executes old dist
```

---

# 28. Documentation Check

最后检查：

```text
README.md
starter/
Plans/
```

是否与真实 V1 一致。

重点：

- algorithm input
- algorithm output
- DSL rules
- timeout
- package structure
- shooter rules
- no preprocessing
- function limits
- how to run local starter
- how operator starts a match

文档错误不一定阻止平台运行，但正式比赛前必须标记。

---

# 29. 最终裁决标准

最终只能给出以下三种之一：

## PASS — COMPETITION READY

只有当：

- 完整 E2E Match 成功；
- Runner fairness 成立；
- 无跨 Round state；
- 双方输入一致；
- Judge 稳定；
- UI 达到实际比赛需要；
- Replay 可复现；
- 没有阻断正式比赛的 P0/P1 问题；

才允许给 PASS。

---

## CONDITIONAL PASS

核心比赛能够完成，但存在不阻止内部测试、却不适合直接正式比赛的风险。

例如：

```text
subprocess runner works
but sandbox isolation incomplete
```

或者：

```text
core match works
but audience UI still console-only
```

必须列出解除 Conditional 所需的最小修复项。

---

## FAIL

存在会导致：

- 比赛无法完成；
- 明显不公平；
- 可以跨 Round 预计算；
- Runner 相互污染；
- Judge 结果错误；
- Replay 无法可信复现；

的问题。

---

# 30. Severity

所有发现分为：

### P0 — Blocker

比赛不能正式举办。

### P1 — Competition Critical

可能改变胜负、公平性或比赛完整性。

### P2 — Important

不直接改变胜负，但影响可靠性、操作或可复核性。

### P3 — Polish

视觉、文档或轻微体验问题。

---

# 31. 最终报告格式

最终输出：

# Geometry Battle V1 Final Re-Gate

## Verdict

```text
PASS / CONDITIONAL PASS / FAIL
```

一句话说明理由。

## Audit Baseline

```text
Branch:
HEAD:
Working Tree:
Runtime:
```

## Gate Matrix

| Gate | Result | Evidence |
|---|---|---|
| DSL / AST | PASS/FAIL | ... |
| C² | | |
| Convexity ≤100 | | |
| Complexity | | |
| Collision | | |
| Map Generator | | |
| Algorithm Upload | | |
| Runner Execution | | |
| Runner Isolation | | |
| No Cross-Round State | | |
| Equal RoundState | | |
| Simultaneous Start | | |
| Timeout | | |
| Shooter Cancellation | | |
| 17-State Integration | | |
| Human Selection | | |
| Judge Control | | |
| Audience UI | | |
| Animation | | |
| MatchLog | | |
| AuditLog | | |
| Replay | | |
| Full E2E Match | | |
| Clean Restart | | |

## Findings

按照：

```text
P0
P1
P2
P3
```

分别列出。

每个 Finding 必须包含：

```text
Problem
Evidence
Impact
Reproduction
Recommended remediation
```

## Full Match Evidence

记录完整测试 Match：

```text
Map seed:
Team A package/hash:
Team B package/hash:
Round count:
Winner:
Timeouts:
Invalid shots:
Shooter cancellations:
Replay verified:
```

## Runner Fairness Evidence

记录：

```text
RoundState equality:
Start skew:
Network isolation:
Filesystem isolation:
Process cleanup:
Cross-round persistence:
```

## Final Blocking Items

如果 PASS：

```text
None.
```

如果 Conditional / Fail：

只列真正阻止 Competition Ready 的项目。

## Recommendation

最终明确回答：

```text
Is Geometry Battle V1 safe to freeze as
v1.0.0-competition?
YES / NO
```

---

# 32. 本轮结束要求

不要修改代码来使审核结果变好。

如果发现问题：

```text
STOP
DOCUMENT
REPORT
```

即可。

现有 Stop Hook 继续有效，但本轮“没有修改代码”本身就是正确行为。

目标不是得到 PASS。

目标是得到一个可信的 V1 状态结论。