# Round 2 — Algorithm Balance Playtest Report

Geometry Battle V1.1 · 三算法对抗 · 正式规则实验 + 反事实实验

- 协议版本：1.1（`competitor-kit/` 公开接口）
- 测试日期：2026-09-10
- 本轮性质：**Playtest / 平衡性研究，不是平台开发任务**
- 报告版本：**rev 2**（rev 1 的部分结论经对抗式复核后被推翻，修订处见 §25）

---

## Git baseline（本轮全部证据的可寻址锚点）

| 项 | 值 |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| HEAD（结果写入时） | `f920f37384d07402b2376c36fde7b86765ba7901` |
| **RULE_BASELINE_SHA** | `8f7dc11029e99395ebcf977b85dc93780017ffb1` |
| **ROUND1_BASELINE_SHA** | `6f987bfbd0ebbf9978cf1546817aa097e844e641` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904`（本轮**未改变**） |
| Working tree（结果写入时） | **clean**（`git status` 无输出） |

**Canonical rule path**（本轮唯一权威规则输入，未修改、未重命名）：

```
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

> 任务书 §0 引用的 `Plans/Input/Geometry Battle V1.1 Playtest Rules.md` 在本仓库**不存在**。
> 按用户裁决，本轮所有对该名称的引用统一解释为上述 canonical 路径。
> 这是一个 **DOCUMENTATION FINDING**，见 §17。

---

## 1. Executive Summary

第一轮的核心问题是：Fast Tactical Solver 的 50-0-10 统治，究竟来自合理的算法 meta，还是
First Solver + Shooter Cancellation 把策略空间压扁了？

本轮给出**明确答案：后者**，且是定量的。

| 结论 | 答案 |
|---|---|
| A. Hybrid 是否实质缩小了与 Fast 的差距？ | **NO（但显著收窄）** — 官方规则 Fast 26 / Hybrid 8 / Draw 26；按击杀裁决 draw 后为 **Fast 38 / Hybrid 17**。Fast 仍赢 69% 的已决对局 |
| B. Shooter Cancellation 是否是 Fast 统治的主要成因？ | **YES** — 移除取消后胜负**完全反转**：50-0-10 → **2-38-20** |
| C. 先手速度是否过度压制了函数质量？ | **YES** — 仅 fast-vs-optimizer 一项，取消就吞掉了 **787 次**击杀，其中 **84.8% 落在最终仍然存活的点上**；Optimizer 实际全场只有 76 次击杀 |
| D. 是否应在冻结锦标赛规则前修改官方规则？ | **建议 YES（仅建议，未实施）** |
| E. 现有证据是否足以定义 Stalemate Rule？ | **NO** — 观测到的「僵持」是**吸收式不动点**，且分布被测试上限右删失，阈值**不可识别**（§14） |

最关键的两条结构性发现：

> **1. 在本规则集下，速度对胜负的影响只有一条通道，就是 Shot Cancellation 本身。**
> 因为 §40/§41 冻结了回合快照，先手顺序**在数学上不产生任何结果差异**——这一点是由规范
> 直接推出的，不是实验发现的（§10 说明为何原先的表述有误）。
>
> **2. 「僵持」不是慢收敛，而是吸收式不动点。** 在 30 轮上限触顶的对局中，双方每轮发出
> **同一个函数**、Shooter 恒定、命中恒为 0；把上限提高到 60 轮后**仍然触顶**（§13）。

---

## 2. Baseline Reproduction

### 2.1 从已提交证据独立复现 Round 1

不采信第一轮报告的结论，只用 `ROUND1_BASELINE_SHA` 的内容重算：

```
git archive 6f987bf | tar -x -C <workspace>/round1-verify
python3 playtest/harness/reproduce_round1.py --results <workspace>/round1-verify/playtest/results
```

**exit 0，全部对账通过**。唯一事实源为 `raw/*/match.json`（平台自己落盘的产物）：

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

**BASELINE REPRODUCTION PASSED。**

### 2.2 平台可重放性——精确到哪一层

第二轮把 `fast-vs-optimizer` 用同一批 30 个条件完整重跑（60 场），并做了逐字段比对。

**判定层面：完全相同。**

| 项 | 结果 |
|---|---|
| 胜者 / 轮数 | 60 / 60 相同 |
| 逐轮 aHits / bHits / aKills / bKills | 全部相同 |
| aBlocked / bBlocked / cancelledA / cancelledB / aErrorCode / bErrorCode | 全部相同 |
| aliveAAfter / aliveBAfter / result / firstSolver | 全部相同 |
| aFunction / bFunction 及其 hash | 全部相同 |
| mapSeed / mapHash / pointCount / difficulty / seed | 585 轮全部相同 |
| 安装的包 hash（slot 内容） | 60 场全部相同 |

**计时层面：不可复现。**

- 866 个可配对的非空单侧耗时中，**0 个相同**；平均差 +0.71 ms，标准差 4.13 ms，
  极值 −39.6 ms / +43.9 ms；33% 相差 >1 ms，7% 相差 >5 ms。
- 60 场的 `wallSeconds` 全部不同。

**状态 hash：全部不同，但与战斗无关。** `publicStateHash` / `revealStateHash` /
`roundStateHash` 在 585 轮中全部不同，`matchId` 60 场零重叠。根因是 `buildPublicState` /
`buildRevealState` 把每场随机生成的 `match_id` 嵌入了状态 JSON，因此这些 hash 差异
**不携带任何关于战斗随机性的信息**。

> **修正 rev 1 的过度断言**：rev 1 写作「平台对固定算法对 + 固定种子是完全确定的」。
> 严格地说，**只有判定是确定且可重放的；计时是墙上时钟，明确不可复现**。
> 本报告后续任何用到 `aTimeMs` / `bTimeMs` 的地方，都只作为**分布统计**使用，
> 不作为可复现的定量事实。

---

## 3. Hybrid Design

`playtest/competitors/solver-hybrid/` — **Hybrid Tactical-First Anytime Optimizer**

设计契约（任务书 §9）：

> 在任意较早时间停止，都已经拥有一个可执行的合法候选；随着计算继续，函数质量逐步提高。

