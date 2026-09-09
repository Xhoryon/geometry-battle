# V1 Remediation Handoff

**最终状态（Cycle 3 审计后，3 轮上限已用尽）：V1 REMAINS NOT COMPETITION READY**

> Cycle 3 独立审计判定 **CONDITIONAL PASS**：实现层全部独立核验通过，
> 但存在 4 条**纯文档失实**（E-1…E-4），按判据构成阻塞项。
> 3 个 remediation/re-gate cycle 已用尽 → 流程在此终止。
> 详见第 10 节与 [`Plans/Output/Re-Gate Cycle 3 Result.md`](Re-Gate%20Cycle%203%20Result.md)。
>
> 本文档由 DEVELOPMENT / REMEDIATION AGENT 编写。
> 它不是审计结论。`PASS` / `COMPETITION READY` / `v1.0.0-competition` 只能由独立 Audit Agent 给出。
> 独立审计必须自行设计探针、主动尝试推翻本文档中的每一条成功声明。

---

## 1. Baseline

| 项目 | 值 |
|------|-----|
| 上一正式基线 | [`Plans/Output/Re-Gate Cycle 2 Result.md`](Re-Gate%20Cycle%202%20Result.md) → **FAIL** |
| 更早基线 | [`Plans/Output/Re-Gate Cycle 1 Result.md`](Re-Gate%20Cycle%201%20Result.md) → **FAIL**；[`Plans/Output/Plan 1 Gate Result.md`](Plan%201%20Gate%20Result.md) → **FAIL** |
| 起点提交 | `9a3e5b9` *baseline: pre-remediation snapshot (Plan 1 Gate FAIL)* |
| Cycle 1 修复提交 | `0db2dbe09d16e386ddcdc81ca518461d6e25bc74` |
| Cycle 2 修复提交 | `5a7f0c3c34e42b9087c9e0a804fe86e1d04fcc21` |
| **Cycle 3 修复提交** | `19602b4` |
| 分支 | `main` |
| 工作区状态 | 由 `git status --short` 验证为 **clean** |
| 运行时 | Node v22 / TypeScript 5 / Python 3.9.6 / macOS Darwin 25.5.0 arm64 |

> **本轮（Cycle 3）修复的是 `Plans/Output/Re-Gate Cycle 2 Result.md` 判定的 FAIL。**
> Cycle 1 修复的 39 条 Finding 见第 2 节；Cycle 1 / Cycle 2 审计新发现的阻塞项
> 分别见第 2 节末尾的「Cycle 2 修复矩阵」与「Cycle 3 修复矩阵」。
>
> Cycle 2 审计的结论是：**解除条件 (a)(b)(c)(d) 全部达成、其余核验项全部通过**，
> 仅 1 条 P1（D-1，`/tmp` 隔离缺口）与 2 条 P3（D-2、D-3）。本轮即针对这三条。

本轮允许修改代码。本轮**未**进行任何视觉优化（无新主题、新动画、新函数、新障碍、V2 gameplay、排行榜、AI 集成）。

### 共享根因

Gate 的 39 条 Finding 中，绝大多数不是彼此独立的 bug，而是同一个根因的多个表现：

**不存在一条权威的比赛流水线。** 仓库里同时存在三套互不相连的状态机（19/14/5 状态）、
两套射击判定（一套 0.3 半径、一套 0.1 半径）、两套胜负判据（一套比大小、一套从未被调用），
以及大量"能 import 但没有任何调用方"的模块。P0-1…P0-12 全都是这条断链的下游症状。

因此本轮没有逐条打补丁，而是先建立 **Canonical Match Pipeline** 作为唯一正式比赛路径：

```
                 ┌──────────── MatchEngine (src/core/Match.ts) ────────────┐
Upload ─ Package ─┤  RoundMachine (src/core/Round.ts, 19 阶段，唯一状态机) │
                 │      │                                                  │
                 │      ├─ RoundState (src/core/RoundState.ts) ── 双方同一 hash
                 │      ├─ MapGenerator (src/map/MapGenerator.ts)
                 │      ├─ Validator (src/core/Validator.ts)  ── 唯一提交期校验
                 │      ├─ SandboxRunner (src/runner/SandboxRunner.ts)
                 │      ├─ Judge (src/core/Judge.ts)          ── 唯一判定
                 │      └─ Logs (src/core/Logs.ts)            ── MatchLog/AuditLog/Replay
                 └─────────────────────────────────────────────────────────┘
```

所有旧模块（`src/competition/*`、`src/judge/Judge.ts`、`src/replay/*`、`src/function/DSL.ts`、
`src/runner/AlgorithmRunner.ts`、`src/submission/AlgorithmSubmission.ts`、`src/demo-full-ui.ts`、
`src/e2e-test.ts`）已**删除**，避免"接线时误用错误判据"。

---

## 2. Fixed Findings

状态含义：**FIXED** = 已修复且有常驻回归测试；**FIXED-DOC** = 已修复且以文档/常量对齐；
**REMOVED** = 模块删除（死代码，误用风险已消除）。

### P0 — Blocking（12/12 FIXED）

| Finding | Root Cause | Affected Files | Fix | Regression Test | Status |
|---|---|---|---|---|---|
| P0-1 人类选择 Shooter 恒失败 | `selectShooter` 走的是另一套 DSL 解析器 | `src/core/Match.ts`, `src/core/Round.ts` | 选择流程收敛到 `MatchEngine.selectShooter`，只校验点位归属与存活 | `dual-shooter-selection` | FIXED |
| P0-2 Runner 拒绝文档约定输出 | 协议实现与 README 不一致（多行 vs 单行 JSON） | `src/runner/SandboxRunner.ts` | 单行 JSON stdin→stdout，AST 对象或 JSON 字符串均可 | `dsl-contract` | FIXED |
| P0-3 官方 starter 非法 | starter 用了被禁算子 / 未过 shooter | `starter/solver.py` | 重写为纯 14 算子白名单、严格过自己 Shooter | `official-starter` | FIXED |
| P0-4 永不结束、无击杀 | 判定半径 0.1 与坐标量级不匹配，且无方向/遮挡 | `src/core/Judge.ts`, `src/core/Rules.ts` | 统一 `HIT_EPSILON = 1e-6` + 攻击方向 + 首次障碍接触 | `alive-kill`, `obstacle-block` | FIXED |
| P0-5 上传无包校验 | 无 `Package` 模块 | `src/submission/Package.ts` | 体积/文件数/扩展名/符号链接/entry 校验 | `package-tamper` | FIXED |
| P0-6 包哈希不复验 | 密封副本可变 | `src/submission/Package.ts`, `src/core/Match.ts` | 密封副本只读（0o444/0o555）+ 每轮复验 | `package-tamper` | FIXED |
| P0-7 无文件系统隔离 | 裸 `spawn('python3')` | `src/runner/SandboxRunner.ts` | `sandbox-exec` + SBPL `(deny default)` | `runner-isolation` | FIXED |
| P0-8 跨 Round 可持久化 | 沙箱目录复用 | `src/runner/SandboxRunner.ts`, `src/core/Match.ts` | 每回合全新沙箱，回合后整目录销毁 | `cross-round-cheat` | FIXED |
| P0-9 判定无视障碍物 | Judge 只看 `|f(x)-y|` | `src/core/Judge.ts` | 首次障碍接触截断 + 接触点前才算命中 | `obstacle-block` | FIXED |
| P0-10 流水线是死代码 | 无任何调用方 | `src/core/Match.ts`, `src/operator/cli.ts` | 建立 Canonical Pipeline + 正式操作台 | `full-match-e2e` | FIXED |
| P0-11 消除/取消未实现 | 无该语义 | `src/core/Match.ts`, `src/core/Judge.ts` | 先解者先射击；击杀对方 Shooter → 取消其攻击 | `shooter-cancel` | FIXED |
| P0-12 A 选完即 LOCKED | 状态转换错误 | `src/core/Round.ts` | 双方各自锁定后才进入 `WAITING_FOR_JUDGE` | `dual-shooter-selection` | FIXED |

