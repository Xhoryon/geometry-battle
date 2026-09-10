# Geometry Battle V1.1 — Competition Rules & Playtest Specification

## 0. 文档地位

本文档定义 Geometry Battle V1.1 当前正式玩法与算法竞赛规则。

### 0.1 当前生效版本：Revision 3

**本文件是 V1.1 Playtest Rules — Revision 3。** 以下章节是**唯一权威规则**：

```text
§7      固定 Emitter（取代旧的 Shooter Selection）
§23     函数必须经过自己的固定 Emitter
§38     Locked Attack Right（START 后双方攻击权锁定）
§43     Match Win（含 Mutual Elimination 与其它判和分支）
§44–46  Stalemate（已冻结，不再是拟议）
§54     当前已冻结规则清单
```

**贯穿全文的读法**：凡本文件中出现「Shooter」「Shooter Selection」「Shooter Lock」
「Shooter 被击杀」「Shot Cancellation」「CANCELLED」等表述且**未标注「历史记录」**的，
一律按 Revision 3 重新解释：

```text
Shooter / Shooter Selection  →  固定 Emitter（常量坐标，不由任何人选择）
「Shooter 被击杀 → 攻击取消」  →  已废止；Emitter 不可击杀，攻击权在 START 时锁定
CANCELLED_*                  →  历史/兼容标记，不再是任何规则路径
2000 ms                      →  500 ms
```

§39 保留被废止规则的完整历史证据（不删除）。除此之外的章节若有歧义，
**以本替换表为准**，不要按字面实现旧语义。

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

每轮严格分为（Rule Revision 3 §5）：

```text
PUBLIC
↓
REVEAL
↓
START
↓
COMPUTE
↓
RESOLVE
```

