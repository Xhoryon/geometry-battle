# Round 2 — Algorithm Balance Playtest Report

Geometry Battle V1.1 · 三算法对抗 · 正式规则实验 + 反事实实验

- 协议版本：1.1（`competitor-kit/` 公开接口）
- 测试日期：2026-09-10
- 本轮性质：**Playtest / 平衡性研究，不是平台开发任务**

---

## Git baseline（本轮全部证据的可寻址锚点）

| 项 | 值 |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| HEAD（本轮代码与结果落盘时） | `f9b83a37e8db5ba06b19d4fd1b164e4e16c0993d` |
| **RULE_BASELINE_SHA** | `8f7dc11029e99395ebcf977b85dc93780017ffb1` |
| **ROUND1_BASELINE_SHA** | `6f987bfbd0ebbf9978cf1546817aa097e844e641` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904`（本轮**未改变**） |

**Canonical rule path**（本轮唯一权威规则输入，未修改、未重命名）：

```
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

> 任务书 §0 引用的 `Plans/Input/Geometry Battle V1.1 Playtest Rules.md` 在本仓库**不存在**。
> 按用户裁决，本轮所有对该名称的引用统一解释为上述 canonical 路径。
> 这是一个 **DOCUMENTATION FINDING**，见 §16。

---

## 1. Executive Summary

第一轮的核心问题是：Fast Tactical Solver 的 50-0-10 统治，究竟来自合理的算法 meta，还是
First Solver + Shooter Cancellation 把策略空间压扁了？

本轮给出**明确答案：后者**，且是定量的。

加入第三套算法 **Hybrid Tactical-First Anytime Optimizer** 后（180 场正式规则比赛 + 360 场
反事实模拟 + 600 次离线鲁棒性矩阵）：

| 结论 | 答案 |
|---|---|
| A. Hybrid 是否实质缩小了与 Fast 的差距？ | **YES** — 官方规则下 Fast 26 / Hybrid 8 / Draw 26（对比第一轮的 50-0-10） |
| B. Shooter Cancellation 是否是 Fast 统治的主要成因？ | **YES** — 移除取消后胜负**完全反转**：50-0-10 → **2-38-20** |
| C. 先手速度是否过度压制了函数质量？ | **YES** — 仅 fast-vs-optimizer 一项，取消就吞掉了 **430 次**本可发生的击杀（Optimizer 实际全场只有 76 次） |
| D. 是否应在冻结锦标赛规则前修改官方规则？ | **建议 YES（仅建议，未实施）** |
| E. 现有证据是否足以定义 Stalemate Rule？ | **YES（阈值建议见 §14，未实施）** |

最关键的一条结构化发现：

> 在本规则集下，**速度对胜负的影响只有一条通道，就是 Shot Cancellation 本身。**
> 移除先手顺序（CF-SIMULTANEOUS）与只移除取消（CF-NO-CANCEL）在 **180/180** 次比较中
> 逐回合完全相同——因为 §40/§41 的「冻结回合快照」使两者成为同一个操作。

---

## 2. Baseline Reproduction

### 2.1 从已提交证据独立复现 Round 1

不采信第一轮报告的结论，只用 `ROUND1_BASELINE_SHA` 的内容重算：

```
git archive 6f987bf | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results
```

结论：**exit 0，全部对账通过**。唯一事实源为 `raw/*/match.json`（平台自己落盘的产物），
独立推导出：

| 项 | 复现值 | 报告声称 |
|---|---|---|
| matches / conditions / distinct map hashes | 60 / 30 / 30 | 60 / 30 / 30 |
| rounds / 算法调用次数 | 585 / 1170 | 585 / 1170 |
| fast / optimizer / draw | 50 / 0 / 10 | 50 / 0 / 10 |
| INVALID / TIMEOUT | 0 / 0 | 0 / 0 |
| optimizer 被取消 | 304 | 304 |
| fast blocked / kills / shooter kills / multi | 147 / 464 / 304 / 128 | 同左 |
| optimizer blocked / kills / shooter kills / multi | 244 / 76 / 28 / 34 | 同左 |
| kills per valid shot | 0.793 / 0.270 | 同上 |
| first-shot rate | 1.000 / 0.000 | 同上 |
| 交叉验证 | 866/866 一致，0 mismatch | 同上 |
| swap 一致性 | 21/21 | 同上 |
| max-rounds 僵持 | 10 | 10 |
| 计算时间中位 | 12.8 / 142.1 ms | 同上 |

**BASELINE REPRODUCTION PASSED** — 第一轮结论可被第三方仅凭 Git commit 定位与复核。

### 2.2 平台确定性复核

第二轮把 `fast-vs-optimizer` 用**同一批 30 个条件**完整重跑了一次（60 场）。结果与第一轮
**逐项相同**：50-0-10、585 轮、fast 464 击杀、optimizer 304 次取消、first-shot 1.000/0.000。

> 平台对「固定算法对 + 固定种子 + 固定条件」是**完全确定**的。第一轮 baseline 因此不仅可复现，
> 而且可重放。（唯一不稳定的量是计时本身——见 §15。）

---

## 3. Hybrid Design

`playtest/competitors/solver-hybrid/` — **Hybrid Tactical-First Anytime Optimizer**

设计契约（任务书 §9）：

> 在任意较早时间停止，都已经拥有一个可执行的合法候选；随着计算继续，函数质量逐步提高。