### P1 — Integrity（27/27 FIXED）

| Finding | Root Cause | Affected Files | Fix | Regression Test | Status |
|---|---|---|---|---|---|
| P1-1 C² 校验不存在 | 只查非有限值 | `src/core/Validator.ts` | 二分尺度跳变检测（连续 / C¹ / C²） | `dsl-contract` | FIXED |
| P1-2 凸性 ≤100 未执行 | 提交路径没调用 | `src/core/Validator.ts` | 射击区间内凸性变号计数并硬拒绝 | `convexity-aliasing` | FIXED |
| P1-3 NaN/Infinity 未被拒 | 无 `isFinite` 检查 | `src/core/Validator.ts` | 采样点非有限即拒绝 | `dsl-contract` | FIXED |
| P1-4 跳变检测失效 | 步长固定、尺度无关 | `src/core/Validator.ts` | 多尺度二分检测 | `dsl-contract` | FIXED |
| P1-5 采样混叠清零凸性 | 采样步长与 ω 不匹配 | `src/core/Validator.ts` | 由 ω 推导步长（约 1600 半周期不再混叠） | `convexity-aliasing` | FIXED |
| P1-6 三套引擎互相矛盾 | 无权威 Judge | `src/core/Judge.ts` | 单一 Canonical Judge，其余删除 | `obstacle-block`, `alive-kill` | FIXED |
| P1-7 圆/多边形不遮挡 | 只实现了矩形 | `src/core/Judge.ts` | 四类障碍统一 `penetration`/`firstContactX` | `obstacle-block` | FIXED |
| P1-8 击杀归属颠倒 | A/B 写反 | `src/core/Logs.ts`, `src/core/Match.ts` | 按攻击方归属写入 | `alive-kill` | FIXED |
| P1-9 容差是玩法半径 | 0.3/0.1/2.0 三套阈值 | `src/core/Rules.ts`, `src/core/Judge.ts`, `src/core/Validator.ts` | 统一 `HIT_EPSILON = 1e-6` | `alive-kill` | FIXED |
| P1-10 计时顺序偏置 | 各自 `Date.now()` 起算 | `src/runner/SandboxRunner.ts` | READY/GO 屏障 + **各方以自己的 GO 时刻起算**（Cycle 2 修正） | `timing-fairness` | FIXED |
| P1-11 `memoryLimitMb` 无效 | Darwin 上 RLIMIT_AS 是空操作 | `src/runner/SandboxRunner.ts` | 宿主侧 RSS 轮询（60ms） | `runner-isolation` | FIXED |
| P1-12 孙进程成孤儿 | 只 kill 直接子进程 | `src/runner/SandboxRunner.ts` | 独立进程组 + 整组清理 | `process-tree-cleanup` | FIXED |
| P1-13 继承宿主环境 | `env: process.env` | `src/runner/SandboxRunner.ts` | 环境白名单（见 Known Limitations） | `process-tree-cleanup` | FIXED |
| P1-14 网络不受限 | 无 SBPL 网络规则 | `src/runner/SandboxRunner.ts` | `(deny network*)` | `runner-isolation` | FIXED |
| P1-15 先解者只是比较 | 无副作用 | `src/core/Match.ts`, `src/core/Judge.ts` | 先解者先射击 + 取消语义 | `shooter-cancel` | FIXED |
| P1-16 MatchLog 从不写入 | 无落盘 | `src/core/Logs.ts` | `persistArtifacts` 写 match/audit/replay | `full-match-e2e`, `replay` | FIXED |
| P1-17 `startLogging()` 未调用 | 死代码 | `src/core/Match.ts` | 引擎内部统一发事件 | `replay` | FIXED |
| P1-18 Replay 不可用 | 无 `loadReplay` | `src/core/Logs.ts` | `loadReplay` 纯读取，不重跑算法 | `replay` | FIXED |
| P1-19 超时口径不符 | 含解释器启动 | `src/runner/SandboxRunner.ts` | 从本队自己的 GO 时刻起算（Cycle 2 修正） | `timeout-boundary` | FIXED |
| P1-20 17 阶段未接线 | 状态机是死代码 | `src/core/Round.ts` | 19 阶段真实驱动，非法转换抛错 | `full-match-e2e` | FIXED |
| P1-21 B 先开火判错胜者 | 硬编码 A | `src/core/Round.ts`, `src/core/Match.ts` | 按 `firstSolver` 结算 | `shooter-cancel` | FIXED |
| P1-22 无观众 UI | 无消费方 | `src/ui/AudienceScreenUI.ts` | 只读引擎快照 / 回放，不参与判定 | `full-match-e2e` | FIXED |
| P1-23 动画层死代码 | 无调用方 | `src/visualizer/AudienceDisplay.ts` | 收敛为纯数据层；**动画本身留到 Re-Gate PASS 后** | — | FIXED-DOC |
| P1-24 结束前显示错误胜者 | 读的是中间态 | `src/ui/AudienceScreenUI.ts` | 只在 `winner !== null` 后展示 | `full-match-e2e` | FIXED |
| P1-25 `finishRound` 无守卫 | 可伪造回合日志 | `src/core/Round.ts` | 所有转换经 `transition()` 校验 | `full-match-e2e` | FIXED |
| P1-26 MatchLog 哈希为空 | 硬编码结果 | `src/core/Logs.ts`, `src/core/Match.ts` | 完整 SHA-256 + 真实包哈希 | `replay` | FIXED |
| P1-27 只校验本方半场 | 采样区间写死 | `src/core/Validator.ts` | 校验整个射击区间 | `dsl-contract` | FIXED |

### P2 — Important（24/26 FIXED，2 项 DEFERRED）