字面实现：第一个被构造的东西就是一条保证合法的 fallback；`best` 在任何候选胜过它时立即
更新；每个阶段边界都是「此刻停手也能交卷」的点。

| 阶段 | 内容 | 实测（1170 个世界） |
|---|---|---|
| **Stage 1 战术** | 刺杀直线、对每个敌点的直线、恰过（对方 Shooter + 任一敌点）的二次曲线、单参数 bend 族 | 中位 **3.26 ms**，候选中位 18 |
| **Stage 2 多目标** | ≤3 点精确有理插值、三角族、复合族 | 仅 631/1170 次进入，中位 5.99 ms |
| **Stage 3 深挖** | 自由度扫描下更大组合、局部细化 | 仅 598/1170 次进入，中位 0.01 ms |

**EARLY RETURN（§6）**：Stage 1 覆盖的是**整个廉价战术族**（不是采样）。因此 Stage 1 走完时
若已持有 shooter kill 或 ≥2 杀，**立即开火、不再进入后续阶段**。

| 停止原因 | 占比 |
|---|---|
| `stage1: shooter + another kill` | 30.2% |
| `stage1: decisive tactical shot` | 15.9% |
| `stage2: shooter + another kill` / `triple kill` | 1.5% / 1.4% |
| `stage3: shooter + another kill` | 0.1% |
| budget exhausted（无决定性解） | 51.0% |

**46.1% 的回合在 Stage 1 直接开火** —— 这正是 Hybrid 能与 Fast 同速度档的原因。

### 3.1 几何与合法性

```
V = (x − x_s) / L,   f(x) = y_s + g(V),   g(0) = 0
```

- `f(x_s) = y_s` 是**恒等式**，不会漂移到 1e-6 容差边缘（kit §9 的建议）。
- `L` 归一化到 `|V| ≤ 1`，多项式系数自然落在 `|const| ≤ 1000` 内。
- 多项式用 `fractions.Fraction` **精确求解**；V 上聚集的目标组合会使 Vandermonde 病态
  （系数冲到 3×10⁴），这类组合被**显式跳过**。
- 轨迹扫描**保守**：无法证明通畅即判 blocked。

### 3.2 规则来源（合规声明）

Hybrid 的设计输入**只有**冻结的 Playtest Rules 与公开的 `competitor-kit/`。
场地边界终止取自 §34 明文，并在第一轮由独立黑盒 cross-check（866/866）确认。

> **流程说明（主动披露）**：编制 competitor-kit 参考文档时，一个子 agent 读取了
> `src/core/Judge.ts`。该处得到的内部细节（采样步长 `min(0.005, π/(8ω))`、`maxPoints`、
> `OBSTACLE_CONTACT_EPS`、`penetration` 约定）**已明确排除在 Hybrid 设计输入之外**。
> y 边界终止规则本身属 §34 公开内容，不构成泄漏使用。

---

## 4. Hybrid Benchmark

### 4.1 Local Validator / Official Preflight

```
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
包哈希 a11dbf0a47622305ac123b2efeec07d8d4d653c955cc69f6f00b1f8dd44942b
Team A / Team B 耗时 14.7 / 14.9 ms（上限 2000 ms）
```

同一哈希在两组实验槽位的安装报告（`playtest/slots/**/install-report.json`）中记录一致，可交叉核对。**该安装报告不随本仓库发布** —— 它记录了本机绝对路径，且可由 `gb_playtest.py --install` 从 `playtest/competitors/` 重新生成；复现方法见 `playtest/results/reproducibility/README.md`。

### 4.2 离线鲁棒性矩阵（§10）

公开 operator CLI **无法产出 0 或 1 障碍的地图**（本轮独立复验：`--obstacles 0` /
`--obstacles 1` 均被拒为未知选项；`--difficulty` 只映射 easy=2 / medium=4 / hard=6）。
因此 0/1 障碍的**平台级比赛**无法在不读取 MapGenerator 的前提下产生——记为 TEST LIMITATION。

算法侧矩阵在离线完成（`gb_matrix.py`：合成世界 + 公开合法性筛查 + 黑盒命中模型）：

| 包 | runs | illegal | TIMEOUT | no result |
|---|---|---|---|---|
| **solver-hybrid** | 600 | **0** | **0** | **0** |
| solver-fast | 600 | 0 | 0 | 0 |
| solver-optimizer | 600 | 0 | 0 | 0 |

形状：障碍 {0,1,2,4,6} × 人数 {6,8,10} × 队别 {A,B} × 20 seeds。
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

**ALGORITHM FINDING**：Hybrid 与 Fast 同属速度档。

**ALGORITHM FINDING（Stage 3 的边际价值）**：在 1170 个真实世界上，Stage 3 产出了候选
（最多 235 个）却只改变了 **1 次**最终选择。在当前规则集上，**一旦战术解存在，更深的曲线
拟合几乎不产生价值**——这是对「先手速度是否过度压制函数质量」的一条算法内直接回答。

---

## 5. Current-rule Results

规模（§13）：每组 pair 均为 **30 个条件 × 槽位互换 = 60 场**。

- 条件集与第一轮**完全相同**（同 seeds / 人数 / 难度），可与 Round-1 直接比较。
- 地图：6v6 / 8v8 / 10v10 × easy / medium / hard，30 个互不相同的地图哈希。
- 外部轮数上限 `--max-rounds 30`（**仅测试护栏，非比赛规则**——这一点在 §14 有决定性后果）。
- 三组共 **180 场**，合计约 1900 秒墙钟。

| pair | 胜者 A | 胜者 B | Draw |
|---|---|---|---|
| **fast-vs-hybrid** | Fast **26** | Hybrid **8** | **26** |
| **optimizer-vs-hybrid** | Hybrid **39** | Optimizer **4** | **17** |
| **fast-vs-optimizer** | Fast **50** | Optimizer **0** | **10** |

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
| 计算时间中位 / p95 | 16.1 / 36.7 ms | 23.6 / 168.0 ms |

### 6.1 draw 不是均势，而是时钟到期

**26 个 draw 全部是 `exhausted=True`（打满 30 轮上限）。** 其中：

