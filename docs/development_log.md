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

---

## 阶段 6 — 最终 playtest 暴露的一个真 bug（本轮引入、本轮修复）

**现象**：Revision 3 的第一次 180 场 playtest 跑完，**180 场全部记成 `draw`**，
三对配对的 `wins` 全是 0。

**根因**：`MatchEngine.getMatchLog()` / `getReplay()` 里的 `winner` 字段写成了

```ts
winner: this.terminalReason ? 'draw' : this.getWinner() ?? 'draw',
```

`terminalReason` 在**任何**终局（包括 `ELIMINATION`）都会被设置，于是这个三元表达式
把「一方全灭」的比赛也强制写成 `draw`。逐场核对确认：
`s1010-p8-medium__hybrid-A` 的 `endReason=ELIMINATION`、`finalAlive={A:0,B:3}`，
而 `winner` 却写着 `draw`。

注意 `RoundResult.winner`（内存返回值）是**对的** ——
`const finalWinner = winner ?? (this.terminalReason ? 'draw' : null)`。
错的只有落盘的日志与回放。这也解释了为什么此前的套件全部通过：
**没有一条用例断言过「ELIMINATION 时日志里的 winner 是谁」**。

**修复**：`winner: this.getWinner() ?? 'draw'` —— 胜者只由存活战况决定（规范 §43）。

**新增回归**：`tests/full-match-e2e.ts` 的
「ELIMINATION 必须记下真正的胜者，不得记成 draw（回归）」，
按 `endReason` 分支断言 winner 与 `finalAlive` 的对应关系
（ELIMINATION → 幸存方；MUTUAL_ELIMINATION → 双方归零且判和；
STALEMATE / HARD_ROUND_LIMIT → 判和且双方都还有点）。

**处理**：第一次 playtest 的产物是**有缺陷引擎的输出**，整体删除并重跑。
删除是刻意的：留一份已知错误的归档只会让后续引用踩雷；
本文件与回归用例保留了它的完整记录。

**教训**：终局相关的字段（winner / endReason）必须有**逐终局分支**的断言，
否则「四类终局」的新代码路径里，任何一条都可能悄悄写错而全套件全绿。

---

## 阶段 7 — UI/UX 与赛事操作

**目标**：把 §23–§27 的 UI/UX 面落到实处。

| 面 | 交付 |
|---|---|
| Audience Screen | `src/ui/ArenaView.ts`：真实几何的等宽字符渲染（场地/障碍物/固定 Emitter/战斗点生死/A·B 轨迹）+ 图例 + 坐标标尺 |
| 观众模式 | `--audience`：只输出观众屏，隐藏槽位路径、包哈希、decoy seed、状态哈希、产物目录、回放命令 |
| Team Interface | `TeamControllerUI` 重写为只读面板；旧的点位控制器删除 |
| Judge Console | 现有操作台覆盖 §24 的全部动作；`tests/operator-e2e.ts` 盯着「不需要开发者介入」 |
| Error UX | `renderRoundStatus()` 明确说出 TIMEOUT / INVALID / CRASH / RUNNER CANCELLED |

**踩到的坑**：`--audience` 第一版只挡了「产物目录」一处，槽位面板、包哈希、
decoy seed、public/reveal 状态哈希**全都还在打**。是 `operator-e2e` 的
「不得出现 `/Users/` 或 `/var/folders/`」与「不得出现 `sha256 =`」两条断言把它逼出来的
—— 观众模式的正确性只能靠**黑盒扫描输出文本**来保证，不能靠「我记得挡了」。

**未做（如实记录）**：没有动画（`computeAnimationFrames` 仍未接线）；没有键盘驱动的 TUI；
没有引入任何前端依赖。

---

## 阶段 8 — 终止保证的逐边界回归

**动机**：180 场最终 playtest 里 `HARD_ROUND_LIMIT` **一次都没触发** ——
「四类穷举」的代码路径里有一条从没被执行过。这在审计里是典型的
「写了但没验证」风险。

**做法**：给 `MatchOptions` 加**测试专用**的阈值覆盖
（`stalemateNoProgressLimit` / `hardRoundLimit`，默认仍是冻结的 20 / 60；
操作台 CLI **不暴露**这两个参数），然后新增 `tests/termination.ts`（5 条）
把两条边界都逼出来：

- 双方都打不中 → 连续零击杀达标 → `STALEMATE` / DRAW，逐轮 streak 可复核；
- 把僵持阈值抬到硬上限之上 → 必须由 `HARD_ROUND_LIMIT` 收场；
- 一条击杀就把计数清零（逐轮比对定义）；
- 多组条件下 `endReason` 必须落在四类之内，且 winner 与 endReason 对应正确。

---

## 阶段 9 — 最终验证与交付

见 `Plans/Output/V1.1 Completion Wave Report.md` 与
`Plans/Output/V1.1 Release Candidate Handoff.md`。

**本轮新增/重写的套件**：`fixed-emitter`(11) / `locked-attack-right`(10) /
`termination`(5) / `arena-view`(7) / `operator-e2e`(4)；
删除 `dual-shooter-selection`。