| Finding | Fix | Regression Test | Status |
|---|---|---|---|
| P2-1 无真实 barrier | READY/GO 屏障 + 各队独立 `releaseNs`（Cycle 2 修正） | `timing-fairness` | FIXED |
| P2-2 无 per-team RoundState hash | 双方 payload 逐字节一致（仅 `team_id` 不同），完整 SHA-256 | `roundstate-equality` | FIXED |
| P2-3 无操作台 / CLI | `src/operator/cli.ts`（正式入口） | `full-match-e2e` + 第 5 节 | FIXED |
| P2-4 README 与实现不符 | README 全量重写（白名单/协议/限制/结构） | — | FIXED-DOC |
| P2-5 无面向用户的上传流程 | `MatchSetupUI.uploadTeamA/B` 接入 CLI | `full-match-e2e` | FIXED |
| P2-6 不存在的路径抛 ENOENT | `Package` 返回结构化错误 | `package-tamper` | FIXED |
| P2-7 允许 `floor/ceil/sign/if` | 收敛为 14 算子白名单 | `dsl-contract` | FIXED |
| P2-8 无 INVALID SHOT 语义 | `RoundLog.result` 显式区分 TIMEOUT/INVALID/TECHNICAL | `timeout-boundary` | FIXED |
| P2-9 `minDistanceToObstacle` 死配置 | 配置删除，统一 `POINT_OBSTACLE_CLEARANCE` | `map-fairness` | FIXED |
| P2-10 校验阈值 2.0 过严 | 统一距离函数与阈值 | `map-fairness`, `obstacle-block` | FIXED |
| P2-11 demo 与真实流程脱节 | `demo-full-ui.ts` 删除 | — | REMOVED |
| P2-12 先解者受调度抖动 | 每方以自己 GO 时刻起算 + `TIE_EPS_MS` 并列判定（Cycle 2 修正） | `timing-fairness` | FIXED |
| P2-13 `pointCount` 无上限 | 入口校验 6–10 | `map-fairness` | FIXED |
| P2-14 强制放置回退 | 改为返回 null（`generateMap` 顺序换种子，512 次后抛错） | `map-fairness` | FIXED |
| P2-15 AuditLog 事件面不完整 | 83 事件覆盖全流程 | `replay` | FIXED |
| P2-16 状态机 7/19 不可达 | `Round.ts` 全阶段可达 | `full-match-e2e` | FIXED |
| P2-17 三套状态机 | 旧模块删除，收敛为 `Round.ts` | — | REMOVED |
| P2-18 裁判控制简陋 | START ROUND 已有；**PAUSE/RESUME/END MATCH 未实现** | — | **DEFERRED** |
| P2-19 Lock 语义未强制 | 锁定后拒绝再次选择，且校验点位存活 | `dual-shooter-selection` | FIXED |
| P2-20 UI 用另一套近似判定 | UI 只消费引擎快照 | `full-match-e2e` | FIXED |
| P2-21 动画无停止 / 无时序 | **未接线**（属视觉层，留到 Re-Gate PASS 后） | — | **DEFERRED** |
| P2-22 无任何落盘 | `persistArtifacts` / `loadReplay` | `replay` | FIXED |
| P2-23 生成器产出非法地图 | 取消强制放置；`validateMap` 在生成路径上强制执行 | `map-fairness` + 300k 压力 | FIXED |
| P2-24 `Competition` 判据错误 | 模块删除 | — | REMOVED |
| P2-25 Runner 无输出上限 | `MAX_STDOUT_BYTES` / `MAX_STDERR_BYTES` 截断并报 `OUTPUT_TOO_LARGE` | `runner-isolation` | FIXED |
| P2-26 ReplayFrame 字段不足 | 补齐地图快照 / 存活链 / 取消 / 超时 / firstSolver | `replay` | FIXED |

### P3 — Polish（11/14 FIXED，3 项见第 4 节）

| Finding | Fix | Regression Test | Status |
|---|---|---|---|
| P3-1 README 宣称隔离 | 现在是真实隔离（sandbox-exec） | `runner-isolation` | FIXED |
| P3-2 `test` 等同 `start` | `npm test` → 18 套件聚合运行器 | `run-all.ts` | FIXED |
| P3-3 包哈希忽略文件名 | 哈希纳入相对路径 + 大小 + 内容 | `package-tamper` | FIXED |
| P3-4 `computeTimeMs` 含启动开销 | 从本队自己的 GO 时刻起算，README 文档化 | `timing-fairness` | FIXED-DOC |
| P3-5 `Date.now()` 无亚毫秒 | `process.hrtime.bigint()` 高精度单调时钟 | `timing-fairness` | FIXED |
| P3-6 macOS 无 /dev/shm | 沙箱本身已隔离，无需 tmpfs | — | FIXED-DOC |
| P3-7 圆形障碍越界 | 生成期拒绝越界障碍 + `validateMap` 校验几何 | `map-fairness` | FIXED |
| P3-8 stateHash 截断 | 完整 SHA-256 | `roundstate-equality` | FIXED |
| P3-9 difficulty 枚举未校验 | 入口校验 | `map-fairness` | FIXED |
| P3-10 跨队过近只是警告 | 同队过近为 error；跨队保留 warning（规范未定义硬阈值） | `map-fairness` | FIXED-DOC |
| P3-11 `Competition` 自相矛盾 | 模块删除 | — | REMOVED |
| P3-12 命名误导 | 重命名为 `SandboxRunner` 并文档化 | — | FIXED-DOC |
| P3-13 弱 LCG | 换成 `mulberry32`（确定性不变，分布改善） | `map-fairness` | FIXED |
| P3-14 未覆盖领域 | 部分补测（数值 oracle 已入常驻回归）；其余见第 4 节 | `dsl-contract` | PARTIAL |

### Cycle 2 — 针对 `Plans/Output/Re-Gate Cycle 1 Result.md`（判定 FAIL）的修复矩阵

Cycle 1 独立审计判 **FAIL**，并给出解除条件。下表逐条对应。**每一条 FIXED 都有常驻回归测试**，
审计方可用同样探针复测。

| Finding | Root Cause | Affected Files | Fix | Regression Test | Status |
|---|---|---|---|---|---|
| **P0-A** 超深 AST 使宿主崩溃且零落盘 | 深度守卫在递归下降**之后**才生效；`JSON.parse`/`JSON.stringify` 的 `RangeError` 被同一个 `catch` 吞掉并误归因为「缺少 dsl 字段」 | `src/core/Ast.ts`, `src/runner/SandboxRunner.ts` | ① 深度/节点上限在**递归前**判定，超限直接返回 `INVALID_OUTPUT`；② `parseAlgorithmOutput` 拆分 parse/stringify，`stringify` 抛错单独归因为「嵌套过深，无法序列化」，不再伪装成格式错误；③ 解析异常不得逃逸到操作台 | `hostile-input`（当时 5 tests：6000 层 / 40 层确定性触发 / 100k 层巨型 JSON / 归因正确 / 中止前逐回合落盘；Cycle 3 追加 D-2/D-3 后为 6 tests） | FIXED |
| **P0-B** 沙箱可读对手源包、上一场密封包、任意 `/tmp` | `denyReadPaths` 只含 `sealedRoot`，未含双方 `sourceDir` 与 `artifactRoot`；`/tmp` 与 `/var/tmp` 无兜底拒绝 | `src/runner/SandboxRunner.ts`, `src/core/Match.ts` | `denyReadPaths` 覆盖双方 `sourceDir` + `sealedRoot` + `artifactRoot`；新增系统兜底 `/private/tmp`、`/private/var/tmp`；realpath 归一 + 去重 + **剔除会拒绝沙箱自身的条目** | `runner-isolation`（`preflightProbe` 正向 + `outside_dir` 反向对照） | FIXED |
| **P1-A** 产物只在赛末落盘，中止即全丢 | `persistArtifacts` 仅在 `MATCH_END` 调用 | `src/core/Match.ts` | 每回合结束后落盘一次；异常/取消路径同样落盘 | `hostile-input`（中止前逐回合落盘）、`replay` | FIXED |
| **P1-B** 后释放方被多计交付延迟 | 双方共用 `min(releaseNs)` 作为计时基准 | `src/runner/SandboxRunner.ts` | 每方以**自己** `release()` 返回的 GO 时刻起算；`releaseSkewUs` 降级为诊断量 | `timing-fairness`（新增「两次 GO 间隔 40ms 被如实记录 + `release()` 幂等」结构性用例） | FIXED |
| **P2-A** 攻击被取消记为 `INVALID` | 取消与非法共用同一结果码 | `src/core/Logs.ts`, `src/core/Match.ts` | 独立结果码 `CANCELLED_A` / `CANCELLED_B` + 独立 `cancelledA/cancelledB` 字段 | `shooter-cancel`（「取消独立编码」用例） | FIXED |
| **P2-B** 取消守卫是死代码（后手仍开火） | 守卫置于结算循环内、`markDead` 置于循环之后，条件恒真 | `src/core/Match.ts` | 先解方结算 → `markDead` → 后手方按存活状态判定是否开火；并列先手基于同一快照同时开火 | `shooter-cancel`（「守卫可达」+「并列同时开火」两个用例，含反面对照组） | FIXED |
| **P3-A** Handoff 自身 7 条失实 | 文档声明与实现脱节 | `Plans/Output/V1 Remediation Handoff.md`, `src/submission/Package.ts` 注释 | 逐条更正：§4 僵局段（有限声明）、§5 表格（4096 字节截断 / 对手源包与 artifactRoot）、§6（`releaseSkewUs` 语义 / `aFasterRate` 自相矛盾）、§8 #2/#4（计时基准 / 每回合落盘）、`Package.ts` 注释（源包密封后不复验、无告警） | 本表即更正清单；`package-tamper` 固化 NUL 分隔符 | FIXED |
| **P3-B** `Package.ts` 含 2 个裸 NUL 字节 | 源码里直接写入 `\0`，`grep` 判为二进制而静默跳过 | `src/submission/Package.ts`, `tests/package-tamper.ts` | 运行期用 `String.fromCharCode(0)` 构造分隔符，源码保持纯 ASCII；新增断言「`Package.ts` 不含裸 NUL」 | `package-tamper`（「哈希字段分隔符与源码可检索性」用例） | FIXED |
| **P3-D** 沙箱根遗留空目录 | `cleanupSandbox` 只删回合目录 | `src/runner/SandboxRunner.ts` | 同时移除 `<matchId>` 目录，保留 `sandboxRoot` 本身；回合后 `readdirSync(sandboxRoot)` 为空 | `cross-round-cheat` | FIXED |
| **P3-C** `obstacleInField` 拒绝率高（hard 60.92%） | 障碍取心范围与「完全落在场内」约束冲突，靠整种子重采样 | `src/map/MapGenerator.ts` | **未修**：无正确性影响（300k 张 0 违规，74k 张/s），属实现冗余；按用户约束 P3 不阻碍 V1 | 300k 压力（0 invalid） | DEFERRED (P3) |