- **12 / 26 的存活分差 ≥ 2**，5 / 26 的分差 ≥ 4。
- 极端案例 `s1111-p10-medium__fast-A`：Fast 存活 10 点 / 8 杀，Hybrid 存活 2 点 / 0 杀
  —— 记录为 **draw**。
- 26 个 draw 的合计击杀差：Fast +12，Hybrid −9，0 平。

**按击杀差（或存活差，结果相同）对 draw 裁决后：Fast 38 / Hybrid 17 / 5 完全平。**

### 6.2 修正 rev 1 的过度断言

rev 1 写作「净胜差从 +50 压到 +18」，并据此判定 Hybrid 实质缩小了差距。该比较**不成立**：

- Round-1 的 50-0-10 中 **50/50 场都是已决**；本轮 fast-vs-hybrid 只有 **34/60 已决**。
- 跨不同「已决场数」直接比净值是苹果比橘子。
- 按裁决口径，Fast 的胜率从 100%（50/50）降到 **69%（38/55）**——确实显著下降，
  但**仍是明确的领先**（二项检验 P(Fast ≥ 26/34 | 公平) ≈ 0.0015）。

**诚实的表述**：

> Hybrid **显著收窄**了与 Fast 的差距（Fast 的已决胜率 100% → 69%，且拿下 8 场胜利，
> 而 Optimizer 拿 0 场），但**没有关闭**它；而且约 43% 的对局根本没有分出胜负，
> 这些僵持把差距「吸收」进了 draw 里。

对照 `optimizer-vs-hybrid`（Hybrid 39 / Optimizer 4）可以看出：Hybrid 相对 **Optimizer**
的跃升是决定性的；相对 **Fast** 则只是收窄。

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

**RULE-DESIGN FINDING**：同一套规则下，两套互不相关的快算法用同一种机制碾压了同一套慢算法。
速度优势的传递路径被独立复现了两次。

---

## 8. Slot Swap（§12）

每种地图条件都跑了 `X = Team A` 与 `Y = Team A` 两种排布，使用**同一 seed**（看到同一张图）。

**修正 rev 1 的报告口径**：rev 1 只打印了 `swapConsistent / swapFlipped`，没有给出分母，
读起来像是覆盖了全部 30 个条件。实际上该度量**只统计两腿都已决的条件**，
其余（涉及 draw 的）被静默排除。完整分解如下：

| pair | 两腿同判 | 两腿相反 | 单腿 draw | 双腿 draw | 可分类占比 |
|---|---|---|---|---|---|
| fast-vs-hybrid | 6 | **6** | 10 | 8 | **12 / 30 (40%)** |
| optimizer-vs-hybrid | 14 | 3 | 9 | 4 | **17 / 30 (57%)** |
| fast-vs-optimizer | 21 | 0 | 8 | 1 | **21 / 30 (70%)** |

fast-vs-hybrid 的 6 个**完全反转**条件（同一张图，换槽位后胜者互换）：

| condition | fast-A 腿胜者 | hybrid-A 腿胜者 |
|---|---|---|
| s909-p8-medium | hybrid | fast |
| s1414-p10-medium | hybrid | fast |
| s1616-p6-easy | hybrid | fast |
| s2222-p6-easy | hybrid | fast |
| s2424-p8-easy | fast | hybrid |
| s2626-p10-easy | fast | hybrid |

### 8.1 算法效应 vs 槽位效应（§12 要求区分）

- **槽位效应：未发现。** 两种排布**逐项完全对称**（fast-vs-hybrid 的 fast-A 与 hybrid-A
  均为 13 / 4 / 13）；全量 A/B 槽位计时中位数均为 **21.2 ms**；先手占比 A=0.5099 / B=0.4896。
- **算法效应：存在。** fast-vs-optimizer 在两种排布下都是 Fast 压倒性领先（26 vs 24 胜），
  这是纯粹的算法差异。
- **但 fast-vs-hybrid 的算法效应无法被干净地分离**：只有 40% 的条件两腿都已决，
  其中一半还是反转。**这说明两套同档快算法之间，同一张图的胜负对极小的时序抖动高度敏感**
  ——这本身就是一条结论，而不是噪声。

### 8.2 §24 的 start skew —— 不可观测

任务书 §24 要求记录 `start skew`。**平台公开产物中不存在该量**：`match.json` 的每轮只有
`aTimeMs` / `bTimeMs`（各自 GO 锚定的计算耗时）与 `firstSolver`，`console.log` 中也没有
`release_ns` 或任何起点偏移字段（本轮已 grep 确认）。

因此：

> **`start skew` 是本 harness 不可观测的量。** §8.1 的"未发现槽位偏置"结论建立在
> **计算耗时分布 + 先手占比**之上，而不是建立在实测起点偏移之上。
> 若平台要支撑 §24 的完整要求，需要在产物中暴露双方的 GO 交付时刻。

---

## 9. Counterfactual No-Cancel（§16 / §19）

模式定义（规范 §39/§55 只给出名称与用途，**未定义精确语义**；以下为本 harness 的定义）：

> **CF-NO-CANCEL**：保留 §36 First Solver 与冻结快照，只移除 §38。
> 先手射击照常结算；后手**即使其 Shooter 刚刚阵亡，只要它已产出合法函数，其攻击仍然执行**。

### 结果：胜负完全反转

| fast-vs-optimizer | Fast | Optimizer | Draw |
|---|---|---|---|
| 官方规则 | **50** | **0** | 10 |
| CF-NO-CANCEL | **2** | **38** | 20 |

| optimizer-vs-hybrid | Hybrid | Optimizer | Draw |
|---|---|---|---|
| 官方规则 | **39** | **4** | 17 |
| CF-NO-CANCEL | **3** | **37** | 20 |

| fast-vs-hybrid | Fast | Hybrid | Draw |
|---|---|---|---|
| 官方规则 | **26** | **8** | 26 |
| CF-NO-CANCEL | **13** | **10** | **37** |

读法：

- 前两组被**彻底翻转**：Optimizer 从「几乎不可能赢」变成「压倒性多数赢」。
  取消规则不是 Fast 的加分项，而是 Optimizer 的**否决项**。
