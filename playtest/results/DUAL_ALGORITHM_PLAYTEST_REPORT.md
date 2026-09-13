<!-- bilingual-doc: zh-CN + en-US -->

# Dual Algorithm Playtest Report / 双算法对战测试报告

## 中文版 / Chinese Version

Geometry Battle V1.1 — 首次算法对战测试
两套参赛算法：`solver-fast`（Fast Tactical Solver）与 `solver-optimizer`（Optimization Solver）

- 协议版本：1.1（`competitor-kit/` 公开接口）
- 测试日期：2026-09-10
- 测试 Harness：`playtest/harness/gb_playtest.py`、`gb_check.py`（playtest-only，不修改平台）

> 本报告只依赖 `competitor-kit/` 公开接口与操作台 CLI 的黑盒行为。判定代码、SandboxRunner、Judge、Match 引擎内部实现均未读取。所有「实际命中 / 击杀 / 计时 / 取消」均取自平台自身落盘的 `match.json` / `replay.json` 产物。

---

### 0. 结论摘要

| 问题 | 结论 |
|---|---|
| Fast 是否因速度优势压倒 Optimizer？ | **是，决定性压倒**：50 胜 / 0 负 / 10 平 |
| Optimizer 的 multi-kill / obstacle handling 能否弥补速度劣势？ | **不能**：52% 轮次被先手刺杀取消，实际 kills/valid = 0.27 |
| Team A/B swap 后结果是否明显变化？ | **否**：21/21 个双方都分出胜负的条件，胜负与槽位无关 |
| 是否频繁发生 Shooter assassination？ | **是**：Fast 命中对方 Shooter 率 52%，导致 Optimizer 52% 轮次被取消 |
| 是否频繁出现长期无击杀局面？ | 部分：最长一次连续 28 轮双方零击杀；10/60 场僵持至外部轮数上限 |
| 两种算法是否真正表现出不同策略？ | **是**：Fast ~64 候选 / 12.8ms / 15 节点；Optimizer ~957 候选 / 142ms / 16-49 节点，含三角函数/复合函数族 |

关键 rule 发现：**轨迹在离开场地边界 `y ∈ [-12, 12]` 时也会终止**，但 `competitor-kit/` 只写了「首次障碍物接触」这一种终止条件（详见 §5 Finding 1）。

---

### 1. Fast Solver

目录：`playtest/competitors/solver-fast/`

#### strategy

一个**小而有界、按价值排序的闭式候选池**，不做任何全局搜索：

1. **优先刺杀**：shooter → 对方 Shooter 的直线（先手命中对方 Shooter 会取消对方整轮攻击）；
2. 穿过每个存活敌点的直线；
3. 穿过「对方 Shooter + 另一个点」的二次曲线；
4. **单参数 bend 族** `f = y_s + a·u + b·u^k`（`k ∈ {2,3,4}`，`a,b` 闭式求解使曲线严格经过 shooter + 一个目标）——不同 `k` 提供不同弯曲，是零成本的避障工具；
5. 三次曲线（shooter + 两/三点）；
6. 少量精确正弦（shooter + 一个目标）。

每个候选都**构造性精确**（恒等经过目标），并用**保守**的轨迹扫描打分（Lipschitz 隧道 + 二分；不确定时一律判 blocked）。候选池惰性遍历，命中即早停：

- 命中对方 Shooter **且**再命中一点 → 立即停；
- 三杀 → 立即停；
- 已持有 Shooter 击杀且超过软时限 → 停；
- 否则走到硬上限。

始终保留一条必然合法的 fallback 直线（shooter → 对方 Shooter）。合法弱射优于 TIMEOUT / INVALID。

#### implementation structure

```
solver.py       入口、时间预算、早停策略、原子写、GB_DIAG 诊断
gb_world.py     (public, reveal, team) → 棋盘（shooter/敌点/障碍/场地边界）
gb_dsl.py       DSL 构造 + 结构校验 + 自研 AST 求值器
gb_geom.py      障碍几何 + 保守轨迹扫描 + 场地边界扫描
gb_cand.py      候选闭式 + 打分（含场地边界终止）
gb_screen.py    合法性扫描（cheap + dense，门控发射）
gb_pool.py      排序候选池
```

