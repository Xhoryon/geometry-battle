<!-- bilingual-doc: zh-CN + en-US -->

# Round 2 — Algorithm Balance Playtest Report

**第二轮 — 算法平衡性实测报告**

Geometry Battle V1.1 · 三算法对抗 · 正式规则实验 + 反事实实验

Geometry Battle V1.1 · Three-Algorithm Competition · Official Rules Experiment + Counterfactual Experiments

- 协议版本：1.1（`competitor-kit/` 公开接口）
- Protocol version: 1.1 (`competitor-kit/` public interface)
- 测试日期：2026-09-10
- Test date: 2026-09-10
- 本轮性质：**Playtest / 平衡性研究，不是平台开发任务**
- Round nature: **Playtest / Balance study, not a platform development task**
- 报告版本：**rev 2**（rev 1 的部分结论经对抗式复核后被推翻，修订处见 §25）
- Report version: **rev 2** (Some conclusions from rev 1 were overturned after adversarial review; see §25 for revisions)

---

## Git baseline（本轮全部证据的可寻址锚点）
## Git baseline (Addressable anchor for all evidence in this round)

| 项 / Item | 值 / Value |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| HEAD（结果写入时）/ HEAD (at result write time) | `f920f37384d07402b2376c36fde7b86765ba7901` |
| **RULE_BASELINE_SHA** | `8f7dc11029e99395ebcf977b85dc93780017ffb1` |
| **ROUND1_BASELINE_SHA** | `6f987bfbd0ebbf9978cf1546817aa097e844e641` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904`（本轮**未改变** / **unchanged** this round） |
| Working tree（结果写入时）/ Working tree (at result write time) | **clean**（`git status` 无输出 / no output） |

**Canonical rule path**（本轮唯一权威规则输入，未修改、未重命名）：

**Canonical rule path** (Sole authoritative rule input for this round, unmodified, unrenamed):

```
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

> 任务书 §0 引用的 `Plans/Input/Geometry Battle V1.1 Playtest Rules.md` 在本仓库**不存在**。
> 按用户裁决，本轮所有对该名称的引用统一解释为上述 canonical 路径。
> 这是一个 **DOCUMENTATION FINDING**，见 §17。

> The `Plans/Input/Geometry Battle V1.1 Playtest Rules.md` referenced in task specification §0 **does not exist** in this repository.
> Per user ruling, all references to that name are uniformly interpreted as the canonical path above.
> This is a **DOCUMENTATION FINDING**; see §17.

---

## 1. Executive Summary

## 1. 执行摘要

第一轮的核心问题是：Fast Tactical Solver 的 50-0-10 统治，究竟来自合理的算法 meta，还是 First Solver + Shooter Cancellation 把策略空间压扁了？

The core question from Round 1 was: Does the 50-0-10 dominance of Fast Tactical Solver come from a legitimate algorithm meta, or did First Solver + Shooter Cancellation flatten the strategy space?

本轮给出**明确答案：后者**，且是定量的。

This round provides a **clear answer: the latter**, and it is quantitative.

| 结论 / Conclusion | 答案 / Answer |
|---|---|
| A. Hybrid 是否实质缩小了与 Fast 的差距？/ Did Hybrid materially close the gap to Fast? | **NO（但显著收窄）** / **NO (but significantly narrowed)** — 官方规则 Fast 26 / Hybrid 8 / Draw 26；按击杀裁决 draw 后为 **Fast 38 / Hybrid 17** / Under official rules Fast 26 / Hybrid 8 / Draw 26; after adjudicating draws by kills: **Fast 38 / Hybrid 17**. Fast 仍赢 69% 的已决对局 / Fast still wins 69% of decided matches |
| B. Shooter Cancellation 是否是 Fast 统治的主要成因？/ Is Shooter Cancellation a major contributor to Fast dominance? | **YES** — 移除取消后胜负**完全反转**：50-0-10 → **2-38-20** / **YES** — Removing cancellation **completely reverses** outcomes: 50-0-10 → **2-38-20** |

| C. 先手速度是否过度压制了函数质量？/ Does first-solver speed excessively suppress function quality? | **YES** — 仅 fast-vs-optimizer 一项，取消就吞掉了 **787 次**击杀，其中 **84.8% 落在最终仍然存活的点上** / **YES** — In fast-vs-optimizer alone, cancellation consumed **787 kills**, of which **84.8% landed on points that survived to the end**；Optimizer 实际全场只有 76 次击杀 / Optimizer only achieved 76 kills total |
| D. 是否应在冻结锦标赛规则前修改官方规则？/ Should the official rules change before proceeding toward tournament freeze? | **建议 YES（仅建议，未实施）** / **Recommended YES (recommendation only, not implemented)** |
| E. 现有证据是否足以定义 Stalemate Rule？/ Is there enough evidence to define a Stalemate Rule? | **NO** — 观测到的「僵持」是**吸收式不动点**，且分布被测试上限右删失，阈值**不可识别**（§14）/ **NO** — Observed "stalemates" are **absorbing fixed points**, and the distribution is right-censored by test limits; threshold is **not identifiable** (§14) |

最关键的两条结构性发现：

The two most critical structural findings:

> **1. 在本规则集下，速度对胜负的影响只有一条通道，就是 Shot Cancellation 本身。**
> 因为 §40/§41 冻结了回合快照，先手顺序**在数学上不产生任何结果差异**——这一点是由规范
> 直接推出的，不是实验发现的（§10 说明为何原先的表述有误）。
>
> **1. Under this ruleset, speed affects outcomes through only one channel: Shot Cancellation itself.**
> Because §40/§41 freeze the round snapshot, first-solver order **produces no mathematical difference in results**—this is derived directly from the specification, not experimentally discovered (§10 explains why the original phrasing was incorrect).
>
> **2. 「僵持」不是慢收敛，而是吸收式不动点。** 在 30 轮上限触顶的对局中，双方每轮发出
> **同一个函数**、Shooter 恒定、命中恒为 0；把上限提高到 60 轮后**仍然触顶**（§13）。
>
> **2. "Stalemates" are not slow convergence, but absorbing fixed points.** In matches that hit the 30-round cap, both sides emit **the same function** every round, Shooters remain constant, hits remain 0; raising the cap to 60 rounds **still hits the cap** (§13).

---

## 2. Baseline Reproduction

## 2. 基线复现

### 2.1 从已提交证据独立复现 Round 1

### 2.1 Independent reproduction of Round 1 from committed evidence

不采信第一轮报告的结论，只用 `ROUND1_BASELINE_SHA` 的内容重算：

Without trusting Round 1 report conclusions, recalculate using only the content at `ROUND1_BASELINE_SHA`:

```
git archive 6f987bf | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results
```

**exit 0，全部对账通过**。唯一事实源为 `raw/*/match.json`（平台自己落盘的产物）：

**exit 0, all reconciliations passed**. The sole source of truth is `raw/*/match.json` (artifacts persisted by the platform itself):

| 项 / Item | 复现值 / Reproduced value | 报告声称 / Report claimed |
|---|---|---|
| matches / conditions / distinct map hashes | 60 / 30 / 30 | 60 / 30 / 30 |
| rounds / 算法调用次数 / rounds / algorithm invocations | 585 / 1170 | 585 / 1170 |
| fast / optimizer / draw | 50 / 0 / 10 | 50 / 0 / 10 |
| INVALID / TIMEOUT | 0 / 0 | 0 / 0 |
| optimizer 被取消 / optimizer cancelled | 304 | 304 |
| fast blocked / kills / shooter kills / multi | 147 / 464 / 304 / 128 | 同左 / same |
| optimizer blocked / kills / shooter kills / multi | 244 / 76 / 28 / 34 | 同左 / same |
| kills per valid shot | 0.793 / 0.270 | 同上 / same |
| first-shot rate | 1.000 / 0.000 | 同上 / same |
| 交叉验证 / cross-validation | 866/866 一致，0 mismatch / 866/866 match, 0 mismatch | 同上 / same |
| swap 一致性 / swap consistency | 21/21 | 21/21 |
| max-rounds 僵持 / max-rounds stalemate | 10 | 10 |
| 计算时间中位 / median compute time | 12.8 / 142.1 ms | 同上 / same |

**BASELINE REPRODUCTION PASSED。**

**BASELINE REPRODUCTION PASSED.**

### 2.2 平台可重放性——精确到哪一层

### 2.2 Platform reproducibility — to what level of precision

第二轮把 `fast-vs-optimizer` 用同一批 30 个条件完整重跑（60 场），并做了逐字段比对。

Round 2 completely re-ran `fast-vs-optimizer` with the same 30 conditions (60 matches) and performed field-by-field comparison.

**判定层面：完全相同。**

**Judgment level: completely identical.**

| 项 / Item | 结果 / Result |
|---|---|
| 胜者 / 轮数 / winner / rounds | 60 / 60 相同 / 60 / 60 identical |
| 逐轮 aHits / bHits / aKills / bKills / per-round aHits / bHits / aKills / bKills | 全部相同 / all identical |
| aBlocked / bBlocked / cancelledA / cancelledB / aErrorCode / bErrorCode | 全部相同 / all identical |
| aliveAAfter / aliveBAfter / result / firstSolver | 全部相同 / all identical |

| aFunction / bFunction 及其 hash / and their hashes | 全部相同 / all identical |
| mapSeed / mapHash / pointCount / difficulty / seed | 585 轮全部相同 / all 585 rounds identical |
| 安装的包 hash（slot 内容）/ installed package hash (slot content) | 60 场全部相同 / all 60 matches identical |

**计时层面：不可复现。**

**Timing level: not reproducible.**

- 866 个可配对的非空单侧耗时中，**0 个相同**；平均差 +0.71 ms，标准差 4.13 ms，极值 −39.6 ms / +43.9 ms；33% 相差 >1 ms，7% 相差 >5 ms。
- Of 866 pairwise non-empty single-side timings, **0 were identical**; mean difference +0.71 ms, standard deviation 4.13 ms, extremes −39.6 ms / +43.9 ms; 33% differ >1 ms, 7% differ >5 ms.
- 60 场的 `wallSeconds` 全部不同。
- All 60 matches have different `wallSeconds`.

**状态 hash：全部不同，但与战斗无关。** `publicStateHash` / `revealStateHash` / `roundStateHash` 在 585 轮中全部不同，`matchId` 60 场零重叠。根因是 `buildPublicState` / `buildRevealState` 把每场随机生成的 `match_id` 嵌入了状态 JSON，因此这些 hash 差异**不携带任何关于战斗随机性的信息**。

**State hashes: all different, but combat-independent.** `publicStateHash` / `revealStateHash` / `roundStateHash` differ in all 585 rounds, `matchId` has zero overlap across 60 matches. Root cause: `buildPublicState` / `buildRevealState` embed the randomly generated `match_id` into state JSON, so these hash differences **carry no information about combat randomness**.

> **修正 rev 1 的过度断言**：rev 1 写作「平台对固定算法对 + 固定种子是完全确定的」。
> 严格地说，**只有判定是确定且可重放的；计时是墙上时钟，明确不可复现**。
> 本报告后续任何用到 `aTimeMs` / `bTimeMs` 的地方，都只作为**分布统计**使用，不作为可复现的定量事实。