- 第三组几乎不动（净差 +18 → +3，变化主要是 draw 26→37）。**Hybrid 与 Fast 之间的差距
  不是取消造成的**，而是真实的质量/速度差异——两条独立的证据线指向同一结论。

---

## 10. Counterfactual Simultaneous（§17 / §20）

> **CF-SIMULTANEOUS**：§36 与 §38 一并移除。不存在 first solver；双方合法函数都对 START
> 快照结算。

### 结果：与 CF-NO-CANCEL 在 180/180 次比较中**逐回合完全相同**

比较粒度是**逐回合击杀列表**，不只是胜者。

| pair | 官方 | CF-NO-CANCEL | CF-SIMULTANEOUS | 一致 |
|---|---|---|---|---|
| fast-vs-optimizer | 50-0-10 | 2-38-20 | 2-38-20 | 60 / 60 |
| optimizer-vs-hybrid | 39-4-17 | 3-37-20 | 3-37-20 | 60 / 60 |
| fast-vs-hybrid | 26-8-26 | 13-10-37 | 13-10-37 | 60 / 60 |

### 【重要】修正 rev 1 的方法论断言

rev 1 声称「两种模式是独立代码路径，因此『是否等价』是**测量结果**」。
**这是错的。** 两者在**构造上就等价**，原因是规范本身，不是实验发现：

> §40/§41 规定回合快照在 START 冻结、后手不重新计算。既然双方曲线都对**同一快照**结算，
> 「谁先攻击」除了触发 §38 之外**没有任何影响结果的通道**。
> 因此「移除顺序」与「只移除取消」在数学上是同一个操作。

所以 180/180 的一致**是对实现忠实编码了该模型的校验**，不是支持等价性的独立证据。
rev 2 已据此改写代码注释与报告表述。

**RULE-DESIGN FINDING（本轮最重要的结构性结论）**：

> **在本规则集下，速度影响胜负的唯一通道就是 Shot Cancellation。**

这也回答了 §20：当速度不再影响执行顺序时，三者的相对强弱**确实明显改变**，
但改变**完全来自取消的消失**，而非顺序本身。

---

## 11. Cancellation Effect（§19）

### 11.1 回合级取消代价

方法：对每个被取消的回合，**在该回合的官方世界**上离线重跑被取消方的算法取得其真实函数，
再按「取消被移除」重解。

> rev 1 的实现把 CF 传播后的存活集当作世界向前推进，**系统性低估**了结果。
> rev 2 已修正为使用官方逐轮世界（`aliveBefore`），数字变化很大（见下）。

| pair | 算法 | 轮次 | 被取消 | 其中本可命中 | **损失击杀** | **落在最终幸存点上** | 损失的反杀 Shooter |
|---|---|---|---|---|---|---|---|
| fast-vs-optimizer | optimizer | 585 | 304 (52.0%) | 303 | **787** | **667 (84.8%)** | **253** |
| optimizer-vs-hybrid | optimizer | 741 | 250 (33.7%) | 250 | **663** | 514 (77.5%) | 213 |
| fast-vs-hybrid | hybrid | 990 | 187 (18.9%) | 178 | 316 | 160 (50.6%) | 164 |
| fast-vs-hybrid | fast | 990 | 117 (11.8%) | 117 | 119 | 57 (47.9%) | 115 |

**「落在最终幸存点上」这一列是关键的证伪检验**：它排除了「这些击杀本来就打在被别人杀掉的
点上、因此不算真损失」这一替代解释。在 fast-vs-optimizer 中，**84.8% 的损失击杀的目标在
官方对局结束时仍然存活**——它们是真正被打断的击杀。

其余数字：

- **787 次击杀**对比 Optimizer 全场实际 **76 次**击杀——取消抹掉了其曲线所能产生的击杀的
  **约 91%**。
- **253 次**被取消的射击本身就是对 Fast Shooter 的反杀（占全部回合的 43%）。
  若允许执行，Optimizer 在将近一半的回合里本可以反过来取消 Fast 的整轮。

### 11.2 该结论的稳健性（独立复核）

对抗式复核用一个**从零编写的独立模拟器**（不同代码、不同解析循环）复现了
CF-NO-CANCEL 的 38-2-20，**0/60 分歧**；并从全新缓存重跑（1360 次离线求解，零复用）
得到逐场字节相同的结果。同时排除了替代解释：

- 离线重跑的求解器在官方世界上**逐字节复现平台记录的函数**（217/217）。
- 全部 CF 重跑函数 **222/222 通过公开合法性筛查**，不存在非法曲线被高估。
- 全场无超时（最大记录耗时 356 ms，上限 2000 ms）。

---

## 12. Speed Effect（§20）

| 算法 | 有效射击 | first-shot rate | 被取消率 | kills / valid shot |
|---|---|---|---|---|
| fast | 1458 | **0.854** | 0.074 | **0.578** |
| hybrid | 1544 | 0.560 | 0.108 | 0.449 |
| optimizer | 772 | **0.000** | **0.418** | 0.285 |

速度阶梯 Fast > Hybrid > Optimizer 在 first-shot rate、取消率、kills-per-shot 三个维度上单调。

回答 §20：

> 速度不再影响执行顺序时，相对强弱**明显改变**——Optimizer 从两种对阵的全败变为压倒性多数胜。
> 而由于 §10 已证明「顺序」本身无影响，这个改变**完全归因于 Shot Cancellation 的消失**。

---

## 13. No-progress Distribution（§21）

No-progress 定义采用规范 §46 候选定义：某回合双方击杀均为 0 则 streak +1，任一方产生击杀则归零。

| 分位 | 连续零击杀轮数（n = 180 场） |
|---|---|
| P50 | 0 |
| P75 | 21 |
| P90 | 25 |
| P95 | 26 |
| P99 | 28 |
| MAX | 29 |

### 13.1 【重要】这组分位数不是一条 streak 分布

对抗式复核指出并已由本轮独立确认：**这组数字不能作为阈值依据**，原因有三。

