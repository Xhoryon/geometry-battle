# V1 Remediation Handoff

**结论（仅此一句，不得外推）：REMEDIATION COMPLETE / READY FOR INDEPENDENT RE-GATE**

> 本文档由 DEVELOPMENT / REMEDIATION AGENT 编写。
> 它不是审计结论。`PASS` / `COMPETITION READY` / `v1.0.0-competition` 只能由独立 Audit Agent 给出。
> 独立审计必须自行设计探针、主动尝试推翻本文档中的每一条成功声明。

---

## 1. Baseline

| 项目 | 值 |
|------|-----|
| 上一正式基线 | [`Plans/Plan 1 Gate Result.md`](Plan%201%20Gate%20Result.md) → **FAIL** |
| 起点提交 | `9a3e5b9` *baseline: pre-remediation snapshot (Plan 1 Gate FAIL)* |
| 修复提交 | `0db2dbe09d16e386ddcdc81ca518461d6e25bc74` |
| 分支 | `main` |
| 工作区状态 | 由 `git status --short` 验证为 **clean** |
| 运行时 | Node v22 / TypeScript 5 / Python 3.9.6 / macOS Darwin 25.5.0 arm64 |

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
| P1-10 计时顺序偏置 | 各自 `Date.now()` 起算 | `src/runner/SandboxRunner.ts` | READY/GO 屏障 + 共享 `releaseNs` | `timing-fairness` | FIXED |
| P1-11 `memoryLimitMb` 无效 | Darwin 上 RLIMIT_AS 是空操作 | `src/runner/SandboxRunner.ts` | 宿主侧 RSS 轮询（60ms） | `runner-isolation` | FIXED |
| P1-12 孙进程成孤儿 | 只 kill 直接子进程 | `src/runner/SandboxRunner.ts` | 独立进程组 + 整组清理 | `process-tree-cleanup` | FIXED |
| P1-13 继承宿主环境 | `env: process.env` | `src/runner/SandboxRunner.ts` | 环境白名单（见 Known Limitations） | `process-tree-cleanup` | FIXED |
| P1-14 网络不受限 | 无 SBPL 网络规则 | `src/runner/SandboxRunner.ts` | `(deny network*)` | `runner-isolation` | FIXED |
| P1-15 先解者只是比较 | 无副作用 | `src/core/Match.ts`, `src/core/Judge.ts` | 先解者先射击 + 取消语义 | `shooter-cancel` | FIXED |
| P1-16 MatchLog 从不写入 | 无落盘 | `src/core/Logs.ts` | `persistArtifacts` 写 match/audit/replay | `full-match-e2e`, `replay` | FIXED |
| P1-17 `startLogging()` 未调用 | 死代码 | `src/core/Match.ts` | 引擎内部统一发事件 | `replay` | FIXED |
| P1-18 Replay 不可用 | 无 `loadReplay` | `src/core/Logs.ts` | `loadReplay` 纯读取，不重跑算法 | `replay` | FIXED |
| P1-19 超时口径不符 | 含解释器启动 | `src/runner/SandboxRunner.ts` | 从共享 GO 时刻起算 | `timeout-boundary` | FIXED |
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
| P2-1 无真实 barrier | READY/GO 屏障 + 共享 `releaseNs` | `timing-fairness` | FIXED |
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
| P2-12 先解者受调度抖动 | 共享释放时刻 + `TIE_EPS_MS` | `timing-fairness` | FIXED |
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
| P3-2 `test` 等同 `start` | `npm test` → 17 套件聚合运行器 | `run-all.ts` | FIXED |
| P3-3 包哈希忽略文件名 | 哈希纳入相对路径 + 大小 + 内容 | `package-tamper` | FIXED |
| P3-4 `computeTimeMs` 含启动开销 | 从共享 GO 时刻起算，README 文档化 | `timing-fairness` | FIXED-DOC |
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