这不是一句口号，而是字面实现的：第一个被构造的东西就是一条保证合法的 fallback；
`best` 在任何候选胜过它时立即更新；每个阶段边界都是「此刻停手也能交卷」的点。

| 阶段 | 内容 | 实测（1170 个世界） |
|---|---|---|
| **Stage 1 战术** | 刺杀直线（own shooter → enemy shooter）、对每个敌点的直线、恰过（对方 Shooter + 任一敌点）的二次曲线、单参数 bend 族扫描 | 中位 **3.26 ms**，候选中位 18 |
| **Stage 2 多目标** | ≤3 点精确有理插值、三角函数族、复合函数族 | 仅 631/1170 次进入，中位 5.99 ms |
| **Stage 3 深挖** | 自由度扫描下更大的目标组合、局部细化 | 仅 598/1170 次进入，中位 0.01 ms（多数无产出） |

**EARLY RETURN（§6）**：Stage 1 不是对解空间的采样，而是**整个廉价战术族**。因此 Stage 1
走完时若已持有 shooter kill 或 ≥2 杀，**立即开火、不再进入后续阶段**。

实测早返回分布：

| 停止原因 | 占比 |
|---|---|
| `stage1: shooter + another kill`（2 杀含 shooter） | 30.2% |
| `stage1: decisive tactical shot`（持有 shooter kill 或 ≥2 杀） | 15.9% |
| `stage2: shooter + another kill` / `triple kill` | 1.5% / 1.4% |
| `stage3: shooter + another kill` | 0.1% |
| budget exhausted（无决定性解，走完全部阶段） | 51.0% |

**46.1% 的回合在 Stage 1 直接开火**，这正是 Hybrid 能在速度上与 Fast 同档的原因。

### 3.1 几何与合法性

曲线一律写成以自身 Shooter 为原点的增量形式：

```
V = (x − x_s) / L,   f(x) = y_s + g(V),   g(0) = 0
```

- `f(x_s) = y_s` 因此是**恒等式**，不会漂移到 1e-6 的 Shooter 容差边缘（kit §9 的建议）。
- `L` 把攻击区间归一化到 `|V| ≤ 1`，多项式系数自然落在 `|const| ≤ 1000` 内。
- 多项式插值用 `fractions.Fraction` **精确求解**。目标点在 V 上聚集时 Vandermonde 病态，
  系数会冲到 3×10⁴ 量级——这类组合被**显式跳过**，而不是花代价解一个注定失败的方程。
- 轨迹扫描是**保守**的：无法证明通畅即判 blocked。误判 blocked 只损失一次击杀，误判 clear 损失整轮。

### 3.2 规则来源（合规声明）

Hybrid 的设计输入**只有**冻结的 Playtest Rules 与公开的 `competitor-kit/`。
场地边界终止取自 Playtest Rules §34 明文，并在第一轮由独立黑盒 cross-check（866/866）确认。
未使用任何未公开常量。

> **流程说明（主动披露）**：编制 competitor-kit 参考文档时，一个子 agent 读取了
> `src/core/Judge.ts`。该处得到的内部细节（采样步长 `min(0.005, π/(8ω))`、`maxPoints`、
> `OBSTACLE_CONTACT_EPS`、`penetration` 约定）**已明确排除在 Hybrid 设计输入之外**，
> 未以任何形式进入算法。y 边界终止规则本身属规范 §34 公开内容，不构成泄漏使用。

---

## 4. Hybrid Benchmark

### 4.1 Local Validator / Official Preflight

```
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
包哈希 a11dbf0a47622305ac123b2efeec07d8d4d653c955cc69f6f00b1f8dd44942b
Team A / Team B 耗时 14.7 / 14.9 ms（上限 2000 ms）
```

### 4.2 离线鲁棒性矩阵（§10）

公开 operator CLI **无法产出 0 或 1 障碍的地图**（本轮独立复验：`--obstacles 0` /
`--obstacles 1` 均被拒为未知选项；`--difficulty` 只映射 easy=2 / medium=4 / hard=6）。
因此 0/1 障碍的**平台级比赛**无法在不读取 MapGenerator 的前提下产生——记为 TEST LIMITATION。

算法侧的矩阵验证在离线完成（`playtest/harness/gb_matrix.py`，合成世界 + 公开合法性筛查 +
黑盒命中模型）：

| 包 | runs | illegal | TIMEOUT | no result |
|---|---|---|---|---|
| **solver-hybrid** | 600 | **0** | **0** | **0** |
| solver-fast | 600 | 0 | 0 | 0 |
| solver-optimizer | 600 | 0 | 0 | 0 |

形状覆盖：障碍 {0, 1, 2, 4, 6} × 人数 {6, 8, 10} × 队别 {A, B} × 20 seeds。
Hybrid 在 0 障碍时平均预测击杀 2.00，6 障碍时 1.60–1.88。

### 4.3 与另两套算法的对照

| 指标 | Hybrid | Fast（Round-1 bench） | Optimizer（Round-1 bench） |
|---|---|---|---|
| 非法 / 崩溃（1170 次） | **0** | 0 | 0 |
| 墙上时间中位 | 29.4 ms | 27.2 ms | 189.7 ms |
| 墙上时间 p95 / max | 85.8 / 493.9 ms | 53.5 / 75.8 ms | 332.6 / 14741 ms |
| 自身口径耗时中位 | 8.6 ms | — | — |
| 预测命中对方 Shooter | 48.3% | 53.6% | 55.0% |
| 预测击杀均值 | 0.93 | 0.97 | 1.43 |

