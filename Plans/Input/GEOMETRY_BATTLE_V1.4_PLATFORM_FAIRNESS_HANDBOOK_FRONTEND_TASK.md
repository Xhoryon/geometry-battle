# Geometry Battle V1.4 — Platform Fairness, Competitor Protocol Hardening & Frontend UX Refresh

> **任务类型 / Task Type**  
> 一次完整、集中式的 V1.4 平台改进波次，涵盖：平台公平性验证、系统级 Debug、选手手册与 Competitor Kit 加固、前端 UI/UX 优化、跨平台操作体验、真实浏览器验收、回归测试、变异测试、发布前门禁与完整开发日志。
>
> **核心原则 / Core Principle**  
> 不以“继续优化参赛算法”为目标，而是使用此前 A/B 独立算法与盲评暴露出的差异，继续验证 **Geometry Battle 平台本身是否正确、公平、清晰、稳定、易用**。
>
> 本文件是本轮真实存在的任务规范。不要引用不存在的 V1.4 spec。

---

# 0. 当前冻结基线 / Frozen Baseline

Geometry Battle V1.3 已完成独立终审并获批准。

**内部批准的 V1.3 Release Candidate：**

```text
febf1c69fb6cb78624811513149f477c4e30fac6
```

终审结论：

```text
PASS — APPROVED FOR V1.3 RELEASE
APPROVED RELEASE CANDIDATE HEAD:
febf1c69fb6cb78624811513149f477c4e30fac6
```

本轮 V1.4 必须从这个 SHA 开始。

建议分支：

```text
feature/v1.4-platform-ux
```

如果该分支已经存在，先检查，不要盲目覆盖。

---

# 1. 角色 / Role

你是 **Geometry Battle V1.4 Platform & UX Lead Agent**。

你负责一次完整的大波次，而不是零碎地逐个小修。

你的职责包括：

1. 调查 Team A / Team B 是否存在平台结构性 side bias；
2. 调查 first-solver / runtime / scheduling 是否存在系统偏差；
3. 建立镜像不变量（metamorphic / mirror）测试；
4. 检查并修复真实的平台级 bug；
5. 更新 Competitor Kit / 选手手册，减少方向、排序、坐标约定误解；
6. 设计并实现更成熟的 Judge / Team / Spectator / Replay / Home UI；
7. 优化正式比赛的操作流程；
8. 保持中英文完整支持；
9. 进行系统 Debug、浏览器测试、跨 viewport 测试与必要的跨系统兼容检查；
10. 建立新的回归与变异测试；
11. 保留完整开发工作日志；
12. 最后给出明确 Gate 结论。

你可以使用少量子代理协助，但不要制造几十个 Agent 的失控审查。

推荐最多：

```text
Main Lead
├── Fairness / Engine Audit subagent
├── Competitor Kit / Docs subagent
└── Frontend UX / Browser QA subagent
```

主 Agent 必须负责合并结论、解决冲突并完成最终验证。

---

# 2. 第一原则：先理解，再修改

不要从截图或任务摘要直接开始改代码。

首先读取：

```text
docs/agent-context/PROJECT_STATE.md
docs/agent-context/ARCHITECTURE.md
docs/agent-context/DEVELOPMENT_RULES.md
README.md
package.json
competitor-kit/README.md
competitor-kit/ALGORITHM_REQUIREMENTS.md
competitor-kit/RUNTIME_MANIFEST.md
competitor-kit/DSL_SPECIFICATION.md
competitor-kit/JSON_SCHEMA.md
```

