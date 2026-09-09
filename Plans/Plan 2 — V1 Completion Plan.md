# Plan 2 — V1 Completion Plan

## 0. 本阶段目标

Plan 1 已经完成函数 DSL、合法性验证、碰撞检测、Round 状态机与基础超时机制。

Plan 2 不再继续扩展数学规则，而是直接完成一个可以实际举办比赛的 **V1 正式版本**。

完成后，使用流程应当尽可能简单：

```text
准备两支队伍算法
        ↓
上传 Team A Algorithm
        ↓
上传 Team B Algorithm
        ↓
平台自动验证
        ↓
生成 / 加载比赛地图
        ↓
开始 Match
        ↓
双方人工选择 Shooter
        ↓
裁判 START ROUND
        ↓
同时揭盲
        ↓
双方算法同时计算
        ↓
输出函数
        ↓
Judge 判定
        ↓
动画播放
        ↓
下一 Round
        ↓
一方全部淘汰
        ↓
比赛结果 + Replay
```

正式比赛运行过程中**不依赖任何 AI 服务**。

AI、Codex、Claude 等工具可以用于选手赛前开发和优化算法，但正式提交物只是一个独立算法程序。

因此本项目的定位更准确地说是：

> **Algorithm Vibecoding Competition**

重点是利用 Vibecoding 快速构建、测试和优化算法，而不是比赛过程中调用 AI 模型解决题目。

---

# 1. Plan 1 冻结范围

以下能力已经完成，本阶段原则上不重新设计，只进行集成、修复和必要测试。

- `parseDSL`
- `evaluateAST`
- `checkContinuity`
- `countConvexityChanges`
- `analyzeComplexity`
- `checkObstacleCollision`
- 17 阶段 Round State Machine
- `computeTimeout = 2000ms`
- AST Nodes ≤ 128
- AST Depth ≤ 12
- Convexity Changes ≤ 100

Plan 2 必须优先复用这些实现。

除非：

- 存在明确 Bug；
- Judge 集成发现逻辑不一致；
- 性能无法满足正式比赛；

否则不得为了重构而大规模改写 Plan 1 已验证模块。

---

# 2. V1 最终系统组成

V1 最终由七个核心部分组成：

```text
                    MATCH PLATFORM
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
 Algorithm Upload     Match Controller     Audience UI
       │                   │                    │
       ▼                   ▼                    │
 Submission Validator   Round Engine            │
       │                   │                    │
       ├───────┐     ┌─────┴─────┐              │
       ▼       ▼     ▼           ▼              │
   A Runner  B Runner          Judge             │
       │       │                 │               │
       └───┬───┘                 │               │
           ▼                     │               │
      Function DSL ──────────────┤               │
                                 ▼               │
                        Collision / Hits         │
                                 │               │
                                 └───────────────►
                              Visualizer
```

七个模块分别是：

1. Algorithm Submission
2. Algorithm Runner
3. Match / Round Controller
4. Judge
5. Function Visualizer
6. Audience / Team UI
7. Replay & Audit Log

---

# 3. V1 算法提交协议

## 3.1 选手最终只提交算法

双方不负责：

- UI；
- Round 管理；
- 点的绘制；
- 动画；
- Shooter Selection；
- 碰撞判定；
- DSL 验证；
- 计时；
- Replay。

赛事平台负责以上全部功能。

选手唯一负责：

```text
Round State
     ↓
Algorithm
     ↓
Attack Function DSL
```

---

# 4. Algorithm Package

V1 建议正式统一为 ZIP Package。

例如：

```text
team-a.zip
```

内部：

```text
team-a/
├── manifest.json
├── solver.py
└── src/
    └── ...
```

最简单的算法只需要：

```text
manifest.json
solver.py
```

复杂算法可以在 `src/` 中包含自己的辅助模块。

---

# 5. manifest.json

示例：

```json
{
  "name": "Team A Solver",
  "version": "1.0",
  "entry": "solver.py",
  "language": "python"
}
```

V1 不需要：

- 作者介绍；
- AI 信息；
- 战术说明；

这些不应该进入运行协议。

---

# 6. V1 Runtime

为了避免比赛变成不同语言运行速度比较，V1 建议冻结一个 Runtime。

推荐：

```text
Python 3.x
```