**ALGORITHM FINDING**：Hybrid 与 Fast 同属速度档（中位 29.4 vs 27.2 ms）。

**ALGORITHM FINDING（Stage 3 的边际价值）**：在 1170 个真实世界上，Stage 3 产出了候选
（最多 235 个）却只改变了 **1 次**最终选择。因此在当前规则集上，**一旦战术解存在，更深的曲线
拟合几乎不产生价值**——这本身就是「先手速度是否过度压制函数质量」的一条直接回答。

---

## 5. Current-rule Results

规模（§13）：每组 pair 均为 **30 个条件 × 槽位互换 = 60 场**。

- 条件集与第一轮**完全相同**（同 seeds / 人数 / 难度），因此可与 Round-1 直接比较。
- 地图：6v6 / 8v8 / 10v10 × easy / medium / hard，30 个互不相同的地图哈希。
- 外部轮数上限 `--max-rounds 30`（**仅测试护栏，非比赛规则**）。
- 三组共 **180 场**，合计运行约 1900 秒。

| pair | 胜者 A | 胜者 B | Draw | 判定 |
|---|---|---|---|---|
| **fast-vs-hybrid** | Fast **26** | Hybrid **8** | **26** | Fast 仍占优，但差距大幅收窄 |
| **optimizer-vs-hybrid** | Hybrid **39** | Optimizer **4** | **17** | Hybrid 复刻 Fast 对 Optimizer 的压制方式 |
| **fast-vs-optimizer** | Fast **50** | Optimizer **0** | **10** | 与第一轮逐项一致（确定性的完整重放） |

**0 INVALID · 0 TIMEOUT · 0 CRASH**（180 场 / 2316 轮 / 3774 次实际执行的射击）。

---

## 6. Fast vs Hybrid（§15 的核心问题）

| | Fast | Hybrid |
|---|---|---|
| wins | **26** | **8** |
| draw | 26 | 26 |
| first-shot rate | **0.768** | 0.232 |
| 被取消轮次 | 117 (11.8%) | 187 (18.9%) |
| kills | **378** | 260 |
| shooter kills | **193** | 118 |
| kills per valid shot | **0.433** | 0.324 |
| multi-kill rate | 0.146 | 0.097 |
| no-hit rate | 0.766 | 0.842 |
| 计算时间中位 | 16.1 ms | 23.6 ms |

对比第一轮 `Fast 50 / Optimizer 0 / Draw 10`：

- Hybrid 把对手的净胜差从 **+50** 压到 **+18**，且拿到 8 场胜利（Optimizer 是 0 场）。
- **Hybrid 确实形成了第一轮所缺少的可适应 Tactical Meta** —— 它用与 Fast 相同的战术族
  （刺杀直线 + 精确两点曲线）在 46% 的回合里直接开火。

但仍然落后，原因在速度分布而非战术选择：

- Fast 在 **76.8%** 的回合先手；Hybrid 只有 23.2%。
- Hybrid 的中位耗时（23.6 ms）虽与 Fast（16.1 ms）同档，但**尾部重**：51% 的回合进入
  Stage 2/3，耗时可达 60–490 ms。一旦进入这些回合，Hybrid 必然后手，可被取消。

**ALGORITHM FINDING**：Hybrid 的失速发生在**它不持有 shooter kill 的回合**。而速度只有在
「我方射击能杀掉对方 Shooter」时才产生收益（取消对方整轮）；不持有 shooter kill 的回合里，
先手本身收益很小。这个耦合意味着 Hybrid 的预算策略是自洽的：**它在速度真正值钱的时候快，
在不值钱的时候慢**。

---

## 7. Optimizer vs Hybrid

| | Hybrid | Optimizer |
|---|---|---|
| wins | **39** | **4** |
| draw | 17 | 17 |
| first-shot rate | **0.9987** | 0.0000 |
| 被取消轮次 | **0** | 250 (33.7%) |
| kills | **434** | 144 |
| shooter kills | **250** | 47 |

Hybrid 对 Optimizer 的统治形态，与 Fast 对 Optimizer **完全同构**：更快 → 每轮必先手 →
33.7% 的回合直接把对方整轮取消。

这是本轮最有说服力的一条对照：**同一套规则下，两套互不相关的快算法，用同一种机制碾压了
同一套慢算法。** 速度优势的传递路径被复现了两次。

---

## 8. Slot Swap

每种地图条件都跑了 `X = Team A` 与 `Y = Team A` 两种排布，使用**同一 seed**（看到同一张图）。

| pair | fast-A 排布 | 另一排布 | swap 一致 / 翻转 |
|---|---|---|---|
| fast-vs-hybrid | Fast 13 / Hybrid 4 / Draw 13 | Fast 13 / Hybrid 4 / Draw 13 | 6 / 6 |
| optimizer-vs-hybrid | Hybrid 20 / Opt 2 / Draw 8 | Hybrid 19 / Opt 2 / Draw 9 | 14 / 3 |
| fast-vs-optimizer | Fast 26 / Opt 0 / Draw 4 | Fast 24 / Opt 0 / Draw 6 | 21 / 0 |

**结论：未发现槽位 / 队别偏置。**

