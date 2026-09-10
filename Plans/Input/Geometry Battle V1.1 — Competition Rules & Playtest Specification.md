# Geometry Battle V1.1 — Competition Rules & Playtest Specification

## 0. 文档地位

本文档定义 Geometry Battle V1.1 当前正式玩法与算法竞赛规则。

后续：

- 平台开发；
- Competitor Kit；
- Algorithm Solver；
- Playtest Harness；
- UI / UX；
- Replay / Audit；

均不得擅自改变本文已经标记为 **FROZEN** 的规则。

若测试发现规则存在平衡性问题：

> 先记录证据并进行 Counterfactual Experiment，不得直接修改正式规则。

---

# 1. 比赛目标

Geometry Battle 是一个二维平面上的算法对抗比赛。

双方分别控制一组点：

```text
Team A
Team B
```

每轮由人类选择一个存活点作为：

```text
Shooter
```

随后双方冻结后的算法根据当前地图状态生成一条攻击函数：

\[
y=f(x)
\]

算法计算更快的一方获得先攻击机会。

攻击轨迹可以：

- 命中敌方点；
- 一次命中多个敌人；
- 被障碍阻挡；
- 离开竞技场后终止；
- 优先击杀对方 Shooter。

最终目标：

> 消灭对方全部存活点。

---

# 2. 标准比赛规模

每队：

\[
6\le N\le10
\]

标准推荐：

```text
8 vs 8
```

Team A 位于 y 轴左侧：

\[
x<0
\]

Team B 位于 y 轴右侧：

\[
x>0
\]

推荐标准竞技场：

\[
x\in[-20,20]
\]

\[
y\in[-12,12]
\]

实际比赛地图范围由：

```text
public_state.json
```

提供。

算法不得写死标准范围。

---

# 3. Point

每个 Point 至少具有：

```text
id
team
x
y
alive
```

例如：

```text
A1
A2
...
B1
B2
...
```

死亡 Point：

```text
alive = false
```

仍保留在公开 Round State 中。

死亡 Point：

- 不能成为 Shooter；
- 不能再次被击杀；
- 坐标仍属于公开地图信息。

---

# 4. 人类与算法的职责分离

Geometry Battle 中：

## Human

每轮只负责：

```text
Choose Shooter
```

人类不能：

- 手动画函数；
- 修改算法参数；
- 在 Round 内实时干预算法；
- 根据 Reveal 后的信息重新选择 Shooter。

---

## Algorithm

负责：

> 根据完整 Round State 自动生成攻击函数。

算法不能：

- 选择 Shooter；
- 修改地图；
- 修改障碍；
- 判断正式 Winner；
- 自行声明 Hit；
- 自行决定先手。

---

# 5. Round 信息阶段

每轮严格分为：

```text
PUBLIC
↓
SHOOTER LOCK
↓
REVEAL
↓
START
↓
COMPUTE
↓
RESOLVE
```

---

# 6. PUBLIC 阶段

平台生成：

```text
public_state.json
```

其中包含当前所有公开信息，例如：

```text
match
round
arena
points
alive/dead state
```

PUBLIC State 不得包含：

```text
Shooter
obstacles
real hidden map seed
future Round information
Judge result
```

---

# 7. Shooter Selection

Team A 与 Team B 分别秘密选择：

```text
one alive Point
```

作为当前 Round Shooter。

双方：

```text
LOCK
```

后不得修改。

Team A 在选择期间不能知道 Team B 的选择。

Team B 同理。

---

# 8. REVEAL

双方完成 Lock 后：

```text
REVEAL
```

同时公开：

```text
Team A Shooter
Team B Shooter
Round Obstacles
```

并生成：

```text
reveal_state.json
```

Reveal State 是 Public State 的增量，而不是完整重复。

---

# 9. Public / Reveal Binding

`reveal_state.json` 必须与对应的：

```text
public_state.json
```

绑定。

当前协议使用：

```text
public_state_sha256
```

避免不同 Round 的两份输入被错误组合。

---

# 10. 双方算法输入必须相同

正式要求：