具体小版本在开发完成后冻结。

允许库也必须固定。

例如：

```text
Python Standard Library
NumPy
SciPy
SymPy
```

最终实际允许哪些库，以平台正式 Runner 环境为准。

所有队伍完全相同。

不得：

```text
pip install
npm install
curl
brew
apt
```

动态安装任何依赖。

---

# 7. Algorithm Entry Contract

每支队伍必须实现统一入口。

例如：

```python
solve(round_state)
```

输入：

```text
RoundState
```

输出：

```text
Function DSL
```

不得返回：

- Shooter；
- Target ID；
- Hit List；
- Animation；
- Collision Result。

算法只负责决定：

\[
y=f(x)
\]

---

# 8. Team 身份处理

为了保持双方获得完全相同的比赛数据：

> Team A 和 Team B 的 Round State 应保持字节级一致。

Round State 内包含：

- 全部点；
- 全部队伍；
- 双方 Shooter；
- 全部障碍；
- Round Number。

算法属于 A 还是 B，由 Runner 的比赛槽位决定：

```text
Runner A → TEAM_A

Runner B → TEAM_B
```

而不是修改 Round State。

因此：

```text
RoundState_A == RoundState_B
```

应当能够成立。

---

# 9. Algorithm Upload UI

Match Setup 页面加入两个明确的上传区域。

例如：

```text
┌───────────────────────────────────────┐
│              TEAM A                   │
│                                       │
│      Drop Algorithm Package Here      │
│                                       │
│           [ Upload ZIP ]              │
│                                       │
│ Status: NOT LOADED                    │
└───────────────────────────────────────┘


┌───────────────────────────────────────┐
│              TEAM B                   │
│                                       │
│      Drop Algorithm Package Here      │
│                                       │
│           [ Upload ZIP ]              │
│                                       │
│ Status: NOT LOADED                    │
└───────────────────────────────────────┘
```

上传后立即进入 Preflight Validation。

---

# 10. Algorithm Preflight

上传算法不能直接进入比赛。

平台首先执行：

```text
UPLOAD
  ↓
Package Validation
  ↓
Manifest Validation
  ↓
Runtime Validation
  ↓
Import Test
  ↓
Sample Round Test
  ↓
DSL Validation
  ↓
Timeout Test
  ↓
READY
```

UI 显示：

```text
TEAM A

✓ Package
✓ Manifest
✓ Runtime
✓ Entrypoint
✓ Sample execution
✓ DSL output
✓ Timeout

READY
```

如果失败：

```text
TEAM A

✕ Algorithm Validation Failed

Reason:
INVALID_DSL
```

不得开始正式 Match。

---

# 11. Submission Hash

Preflight 成功后计算：

```text
SHA-256
```

例如：

```text
Team A
Algorithm Hash:
74bd9f...
```

整个 Match 中算法包不可修改。

如果重新上传：

```text
NEW HASH
```

必须重新 Preflight。

正式 Code Freeze 后，可以保存：

```text
Team Name
Package Hash
Upload Time
Runtime Version
```

作为比赛记录。

---

# 12. Runner 隔离

每支算法必须运行在独立 Sandbox。

需要隔离：

- Network
- File write
- Environment access
- Other Team files
- Judge internals
- Parent process
- System commands

允许：

```text
read Round State
run algorithm
return DSL
```

除此以外尽量禁止。

---

# 13. 跨 Round 状态禁止

每个 Round 必须创建全新运行环境。

```text
Round 1

Spawn A
Spawn B
↓
Run
↓
Destroy


Round 2

Spawn A
Spawn B
↓
Run
↓
Destroy
```

算法不得通过：

- `/tmp`
- home directory
- global state
- subprocess
- daemon
- shared memory
- network
- local database

保留上一 Round 的结果。

---

# 14. 计时定义

V1 必须明确一个唯一官方时间。

建议使用：

> **Runner 启动执行 → Function DSL 输出完成**

作为算法计算时间。

也就是说：

```text
START SIGNAL
     ↓
Algorithm Process Start
     ↓
Imports / Initialization
     ↓
solve()
     ↓
DSL output
     ↓
STOP TIMER
```

全部计入。

这样不存在：

> 某队提前加载一个巨大计算环境但不算时间。

正式比赛比较的是：