独立于 `solver-optimizer`（无跨包 import）。

#### Local Validator

```
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
Team A 耗时 ~6.7 ms；Team B ~7 ms；AST 15 节点，凸性变号 0
```

#### Preflight

官方 Preflight（操作台 `--a/--b` 安装流程，两种槽位排布均跑）：

```
Preflight ✓ PASSED  （fast-A 与 opt-A 两种排布均通过）
```

#### benchmark

直接调用 1170 次（585 个真实回合世界 × 双方），全部 `rc=0`：

| 指标 | 值 |
|---|---|
| 非法输出 | **0** |
| 超时 | **0** |
| median / p95 / max 计算时间 | **27.2 / 53.4 / 75.8 ms** |
| 候选数（tried）median / p95 | 64 / 190 |
| 选中 AST 节点 / 深度（median） | 15 / 6 |
| 预测击杀（自评）mean | 0.97 |
| Shooter-target 频率（自评） | 53.6% |

#### known weaknesses

- 保守扫描会把「无法证明通畅」的曲线判为 blocked，可能放过真正能通过的曲线（有意为之：误判 blocked 只损失一次击杀，误判 clear 则整轮 0 击杀）。
- 43% 的轮次 no-hit（很多射击被障碍或场地边界挡下）。
- 候选池有界（无全局搜索），会漏掉需要特定复杂曲线的 multi-kill。

---

### 2. Optimization Solver

目录：`playtest/competitors/solver-optimizer/`

#### strategy

一个**真正的时间预算搜索**，覆盖多个函数族，全部构造性精确：

- **精确多目标插值** `f = y_s + Σ c_k·V^k`（`V=(x−x_s)/L`），用 `fractions.Fraction` 精确有理求解（Newton 差分 → 单项式），再对发射 AST 的运算顺序做 Richardson 细化；度数阶梯最高 K=10；
- **子集选择**：贪心播种（对方 Shooter 优先）+ 局部换点细化 + 由 `match_id+round+team` 确定性播种的随机重启；
- **spare-degree 扫描**：超定子集有一个自由首项系数，扫描这条真正的一参数曲线族来穿缝；
- **三角函数族** `a·sin(b·u)`、`a·sin(b·u)+c·(1−cos(d·u))`、`a·u+c·sin(b·u)`（1/2 点精确拟合，频率网格受控）；
- **复合函数族** `a·u+b·(exp(c·u)−1)`、`a·u+b·(√(1+c·u)−1)`（显式定义域保护）；
- **障碍感知打分**：终止点前的击杀 + shooter 加成 + 间隙奖励 + 节点/陡度惩罚。

#### implementation structure

```
solver.py       入口、config.json 预算、原子写、诊断
config.json     budget_ms=1500 / slack_ms=150
gboptim/
  astlib.py     DSL 构造 + 结构限制
  evaluator.py  独立 AST 求值器（值 + 解析一/二阶导）
  geometry.py   障碍符号距离 + 首次接触（含场地边界终止）
  fit.py        精确有理插值 + 细化
  scoring.py    障碍感知筛选与打分
  search.py     时间预算搜索
  world.py      (public, reveal, team) → 棋盘
```

独立于 `solver-fast`（无跨包 import）。

#### Local Validator

```
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
Team A / B 耗时 ~286 ms / ~308 ms；AST 21-29 节点，凸性变号 ≤2
```

#### Preflight

```
Preflight ✓ PASSED  （fast-A 与 opt-A 两种排布均通过）
```

#### benchmark

直接调用 1170 次，全部 `rc=0`：

| 指标 | 值 |
|---|---|
| 非法输出 | **0** |
| 超时 | **0** |
| median / p95 / max 计算时间 | **189.7 / 332.2 / 554.4 ms**（max 剔除一次系统负载假象，见 §5 Test limitation） |
| 候选数（candidates）median / p95 | 957 / 1144 |
| 选中 AST 节点 / 深度（median） | 16 / 7 |
| 预测击杀（自评）mean | 1.43 |
| Shooter-target 频率（自评） | 55.0% |

