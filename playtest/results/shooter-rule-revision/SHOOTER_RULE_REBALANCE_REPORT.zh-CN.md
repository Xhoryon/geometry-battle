<div align="right">

<a href="./SHOOTER_RULE_REBALANCE_REPORT.md">English</a> | **简体中文**

</div>


# 射手规则修订与重平衡 — 报告

**几何斗殴 V1.1 · 三算法对抗 · 规则修订后的重跑**

---

## 文档元数据

- 协议版本：1.1（`competitor-kit/` 公开接口）
- 测试日期：2026-09-10
- 本轮性质：**Playtest / 平衡性研究 + 一次经人类授权的规则修订**，不是平台自由开发任务
- 规则版本：**V1.1 Playtest Rules — Revision 2**（按任务书 §28，不称 V1.2）

---

## Git 基线

**本轮全部证据的可寻址锚点**

| 项 | 值 |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| **RULE_BASELINE_SHA**（修订前的规则与生产实现） | `877f142` |
| 结果产出时 HEAD | `95f2a5f` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904`（本轮**未改变**） |

本轮提交：

```text
90647f3  docs(rules): amend shooter elimination semantics
2e825a1  feat(v1.1): preserve locked attack after shooter elimination
95f2a5f  refactor(v1.1): drop stale cancellation comments and runner-cancel wording
```

**结果产出时的工作区说明**：180 场在 `2e825a1` 之后运行；`95f2a5f` 只改注释与一条错误文案，**无行为变更**，其后的 harness/结果提交再补齐。若需严格复现，请用 `95f2a5f` 起的树。

Canonical rule path（本轮唯一权威规则输入，本轮**被修订**）：

```text
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

---

## 1. 旧规则

```text
先手方一旦击杀对方的 Shooter
→ 对方本轮攻击被取消
```

即：先手方一旦击杀对方的 Shooter，对方本轮**已经算出或正在计算**的攻击不再执行，其沙箱进程被立即终止。回合结果码为 `CANCELLED_A` / `CANCELLED_B`。

Round-2 报告（`playtest/results/round-2/`）的判读是：

> **在本规则集下，速度影响胜负的唯一通道就是 Shot Cancellation。**

---

## 2. 新规则

```text
START 之后，双方获得本轮独立且不可撤销的攻击权。
```

- Shooter 是本轮攻击函数的**数学发射锚点**，不是「必须活到开火瞬间的枪手」。即使 Shooter 在开火前被击杀，函数仍必须满足 `f(x_shooter) = y_shooter`，用的还是 START 快照里的 Shooter 坐标。
- **不换人、不重算**：不随机改选存活点，不重跑算法，输入快照冻结。
- **进程不受影响**：Shooter 死亡不再是 Runner termination signal，后手算法仍拥有完整的官方计算 deadline。
- 攻击不执行的**唯一**原因是 `TIMEOUT` / `INVALID` / `CRASH`。
- 新增终局：一轮结束后双方同时归零 → **MATCH DRAW**，`endReason = MUTUAL_ELIMINATION`，**不得**因为谁是 First Solver 就判谁赢。

规则文本见 `Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md` §38.x / §39。

---

## 3. 修订原因

不是平衡性推导的产物，是**人类决定**（任务书 §2：`Rule amended by human decision`）。

被修订规则在 Round-2 实测中造成的后果：

| 观测 | 值 |
|---|---|
| Fast vs Optimizer 官方战绩 | **Fast 50 / Optimizer 0 / Draw 10** |
| Optimizer 全场实际击杀 | 76 |
| 旧规则吞掉的击杀（fast-vs-optimizer） | **787**，其中 **84.8%** 的目标在对局结束时仍存活 |
| 其中对 Fast Shooter 的反杀 | 253 次（占全部回合 43%） |
| Optimizer 的有效输出被抹掉 | 其曲线本可产生击杀的 **约 91%** |
| Optimizer 的回合「无命中率」 | **0.9148** |

即：取消规则把慢速方的函数质量几乎完全清零，速度成为唯一胜负通道。

---

## 4. 实现改动范围

生产改动面**只有取消语义本身**；DSL 白名单、命中判定、障碍物碰撞、先手规则、计时终点与超时预算、沙箱策略一律未动。