```text
A/public_state.json
==
B/public_state.json
```

以及：

```text
A/reveal_state.json
==
B/reveal_state.json
```

应达到字节级一致。

Team Identity 不得通过修改 JSON 提供。

---

# 11. Team Identity

算法通过独立启动参数获得：

```text
--team A
```

或：

```text
--team B
```

因此：

```text
JSON identical
+
Team argument different
```

---

# 12. START Gate

Reveal 后算法仍不得运行。

正式流程：

```text
PUBLIC READY
→ algorithm NOT running

REVEAL READY
→ algorithm NOT running

Judge presses START
→ algorithm released
```

因此：

> START 是正式计算门禁。

---

# 13. 禁止 Preprocessing

正式 Round 数据不能在 START 前交给正在运行的参赛代码进行预计算。

允许平台提前准备：

```text
Sandbox
Trusted Runner
Input Files
```

但不得提前执行：

```text
solver.py
participant modules
participant executable code
```

---

# 14. 同时启动定义

计算机无法保证两个进程在完全相同的物理纳秒执行。

因此赛事意义上的：

```text
SIMULTANEOUS START
```

定义为：

> Team A 和 Team B 均由同一个正式 GO Event 触发释放。

不得人为：

```text
先完整启动 A
再完整启动 B
```

形成明显结构性起跑优势。

---

# 15. 正式计时

每方计算时间从：

> 自己的正式 release / GO delivery 起点

开始计算。

到：

> 该算法正式有效结果完成

结束。

形式上：

\[
T_A=t_{result,A}-t_{start,A}
\]

\[
T_B=t_{result,B}-t_{start,B}
\]

不得使用虚构的“完全相同纳秒共享时间戳”替代真实各自起点。

---

# 16. 计算时间上限

当前正式：

\[
\boxed{2000\text{ ms}}
\]

算法超过时间：

```text
TIMEOUT
```

本 Round 不产生有效攻击。

---

# 17. 近似同时完成

平台保留：

```text
TIE_EPS_MS
```

用于处理极小的计时差。

当前实现基线：

```text
0.05 ms
```

即：

\[
50\mu s
\]

不得通过算法或测试代码擅自修改。

---

# 18. Algorithm Entrypoint

正式算法入口：

```text
solver.py
```

两支算法均使用相同启动协议。

算法通过：

```text
--team
--public
--reveal
--output
```

获得正式运行参数。

具体接口格式以：

```text
competitor-kit/
```

为技术权威。

---

# 19. Algorithm IPC

平台与算法之间的正式数据传输使用 JSON 文件。

输入：

```text
public_state.json
reveal_state.json
```

输出：

```text
result.json
```

stdout 不作为正式结果通道。

---

# 20. Fresh Round Execution

每 Round 使用新的算法执行环境。

禁止：

```text
cross-round memory
cross-round cache
persistent daemon
background service
hidden filesystem state
```

算法不得依赖前一 Round 的运行状态。

---

# 21. Frozen Algorithm

正式 Match 开始以后：

算法 Package 必须冻结。

比赛期间不得：

```text
修改代码
替换算法
更新参数文件
修改 sealed package
```

正式算法 Package 应具有 Hash 用于审计。

---

# 22. Attack Function

算法必须返回单值函数：

\[
\boxed{y=f(x)}
\]

不是：

```text
target point
polyline
path array
piecewise route
program callback
```

Judge 根据函数本身完成攻击判定。

---

# 23. Shooter Constraint

若 Shooter 为：

\[
S=(x_s,y_s)
\]

则攻击函数必须满足：

\[
f(x_s)=y_s
\]

当前 Shooter pass-through 数值容差：

\[
\boxed{|f(x_s)-y_s|\le10^{-6}}
\]

否则：

```text
INVALID SHOT
```

---

# 24. Attack Direction

Team A：

> 从左向右传播。

即：

\[
x\ge x_s
\]

Team B：

> 从右向左传播。

即：

\[
x\le x_s
\]

算法不得通过 piecewise 条件自行模拟方向。

方向由 Judge 处理。

---

# 25. Function Representation