#### known weaknesses

- **根本性速度劣势**：median 190ms vs Fast 27ms，永远后手（first-shot rate = 0）。
- **被先手刺杀**：52% 的轮次其 Shooter 被 Fast 先手击杀、整轮攻击被取消，优质函数根本来不及开火。
- 搜索在 ~190-550ms 内**穷尽**其候选池（并未用满 1500ms 预算），搜索广度受候选池而非 timeout 限制。
- 时间预算搜索的结果随运行环境略有抖动（同一世界已确认确定性，但候选池大小限制了覆盖）。

---

### 3. Head-to-Head

- 匹配数：**60 场**（30 个地图条件 × 2 种槽位排布 A/B swap）
- 地图：6v6 / 8v8 / 10v10 × easy / medium / hard，30 个**互不相同**的地图哈希；每条件两场用**相同 seed**（swap 看到同一张图）
- 外部轮数上限：`--max-rounds 30`（仅测试 Harness 护栏，非比赛规则）

#### wins

| | fast | optimizer | draw |
|---|---|---|---|
| 总计 | **50** | **0** | 10 |
| fast-A 排布（fast=Team A） | 26 | 0 | 4 |
| opt-A 排布（fast=Team B） | 24 | 0 | 6 |

**swap 一致性**：30 个条件中，21 个双方都分出胜负，其中 **21/21 都是 fast 胜**（无论 fast 在 A 还是 B 槽）。结果与槽位无关。

#### match length

- median **6 轮**，p95 **30 轮**，max 30（外部上限）；10/60 场僵持至上限判 `draw`。

#### 每算法汇总（585 轮）

| 指标 | fast | optimizer |
|---|---|---|
| 有效射击（valid shots） | 585 | 281 |
| 非法输出 | 0 | 0 |
| 超时 | 0 | 0 |
| 被取消轮次 | 0 | **304 (52%)** |
| blocked（轨迹被挡） | 147 | 244 |
| 击杀 | 464 | 76 |
| Shooter 击杀 | 304 | 28 |
| multi-kill（≥2 击杀的轮次） | 128 | 34 |
| kills per valid shot | **0.793** | **0.270** |
| first-shot rate | **1.000** | **0.000** |
| Shooter-kill rate | 0.520 | 0.048 |
| multi-kill rate | 0.219 | 0.058 |
| no-hit rate | 0.429 | 0.933 |

#### timing

| | fast | optimizer |
|---|---|---|
| median / p95 / max 计算时间 | 12.8 / 37.6 / 61.2 ms | 142.1 / 236.1 / 314.7 ms |

#### no-progress behavior

- 最长连续零击杀 streak：**28 轮**（出现在一个 10v10 medium 地图的某场）。
- 10 场 `draw`（僵持至 30 轮上限）全部对应「双方互相无法推进」的局面，平台报告 `UNDECIDED`，符合 V1.1 无 Stalemate Rule 的现状。

---

### 4. 重点问题回答

1. **Fast 是否因速度优势明显压倒 Optimizer？** 是。50-0-10，且 swap 后仍 21/21 一边倒。速度差（27ms vs 190ms）使 Fast **每轮**先手，第一发就是刺杀线。
2. **Optimizer 的 multi-kill / obstacle handling 能否弥补速度劣势？** 不能。隔离运行时 Optimizer 确实产出更优函数（自评 1.43 击杀/轮 vs Fast 0.97），但 52% 轮次被先手刺杀取消，实际 kills/valid 仅 0.27，远低于 Fast 的 0.793。
3. **Team A/B swap 后结果是否明显变化？** 否。21/21 一致，无槽位偏置。
4. **是否频繁发生 Shooter assassination？** 是。Fast 命中对方 Shooter 率 52%，直接造成 Optimizer 52% 轮次被取消。
5. **是否频繁出现长期无击杀局面？** 局部出现。最长 28 轮零击杀、10/60 场僵持，集中在障碍稠密（hard/medium）且双方 Shooter 互相被挡的地图。
6. **两种算法是否真正表现出不同策略？** 是。候选规模（64 vs 957）、AST 形态（直线/二次/三次 vs 多项式/三角/复合）、时间预算（~13ms 早停 vs ~190ms 搜索）均显著不同，且无跨包 import。