| 文件 | 改动 |
|---|---|
| `src/core/Match.ts` | `resolveOrderedShots` **删除**「Shooter 已死 → 跳过该方射击」守卫与 `cancelled` / `onCancelled` 出参；新增 `shooterAliveAtAttack`。`computeRound` 删除 `onFirstResult` 取消钩子；新增 `mutualElimination`，`MatchLog.endReason`，`MatchEngine.endReason()` |
| `src/runner/SandboxRunner.ts` | 删除 `DuelOptions.onFirstResult` 及其 `runner.cancel()` 分支（§10）。取消路径的错误文案改为「运行器被宿主取消（进程终止）」（不改错误码） |
| `src/core/Logs.ts` | `RoundLog` / `ReplayFrame` 新增 `attacksExecuted` / `shooterAliveAtAttack` / `shooterA|BAliveAfterRound` / `mutualElimination` / `endReason`；`CANCELLED_A/B` 与 `cancelled*` 标注为**历史/兼容** |
| `src/ui/AudienceScreenUI.ts`、`src/operator/cli.ts` | 回放与结算屏不再打印「取消」，改为展示实际开火顺序与「开火时 Shooter 已阵亡（攻击权已锁定，不取消）」 |
| `Plans/Input/…Playtest Specification.md` | §38 改写为 Locked Attack Right（38.1–38.6）；§39 降级 CANCELLED 并保留历史证据 |
| `competitor-kit/ALGORITHM_REQUIREMENTS.md`、`README.md` | 公开说明同步 |
| `tests/` | 旧 `shooter-cancel` 套件按 §18 重分类为 `locked-attack-right`（R1–R8） |

**设计选择说明**：取消语义是**结构性删除**而不是留一个恒为 false 的开关 —— 守卫与出参都不再存在，旧规则无法被静默重新引入（任务书 §30 要求重审方核查「旧 cancellation 路径是否残留」，这是对该核查的正面回应）。

**未改动**：`RoundMachine` 的 19 个阶段与转换表**一个都没动**（`CHECK_SHOOTER` 阶段名保留，现在只表示「检查 Shooter 存活」这一步的推进，不再带任何取消语义 —— 它是阶段序列的一部分，改名会牵动冻结的状态机词汇表）。`TIE_EPS_MS`、先手判定、超时预算、沙箱 SBPL、DSL 白名单、命中与障碍物判定全部逐字节未动，可用 `git diff 877f142..HEAD -- src/core/Rules.ts src/core/Judge.ts src/core/Round.ts src/runner/SandboxRunner.ts` 核对（后者的 diff 只有删除取消钩子与一条错误文案）。

---

## 5. 回归证据

| 项 | 结果 |
|---|---|
| `npm run typecheck` | **0 错误** |
| `npx ts-node tests/locked-attack-right.ts` | **10/10 passed**（R1–R8 + 2 条既有覆盖） |
| 全量回归 | **25/26** —— 唯一失败 `algorithm-slot`，**非本轮引入**，见 §15 |
| `shotCancellationRate`（180 场实测） | **0.0**（设计如此，§23 要求的证据） |
| `INVALID / TIMEOUT / CRASH` | **0 / 0 / 0**（合计 4496 个「队伍×回合」样本） |
| 重跑一致性 | 三对配对的离线模型预测与官方结果**逐场完全相同**（§9） |

最终全量回归（`npx ts-node tests/run-all.ts`，在提交 `95f2a5f` + 本轮 harness/结果之上）：

```text
  ✓ dsl-contract            ✓ preflight-decoy          ✓ process-tree-cleanup
  ✓ convexity-aliasing      ✓ result-ipc               ✓ hostile-input
  ✓ official-starter        ✓ algorithm-slot  ✗        ✓ timing-fairness
  ✓ map-fairness            ✓ full-match-e2e           ✓ replay
  ✓ obstacle-block          ✓ runner-isolation         ✓ runtime-manifest
  ✓ dual-shooter-selection  ✓ cross-round-cheat        ✓ competitor-kit
  ✓ locked-attack-right     ✓ package-tamper
  ✓ alive-kill              ✓ timeout-boundary
  ✓ roundstate-equality
  ✓ input-protocol
  ✓ stage-gating
  ✓ pre-start-execution

25/26 套件通过
失败套件: algorithm-slot
```

`algorithm-slot` 的失败**不是本轮引入**（§15 P-1 有 stash 隔离与 bisect 证据）。

---

### 5.1 R1–R8（任务书 §17）