### Cycle 3 — 针对 `Plans/Output/Re-Gate Cycle 2 Result.md`（判定 FAIL）的修复矩阵

Cycle 2 独立审计判 **FAIL**：解除条件 (a)(b)(c)(d) 全部达成，其余核验项全部通过，
阻塞项仅 **D-1**（P1），另有 **D-2 / D-3** 两条 P3。下表逐条对应，每条都有常驻回归测试，
且 D-1 / D-2 已做**突变承重验证**（把修复改回缺陷形态，测试必须失败）。

| Finding | Root Cause | Affected Files | Fix | Regression Test | Status |
|---|---|---|---|---|---|
| **D-1**（P1）`sandboxRoot` 位于 `/tmp` 下时，`/tmp` 兜底拒绝被静默丢弃 → 算法可读任意未被显式 deny 的 `/tmp` 文件（含**其他场次的密封包**） | 自保护过滤的判定对象是 `sandboxRoot`：当 `sandboxRoot` 落在 `/tmp` 之下时，`covers('/private/tmp', sandboxRoot)` 为真，于是**系统兜底 deny 也被当作「会阻断沙箱自身」而整条丢弃** | `src/runner/SandboxRunner.ts` | ① 自保护判定对象收窄为 `sandboxDir` / `work`（不再含 `sandboxRoot`）；② `SYSTEM_DENIES = ['/private/tmp','/private/var/tmp']` **永不参与过滤**（命中即短路保留）。二者均为承重点：突变任一处，D-1 回归用例即失败 | `runner-isolation`（新增「`sandboxRoot` 位于 `/tmp` 下时，任意 `/tmp` 读取仍被拒绝（D-1 回归）」：结构性断言 profile 保留 `(deny file-read* (subpath "/private/tmp"))` + 行为断言读 `/tmp` 文件、列举 `/tmp` 均被拒 + 反向对照 `LEAK:ctrl_dir`） | FIXED |
| **D-2**（P3）解析失败原因在集成层被抹平：删掉 AST 深度守卫后集成回归仍会通过 | `tryParseAst` 只返回 AST，把解析失败一律压成「输出不是合法 DSL」，于是「深度超限」这一关键诊断在 `MatchEngine` 层消失（随后必然被 Shooter 校验拒绝，文案相同） | `src/core/Match.ts` | 新增 `parseAstDetailed()` 保留失败原因（`parseCanonicalDSL` 的 `code: message` 列表），`validateOutcome` 如实透出 | `hostile-input`（40 层确定性用例改为承重断言：必须匹配 `/在第 \d+ 层拒绝/`，且不得出现 Shooter 校验文案 `/相差/`） | FIXED |
| **D-3**（P3）日志自相矛盾：`result = INVALID_A` 而 `aErrorCode = null` | 运行器**成功**、但输出构不成合法 DSL（如使用被禁算子）时，运行器自身没有错误码可回填 | `src/core/Match.ts` | 新增 `errorCodeFor()`：`outcome.errorCode ?? (success && !final ? 'INVALID_DSL' : null)`；失败/取消路径仍保留运行器自己的错误码 | `hostile-input`（新增「输出可解析但非法时，错误码与回合结果一致（D-3 回归）」：round 0 合法过 Preflight、round 1 输出被禁算子 `floor`，断言 `INVALID_A` ⇔ `INVALID_DSL`） | FIXED |

> **D-1 的审计要求与实现对应关系**（逐条）：
> ① 「自保护过滤只允许丢弃会阻断 `sandboxDir`/`work` 自身的 deny」→ `selfPaths = [sandboxDir, work]`；
> ② 「系统兜底 deny 永不参与过滤」→ `if (SYSTEM_DENIES.includes(p)) return true;` 短路；
> ③ 「新增常驻回归测试」→ `runner-isolation` 第 6 个用例。
>
> 保留这些兜底条目不会伤到沙箱自身：末尾的 `(allow file-read* (subpath sandboxDir))`
> 按 SBPL「后匹配者胜」重新放行；模板中无条件存在的
> `(deny file-read* (subpath sandboxRoot))` 与它同理，且一直工作正常。
> 换句话说：**兜底 deny 与沙箱自读权限的冲突，本来就由「后匹配者胜」解决，
> 不需要靠丢弃 deny 来解决** —— 这正是 D-1 的根因。

---

## 3. Full E2E Evidence

**要求**：从干净启动开始，走完 Upload A/B → Preflight → Seal → Generate map → Start Match →
Human shooter selection → Judge START ROUND → Reveal → Compute → First solver shot →
Second shot / cancellation → Round result → Next Round → Winner → Logs → Shutdown →
Restart → Load Replay。全程只用正式入口，不修改生产代码 / 内部 JSON / 数据库，
不注入状态、不 monkey patch、不使用测试专用后门。

**执行方式**：两份**现场新建**的算法包（`/tmp/gb-e2e/team-alpha`、`/tmp/gb-e2e/team-beta`，
非 fixture、非 starter、未出现在任何生产代码中），通过正式操作台
`npx ts-node src/operator/cli.ts` 驱动；Shooter 由模拟人类操作员通过 CLI 的
公开提示符逐个输入（`Team A 选择 Shooter (点 id):`）。

> 以下为 **Cycle 3 在冻结候选树上重跑**的现场记录（产物目录 `artifacts-cycle3`）。
> Cycle 1 / Cycle 2 审计看到的旧记录取自修复前的树，已作废。
>
> 算法包沿用本会话在 `/tmp` 现场创建、**不属于本仓库**的同一对
> （`/tmp/gb-e2e/team-alpha`、`/tmp/gb-e2e/team-beta`；内容未变，故哈希与 Cycle 2 相同），
> 以便与上一轮在同一输入、同一 `seed` 下逐轮对照。