\[
\boxed{\text{End-to-End Solver Latency}}
\]

---

# 15. 双方同时开始

Round Start 必须实现真正的 barrier。

流程：

```text
Prepare Runner A
Prepare Runner B
        ↓
Both READY
        ↓
RoundState frozen
        ↓
Judge creates T0
        ↓
Release A
Release B
        ↓
Compute
```

A 和 B 的启动偏差应该进行自动测试。

V1 目标：

\[
|\Delta t|\leq1ms
\]

如果当前平台环境无法稳定达到 1ms，应记录实际 Benchmark，并选择一个固定且可复现的阈值。

---

# 16. Round State Snapshot

每轮 Reveal 时生成唯一：

```text
RoundState_N
```

之后不可修改。

即使：

```text
Team A shoots first
↓
B3 dies
```

Team B 的算法仍然继续使用：

```text
RoundState_N
```

而不是获得更新后的状态。

只有：

```text
Round N+1
```

才生成新的 Snapshot。

---

# 17. Round Data Hash

每轮创建：

```text
RoundState SHA-256
```

例如：

```text
ROUND 4

State Hash:
a93f72...
```

Runner A 和 Runner B 日志都应记录相同 Hash。

用于验证：

> 双方确实获得完全相同的数据。

---

# 18. 一轮完整执行流程

正式 V1 必须严格按以下顺序运行：

```text
ROUND INTRO
        ↓
Shooter Selection
        ↓
A LOCK
B LOCK
        ↓
WAITING FOR JUDGE
        ↓
Judge START ROUND
        ↓
3
2
1
        ↓
REVEAL
        ↓
Freeze RoundState
        ↓
Start A + B
        ↓
A COMPUTING
B COMPUTING
        ↓
First output arrives
        ↓
Validate DSL
        ↓
Execute first shot
        ↓
Check win / shooter kill
        ↓
If second shooter alive:
    wait for second output
        ↓
Validate
        ↓
Execute second shot
        ↓
ROUND RESULT
        ↓
Destroy both runners
        ↓
WAITING FOR NEXT ROUND
```

---

# 19. First Solver 判定

Judge 使用真实输出到达顺序。

例如：

```text
A output:
128.438219 ms

B output:
128.439782 ms
```

则：

```text
A FIRST
```

大屏可以四舍五入：

```text
A 128.44 ms
B 128.44 ms
```

但内部排序不得使用显示后的数字。

V1 不需要人为制造“同时攻击”概念。

Judge 收到的第一个合法输出就是 First Solver。

---

# 20. Invalid Output

算法每 Round 只允许一次正式输出。

如果返回：

- Invalid AST；
- 非 C²；
- >100 Convexity Changes；
- >128 Nodes；
- >12 Depth；
- 不经过 Shooter；
- NaN；
- Infinity；
- Undefined；
- 非法 Operator；

则：

```text
INVALID SHOT
```

本 Round 不允许重新提交。

否则可以故意：

```text
先快速乱猜
↓
失败
↓
继续算
```

破坏比赛机制。

---

# 21. Timeout

当前：

```text
computeTimeout = 2000ms
```

直接作为 V1 默认值。

超过：

```text
2000 ms
```

Judge：

```text
TIMEOUT
```

终止该 Runner。

本轮：

```text
NO SHOT
```

---

# 22. Shooter Eliminated

如果 First Solver 的攻击杀死对方本轮 Shooter，而对方尚未执行攻击：

```text
SHOOTER ELIMINATED
```

则：

```text
Opponent shot cancelled
```

对方 Runner 应立即终止。

不再等待剩余 Timeout。

---

# 23. Function Validator 集成

Plan 1 已完成的验证器需要整合成统一：

```text
validateAttackFunction()
```

执行顺序建议固定：

```text
Parse DSL
    ↓
Schema Validation
    ↓
AST Complexity
    ↓
Operator Whitelist
    ↓
Shooter Constraint
    ↓
Domain Validation
    ↓
C² Validation
    ↓
Convexity Change Count
    ↓
Numerical Sanity
    ↓
VALID
```

每一种失败拥有唯一 Error Code。

例如：

```text
INVALID_AST
AST_TOO_LARGE
AST_TOO_DEEP
DISCONTINUOUS
NOT_C2
TOO_MANY_CONVEXITY_CHANGES
INVALID_DOMAIN
SHOOTER_NOT_ON_FUNCTION
NUMERICAL_OVERFLOW
```