然后检查 Git：

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
git log --oneline --decorate -15
git tag --list --format='%(refname:short) %(objectname)'
git remote -v
```

确认：

- 基线来自 `febf1c69...`
- 工作树是否干净
- release tags 未移动
- 当前 repo 是否无 public remote
- 不要默认摘要里的 SHA / tag 信息一定正确，实际以 Git 为准

---

# 3. 禁止重新打开已经关闭的问题 / Closed Areas

除非本轮发现了新的直接证据，否则不要重新做：

```text
V1.2 ZIP/DEFLATE 全面审计
历史 Emitter lock 隐私审计
历史 WS 鉴权审计
旧 README fence 审计
历史 V1.3 localization key parity 全量审计
A-v1 / B-v1 谁更强的算法研究
demo solver period-2 优化
旧 playtest 平衡研究
```

这些不是本轮主要目标。

---

# 4. 本轮三大工作流 / Three Workstreams

本轮并行推进：

```text
A. Platform Fairness & Correctness
B. Competitor Protocol / Handbook Hardening
C. Frontend UI / UX / Operational Flow Refresh
```

所有工作最后在一个统一 Gate 收口。

---

# PART A — PLATFORM FAIRNESS & CORRECTNESS

# 5. 背景：为什么要查公平性

此前双算法盲评产生了值得调查的平台信号：

- A-v1 存在自己的 Team-B 枚举 bug；
- 该 bug 使 A 自战不能用于推断平台 side bias；
- 但其它同包自战仍显示 Team A 胜率偏高的迹象；
- 因此当前不能宣称平台有 side bias，也不能宣称没有。

本轮必须把这个问题变成可验证的工程问题：

> **Geometry Battle 是否满足 Team A / Team B 的镜像公平性？**

不要在调查前先假设答案。

---

# 6. 公平性核心不变量 / Mirror Invariant

对于一个合法世界状态 `S`，构造镜像状态 `M(S)`：

```text
x' = -x
Team A ↔ Team B
forward direction ↔ mirrored forward direction
```

同时镜像：

- Emitter
- Combat Points
- obstacles
- arena-relative positions
- target orientation
- attack traversal direction
- 任何 team-specific public input

期望平台级关系：

```text
winner(S) = A
⇔
winner(M(S)) = B
```

以及：

```text
kills_A(S) == kills_B(M(S))
kills_B(S) == kills_A(M(S))
```

并尽可能检查：

```text
trajectory geometry
termination reason
termination point
obstacle intersection
hit set
roundStateHash semantic equivalence
invalid/valid classification
```

注意：哈希字节本身不一定因 team 交换而相等，不要错误要求字节 hash 相同；检查的是语义镜像关系。

---

# 7. 分层镜像验证

不要只测完整比赛。

必须从底层逐层定位。

## Level 1 — Geometry primitives

检查：

- point reflection
- obstacle reflection
- arena boundary reflection
- Emitter reflection
- radius / epsilon behavior

## Level 2 — Validator

对成对镜像的函数/状态检查：

```text
valid(original) ↔ valid(mirror)
```

错误码如果与 team 无关，应保持一致。

## Level 3 — Trajectory evaluation

检查：

- A increasing-x traversal
- B decreasing-x traversal
- domain start/end
- boundary exit
- obstacle hit
- termination order

## Level 4 — Hit calculation

检查：

- hit set
- earliest hit / obstacle ordering
- epsilon
- multiple kills
- already-dead filtering

## Level 5 — Single round

检查：

- public snapshot
- reveal
- START
- compute
- firstSolver
- attack execution
- kill result
- next phase

## Level 6 — Full match

检查：

- winner
- rounds
- stalemate
- hard round limit
- mutual elimination
- replay consistency

---

# 8. Same-Solver Self-Play

使用至少三类 solver 做同包自战：

```text
1. 一个简单、确定性、方向正确的 symmetry probe solver
2. solver-fast（若仍适合作为历史基线）
3. B-v1 或另一个已知没有 Team-B 方向 bug 的强 solver
```

要求：

```text
same package vs same package
same runtime
same compute budget
paired/mirrored seeds
both slot assignments where meaningful
```

记录：

```text
A wins
B wins
draws
firstSolver A/B/tie
kills
multi-kills
obstacle terminations
round count
compute p50/p95/p99
timeouts
invalids
crashes
```

不要用 A-v1 的旧自战作为 side-bias 证据。

---

# 9. First-Solver Bias

对同一个 deterministic solver 自战，专门统计：

```text
P(firstSolver = A)
P(firstSolver = B)
P(firstSolver = tie)
```

如果同包、同条件下明显偏向某一槽位，进一步调查：

```text
release anchor
process spawn order
file polling order
mtime capture
sandbox startup
scheduler interaction
slot iteration order
result collection order
tie epsilon
```

不要只看平均 compute time。

需要检查“同一算法的系统性先手偏差”。

---

# 10. Map / Placement Bias

调查地图生成是否天然偏左或偏右。

对大量 seeds 检查：

```text
point x distribution
obstacle x distribution
Emitter candidate distribution
nearest-target geometry
left/right clearance
distance-to-boundary
```

对每个生成地图构造镜像并比较。

目标：

```text
generator(seed)
与
mirror(generator(seed))
```

在统计与规则意义上不应系统性偏某一队。

如果生成器本身不要求 seed 镜像不变量，则至少验证总体分布对称。

---

# 11. Symmetry Probe Solver

可以创建一个新的 **test-only** probe solver。

目的不是赢，而是：

```text
简单
确定性
镜像可证明
低复杂度
Team A/B 共用一套规范化坐标逻辑
```

建议使用局部 forward 坐标：

```text
Team A:
u = x - emitter_x