---

### 5. Findings

#### Algorithm finding

1. **先手刺杀是决定性的**。Fast 的「先手 + 刺杀对方 Shooter」组合使 Optimizer 52% 轮次被取消，Optimizer 的优质函数从未开火。这是速度优势的乘数效应，不是 Optimizer 的函数质量不够。
2. **Optimizer 的 obstacle handling 在真实对局中无效**。它自评能穿缝、multi-kill，但 `kills/valid = 0.27`（vs Fast 0.793）说明：即使开火，它选择的曲线命中率也低于 Fast 的直线刺杀。
3. **Optimizer 搜索未用满预算**。候选池在 ~190-550ms 内穷尽（预算 1500ms），搜索广度受限。若要让「优化」路线真正发挥，需要更大的候选池 / 更多随机重启 / 更多函数族。

#### Platform finding

4. **平台在比赛开始前把算法目录加进 `sys.path`**（`competitor-kit/README.md` §1 已声明）——Fast 依赖此行为 `import gb_cand` 等，Optimizer 则自行 `sys.path.insert`。两者均通过沙箱验证，行为一致。（非问题，仅记录确认。）

#### Rule-design finding

5. **【重要】轨迹终止条件在公开文档中不完整**。`competitor-kit/ALGORITHM_REQUIREMENTS.md` §6 与 `DSL_SPECIFICATION.md` §7 只写了「首次障碍物接触」终止；但实测（866 轮交叉验证 100% 一致）平台还会在**函数图像离开场地边界 `y ∈ [-12, 12]` 时立即终止轨迹**。这导致：曲线在到达目标点之前一旦冲出 `y > 12` 或 `y < -12`，目标点即不可达、整轮 0 击杀。直线穿过场内两点永远在场内（凸性），故 starter/直线不受影响；但二次/三次/三角函数很容易在两点之间「鼓出」场地。这是本轮发现的最重要的**规则文档缺口**，建议在 competitor-kit 补充说明。
6. **无 Stalemate Rule 的现状被反复触发**。10/60 场僵持至外部上限，平台报告 `UNDECIDED`；最长 28 轮零击杀。建议（作为规则设计建议，不在本任务内实现）：引入 `MAX_NO_PROGRESS_ROUNDS` 之类的终止条件。

#### Test limitation

7. **0 障碍 / 1 障碍地图无法通过公开 CLI 触达**。`--difficulty easy` 产出 2 障碍、`medium` 4、`hard` 6；无法构造 0/1 障碍条件。任务书 §6 要求覆盖「0 obstacles / 1 obstacle」，此二项标为 **unavailable**（不读取 MapGenerator 私有实现补齐）。
8. **Benchmark 的 wall-clock 会混入系统负载**。1170 次直接调用中 1 次记录到 14.7s（内部诊断仅 462ms，复测 5 次均 250ms），为测试机 CPU 争用的假象，已从 max 中剔除。
9. **优化器每轮的 stderr 诊断（candidate count / predicted kills）不会出现在比赛控制台**（沙箱 stderr 不被转发到 CLI 输出），因此这些指标通过直接重放（benchmark）采集，而非从 match 产物读取。

---

### 6. 平台 / 规则完整性

未修改任何平台项：`timeout`、`TIE_EPS_MS`、DSL 规则、AST 限制、凸性限制、Shooter 规则、Judge、命中逻辑、障碍逻辑、START gate、Sandbox 均未改动。`algorithms/team-a`、`algorithms/team-b` 未被触碰。测试槽位安装在 `playtest/slots/`（playtest-only）。

---

### 7. 完成结论