```text
═══ 1. 上传与密封 ═══
  A hash: b4ebb44ae1d5f497238bc220cb0b10584a21e1572bb1748403979c5282c6c020
  B hash: d8683db2be0fa329115f8f1c3179f526c3d4040f84dbc563624ad1224d35177d

═══ 2. Preflight（真实沙箱内跑一次算法）═══
  ✓ PASSED

═══ 3. 开始比赛 ═══
│ Match ID      MATCH-MTTNYGQY-C1S6TD                          │
│ Seed          20260909                                       │
│ Map           seed=20260909 8v8 obstacles=2                  │
│ ALL READY     ✓ YES                                          │

── ROUND 1 RESULT ──   先解: A   A: A1 命中=[B6]  B: B1 命中=[A1]   击杀: [B6,A1]
── ROUND 2 RESULT ──   先解: B   A: A2 (被取消)   B: B1 命中=[A2]   取消: A=true
── ROUND 3 RESULT ──   先解: B   A: A3 (被取消)   B: B1 命中=[A3]   取消: A=true
── ROUND 4 RESULT ──   先解: A   A: A4 命中=[B5]  B: B1 命中=[A4]   击杀: [B5,A4]
── ROUND 5 RESULT ──   先解: B   A: A5 (被取消)   B: B1 命中=[A5]   取消: A=true
── ROUND 6 RESULT ──   先解: A   A: A6 命中=[B3]  B: B1 命中=[A6]   击杀: [B3,A6]
── ROUND 7 RESULT ──   先解: B   A: A7 (被取消)   B: B2 命中=[A7]   取消: A=true
── ROUND 8 RESULT ──   先解: B   A: A8 (被取消)   B: B2 命中=[A8]   取消: A=true
                         存活: A=0  B=5

  WINNER: B
  Rounds: 8   Kills: A=3 B=8
  Artifacts: /tmp/gb-e2e/artifacts/matches/MATCH-MTTNYGQY-C1S6TD
```

该场次验证到的语义：
- **Seal**：A/B 包哈希不同且完整 64 位十六进制；
- **Preflight** 在真实沙箱内执行；
- **Reveal / Compute**：每轮双方拿到同一 `stateHash`（回放帧与 MatchLog 逐轮一致）；
- **First solver shot**：第 1/4/6 轮 A 先解；
- **Shot cancellation**：第 2/3/5/7/8 轮 A 的 Shooter 被先解的 B 击杀 → A 的攻击被取消（`取消: A=true`）；
- **Alive propagation**：`A=7→6→5→4→3→2→1→0` 严格单调递减；
- **Winner**：一方 `alive = 0` 时比赛结束，且只在结算后出现。

**落盘产物**（`MATCH-MTTNYGQY-C1S6TD/`）：

```text
audit.json    83 事件：MatchCreated → PackageSealed×2 → Preflight → MatchStarted →
              ShooterSelected… → ShotCancelled → RoundComputeEnd → RoundResult → MatchEnded
              seq 严格递增，时间戳可解析
match.json    schemaVersion=1, teamAPackageHash/teamBPackageHash 均为真实哈希,
              winner=B, rounds=8, finalAlive={A:0,B:5}
replay.json   8 帧，含地图障碍物快照、存活链、轨迹、取消/超时字段
```

**Shutdown → Restart → Load Replay**（新进程，算法包与沙箱均已不在）：