**(a) 分布是二值的。** 180 场中 **127 场的 streak 恰好为 0**（每轮都有击杀）；
其余 **53 场恰好就是打满 30 轮上限的 53 场**。不存在任何「中途结束的中等长度 streak」。
对全部 53 场逐一核对：**观测 streak ≡ 30 − 最后击杀轮**。

**(b) 这些尾部是吸收式不动点，不是慢收敛。** 对 53 场逐项检查：

- Shooters 恒定（自动选择「存活点中 id 最小者」，状态不变则选择不变）；
- **双方每轮发出的函数 hash 恒定**（世界不变 + 求解器确定 ⇒ 同一函数）；
- 尾部逐轮命中数为 0（40/53 双方都被挡，其余 13/53 只有一方被挡）；
- 障碍物恒定。

即：状态进入一个**双方都打不中、且永远重复同一发**的固定点，此后**永不改变**。

**(c) 提高上限不能化解 —— 已直接实验验证。**

对 3 场触顶对局用 `--max-rounds 60` 重跑：

| condition | arrangement | cap 30 | cap 60 |
|---|---|---|---|
| s101-p6-medium | fast-A | draw, 30 轮, exhausted | **draw, 60 轮, exhausted** |
| s1010-p8-medium | fast-A | draw, 30 轮, exhausted | **draw, 60 轮, exhausted** |
| s1010-p8-medium | hybrid-A | draw, 30 轮, exhausted | **draw, 60 轮, exhausted** |

上限翻倍后**全部仍然触顶**。产物见 `playtest/results/round-2/cap60-probe/`。

**结论**：分位数与上限是 1:1 缩放的（cap=20/30/50/100 → P75 = 11/21/41/91），
**任何从这组数字读出的「no-progress 阈值」都只是对任意 harness 配置的重新编码**，
不是被测游戏的属性。

---

## 14. Match Length Distribution（§21 / §22）

| 分位 | 对局轮数（n = 180） |
|---|---|
| P50 | 6 |
| P75 | 30 |
| P90 | 30 |
| P95 | 30 |
| MAX | 30 |
| mean | 12.87 |

打到上限（判 `UNDECIDED`）的比例：

| pair | 僵持 / 总数 | 比例 |
|---|---|---|
| **fast-vs-hybrid** | 26 / 60 | **43.3%** |
| optimizer-vs-hybrid | 17 / 60 | 28.3% |
| fast-vs-optimizer | 10 / 60 | 16.7% |
| **合计** | **53 / 180** | **29.4%** |

**RULE-DESIGN FINDING**：僵持率与「双方速度档是否接近」强相关。第一轮只有一套快算法（16.7%）；
本轮最快的一对（Fast vs Hybrid）把僵持率推到 **43.3%**。

### Stalemate 证据充分性（§22）

**答案：NO —— 不足以给出阈值。**

- **可以支持的**：这些僵持是**真实的吸收式循环**（53/53 永不自行化解，提高到 60 轮仍不化解），
  因此「规则集缺少终止条件」这一点**是成立的**，且比第一轮（10/60）在更大样本上得到确认。
- **不能支持的**：**阈值数值**。分布被测试上限右删失，53 个尾部观测全部等于「上限 − 最后
  击杀轮」，没有任何一个自然分辨率被观测到。**hard round limit 的 30 只是 harness 的默认
  参数**（`gb_round2.py` / `gb_playtest.py` / `gb_counterfactual.py` 三处 default=30），
  不是从数据得出的。
- 此外，僵持集中在 fast-vs-hybrid 与 medium/hard 高障碍地图上，样本只有 30 张复用地图，
  **不足以支撑一条普适阈值**。

> **rev 1 曾建议 `MAX_NO_PROGRESS_ROUNDS = 20` / `HARD_ROUND_LIMIT = 30`。
> rev 2 撤回这两个建议。** 它们是从删失分位数上读出来的，属于循环论证。

**要做出阈值建议，需要先补的实验**：在**不设上限**（或上限远高于任何候选阈值，例如 1000 轮）
的条件下测量僵持的自然分布，或对吸收态做显式的规则级处理（例如禁止双方在同一状态下重复
发出同一函数）。本轮**未实施任何正式 Stalemate Rule**（§22 明确禁止），也未实施上述实验。

---

## 15. Platform Findings

### 15.1 计时异常批次（§23）— 已识别、已隔离、已重跑

巡检发现 **8 场比赛**出现单侧计算时间 > 300 ms 的回合（同期正常值 13–40 ms）。
其中 **2 场为实质性污染**：

| 比赛 | 异常轮数 | 最大耗时 |
|---|---|---|
| `fast-vs-hybrid / s303-p6-medium__fast-A` | 22 / 60 | **935.7 ms** |
| `fast-vs-hybrid / s1111-p10-medium__fast-A` | 28 / 60 | 357.3 ms |

特征：**双方同时**被拖慢，`aErrorCode` / `bErrorCode` 均为 `null`，无取消 ——
是宿主级停顿，**不是算法失败**。

处理：

1. 原始产物完整保留在 `playtest/results/round-2/platform-contaminated/`，含
   `CONTAMINATION.json`（matchId / seed / 逐轮异常耗时 / winner / rounds）。
2. 8 场全部重跑。
3. **重跑后胜负与轮数 100% 一致，无任何结果变化**；`s303` 的最大耗时从 935.7 ms 回落到 74.7 ms。

**诚实归因**：`s1111-p10-medium__fast-A`（13:00:19 完成）的窗口与本轮作者执行的一次
`validate-submission` 重负载检查重叠；`s303` 与已知的跨回合沙箱停顿特征一致。
两者均属 **PLATFORM-CONTAMINATED / 环境噪声**，不计为算法结果。

**局限**：§23 要求保存 `process state` / `sandbox state`。这两项**无法事后补采**——
污染是在实验进行中发现的，进程与沙箱已销毁。已保存的是平台自身落盘的 `match.json` /
`replay.json` / `console.log` 与逐轮耗时画像。这是本轮在 §23 上的一处**未满足项**。

### 15.2 未发现队别 / 槽位偏置（§24）

两种排布逐项对称；A/B 槽位计时中位数相同（21.2 ms）；先手占比 0.5099 / 0.4896。
`start skew` **不可观测**（§8.2）。