正式函数通过官方：

```text
JSON DSL / AST
```

表示。

不得提交：

```text
Python source string
lambda
eval expression
arbitrary executable code
```

---

# 26. DSL Complexity

当前冻结限制：

\[
\boxed{\text{AST Nodes}\le128}
\]

\[
\boxed{\text{AST Depth}\le12}
\]

超出：

```text
INVALID SHOT
```

---

# 27. Function Smoothness

攻击函数必须满足当前正式：

```text
C²
```

要求。

即有效攻击域内至少需要：

- 连续；
- 一阶导连续；
- 二阶导连续；

不得利用：

```text
jump
corner
hidden discontinuity
piecewise switching
```

形成非法轨迹。

---

# 28. 非有限数禁止

有效攻击域内不得出现：

```text
NaN
Infinity
-Infinity
Complex
Undefined
Singularity
```

---

# 29. Piecewise 禁止

单次攻击必须是一个统一数学函数。

不得通过：

```text
if
else
Piecewise
Boolean condition
step
switch
```

等方式构造不同区间使用不同函数的攻击。

具体允许 Operator 以：

```text
competitor-kit/DSL_SPECIFICATION.md
```

为准。

---

# 30. Convexity Change Limit

当前正式限制：

\[
\boxed{
N_{\text{convexity-change}}\le100
}
\]

目的是允许：

- polynomial；
- trigonometric；
- composite；
- Fourier-like；

等复杂函数，

同时防止利用极高频振荡近似覆盖整个二维区域。

---

# 31. Hit

敌方 Point 与攻击函数在正式数值判定容差内相交：

```text
HIT
```

Judge 使用数学曲线进行判定。

UI 可视线宽：

> 不得决定 Hit。

即：

```text
visual stroke ≠ collision width
```

---

# 32. Multiple Kill

同一条函数可以在一次攻击中命中多个敌方 Point。

例如：

```text
Shooter
↓
Enemy 1
↓
Enemy 2
↓
Enemy 3
```

若期间没有先遇到攻击终止条件：

```text
3 kills
```

均可以成立。

---

# 33. Obstacles

障碍物是正式数学碰撞对象。

当攻击轨迹第一次与障碍物发生正式交点：

```text
ATTACK TERMINATES
```

位于该交点之后的敌方 Point：

```text
NOT HIT
```

即使数学函数继续延伸。

---

# 34. Arena Boundary

攻击只能在当前竞技场有效区域内传播。

第一次离开 Arena：

```text
ATTACK TERMINATES PERMANENTLY
```

例如标准 Arena：

\[
y\in[-12,12]
\]

如果轨迹首次满足：

\[
y>12
\]

或：

\[
y<-12
\]

则攻击立即终止。

即使同一个数学函数之后重新进入：

\[
[-12,12]
\]

攻击也不会恢复。

---

# 35. First Stop Rule

攻击沿正式传播方向前进时，最早发生的停止事件决定攻击终点。

主要停止条件：

```text
first obstacle intersection
OR
first arena boundary exit
OR
normal attack-domain end
```

因此：

```text
enemy before stop
→ may be hit

enemy after stop
→ cannot be hit
```

---

# 36. First Solver

双方算法返回合法结果后：

计算时间更短的一方：

```text
FIRST SOLVER
```

获得先攻击机会。

只有：

```text
VALID RESULT
```

才能参与先手比较。

INVALID / TIMEOUT 不获得有效先手攻击。

---

# 37. Shooter Elimination

对方当前 Round Shooter：

> 仍然是正常可攻击敌方 Point。

因此可以主动设计：

```text
Shooter assassination
```

---

# 38. Shot Cancellation

当前正式规则 **FROZEN FOR PLAYTEST**：

如果 First Solver 的攻击在后方攻击执行前：

```text
kills opponent Shooter
```

则对方当前 Round：

```text
SHOT CANCELLED
```

其已计算或正在计算的攻击：

```text
does not execute
```

---

# 39. Cancellation 的地位

该规则当前仍为正式规则。

但第一轮 Algorithm Playtest 已发现：