```text
═══ 1. 上传与密封 ═══
  A hash: b4ebb44ae1d5f497238bc220cb0b10584a21e1572bb1748403979c5282c6c020
  B hash: d8683db2be0fa329115f8f1c3179f526c3d4040f84dbc563624ad1224d35177d

═══ 2. Preflight（真实沙箱内跑一次算法）═══
  ✓ PASSED

═══ 3. 开始比赛 ═══
│ Match ID      MATCH-MTTU393K-BXZUQX
│ Seed          20260909
│ Map           seed=20260909 8v8 obstacles=2
│ ALL READY     ✓ YES

── ROUND 1 RESULT ──   先解: B   A: A1 (被取消)   B: B1 命中=[A1]   取消: A=true
── ROUND 2 RESULT ──   先解: A   A: A2 命中=[B6]  B: B1 命中=[A2]   击杀: [B6,A2]
── ROUND 3 RESULT ──   先解: B   A: A3 (被取消)   B: B1 命中=[A3]   取消: A=true
── ROUND 4 RESULT ──   先解: B   A: A4 (被取消)   B: B1 命中=[A4]   取消: A=true
── ROUND 5 RESULT ──   先解: B   A: A5 (被取消)   B: B1 命中=[A5]   取消: A=true
── ROUND 6 RESULT ──   先解: B   A: A6 (被取消)   B: B1 命中=[A6]   取消: A=true
── ROUND 7 RESULT ──   先解: A   A: A7 命中=[B3]  B: B2 命中=[A7]   击杀: [B3,A7]
── ROUND 8 RESULT ──   先解: B   A: A8 (被取消)   B: B2 命中=[A8]   取消: A=true
                         存活: A=0  B=6

  WINNER: B
  Rounds: 8   Kills: A=2 B=8
  Artifacts: /tmp/gb-e2e/artifacts-cycle3/matches/MATCH-MTTU393K-BXZUQX
```

该场次验证到的语义：
- **Seal**：A/B 包哈希不同且完整 64 位十六进制；
- **Preflight** 在真实沙箱内执行；
- **Reveal / Compute**：每轮双方拿到同一 `stateHash`（回放帧与 MatchLog 逐轮一致）；
- **First solver shot**：第 2/7 轮 A 先解，第 1/3/4/5/6/8 轮 B 先解（**两个方向都出现**）；
- **Shot cancellation**：第 1/3/4/5/6/8 轮 A 的 Shooter 被先解的 B 击杀 → A 的攻击被取消
  （`取消: A=true`，结果码 `CANCELLED_A`，不是 `INVALID_A`）；
- **Alive propagation**：A 侧 `7→6→5→4→3→2→1→0` 严格单调递减；
- **Winner**：一方 `alive = 0` 时比赛结束，且只在结算后出现。

**落盘产物**（`MATCH-MTTU393K-BXZUQX/`）：

```text
audit.json    84 事件：MatchCreated → PackageSealed×2 → Preflight → MatchStarted →
              ShooterSelected×16 → ShooterLocked×16 → BothLocked×8 → JudgeStartRound×8 →
              RoundComputeStart×8 → ShotCancelled×6 → RoundComputeEnd×8 → RoundResult×8 →
              MatchEnded；seq 严格递增（已断言），时间戳可解析
match.json    schemaVersion=1, teamAPackageHash/teamBPackageHash 均为真实哈希,
              winner=B, 8 个 round 记录, finalAlive={A:0,B:6}
replay.json   8 帧，含地图障碍物快照、存活链、轨迹、取消/超时字段
              （grep `solver.py|manifest.json|__gb_bootstrap|__gb_profile|sandboxes` = 0 命中）
```

**Shutdown → Restart → Load Replay**（新进程，算法包与沙箱均已不在）：

```text
$ npx ts-node src/operator/cli.ts --replay /tmp/gb-e2e/artifacts-cycle3/matches/MATCH-MTTU393K-BXZUQX
═══ REPLAY MATCH-MTTU393K-BXZUQX — winner B (8 rounds) ═══

── ROUND 1 ──
  Shooter A=A1  B=B1
  f_A(x) = (invalid)
  f_B(x) = 1.9342497736215591 + (0.2722202017962749 * (x - 17.925887423101813) + ...)
  t_A=-ms  t_B=5.564ms  first=B
  hits A=[] B=[A1]
  killed=[A1] cancelled A=true B=false
  alive after: A2,A3,A4,A5,A6,A7,A8,B1,B2,B3,B4,B5,B6,B7,B8
  ...
（回放为只读记录，未重新运行任何算法）
```

回放加载耗时 < 200ms（`tests/replay.ts` 断言），且 `replay.json` 中不含
`solver.py` / `manifest.json` / `__gb_bootstrap` / `__gb_profile` / `sandboxes`
任何字符串 —— 回放不可能重跑算法。

---

## 4. Remaining Findings

以下为**未修复**项。全部为 P2/P3，按用户约束 **P3 不阻碍 V1 完成**；
其中 P2-18 与 P2-21 属"操作台增强 / 视觉层"，明确留到 Re-Gate PASS 之后。

| Finding | 现状 | 为什么不阻塞 V1 | 建议 |
|---|---|---|---|
| **P2-18** 裁判控制简陋 | `START ROUND` 已实现；`PAUSE` / `RESUME` / `END MATCH` 与倒计时显示**未实现** | 正式比赛路径（上传→选人→开跑→结算→下一轮→胜者）已完整；暂停/终止属异常处置，可由操作员直接终止进程，**截至上一已完成回合**的产物已落盘可读 | Re-Gate PASS 后补 |
| **P2-21** 动画无停止 / 无时序 | `AudienceDisplay` 已收敛为纯数据层，动画驱动**未接线** | 用户明确禁止本轮做视觉优化；观众屏已能展示真实状态 | Re-Gate PASS 后补 |
| **P3-14** 未覆盖领域（部分） | 已补：数值 oracle（30 AST × 13 点 × 390 次比对）已入常驻回归。**未补**：① Rule 31「病态但合法 DSL 使 Judge 卡死」的构造性测试；② Unicode / CJK 路径 / 非 ASCII 输出的编码测试；③ A/B 间 CPU 限额、线程数、数学库版本对称性 | ① 校验采样步长固定、成本有界，未找到可放大的入口；② 包校验已限制扩展名与体积；③ 双方运行在同一宿主同一沙箱模板下 | 下一轮补测 |

**僵局（stalemate）—— 规范缺口，不是实现缺陷**：`Plan V1 §28` 只定义"一方全部点死亡则比赛结束"，
**没有定义双方都无法命中时的终止条件**。实测：使用不做避障的朴素算法包时，比赛可持续
668 回合而不终止；**Cycle 3** 用另外两份会绕障的算法包在同一张地图上复现，跑到第 790 回合
仍无胜者（见第 8 节 Known Limitations）。

**关于平台在长僵局下的行为，只能作如下有限声明**（Cycle 1 审计曾判定此处表述失实，故改为可复现口径）：

- 不会误判胜负 —— 判定走 Canonical Judge，无命中即无击杀，回合结果记为无击杀而非任意一方获胜；
- 回合日志**每回合落盘**（P1-A 修复后；Cycle 1 时是仅在赛末落盘，该声明当时不成立）；
- 病态/超深 DSL 载荷被记为 `INVALID_OUTPUT` 而非让进程崩溃（P0-A 修复后；由 `hostile-input` 套件固化）。
  这**不构成**"任意输入下平台都不崩溃"的保证 —— 未覆盖的失败模式仍然可能存在（见第 8 节 #6）。

赛事规则层面的终止条件缺口需要 Plan 补充规则后由后续版本实现。

---

## 5. Runner Isolation Evidence

`tests/runner-isolation.ts`（**6 tests**）+ `tests/cross-round-cheat.ts`（5 tests）+
`tests/process-tree-cleanup.ts`（3 tests）+ `tests/hostile-input.ts`（**6 tests**）。
所有探针都是**真实发起的攻击**，判定标准是 `BLOCKED`，不是"算法自己选择不做"。