> **Correcting rev 1's over-assertion**: rev 1 stated "the platform is completely deterministic for fixed algorithm pairs + fixed seeds."
> Strictly speaking, **only judgment is deterministic and reproducible; timing is wall-clock time, explicitly not reproducible**.
> Anywhere this report subsequently uses `aTimeMs` / `bTimeMs`, it is only as **distributional statistics**, not as reproducible quantitative facts.

---

## 3. Hybrid Design

## 3. Hybrid 设计

`playtest/competitors/solver-hybrid/` — **Hybrid Tactical-First Anytime Optimizer**

`playtest/competitors/solver-hybrid/` — **混合战术优先任意时算法优化器**

设计契约（任务书 §9）：

Design contract (task specification §9):

> 在任意较早时间停止，都已经拥有一个可执行的合法候选；随着计算继续，函数质量逐步提高。

> If stopped at any earlier time, already possesses an executable legal candidate; as computation continues, function quality gradually improves.

字面实现：第一个被构造的东西就是一条保证合法的 fallback；`best` 在任何候选胜过它时立即更新；每个阶段边界都是「此刻停手也能交卷」的点。

Literal implementation: the first thing constructed is a guaranteed-legal fallback; `best` is immediately updated whenever any candidate beats it; every stage boundary is a "can submit even if stopped now" point.

| 阶段 / Stage | 内容 / Content | 实测（1170 个世界）/ Measured (1170 worlds) |
|---|---|---|
| **Stage 1 战术 / Stage 1 Tactical** | 刺杀直线、对每个敌点的直线、恰过（对方 Shooter + 任一敌点）的二次曲线、单参数 bend 族 / Assassination lines, lines to each enemy point, quadratics passing exactly through (opponent Shooter + any enemy point), single-parameter bend family | 中位 **3.26 ms**，候选中位 18 / median **3.26 ms**, candidate median 18 |
| **Stage 2 多目标 / Stage 2 Multi-target** | ≤3 点精确有理插值、三角族、复合族 / ≤3-point exact rational interpolation, trigonometric family, composite family | 仅 631/1170 次进入，中位 5.99 ms / only 631/1170 entered, median 5.99 ms |
| **Stage 3 深挖 / Stage 3 Deep search** | 自由度扫描下更大组合、局部细化 / Larger combinations under degree-of-freedom sweep, local refinement | 仅 598/1170 次进入，中位 0.01 ms / only 598/1170 entered, median 0.01 ms |

**EARLY RETURN（§6）**：Stage 1 覆盖的是**整个廉价战术族**（不是采样）。因此 Stage 1 走完时若已持有 shooter kill 或 ≥2 杀，**立即开火、不再进入后续阶段**。

**EARLY RETURN (§6)**: Stage 1 covers the **entire cheap tactical family** (not sampling). Therefore, when Stage 1 completes, if already holding a shooter kill or ≥2 kills, **fire immediately, do not enter subsequent stages**.

| 停止原因 / Stop reason | 占比 / Proportion |
|---|---|
| `stage1: shooter + another kill` | 30.2% |
| `stage1: decisive tactical shot` | 15.9% |
| `stage2: shooter + another kill` / `triple kill` | 1.5% / 1.4% |
| `stage3: shooter + another kill` | 0.1% |
| budget exhausted（无决定性解）/ budget exhausted (no decisive solution) | 51.0% |

**46.1% 的回合在 Stage 1 直接开火** —— 这正是 Hybrid 能与 Fast 同速度档的原因。

**46.1% of rounds fire directly in Stage 1** — this is precisely why Hybrid can match Fast's speed tier.

### 3.1 几何与合法性

### 3.1 Geometry and legality

```
V = (x − x_s) / L,   f(x) = y_s + g(V),   g(0) = 0
```

- `f(x_s) = y_s` 是**恒等式**，不会漂移到 1e-6 容差边缘（kit §9 的建议）。
- `f(x_s) = y_s` is an **identity**, will not drift to the 1e-6 tolerance edge (kit §9 recommendation).
- `L` 归一化到 `|V| ≤ 1`，多项式系数自然落在 `|const| ≤ 1000` 内。
- `L` normalizes to `|V| ≤ 1`, polynomial coefficients naturally fall within `|const| ≤ 1000`.
- 多项式用 `fractions.Fraction` **精确求解**；V 上聚集的目标组合会使 Vandermonde 病态（系数冲到 3×10⁴），这类组合被**显式跳过**。
- Polynomials are solved **exactly** using `fractions.Fraction`; target combinations clustered on V make Vandermonde ill-conditioned (coefficients surge to 3×10⁴), such combinations are **explicitly skipped**.
- 轨迹扫描**保守**：无法证明通畅即判 blocked。
- Trajectory scanning is **conservative**: if clearance cannot be proven, judged as blocked.

### 3.2 规则来源（合规声明）

### 3.2 Rule sources (compliance statement)

Hybrid 的设计输入**只有**冻结的 Playtest Rules 与公开的 `competitor-kit/`。场地边界终止取自 §34 明文，并在第一轮由独立黑盒 cross-check（866/866）确认。

Hybrid's design inputs are **only** the frozen Playtest Rules and public `competitor-kit/`. Arena boundary termination is taken from §34 plaintext, and was confirmed in Round 1 by independent black-box cross-check (866/866).

> **流程说明（主动披露）**：编制 competitor-kit 参考文档时，一个子 agent 读取了 `src/core/Judge.ts`。该处得到的内部细节（采样步长 `min(0.005, π/(8ω))`、`maxPoints`、`OBSTACLE_CONTACT_EPS`、`penetration` 约定）**已明确排除在 Hybrid 设计输入之外**。y 边界终止规则本身属 §34 公开内容，不构成泄漏使用。

> **Process disclosure (voluntary)**: When drafting competitor-kit reference documentation, a sub-agent read `src/core/Judge.ts`. Internal details obtained there (sampling step `min(0.005, π/(8ω))`, `maxPoints`, `OBSTACLE_CONTACT_EPS`, `penetration` convention) **are explicitly excluded from Hybrid design inputs**. The y-boundary termination rule itself belongs to §34 public content and does not constitute leaked usage.

---

## 4. Hybrid Benchmark

## 4. Hybrid 基准测试

### 4.1 Local Validator / Official Preflight

### 4.1 本地验证器 / 官方预检

```
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
PRE-FLIGHT PASS — 2 teams × 9 sections all passed
包哈希 / Package hash: a11dbf0a47622305ac123b2efeec07d8d4d653c955cc69f6f00b1f8dd44942b
Team A / Team B 耗时 / time: 14.7 / 14.9 ms（上限 / limit: 2000 ms）
```

同一哈希在两组实验槽位安装报告（`install-report.json`）中记录一致，可交叉核对。

The same hash is recorded consistently in both experimental slot installation reports (`install-report.json`), can be cross-verified.

### 4.2 离线鲁棒性矩阵（§10）

### 4.2 Offline robustness matrix (§10)

公开 operator CLI **无法产出 0 或 1 障碍的地图**（本轮独立复验：`--obstacles 0` / `--obstacles 1` 均被拒为未知选项；`--difficulty` 只映射 easy=2 / medium=4 / hard=6）。因此 0/1 障碍的**平台级比赛**无法在不读取 MapGenerator 的前提下产生——记为 TEST LIMITATION。

The public operator CLI **cannot produce maps with 0 or 1 obstacles** (independently verified this round: `--obstacles 0` / `--obstacles 1` both rejected as unknown options; `--difficulty` only maps easy=2 / medium=4 / hard=6). Therefore, **platform-level competitions** with 0/1 obstacles cannot be produced without reading MapGenerator—recorded as TEST LIMITATION.

算法侧矩阵在离线完成（`gb_matrix.py`：合成世界 + 公开合法性筛查 + 黑盒命中模型）：

Algorithm-side matrix completed offline (`gb_matrix.py`: synthetic worlds + public legality screening + black-box hit model):

| 包 / Package | runs | illegal | TIMEOUT | no result |
|---|---|---|---|---|
| **solver-hybrid** | 600 | **0** | **0** | **0** |
| solver-fast | 600 | 0 | 0 | 0 |
| solver-optimizer | 600 | 0 | 0 | 0 |

形状：障碍 {0,1,2,4,6} × 人数 {6,8,10} × 队别 {A,B} × 20 seeds。Hybrid 在 0 障碍时平均预测击杀 2.00，6 障碍时 1.60–1.88。

Shape: obstacles {0,1,2,4,6} × team size {6,8,10} × team {A,B} × 20 seeds. Hybrid achieves average predicted kills of 2.00 with 0 obstacles, 1.60–1.88 with 6 obstacles.

### 4.3 与另两套算法的对照

### 4.3 Comparison with the other two algorithms

| 指标 / Metric | Hybrid | Fast（Round-1 bench） | Optimizer（Round-1 bench） |
|---|---|---|---|
| 非法 / 崩溃（1170 次）/ illegal / crash (1170 invocations) | **0** | 0 | 0 |
| 墙上时间中位 / wall time median | 29.4 ms | 27.2 ms | 189.7 ms |
| 墙上时间 p95 / max / wall time p95 / max | 85.8 / 493.9 ms | 53.5 / 75.8 ms | 332.6 / 14741 ms |
| 自身口径耗时中位 / self-reported time median | 8.6 ms | — | — |
| 预测命中对方 Shooter / predicted hit on opponent Shooter | 48.3% | 53.6% | 55.0% |
| 预测击杀均值 / predicted kills mean | 0.93 | 0.97 | 1.43 |

**ALGORITHM FINDING**：Hybrid 与 Fast 同属速度档。

**ALGORITHM FINDING**: Hybrid and Fast belong to the same speed tier.

**ALGORITHM FINDING（Stage 3 的边际价值）**：在 1170 个真实世界上，Stage 3 产出了候选（最多 235 个）却只改变了 **1 次**最终选择。在当前规则集上，**一旦战术解存在，更深的曲线拟合几乎不产生价值**——这是对「先手速度是否过度压制函数质量」的一条算法内直接回答。

**ALGORITHM FINDING (Marginal value of Stage 3)**: Across 1170 real worlds, Stage 3 produced candidates (up to 235) but only changed the final selection **1 time**. Under the current ruleset, **once tactical solutions exist, deeper curve fitting produces almost no value**—this is a direct within-algorithm answer to "does first-solver speed excessively suppress function quality."

---

## 5. Current-rule Results

## 5. 当前规则结果

规模（§13）：每组 pair 均为 **30 个条件 × 槽位互换 = 60 场**。

Scale (§13): Each pair consists of **30 conditions × slot swap = 60 matches**.

- 条件集与第一轮**完全相同**（同 seeds / 人数 / 难度），可与 Round-1 直接比较。
- Condition set is **completely identical** to Round 1 (same seeds / team sizes / difficulties), directly comparable to Round 1.
- 地图：6v6 / 8v8 / 10v10 × easy / medium / hard，30 个互不相同的地图哈希。
- Maps: 6v6 / 8v8 / 10v10 × easy / medium / hard, 30 distinct map hashes.
- 外部轮数上限 `--max-rounds 30`（**仅测试护栏，非比赛规则**——这一点在 §14 有决定性后果）。
- External round cap `--max-rounds 30` (**test guardrail only, not competition rule**—this has decisive consequences in §14).
- 三组共 **180 场**，合计约 1900 秒墙钟。
- Three groups total **180 matches**, approximately 1900 seconds wall time.