---

# 24. Validator 必须与 Visualizer 使用同一 AST

不得：

```text
Judge parses one way

Frontend parses another way
```

正确架构：

```text
Algorithm DSL
      ↓
Canonical AST
      │
 ┌────┴─────┐
 │          │
Judge    Visualizer
```

同一个 Canonical AST 是唯一真相来源。

---

# 25. Collision Pipeline

一次合法攻击：

```text
Validated Function
        ↓
Determine attack direction
        ↓
Find first obstacle collision
        ↓
Check enemy intersections
        ↓
Discard hits behind obstacle
        ↓
Sort hits by travel order
        ↓
Generate ShotResult
```

统一输出：

```json
{
  "team": "A",
  "shooter": "A4",
  "hits": ["B2", "B6"],
  "blockedBy": "O3",
  "status": "VALID"
}
```

---

# 26. Point Hit

继续使用零宽度数学轨迹。

视觉上的线可以较粗，但 Judge 不允许使用视觉宽度判定。

必须保证：

```text
Canvas pixels ≠ Hit detection
```

Judge 是唯一命中来源。

---

# 27. Match Setup 页面

V1 首页建议直接做成：

```text
MATCH SETUP
```

包含：

### Match

```text
Match Name
Point Count
Map Seed / Load Map
```

### Team A

```text
Team Name
Upload Algorithm
Validation Status
Package Hash
```

### Team B

同样内容。

### Match Status

只有：

```text
A READY
B READY
MAP READY
JUDGE READY
```

全部成立以后：

```text
[ START MATCH ]
```

才可以点击。

---

# 28. 地图生成

V1 需要至少完成一个真正可用于比赛的 Generator。

输入：

```text
seed
N
difficulty
```

输出：

```text
Team A points
Team B points
Obstacles
```

满足：

\[
6\leq N\leq10
\]

双方：

\[
N_A=N_B
\]

并满足 Plan 1 规定的坐标范围和最小距离。

---

# 29. Seed

所有正式地图必须拥有 Seed。

例如：

```text
MATCH SEED
4829173
```

相同 Seed：

```text
→ 完全相同地图
```

这样可以：

- Replay；
- Debug；
- 争议复核；
- Benchmark；
- 重现 Bug。

---

# 30. Fairness Filter

随机生成后不要直接接受。

使用：

```text
Generate
   ↓
Validate
   ↓
Fairness Filter
   ↓
Accept / Regenerate
```

最低检查：

- 双方点数一致；
- 坐标合法；
- 最小点距合法；
- 没有点出生在障碍物内部；
- 双方点的整体离散度没有极端差异；
- 障碍没有彻底封锁单方；
- 地图不是明显不可玩状态。

V1 不需要追求数学意义上的绝对公平。

目标是排除：

> 明显异常地图。

---

# 31. Shooter Selection UI

进入 Match 后分别提供：

```text
TEAM A CONTROL
```

和：

```text
TEAM B CONTROL
```

每个页面只显示：

- 当前存活点；
- 点编号；
- Select；
- Lock In。

例如：

```text
A1   A2   A3   A4
A5   A6   A7   A8
```

死亡：

```text
A3 ✕
```

不可选择。

---

# 32. Shooter Lock

选择以后：

```text
A4 SELECTED
```

点击：

```text
LOCK IN
```

之后不可修改。

对方看不到：

```text
A selected A4
```

只看到：

```text
TEAM A LOCKED
```

直到 Reveal。

---

# 33. Judge Control

独立裁判控制区域：

```text
START ROUND
NEXT ROUND
PAUSE MATCH
RESUME MATCH
END MATCH
```

技术性：

```text
RESTART ROUND
```

可以保留，但必须：

- 明确二次确认；
- 写入 Audit Log；
- 只能用于技术故障。

---

# 34. Audience Screen

这是 V1 最重要的前端页面。

核心结构：

```text
              ROUND 4

TEAM A                         TEAM B
5 ALIVE                        4 ALIVE

            Coordinate Plane

        Points
        Shooters
        Obstacles
        Attack Functions

A COMPUTING...                 B COMPUTING...
```