### 15.3 轨迹终止原因分布

| 算法 | 障碍终止 | **场地边界终止** | 正常到达域末 | 无函数/被取消 |
|---|---|---|---|---|
| fast | 11.9% | **55.3%** | 25.3% | 7.4% |
| hybrid | 64.8% | 6.4% | 18.0% | 10.8% |
| optimizer | 50.2% | 1.7% | 6.3% | 41.8% |

第一轮报告 §5 Finding 1 指出的「场地边界终止未写入 competitor-kit」在本轮被量化：
**Fast 有 55.3% 的回合是被场地边界终止的**，远高于障碍终止。

### 15.4 平台判定完全可重放

见 §2.2：60 场 / 585 轮的判定产物逐字段相同。

---

## 16. §4 一致性确认（冻结算法 vs 公开 Arena Boundary 规则）

任务书 §4 要求确认 `solver-fast` / `solver-optimizer` / harness 都按公开的
「first arena boundary exit → attack terminates permanently」规则工作。

**本轮提供了直接的一致性证据**（不只是叙述）：§18 的 OFFICIAL MODE 校验逐发比对
**平台记录的轨迹末点**与公开规则模型推出的终止点，在 **3774 次已执行的射击上 0 失配**
（fast-vs-optimizer 866/866、optimizer-vs-hybrid 1232/1232、fast-vs-hybrid 1676/1676，
容差 5e-3）。

这直接证明：三套算法（含两套第一轮冻结算法）与 harness 在**公开规则**下产生的轨迹终止
行为与平台一致，不存在依赖隐藏 Judge 行为的残留差异。

---

## 17. Documentation Findings

1. **任务书引用了不存在的文件名**：§0 要求读取
   `Plans/Input/Geometry Battle V1.1 Playtest Rules.md`，本仓库从无此文件。
2. **场地边界终止条件仍未写入 competitor-kit**，而它影响 Fast 55.3% 的回合。
3. **规范未定义 CF-NO-CANCEL / CF-SIMULTANEOUS 的语义**（§39/§55 只给名称与用途）。
   本 harness 的定义已写入 `gb_counterfactual.py` 模块 docstring。
4. **`aBlocked` 字段的精确谓词未公开**。OFFICIAL MODE 校验发现：轨迹在**场地边界**终止的
   回合中，平台 `blocked` 取值为 `True` 106 次 / `False` 209 次（fast-vs-optimizer），
   模型无法从公开规则复现该谓词。该字段**不参与反事实计算**，不影响本轮任何结论，
   但第三方无法完整复核平台的 blocked 统计——建议公开其定义。
5. **平台不暴露 `start skew`**，使 §24 无法被完整满足（§8.2）。

---

## 18. Harness Integrity（§18 门禁）

门禁要求：OFFICIAL MODE 下 `harness result == official platform result`，否则不得运行反事实统计。

产物（已持久化，可独立复核）：

```
playtest/results/round-2/cf/verify-fast-vs-optimizer.json
playtest/results/round-2/cf/verify-optimizer-vs-hybrid.json
playtest/results/round-2/cf/verify-fast-vs-hybrid.json
```

| 检查项 | fast-vs-opt | opt-vs-hybrid | fast-vs-hybrid | 失配合计 |
|---|---|---|---|---|
| 命中列表（逐发） | 866 | 1232 | 1676 | **0** |
| **轨迹终止点 x（对比平台记录的轨迹末点）** | 866 | 1232 | 1676 | **0** |
| 取消谓词 | 585 | 740 | 990 | **0** |
| aliveAfter 存活集合 | 585 | 741 | 990 | **0** |
| 比赛胜者 | 60 | 60 | 60 | **0** |

### 18.1 关于门禁范围的显式说明（不掩盖）

门禁本轮的判定为**通过**，但范围有明确界定，逐条声明：

- **通过的部分**：反事实计算所消费的**每一项**（命中、终止点、取消谓词、存活、胜者）
  在三个 pair 上全部 0 失配，共 3774 发。
- **排除的部分**：平台的 `aBlocked` / `bBlocked` 字段。它在 fast-vs-optimizer /
  fast-vs-hybrid 上分别有 106 / 298 处与模型不一致（场地边界终止的回合里该字段取值分裂）。
  该字段**不参与任何反事实计算**，其谓词未公开（§17.4）。
- **rev 1 的表述问题**：rev 1 直接宣称「100% 一致」，未把这一排除项放在同一段里对照
  §18 的原文要求。rev 2 明确：**§18 的字面要求（harness result 完全等于平台结果）
  在 `blocked` 字段上未达成；在反事实所依赖的全部字段上已达成。** 是否接受这一范围，
  属于后续评审的判断，不由本报告自行裁定。

---

## 19. Rule Health Verdict（§25）

### 判定：`CANCELLATION-DOMINATED`

规范 §57 列出的五类是**待判定的测试结论类别，不是预先假定的结论**，且未给出阈值。
本报告的判定标准与数据依据如下。

**为什么不是 `HEALTHY`**
- 移除一条平衡性规则即可把 50-0-10 反转为 2-38-20。
- 29.4% 的对局在护栏上限处收场，且这些僵持是**吸收态**（提高上限不化解）。

**为什么不是 `SPEED-DOMINATED`**

这一条需要特别说明。表面看「谁快谁赢」，但 CF-SIMULTANEOUS 证明：
**速度本身（先手顺序）对结果没有任何影响**——因为冻结快照使顺序无作用通道。
速度之所以决定胜负，**完全是因为它触发了取消规则**。
因此准确的归类是取消规则主导，而不是速度本身主导。

**为什么不是 `STRUCTURALLY COLLAPSED`**
- §58 的塌缩判据是「所有优化方案都必须退化为最快击杀 Shooter 才能竞争」。
- Hybrid 证明算法**可以适应这个 meta**：它用战术优先 + 46% 早返回拿到 8 胜，
  相对 Optimizer（0 胜）是决定性跃升，并把 Fast 的已决胜率从 100% 压到 69%。
  因此策略空间是**收窄**，不是塌缩。