| pair | 胜者 A / Winner A | 胜者 B / Winner B | Draw |
|---|---|---|---|
| **fast-vs-hybrid** | Fast **26** | Hybrid **8** | **26** |
| **optimizer-vs-hybrid** | Hybrid **39** | Optimizer **4** | **17** |
| **fast-vs-optimizer** | Fast **50** | Optimizer **0** | **10** |

**0 INVALID · 0 TIMEOUT · 0 CRASH**（180 场 / 2316 轮 / 3774 次实际执行的射击）。

**0 INVALID · 0 TIMEOUT · 0 CRASH** (180 matches / 2316 rounds / 3774 actually executed shots).

---

## 6. Fast vs Hybrid（§15 的核心问题）

## 6. Fast vs Hybrid (Core question of §15)

| | Fast | Hybrid |
|---|---|---|
| wins / 胜利 | **26** | **8** |
| draw / 平局 | 26 | 26 |
| first-shot rate / 先手率 | **0.768** | 0.232 |
| 被取消轮次 / cancelled rounds | 117 (11.8%) | 187 (18.9%) |
| kills / 击杀 | **378** | 260 |
| shooter kills / Shooter 击杀 | **193** | 118 |
| kills per valid shot / 每次有效射击击杀 | **0.433** | 0.324 |
| multi-kill rate / 多重击杀率 | 0.146 | 0.097 |
| no-hit rate / 零命中率 | 0.766 | 0.842 |
| 计算时间中位 / p95 / compute time median / p95 | 16.1 / 36.7 ms | 23.6 / 168.0 ms |

### 6.1 draw 不是均势，而是时钟到期

### 6.1 Draws are not equilibrium, but clock expiration

**26 个 draw 全部是 `exhausted=True`（打满 30 轮上限）。** 其中：

**All 26 draws have `exhausted=True` (hit the 30-round cap).** Among them:

- **12 / 26 的存活分差 ≥ 2**，5 / 26 的分差 ≥ 4。
- **12 / 26 have survival difference ≥ 2**, 5 / 26 have difference ≥ 4.
- 极端案例 `s1111-p10-medium__fast-A`：Fast 存活 10 点 / 8 杀，Hybrid 存活 2 点 / 0 杀 —— 记录为 **draw**。
- Extreme case `s1111-p10-medium__fast-A`: Fast survives 10 points / 8 kills, Hybrid survives 2 points / 0 kills — recorded as **draw**.
- 26 个 draw 的合计击杀差：Fast +12，Hybrid −9，0 平。
- Aggregate kill difference across 26 draws: Fast +12, Hybrid −9, 0 tied.

**按击杀差（或存活差，结果相同）对 draw 裁决后：Fast 38 / Hybrid 17 / 5 完全平。**

**After adjudicating draws by kill difference (or survival difference, same result): Fast 38 / Hybrid 17 / 5 completely tied.**

### 6.2 修正 rev 1 的过度断言

### 6.2 Correcting rev 1's over-assertion

rev 1 写作「净胜差从 +50 压到 +18」，并据此判定 Hybrid 实质缩小了差距。该比较**不成立**：

rev 1 stated "net win difference compressed from +50 to +18" and concluded Hybrid materially closed the gap. This comparison **does not hold**:

- Round-1 的 50-0-10 中 **50/50 场都是已决**；本轮 fast-vs-hybrid 只有 **34/60 已决**。
- In Round 1's 50-0-10, **50/50 matches were decided**; this round's fast-vs-hybrid has only **34/60 decided**.
- 跨不同「已决场数」直接比净值是苹果比橘子。
- Directly comparing net values across different "decided match counts" is comparing apples to oranges.
- 按裁决口径，Fast 的胜率从 100%（50/50）降到 **69%（38/55）**——确实显著下降，但**仍是明确的领先**（二项检验 P(Fast ≥ 26/34 | 公平) ≈ 0.0015）。
- By adjudication caliber, Fast's win rate dropped from 100% (50/50) to **69% (38/55)**—indeed significantly down, but **still a clear lead** (binomial test P(Fast ≥ 26/34 | fair) ≈ 0.0015).

**诚实的表述**：

**Honest statement**:

> Hybrid **显著收窄**了与 Fast 的差距（Fast 的已决胜率 100% → 69%，且拿下 8 场胜利，而 Optimizer 拿 0 场），但**没有关闭**它；而且约 43% 的对局根本没有分出胜负，这些僵持把差距「吸收」进了 draw 里。