Team B:
u = emitter_x - x
```

使：

```text
forward = +u
```

该 probe 只能作为：

```text
tests / experiments / audit fixture
```

不能暴露为 Tournament Mode 正式内置选手选择。

---

# 12. 平台公平性结论标准

最终必须给出：

```text
PLATFORM MIRROR FAIRNESS:
PASS / FAIL / UNRESOLVED

SLOT WIN BIAS:
CONFIRMED / DISPROVEN / UNRESOLVED

FIRST-SOLVER BIAS:
CONFIRMED / DISPROVEN / UNRESOLVED

MAP DISTRIBUTION BIAS:
CONFIRMED / DISPROVEN / UNRESOLVED
```

不能用“看起来没事”作为结论。

---

# 13. 如果发现平台 bug

只在满足下面条件后修改：

```text
1. 可稳定复现
2. 有最小 reproducer
3. 能定位到平台而不是 solver
4. 能写失败测试
5. 修复不会改变比赛规则本身
```

先：

```text
RED regression
```

再修。

不要一边猜一边重构。

---

# 14. Debug 方法

任何平台 bug 都按以下顺序：

```text
Symptom
→ minimal reproduction
→ isolate layer
→ inspect authoritative state
→ compare mirrored counterpart
→ identify invariant violation
→ add regression
→ fix
→ mutation / old-bug discrimination
→ full gate
```

禁止：

```text
直接加 sleep
放宽 epsilon
增加 timeout
改规则让测试过
catch-all 忽略错误
```

---

# PART B — COMPETITOR PROTOCOL / HANDBOOK HARDENING

# 15. 选手手册必须更新

此前算法开发已经证明，有些规则虽然平台内部正确，但参赛者容易误解。

本轮更新 competitor-kit，但不改变比赛规则。

---

# 16. 新增 Orientation & Symmetry 章节

公开明确：

```text
Team A forward direction = increasing x
Team B forward direction = decreasing x
```

中英文都写。

推荐选手内部统一到局部 forward coordinate：

```text
Team A:
u = x - emitter_x