| 编号 | 场景 | 结果 |
|---|---|---|
| R1 | 先手击杀对方 Shooter，后手已有合法解 → 后手仍然开火 | ✓ 结构性断言：`shooterAliveAtAttack.B === false` 且 `shots.B !== null` |
| R2 | 先手击杀对方 Shooter，后手稍后才返回合法解 → 仍开火（端到端，sniper vs slow-sniper） | ✓ `attacksExecuted === ['A','B']`，`hits.B.length > 0` |
| R3 | 先手击杀对方 Shooter，后手超时 → 不攻击，原因是 `TIMEOUT` | ✓ `result === 'TIMEOUT_B'`、`cancelled.B === false`、`result !== 'CANCELLED_B'` |
| R4 | 先手击杀对方 Shooter，后手输出非法 → 不攻击 | ✓ `result === 'INVALID_B'`、`cancelled.B === false` |
| R5 | 双方 Shooter 互杀 → 两次攻击都结算 | ✓ 结构性与端到端各一条 |
| R6 | 同一轮双方同时归零 → `MUTUAL_ELIMINATION` / `DRAW` | ✓ 六轮脚本化对局，`winner === 'draw'`、`endReason() === 'MUTUAL_ELIMINATION'`、落盘日志一致 |
| R7 | 阵亡 Shooter 下一轮不可再选 | ✓ |
| R8 | 同轮不做 Shooter Replacement | ✓ Shooter id 不变、无第二次计算、输入哈希不变 |

**回归有效性反证**：把旧守卫（`if (!shooter.alive) continue;`）临时加回 `resolveOrderedShots` 后，套件立刻从 10/10 掉到 6/10，R1 / R2 / R5 / R6 全部变红，随后恢复并确认无残留。即这批回归**确实抓得到**旧取消规则的复活。

---

### 5.2 §18 旧测试重分类





| 断言 | 分类 | 处理 |
|---|---|---|
| 「先手击杀对方 Shooter → 对方攻击被取消」等 6 条 | **obsolete due to authorized rule change** | 套件整体重写为 `locked-attack-right` |
| 「已死亡的 Shooter 无法继续攻击」（原为同轮语义） | **obsolete** | 改写为新语义：阵亡 Shooter 下一轮不可再选（R7） |
| 「先手击杀后，后手的射击守卫可达（P2-B）」 | **obsolete** | 守卫已删除，改为断言反面（R1） |
| 「并列先手时双方基于同一快照同时开火」 | **still valid** | 原样保留 |
| 「反向攻击不会命中自己后方的敌人」 | **still valid** | 原样保留 |
| `tests/replay.ts:119-122`「最后一帧胜方有存活点、败方全灭」 | **obsolete**（隐含「只会单方全灭」） | 改写：平局只可能来自同归于尽，非平局时仍是胜方存活 + 败方全灭 |

**未改动**：计时公平性、DSL、命中、障碍物、边界、START、沙箱的任何断言。

---

## 6. Fast ↔ Optimizer（正式赛后重跑 60 场）



| | Round-2（旧规则） | Revision 2 |
|---|---|---|
| 战绩 | Fast **50** · Optimizer **0** · Draw 10 | Fast **2** · Optimizer **38** · Draw 20 |
| Fast 先手率 | 0.854（跨配对合并） | **1.000** |
| Optimizer 先手率 | 0.000 | **0.000** |
| Fast 每有效射击击杀 | 0.5775 | 0.541 |
| Optimizer 每有效射击击杀 | 0.285 | **0.662** |
| Fast 无命中率 | 0.6406 | 0.651 |
| Optimizer 无命中率 | **0.9148** | **0.665** |

Fast **每一轮都是先手**（1.000 vs 0.000），却以 2-38 落败。先手率从「决定性」变成「无转化」。

---

## 7. Fast ↔ Hybrid（60 场）






| | Round-2（旧规则） | Revision 2 |
|---|---|---|
| 战绩 | Fast **26** · Hybrid 8 · Draw 26 | Fast **13** · Hybrid **10** · Draw **37** |
| Fast 先手率 | — | 0.841 |
| Hybrid 先手率 | — | 0.155 |
| 换序一致性 | — | `swapConsistent=1` / `swapFlipped=6` |

这是唯一「接近打平」的一对（13-10），但**换序后 7 个可比条件里有 6 个胜负翻转**，说明这点差距更接近时序噪声而不是稳定的策略优势。同归于尽在这一对里最集中：**15/60 = 25.0%**。

---

## 8. Hybrid ↔ Optimizer（60 场）