- fast-vs-hybrid 两种排布**逐项完全对称**（13/4/13 vs 13/4/13）。
- 全量 A/B 槽位计时中位数均为 **21.2 ms**；先手占比 A=0.5099 / B=0.4896。
- 因此 §24 的 `PLATFORM FINDING` 条件不成立。

值得注意的是 fast-vs-hybrid 的 swap 一致性只有 6/6（对手是 fast-vs-optimizer 的 21/0）。
这不是偏置，而是**方差**：两套同档快算法之间，同一张图的胜负对极小的时序抖动敏感。

---

## 9. Counterfactual No-Cancel（§16 / §19）

模式定义（规范 §39/§55 只给出名称与用途，**未定义精确语义**；以下为本 harness 的定义，已记录）：

> **CF-NO-CANCEL**：保留 §36 First Solver 与冻结快照，只移除 §38。
> 先手射击照常结算；后手**即使其 Shooter 刚刚阵亡，只要它已产出合法函数，其攻击仍然执行**。

这是**独立的一条代码路径**，因此「两种模式是否等价」是测量结果而非假设。

### 结果：胜负完全反转

| | Fast | Optimizer | Draw |
|---|---|---|---|
| **官方规则** | **50** | **0** | 10 |
| **CF-NO-CANCEL** | **2** | **38** | 20 |

| | Hybrid | Optimizer | Draw |
|---|---|---|---|
| **官方规则** | **39** | **4** | 17 |
| **CF-NO-CANCEL** | **3** | **37** | 20 |

| | Fast | Hybrid | Draw |
|---|---|---|---|
| **官方规则** | **26** | **8** | 26 |
| **CF-NO-CANCEL** | **13** | **10** | **37** |

读法：

- **Fast-vs-Optimizer 与 Hybrid-vs-Optimizer 被彻底翻转。** Optimizer 在两种对阵中都从
  「几乎不可能赢」变成「压倒性多数赢」。取消规则不是 Fast 的加分项，而是 Optimizer 的**否决项**。
- **Fast-vs-Hybrid 几乎不动**（净差 +18 → +3，主要变化是 draw 26→37）。这说明 Hybrid 与
  Fast 之间的差距**不是**取消造成的，而是真实的质量/速度差异——两条不同的证据线互相独立地
  指向同一结论。

---

## 10. Counterfactual Simultaneous（§17 / §20）

> **CF-SIMULTANEOUS**：§36 与 §38 一并移除。不存在 first solver；双方合法函数都对 START
> 快照结算。

### 结果：与 CF-NO-CANCEL 在 180/180 次比较中**逐回合完全相同**

| pair | 官方 | CF-NO-CANCEL | CF-SIMULTANEOUS | 两者一致 |
|---|---|---|---|---|
| fast-vs-optimizer | 50-0-10 | 2-38-20 | 2-38-20 | 60 / 60 |
| optimizer-vs-hybrid | 39-4-17 | 3-37-20 | 3-37-20 | 60 / 60 |
| fast-vs-hybrid | 26-8-26 | 13-10-37 | 13-10-37 | 60 / 60 |

比较粒度是**逐回合击杀列表**，不只是胜者。

**RULE-DESIGN FINDING（本轮最重要的结构性结论）**：

> 在本规则集下，**速度影响胜负的唯一通道就是 Shot Cancellation。**
>
> 原因在规范自身：§40/§41 规定双方攻击都基于 START 时的**冻结回合快照**，后手不重新计算。
> 既然两条曲线都对同一快照结算，那么「谁先攻击」除了触发取消之外，**对结果没有任何影响**。
> 因此「移除顺序」与「只移除取消」在数学上是同一个操作。

这一点也回答了 §20 的问题：**当速度不再影响执行顺序时，三者的相对强弱明显改变**——
但改变完全来自取消的消失，而非顺序本身。

---

## 11. Cancellation Effect（§19）

### 11.1 回合级取消代价（在官方世界上，仅移除取消重解）

| pair | 算法 | 轮次 | 被取消 | 其中本可命中 | **损失击杀** | 损失的反杀 Shooter |
|---|---|---|---|---|---|---|
| fast-vs-optimizer | optimizer | 585 | 304 (52.0%) | **213** | **430** | 60 |
| optimizer-vs-hybrid | optimizer | 741 | 250 (33.7%) | **189** | **389** | 59 |
| fast-vs-hybrid | hybrid | 990 | 187 (18.9%) | **160** | **294** | 68 |
| fast-vs-hybrid | fast | 990 | 117 (11.8%) | **100** | **116** | 60 |

取「被取消的回合」离线重跑该方算法、取得其**真实**函数，再按「取消被移除」重解。

最刺眼的一个数字：**fast-vs-optimizer 中，取消吞掉了 430 次击杀，而 Optimizer 全场实际
只打出 76 次击杀。** 取消机制抹掉了 Optimizer 曲线所能产生的击杀的约 **85%**。

同时，60 次被取消的射击**本身就是对 Fast Shooter 的反杀**——若允许执行，Optimizer 在
52% 的回合里本可以反过来取消 Fast 的整轮。取消规则把「互相刺杀」的单边博弈固化成了
「先手单方面刺杀」。

### 11.2 被取消函数的预测质量

「损失击杀 430」是**预测**，不是「本会实现的击杀」：真实世界里对手会调整射击，世界会演化。
但注意 CF-NO-CANCEL 的**前向模拟**（世界在反事实下自由演化）独立给出了同向且更强的结论：
Optimizer 从 0 胜变成 38 胜。两条方法线（回合级归因 + 前向模拟）结论一致。