```text
Fast Solver
+
Shooter assassination
+
first-shot advantage
```

可能形成非常强的策略优势。

因此：

> Shooter cancellation 当前进入 BALANCE REVIEW，但尚未修改。

后续可通过：

```text
CF-NO-CANCEL
CF-SIMULTANEOUS
Hybrid Solver
```

进行 Counterfactual Experiment。

实验不得自动改变正式规则。

---

# 40. Round Snapshot Immutable

START 后：

```text
Public State
Reveal State
Shooters
Obstacles
Alive State
```

均冻结。

如果 First Shot 改变了战场：

后手算法不得获得新 JSON 重新计算。

---

# 41. No Re-computation

例如：

```text
A shoots first
↓
kills B4
```

如果 B 的 Shooter 仍然存活：

B 的攻击仍然基于 START 时的原始 Round Snapshot。

B 不重新计算。

---

# 42. Round Result

Judge 根据：

```text
First Shot
Second Shot / Cancellation
Kills
Alive State
```

得到 Round Result。

UI 只负责展示。

Visualizer 不得参与正式判定。

---

# 43. Match Win

当前基本胜利条件：

如果一方：

```text
alive = 0
```

则另一方：

```text
MATCH WINNER
```

---

# 44. Stalemate — 当前状态

当前正式版本：

> 尚未冻结新的 Stalemate / Round Limit 规则。

此前讨论过：

```text
12 consecutive no-progress rounds
100 total rounds
```

但目前它们只是：

```text
PROPOSED
```

而不是：

```text
FROZEN RULE
```

不得提前写入正式 Judge。

---

# 45. 为什么暂不冻结 Stalemate

此前已经观察到：

> 某些算法组合可能出现数百 Round 无法自然结束。

因此 Stalemate 是真实问题。

但阈值必须优先根据 Algorithm Playtest 数据决定。

需要收集：

```text
match length
no-progress streak
P50
P75
P90
P95
P99
maximum
```

再冻结规则。

---

# 46. No-progress 定义候选

后续若实施 Stalemate，推荐候选定义：

如果某 Round：

```text
Team A kills = 0
AND
Team B kills = 0
```

则：

```text
NoProgressStreak += 1
```

如果任意一方产生至少一个 Kill：

```text
NoProgressStreak = 0
```

但具体阈值尚未冻结。

---

# 47. Sandbox

算法运行必须隔离。

正式 Sandbox 应限制：

```text
network access
other competitor files
Judge/project internals
host filesystem
persistent cross-round state
background process survival
timing metadata manipulation
```

具体技术能力以正式平台为准。

---

# 48. Runtime

所有队伍使用同一冻结 Runtime。

当前公开 Runtime 以：

```text
competitor-kit/RUNTIME_MANIFEST.md
```

为唯一参赛者技术权威。

不得根据宿主开发机可安装的软件推断正式 Sandbox 可用。

---

# 49. AI Usage

Geometry Battle 是：

```text
Algorithm Vibecoding Competition
```

允许赛前使用：

```text
ChatGPT
Claude
Codex
Copilot
other development AI
```

帮助开发算法。

但正式 Match：

```text
Frozen Algorithm Only
```

不得实时访问 AI 服务。

---

# 50. 网络

正式比赛算法不得使用：

```text
Internet
HTTP
API
LLM API
remote server
```

---

# 51. Judge Authority

正式比赛以下结果均由 Judge 决定：

```text
function validity
timing
first solver
obstacle intersection
arena exit
hit
kill
shot cancellation
round result
match result
```

算法自己的预测不具有裁判效力。

---

# 52. Replay / Audit

正式比赛应保存足够数据复核：

```text
public state
reveal state
hashes
algorithm package hashes
timing
result DSL
Judge result
Round result
Match result
```

Replay：

> 重现 Judge 已确定的比赛结果。

不得重新依赖 UI 碰撞得到不同结果。

---

# 53. UI Independence

Audience UI：

```text
DISPLAY ONLY
```

它不能决定：

```text
Hit
Kill
Winner
Timing
```