不要做成复杂游戏 HUD。

重点保持：

- 数学感；
- 竞技感；
- 可读性。

---

# 35. Round Intro

每轮先出现：

```text
ROUND 4
```

停留短暂时间。

然后进入：

```text
SELECT SHOOTER
```

---

# 36. Ready 状态

双方锁定以后：

```text
TEAM A READY ✓

TEAM B READY ✓

WAITING FOR JUDGE
```

保持不动。

给主持人留下现场讲话和控制节奏的空间。

---

# 37. Countdown

Judge 点击：

```text
START ROUND
```

后：

```text
3
2
1
```

随后：

```text
REVEAL
```

---

# 38. Reveal

Reveal 应在视觉上是一个明确事件。

同时出现：

- Shooter 高亮；
- Obstacles；
- 坐标；
- Round Data Ready；
- Compute Timer。

然后：

```text
A COMPUTING...
B COMPUTING...
```

---

# 39. Function Display

算法输出后平台自动 Pretty Print。

例如：

```text
TEAM A SOLVED
128.42 ms

fA(x) =
0.3x + 2sin(0.7x) + 1.4
```

对于较长函数：

- 主屏显示格式化版本；
- 可以折行；
- 不允许把整个地图区域挤掉。

内部始终保留完整 AST。

---

# 40. Attack Animation

攻击轨迹从 Shooter 开始延长。

不是一次性完整出现。

推荐：

```text
350–600ms
```

V1 默认：

```text
450ms
```

轨迹头部沿：

\[
y=f(x)
\]

快速移动。

后方留下已走过的函数轨迹。

---

# 41. 动画传播方向

Team A：

```text
left → right
```

Team B：

```text
right → left
```

轨迹直到：

- First Obstacle；
- 或地图攻击边界。

---

# 42. Hit Animation

如果攻击依次经过：

```text
B2
B5
B7
```

动画必须按实际传播顺序：

```text
B2 HIT
↓
B5 HIT
↓
B7 HIT
```

不应同时全部消失。

每个 Hit 可以：

```text
point
↓
flash
↓
×
↓
fade
```

---

# 43. Shooter Kill

如果命中当前 Shooter：

```text
SHOOTER ELIMINATED
```

应当是明显的比赛事件。

如果其攻击尚未执行：

```text
SHOT CANCELLED
```

显示在 Team 对应区域。

---

# 44. Round Result

Round 完成后：

```text
ROUND 4 COMPLETE
```

显示：

```text
TEAM A
2 KILLS
5 REMAINING

TEAM B
1 KILL
4 REMAINING
```

随后：

```text
WAITING FOR JUDGE
```

直到人工进入下一轮。

---

# 45. Match End

当：

\[
Alive_A=0
\]

或：

\[
Alive_B=0
\]

立即停止后续 Round。

显示：

```text
MATCH COMPLETE

TEAM A WINS
```

并生成：

```text
MATCH RESULT
REPLAY
LOG
```

---

# 46. Replay

V1 必须可以完整 Replay 一场比赛。

Replay 不重新运行算法。

它使用正式比赛记录下来的：

```text
RoundState
Shooter
Function AST
ShotResult
Timing
Hits
```

重新播放。

这样 Replay：

- 完全确定；
- 不受算法环境变化影响；
- 不会出现第二次运行结果不同。

---

# 47. Match Log

每场比赛生成统一日志。

建议：

```json
{
  "matchId": "...",
  "seed": 4829173,
  "teamAHash": "...",
  "teamBHash": "...",
  "rounds": []
}
```

每 Round：

```json
{
  "round": 4,
  "stateHash": "...",
  "shooterA": "A4",
  "shooterB": "B2",
  "aTimeMs": 128.42,
  "bTimeMs": 213.71,
  "aFunctionHash": "...",
  "bFunctionHash": "...",
  "aHits": ["B3", "B5"],
  "bHits": ["A2"],
  "result": "COMPLETE"
}
```

---

# 48. Audit Log

与 Match Replay 分开记录系统事件。

包括：

```text
Algorithm Uploaded
Algorithm Replaced
Preflight Passed
Match Started
Judge START ROUND
Pause
Resume
Restart Round
Timeout
Runner Crash
Invalid Function
Match Ended
```

用于处理争议。

---

# 49. Determinism