---

## 12. Speed Effect（§20）

全量三组数据的关键指标：

| 算法 | 轮次 | first-shot rate | 被取消率 | kills / valid shot |
|---|---|---|---|---|
| fast | 1458 有效射 | **0.854** | 0.074 | **0.578** |
| hybrid | 1544 | 0.560 | 0.108 | 0.449 |
| optimizer | 772 | **0.000** | **0.418** | 0.285 |

**速度阶梯被完整复现**：Fast > Hybrid > Optimizer，且在 first-shot rate、取消率、
kills-per-shot 三个维度上单调。

回答 §20 的问题：

> 当速度不再影响执行顺序时，Fast / Hybrid / Optimizer 的相对强弱是否明显改变？

**是，且改变是彻底的。** Optimizer 从两种对阵中的全败变为压倒性多数胜。而由于
§10 已证明「顺序」本身无影响，这个改变**完全归因于 Shot Cancellation 的消失**。

---

## 13. No-progress Distribution（§21）

No-progress 定义采用规范 §46 的候选定义：某回合双方击杀均为 0 则 streak +1，任一方产生
击杀则归零。

| 分位 | 连续零击杀轮数（n = 180 场） |
|---|---|
| P50 | 0 |
| P75 | **21** |
| P90 | **25** |
| P95 | **26** |
| P99 | **28** |
| MAX | **29** |
| mean | 7.03 |

分组：

| pair | P75 | P90 | P95 | MAX |
|---|---|---|---|---|
| fast-vs-hybrid | 23.25 | 26.0 | 26.0 | 28 |
| optimizer-vs-hybrid | 21.25 | 25.1 | 26.0 | 29 |
| fast-vs-optimizer | 0.0 | 22.1 | 23.1 | 28 |

**关键限制**：分布是**右删失**的——harness 用了 `--max-rounds 30`，因此 29 是观测上限，
真实尾部不可见。上表的分位数只能作为**下界**使用。这是 TEST LIMITATION，阈值建议已计入。

---

## 14. Match Length Distribution（§21 / §22）

| 分位 | 对局轮数（n = 180） |
|---|---|
| P50 | 6 |
| P75 | **30** |
| P90 | **30** |
| P95 | **30** |
| P99 | **30** |
| MAX | 30 |
| mean | 12.87 |

打到 30 轮上限（判 `UNDECIDED`）的比例：

| pair | 僵持 / 总数 | 比例 |
|---|---|---|
| **fast-vs-hybrid** | 26 / 60 | **43.3%** |
| optimizer-vs-hybrid | 17 / 60 | 28.3% |
| fast-vs-optimizer | 10 / 60 | 16.7% |
| **合计** | **53 / 180** | **29.4%** |

**RULE-DESIGN FINDING**：僵持率与「双方的速度档是否接近」强相关。
第一轮只有一套快算法（17% 僵持）；本轮最快的一对（Fast vs Hybrid）把僵持率推到 **43.3%**。
即：**当两套算法都快要到「互相都能先手取消」时，对局最常以双方都无法推进收场。**

### Stalemate 证据充分性（§22）

**YES，证据足以支持一个合理阈值**，但**本轮不实现正式 Stalemate Rule**（§22 明确禁止）。

数据依据与候选阈值：

- 观测到的 P90 / P95 连零击杀长度为 25 / 26，MAX 29（右删失）。
- 观测到的对局轮数 P75 已达上限 30，29.4% 的对局触顶。
- 候选 **no-progress threshold**：**连续 20 轮双方零击杀**。
  理由：P75 = 21 落在此阈值附近，能够在真正长尾的僵持（P90+ 的 25–29 段）之前截断，
  同时不会误伤正常对局（P50 = 0，正常对局中位仅 6 轮）。
- 候选 **hard round limit**：**30 轮**。
  理由：当前测试已用 30 作为外部护栏且 29.4% 触顶，与规范 §44 曾讨论的 `100 total rounds`
  相比更贴近实测分布；采纳 30 可直接复用本轮全部数据作为回归基线。

> 两个阈值均为**建议**。按 §44，它们当前是 `PROPOSED` 而非 `FROZEN`，不得提前写入正式 Judge。

---

## 15. Platform Findings

### 15.1 计时异常批次（§23）— 已识别、已隔离、已重跑

巡检发现 **8 场比赛**出现单侧计算时间 > 300 ms 的回合（同期正常值为 13–40 ms）。
其中 **2 场为实质性污染**：

| 比赛 | 异常轮数 | 最大耗时 |
|---|---|---|
| `fast-vs-hybrid / s303-p6-medium__fast-A` | 22 / 60 | **935.7 ms** |
| `fast-vs-hybrid / s1111-p10-medium__fast-A` | 28 / 60 | 357.3 ms |

特征：**双方同时**被拖慢，`aErrorCode`/`bErrorCode` 均为 `null`，无取消——
是宿主级停顿，**不是算法失败**。

处理：

1. 原始产物完整保留在 `playtest/results/round-2/platform-contaminated/`（含
   `CONTAMINATION.json`，记录了 matchId / seed / 异常轮次 / 双侧耗时）。