**为什么是 `CANCELLATION-DOMINATED`**
- CF-NO-CANCEL 与 CF-SIMULTANEOUS 等价（180/180），证明速度的全部影响都经由取消规则。
- 取消一旦移除，两场对阵的胜负彻底反转，而唯一的「同速对抗」几乎不动。
- 回合级归因：取消在 fast-vs-optimizer 中吞掉 787 次击杀（其中 84.8% 的目标最终存活），
  含 253 次对先手的反杀。

**叠加的第二条结构性问题（`STRUCTURALLY AT RISK`）**

规则集**缺少终止条件**，且 29.4% 的对局会进入**永不化解的吸收式循环**。
这在第一轮（10/60）已现端倪，本轮在更大样本上确认为结构性缺陷。
本轮**无法给出阈值**（§14），因此该项保持 `OPEN FOR PLAYTEST EVIDENCE`。

---

## 20. Limitations

1. **0 / 1 障碍地图无法通过公开 CLI 触达**（本轮独立复验）。§10 的这两个形状只在
   **算法侧**离线矩阵中验证，未做平台级比赛。
2. **§18 门禁的 `blocked` 字段未达成字面一致**（§18.1）。
3. **Stalemate 分布右删失**，阈值不可识别（§14）。**这是 rev 2 相对 rev 1 最重要的修正。**
4. **`start skew` 不可观测**（§8.2），§24 因此不完整。
5. **§23 的 `process state` / `sandbox state` 未采集**（事后不可补采，§15.1）。
6. **CF 语义由本 harness 定义**（规范未定义）；换一种定义可能给出不同的反事实数值。
7. **CF 模拟沿用官方 map 序列**（逐轮 obstacles + 固定点位），只让存活集合演化。
   障碍无法离线再生；点位不移动，因此这部分是精确的而非近似。
8. **CF 中重跑的求解器在离线环境执行**（无 sandbox 的 1 核 / 512 MB / 线程=1 限制）。
   已验证三套算法确定性、且在官方世界上逐字节复现平台记录的函数（217/217），
   但严格意义上离线预算不等于沙箱预算。
9. **`fast-vs-hybrid` 的算法效应无法干净分离**：只有 40% 条件两腿都已决，其中一半反转（§8.1）。
10. **计时不受控且不可复现**（§2.2）。本轮实验期间宿主存在并发负载（§15.1）。
11. **样本规模**：每 pair 60 场 / 30 张独立地图。对 26-8-26 这样接近的比分功效有限。
12. **只有三套算法**，且 Hybrid 由本轮作者设计；其设计选择（如 `SHOOTER_WEIGHT=1.5`）
    未做敏感性扫描。

---

## 21. Recommendations

**全部为建议。按 §27 与本轮约束，未实施任何规则修改，也未修改 production。**

| # | 建议 | 依据 |
|---|---|---|
| R1 | **将 §38 Shot Cancellation 提交人类决策复核。** 候选：改为「取消仅在后手**未产出合法函数**时生效」，即 CF-NO-CANCEL 的规则化 | §9 / §11：移除后胜负反转 |
| R2 | **优先修复 competitor-kit 的场地边界终止文档缺口** | §15.3 / §17.2 |
| R3 | **先补「无上限」实验，再谈 Stalemate 阈值。** 本轮**撤回** rev 1 的 20/30 建议 | §14：删失 + 吸收态 ⇒ 阈值不可识别 |
| R4 | **公布 `aBlocked` 的判定谓词**，或从统计口径中移除该字段 | §17.4 |
| R5 | **修正任务书 §0 的规则文件名引用** | §17.1 |
| R6 | **在产物中暴露双方 GO 交付时刻**，否则 §24 的 start skew 无法被任何 harness 测量 | §8.2 |
| R7 | **在后续轮次扩大样本**（≥100 条件 × swap）再决定 R1 的最终形态 | §20.11 |
| R8 | **若采纳 R1，必须补做完整回归**：取消规则的改动会同时影响 Shooter assassination 的价值、僵持率与 fast 的相对地位 | §59 Rule Change Procedure |

---

## 22. 最终回答（§29）

**A. Did Hybrid materially close the gap to Fast?**

> **NO（但显著收窄）。**
>
> 官方规则下 Fast 26 / Hybrid 8 / Draw 26。关键在于 **26 个 draw 全部是 30 轮时钟到期**，
> 其中 12 个存活分差 ≥2；按击杀差裁决后为 **Fast 38 / Hybrid 17 / 5 完全平**。
> 即 Fast 仍赢下 **69%** 的已决对局（P ≈ 0.0015），且 Hybrid 在 30 个条件中
> **从未两腿全胜**（Fast 做到 6 次）。
>
> 收窄是真实的：Fast 的已决胜率从第一轮的 **100%（50/50）** 降到 **69%**，
> Hybrid 拿下 8 胜而 Optimizer 是 0 胜；`optimizer-vs-hybrid` 中 Hybrid 39-4 碾压。
> 但「缩小差距」与「关闭差距」是两回事，本轮的证据只支持前者。

**B. Is Shooter Cancellation a major contributor to Fast dominance?**

> **YES。**
>
> 移除取消后 fast-vs-optimizer 从 **50-0-10** 反转为 **2-38-20**；
> optimizer-vs-hybrid 从 **39-4-17** 反转为 **3-37-20**。
> 回合级归因：取消在 fast-vs-optimizer 中吞掉 **787 次**击杀，其中 **84.8% 的目标在
> 官方对局结束时仍然存活**（排除了「本来就该死」的替代解释），含 **253 次**对 Fast
> Shooter 的反杀——占全部回合的 43%。
> 该结论已被一个**独立编写的模拟器**复现（0/60 分歧），且离线重跑的求解器在官方世界上
> **逐字节复现平台记录的函数**（217/217），排除了环境/计时假象。

**C. Does first-solver speed excessively suppress function quality?**