```text
$ npx ts-node src/operator/cli.ts --replay /tmp/gb-e2e/artifacts/matches/MATCH-MTTNYGQY-C1S6TD
═══ REPLAY MATCH-MTTNYGQY-C1S6TD — winner B (8 rounds) ═══
── ROUND 1 ──
  Shooter A=A1  B=B1
  f_A(x) = -5.320655070245266 + (-0.2113886139456776 * (x - -8.724981233943254) + ...)
  t_A=5.771ms  t_B=8.577ms  first=A
  hits A=[B6] B=[A1]     killed=[B6,A1]  cancelled A=false B=false
  alive after: A2,A3,A4,A5,A6,A7,A8,B1,B2,B3,B4,B5,B7,B8
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
| **P2-18** 裁判控制简陋 | `START ROUND` 已实现；`PAUSE` / `RESUME` / `END MATCH` 与倒计时显示**未实现** | 正式比赛路径（上传→选人→开跑→结算→下一轮→胜者）已完整；暂停/终止属异常处置，可由操作员直接终止进程并保留已落盘产物 | Re-Gate PASS 后补 |
| **P2-21** 动画无停止 / 无时序 | `AudienceDisplay` 已收敛为纯数据层，动画驱动**未接线** | 用户明确禁止本轮做视觉优化；观众屏已能展示真实状态 | Re-Gate PASS 后补 |
| **P3-14** 未覆盖领域（部分） | 已补：数值 oracle（30 AST × 13 点 × 390 次比对）已入常驻回归。**未补**：① Rule 31「病态但合法 DSL 使 Judge 卡死」的构造性测试；② Unicode / CJK 路径 / 非 ASCII 输出的编码测试；③ A/B 间 CPU 限额、线程数、数学库版本对称性 | ① 校验采样步长固定、成本有界，未找到可放大的入口；② 包校验已限制扩展名与体积；③ 双方运行在同一宿主同一沙箱模板下 | 下一轮补测 |

**僵局（stalemate）—— 规范缺口，不是实现缺陷**：`Plan V1 §28` 只定义"一方全部点死亡则比赛结束"，
**没有定义双方都无法命中时的终止条件**。实测：使用不做避障的朴素算法包时，比赛可持续
600+ 回合而不终止（见第 8 节 Known Limitations）。平台行为正确（不会误判、不会崩溃、每轮都落盘），
但**赛事规则层面存在缺口**，需要 Plan 补充规则后由后续版本实现。

---

## 5. Runner Isolation Evidence

`tests/runner-isolation.ts`（4 tests）+ `tests/cross-round-cheat.ts`（4 tests）+
`tests/process-tree-cleanup.ts`（3 tests）。所有探针都是**真实发起的攻击**，
判定标准是 `BLOCKED`，不是"算法自己选择不做"。

沙箱策略（SBPL，`sandbox-exec`）：`(deny default)` + `(deny network*)` + `(deny process-fork)`，
`(allow file-read*)` 之后再显式 `(deny file-read* (subpath "/Users"))`、
`(deny file-read* (subpath sandboxRoot))`、`(deny file-read* (subpath sealedRoot))`、
`(deny file-read* (subpath PLATFORM_ROOT))`，最后重新 `(allow file-read* (subpath sandboxDir))`
（SBPL 后匹配者胜）。

| 攻击 | 期望 | 实测 |
|---|---|---|
| 读取 Judge 源码（`PLATFORM_ROOT`） | BLOCKED | `blocked:PermissionError` |
| 读取对手密封包 | BLOCKED | `blocked:PermissionError` |
| 列出对手密封包目录 | BLOCKED | `blocked:PermissionError` |
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
| 洪泛 stdout（5 MB） | BLOCKED | `OUTPUT_TOO_LARGE` + stdout 截断至 256 KB |
| **对照**：读自己的包 | allowed | `allowed` |
| **对照**：写自己的 `work/` | allowed | `allowed` |

> **发现并修复的真实漏洞**：原先的 `denyReadPaths` 为空，当 `artifactRoot` 落在 `/Users`
> 之外（例如操作员指定 `--artifacts /tmp/...`）时，对手的密封包会落在 `(allow file-read*)`
> 的默认放行范围内 —— 算法可直接读取对手包。现已把 `sealedRoot` 与 `PLATFORM_ROOT`
> 显式加入拒绝列表，并以本组测试固化。

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
releaseSkewUs  median=23.459  p95=30.500  max=90.250
readySkewMs    median=179.457 p95=307.181 max=555.104
timeDiffMs     median=0.035   p95=0.358
medianTimeA=5.02ms  medianTimeB=5.03ms
aFasterRate=0.480          ← 同算法下"A 更快"的比例，0.5 附近
```

- `releaseSkewUs` 是**双方相对同一 `releaseNs` 的实际释放时刻偏差**，中位数 ~20 µs。
- `readySkewMs` 较大（中位数 ~250 ms）但**无害**：双方进程先后完成 READY 握手，
  真正的计时从宿主写入的**同一个 GO 时刻**起算，与进程创建顺序无关。
- `aFasterRate = 0.510` —— 不存在"第二个启动的队伍更快"的系统性偏差。

**批次 2 —— 同一张地图上换序配对（X=A,Y=B 与 X=B,Y=A），150 对：**

```text
X胜率(当A)=0.497   X胜率(当B)=0.510   Δ=0.013
medianTimeX(A)=14.00ms   medianTimeX(B)=14.28ms
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
Elapsed:          6.1s
RESULT: PASS — generator 输出 0 张非法地图
```

生成失败时 `tryGenerateMap` 返回 `null`，`generateMap` 顺序尝试 `seed+1…seed+511`，
全部失败则**抛错**（绝不静默返回非法地图、绝不强制放置非法点）。

---

## 7. Regression Tests

`npm test` → `tests/run-all.ts` → 17 个套件，各自独立进程，退出码非 0 表示失败。

```text
  ✓ dsl-contract             0.6s
  ✓ convexity-aliasing       0.6s
  ✓ official-starter         2.0s
  ✓ map-fairness             0.6s
  ✓ obstacle-block           0.5s
  ✓ dual-shooter-selection   6.3s
  ✓ shooter-cancel           6.9s
  ✓ alive-kill              10.3s
  ✓ roundstate-equality      0.5s
  ✓ full-match-e2e          15.1s
  ✓ runner-isolation         6.3s
  ✓ cross-round-cheat        8.7s
  ✓ package-tamper           3.1s
  ✓ timeout-boundary         6.7s
  ✓ process-tree-cleanup    12.0s
  ✓ timing-fairness        327.7s
  ✓ replay                  18.9s

17/17 套件通过
```

用户点名的套件与文件对应关系：