动画必须根据正式 Judge Result 进行回放。

---

# 54. 当前 Playtest 已冻结规则

以下内容在下一轮 Balance Playtest 前不得改变：

```text
2000 ms timeout
TIE_EPS_MS
public → reveal → START
no preprocessing
same A/B JSON
own official timing anchor
single y=f(x)
Shooter pass-through
attack direction
DSL operators
AST 128
Depth 12
C²
Convexity <=100
Obstacle stop
Arena boundary stop
First Solver
Shooter assassination
Shot cancellation
Immutable Round snapshot
```

---

# 55. 当前允许实验但不改变正式规则的项目

Playtest Harness 可以单独实现：

```text
CF-NO-CANCEL
CF-SIMULTANEOUS
```

用于回答：

```text
Shooter cancellation effect
speed effect
```

这些实验结果：

> 不得被记录为正式比赛结果。

---

# 56. 下一阶段算法平衡测试

当前已有：

```text
Fast Tactical Solver
Optimization Solver
```

下一阶段新增：

```text
Hybrid Tactical-First Anytime Optimizer
```

核心实验：

```text
Fast vs Optimizer
Fast vs Hybrid
Optimizer vs Hybrid
```

必须进行：

```text
A/B slot swap
```

排除位置或 Runner slot 偏差。

---

# 57. Rule Health 评估目标

下一轮 Playtest 需要判断当前比赛属于：

```text
HEALTHY
TACTICALLY ADAPTIVE
SPEED-DOMINATED
CANCELLATION-DOMINATED
STRUCTURALLY COLLAPSED
```

这些是测试结论类别，

不是提前假定的结论。

---

# 58. 修改规则的证据门槛

不得因为：

```text
一个算法输得很多
```

就直接修改核心规则。

至少需要区分：

```text
algorithm weakness
```

与：

```text
rule structural weakness
```

例如：

如果 Hybrid 能明显挑战 Fast：

> 说明算法可以适应 meta。

如果所有优化方案都必须退化为：

```text
fastest possible Shooter kill
```

才能竞争，

才说明规则可能出现：

```text
strategy collapse
```

---

# 59. Rule Change Procedure

任何未来正式规则修改必须经过：

```text
Playtest Finding
↓
Counterfactual Experiment
↓
Evidence
↓
Human Decision
↓
Rule Specification Update
↓
Implementation
↓
Regression
↓
Independent Re-Gate
```

不得：

```text
Agent发现问题
↓
Agent直接改规则
```

---

# 60. 当前版本定位

当前规则版本：

```text
Geometry Battle V1.1
PLAYTEST RULE BASELINE
```

用途：

```text
Algorithm development
Algorithm balance testing
Controlled matches
UI development reference
```

在完成：

```text
Shooter cancellation balance review
Stalemate threshold review
remaining interface/platform re-gate
```

之前，

不要将 V1.1 Playtest Baseline 宣称为新的最终：

```text
v1.1.0-competition
```

---

# 61. 一句话规则摘要

Geometry Battle 的核心是：

> 两名玩家先秘密选择 Shooter，地图随后揭盲；裁判发出 START 后，两支冻结算法同时开始，根据相同 Round JSON 独立生成一条合法 \(y=f(x)\) 攻击曲线。更快返回合法函数的一方先攻击，轨迹沿己方攻击方向传播，可连续击杀多个敌人，但遇到第一个障碍物或离开 Arena 后永久停止；如果先手在后手攻击执行前击杀其 Shooter，后手本轮攻击取消。所有判定由 Judge 完成，算法只能决定函数本身。

---

# 62. 当前明确未冻结事项

以下问题必须保持：

```text
OPEN FOR PLAYTEST EVIDENCE
```

而不是让 Agent 自行决定：

1. Shooter cancellation 是否需要修改；
2. 速度先手是否奖励过强；
3. 是否采用 Stalemate；
4. Stalemate 连续无进展阈值；
5. Match hard round limit；
6. 是否需要扩大正式 Runtime；
7. 是否需要新的 DSL Operator。

这些问题只能在后续测试后由人决定。