| | Round-2（旧规则） | Revision 2 |
|---|---|---|
| 战绩 | Hybrid **39** · Optimizer 4 · Draw 17 | Hybrid **3** · Optimizer **37** · Draw 20 |
| Hybrid 先手率 | 0.5604（跨配对） | 0.889 |
| Optimizer 先手率 | 0.000 | 0.111 |
| Hybrid 每有效射击击杀 | 0.4495 | 0.487 |
| Optimizer 每有效射击击杀 | 0.285 | **0.604** |
| 换序一致性 | — | `swapConsistent=14` / `swapFlipped=1` |

**方向完全反转**：Round-2 里 Hybrid 39-4 碾压 Optimizer，Revision 2 里 3-37 被碾压。Round-2 中 Hybrid 的优势是取消规则送给它的礼物，不是函数质量的优势。换序一致性 14/1 说明这个反转是稳定的，不是噪声。

---

## 9. 反事实：离线模型逐场命中官方结果









本轮把旧的 `CF-NO-CANCEL` 归档为 **historical counterfactual**（§21），新增唯一反事实 **`CF-LEGACY-CANCEL`**（§22，重加被废止的取消分支）。同时保留 `locked-attack` 模式作为**模型保真度核对**（它现在就是生产规则，不再是反事实）。

Round-2 在旧规则下用离线模型预测「若移除取消」会怎样；本轮把该预测与**真实产出的官方结果**并排：

| 配对 | Round-2 `CF-NO-CANCEL` 预测 | Revision 2 官方实测 | 一致？ |
|---|---|---|
| fast-vs-hybrid | Fast 13 · Hybrid 10 · Draw 37 | Fast **13** · Hybrid **10** · Draw **37** | **逐场完全相同** |
| optimizer-vs-hybrid | Optimizer 37 · Hybrid 3 · Draw 20 | Optimizer **37** · Hybrid **3** · Draw **20** | **逐场完全相同** |
| fast-vs-optimizer | Optimizer 38 · Fast 2 · Draw 20 | Optimizer **38** · Fast **2** · Draw **20** | **逐场完全相同** |

**这是本轮最强的两条证据之一**：

1. 修订被**忠实实现** —— 一个独立的离线模型（Python 重实现，`gb_counterfactual.py`）在生产实现上重现了 180/180 的全部胜负。
2. 修订后的平衡结果是**规则的确定性后果**，不是实现细节、时序抖动或环境的产物 —— 否则离线模型不可能逐场命中。

本轮 `locked-attack` 模式的模拟结果同样与官方逐场一致（上表即其输出）。

---

### 9.1 旧规则在**新世界**上的代价（`CF-LEGACY-CANCEL` 归因）







在官方（新规则）世界上重放每个回合，用「先手的实际命中里是否含对方 Shooter」重推旧规则会取消什么（不再读平台 flag —— 平台已不再记录取消）：

| 算法 | 回合数 | 会被旧规则取消 | 被吞掉的击杀 | 含反杀对方 Shooter |
|---|---|---|---|---|
| fast | 1521 | 59（**3.9%**） | 60 | 57 |
| hybrid | 1568 | 170（**10.8%**） | 264 | 147 |
| optimizer | 1407 | 375（**26.7%**） | **762** | **310** |

旧规则的惩罚**与算法速度单调相关**：越慢，被取消的回合越多。Optimizer 每四个回合就有一个会被抹掉。

> 口径提醒：`被吞掉的击杀中「目标在终局仍存活」= 0%`（Round-2 同一指标为 84.8%）。这是**指标定义**的后果，不是「旧规则不痛」：该指标拿的是**本轮新规则下**的终局存活集合，而新规则终局几乎人人战死，因此分母天然接近 0。请以原始计数（762 / 264 / 60）为准。

---

### 9.2 `CF-LEGACY-CANCEL` 的前向模拟






对照 Round-2 官方实测（50-0-10、39-4-17、26-8-26）：`cf-legacy-cancel` 在 fast-vs-optimizer 上**精确复现** 50-0-10，另两对差 1–2 场（24-10-26 vs 26-8-26；38-4-18 vs 39-4-17）。差异属预期：模拟跑在**本轮**的地图序列与自动选点上，不是逐位复刻 Round-2 的人工选点记录。

---

## 10. 同归于尽