Team B:
u = emitter_x - x
```

然后：

```text
forward = positive u
```

说明这是建议，不是强制 API。

---

# 17. 明确数组顺序保证

检查实际 schema 与 server implementation。

如果输入数组没有保证按 x 排序，明确写：

> **Do not assume array order is geometric order.**
>
> **不要假设数组顺序代表 x 从小到大、离 Emitter 从近到远，或任何其它几何排序。**

如果某个字段确实保证顺序，必须写出具体保证。

不要凭感觉。

---

# 18. 两侧兼容要求

明确写：

> The same formal submission may run as Team A or Team B.  
> 同一正式提交必须能够在 Team A 与 Team B 两侧正确运行。

不要让选手认为可以写 Team-A-only solver。

---

# 19. Function Traversal Direction

明确区分：

```text
mathematical function y=f(x)
```

和：

```text
trajectory traversal direction
```

写清：

```text
A traverses increasing x
B traverses decreasing x
```

解释 domain / termination 与 traversal 的关系。

---

# 20. Mirror Self-Test

建议新增：

```text
competitor-kit/tools/check-mirror
```

或者等价工具。

功能：

```text
读取合法 participant input
→ 构造镜像 input
→ 同一个 solver 在 A/B 两侧运行
→ 对输出做合法性检查
→ 检查基本镜像一致性
```

不要要求攻击 AST 字节完全相同。

应比较规范化几何语义。

---

# 21. Preflight 增强

如果不改变正式规则，可以考虑在 participant local tooling 中增加 warning：

```text
solver passes Team A case
but fails mirrored Team B case
```

这应是：

```text
development diagnostic
```

不是新的正式比赛拒绝规则，除非规则本来就要求且 Validator 可以客观判定。

---

# 22. README / Competitor Kit 双语一致

所有新增 participant-facing 文档必须中英双语。

保持已有 V1.3 风格：

```text
## 坐标方向与镜像 / Orientation & Symmetry
```

不要复制成两个完全分离且容易漂移的 README。

---

# PART C — FRONTEND UI / UX / OPERATION FLOW

# 23. 前端优化目标

本轮不是“换颜色”。

目标：

> 让 Geometry Battle 从一个功能齐全的工程工具，变成一个真正适合比赛现场使用的交互式赛事系统。

优化：

```text
信息层级
主操作路径
角色差异
状态可见性
错误恢复
比赛观感
回放体验
中英文一致性
跨 viewport 可用性
```

---

# 24. 必须先跑真实应用

在设计 UI 前：

```bash
npm install
npm run app
```

真实浏览器打开：

```text
/
/judge
/team/a
/team/b
/spectator
/replay/:matchId
```

至少走一场真实比赛：

```text
upload
→ preflight
→ select Emitter
→ lock
→ judge ready
→ reveal
→ start
→ run rounds
→ terminal
→ spectator
→ replay
```

同时看：

```text
zh-CN
en-US
```

不要从静态截图脑补流程。

---

# 25. UI 总体视觉语言

建议方向：

```text
technical tournament
control-room
scoreboard
geometric instrument
```

避免：

```text
gradient-heavy
glassmorphism
rounded-card-everywhere
mobile-app toy aesthetic
excessive shadows
decorative animation noise
```

保持：

```text
清晰网格
明确边框
低视觉噪声
强层级
等宽数字
状态驱动颜色
大面积稳定背景
几何感
```

不要指定与现有品牌完全冲突的新设计语言，先检查现有 CSS。

---

# 26. 首页 `/`

设计 Role Home：

```text
GEOMETRY BATTLE

Choose your role / 选择身份

Judge / 裁判
Team A
Team B
Spectator / 观众

Recent Replays / 最近比赛
```

注意：

```text
Navigation visibility ≠ authorization
```

没有 capability/token 不得因为首页入口就获取权限。

如果 Judge/Team 需要 token：

- 入口可以提示输入/使用已有 token；
- 不得绕过 auth；
- 不得把 token 写入 URL 日志或不安全位置，除非现有架构明确如此且经过审计。

---

# 27. Judge 页面重构

Judge 页面改造成 phase-driven wizard。

核心阶段：

```text
1. Match Setup
2. Algorithm Ready
3. Emitter Selection / Lock
4. Ready
5. Reveal
6. Running
7. Match End
```

每阶段：

```text
一个明显 Primary Action
```

例如：

```text
Create Match
Run Preflight
Wait for Locks
Reveal
Start / Continue
Run to End
Open Replay
```

高级操作：

```text
Advanced
```

不要让低级按钮与主操作争夺注意力。

---

# 28. Judge 信息架构

Judge 至少分成：

```text
Match Status
Team A
Team B
Arena
Primary Action
Advanced
Audit / Source Review
```

Team 卡片展示：

```text
algorithm name
hash short form
source status
preflight
Emitter lock status
compute state
```

绝对路径仍不得显示。

---

# 29. Team 页面

Team 页面目标：

```text
Submit
→ Validate
→ Preflight
→ Select Emitter
→ Lock
→ Wait
```

建议四块：

```text
Algorithm
Source
Emitter
Status
```

LOCK 前：

```text
interactive
```

LOCK 后：

```text
clearly immutable
```

必须明确：

```text
LOCKED
```

并说明：

```text
cannot be changed for this match
```

不要依赖颜色单独表达锁定。

---

# 30. Team 上传体验

优化：

```text
ZIP/folder/file selection
file list
validation result
source preview
package name/hash
preflight
replace package
```

失败时：

```text
错误放在相关操作附近
不只弹一个全局红条
保留可恢复操作
```

严禁恢复 host absolute path 泄漏。

---

# 31. Spectator 页面

Spectator 保持真正只读。

除了：

```text
language switch
```

不要增加比赛控制。

观众关心：

```text
Team A / Team B
round
remaining points
current phase
first solver
compute time
kills
winner
end reason
```

Arena 是视觉中心。

建议结构：

```text
Team A        Round        Team B
alive                        alive

          ARENA

