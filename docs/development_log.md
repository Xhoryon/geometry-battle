# Geometry Battle — 开发日志

> 本文件记录 V1.1 Completion Wave（Revision 3）期间的开发过程：
> 目标 / 修改 / 理由 / 文件变化 / 测试 / 问题 / 风险 / 下一步。
>
> 规则修订的**权威文本**在
> `Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md`；
> 本文件是**过程记录**，不是规则。

---

## 阶段 0 — 基线与输入

**目标**：记录可寻址的起点，并把独立重审的待办当作本轮输入。

| 项 | 值 |
|---|---|
| 起点 HEAD | `0a420a8`（Revision 2 rebalance 完成） |
| 输入任务书 | `Plans/Input/Geometry Battle V1.1 — Revision 3 Final Completion Wave.md` |
| 输入审计 | `Plans/Output/V1.1 Revision 2 Independent Rule Re-Gate.md`（CONDITIONAL PASS） |
| `v1.0.0-competition` | `26d7970`（**全程未动**） |

**审计遗留（§21 CONSOLIDATED REMAINING WORK）**：4 项 P1（RC-1 / RC-2 / CK-1 / PLAT-1）
+ 若干 P2 + Stalemate 相关的 T1–T4。

**风险**：审计文件本身是证据，只读不改；本轮所有工作在新提交里。

---

## 阶段 1 — 平台 P2 修复（与 Revision 3 正交，先做）

**目标**：把重审报告 §19 的 PLAT-2/3/4/5 + PLAT-1 + P3-15 一次关闭。

| 编号 | 问题 | 修改 |
|---|---|---|
| PLAT-2 | `goTimeout` 不在 `finish()` 里清理 → 非成功收尾泄漏定时器，沙箱销毁后仍补发 SIGKILL | 与 `poller`/`drainTimer` 并列清理；声明上移规避 TDZ |
| PLAT-3 | 结果 drain grace 与 deadline 赛跑 → 2000ms 预算可静默缩水为 1950ms | 接受结果时即撤销 `goTimeout`；deadline 回调加 `pendingResult` 兜底 |
| PLAT-4 | pre-READY 失败把 `CANCELLED` 归因给**无辜**的一方 | 新增 `RUNNER_ABORT` 与 `cancel(reason)`；READY 中止双方都给 `'PEER'` → 回合码落到 `TECHNICAL_INVALID` |
| PLAT-5 | 轨迹末点比真实交点少一个自适应步长 → 贴边敌人可能漏判 | 越界处二分到真实交点；收尾对齐到精确的 `xEnd` |
| PLAT-1 | `algorithm-slot` 过期断言让全量回归长期 25/26 | 断言改为「出厂槽位 == canonical starter 的副本」；**未删除任何 manifest.json** |
| P3-15 | `runAll` 无零用例守卫 → 0 个用例也 exit 0 | 零用例判失败；另加可选 `expectedTests` |

**验证**：typecheck 0 错误；`algorithm-slot` 8/8（此前长期 7/8）；
`obstacle-block` 9/9、`alive-kill` 5/5、`convexity-aliasing` 8/8、`map-fairness` 8/8。

**风险**：PLAT-5 改了 Judge 的轨迹末点 —— 属于判定语义面，因此跑遍了全部判定套件，
并确保既有断言一条未改。

---

## 阶段 2 — Revision 3 核心：固定 Emitter

**目标**：把「每轮选一个 Shooter」换成「整场固定的 Emitter」。

### 2.1 关键设计决策

**Emitter 不进 `points` 数组**，而不是给点加 `role: 'emitter'` 标志。

理由：`getWinner()` / `aliveAfter` / `aliveEnemies` / `publicPoints` / `markDead()`
都是「遍历 Points」的路径。把它们放进同一个数组，就得在**每一处**加排除判断 ——
漏一处就是一次静默的判定错误。放在数组外，这些函数**一行都不用改**，
「Emitter 不可击杀 / 不计入存活」变成结构性事实而不是断言。

代价：`GeneratedMap` / `public_state` / `RoundStateCore` 多一个字段。
相比之下这是更小的代价。

### 2.2 文件变化

```text
src/core/Rules.ts         +EMITTERS 常量；COMPUTE_TIMEOUT_MS 2000→500；
                          +STALEMATE_NO_PROGRESS_LIMIT=20；+HARD_ROUND_LIMIT=60
src/map/MapGenerator.ts   GeneratedMap +emitterA/emitterB（进哈希）；
                          validateMap 新增 Emitter 公平性检查
src/core/InputProtocol.ts public +emitters；reveal −shooters
src/core/Match.ts         删 selectShooter/lockShooter/locked/SELECT_SHOOTER；
                          +getEmitters()；+noProgressStreak/+terminalReason
src/core/Round.ts         状态机 19 → 16 阶段
src/core/Logs.ts          shooterA/B → emitterA/emitters；+noProgressStreak/endReason
src/ui/*、src/operator/*  跟随
```