> **历史记录（不删除）**：`SHOOTER LOCK` 曾是 PUBLIC 与 REVEAL 之间的一个阶段 ——
> 双方各自秘密选点并锁定。Revision 3 删除了 Shooter Selection，该阶段随之消失。

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
emitters（固定 Emitter 坐标 —— 公开的常量结构）
points（战斗点）
alive/dead state
```

PUBLIC State 不得包含：

```text
obstacles
real hidden map seed
future Round information
Judge result
```

> Rule Revision 3 §6：`emitters` **属于** public —— 它是整场比赛固定的公开结构。

---

# 7. Fixed Emitter（Rule Revision 3 §2–§6）

> **历史记录（不删除）**：本节曾是「Shooter Selection」—— 双方每轮各自秘密选择一个
> 存活点当 Shooter、LOCK 后不可修改。那套流程已在 Revision 3 中**整个删除**，
> 连同 `SHOOTER LOCK` 阶段与 `reveal.shooters` 字段。保留本节标题是为了让旧引用
> 有处可查；现行规则以下文为准。

## 7.1 固定 Emitter

每支队伍有一个**固定 Emitter**。它在整场比赛中：

```text
固定        坐标是常量：A = (-18, 0)，B = (18, 0)
公开        从第 1 轮的 public_state.emitters 起就可见
不可更换    不由任何人选择，也不随回合变化
不可击杀    它不是战斗点，轨迹穿过它不产生任何效果
```

Emitter 是**本轮攻击函数的数学发射锚点**，不是「枪手」，也不是打击目标。

## 7.2 不再存在 Shooter Selection

正式流程里**没有**以下任何一步：

```text
human selects Shooter every round
SHOOTER LOCK
Shooter reveal
Shooter replacement
```

回合流程简化为：

```text
PUBLIC → REVEAL → START → COMPUTE → RESOLVE
```

`REVEAL` 仍然存在（障碍物是隐藏信息），但它**不再承担 Shooter reveal**。

## 7.3 Emitter 的公平性保证

生成地图时必须保证 Emitter：

```text
不落在障碍物内部
不紧贴障碍物（间距 >= 1.5）
与所有战斗点保持最小间距（>= 2.5）
```

不满足即整张地图作废 —— 被障碍物埋住的 Emitter 等于该队永远打不中任何东西。

---

# 8. REVEAL

```text
REVEAL
```

公开：

```text
Round Obstacles
```

并生成：

```text
reveal_state.json
```

Reveal State 是 Public State 的增量，而不是完整重复。

> **Revision 3 变化**：REVEAL 不再公开任何 Shooter —— 发射锚点是固定 Emitter，
> 已在 `public_state.emitters` 里给出，且整场不变（§6/§7）。
> 现在 REVEAL **只剩障碍物**这一项隐藏信息，`reveal_state.json` 里也没有
> `shooters` 字段了。

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

当前正式（Rule Revision 3 §11）：

\[
\boxed{500\text{ ms}}
\]

> 从 2000 ms 收紧到 500 ms 是三档 benchmark 的结果
> （`playtest/results/revision-3-timeout-bench/BENCHMARK.json`）：
> 250 ms 下参考优化器出现 15.6% 超时、并使整场 Preflight 失败；
> 500 ms 与 750 ms 在 218 个「队伍×回合」样本上均为 **0 超时**。
> 按 §11 的判据**保持 500 ms**，不回升到 2000 ms。

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

# 23. Emitter Constraint（原 Shooter Constraint）

若本队的固定 Emitter 为：

\[
E=(x_e,y_e)
\]

则攻击函数必须满足：

\[
f(x_e)=y_e
\]

当前 pass-through 数值容差：

\[
\boxed{|f(x_e)-y_e|\le10^{-6}}
\]

> `x_e` / `y_e` 是**常量**（A：`(-18,0)`，B：`(18,0)`），每轮完全一样。
> 增量写法 `f(x) = y_e + g(x − x_e)` 可让等式恒成立。

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

# 37. Shooter Elimination — 概念已废止

> **历史记录（不删除）**：本节曾规定「对方当前 Round Shooter 仍然是正常可攻击的
> 敌方 Point，因此可以主动设计 Shooter assassination（刺杀对方 Shooter）」。
>
> Revision 3 之后**这个概念不存在**：发射锚点是**不可击杀的固定 Emitter**，
> 它甚至不在 `points[]` 里。打击目标只有战斗点（`A1..An` / `B1..Bn`）。
> 任何「优先击杀对方 Shooter」的策略都已失去意义 —— 见 §7 与 §38。

---

# 38. Locked Attack Right

当前正式规则 **FROZEN FOR PLAYTEST**（V1.1 Playtest Rules — Revision 3）：

START 之后，双方获得本轮：

```text
独立且不可撤销的攻击权
```

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

# 38.1 Emitter 的语义

本队的发射锚点在整场比赛中定义为：

> **固定 Emitter** —— 常量坐标（A：`(-18,0)`，B：`(18,0)`），
> 不由任何人选择、不随回合变化、不可击杀、不属于战斗点。

而不是：

> 从本轮存活点里选出来的、必须存活到攻击执行瞬间的枪手。

因此：

```text
Team B 的 Emitter = (18, 0)
```

则 B 的函数在**每一轮**都必须满足：

```text
f(18) = 0
```

这个约束与回合、与点位存活状态、与先手顺序都无关。

> **历史记录（不删除）**：Revision 2 时锚点仍是每轮从存活点里选出的 Shooter
> （例如 `START snapshot Shooter = B4`），因此约束是 `f(x_B4) = y_B4`，
> 且 B4 可能在 B 攻击执行前被 A 击杀。Revision 3 用固定 Emitter 取代了这套语义。

---

# 38.2 不进行同轮 Shooter Replacement

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

# 38.3 下一轮（无 Shooter 可选）

> **历史记录（不删除）**：本节曾规定「本轮阵亡的 Shooter 下一轮不可再被选中，
> 人类仍按正常 Shooter Selection 流程从剩余存活点中重新选择」。
>
> Revision 3 删除了 Shooter Selection 这一整个流程，也删除了「Shooter 会死」这件事：

```text
Emitter 不会死亡
不存在「下一轮换一个发射点」
每一轮的锚点都是同一个常量
```

下一轮唯一会变化的是**战斗点的存活集合**。

---

# 38.4 Attack Order 保留

本规则**不取消速度机制**。继续：

```text
faster valid solver
→ attacks first