A compute      first      B compute
```

终局显示：

```text
TEAM X WINS
DRAW
ELIMINATION
STALEMATE
ROUND N
```

但不要遮住所有最后一帧信息。

---

# 32. Replay

Replay 从“调试页”提升为播放器：

```text
Previous round
Play / Pause
Next round
Round N / Total
timeline
```

可选：

```text
0.5× / 1× / 2×
```

只能影响动画速度。

严禁：

```text
重新运行 solver
重新计算函数
重新裁判
```

Replay 必须仍只使用 persisted authoritative data。

---

# 33. Replay 现有残留

本轮可以顺手修复已记录、确实属于 UI 的非阻塞项：

```text
firstSolver = tie / none 在本地化模板里裸显示
endReason machine enum 直接显示
TEAM ${winner} 手拼
difficultyLabel 原型链不安全访问
```

但只在不扩大到协议重构的情况下处理。

优先使用：

```text
translation key
safe map lookup
existing normalized presentation helpers
```

机器枚举保持原样。

---

# 34. Global Navigation

建立共享导航/壳层。

至少：

```text
Home
Judge
Teams
Spectator
Replays
Language
```

但不同角色页面可以减少干扰。

正式 Team 页面不应该通过导航轻易暴露 Judge privileged actions。

---

# 35. Status Design System

建立统一状态语义：

```text
neutral
waiting
ready
active
warning
error
terminal
```

使用统一组件，例如：

```text
StatusBadge
StatusLine
PrimaryAction
SectionHeader
```

不要五个页面各自发明同义颜色和样式。

---

# 36. 中英文

V1.3 已支持：

```text
zh-CN
en-US
```

所有新 UI：

```text
按钮
tooltip
aria-label
title
empty state
status
error
navigation
replay
```

必须同步 i18n。

不得出现：

```text
中文页面混入平台英文硬编码
英文页面混入平台中文自由文本
```

用户源码/算法名称除外。

---

# 37. 可访问性

检查：

```text
keyboard focus
button semantic role
aria-label
title
contrast
focus-visible
disabled explanation
```

不要只靠颜色表示：

```text
locked
error
ready
winner
```

---

# 38. 响应式 / Viewports

至少真实测试：

```text
1280×720
1440×900
1920×1080
```

如果当前产品支持更小桌面宽度，再测试一个：

```text
1024×768
```

检查：

```text
horizontal overflow
button clipping
header collision
arena collapse
canvas 0-height
tooltip clipping
English long-label overflow
```

---

# 39. Canvas / Arena

保持权威边界：

```text
browser draws
server/engine decides
```

前端不得重新计算：

```text
hit
winner
trajectory validity
termination
```

只允许：

```text
projection
animation reveal
screen-space interaction
```

Obstacle 圆在非均匀坐标映射下继续使用 ellipse，不得退回 arc。

---

# 40. 操作系统 / Browser Compatibility

至少验证：

```text
macOS Chrome
```

如环境可用，再检查：

```text
macOS Safari
Windows Chrome
Windows Edge
```

如果没有真实 Windows，不要声称 Windows PASS。

可进行静态兼容检查：

```text
File API
DecompressionStream
WebSocket
localStorage
Canvas DPR
font fallback
keyboard modifier
```

关键流程不能依赖 macOS-only 行为。

---

# 41. 快捷键

可以增加辅助快捷键，但：

```text
不得成为唯一操作路径
```

例如：

```text
Cmd/Ctrl + Enter
```

必须保留可见按钮。

跨系统使用：

```text
macOS: Meta
Windows/Linux: Ctrl
```

---

# 42. Debug / Error Recovery UX

系统错误需要分层：

```text
Participant error
Package validation error
Preflight error
Round compute error
Judge action error
Connection error
Server internal error
```

不要所有错误都放同一个 global banner。

每种错误至少回答：

```text
发生了什么
谁受影响
是否可重试
下一步是什么
```

---

# 43. WebSocket / Connection UX

检查：

```text
connecting
connected
reconnecting
disconnected
board pending
```

之前已发现：

```text
WS connected != authoritative board arrived
```

新 UI 绝不能重新混淆这两个状态。

保留或加强机器可读：

```text
data-board="pending|ready"
```

必要时给用户明确：

```text
Connected, waiting for match state…
```

而不是把 fallback 当真实状态。

---

# 44. Tournament 操作防误触

危险操作：

```text
reset match
new match
replace package after certain stage
```

应明确：

```text
影响范围
是否会清除 Emitter lock
是否会换 matchId
```

必要时二次确认。

但不要给普通 Reveal / Start 增加烦人的 confirmation。

---

# 45. run-to-end

V1.3 已修：

```text
READY
PUBLIC
REVEAL
```

合法阶段都能正确 run-to-end。

本轮 UI 优化不得破坏：

```text
runToEndBlocker
runToEndPreparation
phase continuation
repeated reveal idempotency
```

保留相关 regression。

---

# 46. Browser QA

完成 UI 改动后，不允许只跑 unit tests。

必须真实浏览器走：

## 中文流程

```text
Home
→ Team A/B upload
→ Preflight
→ select / lock Emitters
→ Judge
→ Reveal
→ Start / Run to End
→ Spectator
→ terminal
→ Replay
```

## English flow

相同完整流程。

检查：

```text
raw translation key
unresolved {placeholder}
mixed-language platform text
overflow
wrong disabled state
stale board state
```

---

# 47. Frontend Testing

更新 E2E 但避免过度依赖中文文本。

优先：

```text
role
accessible name
stable data-testid
machine state attribute
```

不要用：

```text
waitForTimeout(1000)
```

来修同步问题。

等待：

```text
authoritative state
specific DOM state
network-independent UI condition
```

---

# 48. Mutation / Anti-Vacuity

对关键新增测试至少做几项定向变异。

建议：

```text
mirror transform 故意不交换 team
→ symmetry test 必须红