2. 8 场全部重跑。
3. **重跑后胜负与轮数 100% 一致，无任何结果变化**；`s303` 的最大耗时从 935.7 ms 回落到 74.7 ms。

诚实归因：`s1111-p10-medium__fast-A`（13:00:19 完成）的窗口与本轮作者执行的一次
`validate-submission` 重负载检查重叠；`s303` 与已知的跨回合沙箱停顿特征一致。
两者均属 **PLATFORM-CONTAMINATED / 环境噪声**，不计为算法结果。

### 15.2 未发现队别 / 槽位偏置（§24）

见 §8：两种排布逐项对称，A/B 槽位计时中位数相同（21.2 ms），先手占比 0.5099 / 0.4896。

### 15.3 轨迹终止原因分布（本轮新增观测）

| 算法 | 障碍终止 | **场地边界终止** | 正常到达域末 | 无函数/被取消 |
|---|---|---|---|---|
| fast | 11.9% | **55.3%** | 25.3% | 7.4% |
| hybrid | 64.8% | 6.4% | 18.0% | 10.8% |
| optimizer | 50.2% | 1.7% | 6.3% | 41.8% |

第一轮报告 §5 Finding 1 指出的「场地边界终止未写入 competitor-kit」在本轮被进一步量化：
**Fast 有 55.3% 的回合是被场地边界终止的**，远高于障碍终止。这条未公开的规则对直线型
策略的影响是结构性的——第一轮的这个文档缺口值得优先修复。

### 15.4 平台确定性

`fast-vs-optimizer` 在第二轮完整重放第一轮的 60 场，结果逐项相同（见 §2.2）。
未发现平台在**判定**层面存在不确定性；不确定的只有计时（§15.1）。

---

## 16. Rule-design Findings

1. **【核心】速度的唯一作用通道是 Shot Cancellation。**
   CF-NO-CANCEL 与 CF-SIMULTANEOUS 在 180/180 次比较中逐回合相同。原因是 §40/§41 的冻结
   快照使「顺序」本身不产生任何结果差异。**任何关于「先手优势是否过强」的讨论，本质上都是
   关于 §38 Shot Cancellation 的讨论。**

2. **取消规则决定了慢算法的命运，而不是决定了快算法的优势。**
   移除取消后 Optimizer 从 0 胜变 38 胜。现行规则的净效果是：**当双方速度档不同，慢方几乎
   被完全否决**；当双方速度档相同（Fast vs Hybrid），取消带来的净差只有 +3。

3. **当前规则形成了单边刺杀均衡。**
   被取消的射击中有 60 次本身就是对 Fast Shooter 的反杀。取消规则把「互相刺杀」的单边化为
   「只有先手能刺杀」，从而把博弈压缩成纯速度竞赛。

4. **策略空间并未完全塌缩，但已高度收窄。**
   任务书 §15 的判据是「所有优化方案是否都必须退化为最快击杀 Shooter 才能竞争」。
   本轮答案是**接近但不完全**：Hybrid 用与 Fast 同族的战术解 + 46% 的早返回实现了可竞争性，
   但它的胜负仍由 first-shot rate 决定。**RULE HEALTH → TACTICALLY ADAPTIVE 与
   CANCELLATION-DOMINATED 的叠加**（见 §19）。

5. **僵持率随双方速度接近而飙升。**
   43.3% 的最新一对僵持率，说明规则缺乏终止条件时，「势均力敌」会表现为「双方都无法推进」。

6. **收敛性**：CF 结果**不**自动构成规则修改依据（§27）。以上全部为候选，供人类决策。

---

## 17. Documentation Findings

1. **任务书引用了不存在的文件名。** 任务书 §0 要求读取
   `Plans/Input/Geometry Battle V1.1 Playtest Rules.md`，但本仓库从无此文件；canonical 路径为
   `Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md`。
   建议修正任务书，避免后续轮次重复触发 §0 门禁。

2. **场地边界终止条件仍未写入 competitor-kit。** 承接第一轮 Finding，本轮量化了其影响
   （Fast 55.3% 的回合被边界终止）。`competitor-kit/ALGORITHM_REQUIREMENTS.md` §6 与
   `DSL_SPECIFICATION.md` §7 只写了「首次障碍物接触」终止。

3. **规范未定义 CF-NO-CANCEL / CF-SIMULTANEOUS 的语义**（§39/§55 只给名称与用途）。
   本 harness 的定义已写入 `gb_counterfactual.py` 的模块 docstring，供后续轮次复用或修订。

4. **`aBlocked` 字段的精确谓词未公开。** 本轮的 OFFICIAL MODE 校验发现：轨迹在**场地边界**
   终止时的 315 个回合中，平台 `blocked` 取值为 `True` 106 次 / `False` 209 次，模型无法从
   公开规则复现该谓词。该字段不参与反事实计算，故不影响本轮任何结论，但**建议公开其定义或
   在 kit 中说明其语义**，否则第三方无法完整复核平台的 blocked 统计。

---

## 18. Harness Integrity（§18 门禁）

Counterfactual Harness 的 OFFICIAL MODE 必须与官方平台结果 100% 一致，否则不得运行反事实统计。

```
python3 playtest/harness/gb_counterfactual.py verify --raw playtest/results/raw
```