```
DUAL ALGORITHM PLAYTEST DEVELOPMENT COMPLETE
READY FOR PLAYTEST REVIEW
```

（说明：fast 在本轮对局中获胜，不代表它是「最优算法」——它只是在这套「先手刺杀」主导的规则与这 30 张地图上占优。Optimizer 隔离运行时的函数质量确实更高，但被先手机制压制。）

---
---

## English Version / 英文版

Geometry Battle V1.1 — First Algorithm Head-to-Head Playtest
Two competing algorithms: `solver-fast` (Fast Tactical Solver) and `solver-optimizer` (Optimization Solver)

- Protocol version: 1.1 (`competitor-kit/` public interface)
- Test date: 2026-09-10
- Test Harness: `playtest/harness/gb_playtest.py`, `gb_check.py` (playtest-only, no platform modifications)

> This report relies exclusively on the `competitor-kit/` public interface and black-box CLI behavior. Judging code, SandboxRunner, Judge, and Match engine internals were not read. All "actual hits / kills / timing / cancellations" are taken from the platform's own `match.json` / `replay.json` artifacts.

---

### 0. Executive Summary

| Question | Conclusion |
|---|---|
| Does Fast overwhelm Optimizer due to speed advantage? | **Yes, decisively**: 50 wins / 0 losses / 10 draws |
| Can Optimizer's multi-kill / obstacle handling compensate for speed deficit? | **No**: 52% of rounds cancelled by first-strike assassination, actual kills/valid = 0.27 |
| Do results change significantly after Team A/B swap? | **No**: 21/21 decided conditions, outcome independent of slot |
| Does Shooter assassination occur frequently? | **Yes**: Fast hits opponent Shooter at 52% rate, causing Optimizer's 52% round cancellation |
| Do long no-kill stalemates occur frequently? | Partially: longest streak 28 consecutive zero-kill rounds; 10/60 matches deadlocked to external round limit |
| Do the two algorithms truly exhibit different strategies? | **Yes**: Fast ~64 candidates / 12.8ms / 15 nodes; Optimizer ~957 candidates / 142ms / 16-49 nodes, including trigonometric/composite function families |

Key rule discovery: **Trajectories also terminate when leaving field boundaries `y ∈ [-12, 12]`**, but `competitor-kit/` only documents "first obstacle contact" as a termination condition (see §5 Finding 1).

---

### 1. Fast Solver

Directory: `playtest/competitors/solver-fast/`

#### strategy

A **small, bounded, value-sorted closed-form candidate pool** with no global search:

1. **Priority assassination**: shooter → opponent Shooter line (first-strike hit on opponent Shooter cancels their entire round);
2. Lines through each surviving enemy point;
3. Quadratic curves through "opponent Shooter + another point";
4. **Single-parameter bend family** `f = y_s + a·u + b·u^k` (`k ∈ {2,3,4}`, `a,b` closed-form solved to pass exactly through shooter + one target) — different `k` provides different curvature, zero-cost obstacle avoidance tool;
5. Cubic curves (shooter + two/three points);
6. Small set of exact sinusoids (shooter + one target).

Every candidate is **constructively exact** (identically passes through targets) and scored with **conservative** trajectory scanning (Lipschitz tunnel + bisection; when uncertain, always judge blocked). Candidate pool is lazily traversed with early stopping on hit:

- Hit opponent Shooter **and** hit another point → stop immediately;
- Triple kill → stop immediately;
- Already holding Shooter kill and exceeded soft time limit → stop;
- Otherwise proceed to hard cap.

Always retain one guaranteed-legal fallback line (shooter → opponent Shooter). Legal weak shot beats TIMEOUT / INVALID.

#### implementation structure

```
solver.py       Entry, time budget, early-stop policy, atomic write, GB_DIAG diagnostics
gb_world.py     (public, reveal, team) → board (shooter/enemy points/obstacles/field boundaries)
gb_dsl.py       DSL construction + structure validation + custom AST evaluator
gb_geom.py      Obstacle geometry + conservative trajectory scanning + field boundary scanning
gb_cand.py      Candidate closed-forms + scoring (including field boundary termination)
gb_screen.py    Legality scanning (cheap + dense, launch gating)
gb_pool.py      Sorted candidate pool
```