| 配对 | 同归于尽 | 占比 |
|---|---|---|
| fast-vs-hybrid | **15 / 60** | **25.0%** |
| optimizer-vs-hybrid | 1 / 60 | 1.7% |
| fast-vs-optimizer | 3 / 60 | 5.0% |
| **合计** | **19 / 180** | **10.6%** |

这是旧规则下**不可能出现**的终局形态（旧规则下先手一旦清零对方，后手就没有机会再清零先手），按 §8 全部判为 **DRAW**，没有任何一场因为「A 是 First Solver」被判给 A。

**180 场的全部 77 场平局已完全分解**：58 场打满 30 轮上限（`endReason = NONE`）+ 19 场同归于尽（`MUTUAL_ELIMINATION`）= 77。**不存在第三类平局。**

分布明显不均：Fast↔Hybrid 每四场就有一场同归于尽，而涉及 Optimizer 的对局很少。两个「战术优先 + 早返回」风格的算法更容易互相对射到同归于尽。

---

## 11. 计时







计时规则**未改动**（先手 = 双方各自 GO 时刻起算的耗时更短者；终点 = `result.json` 的 mtime）。

| 算法 | 耗时中位数（合并） | p95 | 最大 | 先手率 |
|---|---|---|---|---|
| fast | 16.3 ms | 34.5 ms | 114.4 ms | **0.912** |
| hybrid | 24.2 ms | 169.3 ms | 596.4 ms | 0.495 |
| optimizer | **119.4 ms** | 311.6 ms | 902.2 ms | 0.058 |

与 Round-2 对比（fast 14.6 / hybrid 22.0 / optimizer 144.9 ms）：三者耗时分布基本不变，Optimizer 的中位耗时还略有下降（144.9 → 119.4 ms），因为它不再需要为「反正会被取消」而留余量…… **这一条是推断，不是测量**：本轮没有做「同一算法在新旧规则下的耗时对比」实验，不能把耗时变化归因于规则。仅记录观测值。

**速度的形式价值仍在，转化能力基本消失**：Fast 在 fast-vs-optimizer 中 100% 拿到先手，却 2-38 落败；Optimizer 的「阵亡后仍开火率」是 0.238 / 0.297，即它相当一部分射击本来就是在 Shooter 已经被反杀之后才落地的 —— 这恰恰是旧规则会删掉、新规则允许的那部分。

---

## 12. 对局长度





| | Round-2 | Revision 2 |
|---|---|---|
| 平均 | 12.87 轮 | **12.49 轮** |
| 中位 | 6 | **5** |
| p75 / p90 / p95 | 30 / 30 / 30 | 30 / 30 / 30 |
| 打满 30 轮上限 | 53 / 180（29.4%） | **58 / 180（32.2%）** |

几乎不变，打满上限的场次略有上升。

---

## 13. 僵持






连续零击杀轮数（`longestNoKillStreak`，逐场取最长）：

| | Round-2 | Revision 2 |
|---|---|---|
| 平均 | 7.03 | **8.26** |
| 中位 | 0 | 0 |
| p75 | 21 | **25** |
| p90 | 25 | **26** |
| p95 | 26 | **27** |
| 最大 | 29 | 29 |

**僵持分布变差了**：p75 从 21 抬到 25，打满上限的场次 53 → 58。原因是新规则删掉了「先手清零对方 → 本轮立即结束」这条快速终止通道。

---

### 13.1 吸收态检验（cap 60）








从 180 场里取出「至少有一侧打满 30 轮」的 **16 个条件**，对 **fast-vs-hybrid**（本轮平局与同归于尽最集中的一对，与 Round-2 同类检验口径一致）用 `--max-rounds 60` 重跑 16 × 2 摆位 = **32 场**：

| | 场数 | 占比 |
|---|---|---|
| 60 轮内分出胜负 | 10 | 31.3% |
| **打满 60 轮仍未化解** | **22** | **68.8%** |

**结论：这些僵持绝大多数是吸收式不动点，不是缓慢收敛。**把上限从 30 抬到 60 只化解了不到三分之一；剩下的 22 场即便再给一倍回合数也不动。这坐实了 Round-2 的判断（其抽查 3 场，全部停在 60 轮），且样本大了一个数量级。

**同时坐实了 Round-2 的保留意见**：30/60 都只是**测试框架的上限设置**，不是游戏性质；僵持分布被上限右删失，因此**任何僵持阈值都不可识别**，本轮同样不建议定阈值。