Judge primary action stage mapping 故意错一格
→ workflow test 必须红

language key 删除
→ compile/test 红

board-ready waiting 去掉
→ race regression 能被识别

Replay 改回重新计算（若结构可模拟）
→ boundary test 红
```

不需要大规模 mutation campaign。

---

# 49. 性能

前端优化不能明显恶化：

```text
initial load
route navigation
canvas animation
WS update
Replay playback
```

避免：

```text
每帧 React 大量 re-render
每次 WS board 整页重建昂贵对象
大型 JSON stringify 到 DOM
```

如果引入新组件库或依赖，必须证明必要性。

优先复用当前 React/CSS 架构。

---

# 50. 不要引入重型 UI 框架

除非当前 repo 已经在用。

不要为了几个组件引入：

```text
大型 design system
大型 state manager
重量级 animation framework
```

本轮目标是产品体验，不是技术栈迁移。

---

# 51. 测试门禁 / Verification Gates

开发过程中用 Fast Verification Mode。

每个子工作流：

```text
targeted typecheck
targeted tests
targeted E2E
```

不要每改一个按钮就跑完整 39-suite + full E2E。

最终 RC 才跑完整：

```bash
npm run typecheck
npm run typecheck:web
npm test
npm run e2e
```

记录实际：

```text
suite count
test count
E2E count
duration
exit code
```

---

# 52. Timing Test Policy

`timing-fairness` 已知靠近阈值边界并受系统负载影响。

若失败：

```text
保留完整日志
记录 load
记录高 CPU 进程
判断本轮是否改到该路径
```

禁止：

```text
放宽阈值
删除测试
静默重跑直到绿
```

若环境异常，恢复正常后做一次完整门禁即可。

---

# 53. Git Strategy

建议一个大 feature branch：

```text
feature/v1.4-platform-ux
```

允许内部做几个逻辑清晰的提交：

```text
test(platform): add mirror fairness probes
fix(platform): <only if real bug confirmed>