沙箱策略（SBPL，`sandbox-exec`）：`(deny default)` + `(deny network*)` + `(deny process-fork)`，
`(allow file-read*)` 之后依次写入：

1. 固定拒绝 `(subpath "/Users")` 与 `(subpath sandboxRoot)`；
2. 调用方传入的 `denyReadPaths`（正式路径下为**双方 `sourceDir`、`sealedRoot` 与 `artifactRoot`**）
   与系统兜底 `/private/tmp`、`/private/var/tmp`；
3. 上述条目先经 **realpath 归一 + 去重**，再剔除**会拒绝沙箱自身**的条目
   （`covers()`：若某条 deny 是 `sandboxDir` / `work` 的祖先则丢弃 —— 否则
   算法连自己的入口文件都读不到，整场比赛全挂）。
   **系统兜底 deny 永不参与该过滤**（命中即短路保留，Cycle 3 修复 D-1）；
   `sandboxRoot` 也不在判定对象内 —— 它被模板无条件 deny，并由末尾的 allow 放行；
4. 最后重新 `(allow file-read* (subpath sandboxDir))`（SBPL 后匹配者胜）。

> **三处真实漏洞（均已修复并固化）**：
> ① Cycle 1 审计发现：原先的 `denyReadPaths` 只含 `sealedRoot`，**对手的源包目录**
> 与 **`artifactRoot`（含历史场次的密封包与产物）** 仍在 `(allow file-read*)` 的默认放行范围内，
> 且当 `artifactRoot` 落在 `/Users` 之外时连 `sealedRoot` 都不在拒绝列表中 —— 算法可读对手包。
> 现已把双方 `sourceDir`、`sealedRoot`、`artifactRoot` 一并纳入拒绝，并以
> `runner-isolation` 的 `preflightProbe` 反向对照用例固化（对照项证明探针确实执行了）。
> ② 修复 ① 时我自己引入了**过宽 deny**（无条件拒绝 `/private/var/folders`，而 macOS 默认
> 沙箱根恰在其下），会让算法读不到自己的包；已用第 3 步的自我剔除修正，同一套件覆盖。
> ③ **Cycle 2 审计 D-1**：第 ② 步引入的自我剔除**把 `sandboxRoot` 也算进了判定对象**，
> 于是当 `sandboxRoot` 位于 `/tmp` 之下时，系统兜底 `/private/tmp` 这条 deny
> 反被判定为「会阻断沙箱自身」而**整条丢弃** —— 算法可读任意未被显式 deny 的 `/tmp` 文件
> （含其他场次的密封包）。现已把判定对象收窄为 `sandboxDir`/`work`，并让系统兜底 deny
> **永不参与过滤**。该路径由 `runner-isolation` 新增的 D-1 用例覆盖，且已做突变承重验证。

| 攻击 | 期望 | 实测 |
|---|---|---|
| 读取 Judge 源码（`PLATFORM_ROOT`） | BLOCKED | `blocked:PermissionError` |
| 读取对手密封包 | BLOCKED | `blocked:PermissionError` |
| 列出对手密封包目录 | BLOCKED | `blocked:PermissionError` |
| **读取/列出对手源包目录（`sourceDir`）** | BLOCKED | 探针未报 `LEAK` |
| **读取/列出 `artifactRoot`（含历史场次产物）** | BLOCKED | 探针未报 `LEAK` |
| **读取任意 `/tmp` 文件 / 列举 `/tmp`（`sandboxRoot` 位于 `/tmp` 下时）** | BLOCKED | 探针未报 `LEAK`；profile 中 `(deny file-read* (subpath "/private/tmp"))` 必须存在（D-1 回归） |
| 列出沙箱根目录 | BLOCKED | `blocked:PermissionError` |
| 写项目目录 | BLOCKED | `blocked:PermissionError` |
| 写 `$HOME` | BLOCKED | `blocked:PermissionError` |
| 写共享临时目录 | BLOCKED | `blocked:PermissionError` |
| `fork()` 子进程 | BLOCKED | `blocked:PermissionError` |
| `subprocess` 启动子进程 | BLOCKED | `blocked:PermissionError` |
| 真实 `connect()` 到外网 IP:port | BLOCKED | `blocked:PermissionError` |
| 跨 Round 读上一轮文件 | BLOCKED（目录已销毁） | `blocked:FileNotFoundError` |
| 跨 Round 复用 socket | BLOCKED | `blocked:PermissionError` |
| 跨 Round 留下 daemon | BLOCKED | `ps -axo command` 无标记 |
| 洪泛 stdout（5 MB） | BLOCKED | `OUTPUT_TOO_LARGE`，**返回给调用方的 stdout 被 `slice(0, 4096)` 截到 4096 字节**（上限判定用完整字节数 `MAX_STDOUT_BYTES = 256 KB`） |
| **对照**：读自己的包 | allowed | `allowed` |
| **对照**：写自己的 `work/` | allowed | `allowed` |
| **对照**：读取未被 deny 的目录 | 必须被探针捕获 | 探针报 `LEAK:outside_dir` |

进程与内存：
- 算法运行在**独立进程组**（`pgid === pid`），取消/超时后整组清理；
- 宿主侧每 60ms 轮询 RSS（Darwin 上 `RLIMIT_AS` 是空操作）；
- 宿主环境变量不继承（白名单 `PATH`/`HOME`/`TMPDIR`/`LANG`/`PYTHON*`/`GB_TEAM`），
  并扫描 `/TOKEN|SECRET|KEY|PASS|AUTH|AWS|ANTHROPIC|SSH/i` 无泄漏。

---

## 6. Fairness Evidence

`tests/timing-fairness.ts`（3 tests，可通过 `ROUNDS_ORDER` / `ROUNDS_SWAP` 环境变量放大）。
默认 **300 轮同算法对局 + 150 对换序对局**（≥ 用户要求的 100 轮；放大命令见第 8 节）。

**批次 1 —— 相同算法对相同算法，300 轮：**

```text
releaseSkewUs  median=22.584  p95=33.417  max=55.208
readySkewMs    median=248.064 p95=379.349 max=1438.031
timeDiffMs     median=-0.016  p95=0.400
medianTimeA=5.08ms  medianTimeB=5.06ms
aFasterRate=0.527          ← 同算法下"A 更快"的比例，0.5 附近
```

（以上为 **Cycle 3 修复树上**重测的数据；Cycle 1 审计看到的 0.480 属于修复前
且与同节另一处 0.510 自相矛盾的旧数据，已作废。每轮样本数 300。）

- `releaseSkewUs` 是**两次 GO 写入之间的实际间隔**（|releaseNsA − releaseNsB|，微秒），
  中位数 ~20 µs。它是**宿主交付延迟的度量**，不是任何一方的计时基准。
- `readySkewMs` 较大（中位数 ~250 ms）但**不影响计时**：双方进程先后完成 READY 握手，
  而**每一方都以自己 `release()` 返回的 GO 时刻起算**（P1-B 修复后；Cycle 1 时双方共用
  `min(releaseNs)`，后释放方被多计了这段交付延迟）。因此不要用 `readySkewMs`
  或 `releaseSkewUs` 判断计时公平性 —— 它们是诊断量，不参与判定。
- `aFasterRate` 与两侧耗时差是真正的公平性指标：同算法下应接近 0.5 / 0ms。
  `timing-fairness` 套件在有效轮数 ≥ 100 时对此做硬断言，并以一条结构性用例
  （两次 `release()` 间隔 40 ms，断言两个 GO 时刻之差被如实记录）锁死"各自起算"语义。

**批次 2 —— 同一张地图上换序配对（X=A,Y=B 与 X=B,Y=A），150 对：**