slower valid solver
→ attacks second
```

因此计算速度仍然有正式价值 —— 但只决定**结算顺序**，不决定胜负。

先手方打掉对方任何战斗点，都**不会**删除对方的整个本轮攻击。

---

# 38.5 攻击不执行的唯一原因

Shooter 死亡**不是** Runner termination signal。后手算法的进程不会因为它的 Shooter 阵亡而被终止，
它仍然拥有自己完整的官方计算 deadline。

攻击不执行的唯一原因是算法侧：

```text
TIMEOUT / INVALID / CRASH
```

---

# 38.6 Mutual Elimination

新规则下可能出现：先手方清零对方、后手方凭已锁定的攻击权再清零先手方。

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

end reason：

```text
MUTUAL_ELIMINATION
```

不得因为 A 是 First Solver 就自动判 A 赢。

---

# 39. Cancellation 的地位

```text
CANCELLED
```

已**不再是**正式规则中的一条攻击结算路径。

`CANCELLED_A` / `CANCELLED_B` 回合结果码与日志中的 `cancelledA` / `cancelledB` 字段
保留为**历史/兼容**语义，只可能由运行器自身的显式取消（例如 READY 握手失败）产生，
不再由「Shooter 被击杀」产生。

> **历史记录（不删除）**
>
> Previous playtest rule:
> Shooter elimination cancelled the opponent shot.
>
> Round-2 evidence showed this produced strong cancellation dominance.
> 回合级归因显示：fast-vs-optimizer 中取消吞掉 787 次击杀，
> 其中 84.8% 的目标在对局结束时仍存活；Optimizer 曲线本可产生的击杀约 91% 被取消抹掉。
> 由此得出 *在本规则集下，速度影响胜负的唯一通道就是 Shot Cancellation*。
>
> Rule amended by human decision.

旧 counterfactual `CF-NO-CANCEL` 已不再是反事实（它现在就是生产规则），
归档为 **historical counterfactual**；若仍需对照旧规则，使用 `CF-LEGACY-CANCEL`。

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
Second Shot
Kills
Alive State
```

得到 Round Result。

UI 只负责展示。

Visualizer 不得参与正式判定。

---

# 43. Match Win

**胜负只看战斗点**（Rule Revision 3 §9）。Emitter 不计入 `alive`。

结算一轮之后：

```text
aliveCombatPointsA = 0  AND  aliveCombatPointsB > 0   →  B MATCH WINNER
aliveCombatPointsB = 0  AND  aliveCombatPointsA > 0   →  A MATCH WINNER
aliveCombatPointsA = 0  AND  aliveCombatPointsB = 0   →  MATCH DRAW（见下）
```

## 43.1 Mutual Elimination（同归于尽）

同一轮结束后双方**同时**归零：

```text
MATCH DRAW
endReason = MUTUAL_ELIMINATION
```

这是 Locked Attack Right（§38）的直接后果：先手方清零对方之后，后手方仍持有
本轮已锁定的攻击权，可以反过来清零先手方。

> **不得**因为 A 是 First Solver 就把胜利判给 A。先手只决定**结算顺序**，
> 不决定胜负。见 §38.6。

## 43.2 其它判和分支

除同归于尽外，比赛还可能以两种方式判和（Rule Revision 3 §16/§17）：

```text
STALEMATE         连续 20 回合双方都没有击杀  →  MATCH DRAW
HARD_ROUND_LIMIT  到达第 60 回合              →  MATCH DRAW
```

**终止保证**：`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` /
`HARD_ROUND_LIMIT` 四者覆盖全部情形 —— 每场合法比赛都在有限时间内终止，
且由**引擎自身**保证，不依赖任何外部轮数参数。

---

# 44. Stalemate — 已冻结（Rule Revision 3 §16）

当前正式版本：

```text
NO-PROGRESS LIMIT = 20 consecutive rounds
HARD ROUND LIMIT  = 60 total rounds
```

判定：

```text
连续 20 个回合双方合计击杀 = 0   →  STALEMATE  →  MATCH DRAW
到达第 60 回合仍未分出胜负        →  HARD_ROUND_LIMIT  →  MATCH DRAW
```

两条上限都**已在生产引擎中实现**（`src/core/Rules.ts` 的
`STALEMATE_NO_PROGRESS_LIMIT` / `HARD_ROUND_LIMIT`，
`src/core/Match.ts` 的终局判定），并作为 `MatchLog.endReason` 落盘。

> 阈值依据：Revision 3 playtest 的实测分布见
> `playtest/results/revision-3/revision-3-summary.json` 的 `noprogress` /
> `matchlength` 两节。此前「12 consecutive no-progress rounds / 100 total rounds」
> 的拟议数值**未采用** —— 它们是右删失数据的产物，不能直接冻结。

---

# 45. Stalemate 的测量依据

此前已经观察到：

> 某些算法组合可能出现数百 Round 无法自然结束。

因此 Stalemate 是真实问题。冻结阈值前先收集了：

```text
match length
no-progress streak
P50 / P75 / P90 / P95 / P99
maximum
repeated state signatures（同一点集反复出现的局面）
```

关键测量（Revision 3 playtest）：僵持**不是「回合数不够」**。
把上限从 30 抬到 60 后，触顶的对局几乎全部仍未化解 —— 它们是**吸收式不动点**，
不是缓慢收敛。因此阈值只需覆盖「已经冻结的局面」，不需要留很大的余量：
`NO-PROGRESS LIMIT = 20` 就能在大部分吸收态形成后不久收场，
而 `HARD_ROUND_LIMIT = 60` 是最后一道兜底。

---

# 46. No-progress 定义（已冻结）