> 覆盖范围说明（如实记录）：受本轮时间预算限制，cap-60 只跑了 fast-vs-hybrid 一对（32/96 场）。`optimizer-vs-hybrid` 与 `fast-vs-optimizer` 的同类检验**未跑完**，它们各自的僵持是否同样是吸收态**未经测量**。不要把这 68.8% 外推到另外两对。单场 60 轮的成本远高于 30 轮（每轮两个沙箱），三对全跑约需 2 小时以上。

---

## 14. 规则健康度




| 健康项 | 判定 |
|---|---|
| 规则是否被**忠实实现** | **是** —— 离线独立模型逐场命中 180/180 |
| 是否还有取消路径残留 | **无** —— 守卫与出参结构性删除；`shotCancellationRate` 实测 0.0；§18 门禁 0 mismatch |
| `TIMEOUT` / `INVALID` / `CRASH` 是否被误记为取消 | **否** —— R3 / R4 专项回归 + 180 场 0/0/0 |
| 同归于尽是否被误判 | **否** —— 19 场全部判 DRAW，无一场因先手判胜 |
| 快照是否被后手重算污染 | **否** —— 输入哈希在本轮内不变（R8 + `stage-gating` 既有回归） |
| 公开说明与生产是否一致 | **是** —— kit §6.1 与 §38 同源；README 同步 |
| **平衡性是否达成** | **否** —— 见 §16 |

---

## 15. 平台发现




```text
✗ algorithm-slot: Repository's bundled two slots have identical structure (§2/§3/§41)
    Assertion failed: Slot root directory should only have fixed entry, actual manifest.json,solver.py
```







按任务书 §19：与本次规则无关的失败**不静默修复**，先定级。

#### P-1 `algorithm-slot` 既有失败（不是本轮引入）· 定级 MINOR（测试与产物不一致）

```text
✗ algorithm-slot: 仓库自带两个槽位结构完全一致（§2/§3/§41）
    断言失败: 槽位根目录应只有固定入口，实际 manifest.json,solver.py
```

- **判定为既有的依据**：把本轮全部改动 `git stash` 掉后在原始 HEAD 上单跑同一套件，**同样 7/8 失败、同一条断言**。并可 bisect 到引入提交：`d9f470c docs(v1.1): sync fixed algorithm slots with canonical starter` —— 该提交给 `algorithms/team-a|team-b` 加了 `manifest.json`（理由是「canonical starter 有 manifest」），但没有同步 `tests/algorithm-slot.ts:87` 与 `algorithms/README.md`（两者都写明槽位根目录**只有** `solver.py`）。
- `d9f470c` **不是** Cycle-2 审计基线 `5f56261` 的祖先，所以它是在那之后、Round-2 playtest 期间进入 `main` 历史的。这解释了为什么 Cycle 2 的全量回归是 26/26。
- **本轮不修**：任务书只授权规则修订；修复方式（改测试还是改产物）需要先裁决「出厂槽位是否应当是一个合法算法包」，这超出授权范围。
- **交给重审方**：请判定是产物错（应删 `manifest.json`）还是断言过期（应放宽）。

#### P-2 `cross-round-cheat` 偶发沙箱拆除挂死 · 定级 OBSERVATION（既有）

Cycle-2 已记录并取证（`Plans/Output/V1.1 Timing Anchor & sys.path Remediation Handoff.md` §5.3）：失败断言每次不同、单套件耗时 120s–1031s、超时预算未生效、重跑即绿。本轮未复现（本轮全量回归该套件 5/5 通过）。与本轮改动无可追溯因果。

#### P-3 本轮未发现新的平台缺陷

180 场中 `INVALID` / `TIMEOUT` / `CRASH` 均为 **0**，产物完整、`endReason` 与逐轮新字段全部可读，回放可完整加载。

---

## 16. 最终回答（任务书 §32）

### 16.1 删除 shot cancellation 是否解决了观察到的策略坍缩？


```text
NO
```





```text
NO
```

**没有解决，只是换了赢家。** 被点名的那个坍缩（Fast 50-0）确实消失了（50-0-10 → 2-38-20），但取而代之的是 Optimizer 38-2 与 37-3 —— 仍然是**单一策略支配**，只是支配者从「最快的」变成「函数质量最高的」。

需要区分两件事，否则会误读：