相同：

```text
Algorithm
Round State
Runtime
```

应尽可能得到相同：

```text
Function
```

正式 Runtime 应冻结：

- Python Version；
- Package Versions；
- CPU Limit；
- Thread Count；
- Random Seed Policy。

如果算法使用随机数，Runner 应提供固定 Round Seed。

不得使用：

```text
system time
network randomness
external randomness
```

决定正式结果。

---

# 50. Performance Fairness

A 和 B 必须：

- 同硬件；
- 同 CPU quota；
- 同 RAM；
- 同 runtime；
- 同 sandbox；
- 同进程优先级；
- 同时启动。

正式比赛机器启动 Match 前最好运行：

```text
SYSTEM READY CHECK
```

确认：

- CPU 没有高负载；
- 内存正常；
- Runner 正常；
- Judge 正常。

---

# 51. Crash Handling

如果算法 Crash：

```text
RUNNER_CRASH
```

本轮：

```text
NO SHOT
```

不得自动重新执行。

如果 Crash 来自赛事平台本身，而非算法：

```text
PLATFORM_ERROR
```

则进入裁判技术处理流程。

必须区分两者。

---

# 52. Judge 自身故障

如果出现：

- 两边都没有收到 Round State；
- Runner 同步失败；
- Judge Exception；
- Visualizer 与 Judge 状态严重不一致；

则 Round 标记：

```text
TECHNICAL_INVALID
```

裁判可以：

```text
RESTART ROUND
```

Replay/Audit Log 保留这次失败记录。

---

# 53. Visualizer 故障不影响 Judge

如果动画卡顿：

```text
Judge Result
```

仍然有效。

必须保持：

```text
Judge = Source of Truth
```

而不是：

```text
Frontend = Source of Truth
```

---

# 54. Public SDK

V1 发布前为选手提供一个最小 SDK。

例如：

```text
starter/
├── solver.py
├── sample_input.json
├── run_local.py
└── README.md
```

选手执行：

```text
run_local
```

即可验证：

```text
Input accepted
Solver executed
DSL valid
```

不要求选手理解赛事内部 Judge。

---

# 55. Baseline Bot

赛事方至少提供三个 Bot。

### Bot 0 — Example

只证明 API 可以工作。

### Bot 1 — Basic

能生成简单合法函数。

### Bot 2 — Competitive Baseline

具有一定优化能力。

目的不是给出最优答案，而是让参赛者知道：

> 自己的算法是否真正比基础策略更好。

---

# 56. Submission Validator 本地版

选手正式上传之前应该可以运行：

```text
validate_submission
```

检测：

- Package；
- Entrypoint；
- Runtime；
- DSL；
- Timeout；
- Crash。

减少比赛当天：

```text
上传以后才发现不能运行
```

的问题。

---

# 57. V1 不做的功能

为了保证 Plan 2 真正结束于可用 V1，而不是继续扩张范围，本阶段明确不加入：

- 在线 AI；
- LLM API；
- AI 自动 Shooter Selection；
- 账户系统；
- 云端排行榜；
- 多人在线匹配；
- Spectator Chat；
- 复杂角色动画；
- 武器系统；
- 多种攻击类型；
- 移动单位；
- 移动障碍；
- 手机 App；
- 跨机器网络比赛。

这些全部留给 V2 或以后。

---

# 58. 实施顺序

Plan 2 不需要再拆成独立 Plan，但开发内部建议按照以下顺序执行。

---

## Phase A — Submission & Runner

完成：

- Algorithm ZIP Upload；
- `manifest.json`；
- package hash；
- Preflight；
- Team A / B slots；
- isolated runner；
- timeout；
- crash handling；
- fresh process per Round。

### Gate A

必须证明：

```text
Team A algorithm uploaded ✓
Team B algorithm uploaded ✓
Both preflight ✓
Both hash locked ✓
Both can independently execute ✓
Timeout works ✓
Crash isolation works ✓
```

---

## Phase B — Dual Runner Synchronization

完成：

- immutable RoundState；
- same state hash；
- dual barrier；
- simultaneous release；
- timing；
- result collection；
- first-solver ordering。

### Gate B

必须证明：

```text
A input hash == B input hash ✓
Start skew within accepted threshold ✓
Independent timers ✓
First result correctly ordered ✓
No cross-team access ✓
```