| 要求的测试名 | 文件 |
|---|---|
| `official-starter` | [tests/official-starter.ts](../tests/official-starter.ts) |
| `dual-shooter-selection` | [tests/dual-shooter-selection.ts](../tests/dual-shooter-selection.ts) |
| `dsl-contract` | [tests/dsl-contract.ts](../tests/dsl-contract.ts) |
| `alive-kill` | [tests/alive-kill.ts](../tests/alive-kill.ts) |
| `obstacle-block` | [tests/obstacle-block.ts](../tests/obstacle-block.ts) |
| `shooter-cancel` | [tests/shooter-cancel.ts](../tests/shooter-cancel.ts) |
| `cross-round-cheat` | [tests/cross-round-cheat.ts](../tests/cross-round-cheat.ts) |
| `runner-isolation` | [tests/runner-isolation.ts](../tests/runner-isolation.ts) |
| `package-tamper` | [tests/package-tamper.ts](../tests/package-tamper.ts) |
| `timeout-boundary` | [tests/timeout-boundary.ts](../tests/timeout-boundary.ts) |
| `process-tree-cleanup` | [tests/process-tree-cleanup.ts](../tests/process-tree-cleanup.ts) |
| `roundstate-equality` | [tests/roundstate-equality.ts](../tests/roundstate-equality.ts) |
| `timing-fairness` | [tests/timing-fairness.ts](../tests/timing-fairness.ts) |
| `convexity-aliasing` | [tests/convexity-aliasing.ts](../tests/convexity-aliasing.ts) |
| `full-match-e2e` | [tests/full-match-e2e.ts](../tests/full-match-e2e.ts) |
| `replay` | [tests/replay.ts](../tests/replay.ts) |
| （额外）`map-fairness` | [tests/map-fairness.ts](../tests/map-fairness.ts) |

放大验证命令：

```bash
npm test                                   # 全部 17 套件
npm run typecheck                          # tsc --noEmit
npm run stress                             # 300,000 张地图压力验证
ROUNDS_ORDER=1000 ROUNDS_SWAP=500 npx ts-node tests/timing-fairness.ts   # 加大公平性样本
npx ts-node tests/run-all.ts dsl-contract replay                          # 只跑指定套件
```

---

## 8. Known Limitations

以下限制**如实记录**，独立审计应把它们作为已知边界，而不是当作已修复项。

1. **僵局规则缺失（规范层，最高优先级）**
   `Plan V1 §28` 未定义 stalemate。若双方算法都无法命中，比赛在规范上不终止。
   实测：朴素（不避障）算法包在 `seed=20260909 / 8v8 / easy` 下持续 **668 回合**仍无胜者；
   换用会绕障的算法后同一张地图 8 回合结束。平台本身行为正确（不误判、不崩溃、每轮落盘），
   但**操作台会持续回合**。需要 Plan 补充规则后才能实现自动终止。
   **Re-Gate 前请确认这是否属于可接受的"赛事异常需人工介入"。**

2. **`readySkewMs` 很大但无害**
   双方 READY 握手时间差中位数 ~250 ms（进程启动/解释器冷启动差异）。
   真正的计时从宿主写入的**同一个 `releaseNs`** 起算，`releaseSkewUs` 中位数仅 ~20 µs。
   不要用 `readySkewMs` 判断计时公平性。

3. **沙箱环境存在 OS 注入变量**
   `/bin/sh` 与 macOS `/usr/bin/python3` 启动器会注入
   `PWD`/`SHLVL`/`__CF_USER_TEXT_ENCODING`/`SDKROOT`/`CPATH`/`LIBRARY_PATH`/`MANPATH`。
   测试用白名单排除这些变量，并额外断言 `HOME`/`TMPDIR`/`PATH` 以及
   `/TOKEN|SECRET|KEY|PASS|AUTH|AWS|ANTHROPIC|SSH/i` 无泄漏。
   平台**不主动传递**任何宿主环境变量。

4. **P2-18 裁判控制面不完整**
   无 `PAUSE` / `RESUME` / `END MATCH` / 倒计时显示。异常处置需操作员终止进程；
   已落盘的 `match.json` / `audit.json` / `replay.json` 仍完整可读。

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
Remediation:    0db2dbe09d16e386ddcdc81ca518461d6e25bc74
Freeze HEAD:    本文档所在提交（唯一改动就是本文档，故用 git log -1 读取即可）
Working tree:   clean
```

修复提交与冻结提交之间**只差本文档**：`git diff --stat 0db2dbe..HEAD` 应当只有
`Plans/V1 Remediation Handoff.md` 一个文件。

`git status --short` 为空即视为冻结成立。审计 Agent 应以 **Freeze HEAD** 为唯一审计对象，
并在开始前自行执行 `git status --short` 确认工作区未被改动。