- **被正确修掉的**：速度通过「取消」这条**人为通道**支配胜负。这条通道确实关闭了，离线模型 180/180 命中也证明关闭得干净。
- **没有被修掉的**：本规则集在删掉那条通道之后，**没有剩下任何能抵消函数质量差距的机制**。Round-2 的结论「速度影响胜负的唯一通道就是 Shot Cancellation」成立，去掉该通道后，「函数质量」自然成了唯一通道。

---

### 16.2 计算速度是否仍有实质竞争价值？


```text
NO (formal value retained, substantial benefit not supported by evidence)
```



```text
NO（形式价值保留，实质收益未被证据支持）
```

- 形式价值**明确存在**：Fast 在 fast-vs-optimizer 中先手率 **1.000**（Optimizer 0.000）。
- 但对胜负几乎没有转化：同样这 60 场，Fast 2-38。对 Hybrid 是 13-10，看似有优势，但换序后 **7 个可比条件里 6 个胜负翻转**，更接近时序噪声而非稳定优势。
- 反证：Optimizer 有 **23.8% / 29.7%** 的射击是在自己的 Shooter 已被反杀之后才落地的 —— 慢的一方本来就靠「反正我的射击不会被删」吃饭。

---

### 16.3 函数质量优化是否变得过度强势？


```text
YES
```




```text
YES
```

Optimizer 拿下 75/180 场（41.7%），两场正面交锋分别是 **38-2** 与 **37-3**。每有效射击击杀 0.604–0.662，显著高于 Fast 的 0.478–0.541 与 Hybrid 的 0.473–0.487；「无命中率」从旧规则下的 0.915 降到 0.665 —— 它的函数质量第一次真正落地。

**按 §25，本轮不修改算法。** 这一轮的目的就是测 `RULE EFFECT` 而不是 `ADAPTED META`；三个竞品算法自始至终**冻结未改**。

---

### 16.4 修订后的 Shooter 规则是否适合作为 V1.1 playtest 基线？


```text
YES
```




```text
YES
```

作为**规则**：它内部自洽、实现忠实（离线模型 180/180 命中）、消除了一个人为的支配通道、把 Shooter 的语义还原为「数学发射锚点」，并且让「要不要刺杀对方 Shooter」重新变成一个真实的策略取舍而不是一击必杀的开关。

但必须把话说全：**它不是平衡性的解决方案**。选择 YES 的理由是「这条规则是对的」，不是「这套规则集已经平衡」。平衡问题（§16.1/§16.3）原样留给下一轮。

---

### 16.5 Stalemate 测量是否应成为下一个规则任务？


```text
YES
```





```text
YES
```

三条理由：

1. 僵持分布在本轮**变差**：p75 连续零击杀轮数 21 → 25，打满 30 轮上限 53 → 58。
2. 新增了**同归于尽**这一终局形态（19/180，Fast↔Hybrid 高达 25%），它是旧规则下不可能出现的新吸收结构，需要单独测量与定义。
3. Round-2 已撤回「20/30 阈值」的建议，理由是分布被 30 轮上限右删失、阈值不可识别。本轮的 cap-60 探针（§13.1）给出了更硬的证据：**68.8% 的僵持在 60 轮下仍然是吸收式不动点**（22/32），只化解了不到三分之一。也就是说僵持不是「回合数不够」，而是局面本身已经冻结 —— 这正是需要一条正式 Stalemate 规则来终结的那种局面。

按 §26，本轮**没有实现 Stalemate 规则**（保持 `DEFER`），只收集了两项测量。

---

## 17. 遗留开放问题




1. **函数质量支配是否是本规则集的结构性问题？** 去掉取消通道后，规则里再没有任何机制能补偿慢速方的函数质量优势。可动的杠杆（**本轮均未实施**）：调低时间预算、给先手方一个可量化的优势、或让射击成本与耗时挂钩。
2. **同归于尽应当是平局吗？** 本轮按 §8 判 DRAW。19/180 且集中在 Fast↔Hybrid（25%），这个比例是否可接受、是否应当有别的处理（例如按剩余点数、按击杀数），未定义。
3. **Fast↔Hybrid 的胜负是否只是噪声？** 13-10 且换序 6/7 翻转，样本不足以支持「Fast 优于 Hybrid」。需要更多条件或重复跑同一条件才能定论。
4. **僵持阈值是否可识别？** 取决于 §13.2 的 cap-60 结果。
5. **P-1（出厂槽位是否应含 `manifest.json`）** 需要裁决后才能让全量回归回到全绿。
6. **三个竞品算法是否应当为 Revision 2 重新调优？** 按 §16/§25，本轮**明确不做**；这应当是下一轮独立授权的 `ADAPTED META` 实验，且必须与本次的 `RULE EFFECT` 分开报告。