Independent of `solver-optimizer` (no cross-package import).

#### Local Validator

```
PRE-FLIGHT PASS — 2 teams × 9 segments all pass
Team A time ~6.7 ms; Team B ~7 ms; AST 15 nodes, convexity sign changes 0
```

#### Preflight

Official Preflight (console `--a/--b` installation flow, both slot arrangements tested):

```
Preflight ✓ PASSED  (both fast-A and opt-A arrangements pass)
```

#### benchmark

Direct invocation 1170 times (585 real round worlds × both sides), all `rc=0`:

| Metric | Value |
|---|---|
| Invalid outputs | **0** |
| Timeouts | **0** |
| median / p95 / max compute time | **27.2 / 53.4 / 75.8 ms** |
| Candidates (tried) median / p95 | 64 / 190 |
| Selected AST nodes / depth (median) | 15 / 6 |
| Predicted kills (self-assessed) mean | 0.97 |
| Shooter-target frequency (self-assessed) | 53.6% |

#### known weaknesses

- Conservative scanning judges "cannot prove clear" curves as blocked, may miss genuinely passable curves (intentional: misjudging blocked only costs one kill, misjudging clear means entire round 0 kills).
- 43% of rounds no-hit (many shots blocked by obstacles or field boundaries).
- Bounded candidate pool (no global search), will miss multi-kills requiring specific complex curves.

---

### 2. Optimization Solver

Directory: `playtest/competitors/solver-optimizer/`

#### strategy

A **true time-budgeted search** covering multiple function families, all constructively exact:

- **Exact multi-target interpolation** `f = y_s + Σ c_k·V^k` (`V=(x−x_s)/L`), using `fractions.Fraction` for exact rational solving (Newton divided differences → monomial), then Richardson refinement on launch AST operation order; degree ladder up to K=10;
- **Subset selection**: greedy seeding (opponent Shooter priority) + local point-swap refinement + deterministic seeded (by `match_id+round+team`) random restart;
- **Spare-degree scanning**: overdetermined subsets have one free leading coefficient, scan this true 1-parameter curve family to thread gaps;
- **Trigonometric families** `a·sin(b·u)`, `a·sin(b·u)+c·(1−cos(d·u))`, `a·u+c·sin(b·u)` (1/2 point exact fitting, controlled frequency grid);
- **Composite function families** `a·u+b·(exp(c·u)−1)`, `a·u+b·(√(1+c·u)−1)` (explicit domain protection);
- **Obstacle-aware scoring**: kills before termination point + shooter bonus + gap reward + node/steepness penalty.

#### implementation structure

```
solver.py       Entry, config.json budget, atomic write, diagnostics
config.json     budget_ms=1500 / slack_ms=150
gboptim/
  astlib.py     DSL construction + structural constraints
  evaluator.py  Independent AST evaluator (value + parse 1st/2nd derivatives)
  geometry.py   Obstacle signed distance + first contact (including field boundary termination)
  fit.py        Exact rational interpolation + refinement
  scoring.py    Obstacle-aware filtering and scoring
  search.py     Time-budgeted search
  world.py      (public, reveal, team) → board
```

Independent of `solver-fast` (no cross-package import).

#### Local Validator

```
PRE-FLIGHT PASS — 2 teams × 9 segments all pass
Team A / B time ~286 ms / ~308 ms; AST 21-29 nodes, convexity sign changes ≤2
```

#### Preflight

```
Preflight ✓ PASSED  (both fast-A and opt-A arrangements pass)
```

#### benchmark

Direct invocation 1170 times, all `rc=0`:

| Metric | Value |
|---|---|
| Invalid outputs | **0** |
| Timeouts | **0** |
| median / p95 / max compute time | **189.7 / 332.2 / 554.4 ms** (max excludes one system load artifact, see §5 Test limitation) |
| Candidates median / p95 | 957 / 1144 |
| Selected AST nodes / depth (median) | 16 / 7 |
| Predicted kills (self-assessed) mean | 1.43 |
| Shooter-target frequency (self-assessed) | 55.0% |