```text
X胜率(当A)=0.497   X胜率(当B)=0.510   Δ=0.013
medianTimeX(A)=14.03ms   medianTimeX(B)=14.25ms
```

同一张地图上换序，胜率差 Δ = 0.013（< 0.05），**不存在由 array order /
Promise order / runner creation order 造成的系统性胜率偏差**。

**地图生成器压力验证**（`npm run stress`，默认 300,000 张）：

```text
Requested:        300,000
Generated:        300,000
Invalid maps:     0   <-- 必须为 0
Clean failures:   0
Seed retries:     227,809
Elapsed:          5.8s
RESULT: PASS — generator 输出 0 张非法地图
```

生成失败时 `tryGenerateMap` 返回 `null`，`generateMap` 顺序尝试 `seed+1…seed+511`，
全部失败则**抛错**（绝不静默返回非法地图、绝不强制放置非法点）。

---

## 7. Regression Tests

`npm test` → `tests/run-all.ts` → **18 个套件**，各自独立进程，退出码非 0 表示失败。

```text
  ✓ dsl-contract             0.6s
  ✓ convexity-aliasing       0.5s
  ✓ official-starter         1.8s
  ✓ map-fairness             0.5s
  ✓ obstacle-block           0.5s
  ✓ dual-shooter-selection   7.8s
  ✓ shooter-cancel           9.8s
  ✓ alive-kill              13.1s
  ✓ roundstate-equality      0.7s
  ✓ full-match-e2e          19.7s
  ✓ runner-isolation         9.4s
  ✓ cross-round-cheat       10.9s
  ✓ package-tamper           3.6s
  ✓ timeout-boundary         7.1s
  ✓ process-tree-cleanup    12.2s
  ✓ hostile-input            7.6s
  ✓ timing-fairness        375.8s
  ✓ replay                  21.7s

18/18 套件通过
```

（以上为 **Cycle 3 修复树上**的全量运行记录。）

用户点名的套件与文件对应关系：

| 要求的测试名 | 文件 |
|---|---|
| `official-starter` | [tests/official-starter.ts](../../tests/official-starter.ts) |
| `dual-shooter-selection` | [tests/dual-shooter-selection.ts](../../tests/dual-shooter-selection.ts) |
| `dsl-contract` | [tests/dsl-contract.ts](../../tests/dsl-contract.ts) |
| `alive-kill` | [tests/alive-kill.ts](../../tests/alive-kill.ts) |
| `obstacle-block` | [tests/obstacle-block.ts](../../tests/obstacle-block.ts) |
| `shooter-cancel` | [tests/shooter-cancel.ts](../../tests/shooter-cancel.ts) |
| `cross-round-cheat` | [tests/cross-round-cheat.ts](../../tests/cross-round-cheat.ts) |
| `runner-isolation` | [tests/runner-isolation.ts](../../tests/runner-isolation.ts) |
| `package-tamper` | [tests/package-tamper.ts](../../tests/package-tamper.ts) |
| `timeout-boundary` | [tests/timeout-boundary.ts](../../tests/timeout-boundary.ts) |
| `process-tree-cleanup` | [tests/process-tree-cleanup.ts](../../tests/process-tree-cleanup.ts) |
| `roundstate-equality` | [tests/roundstate-equality.ts](../../tests/roundstate-equality.ts) |
| `timing-fairness` | [tests/timing-fairness.ts](../../tests/timing-fairness.ts) |
| `convexity-aliasing` | [tests/convexity-aliasing.ts](../../tests/convexity-aliasing.ts) |
| `full-match-e2e` | [tests/full-match-e2e.ts](../../tests/full-match-e2e.ts) |
| `replay` | [tests/replay.ts](../../tests/replay.ts) |
| （额外）`map-fairness` | [tests/map-fairness.ts](../../tests/map-fairness.ts) |
| （额外）`hostile-input` | [tests/hostile-input.ts](../../tests/hostile-input.ts) |

`hostile-input` 是 Cycle 2 为 P0-A 新增的套件（用户点名的 16 个套件之外），
覆盖超深 AST、巨型嵌套 JSON、诊断归因与中止前落盘；Cycle 3 追加 D-2 / D-3 用例后为 6 tests。
`runner-isolation` 在 Cycle 3 追加 D-1 用例后为 6 tests。

**每个 P0/P1 都至少保留一条常驻测试**；Cycle 3 的 D-1（P1）对应
`runner-isolation` 的「`sandboxRoot` 位于 `/tmp` 下时，任意 `/tmp` 读取仍被拒绝」，
D-2 / D-3（P3）对应 `hostile-input` 的两个用例。三者均已做**突变承重验证**：
把修复改回缺陷形态后，对应用例必须失败（否则该用例不承重）。

放大验证命令：

```bash
npm test                                   # 全部 18 套件
npm run typecheck                          # tsc --noEmit
npm run stress                             # 300,000 张地图压力验证
ROUNDS_ORDER=1000 ROUNDS_SWAP=500 npx ts-node tests/timing-fairness.ts   # 加大公平性样本
npx ts-node tests/run-all.ts dsl-contract replay hostile-input            # 只跑指定套件
```

---

## 8. Known Limitations

以下限制**如实记录**，独立审计应把它们作为已知边界，而不是当作已修复项。

1. **僵局规则缺失（规范层，最高优先级）**
   `Plan V1 §28` 未定义 stalemate。若双方算法都无法命中，比赛在规范上不终止。
   实测：朴素（不避障）算法包在 `seed=20260909 / 8v8 / easy` 下持续 **668 回合**仍无胜者；
   换用会绕障的算法后同一张地图 8 回合结束。
   **Cycle 3 复现**：另两份现场新建、**会绕障**的算法包（三次鼓包 / 抛物线鼓包）在同一张地图上
   跑到第 **790 回合**仍无胜者（`A=1 B=2`）—— 可见僵局并非只出现在"不会绕障"的算法上，
   而是剩余点位与障碍物的几何关系可能使这类**有限幅度搜索**构造不出可命中的轨迹。
   （本平台**不**对僵局做任何自动终止或判胜 —— 这正是规范缺口。）
   平台在长僵局下的行为仅限于第 4 节所述的三条
   有限声明（不误判胜负 / 每回合落盘 / 病态载荷记为 `INVALID_OUTPUT`），
   **不构成"任意输入都不崩溃"的保证**。需要 Plan 补充规则后才能实现自动终止。
   **Re-Gate 前请确认这是否属于可接受的"赛事异常需人工介入"。**

2. **`readySkewMs` / `releaseSkewUs` 都很大，但都不参与计时**
   双方 READY 握手时间差中位数 ~250 ms（进程启动/解释器冷启动差异）；
   两次 GO 写入间隔中位数 ~20 µs。
   **每一方以自己的 `release()` 时刻为计时基准**，`releaseSkewUs` 只记录宿主交付延迟。
   不要用这两个量判断计时公平性 —— 要看 `aFasterRate` 与两侧耗时差。

3. **沙箱环境存在 OS 注入变量**
   `/bin/sh` 与 macOS `/usr/bin/python3` 启动器会注入
   `PWD`/`SHLVL`/`__CF_USER_TEXT_ENCODING`/`SDKROOT`/`CPATH`/`LIBRARY_PATH`/`MANPATH`。
   测试用白名单排除这些变量，并额外断言 `HOME`/`TMPDIR`/`PATH` 以及
   `/TOKEN|SECRET|KEY|PASS|AUTH|AWS|ANTHROPIC|SSH/i` 无泄漏。
   平台**不主动传递**任何宿主环境变量。