docs(competitor): clarify orientation and symmetry
feat(competitor): add mirror self-check tooling

feat(web): refresh judge/team workflow
feat(web): improve spectator/replay experience
test(web): cover v1.4 interaction flows

docs(state): record v1.4 results
```

不要 squash 已经审计过的 V1.3 history。

---

# 54. Release Tags

禁止移动：

```text
v1.0.0-competition
v1.1.0-competition
v1.2.0-competition
v1.3.0-competition（若发布线已经创建）
```

如果 V1.3 tag 尚未创建，也不要在本任务里替发布负责人擅自创建。

V1.4 tag 更不允许提前创建。

---

# 55. 完整开发日志

这是强制要求。

维护：

```text
docs/agent-context/V1.4_DEVELOPMENT_LOG.md
```

或项目规范允许的等价位置。

每个重要修改记录：

```text
目标
观察
假设
修改
为什么
测试
结果
失败
风险
下一步
```

平台公平性实验必须记录：

```text
solver hash
seed
sample size
orientation
mirror policy
raw artifact location
statistical method
```

---

# 56. PROJECT_STATE

在工作完成后更新：

```text
docs/agent-context/PROJECT_STATE.md
```

只写当前稳定事实。

不要把整个开发日志复制进去。

---

# 57. 不允许伪造结论

例如：

如果只测试 macOS Chrome：

```text
macOS Chrome: PASS
Windows: NOT TESTED
```

不要写：

```text
cross-platform PASS
```

如果 side bias 样本不足：

```text
UNRESOLVED
```

而不是：

```text
DISPROVEN
```

---

# 58. V1.4 允许改动范围

允许：

```text
platform fairness tests
confirmed platform bug fix
participant docs
competitor local tooling
web UI
web CSS
web interaction
presentation helpers
test/e2e
docs
```

受限：

```text
src/core
```

只有发现并证明平台 bug 时才允许动。

任何核心修改都必须：

```text
minimal reproducer
red regression
fix
old-bug discrimination
full gate
```

---

# 59. 明确禁止

不要：

```text
优化 A/B 参赛算法作为本轮主任务
因为 side bias 信号就直接改规则
改变 500ms
改变 stalemate=20
改变 hard-round-limit=60
改变 Emitter 语义
改变胜负定义
改变 attack DSL
改变 hit epsilon 只是为了让镜像测试过
在浏览器复制 Engine 判定
把 internal benchmark solver 暴露到 Tournament Mode
泄漏本机路径
泄漏 token
使用 arbitrary sleep 修 E2E
```

---

# 60. 最终真实比赛演练

最终至少做一次 V1.4 实际赛事演练：

```text
Home
→ Judge
→ Team A upload
→ Team B upload
→ source review
→ preflight
→ Emitter select
→ lock
→ reveal
→ start
→ rounds
→ run-to-end
→ spectator
→ terminal
→ replay
```

至少：

```text
中文一次
英文一次
```

如成本太高，可共享同一比赛状态验证部分 UI，但关键交互必须两语言都覆盖。

---

# 61. 最终公平性演练

至少产生一个明确的公平性报告：

```text
N mirrored state pairs
N same-solver matches
slot-stratified results
firstSolver split
map distribution summary
```

不要求一定证明完全无偏。

要求结论诚实。

---

# 62. 最终文档交付

至少包括：

```text
1. Platform fairness report
2. Competitor-kit handbook updates
3. Mirror self-check tool/docs
4. Frontend UX changes
5. Browser QA report
6. Cross-platform compatibility status
7. V1.4 development log
8. PROJECT_STATE update
```

---

# 63. 最终报告格式

最后输出：

```text
GEOMETRY BATTLE V1.4 DEVELOPMENT COMPLETE