### 2.3 终止保证（§17）

**把硬终止从 CLI 拿回引擎**：以前 `--max-rounds` 是操作台护栏，引擎自己不会结束
一场僵持。现在 `MatchEngine` 自己判定四类终局
（`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`），
CLI 的 `--max-rounds` 降级为纯兜底。这样「每场比赛都在有限时间内终止」
不再依赖任何调用方参数。

### 2.4 测试

- 删 `dual-shooter-selection`，新增 `fixed-emitter`（11 条结构断言）
- `locked-attack-right` 按 Rev 3 重写（10 条），核心从「Shooter 死了还打不打」
  改为「锁定攻击权的实质」；补上重审 VER-1 指出的**先手顺序负向回归**
- 全部套件适配新输入契约；fixture 算法的锚点改读 `public.emitters`

**踩到的坑（记录备查）**：
1. 给 `sniper`/`slow-sniper` 加 `first_enemy(public, team)` 时写成了
   `first_enemy(public, other)`，于是它去瞄**自己人** —— 端到端用例全部零击杀，
   但结构性用例全绿。教训：结构性用例不能替代端到端用例。
2. `dual-shooter-selection` 里的脚本化对局依赖「每轮人工选点」；
   改成固定锚点后必须重新搜种子（射线从常量出发不与第二个点共线），
   否则同归于尽的脚本不成立。

**风险**：这是本轮的**核心玩法变更**。它由人类明确决定（任务书 §2），
不是 Agent 的规则设计。

---

## 阶段 3 — Timeout benchmark（§11）

**目标**：用数据决定 500ms 是否可行，而不是拍脑袋。

**方法**：同一批 3 个 map condition × 2 摆位 × 3 配对，在 250 / 500 / 750 ms 下各跑一遍，
统计每个「队伍×回合」的 `TIMEOUT`。竞品算法**未做任何适配**（只把锚点读取
从 `reveal.shooters` 改成 `public.emitters`）。

| 预算 | 样本（队伍×回合） | TIMEOUT | 整场失败 |
|---|---|---|---|
| 250 ms | 128 | **20（15.6%，全部是 optimizer）** | 7 场 |
| 500 ms | 218 | **0** | 0 |
| 750 ms | 218 | **0** | 0 |

**结论**：按 §11 的判据 —— 500ms 没有让参考算法出现非预期 TIMEOUT，且明显收紧预算
—— **保持 500 ms**，不回升 2000 ms。

**产物**：`playtest/results/revision-3-timeout-bench/BENCHMARK.json`

**已知局限**：样本是 3 个条件，不是全量 30 个；500ms 的 0 超时结论有较大的置信区间。
最终 playtest（§32，180 场）会给出更大的样本作为补充证据。

---

## 阶段 4 — 规则文档与 Competitor Kit

**目标**：关闭 RC-1 / RC-2 / CK-1 / CK-2。

- **RC-1**：§0 新增全局生效声明 + **全文替换表**；逐条修正 §5/§6/§7/§8/§23/§37/
  §42/§51/§54/§55/§60/§61/§62；所有被废止的旧表述一律加
  **「历史记录（不删除）」** 标注 —— 原文一字未删。
- **RC-2**：§43 重写为「胜负只看战斗点」+ 43.1 Mutual Elimination + 43.2 其它判和分支。
- **CK-1/CK-2**：kit 的 JSON_SCHEMA（public 增 emitters / reveal 删 shooters）、
  ALGORITHM_REQUIREMENTS（§6 规则表补 Emitter / 场地边界永久终止 / 胜负；
  §6.1 重写；§15 终止规则改为四类穷举）、DSL_SPECIFICATION（示例锚点改真实 Emitter）、
  README（timeout 与 Emitter 措辞），examples 由真实引擎重新生成。
- 全部 timeout 文案 2000 → 500。

**风险**：kit 的文档示例会被 `tests/competitor-kit.ts` 拿去跑真实 parser/validator，
因此改示例值必须同步改测试里的 `DOC_SHOOTER` —— 否则「示例通过校验」会变成空转。

---

## 阶段 5 — 后续（本文件在开发过程中持续追加）

见下文各阶段。