#### known weaknesses

- **Fundamental speed disadvantage**: median 190ms vs Fast 27ms, always second strike (first-shot rate = 0).
- **First-strike assassinated**: 52% of rounds its Shooter is killed by Fast's first strike, entire round cancelled, premium functions never fire.
- Search **exhausts** its candidate pool within ~190-550ms (not using full 1500ms budget), search breadth limited by candidate pool not timeout.
- Time-budgeted search results vary slightly with runtime environment (same world confirmed deterministic, but candidate pool size limits coverage).

---

### 3. Head-to-Head

- Match count: **60 matches** (30 map conditions × 2 slot arrangements A/B swap)
- Maps: 6v6 / 8v8 / 10v10 × easy / medium / hard, 30 **mutually distinct** map hashes; each condition's two matches use **same seed** (swap sees same map)
- External round cap: `--max-rounds 30` (test harness guardrail only, not competition rule)

#### wins

| | fast | optimizer | draw |
|---|---|---|---|
| Total | **50** | **0** | 10 |
| fast-A arrangement (fast=Team A) | 26 | 0 | 4 |
| opt-A arrangement (fast=Team B) | 24 | 0 | 6 |

**Swap consistency**: Of 30 conditions, 21 had both sides reach decision, **21/21 all fast wins** (regardless of fast in A or B slot). Outcome independent of slot.

#### match length

- median **6 rounds**, p95 **30 rounds**, max 30 (external cap); 10/60 matches deadlocked to cap judged `draw`.

#### Per-algorithm summary (585 rounds)

| Metric | fast | optimizer |
|---|---|---|
| Valid shots | 585 | 281 |
| Invalid outputs | 0 | 0 |
| Timeouts | 0 | 0 |
| Cancelled rounds | 0 | **304 (52%)** |
| Blocked (trajectory blocked) | 147 | 244 |
| Kills | 464 | 76 |
| Shooter kills | 304 | 28 |
| Multi-kill (≥2 kills per round) | 128 | 34 |
| kills per valid shot | **0.793** | **0.270** |
| first-shot rate | **1.000** | **0.000** |
| Shooter-kill rate | 0.520 | 0.048 |
| multi-kill rate | 0.219 | 0.058 |
| no-hit rate | 0.429 | 0.933 |

#### timing

| | fast | optimizer |
|---|---|---|
| median / p95 / max compute time | 12.8 / 37.6 / 61.2 ms | 142.1 / 236.1 / 314.7 ms |

#### no-progress behavior

- Longest consecutive zero-kill streak: **28 rounds** (occurred in one 10v10 medium map match).
- 10 `draw` matches (deadlocked to 30-round cap) all correspond to "mutual no-progress" situations, platform reports `UNDECIDED`, consistent with V1.1's absence of Stalemate Rule.

---

### 4. Key Question Answers

1. **Does Fast significantly overwhelm Optimizer due to speed advantage?** Yes. 50-0-10, and after swap still 21/21 one-sided. Speed difference (27ms vs 190ms) makes Fast **first strike every round**, first shot is assassination line.
2. **Can Optimizer's multi-kill / obstacle handling compensate for speed deficit?** No. In isolation Optimizer does produce superior functions (self-assessed 1.43 kills/round vs Fast 0.97), but 52% rounds cancelled by first-strike assassination, actual kills/valid only 0.27, far below Fast's 0.793.
3. **Do results change significantly after Team A/B swap?** No. 21/21 consistent, no slot bias.
4. **Does Shooter assassination occur frequently?** Yes. Fast hits opponent Shooter at 52% rate, directly causing Optimizer's 52% round cancellation.
5. **Do long no-kill stalemates occur frequently?** Occurs locally. Longest 28-round zero-kill, 10/60 matches deadlocked, concentrated in obstacle-dense (hard/medium) maps where both Shooters mutually blocked.
6. **Do the two algorithms truly exhibit different strategies?** Yes. Candidate scale (64 vs 957), AST form (lines/quadratics/cubics vs polynomials/trigonometric/composite), time budget (~13ms early-stop vs ~190ms search) all significantly different, and no cross-package import.