---

## 18. 复现指引


```bash
# 0. 规则与生产实现所处的提交（结果产出时的树）
git log --oneline -3          # 90647f3 / 2e825a1 / 95f2a5f

# 1. 回归（规则修订的永久证据）
npx ts-node tests/locked-attack-right.ts        # R1–R8，10/10
npm run typecheck
npx ts-node tests/run-all.ts                    # 预期 25/26（P-1 为既有失败）

# 2. 三算法平衡实验（180 场，本机约 45 分钟）
bash playtest/harness/run_shooter_rule_revision.sh

# 3. 只看汇总
python3 playtest/harness/analyze_round2.py --root playtest/results/shooter-rule-revision

# 4. 反事实（新名：locked-attack 是生产，cf-legacy-cancel 才是反事实）
python3 playtest/harness/gb_counterfactual.py verify \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --out playtest/results/shooter-rule-revision/cf/verify-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py rounds \
    --pair fast-vs-optimizer \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --out playtest/results/shooter-rule-revision/cf/rounds-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py simulate \
    --pair fast-vs-optimizer --conditions playtest/harness/conditions-round2.json \
    --out playtest/results/shooter-rule-revision/cf/sim-fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --ref-root playtest/results/shooter-rule-revision/raw \
    --modes locked-attack cf-legacy-cancel

# 5. 吸收态检验（cap 60 回合）—— 条件子集由 §13.1 的方法从归档导出
for p in fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer; do
  python3 playtest/harness/gb_round2.py run --pair $p \
      --conditions /tmp/cond-cap60.json --out /tmp/cap60-srr/$p --max-rounds 60
done
```

**注意**：不要复用 Round-2 的 `--out` 或 `--cache` —— 那些归档是**旧规则**下的证据。`gb_round2.py run` 对已归档的对局会跳过（幂等），复用到旧目录会得到 0 场新结果。

---

## 19. 完成状态

```text
SHOOTER RULE REVISION & REBALANCE COMPLETE
READY FOR INDEPENDENT RULE RE-GATE
```

本开发方**不宣布** `TOURNAMENT READY`。按任务书 §30，请交 Fresh READ-ONLY Auditor 逐项确认：

```text
Rule document   == Competitor Kit == production Judge == tests == Replay
旧 cancellation 路径是否残留
```




```text
SHOOTER RULE REVISION & REBALANCE COMPLETE
READY FOR INDEPENDENT RULE RE-GATE
```

本开发方**不宣布** `TOURNAMENT READY`。按任务书 §30，请交 Fresh READ-ONLY Auditor 逐项确认：

```text
Rule document   == Competitor Kit == production Judge == tests == Replay
旧 cancellation 路径是否残留
```

可复核锚点：

| 声称 | 怎么复核 |
|---|---|
| 规则文本已改 | `git show 90647f3 -- "Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md"` |
| 生产实现已改 | `git show 2e825a1 -- src/` |
| 取消路径无残留 | `grep -rn "shooter.alive\|ShotCancelled" src/` 应只剩历史注释；`shotCancellationRate` 实测 0.0 |
| 回归抓得到旧规则 | 把 `if (!shooter.alive) continue;` 加回 `resolveOrderedShots` → `locked-attack-right` 必须变红（自证过：10/10 → 6/10） |
| 结果是规则的确定性后果 | Round-2 的 CF 预测与 Revision 2 官方结果逐场相同（§9） |
| 算法冻结未改 | `git diff 877f142..95f2a5f --stat -- playtest/competitors/` 应为空 |
| V1.0 未被动过 | `git rev-parse v1.0.0-competition^{commit}` → `26d7970` |

---

## Document Sanitization Checklist / 文档脱敏检查清单




- **内部路径**: ✓ 全部路径相对于仓库根目录或使用规范占位符（`/tmp/`）
- **Agent 状态**: ✓ 无 agent 执行日志、内部推理或工作流状态
- **个人信息**: ✓ 无个人路径、用户名或机器特定细节
- **敏感信息**: ✓ 无凭据、令牌或敏感配置值
- **机器词元保留**: ✓ 所有技术标识符（Team A、Team B、JSON 键、CLI 标志、DSL 操作符、commit SHA、数值）保持精确

---

**Document ends / 文档结束**