---

## Phase C — Judge Integration

把 Plan 1 的：

```text
DSL
C²
Complexity
Convexity
Obstacle
Hit
```

全部接入真正 Round。

### Gate C

必须测试：

```text
Valid straight function
Valid polynomial
Valid trig function
Valid composite function
Valid Fourier-like function

Invalid piecewise
Invalid AST
Invalid C²
101 convexity changes
129 nodes
depth 13
NaN
Infinity
Shooter mismatch
Obstacle before target
Obstacle after target
multiple targets
```

所有结果 deterministic。

---

## Phase D — Full Match State Machine

将现有 17 states 与真实 Runner 接通。

确保：

```text
SELECT
LOCK
WAIT
START
REVEAL
COMPUTE
SHOT
RESULT
NEXT ROUND
MATCH END
```

全部真实运行，而不是 Demo 状态跳转。

### Gate D

完整自动测试一场：

```text
8 vs 8
```

直到一方全部死亡。

不得人工修改内部状态。

---

## Phase E — Match Setup & Team UI

完成：

- Team A upload；
- Team B upload；
- Match Seed；
- Map；
- Preflight status；
- START MATCH；
- Shooter Selection；
- Lock。

### Gate E

工作人员从空白页面开始，可以：

```text
Upload A
Upload B
Load Map
Start Match
```

不需要编辑配置文件或运行命令行。

---

## Phase F — Audience UI

完成：

- ROUND N；
- Point plane；
- Shooter；
- Obstacles；
- COMPUTING；
- timers；
- function；
- trajectory；
- Hit；
- Remaining；
- Round Result；
- Winner。

### Gate F

观众只看 Audience Screen，也能够理解当前：

```text
第几轮
谁在发射
谁先算出
解析式是什么
击中了谁
谁还剩多少点
谁获胜
```

---

## Phase G — Animation

完成函数逐步生长动画。

必须使用：

```text
Canonical AST
+
Judge Shot Result
```

不得重新独立推导比赛结果。

默认：

```text
~450ms
```

完成一发。

### Gate G

测试：

- straight；
- polynomial；
- trig；
- 复杂 composite；
- multi-hit；
- obstacle stop；
- shooter kill。

动画与 Judge 结果完全一致。

---

## Phase H — Map Generator

完成：

```text
seed → deterministic map
```

支持：

```text
N = 6–10
```

完成基本公平过滤。

### Gate H

至少批量生成：

```text
1000 maps
```

验证：

- 无非法坐标；
- 无点重叠；
- 无 spawn inside obstacle；
- 双方数量一致；
- Seed 可复现；
- 无 Generator Crash。

---

## Phase I — Replay & Logs

完成：

- Match Log；
- Audit Log；
- Function Hash；
- State Hash；
- Replay。

### Gate I

完成一场比赛以后：

```text
Restart platform
↓
Load Replay
↓
Play
```

视觉与原比赛关键结果一致。

不重新运行参赛算法。

---

## Phase J — Full Dress Rehearsal

这是 V1 最后的 Gate。

不是单元测试，而是真正模拟一次比赛现场。

要求：

```text
2 unknown algorithm packages
↓
fresh platform launch
↓
upload
↓
preflight
↓
generate map
↓
start match
↓
human shooter selection
↓
manual judge start
↓
multiple rounds
↓
winner
↓
replay
```

全过程不得：

- 修改代码；
- 修改数据库；
- 打开 DevTools 修改状态；
- 手工编辑 JSON；
- 重启单个错误模块来继续比赛。

---

# 59. V1 必须完成的测试矩阵

## Function

- Linear
- Quadratic
- Cubic
- Trigonometric
- Composite
- Fourier-style
- Near-complexity-limit
- 100 convexity changes
- 101 convexity changes

## Runner

- Fast solver
- Slow solver
- Timeout
- Crash
- Invalid output
- Huge output
- Malformed package

## Match

- A first
- B first
- A timeout
- B timeout
- Shooter eliminated
- Multiple kills
- Zero kills
- Obstacle block
- Final elimination

## UI

- 6 vs 6
- 8 vs 8
- 10 vs 10
- Long equation
- Missing second shot
- Timeout
- Invalid shot
- Winner

## Replay