| 检查项 | 检查次数 | 失配 |
|---|---|---|
| 命中列表（逐发） | 866 | **0** |
| **轨迹终止点 x（对比平台记录的轨迹末点）** | 866 | **0**（容差 5e-3） |
| 取消谓词（先手击杀对方 Shooter） | 585 | **0** |
| aliveAfter 存活集合 | 585 | **0** |
| 比赛胜者 | 60 | **0** |
| `blocked` 标志（信息项，不参与计算） | — | 106（已披露，见 §17.4） |

**RESULT: 100% AGREEMENT on every quantity the counterfactual consumes.**

其中「轨迹终止点对比平台自身记录的轨迹末点」是最强的一项检查：它不是对我方模型的内部
自洽性检查，而是直接与平台走出的轨迹逐发比对。

---

## 19. Rule Health Verdict（§25）

### 判定：`CANCELLATION-DOMINATED`（叠加 `TACTICALLY ADAPTIVE`）

规范 §57 列出的五个类别是**待判定的测试结论类别，不是预先假定的结论**，且未给出阈值。
本报告的判定标准与数据依据如下。

**为什么不是 `HEALTHY`**：
- 移除一条平衡性规则即可把 50-0-10 反转为 2-38-20，胜负对单条规则极端敏感。
- 29.4% 的对局在护栏上限处收场，规则集缺少终止条件。

**为什么不是 `STRUCTURALLY COLLAPSED`**：
- 规范 §58 给出的塌缩判据是「所有优化方案都必须退化为最快击杀 Shooter 才能竞争」。
- 本轮 Hybrid 证明**算法可以适应这个 meta**：它用战术优先 + 46% 早返回拿到 8 胜 26 平，
  并把净差从 +50 压到 +18。因此策略空间是**收窄**（narrowed），不是**塌缩**（collapsed）。

**为什么是 `TACTICALLY ADAPTIVE`（叠加项）**：
- Hybrid 的战术族与 Fast 同构，且确实形成了可竞争的路线。算法侧的适应是有效的。

**为什么主导项是 `CANCELLATION-DOMINATED`**：
- CF-NO-CANCEL 与 CF-SIMULTANEOUS 完全等价（180/180），证明**速度的全部影响都经由取消规则**。
- 取消一旦移除，两场对阵的胜负彻底反转，而唯一的「同速对抗」（Fast vs Hybrid）几乎不动。
- 即：**当前规则的支配性结构就是 Shot Cancellation，它决定了谁能射击、谁不能。**

---

## 20. Limitations

1. **0 / 1 障碍地图无法通过公开 CLI 触达**（本轮独立复验）。
   §10 的这两个形状只在**算法侧**离线矩阵中验证（600 次 × 3 包，0 异常），
   未做平台级比赛。这是不可补足的平台接口限制，除非读取 MapGenerator。
2. **No-progress 与 match length 分布右删失**（`--max-rounds 30`）。观测 MAX 29 是上限
   而非真实极值；所有分位数只能作为下界。
3. **CF 的语义由本 harness 定义**（规范未定义）。换一种定义可能给出不同的反事实数值。
   定义已完整记录，可复核与替换。
4. **CF 模拟沿用官方 match 的 map 序列**（逐轮的 obstacles 与固定点位），只让存活集合在
   反事实下演化。障碍无法离线再生（属平台内部），点位在本游戏中不移动，因此这是**精确**的
   而非近似——但世界演化路径与原局不同，这是反事实的固有性质。
5. **CF 中重跑的求解器在离线环境执行**（无 sandbox 的 1 核 / 512 MB / 线程=1 限制）。
   三套算法均为单线程纯 Python，未观察到环境影响；但严格意义上离线预算不等于沙箱预算。
6. **计时不受控**：`--max-rounds 30` 的僵持对局耗时最长（~26 s），不同 pair 的总墙钟
   在 553–709 s 之间。本轮实验期间宿主存在并发负载（见 §15.1）。
7. **样本规模**：每 pair 60 场 / 30 张独立地图。对 26-8-26 这样接近的比分，
   统计功效有限（见 §8 的 swap 翻转 6/6）。
8. **只有三套算法**，且 Hybrid 由本轮作者设计。Hybrid 的设计选择（例如 SHOOTER_WEIGHT=1.5）
   会影响其表现；这些选择已记录在源码注释中，但未做敏感性扫描。

---

## 21. Recommendations

**全部为建议。按 §27 与本轮约束，未实施任何规则修改，也未修改 production。**

| # | 建议 | 依据 |
|---|---|---|
| R1 | **将 §38 Shot Cancellation 提交人类决策复核。** 候选方案：改为「取消仅在后手**未产出合法函数**时生效」，即 CF-NO-CANCEL 的规则化。 | §9/§11：移除后胜负反转，且两场对阵的统治结构消失 |
| R2 | **优先修复 competitor-kit 的场地边界终止文档缺口。** | §15.3/§17.2：Fast 55.3% 的回合受此影响 |
| R3 | **引入 Stalemate Rule**：候选 `MAX_NO_PROGRESS_ROUNDS = 20`、`HARD_ROUND_LIMIT = 30`。 | §14：P75=21、29.4% 对局触顶 |
| R4 | **公布 `aBlocked` 的判定谓词**，或从 kit 中移除该统计口径。 | §17.4：第三方无法复核该字段 |
| R5 | **修正任务书 §0 的规则文件名引用。** | §17.1：本轮因此触发 §0 门禁 |
| R6 | **在后续轮次扩大样本**（≥100 条件 × swap）再决定 R1 与 R3 的最终取值。 | §20.7：26-8-26 的统计功效不足 |
| R7 | **若采纳 R1，必须补做一轮回归**：取消规则的改动会同时影响 `Shooter assassination` 的价值、僵持率、以及 fast 的相对地位，需要完整重测。 | §59 Rule Change Procedure |