---

### 5. Findings

#### Algorithm finding

1. **First-strike assassination is decisive**. Fast's "first strike + assassinate opponent Shooter" combination causes Optimizer's 52% round cancellation, Optimizer's premium functions never fire. This is speed advantage's multiplier effect, not Optimizer's function quality being insufficient.
2. **Optimizer's obstacle handling ineffective in real matches**. It self-assesses gap-threading, multi-kill capability, but `kills/valid = 0.27` (vs Fast 0.793) shows: even when firing, its chosen curves hit less than Fast's assassination lines.
3. **Optimizer search does not use full budget**. Candidate pool exhausted within ~190-550ms (budget 1500ms), search breadth limited. For "optimization" route to truly perform, needs larger candidate pool / more random restarts / more function families.

#### Platform finding

4. **Platform adds algorithm directory to `sys.path` before match start** (`competitor-kit/README.md` §1 already declared) — Fast relies on this behavior for `import gb_cand` etc., Optimizer does its own `sys.path.insert`. Both pass sandbox validation, behavior consistent. (Not an issue, only recording confirmation.)

#### Rule-design finding

5. **【IMPORTANT】Trajectory termination conditions incomplete in public documentation**. `competitor-kit/ALGORITHM_REQUIREMENTS.md` §6 and `DSL_SPECIFICATION.md` §7 only document "first obstacle contact" termination; but actual testing (866 rounds cross-validation 100% consistent) shows platform also **immediately terminates trajectory when function graph leaves field boundary `y ∈ [-12, 12]`**. This means: if curve exceeds `y > 12` or `y < -12` before reaching target point, target becomes unreachable, entire round 0 kills. Lines through two in-field points always stay in-field (convexity), so starter/lines unaffected; but quadratic/cubic/trigonometric functions easily "bulge out" of field between two points. This is this round's most important **rule documentation gap**, recommend supplementing explanation in competitor-kit.
6. **Absence of Stalemate Rule repeatedly triggered**. 10/60 matches deadlocked to external cap, platform reports `UNDECIDED`; longest 28-round zero-kill. Recommend (as rule design suggestion, not implemented in this task): introduce `MAX_NO_PROGRESS_ROUNDS` type termination condition.

#### Test limitation

7. **0 obstacle / 1 obstacle maps unreachable through public CLI**. `--difficulty easy` produces 2 obstacles, `medium` 4, `hard` 6; cannot construct 0/1 obstacle conditions. Task specification §6 requires coverage of "0 obstacles / 1 obstacle", these two items marked **unavailable** (not reading MapGenerator private implementation to fill gap).
8. **Benchmark wall-clock can include system load**. In 1170 direct invocations, 1 recorded 14.7s (internal diagnostics only 462ms, 5 retests all 250ms), artifact of test machine CPU contention, already excluded from max.
9. **Optimizer's per-round stderr diagnostics (candidate count / predicted kills) do not appear in match console** (sandbox stderr not forwarded to CLI output), so these metrics collected through direct replay (benchmark), not read from match artifacts.

---

### 6. Platform / Rule Integrity

No platform items modified: `timeout`, `TIE_EPS_MS`, DSL rules, AST constraints, convexity constraints, Shooter rules, Judge, hit logic, obstacle logic, START gate, Sandbox all untouched. `algorithms/team-a`, `algorithms/team-b` not touched. Test slots installed in `playtest/slots/` (playtest-only).

---

### 7. Completion Conclusion

```
DUAL ALGORITHM PLAYTEST DEVELOPMENT COMPLETE
READY FOR PLAYTEST REVIEW
```

(Note: fast winning in this round does not mean it is the "optimal algorithm" — it merely dominates under this "first-strike assassination" rule set and these 30 maps. Optimizer's function quality in isolation is indeed higher, but suppressed by first-strike mechanism.)