4. **P2-18 裁判控制面不完整**
   无 `PAUSE` / `RESUME` / `END MATCH` / 倒计时显示。异常处置需操作员终止进程。
   产物**每回合落盘**（P1-A 修复后），因此中途终止时**截至上一已完成回合**的
   `match.json` / `audit.json` / `replay.json` 可读；**当前进行中的那一回合**可能尚未落盘。
   Cycle 1 时产物仅在赛末写入，中途终止会丢失全部日志 —— 该限制已消除。

5. **P2-21 动画未接线**
   `AudienceDisplay` 只有数据层。视觉/动画按用户约束推迟到 Re-Gate PASS 之后。

6. **P3-14 部分领域未覆盖**
   见第 4 节表格。特别是"病态但合法 DSL 使 Judge 卡死"没有构造性测试；
   校验采样步长固定、成本有界，目前未找到可放大的入口，但**这不等于证明不存在**。

7. **沙箱依赖 macOS `sandbox-exec`**
   当前实现面向 Darwin。`RLIMIT_AS` 在 Darwin 上是空操作，故用宿主 RSS 轮询替代。
   若部署到 Linux，需要重新验证隔离与内存限制路径。

8. **本轮的结论边界**
   本文档只声明"修复完成、可交付独立审计"。它**不是** `PASS`，也**不是**
   `COMPETITION READY`，更不构成 `v1.0.0-competition` 的授权。

---

## 9. 冻结基线

```text
Branch:         main
Baseline:       9a3e5b9  baseline: pre-remediation snapshot (Plan 1 Gate FAIL)
Cycle 1 fix:    0db2dbe09d16e386ddcdc81ca518461d6e25bc74
Cycle 2 fix:    5a7f0c3c34e42b9087c9e0a804fe86e1d04fcc21
Cycle 3 fix:    19602b4  remediation(cycle 3): fix Re-Gate Cycle 2 FAIL (D-1 P1, D-2/D-3 P3)
审计对象:       18c0562  ← Cycle 3 独立审计实际审计的冻结树
终局记录:       a312180  ← 审计报告 + 终局状态（仅文档）
目录重组:       60f920e  ← Plans/ 拆分为 Input/ 与 Output/（纯 git mv）
                + 紧随其后的路径引用更新提交（仅文档路径文本）
Working tree:   clean
```

Cycle 3 修复提交与**审计对象**之间只差文档：`git diff --stat 19602b4..18c0562` 只有
`Plans/V1 Remediation Handoff.md` 与 `Plans/Re-Gate Cycle 2 Result.md`（上一轮审计报告，
作为本轮基线的引用对象）两个文件 —— 与 Cycle 3 审计报告的实测一致。
（这两个文件现已随目录重组移至 `Plans/Output/` 下，文件名不变；上句中的路径是
**该 diff 发生时**的路径。）

**`18c0562` 之后的所有提交均未改动任何生产代码**（`a312180` 终局记录、`60f920e` 目录重组
及其后的路径引用更新，全部只涉及 `Plans/` 下的文档）。可用以下命令自证：

```bash
git diff --stat 18c0562..HEAD -- src tests starter package.json tsconfig.json   # 应为空
```

因此 Cycle 3 审计的结论对当前 HEAD 依然适用。

`git status --short` 为空即视为冻结成立。后续审计应以**当前 HEAD** 为对象，
并在开始前自行执行 `git status --short` 确认工作区未被改动。

---

## 10. 终局状态（Cycle 3 审计后 —— 流程终止）

**流程在此终止。最终状态：`V1 REMAINS NOT COMPETITION READY`。**

### 10.1 判定

| 项目 | 值 |
|---|---|
| 审计对象 | 冻结树 `18c0562`（branch `main`，工作区 clean） |
| Cycle 3 独立审计判定 | **CONDITIONAL PASS** |
| 报告 | [`Plans/Output/Re-Gate Cycle 3 Result.md`](Re-Gate%20Cycle%203%20Result.md) |
| 已用轮次 | 3 / 3（上限用尽） |

审计的独立复核结论（非本文档自述）：

- **实现层全部通过**：16 个点名套件存在且通过（18/18）、无测试后门、关键断言突变承重成立、
  D-1 / D-2 / D-3 均已修复、作弊矩阵 **16/16 BLOCKED**、压力 **300,000 张 / 0 非法**、
  正式 E2E 全链路（含停机重启回放）通过、计时公平性成立；
- **不存在**影响竞赛完整性的可利用隔离 / 判定 / 计时 / 作弊漏洞、崩溃、数据丢失或可伪造结果。

### 10.2 阻塞项（4 条，全部为纯文档失实，无代码缺陷）

| 编号 | 阻塞项 | 解除条件 |
|---|---|---|
| **E-1** | §6 / §7 的公平性放大命令用了不存在的环境变量名 `ROUNDS_ORDER` / `ROUNDS_SWAP`，按文档执行会**静默按默认 300/150 轮运行** | 改为 `GB_FAIRNESS_ROUNDS` / `GB_FAIRNESS_SWAP_ROUNDS`（可选 `GB_FAIRNESS_MIN`） |
| **E-2** | §2 Cycle 3 表 D-1 行称两个修复组件"突变任一处，用例即失败"；实测**仅**突变 `selfPaths` 时 `runner-isolation` 仍 6/6 通过（真正承重的是 `SYSTEM_DENIES` 短路） | 改写承重声明，或补一条只针对 `selfPaths` 的断言 |
| **E-3** | §2 / §4 的 P3-14 行称"数值 oracle（30 AST × 13 点 × 390 次比对）已入常驻回归"；`tests/` 中不存在该 oracle（属 Plan 1 审计探针 `x19.ts`，不在仓库） | 把 oracle 落为常驻用例，或改为"未入常驻回归" |
| **E-4** | `README.md` 第 130 / 198 行称计时"从共享 GO 时刻起算"，与实现及 §2 P1-10 / P1-19 直接矛盾 | 改为"每方以自己 `release()` 返回的 GO 时刻起算" |

另有一条非阻塞项 **O-1（P3）**：§2 P2-15 行"83 事件"与 §3"84 事件"自相矛盾（陈旧数字）。

### 10.3 本轮终止后**未**做的事（如实声明）

- 上述 E-1…E-4 **未修复**。它们全部是文档更正、不涉及代码，但**流程上限已用尽**，
  且按用户约束「只有独立 Audit Agent 才能宣布通过」，开发 Agent 不得在无审计的情况下
  自行改文档并宣称阻塞解除 —— 那正是「修完 → 手工看一次 → 认为完成」被禁止的模式。
- **未**启动第 4 轮审计（超出 3 轮上限）。
- **未**打 tag `v1.0.0-competition`（只有 `PASS — COMPETITION READY` 才允许）。

### 10.4 若后续被授权继续

解除条件已在 §10.2 逐条给出，全部为文档更正，无需改动生产代码。
完成后需要**新一轮独立审计**（新 Agent、自行设计探针）才能重新判定。

### 10.5 终局后的目录重组（与判定无关）

流程终止后，按用户要求把 `Plans/` 拆分为两个子目录：

```text
Plans/Input/    ← 人输入的 Plan、规范与任务书
Plans/Output/   ← Agent 产出的报告、工作日志与交接文档（含本文档）
```

- 移动由 `git mv` 完成（`60f920e`），**文件内容除路径引用外未作改动**；
- 本文档与其余文档中的路径引用已随之更新；
- 历史审计报告中**终端输出转录块保持原样**（记录的是当时的真实输出）；
- 全仓 `grep` 确认：**没有任何代码、测试或构建配置**引用 `Plans/` 下的文件。
- 目录与映射说明见 [`Plans/README.md`](../README.md)。

该重组**不改变** §10.1 的判定，也**不解除** E-1…E-4。