> **YES。**
>
> 三层证据：
> (1) 回合级：787 / 663 / 316 次击杀在三种对阵中因取消而未被执行，且多数目标最终存活；
> (2) 前向模拟：移除取消后慢算法的胜场从 0 → 38、4 → 37；
> (3) 算法内证据：Hybrid 的 Stage 3（更深的曲线拟合）在 1170 个世界上只改变了 1 次结果
> ——**即使把时间给它，更高质量的函数也不产生价值**。
>
> 措辞保留：CF 测量的是「substantially」（数量级），「excessively」（是否过度）是需要在
> 规则评审中做的价值判断，不由本报告代为裁定。

**D. Should the official rules change before proceeding toward tournament freeze?**

> **YES（建议）。**
>
> 依据 §19 的 `CANCELLATION-DOMINATED` 判定与 §21 的 R1 / R2 / R3。
>
> **本轮未实施任何修改，也未修改 production（§27）。** 仅提交候选供人类决策。

**E. Is there enough evidence to define a Stalemate Rule?**

> **NO。**
>
> 僵持**真实存在且是结构性的**（53/53 永不化解，提高到 60 轮仍不化解），
> 因此「需要某种终止条件」这一点成立。
> 但**阈值数值不可识别**：观测分布被 30 轮测试上限右删失，53 个尾部观测全部等于
> 「上限 − 最后击杀轮」，没有观测到任何自然分辨率；分位数与上限 1:1 缩放。
> **rev 1 的 20 / 30 阈值建议已撤回**，它是从删失分位数上循环论证得出的。
>
> 需要先做「无上限」实验（见 §14 与 R3）才能在下一轮给出阈值建议。
>
> **本轮未实现正式 Stalemate Rule（§22 明确禁止）。**

---

## 23. 复现指引

```bash
# 0. 本报告对应的提交即证据锚点
git log --oneline -3

# 1. 复现 Round 1
git archive 6f987bfb | tar -x -C <workspace>/round1-verify
python3 playtest/harness/reproduce_round1.py --results <workspace>/round1-verify/playtest/results

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
for p in fast-vs-optimizer optimizer-vs-hybrid fast-vs-hybrid; do
  python3 playtest/harness/gb_counterfactual.py verify \
      --raw playtest/results/round-2/raw/$p \
      --out playtest/results/round-2/cf/verify-$p.json
  python3 playtest/harness/gb_counterfactual.py rounds --pair $p \
      --raw playtest/results/round-2/raw/$p --cache <workspace>/fn-$p.json \
      --out playtest/results/round-2/cf/rounds-$p.json
  python3 playtest/harness/gb_counterfactual.py simulate --pair $p \
      --conditions playtest/harness/conditions-round2.json \
      --out playtest/results/round-2/cf/sim-$p --cache <workspace>/fn-$p.json
done

# 7. 吸收态检验（提高上限）
python3 playtest/harness/gb_round2.py run --pair fast-vs-hybrid \
    --conditions <workspace>/cond-cap60.json --out <workspace>/cap60 --max-rounds 60
```

### 产物索引

| 路径 | 内容 |
|---|---|
| `playtest/results/round-2/raw/<pair>/` | 逐场原始产物。**本公开副本为精简证据包**：每对阵保留 2 个代表性 seed × 2 个先后手为完整产物（match / replay / audit / console），其余场次保留 `match.json` + `summary.json`（`reproduce_round1.py` 与逐场对账所需）；完整重跑方法见 `playtest/results/reproducibility/README.md` |
| `playtest/results/round-2/metrics-<pair>.json` | 逐场 records + 汇总指标 |
| `playtest/results/round-2/round-2-summary.json` | 三组汇总 + §21 分位 + CF 汇总 |
| `playtest/results/round-2/cf/verify-*.json` | **§18 门禁产物（逐项计数与失配明细）** |
| `playtest/results/round-2/cf/rounds-*.json` | 回合级取消归因 |
| `playtest/results/round-2/cf/sim-*/` | 两种模式的 360 场模拟 |
| `playtest/results/round-2/platform-contaminated/` | §23 污染批原始证据与说明 |
| `playtest/results/round-2/cap60-probe/` | **吸收态检验（cap 30 vs 60）** |
| `playtest/results/round-2/matrix-*.json` | §10 离线鲁棒性矩阵（3 包 × 600 次） |
| `playtest/results/round-2/bench-hybrid.json` | Hybrid 的 §9 分阶段基准（1170 次） |

---

## 24. 完成

```
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW
```

---

## 25. rev 1 → rev 2 修订记录

rev 1 在提交前经过一轮**对抗式复核**（5 名独立反驳者 + 1 名完整性评论员，各自从原始档案
重算）。以下结论被推翻或修正，**保留了推翻的理由**，以免后续读者重复同样的错误：

| 项 | rev 1 | rev 2 | 推翻依据 |
|---|---|---|---|
| 平台确定性 | 「完全确定」 | **仅判定确定；计时不可复现** | 866 个配对计时 **0 个相同**（±43.9 ms）；585 个状态 hash 全不同（由随机 match_id 解释） |
| Hybrid 缩小差距 | YES，净差 +50→+18 | **NO（显著收窄）** | 26 个 draw 全是时钟到期，12 个分差 ≥2；按击杀裁决 **Fast 38 / Hybrid 17** |
| 槽位一致性 | 「6 / 6」（无分母） | **12/30 可分类（6 同判 + 6 反转）** | 度量只统计两腿都已决的条件，读起来像覆盖全部 30 个 |
| CF 两模式等价 | 「独立代码路径 ⇒ 测量结果」 | **构造上等价（源自 §40/§41）** | 两分支都只是并集；顺序是空操作 |
| 回合级取消代价 | 430 / 389 / 294 kills lost；60 shooter kills | **787 / 663 / 316；253 / 213 / 164** | rev 1 把 CF 传播的存活集当世界，**系统性低估** |
| Stalemate 阈值 | 建议 20 / 30 | **撤回；证据不足** | 分布右删失 + 吸收态；cap 30→60 仍全部触顶 |
| §18 门禁 | 「100% 一致」 | **在反事实消费的全部字段上 100%；`blocked` 字段未达成字面一致** | 106 / 298 处 `blocked` 分歧，需与 §18 原文对照声明 |
| §24 start skew | 未提及 | **不可观测** | 平台产物无该字段，已 grep 确认 |