---

## 22. 最终回答（§29）

**A. Did Hybrid materially close the gap to Fast?**

> **YES.**
>
> 官方规则下 Fast 26 / Hybrid 8 / Draw 26，对比第一轮的 Fast 50 / Optimizer 0 / Draw 10。
> 净胜差从 +50 压到 +18；Hybrid 拿到 8 场胜利（第一轮第三套算法拿 0 场），
> 并在 46.1% 的回合里以战术解直接开火。
> 在反事实（去掉取消）下，两者几乎持平：Fast 13 / Hybrid 10 / Draw 37（净差 +3）。

**B. Is Shooter Cancellation a major contributor to Fast dominance?**

> **YES.**
>
> 移除取消后 fast-vs-optimizer 从 **50-0-10** 反转为 **2-38-20**；
> optimizer-vs-hybrid 从 **39-4-17** 反转为 **3-37-20**。
> 回合级归因显示，取消在 fast-vs-optimizer 中吞掉了 **430 次**本可发生的击杀
> （Optimizer 实际全场仅 76 次），其中 60 次是对 Fast Shooter 的反杀。
> 且 CF-NO-CANCEL ≡ CF-SIMULTANEOUS（180/180），说明**速度的全部作用都经由取消规则传递**。

**C. Does first-solver speed excessively suppress function quality?**

> **YES.**
>
> 三层证据：
> (1) 回合级：430 / 389 / 294 次击杀在三种对阵中因取消而未被执行；
> (2) 前向模拟：移除取消后慢算法的胜场从 0 → 38、4 → 37；
> (3) 算法内证据：Hybrid 的 Stage 3（更深的曲线拟合）在 1170 个世界上只改变了 1 次结果——
> **即使把时间给它，更高质量的函数也不产生价值**，因为在它能开火之前回合就已经被取消。

**D. Should the official rules change before proceeding toward tournament freeze?**

> **YES（建议）。**
>
> 依据 §19 的 `CANCELLATION-DOMINATED` 判定与 §21 的 R1/R2/R3。
>
> **本轮未实施任何修改，也未修改 production（§27）。** 仅提交候选供人类决策。

**E. Is there enough evidence to define a Stalemate Rule?**

> **YES（建议）。**
>
> 180 场数据：连零击杀轮数 P75=21 / P90=25 / P95=26 / MAX=29（右删失）；
> 29.4% 的对局在 30 轮护栏处 `UNDECIDED`；rapid 对称对抗（Fast vs Hybrid）僵持率高达 43.3%。
> 候选阈值见 §14（no-progress 20 轮 / hard limit 30 轮）。
>
> **本轮未实现正式 Stalemate Rule（§22 明确禁止）。**

---

## 23. 复现指引

```bash
# 0. baseline
git checkout 8f7dc110   # rule baseline
git checkout 6f987bfb   # round-1 evidence baseline

# 1. 复现 Round 1
git archive 6f987bfb | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results

# 2. Hybrid 自检
npx --no-install ts-node src/operator/validate-submission.ts playtest/competitors/solver-hybrid

# 3. 正式规则实验（180 场，约 32 分钟）
bash playtest/harness/run_round2_experiments.sh

# 4. 汇总
python3 playtest/harness/analyze_round2.py

# 5. 离线鲁棒性矩阵（0/1 障碍形状）
python3 playtest/harness/gb_matrix.py --pkg playtest/competitors/solver-hybrid \
    --seeds 20 --obstacles 0,1,2,4,6 --teams 6,8,10 \
    --out playtest/results/round-2/matrix-hybrid.json

# 6. 反事实（先过 §18 门禁，再统计）
python3 playtest/harness/gb_counterfactual.py verify \
    --raw playtest/results/round-2/raw/fast-vs-optimizer --out /tmp/verify.json
python3 playtest/harness/gb_counterfactual.py rounds --pair fast-vs-optimizer \
    --raw playtest/results/round-2/raw/fast-vs-optimizer --cache /tmp/fn.json
python3 playtest/harness/gb_counterfactual.py simulate --pair fast-vs-optimizer \
    --conditions playtest/harness/conditions-round2.json \
    --out playtest/results/round-2/cf/sim-fast-vs-optimizer --cache /tmp/fn.json
```

产物索引：

| 路径 | 内容 |
|---|---|
| `playtest/results/round-2/raw/<pair>/` | 180 场逐场原始产物（match / replay / audit / console） |
| `playtest/results/round-2/metrics-<pair>.json` | 逐场 records + 汇总指标 |
| `playtest/results/round-2/round-2-summary.json` | 三组汇总 + §21 分位 + CF 汇总 |
| `playtest/results/round-2/cf/` | 回合级归因 + 两种模式的 360 场模拟 |
| `playtest/results/round-2/platform-contaminated/` | §23 污染批原始证据与说明 |
| `playtest/results/round-2/matrix-*.json` | §10 离线鲁棒性矩阵（3 包 × 600 次） |
| `playtest/results/round-2/bench-hybrid.json` | Hybrid 的 §9 分阶段基准（1170 次） |

---

## 24. 完成

```
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW
```