- Complete match
- Timeout match
- Invalid shot
- Shooter cancellation
- Technical restart record

---

# 60. V1 Final Acceptance Gate

只有下面全部满足，才能宣布：

```text
V1 COMPLETE
```

### Core

- [ ] Plan 1 Validator 全部集成
- [ ] Judge 是唯一比赛真相来源
- [ ] 17-state Round Machine 真实运行
- [ ] 2000ms Timeout 有效

### Algorithm Submission

- [ ] Team A 上传
- [ ] Team B 上传
- [ ] ZIP Preflight
- [ ] Package Hash
- [ ] Runtime Freeze
- [ ] Invalid Package 拒绝

### Fair Execution

- [ ] 双方输入完全一致
- [ ] Round State Hash 一致
- [ ] 同时启动
- [ ] 独立 Sandbox
- [ ] 无网络
- [ ] 无跨 Round State
- [ ] 无跨 Team 数据访问

### Match

- [ ] 人工 Shooter Selection
- [ ] Secret Lock
- [ ] Judge START ROUND
- [ ] Reveal
- [ ] 双方 Compute
- [ ] First Solver
- [ ] Shot
- [ ] Shooter Cancellation
- [ ] Round Result
- [ ] Next Round
- [ ] Winner

### Frontend

- [ ] Match Setup
- [ ] Algorithm Upload
- [ ] Team A Controller
- [ ] Team B Controller
- [ ] Judge Controller
- [ ] Audience Screen
- [ ] Round Number
- [ ] Compute Timer
- [ ] Function Display
- [ ] Function Growth Animation
- [ ] Hit Animation
- [ ] Winner Screen

### Data

- [ ] Seeded Map Generator
- [ ] Fairness Filter
- [ ] Match Log
- [ ] Audit Log
- [ ] Replay
- [ ] Algorithm Hash
- [ ] Round State Hash

### Reliability

- [ ] 1000-map Generator Test
- [ ] Full Function Test Matrix
- [ ] Full Runner Test Matrix
- [ ] Full Match Test
- [ ] Full Replay Test
- [ ] Full Dress Rehearsal
- [ ] Clean restart after match
- [ ] No unverified code/config changes

---

# 61. Stop Hook 要求

现有：

```text
~/.claude/settings.json
```

中的 Stop Hook 继续保留。

Plan 2 全程要求：

> 只要本轮修改了代码或配置，就必须有相应验证证据才能结束工作。

Stop Hook 应阻止：

```text
implemented but not tested
```

或者：

```text
UI appears complete but no match-level verification
```

这样的状态被错误标记为完成。

但最终判断不能只依赖 Stop Hook。

每个 Gate 都必须留下：

```text
tests
logs
screenshots / runtime evidence
```

其中至少一种可复核证据。

---

# 62. 最终交付物

Plan 2 完成后，项目至少应包含：

```text
V1 Platform

├── Match Setup
├── Team A Upload
├── Team B Upload
├── Algorithm Validator
├── Dual Sandbox Runner
├── Function Judge
├── Round Engine
├── Map Generator
├── Team Controllers
├── Judge Controller
├── Audience Screen
├── Function Animation
├── Replay
└── Match Logs
```

以及：

```text
Public SDK
Example Algorithm
Submission Specification
Competition Rulebook
V1 Operator Guide
```

工作人员的最终操作应该只剩：

```text
1. 打开平台
2. 上传 A 算法
3. 上传 B 算法
4. 生成 / 加载地图
5. 点击 Start Match
6. 每轮让双方选 Shooter
7. 主持人点击 Start Round
```

其他全部由平台完成。

---

# 63. Plan 2 完成标准

Plan 2 不以：

> “主要功能已经写了”

作为完成标准。

唯一完成标准是：

> **两支此前没有接触过平台内部代码的队伍，可以分别提交自己的算法包；工作人员不修改任何代码即可上传、验证并启动比赛；比赛能够从 Round 1 连续进行到 Winner，完整展示函数、碰撞、击杀、Round 状态和动画，并在结束后生成可复现 Replay 与审计记录。**

达到这一状态后：

\[
\boxed{\text{V1 COMPLETE}}
\]

Plan 2 结束。

之后再讨论的内容全部进入 V1.x 优化或 V2，而不是继续补 V1 基础功能。