Branch:
HEAD:
Working tree:

=== PLATFORM FAIRNESS ===
Mirror fairness:
Slot win bias:
First-solver bias:
Map distribution bias:

Sample size:
Probe solver:
Key evidence:

Platform bugs found:
Platform bugs fixed:

=== COMPETITOR KIT ===
Orientation docs:
Array-order docs:
Both-side compatibility:
Mirror checker:
Preflight diagnostics:

=== FRONTEND ===
Home:
Judge:
Team:
Spectator:
Replay:
Navigation:
Status system:
Error UX:
Accessibility:
zh-CN:
en-US:

Viewports tested:
Browsers/OS tested:

=== VERIFICATION ===
typecheck:
typecheck:web:
npm test:
npm run e2e:

Real tournament rehearsal:
Chinese:
English:

Mutation checks:

Known P2/P3:
Known limitations:

Release tags:
Remote/push:

FINAL STATUS:
```

最终状态使用：

```text
V1.4 RC READY FOR INDEPENDENT AUDIT
```

或者：

```text
V1.4 NOT READY — <specific blocker>
```

不要自行打 V1.4 release tag。

---

# 64. 成功标准 / Definition of Done

只有全部满足才算完成：

```text
[ ] V1.3 baseline preserved
[ ] platform fairness question has evidence-based conclusion
[ ] mirror tests exist
[ ] first-solver bias tested
[ ] map distribution checked
[ ] any confirmed platform bug has regression
[ ] competitor orientation rules clarified
[ ] array ordering guarantees clarified
[ ] both-side compatibility documented
[ ] mirror self-check tooling exists or documented reason not to add it
[ ] / redesigned/validated
[ ] /judge improved
[ ] /team/a improved
[ ] /team/b improved
[ ] /spectator improved
[ ] replay improved
[ ] zh-CN complete
[ ] en-US complete
[ ] accessibility checked
[ ] 1280×720 checked
[ ] 1440×900 checked
[ ] 1920×1080 checked
[ ] real browser tournament completed
[ ] full test gate green
[ ] no arbitrary sleeps added
[ ] no competition rules changed
[ ] development log complete
[ ] PROJECT_STATE current
[ ] working tree clean
```

---

# 65. 工作方式 / Execution Style

本轮不要把任务切成几十个微小阶段。

推荐：

```text
Stage 1 — Takeover + Baseline
Stage 2 — Fairness Instrumentation
Stage 3 — Fairness Investigation / Bug Fix if necessary
Stage 4 — Competitor Protocol Hardening
Stage 5 — Frontend UX Implementation
Stage 6 — Browser QA + Debug
Stage 7 — Full Regression
Stage 8 — RC Handoff
```

每个 Stage 完成后：

```text
更新开发日志
做 targeted verification
继续下一 Stage
```

只在最后做一次 heavy full regression。

---

# 66. 停止条件 / Stop Conditions

如果出现以下情况，停止并报告，不要自行扩大范围：

```text
1. 公平性问题需要改变比赛规则才能“修复”
2. 发现 hash / protocol compatibility 需要版本迁移
3. 需要破坏已发布 replay 格式
4. 需要重写 Engine 大块逻辑
5. 需要 force push / move tag
6. 发现真实 credential / secret
7. public/internal history 发生冲突
8. 前端优化需要引入大规模框架迁移
```

---

# 67. 最终提醒

本轮目标不是：

> “让界面更漂亮”

也不是：

> “让某个算法赢更多”

而是：

> **验证 Geometry Battle 是否公平、正确、可理解，并把它打磨成真正能让参赛者、裁判和观众稳定使用的比赛平台。**

任何修改都必须服务于：

```text
Correctness
Fairness
Clarity
Reliability
Usability
Reproducibility
```

而不是为了让测试数字好看。