> Hybrid **significantly narrowed** the gap with Fast (Fast's decided win rate 100% → 69%, and won 8 matches while Optimizer won 0), but **did not close** it; moreover, about 43% of matches reached no decision, these stalemates "absorbed" the gap into draws.

对照 `optimizer-vs-hybrid`（Hybrid 39 / Optimizer 4）可以看出：Hybrid 相对 **Optimizer** 的跃升是决定性的；相对 **Fast** 则只是收窄。

Comparing to `optimizer-vs-hybrid` (Hybrid 39 / Optimizer 4) shows: Hybrid's leap over **Optimizer** is decisive; relative to **Fast** it's only narrowing.

---

## 7. Optimizer vs Hybrid

## 7. Optimizer vs Hybrid

| | Hybrid | Optimizer |
|---|---|---|
| wins / 胜利 | **39** | **4** |
| draw / 平局 | 17 | 17 |
| first-shot rate / 先手率 | **0.9987** | 0.0000 |
| 被取消轮次 / cancelled rounds | **0** | 250 (33.7%) |
| kills / 击杀 | **434** | 144 |
| shooter kills / Shooter 击杀 | **250** | 47 |

Hybrid 对 Optimizer 的统治形态，与 Fast 对 Optimizer **完全同构**：更快 → 每轮必先手 → 33.7% 的回合直接把对方整轮取消。

Hybrid's dominance pattern over Optimizer is **completely isomorphic** to Fast over Optimizer: faster → first every round → 33.7% of rounds directly cancel opponent's entire round.

**RULE-DESIGN FINDING**：同一套规则下，两套互不相关的快算法用同一种机制碾压了同一套慢算法。速度优势的传递路径被独立复现了两次。

**RULE-DESIGN FINDING**: Under the same ruleset, two independent fast algorithms crushed the same slow algorithm using the same mechanism. The transmission path of speed advantage was independently reproduced twice.

---

## 8. Slot Swap（§12）

## 8. 槽位互换（§12）

每种地图条件都跑了 `X = Team A` 与 `Y = Team A` 两种排布，使用**同一 seed**（看到同一张图）。

Each map condition was run in both `X = Team A` and `Y = Team A` arrangements, using **the same seed** (seeing the same map).

**修正 rev 1 的报告口径**：rev 1 只打印了 `swapConsistent / swapFlipped`，没有给出分母，读起来像是覆盖了全部 30 个条件。实际上该度量**只统计两腿都已决的条件**，其余（涉及 draw 的）被静默排除。完整分解如下：

**Correcting rev 1's reporting caliber**: rev 1 only printed `swapConsistent / swapFlipped` without denominators, reading as if covering all 30 conditions. In reality, this metric **only counts conditions where both legs decided**, others (involving draws) are silently excluded. Full breakdown:

| pair | 两腿同判 / Both legs same | 两腿相反 / Both legs opposite | 单腿 draw / One leg draw | 双腿 draw / Both legs draw | 可分类占比 / Classifiable proportion |
|---|---|---|---|---|---|
| fast-vs-hybrid | 6 | **6** | 10 | 8 | **12 / 30 (40%)** |
| optimizer-vs-hybrid | 14 | 3 | 9 | 4 | **17 / 30 (57%)** |
| fast-vs-optimizer | 21 | 0 | 8 | 1 | **21 / 30 (70%)** |

fast-vs-hybrid 的 6 个**完全反转**条件（同一张图，换槽位后胜者互换）：

6 **completely reversed** conditions in fast-vs-hybrid (same map, winner swaps after slot swap):

| condition | fast-A 腿胜者 / fast-A leg winner | hybrid-A 腿胜者 / hybrid-A leg winner |
|---|---|---|
| s909-p8-medium | hybrid | fast |
| s1414-p10-medium | hybrid | fast |
| s1616-p6-easy | hybrid | fast |
| s2222-p6-easy | hybrid | fast |
| s2424-p8-easy | fast | hybrid |
| s2626-p10-easy | fast | hybrid |

### 8.1 算法效应 vs 槽位效应（§12 要求区分）

### 8.1 Algorithm effect vs slot effect (§12 requires distinction)

- **槽位效应：未发现。** 两种排布**逐项完全对称**（fast-vs-hybrid 的 fast-A 与 hybrid-A 均为 13 / 4 / 13）；全量 A/B 槽位计时中位数均为 **21.2 ms**；先手占比 A=0.5099 / B=0.4896。
- **Slot effect: not found.** Both arrangements are **item-by-item perfectly symmetric** (fast-vs-hybrid's fast-A and hybrid-A both 13 / 4 / 13); full A/B slot timing median both **21.2 ms**; first-solver proportion A=0.5099 / B=0.4896.
- **算法效应：存在。** fast-vs-optimizer 在两种排布下都是 Fast 压倒性领先（26 vs 24 胜），这是纯粹的算法差异。
- **Algorithm effect: exists.** fast-vs-optimizer has Fast overwhelmingly ahead in both arrangements (26 vs 24 wins), this is pure algorithm difference.
- **但 fast-vs-hybrid 的算法效应无法被干净地分离**：只有 40% 的条件两腿都已决，其中一半还是反转。**这说明两套同档快算法之间，同一张图的胜负对极小的时序抖动高度敏感**——这本身就是一条结论，而不是噪声。
- **But fast-vs-hybrid's algorithm effect cannot be cleanly separated**: only 40% of conditions have both legs decided, half of which reversed. **This indicates that between two same-tier fast algorithms, match outcomes on the same map are highly sensitive to tiny timing jitter**—this itself is a conclusion, not noise.

### 8.2 §24 的 start skew —— 不可观测

### 8.2 §24's start skew — not observable

任务书 §24 要求记录 `start skew`。**平台公开产物中不存在该量**：`match.json` 的每轮只有 `aTimeMs` / `bTimeMs`（各自 GO 锚定的计算耗时）与 `firstSolver`，`console.log` 中也没有 `release_ns` 或任何起点偏移字段（本轮已 grep 确认）。

Task specification §24 requires recording `start skew`. **This quantity does not exist in platform public artifacts**: each round in `match.json` only has `aTimeMs` / `bTimeMs` (each side's GO-anchored compute time) and `firstSolver`, `console.log` also has no `release_ns` or any start offset field (grep-confirmed this round).

因此：

Therefore:

> **`start skew` 是本 harness 不可观测的量。** §8.1 的"未发现槽位偏置"结论建立在 **计算耗时分布 + 先手占比**之上，而不是建立在实测起点偏移之上。若平台要支撑 §24 的完整要求，需要在产物中暴露双方的 GO 交付时刻。

> **`start skew` is an unobservable quantity for this harness.** The §8.1 conclusion "slot bias not found" is based on **compute time distribution + first-solver proportion**, not on measured start offset. If the platform needs to support §24's full requirements, it must expose both sides' GO delivery moments in artifacts.

---

## 9. Counterfactual No-Cancel（§16 / §19）

## 9. 反事实无取消模式（§16 / §19）

模式定义（规范 §39/§55 只给出名称与用途，**未定义精确语义**；以下为本 harness 的定义）：

Mode definition (specification §39/§55 only gives name and purpose, **does not define precise semantics**; below is this harness's definition):

> **CF-NO-CANCEL**：保留 §36 First Solver 与冻结快照，只移除 §38。先手射击照常结算；后手**即使其 Shooter 刚刚阵亡，只要它已产出合法函数，其攻击仍然执行**。

> **CF-NO-CANCEL**: Retains §36 First Solver and frozen snapshot, only removes §38. First-solver shot resolves normally; second solver **even if its Shooter just died, as long as it produced a legal function, its attack still executes**.

### 结果：胜负完全反转

### Result: outcomes completely reversed

| fast-vs-optimizer | Fast | Optimizer | Draw |
|---|---|---|---|
| 官方规则 / Official rules | **50** | **0** | 10 |
| CF-NO-CANCEL | **2** | **38** | 20 |

| optimizer-vs-hybrid | Hybrid | Optimizer | Draw |
|---|---|---|---|
| 官方规则 / Official rules | **39** | **4** | 17 |
| CF-NO-CANCEL | **3** | **37** | 20 |

| fast-vs-hybrid | Fast | Hybrid | Draw |
|---|---|---|---|
| 官方规则 / Official rules | **26** | **8** | 26 |
| CF-NO-CANCEL | **13** | **10** | **37** |

读法：

Interpretation:

- 前两组被**彻底翻转**：Optimizer 从「几乎不可能赢」变成「压倒性多数赢」。取消规则不是 Fast 的加分项，而是 Optimizer 的**否决项**。
- First two groups **completely reversed**: Optimizer changed from "almost impossible to win" to "overwhelming majority wins". Cancellation rule is not Fast's bonus, but Optimizer's **veto**.
- 第三组几乎不动（净差 +18 → +3，变化主要是 draw 26→37）。**Hybrid 与 Fast 之间的差距不是取消造成的**，而是真实的质量/速度差异——两条独立的证据线指向同一结论。
- Third group barely moved (net difference +18 → +3, change mainly draws 26→37). **The gap between Hybrid and Fast is not caused by cancellation**, but real quality/speed difference—two independent lines of evidence point to the same conclusion.

---

## 10. Counterfactual Simultaneous（§17 / §20）

## 10. 反事实同步模式（§17 / §20）

> **CF-SIMULTANEOUS**：§36 与 §38 一并移除。不存在 first solver；双方合法函数都对 START 快照结算。

> **CF-SIMULTANEOUS**: Both §36 and §38 removed. No first solver; both sides' legal functions resolve against START snapshot.

### 结果：与 CF-NO-CANCEL 在 180/180 次比较中**逐回合完全相同**

### Result: **round-by-round completely identical** to CF-NO-CANCEL in 180/180 comparisons

比较粒度是**逐回合击杀列表**，不只是胜者。

Comparison granularity is **per-round kill list**, not just winner.

| pair | 官方 / Official | CF-NO-CANCEL | CF-SIMULTANEOUS | 一致 / Match |
|---|---|---|---|---|
| fast-vs-optimizer | 50-0-10 | 2-38-20 | 2-38-20 | 60 / 60 |
| optimizer-vs-hybrid | 39-4-17 | 3-37-20 | 3-37-20 | 60 / 60 |
| fast-vs-hybrid | 26-8-26 | 13-10-37 | 13-10-37 | 60 / 60 |

### 【重要】修正 rev 1 的方法论断言

### 【Important】Correcting rev 1's methodological assertion

rev 1 声称「两种模式是独立代码路径，因此『是否等价』是**测量结果**」。**这是错的。** 两者在**构造上就等价**，原因是规范本身，不是实验发现：

rev 1 claimed "two modes are independent code paths, therefore 'whether equivalent' is a **measurement result**". **This is wrong.** They are **equivalent by construction**, due to the specification itself, not experimental discovery:

> §40/§41 规定回合快照在 START 冻结、后手不重新计算。既然双方曲线都对**同一快照**结算，「谁先攻击」除了触发 §38 之外**没有任何影响结果的通道**。因此「移除顺序」与「只移除取消」在数学上是同一个操作。

> §40/§41 stipulate that round snapshot freezes at START, second solver does not recompute. Since both sides' curves resolve against **the same snapshot**, "who attacks first" has **no channel to affect results** except triggering §38. Therefore "removing order" and "only removing cancellation" are mathematically the same operation.

所以 180/180 的一致**是对实现忠实编码了该模型的校验**，不是支持等价性的独立证据。rev 2 已据此改写代码注释与报告表述。

So 180/180 consistency **is validation that the implementation faithfully encoded this model**, not independent evidence supporting equivalence. rev 2 has rewritten code comments and report statements accordingly.

**RULE-DESIGN FINDING（本轮最重要的结构性结论）**：

**RULE-DESIGN FINDING (this round's most important structural conclusion)**:

> **在本规则集下，速度影响胜负的唯一通道就是 Shot Cancellation。**

> **Under this ruleset, the only channel through which speed affects outcomes is Shot Cancellation.**

这也回答了 §20：当速度不再影响执行顺序时，三者的相对强弱**确实明显改变**，但改变**完全来自取消的消失**，而非顺序本身。

This also answers §20: when speed no longer affects execution order, the relative strength among the three **does indeed change significantly**, but the change **comes entirely from the disappearance of cancellation**, not from order itself.

---

## 11. Cancellation Effect（§19）

## 11. 取消效应（§19）

### 11.1 回合级取消代价

### 11.1 Round-level cancellation cost

方法：对每个被取消的回合，**在该回合的官方世界**上离线重跑被取消方的算法取得其真实函数，再按「取消被移除」重解。

Method: For each cancelled round, offline re-run the cancelled side's algorithm on **that round's official world** to obtain its real function, then re-solve with "cancellation removed".

> rev 1 的实现把 CF 传播后的存活集当作世界向前推进，**系统性低估**了结果。rev 2 已修正为使用官方逐轮世界（`aliveBefore`），数字变化很大（见下）。

> rev 1's implementation advanced the world using CF-propagated survival sets, **systematically underestimating** results. rev 2 has corrected to use official per-round worlds (`aliveBefore`), numbers changed significantly (see below).

| pair | 算法 / Algorithm | 轮次 / Rounds | 被取消 / Cancelled | 其中本可命中 / Could have hit | **损失击杀 / Lost kills** | **落在最终幸存点上 / On final survivors** | 损失的反杀 Shooter / Lost Shooter counter-kills |
|---|---|---|---|---|---|---|---|
| fast-vs-optimizer | optimizer | 585 | 304 (52.0%) | 303 | **787** | **667 (84.8%)** | **253** |
| optimizer-vs-hybrid | optimizer | 741 | 250 (33.7%) | 250 | **663** | 514 (77.5%) | 213 |
| fast-vs-hybrid | hybrid | 990 | 187 (18.9%) | 178 | 316 | 160 (50.6%) | 164 |
| fast-vs-hybrid | fast | 990 | 117 (11.8%) | 117 | 119 | 57 (47.9%) | 115 |

**「落在最终幸存点上」这一列是关键的证伪检验**：它排除了「这些击杀本来就打在被别人杀掉的点上、因此不算真损失」这一替代解释。在 fast-vs-optimizer 中，**84.8% 的损失击杀的目标在官方对局结束时仍然存活**——它们是真正被打断的击杀。

**The "on final survivors" column is the critical falsification test**: it rules out the alternative explanation "these kills would have landed on points already killed by others, so not real losses". In fast-vs-optimizer, **84.8% of lost kills targeted points that survived to the official match end**—these are truly interrupted kills.

其余数字：

Other numbers:

- **787 次击杀**对比 Optimizer 全场实际 **76 次**击杀——取消抹掉了其曲线所能产生的击杀的 **约 91%**。
- **787 kills** compared to Optimizer's actual **76 kills** across all matches—cancellation erased approximately **91%** of the kills its curves could have produced.
- **253 次**被取消的射击本身就是对 Fast Shooter 的反杀（占全部回合的 43%）。若允许执行，Optimizer 在将近一半的回合里本可以反过来取消 Fast 的整轮。
- **253** cancelled shots were themselves counter-kills on Fast's Shooter (43% of all rounds). If allowed to execute, Optimizer could have reversed and cancelled Fast's entire round in nearly half of all rounds.

### 11.2 该结论的稳健性（独立复核）

### 11.2 Robustness of this conclusion (independent verification)

对抗式复核用一个**从零编写的独立模拟器**（不同代码、不同解析循环）复现了 CF-NO-CANCEL 的 38-2-20，**0/60 分歧**；并从全新缓存重跑（1360 次离线求解，零复用）得到逐场字节相同的结果。同时排除了替代解释：

Adversarial review used an **independently written simulator from scratch** (different code, different parsing loop) to reproduce CF-NO-CANCEL's 38-2-20, **0/60 divergence**; and re-ran from fresh cache (1360 offline solves, zero reuse) obtaining byte-identical results per match. Simultaneously ruled out alternative explanations:

- 离线重跑的求解器在官方世界上**逐字节复现平台记录的函数**（217/217）。
- Offline re-run solvers **byte-for-byte reproduced platform-recorded functions** on official worlds (217/217).
- 全部 CF 重跑函数 **222/222 通过公开合法性筛查**，不存在非法曲线被高估。
- All CF re-run functions **222/222 passed public legality screening**, no illegal curves were overestimated.
- 全场无超时（最大记录耗时 356 ms，上限 2000 ms）。
- No timeouts across all matches (max recorded time 356 ms, limit 2000 ms).

---

## 12. Speed Effect（§20）

## 12. 速度效应（§20）

| 算法 / Algorithm | 有效射击 / Valid shots | first-shot rate | 被取消率 / Cancellation rate | kills / valid shot |
|---|---|---|---|---|
| fast | 1458 | **0.854** | 0.074 | **0.578** |
| hybrid | 1544 | 0.560 | 0.108 | 0.449 |
| optimizer | 772 | **0.000** | **0.418** | 0.285 |

速度阶梯 Fast > Hybrid > Optimizer 在 first-shot rate、取消率、kills-per-shot 三个维度上单调。

Speed ladder Fast > Hybrid > Optimizer is monotonic across three dimensions: first-shot rate, cancellation rate, kills-per-shot.

回答 §20：

Answer to §20:

> 速度不再影响执行顺序时，相对强弱**明显改变**——Optimizer 从两种对阵的全败变为压倒性多数胜。而由于 §10 已证明「顺序」本身无影响，这个改变**完全归因于 Shot Cancellation 的消失**。

> When speed no longer affects execution order, relative strength **changes significantly**—Optimizer changed from complete defeat in both matchups to overwhelming majority wins. And since §10 has proven "order" itself has no effect, this change is **entirely attributable to the disappearance of Shot Cancellation**.

---

## 13. No-progress Distribution（§21）

## 13. 零进展分布（§21）

No-progress 定义采用规范 §46 候选定义：某回合双方击杀均为 0 则 streak +1，任一方产生击杀则归零。

No-progress definition adopts specification §46 candidate definition: if both sides have 0 kills in a round, streak +1; if either side produces kills, reset to zero.

| 分位 / Percentile | 连续零击杀轮数（n = 180 场）/ Consecutive zero-kill rounds (n = 180 matches) |
|---|---|
| P50 | 0 |
| P75 | 21 |
| P90 | 25 |
| P95 | 26 |
| P99 | 28 |
| MAX | 29 |

### 13.1 【重要】这组分位数不是一条 streak 分布

### 13.1 【Important】This set of percentiles is not a streak distribution

对抗式复核指出并已由本轮独立确认：**这组数字不能作为阈值依据**，原因有三。

Adversarial review pointed out and independently confirmed this round: **these numbers cannot serve as threshold basis**, for three reasons.

**(a) 分布是二值的。** 180 场中 **127 场的 streak 恰好为 0**（每轮都有击杀）；其余 **53 场恰好就是打满 30 轮上限的 53 场**。不存在任何「中途结束的中等长度 streak」。对全部 53 场逐一核对：**观测 streak ≡ 30 − 最后击杀轮**。

**(a) The distribution is bimodal.** Among 180 matches, **127 matches have streak exactly 0** (kills every round); the remaining **53 matches are exactly the 53 matches that hit the 30-round cap**. No "mid-game ending medium-length streaks" exist. Verified all 53 matches individually: **observed streak ≡ 30 − last kill round**.

**(b) 这些尾部是吸收式不动点，不是慢收敛。** 对 53 场逐项检查：

**(b) These tails are absorbing fixed points, not slow convergence.** Inspected all 53 matches item-by-item:

- Shooters 恒定（自动选择「存活点中 id 最小者」，状态不变则选择不变）；
- Shooters constant (automatically select "lowest id among survivors", state unchanged means selection unchanged);
- **双方每轮发出的函数 hash 恒定**（世界不变 + 求解器确定 ⇒ 同一函数）；
- **Both sides' emitted function hashes constant every round** (world unchanged + deterministic solver ⇒ same function);
- 尾部逐轮命中数为 0（40/53 双方都被挡，其余 13/53 只有一方被挡）；
- Tail rounds have 0 hits per round (40/53 both sides blocked, remaining 13/53 only one side blocked);
- 障碍物恒定。
- Obstacles constant.

即：状态进入一个**双方都打不中、且永远重复同一发**的固定点，此后**永不改变**。

That is: state enters a fixed point where **both sides miss and forever repeat the same shot**, thereafter **never changes**.

**(c) 提高上限不能化解 —— 已直接实验验证。**

**(c) Raising the cap cannot resolve it — directly verified experimentally.**

对 3 场触顶对局用 `--max-rounds 60` 重跑：

Re-ran 3 cap-hitting matches with `--max-rounds 60`:

| condition | arrangement | cap 30 | cap 60 |
|---|---|---|---|
| s101-p6-medium | fast-A | draw, 30 轮, exhausted / draw, 30 rounds, exhausted | **draw, 60 轮, exhausted / draw, 60 rounds, exhausted** |
| s1010-p8-medium | fast-A | draw, 30 轮, exhausted / draw, 30 rounds, exhausted | **draw, 60 轮, exhausted / draw, 60 rounds, exhausted** |
| s1010-p8-medium | hybrid-A | draw, 30 轮, exhausted / draw, 30 rounds, exhausted | **draw, 60 轮, exhausted / draw, 60 rounds, exhausted** |

上限翻倍后**全部仍然触顶**。产物见 `playtest/results/round-2/cap60-probe/`。

After doubling the cap, **all still hit the cap**. Artifacts in `playtest/results/round-2/cap60-probe/`.

**结论**：分位数与上限是 1:1 缩放的（cap=20/30/50/100 → P75 = 11/21/41/91），**任何从这组数字读出的「no-progress 阈值」都只是对任意 harness 配置的重新编码**，不是被测游戏的属性。

**Conclusion**: Percentiles scale 1:1 with cap (cap=20/30/50/100 → P75 = 11/21/41/91), **any "no-progress threshold" read from these numbers is merely re-encoding of arbitrary harness configuration**, not a property of the game being tested.

---

## 14. Match Length Distribution（§21 / §22）

## 14. 对局长度分布（§21 / §22）

| 分位 / Percentile | 对局轮数（n = 180）/ Match rounds (n = 180) |
|---|---|
| P50 | 6 |
| P75 | 30 |
| P90 | 30 |
| P95 | 30 |
| MAX | 30 |
| mean / 均值 | 12.87 |

打到上限（判 `UNDECIDED`）的比例：

Proportion hitting cap (judged `UNDECIDED`):

| pair | 僵持 / 总数 / Stalemate / Total | 比例 / Proportion |
|---|---|---|
| **fast-vs-hybrid** | 26 / 60 | **43.3%** |
| optimizer-vs-hybrid | 17 / 60 | 28.3% |
| fast-vs-optimizer | 10 / 60 | 16.7% |
| **合计 / Total** | **53 / 180** | **29.4%** |

**RULE-DESIGN FINDING**：僵持率与「双方速度档是否接近」强相关。第一轮只有一套快算法（16.7%）；本轮最快的一对（Fast vs Hybrid）把僵持率推到 **43.3%**。

**RULE-DESIGN FINDING**: Stalemate rate strongly correlates with "whether both sides' speed tiers are close". Round 1 had only one fast algorithm (16.7%); this round's fastest pair (Fast vs Hybrid) pushed stalemate rate to **43.3%**.

### Stalemate 证据充分性（§22）

### Stalemate evidence sufficiency (§22)

**答案：NO —— 不足以给出阈值。**

**Answer: NO — insufficient to provide a threshold.**

- **可以支持的**：这些僵持是**真实的吸收式循环**（53/53 永不自行化解，提高到 60 轮仍不化解），因此「规则集缺少终止条件」这一点**是成立的**，且比第一轮（10/60）在更大样本上得到确认。
- **Can support**: These stalemates are **real absorbing loops** (53/53 never self-resolve, still don't resolve at 60 rounds), therefore "ruleset lacks termination condition" **is established**, and confirmed on larger sample than Round 1 (10/60).
- **不能支持的**：**阈值数值**。分布被测试上限右删失，53 个尾部观测全部等于「上限 − 最后击杀轮」，没有任何一个自然分辨率被观测到。**hard round limit 的 30 只是 harness 的默认参数**（`gb_round2.py` / `gb_playtest.py` / `gb_counterfactual.py` 三处 default=30），不是从数据得出的。
- **Cannot support**: **threshold value**. Distribution is right-censored by test cap, all 53 tail observations equal "cap − last kill round", no natural resolution observed. **hard round limit of 30 is merely harness default parameter** (`gb_round2.py` / `gb_playtest.py` / `gb_counterfactual.py` three places default=30), not derived from data.
- 此外，僵持集中在 fast-vs-hybrid 与 medium/hard 高障碍地图上，样本只有 30 张复用地图，**不足以支撑一条普适阈值**。
- Additionally, stalemates concentrate in fast-vs-hybrid and medium/hard high-obstacle maps, sample is only 30 reused maps, **insufficient to support a universal threshold**.

> **rev 1 曾建议 `MAX_NO_PROGRESS_ROUNDS = 20` / `HARD_ROUND_LIMIT = 30`。rev 2 撤回这两个建议。** 它们是从删失分位数上读出来的，属于循环论证。

> **rev 1 recommended `MAX_NO_PROGRESS_ROUNDS = 20` / `HARD_ROUND_LIMIT = 30`. rev 2 withdraws both recommendations.** They were read from censored percentiles, constituting circular reasoning.

**要做出阈值建议，需要先补的实验**：在**不设上限**（或上限远高于任何候选阈值，例如 1000 轮）的条件下测量僵持的自然分布，或对吸收态做显式的规则级处理（例如禁止双方在同一状态下重复发出同一函数）。本轮**未实施任何正式 Stalemate Rule**（§22 明确禁止），也未实施上述实验。

**To make threshold recommendations, experiments needed first**: Measure natural stalemate distribution under **no cap** (or cap far higher than any candidate threshold, e.g., 1000 rounds), or apply explicit rule-level treatment for absorbing states (e.g., prohibit both sides from repeatedly emitting the same function in the same state). This round **did not implement any formal Stalemate Rule** (§22 explicitly forbids), nor did it implement the above experiments.

---

## 15. Platform Findings

## 15. 平台发现

### 15.1 计时异常批次（§23）— 已识别、已隔离、已重跑

### 15.1 Timing anomaly batches (§23) — identified, isolated, re-run

巡检发现 **8 场比赛**出现单侧计算时间 > 300 ms 的回合（同期正常值 13–40 ms）。其中 **2 场为实质性污染**：

Inspection found **8 matches** with rounds showing single-side compute time > 300 ms (normal values 13–40 ms in same period). Among them **2 were substantive contamination**:

| 比赛 / Match | 异常轮数 / Anomalous rounds | 最大耗时 / Max time |
|---|---|---|
| `fast-vs-hybrid / s303-p6-medium__fast-A` | 22 / 60 | **935.7 ms** |
| `fast-vs-hybrid / s1111-p10-medium__fast-A` | 28 / 60 | 357.3 ms |

特征：**双方同时**被拖慢，`aErrorCode` / `bErrorCode` 均为 `null`，无取消 —— 是宿主级停顿，**不是算法失败**。

Characteristics: **both sides simultaneously** slowed, `aErrorCode` / `bErrorCode` both `null`, no cancellation — host-level pause, **not algorithm failure**.

处理：

Handling:

1. 原始产物完整保留在 `playtest/results/round-2/platform-contaminated/`，含 `CONTAMINATION.json`（matchId / seed / 逐轮异常耗时 / winner / rounds）。
1. Original artifacts fully preserved in `playtest/results/round-2/platform-contaminated/`, including `CONTAMINATION.json` (matchId / seed / per-round anomalous times / winner / rounds).
2. 8 场全部重跑。
2. All 8 matches re-run.
3. **重跑后胜负与轮数 100% 一致，无任何结果变化**；`s303` 的最大耗时从 935.7 ms 回落到 74.7 ms。
3. **After re-run, outcomes and rounds 100% consistent, no result changes**; `s303` max time dropped from 935.7 ms to 74.7 ms.

**诚实归因**：`s1111-p10-medium__fast-A`（13:00:19 完成）的窗口与本轮作者执行的一次 `validate-submission` 重负载检查重叠；`s303` 与已知的跨回合沙箱停顿特征一致。两者均属 **PLATFORM-CONTAMINATED / 环境噪声**，不计为算法结果。

**Honest attribution**: `s1111-p10-medium__fast-A` (completed 13:00:19) window overlapped with a `validate-submission` heavy-load check executed by this round's author; `s303` consistent with known cross-round sandbox pause characteristics. Both are **PLATFORM-CONTAMINATED / environmental noise**, not counted as algorithm results.

**局限**：§23 要求保存 `process state` / `sandbox state`。这两项**无法事后补采**——污染是在实验进行中发现的，进程与沙箱已销毁。已保存的是平台自身落盘的 `match.json` / `replay.json` / `console.log` 与逐轮耗时画像。这是本轮在 §23 上的一处**未满足项**。

**Limitation**: §23 requires saving `process state` / `sandbox state`. These two items **cannot be retroactively collected**—contamination was discovered during experiment progress, processes and sandboxes already destroyed. What was saved: platform's own persisted `match.json` / `replay.json` / `console.log` and per-round timing profiles. This is an **unmet item** for §23 in this round.

### 15.2 未发现队别 / 槽位偏置（§24）

### 15.2 Team / slot bias not found (§24)

两种排布逐项对称；A/B 槽位计时中位数相同（21.2 ms）；先手占比 0.5099 / 0.4896。`start skew` **不可观测**（§8.2）。

Both arrangements item-by-item symmetric; A/B slot timing median identical (21.2 ms); first-solver proportion 0.5099 / 0.4896. `start skew` **not observable** (§8.2).

### 15.3 轨迹终止原因分布

### 15.3 Trajectory termination reason distribution

| 算法 / Algorithm | 障碍终止 / Obstacle termination | **场地边界终止 / Arena boundary termination** | 正常到达域末 / Normal domain end | 无函数/被取消 / No function/cancelled |
|---|---|---|---|---|
| fast | 11.9% | **55.3%** | 25.3% | 7.4% |
| hybrid | 64.8% | 6.4% | 18.0% | 10.8% |
| optimizer | 50.2% | 1.7% | 6.3% | 41.8% |

第一轮报告 §5 Finding 1 指出的「场地边界终止未写入 competitor-kit」在本轮被量化：**Fast 有 55.3% 的回合是被场地边界终止的**，远高于障碍终止。

Round 1 report §5 Finding 1's observation "arena boundary termination not documented in competitor-kit" is quantified this round: **Fast has 55.3% of rounds terminated by arena boundary**, far higher than obstacle termination.

### 15.4 平台判定完全可重放

### 15.4 Platform judgment fully reproducible

见 §2.2：60 场 / 585 轮的判定产物逐字段相同。

See §2.2: judgment artifacts for 60 matches / 585 rounds field-by-field identical.

---

## 16. §4 一致性确认（冻结算法 vs 公开 Arena Boundary 规则）

## 16. §4 Consistency confirmation (frozen algorithms vs public Arena Boundary rules)

任务书 §4 要求确认 `solver-fast` / `solver-optimizer` / harness 都按公开的「first arena boundary exit → attack terminates permanently」规则工作。

Task specification §4 requires confirming `solver-fast` / `solver-optimizer` / harness all work according to public "first arena boundary exit → attack terminates permanently" rule.

**本轮提供了直接的一致性证据**（不只是叙述）：§18 的 OFFICIAL MODE 校验逐发比对**平台记录的轨迹末点**与公开规则模型推出的终止点，在 **3774 次已执行的射击上 0 失配**（fast-vs-optimizer 866/866、optimizer-vs-hybrid 1232/1232、fast-vs-hybrid 1676/1676，容差 5e-3）。

**This round provided direct consistency evidence** (not just narrative): §18's OFFICIAL MODE validation compared shot-by-shot **platform-recorded trajectory endpoints** with termination points derived from public rule model, **0 mismatches across 3774 executed shots** (fast-vs-optimizer 866/866, optimizer-vs-hybrid 1232/1232, fast-vs-hybrid 1676/1676, tolerance 5e-3).

这直接证明：三套算法（含两套第一轮冻结算法）与 harness 在**公开规则**下产生的轨迹终止行为与平台一致，不存在依赖隐藏 Judge 行为的残留差异。

This directly proves: all three algorithms (including two Round 1 frozen algorithms) and harness produce trajectory termination behavior consistent with the platform under **public rules**, no residual differences depending on hidden Judge behavior.

---

## 17. Documentation Findings

## 17. 文档发现

1. **任务书引用了不存在的文件名**：§0 要求读取 `Plans/Input/Geometry Battle V1.1 Playtest Rules.md`，本仓库从无此文件。
1. **Task specification references non-existent filename**: §0 requires reading `Plans/Input/Geometry Battle V1.1 Playtest Rules.md`, this repository never had this file.
2. **场地边界终止条件仍未写入 competitor-kit**，而它影响 Fast 55.3% 的回合。
2. **Arena boundary termination condition still not documented in competitor-kit**, yet it affects 55.3% of Fast's rounds.
3. **规范未定义 CF-NO-CANCEL / CF-SIMULTANEOUS 的语义**（§39/§55 只给名称与用途）。本 harness 的定义已写入 `gb_counterfactual.py` 模块 docstring。
3. **Specification does not define CF-NO-CANCEL / CF-SIMULTANEOUS semantics** (§39/§55 only give name and purpose). This harness's definitions are written in `gb_counterfactual.py` module docstring.
4. **`aBlocked` 字段的精确谓词未公开**。OFFICIAL MODE 校验发现：轨迹在**场地边界**终止的回合中，平台 `blocked` 取值为 `True` 106 次 / `False` 209 次（fast-vs-optimizer），模型无法从公开规则复现该谓词。该字段**不参与反事实计算**，不影响本轮任何结论，但第三方无法完整复核平台的 blocked 统计——建议公开其定义。
4. **`aBlocked` field's precise predicate not public**. OFFICIAL MODE validation found: in rounds where trajectory terminates at **arena boundary**, platform `blocked` value is `True` 106 times / `False` 209 times (fast-vs-optimizer), model cannot reproduce this predicate from public rules. This field **does not participate in counterfactual computation**, does not affect any conclusions this round, but third parties cannot fully verify platform's blocked statistics—recommend publishing its definition.
5. **平台不暴露 `start skew`**，使 §24 无法被完整满足（§8.2）。
5. **Platform does not expose `start skew`**, making §24 impossible to fully satisfy (§8.2).

---

## 18. Harness Integrity（§18 门禁）

## 18. Harness Integrity (§18 gate)

门禁要求：OFFICIAL MODE 下 `harness result == official platform result`，否则不得运行反事实统计。

Gate requirement: Under OFFICIAL MODE, `harness result == official platform result`, otherwise counterfactual statistics must not be run.

产物（已持久化，可独立复核）：

Artifacts (persisted, independently verifiable):

```
playtest/results/round-2/cf/verify-fast-vs-optimizer.json
playtest/results/round-2/cf/verify-optimizer-vs-hybrid.json
playtest/results/round-2/cf/verify-fast-vs-hybrid.json
```

| 检查项 / Check item | fast-vs-opt | opt-vs-hybrid | fast-vs-hybrid | 失配合计 / Total mismatches |
|---|---|---|---|---|
| 命中列表（逐发）/ Hit list (per shot) | 866 | 1232 | 1676 | **0** |
| **轨迹终止点 x（对比平台记录的轨迹末点）/ Trajectory termination point x (vs platform-recorded trajectory endpoint)** | 866 | 1232 | 1676 | **0** |
| 取消谓词 / Cancellation predicate | 585 | 740 | 990 | **0** |
| aliveAfter 存活集合 / aliveAfter survival set | 585 | 741 | 990 | **0** |
| 比赛胜者 / Match winner | 60 | 60 | 60 | **0** |

### 18.1 关于门禁范围的显式说明（不掩盖）

### 18.1 Explicit statement about gate scope (not concealing)

门禁本轮的判定为**通过**，但范围有明确界定，逐条声明：

This round's gate judgment is **PASS**, but scope is clearly defined, declared item-by-item:

- **通过的部分**：反事实计算所消费的**每一项**（命中、终止点、取消谓词、存活、胜者）在三个 pair 上全部 0 失配，共 3774 发。
- **Passed portion**: **Every item** consumed by counterfactual computation (hits, termination points, cancellation predicate, survival, winner) has 0 mismatches across three pairs, 3774 shots total.
- **排除的部分**：平台的 `aBlocked` / `bBlocked` 字段。它在 fast-vs-optimizer / fast-vs-hybrid 上分别有 106 / 298 处与模型不一致（场地边界终止的回合里该字段取值分裂）。该字段**不参与任何反事实计算**，其谓词未公开（§17.4）。
- **Excluded portion**: Platform's `aBlocked` / `bBlocked` fields. They have 106 / 298 inconsistencies with model in fast-vs-optimizer / fast-vs-hybrid respectively (field value splits in rounds terminated by arena boundary). This field **does not participate in any counterfactual computation**, its predicate is not public (§17.4).
- **rev 1 的表述问题**：rev 1 直接宣称「100% 一致」，未把这一排除项放在同一段里对照 §18 的原文要求。rev 2 明确：**§18 的字面要求（harness result 完全等于平台结果）在 `blocked` 字段上未达成；在反事实所依赖的全部字段上已达成。** 是否接受这一范围，属于后续评审的判断，不由本报告自行裁定。
- **rev 1's phrasing issue**: rev 1 directly claimed "100% consistency", did not place this exclusion item alongside §18's original requirements in the same paragraph. rev 2 clarifies: **§18's literal requirement (harness result exactly equals platform result) not achieved for `blocked` field; achieved for all fields counterfactuals depend on.** Whether to accept this scope belongs to subsequent review's judgment, not self-determined by this report.

---

## 19. Rule Health Verdict（§25）

## 19. 规则健康判决（§25）

### 判定：`CANCELLATION-DOMINATED`

### Verdict: `CANCELLATION-DOMINATED`

规范 §57 列出的五类是**待判定的测试结论类别，不是预先假定的结论**，且未给出阈值。本报告的判定标准与数据依据如下。

The five categories listed in specification §57 are **test conclusion categories to be determined, not pre-assumed conclusions**, and do not provide thresholds. This report's judgment criteria and data basis are as follows.

**为什么不是 `HEALTHY`**

**Why not `HEALTHY`**

- 移除一条平衡性规则即可把 50-0-10 反转为 2-38-20。
- Removing one balance rule reverses 50-0-10 to 2-38-20.
- 29.4% 的对局在护栏上限处收场，且这些僵持是**吸收态**（提高上限不化解）。
- 29.4% of matches end at guardrail cap, and these stalemates are **absorbing states** (raising cap does not resolve).

**为什么不是 `SPEED-DOMINATED`**

**Why not `SPEED-DOMINATED`**

这一条需要特别说明。表面看「谁快谁赢」，但 CF-SIMULTANEOUS 证明：**速度本身（先手顺序）对结果没有任何影响**——因为冻结快照使顺序无作用通道。速度之所以决定胜负，**完全是因为它触发了取消规则**。因此准确的归类是取消规则主导，而不是速度本身主导。

This requires special explanation. On the surface "whoever is faster wins", but CF-SIMULTANEOUS proves: **speed itself (first-solver order) has no effect on results**—because frozen snapshots make order have no channel of effect. Speed determines outcomes **entirely because it triggers the cancellation rule**. Therefore the accurate classification is cancellation-rule-dominated, not speed-itself-dominated.

**为什么不是 `STRUCTURALLY COLLAPSED`**

**Why not `STRUCTURALLY COLLAPSED`**

- §58 的塌缩判据是「所有优化方案都必须退化为最快击杀 Shooter 才能竞争」。
- §58's collapse criterion is "all optimization approaches must degrade to fastest Shooter kill to compete".
- Hybrid 证明算法**可以适应这个 meta**：它用战术优先 + 46% 早返回拿到 8 胜，相对 Optimizer（0 胜）是决定性跃升，并把 Fast 的已决胜率从 100% 压到 69%。因此策略空间是**收窄**，不是塌缩。
- Hybrid proves algorithms **can adapt to this meta**: using tactical-first + 46% early return, it achieved 8 wins, a decisive leap over Optimizer (0 wins), and compressed Fast's decided win rate from 100% to 69%. Therefore strategy space is **narrowed**, not collapsed.

**为什么是 `CANCELLATION-DOMINATED`**

**Why `CANCELLATION-DOMINATED`**

- CF-NO-CANCEL 与 CF-SIMULTANEOUS 等价（180/180），证明速度的全部影响都经由取消规则。
- CF-NO-CANCEL and CF-SIMULTANEOUS equivalent (180/180), proving all speed influence goes through cancellation rule.
- 取消一旦移除，两场对阵的胜负彻底反转，而唯一的「同速对抗」几乎不动。
- Once cancellation removed, two matchups' outcomes completely reverse, while the only "same-speed contest" barely moves.
- 回合级归因：取消在 fast-vs-optimizer 中吞掉 787 次击杀（其中 84.8% 的目标最终存活），含 253 次对先手的反杀。
- Round-level attribution: cancellation consumed 787 kills in fast-vs-optimizer (84.8% of targets survived to end), including 253 counter-kills on first-solver.

**叠加的第二条结构性问题（`STRUCTURALLY AT RISK`）**

**Superimposed second structural issue (`STRUCTURALLY AT RISK`)**

规则集**缺少终止条件**，且 29.4% 的对局会进入**永不化解的吸收式循环**。这在第一轮（10/60）已现端倪，本轮在更大样本上确认为结构性缺陷。本轮**无法给出阈值**（§14），因此该项保持 `OPEN FOR PLAYTEST EVIDENCE`。

Ruleset **lacks termination condition**, and 29.4% of matches enter **never-resolving absorbing loops**. This showed signs in Round 1 (10/60), confirmed as structural defect on larger sample this round. This round **cannot provide threshold** (§14), therefore this item remains `OPEN FOR PLAYTEST EVIDENCE`.

---

## 20. Limitations

## 20. 局限性

1. **0 / 1 障碍地图无法通过公开 CLI 触达**（本轮独立复验）。§10 的这两个形状只在**算法侧**离线矩阵中验证，未做平台级比赛。
1. **0 / 1 obstacle maps unreachable via public CLI** (independently verified this round). These two shapes in §10 only verified in **algorithm-side** offline matrix, no platform-level matches.
2. **§18 门禁的 `blocked` 字段未达成字面一致**（§18.1）。
2. **§18 gate's `blocked` field did not achieve literal consistency** (§18.1).
3. **Stalemate 分布右删失**，阈值不可识别（§14）。**这是 rev 2 相对 rev 1 最重要的修正。**
3. **Stalemate distribution right-censored**, threshold not identifiable (§14). **This is rev 2's most important correction relative to rev 1.**
4. **`start skew` 不可观测**（§8.2），§24 因此不完整。
4. **`start skew` not observable** (§8.2), §24 therefore incomplete.
5. **§23 的 `process state` / `sandbox state` 未采集**（事后不可补采，§15.1）。
5. **§23's `process state` / `sandbox state` not collected** (cannot be retroactively collected, §15.1).
6. **CF 语义由本 harness 定义**（规范未定义）；换一种定义可能给出不同的反事实数值。
6. **CF semantics defined by this harness** (specification does not define); different definition might yield different counterfactual values.
7. **CF 模拟沿用官方 map 序列**（逐轮 obstacles + 固定点位），只让存活集合演化。障碍无法离线再生；点位不移动，因此这部分是精确的而非近似。
7. **CF simulation reuses official map sequence** (per-round obstacles + fixed positions), only survival set evolves. Obstacles cannot be regenerated offline; positions don't move, so this part is exact not approximate.
8. **CF 中重跑的求解器在离线环境执行**（无 sandbox 的 1 核 / 512 MB / 线程=1 限制）。已验证三套算法确定性、且在官方世界上逐字节复现平台记录的函数（217/217），但严格意义上离线预算不等于沙箱预算。
8. **CF re-run solvers execute in offline environment** (no sandbox's 1 core / 512 MB / threads=1 limit). Verified all three algorithms deterministic, and byte-for-byte reproduced platform-recorded functions on official worlds (217/217), but strictly speaking offline budget ≠ sandbox budget.
9. **`fast-vs-hybrid` 的算法效应无法干净分离**：只有 40% 条件两腿都已决，其中一半反转（§8.1）。
9. **`fast-vs-hybrid` algorithm effect cannot be cleanly separated**: only 40% conditions have both legs decided, half of which reversed (§8.1).
10. **计时不受控且不可复现**（§2.2）。本轮实验期间宿主存在并发负载（§15.1）。
10. **Timing uncontrolled and not reproducible** (§2.2). Host had concurrent load during this round's experiments (§15.1).
11. **样本规模**：每 pair 60 场 / 30 张独立地图。对 26-8-26 这样接近的比分功效有限。
11. **Sample size**: 60 matches / 30 independent maps per pair. Limited statistical power for close scores like 26-8-26.
12. **只有三套算法**，且 Hybrid 由本轮作者设计；其设计选择（如 `SHOOTER_WEIGHT=1.5`）未做敏感性扫描。
12. **Only three algorithms**, and Hybrid designed by this round's author; its design choices (e.g., `SHOOTER_WEIGHT=1.5`) not sensitivity-scanned.

---

## 21. Recommendations

## 21. 建议

**全部为建议。按 §27 与本轮约束，未实施任何规则修改，也未修改 production。**

**All are recommendations. Per §27 and this round's constraints, no rule modifications implemented, nor production modified.**

| # | 建议 / Recommendation | 依据 / Basis |
|---|---|---|
| R1 | **将 §38 Shot Cancellation 提交人类决策复核。** 候选：改为「取消仅在后手**未产出合法函数**时生效」，即 CF-NO-CANCEL 的规则化 / **Submit §38 Shot Cancellation to human decision review.** Candidate: change to "cancellation only applies when second solver **did not produce legal function**", i.e., rulification of CF-NO-CANCEL | §9 / §11：移除后胜负反转 / §9 / §11: outcomes reverse after removal |
| R2 | **优先修复 competitor-kit 的场地边界终止文档缺口** / **Prioritize fixing competitor-kit's arena boundary termination documentation gap** | §15.3 / §17.2 |
| R3 | **先补「无上限」实验，再谈 Stalemate 阈值。** 本轮**撤回** rev 1 的 20/30 建议 / **First supplement "no cap" experiments, then discuss Stalemate threshold.** This round **withdraws** rev 1's 20/30 recommendations | §14：删失 + 吸收态 ⇒ 阈值不可识别 / §14: censoring + absorbing states ⇒ threshold not identifiable |
| R4 | **公布 `aBlocked` 的判定谓词**，或从统计口径中移除该字段 / **Publish `aBlocked` judgment predicate**, or remove this field from statistical caliber | §17.4 |
| R5 | **修正任务书 §0 的规则文件名引用** / **Correct task specification §0's rule filename reference** | §17.1 |
| R6 | **在产物中暴露双方 GO 交付时刻**，否则 §24 的 start skew 无法被任何 harness 测量 / **Expose both sides' GO delivery moments in artifacts**, otherwise §24's start skew cannot be measured by any harness | §8.2 |
| R7 | **在后续轮次扩大样本**（≥100 条件 × swap）再决定 R1 的最终形态 / **Expand sample in subsequent rounds** (≥100 conditions × swap) before deciding R1's final form | §20.11 |
| R8 | **若采纳 R1，必须补做完整回归**：取消规则的改动会同时影响 Shooter assassination 的价值、僵持率与 fast 的相对地位 / **If adopting R1, must supplement full regression**: cancellation rule changes simultaneously affect Shooter assassination value, stalemate rate, and fast's relative position | §59 Rule Change Procedure |

---

## 22. 最终回答（§29）

## 22. Final answers (§29)

**A. Did Hybrid materially close the gap to Fast?**

**A. Hybrid 是否实质缩小了与 Fast 的差距？**

> **NO（但显著收窄）。**
>
> **NO (but significantly narrowed).**
>
> 官方规则下 Fast 26 / Hybrid 8 / Draw 26。关键在于 **26 个 draw 全部是 30 轮时钟到期**，其中 12 个存活分差 ≥2；按击杀差裁决后为 **Fast 38 / Hybrid 17 / 5 完全平**。即 Fast 仍赢下 **69%** 的已决对局（P ≈ 0.0015），且 Hybrid 在 30 个条件中**从未两腿全胜**（Fast 做到 6 次）。
>
> Under official rules Fast 26 / Hybrid 8 / Draw 26. Key point: **all 26 draws are 30-round clock expiration**, 12 with survival difference ≥2; after adjudicating by kill difference: **Fast 38 / Hybrid 17 / 5 completely tied**. That is, Fast still wins **69%** of decided matches (P ≈ 0.0015), and Hybrid **never swept both legs** across 30 conditions (Fast did 6 times).
>
> 收窄是真实的：Fast 的已决胜率从第一轮的 **100%（50/50）** 降到 **69%**，Hybrid 拿下 8 胜而 Optimizer 是 0 胜；`optimizer-vs-hybrid` 中 Hybrid 39-4 碾压。但「缩小差距」与「关闭差距」是两回事，本轮的证据只支持前者。
>
> Narrowing is real: Fast's decided win rate dropped from Round 1's **100% (50/50)** to **69%**, Hybrid won 8 while Optimizer won 0; in `optimizer-vs-hybrid` Hybrid crushed 39-4. But "narrowing the gap" and "closing the gap" are different things; this round's evidence only supports the former.

**B. Is Shooter Cancellation a major contributor to Fast dominance?**

**B. Shooter Cancellation 是否是 Fast 统治的主要成因？**

> **YES。**
>
> **YES.**
>
> 移除取消后 fast-vs-optimizer 从 **50-0-10** 反转为 **2-38-20**；optimizer-vs-hybrid 从 **39-4-17** 反转为 **3-37-20**。回合级归因：取消在 fast-vs-optimizer 中吞掉 **787 次**击杀，其中 **84.8% 的目标在官方对局结束时仍然存活**（排除了「本来就该死」的替代解释），含 **253 次**对 Fast Shooter 的反杀——占全部回合的 43%。该结论已被一个**独立编写的模拟器**复现（0/60 分歧），且离线重跑的求解器在官方世界上**逐字节复现平台记录的函数**（217/217），排除了环境/计时假象。
>
> After removing cancellation, fast-vs-optimizer reversed from **50-0-10** to **2-38-20**; optimizer-vs-hybrid reversed from **39-4-17** to **3-37-20**. Round-level attribution: cancellation consumed **787 kills** in fast-vs-optimizer, **84.8% of targets survived to official match end** (ruling out "would have died anyway" alternative explanation), including **253** counter-kills on Fast's Shooter—43% of all rounds. This conclusion was reproduced by an **independently written simulator** (0/60 divergence), and offline re-run solvers **byte-for-byte reproduced platform-recorded functions** on official worlds (217/217), ruling out environment/timing artifacts.

**C. Does first-solver speed excessively suppress function quality?**

**C. 先手速度是否过度压制了函数质量？**

> **YES。**
>
> **YES.**
>
> 三层证据：(1) 回合级：787 / 663 / 316 次击杀在三种对阵中因取消而未被执行，且多数目标最终存活；(2) 前向模拟：移除取消后慢算法的胜场从 0 → 38、4 → 37；(3) 算法内证据：Hybrid 的 Stage 3（更深的曲线拟合）在 1170 个世界上只改变了 1 次结果——**即使把时间给它，更高质量的函数也不产生价值**。
>
> Three layers of evidence: (1) Round-level: 787 / 663 / 316 kills not executed due to cancellation across three matchups, majority of targets survived to end; (2) Forward simulation: after removing cancellation, slow algorithm wins went from 0 → 38, 4 → 37; (3) Within-algorithm evidence: Hybrid's Stage 3 (deeper curve fitting) only changed results 1 time across 1170 worlds—**even given the time, higher-quality functions produce no value**.
>
> 措辞保留：CF 测量的是「substantially」（数量级），「excessively」（是否过度）是需要在规则评审中做的价值判断，不由本报告代为裁定。
>
> Wording reservation: CF measures "substantially" (order of magnitude), "excessively" (whether excessive) is a value judgment to be made in rule review, not determined by this report.

**D. Should the official rules change before proceeding toward tournament freeze?**

**D. 是否应在冻结锦标赛规则前修改官方规则？**

> **YES（建议）。**
>
> **YES (recommendation).**
>
> 依据 §19 的 `CANCELLATION-DOMINATED` 判定与 §21 的 R1 / R2 / R3。
>
> Based on §19's `CANCELLATION-DOMINATED` verdict and §21's R1 / R2 / R3.
>
> **本轮未实施任何修改，也未修改 production（§27）。** 仅提交候选供人类决策。
>
> **This round did not implement any modifications, nor modified production (§27).** Only submitted candidates for human decision.

**E. Is there enough evidence to define a Stalemate Rule?**

**E. 现有证据是否足以定义 Stalemate Rule？**

> **NO。**
>
> **NO.**
>
> 僵持**真实存在且是结构性的**（53/53 永不化解，提高到 60 轮仍不化解），因此「需要某种终止条件」这一点成立。但**阈值数值不可识别**：观测分布被 30 轮测试上限右删失，53 个尾部观测全部等于「上限 − 最后击杀轮」，没有观测到任何自然分辨率；分位数与上限 1:1 缩放。**rev 1 的 20 / 30 阈值建议已撤回**，它是从删失分位数上循环论证得出的。
>
> Stalemates **truly exist and are structural** (53/53 never self-resolve, still don't resolve at 60 rounds), therefore "need some termination condition" is established. But **threshold value not identifiable**: observed distribution right-censored by 30-round test cap, all 53 tail observations equal "cap − last kill round", no natural resolution observed; percentiles scale 1:1 with cap. **rev 1's 20 / 30 threshold recommendations withdrawn**, they were circularly derived from censored percentiles.
>
> 需要先做「无上限」实验（见 §14 与 R3）才能在下一轮给出阈值建议。
>
> Need to first conduct "no cap" experiments (see §14 and R3) before providing threshold recommendations in next round.
>
> **本轮未实现正式 Stalemate Rule（§22 明确禁止）。**
>
> **This round did not implement formal Stalemate Rule (§22 explicitly forbids).**

---

## 23. 复现指引

## 23. Reproduction guide

```bash
# 0. 本报告对应的提交即证据锚点
# 0. This report's corresponding commit is the evidence anchor
git log --oneline -3

# 1. 复现 Round 1
# 1. Reproduce Round 1
git archive 6f987bfb | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results

# 2. Hybrid 自检
# 2. Hybrid self-check
npx --no-install ts-node src/operator/validate-submission.ts playtest/competitors/solver-hybrid

# 3. 正式规则实验（180 场，约 32 分钟）
# 3. Official rules experiments (180 matches, ~32 minutes)
bash playtest/harness/run_round2_experiments.sh

# 4. 汇总
# 4. Aggregate
python3 playtest/harness/analyze_round2.py

# 5. 离线鲁棒性矩阵（0/1 障碍形状）
# 5. Offline robustness matrix (0/1 obstacle shapes)
python3 playtest/harness/gb_matrix.py --pkg playtest/competitors/solver-hybrid \
    --seeds 20 --obstacles 0,1,2,4,6 --teams 6,8,10 \
    --out playtest/results/round-2/matrix-hybrid.json

# 6. 反事实（先过 §18 门禁，再统计）
# 6. Counterfactuals (first pass §18 gate, then aggregate)
for p in fast-vs-optimizer optimizer-vs-hybrid fast-vs-hybrid; do
  python3 playtest/harness/gb_counterfactual.py verify \
      --raw playtest/results/round-2/raw/$p \
      --out playtest/results/round-2/cf/verify-$p.json
  python3 playtest/harness/gb_counterfactual.py rounds --pair $p \
      --raw playtest/results/round-2/raw/$p --cache /tmp/fn-$p.json \
      --out playtest/results/round-2/cf/rounds-$p.json
  python3 playtest/harness/gb_counterfactual.py simulate --pair $p \
      --conditions playtest/harness/conditions-round2.json \
      --out playtest/results/round-2/cf/sim-$p --cache /tmp/fn-$p.json
done

# 7. 吸收态检验（提高上限）
# 7. Absorbing state verification (raise cap)
python3 playtest/harness/gb_round2.py run --pair fast-vs-hybrid \
    --conditions /tmp/cond-cap60.json --out /tmp/cap60 --max-rounds 60
```

### 产物索引

### Artifact index

| 路径 / Path | 内容 / Content |
|---|---|
| `playtest/results/round-2/raw/<pair>/` | 180 场逐场原始产物（match / replay / audit / console）/ 180 per-match raw artifacts (match / replay / audit / console) |
| `playtest/results/round-2/metrics-<pair>.json` | 逐场 records + 汇总指标 / per-match records + aggregate metrics |
| `playtest/results/round-2/round-2-summary.json` | 三组汇总 + §21 分位 + CF 汇总 / three-group aggregate + §21 percentiles + CF aggregate |
| `playtest/results/round-2/cf/verify-*.json` | **§18 门禁产物（逐项计数与失配明细）/ §18 gate artifacts (item-by-item counts and mismatch details)** |
| `playtest/results/round-2/cf/rounds-*.json` | 回合级取消归因 / round-level cancellation attribution |
| `playtest/results/round-2/cf/sim-*/` | 两种模式的 360 场模拟 / 360 simulated matches in two modes |
| `playtest/results/round-2/platform-contaminated/` | §23 污染批原始证据与说明 / §23 contamination batch raw evidence and explanation |
| `playtest/results/round-2/cap60-probe/` | **吸收态检验（cap 30 vs 60）/ absorbing state verification (cap 30 vs 60)** |
| `playtest/results/round-2/matrix-*.json` | §10 离线鲁棒性矩阵（3 包 × 600 次）/ §10 offline robustness matrix (3 packages × 600 runs) |
| `playtest/results/round-2/bench-hybrid.json` | Hybrid 的 §9 分阶段基准（1170 次）/ Hybrid's §9 staged benchmark (1170 runs) |

---

## 24. 完成

## 24. Complete

```
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW

第二轮算法平衡性实测完成
准备规则评审
```

---

## 25. rev 1 → rev 2 修订记录

## 25. rev 1 → rev 2 Revision log

rev 1 在提交前经过一轮**对抗式复核**（5 名独立反驳者 + 1 名完整性评论员，各自从原始档案重算）。以下结论被推翻或修正，**保留了推翻的理由**，以免后续读者重复同样的错误：

rev 1 underwent a round of **adversarial review** before submission (5 independent challengers + 1 integrity reviewer, each recalculating from raw archives). The following conclusions were overturned or corrected, **retaining the reasons for overturn**, to prevent subsequent readers from repeating the same mistakes:

| 项 / Item | rev 1 | rev 2 | 推翻依据 / Overturn basis |
|---|---|---|---|
| 平台确定性 / Platform determinism | 「完全确定」/ "completely deterministic" | **仅判定确定；计时不可复现 / Only judgment deterministic; timing not reproducible** | 866 个配对计时 **0 个相同**（±43.9 ms）；585 个状态 hash 全不同（由随机 match_id 解释）/ 866 paired timings **0 identical** (±43.9 ms); 585 state hashes all different (explained by random match_id) |
| Hybrid 缩小差距 / Hybrid narrowed gap | YES，净差 +50→+18 / YES, net difference +50→+18 | **NO（显著收窄）/ NO (significantly narrowed)** | 26 个 draw 全是时钟到期，12 个分差 ≥2；按击杀裁决 **Fast 38 / Hybrid 17** / All 26 draws clock expiration, 12 with difference ≥2; by kill adjudication **Fast 38 / Hybrid 17** |
| 槽位一致性 / Slot consistency | 「6 / 6」（无分母）/ "6 / 6" (no denominator) | **12/30 可分类（6 同判 + 6 反转）/ 12/30 classifiable (6 same + 6 reversed)** | 度量只统计两腿都已决的条件，读起来像覆盖全部 30 个 / Metric only counts conditions where both legs decided, reads as if covering all 30 |
| CF 两模式等价 / CF two-mode equivalence | 「独立代码路径 ⇒ 测量结果」/ "independent code paths ⇒ measurement result" | **构造上等价（源自 §40/§41）/ Equivalent by construction (from §40/§41)** | 两分支都只是并集；顺序是空操作 / Both branches just unions; order is no-op |
| 回合级取消代价 / Round-level cancellation cost | 430 / 389 / 294 kills lost；60 shooter kills | **787 / 663 / 316；253 / 213 / 164** | rev 1 把 CF 传播的存活集当世界，**系统性低估** / rev 1 used CF-propagated survival set as world, **systematic underestimate** |
| Stalemate 阈值 / Stalemate threshold | 建议 20 / 30 / Recommend 20 / 30 | **撤回；证据不足 / Withdrawn; insufficient evidence** | 分布右删失 + 吸收态；cap 30→60 仍全部触顶 / Distribution right-censored + absorbing states; cap 30→60 all still hit cap |
| §18 门禁 / §18 gate | 「100% 一致」/ "100% consistent" | **在反事实消费的全部字段上 100%；`blocked` 字段未达成字面一致 / 100% on all fields consumed by counterfactuals; `blocked` field did not achieve literal consistency** | 106 / 298 处 `blocked` 分歧，需与 §18 原文对照声明 / 106 / 298 `blocked` divergences, need to state alongside §18 original text |
| §24 start skew | 未提及 / Not mentioned | **不可观测 / Not observable** | 平台产物无该字段，已 grep 确认 / Platform artifacts lack this field, grep-confirmed |