正式定义（与生产实现一致）：

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

阈值为 **20**；达到即判 `STALEMATE` → `MATCH DRAW`（§44）。

> 判据不看谁先手、也不看函数是否合法：双方都交出合法解但谁也打不中，
> 同样是僵持。`NoProgressStreak` 逐轮写入 `RoundLog`，可事后复核。

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
round result
match result
end reason（ELIMINATION / MUTUAL_ELIMINATION / STALEMATE / HARD_ROUND_LIMIT）
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

以下内容在 Revision 3 之后不得改变：

```text
500 ms timeout
TIE_EPS_MS
public → reveal → START
no preprocessing
same A/B JSON
own official timing anchor
single y=f(x)
Fixed Emitter pass-through
attack direction
DSL operators
AST 128
Depth 12
C²
Convexity <=100
Obstacle stop
Arena boundary stop（首次离开即永久终止、重入不恢复）
First Solver
Locked Attack Right（START 后双方攻击权独立且不可撤销）
Mutual Elimination → MATCH DRAW
Stalemate → MATCH DRAW
HARD_ROUND_LIMIT → MATCH DRAW
Immutable Round snapshot
```

> **已从本清单删除**（Revision 2/3 废止，历史记录见 §39）：
> `Shooter assassination`、`Shot cancellation`、每轮 Shooter Selection 与 SHOOTER LOCK；
> `Shooter pass-through` 改名为 `Fixed Emitter pass-through`。

---

# 55. 当前允许实验但不改变正式规则的项目

Playtest Harness 可以单独实现：

```text
CF-LEGACY-CANCEL     ← 唯一的真反事实：把被废止的取消规则加回来
CF-SIMULTANEOUS
```

用于回答：

```text
legacy cancellation effect
speed effect
```

> `CF-NO-CANCEL` 已**不再是反事实** —— 它在 Revision 2 之后就是生产规则，
> 现改名为 `locked-attack` 并只作为模型保真度核对（见 §39 与
> `playtest/harness/gb_counterfactual.py` 的模块 docstring）。

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

当前版本已完成的评审：

```text
Shooter cancellation balance review   —— 已完成（Revision 2 废止该规则）
Stalemate threshold review            —— 已完成（Revision 3 §16 冻结阈值）
Rule re-gate（Revision 2）             —— CONDITIONAL PASS，P1 已在本轮关闭
```

仍然**未**完成的是：

```text
Final Competition Readiness Audit（独立）
```

在该审计通过之前，不要将 V1.1 Playtest Baseline 宣称为新的最终：

```text
v1.1.0-competition
```

---

# 61. 一句话规则摘要

Geometry Battle 的核心是：

> 每支队伍有一个**固定的 Emitter**（A 在 `(-18,0)`、B 在 `(18,0)`），整场比赛不变、不可更换、不可击杀 —— 它只是本队函数的数学发射锚点。地图揭盲后，裁判发出 START，两支冻结算法同时开始，各自根据**同一份** Round JSON 独立生成一条合法 \(y=f(x)\) 攻击曲线，且必须经过自己的 Emitter。更快返回合法函数的一方先攻击，**但 START 之后双方的攻击权都已锁定，先手打掉对方任何点位都不会取消对方本轮的攻击**。轨迹沿己方攻击方向传播，可连续击杀多个敌人，但遇到第一个障碍物、或**第一次离开 Arena** 之后即**永久停止**（此后即使函数重新入场也不恢复）。每方只剩战斗点可被击杀；一方战斗点全灭即败，双方同轮全灭则判和，连续 20 回合无人击杀或到达 60 回合同样判和。所有判定由 Judge 完成，算法只能决定函数本身。

---

# 62. 当前明确未冻结事项

以下问题必须保持：

```text
OPEN FOR PLAYTEST EVIDENCE
```

而不是让 Agent 自行决定：

1. 是否需要扩大正式 Runtime；
2. 是否需要新的 DSL Operator；
3. 是否需要引入新的策略维度（速度/质量之外）；
4. Stalemate 阈值是否需要在更多数据后微调。

**已由人类决定并冻结、不再属于本清单**：

```text
Shooter cancellation 是否需要修改   → 已废止（Revision 2）
速度先手是否奖励过强                 → 已由 Locked Attack Right + 固定 Emitter 处理
是否采用 Stalemate                   → 采用（Revision 3 §16）
Stalemate 连续无进展阈值             → 20（Revision 3 §16）
Match hard round limit               → 60（Revision 3 §17）
Shooter Selection 是否存在           → 已删除（Revision 3 §5）
```

这些问题只能在后续测试后由人决定。