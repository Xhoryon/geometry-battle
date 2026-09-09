# Plan 1 Gate — 工作日志

> 本轮任务：依据 `Plans/Input/Gate Plan1.md` 对 Geometry Battle V1 做只读竞赛就绪度复审。
> 本文件记录**过程**与**证据留存方式**；结论见 `Plans/Output/Plan 1 Gate Result.md`。

---

## 1. 任务与约束

来自用户指令与 Gate Plan 1 的硬约束：

- 只读审计：不修改生产代码、不重构、不优化、不新增功能、不修改规则、不改变配置以让测试「通过」、不修复发现的问题。
- 允许仅为测试生成临时文件。
- 如果发现问题：STOP / DOCUMENT / REPORT。
- 结论只能是 PASS — COMPETITION READY / CONDITIONAL PASS / FAIL。
- 严重级别：P0 Blocker / P1 Competition Critical / P2 Important / P3 Polish。
- 本轮不得修改代码来使审核结果变好；目标是得到**可信的 V1 状态结论**，不是得到 PASS。

---

## 2. 基线快照

```text
仓库:        非 git 仓库（git rev-parse 返回 fatal）
源文件:      src/*.ts 共 26 个
构建产物:    dist/ 与 src/ 1:1 对应（26/26），dist 不比 src 旧，tsc --noEmit 退出码 0
             dist/competition/MatchController.js:136 含与 src 相同的 `dsl: ''` 缺陷
运行时:      macOS 26.5.1 (Darwin 25.5.0) arm64 / Node v22.23.2 / ts-node v10.9.2 /
             Python 3.9.6 / 10 CPU / 16GB / package.json version 1.0.0
```

---

## 3. 审计方法

采用「内联侦察 + 两阶段多智能体编排 + 独立复核」的混合方式，**所有结论以实际执行证据为准**，不以代码阅读推断代替运行验证。

### 阶段 A — 内联侦察
列出仓库结构、读取 `Plans/Input/Gate Plan1.md`（1198 行，32 节）、提取 `Plan V1.rtf` 的规则文本（经 `textutil` 转换），确定 24 行 Gate Matrix 与 32 节要求的对应关系。

### 阶段 B — 14 维度并行审计（工作流 #1）
- 运行 ID：`wf_5afc43b9-7c9`
- 规模：14 个维度 agent（基线 + 13 个专项），0 错误，611 次工具调用，约 20 分钟
- 覆盖：§1/2/27/28 基线、§4 DSL、§5/6 Judge、§7/8 提交与哈希、§9 隔离、§10 跨轮状态、§11/12 公平性、§13/14 计时与超时、§15/16 顺序与消除、§17/18/19 状态机与裁判控制、§20 地图、§21 端到端、§22/23 UI 与动画、§24/25/26 日志与重启
- 产出：105 条带完整证据的发现（导出至 `/tmp/gate_findings_full.txt`，770 行）

### 阶段 C — 对抗性验证（工作流 #2）
- 运行 ID：`wf_c6b84316-156`
- 规模：16 个反驳者（C1–C16 号主张）+ 1 个覆盖度批评者
- 规则：每个反驳者被要求**尽最大努力推翻**对应主张，不确定时倾向判定「已推翻」
- 结果：见第 6 节

### 阶段 D — 独立复核（主审计员本人执行）
不依赖子智能体结论，另行编写并运行独立脚本：

| 脚本 | 验证目标 | 关键结果 |
|---|---|---|
| `x1.ts` | 官方 starter 输出合法性 | `parseDSL` → `['add 需要 2 个参数']` |
| `x2.ts` | Runner DSL 契约（对象 vs 字符串） | 对象 → `INVALID_DSL`；字符串 → `success:true` |
| `x5.ts` | 复杂度限制 + 非法输入 | 深度 13 拒绝；未知算子/非法 JSON/null 均拒绝 |
| `x7.ts` | 节点数边界 + 地图点位结构 | 127 节点/深度 7 通过；129 节点拒绝 |
| `x8.ts` | 超时边界 + 进程组回收 | `sleep(1.99)` → TIMEOUT；孙进程 PPID=1 存活 |
| `x9.ts` | **纯公开 API 全流程 E2E** | Round 0 完成，winner 恒 `draw` |
| `x10.ts` | 官方射击路径的障碍物遮挡 | 无障碍 / 矩形障碍 / 圆形障碍三种情形结果完全相同 |
| `x11.ts` | 跨轮状态持久化 | Round 2 读回 Round 1 写入的包目录文件与 /tmp 文件 |
| `x12.ts` | Runner 隔离 | 读 Judge 源码(4248B)/MatchController(14191B)/对方算法(586B)；写项目目录与 home；env 105 项含 token 类变量 |
| `x13/x14.ts` | 地图生成器不变量（C14 反驳复核） | 复现非法地图；30 万张顺序种子扫描命中 4 张非法地图 |
| `x15.ts` | `parseDSL` 深层嵌套健壮性 | 深度 10000 报 `RangeError` 并被捕获为 `valid:false`，不崩溃 |
| `x16.ts` | §5 子项（point hit / Direction / Obstacles） | single/multi/zero 与方向正确；障碍物前/后结果相同（失败） |
| `x17.ts` | §7 语法错误/运行时错误/无输出 | Runner 分别报 CRASH/CRASH/INVALID_OUTPUT；上传全部 `success:true` |
| `x18.ts` | §18 A/B 独立选择 | 绕过 P0-1 后：A 选定 → phase LOCKED → B 选择 `Invalid phase`（**P0-12**） |
| `x19.ts` | `evaluateAST` 数值 oracle 对照 | 30 条 AST × 13 个 x 点 = 390 次比对，**390/390 一致**（含 24 处 NaN 语义） |
| `x20.ts` | Runner stdout 上限 | 32 MiB 洪泛 → 宿主 heap +55.1 MiB，`result.dsl` 为 32 MiB 垃圾串（**P2-25**） |

### 阶段 E — 自查与收尾
- 按 24 行 Gate Matrix 与 32 节要求逐项核对覆盖度（第 5 节）
- 撰写 Gate Result
- 清点并删除全部测试文件（第 7 节）

---

## 4. 审计覆盖对照（24 行 Gate Matrix）

| Gate | 对应 Gate Plan 章节 | 覆盖方式 |
|---|---|---|
| DSL / AST | §4 | 工作流 #1 DSL 维度 + 独立 x5/x7 |
| C² | §4、Plan V1 规则 15 | DSL 维度（`abs(sin x)` 实测） |
| Convexity ≤100 | §4、Plan V1 规则 16 | DSL 维度（conv=102 实测、混叠清零实测） |
| Complexity | §4 | **独立 x5/x7 边界测试** |
| Collision | §5 | Judge 维度 + 独立 E2E |
| Map Generator | §20 | Map 维度（10050 次生成 + 6000 张图几何统计） |
| Algorithm Upload | §7 | Submission 维度（坏包/缺 entry/错 entry） |
| Runner Execution | §3、§13 | 基线 + Submission + Fairness 三维度交叉 |
| Runner Isolation | §9 | Isolation 维度（fs/进程/网络/环境四类探针） |
| No Cross-Round State | §10 | CrossRound 维度（文件/内存/守护/socket/TCP 七通道） |
| Equal RoundState | §11 | Fairness 维度 + 独立源码核对 |
| Simultaneous Start | §12 | Fairness 维度（N=80 顺序偏置 + 启动偏斜分布） |
| Timeout | §14 | Timing 维度 + **独立 x8 复核** |
| Shooter Cancellation | §16 | Ordering 维度 |
| 17-State Integration | §17 | StateMachine 维度（枚举 + 转移日志） |
| Human Selection | §18 | 8 个维度交叉复现 + 独立 x9 |
| Judge Control | §19 | StateMachine 维度 |
| Audience UI | §22 | UI 维度（渲染源码 + 全仓 grep） |
| Animation | §23 | UI 维度（逐帧检查 + 播放循环 grep） |
| MatchLog | §25 | Logs 维度 + 独立 x9 |
| AuditLog | §25 | Logs 维度 + 独立 x9 |
| Replay | §24 | Logs 维度 + 独立 x9 |
| Full E2E Match | §21 | E2E 维度 + **独立 x9 纯公开 API 驱动** |
| Clean Restart | §26 | Logs 维度（落盘检查 + 加载器检查） |

补充核对（不占 Gate Matrix 行，但为 Gate Plan 明文要求）：

- §3「不要只重复已有单元测试」：本轮全部证据来自新编写的探针脚本，未依赖仓库自带的 `e2e-test.ts` / `map-stress-test.ts`。
- 数值内核 oracle：`x19.ts` 用 JS 原生表达式作为独立 oracle，对 `evaluateAST` 的 30 种 AST 形态 × 13 个 x 点共 390 次求值逐一比对，**全部一致**（含 24 处 NaN 语义一致）——排除了「MatchController / StateMachine / Judge 三套引擎共享同一数值 bug 而互相印证」的盲区。
- §5 子项：Point hit 的 single/multi/zero、Direction（A 左→右 / B 右→左 / 射手后方不击杀）经 `x16.ts` 独立验证为**正确**；Obstacles 的 5 个子场景全部失败（障碍物在敌人前/后结果相同）；Numerical consistency 中「完整精度」不成立（0.1 步长采样折线 + 0.3 容差）。
- §13 计时定义：确认 `computeTimeMs` = spawn→close 全进程墙钟，含解释器启动与序列化，不含 DSL 校验。
- §22 的 14 项清单：独立运行 `src/demo-full-ui.ts`，实际只输出 `ROUND 0`、`Shooter: ???`、`0 ALIVE`、`Phase: SETUP` 与错误胜者，其余 10 项缺失。
- §23 的 9 项清单：无播放循环、无逐帧时间、hits 恒空、无障碍停止、无「Judge 先定结果再播放」的实现。
- §24/§25/§26：落盘、加载器、per-round 字段、重启污染逐项核对。
- §27 src vs dist：独立核对 26/26 对应、tsc 无错、缺陷同步存在于 dist。
- §28 文档一致性：README 的「17 阶段」「C² 校验」「Runner 隔离」三处与实现不符。
- §29 裁决标准 / §30 严重级别 / §31 报告格式 / §32 结束要求：均已遵循。

---

## 5. 自查结果

用户要求在发布前自查是否完成全部审计目标。逐项核对：

```text
[✓] 24 行 Gate Matrix 全部有证据；其中绝大多数为「实际运行」证据，
    少数（Animation 的不存在判定、Clean Restart 的「无落盘/无加载器」）
    为「全仓符号检索的否定性证据」，已在报告对应行如实标注
[✓] 32 节要求逐节映射，§3/§13/§27/§28 等不占矩阵行的要求单独核对
[✓] 每条 P0/P1 至少有 2 个独立来源（维度 agent + 主审计员独立脚本或第二维度）
[✓] 16 条关键主张全部经对抗性反驳，15 条维持、1 条被推翻并据此改判（见第 6 节）
[✓] 覆盖度批评者已运行（19 项意见），其中可影响可信度的缺口已全部处理（见第 6.3 节）
[✓] 结论格式符合 §31（Verdict / Audit Baseline / Gate Matrix / Findings /
    Full Match Evidence / Runner Fairness Evidence / Final Blocking Items / Recommendation）
[✓] 未修改任何生产代码、规则或配置（见第 7 节前后对比）
[✓] 测试文件已全部删除，仅保留 Gate Result 与本工作日志（见第 7.3 节）
```

**遗留局限（如实记录）**：

1. 本轮环境为 macOS，`/dev/shm` 不存在，故该通道在本次未能实测（CR-05 已注明在 Linux 部署下会成为额外通道）。
2. 公平性计时分布采样为 N=80（顺序偏置）与多轮启动偏斜，未达 §12 建议的 100 轮；但方向性结论（偏差随参数顺序翻转）在 N=80 下已稳定复现。
3. `Equal RoundState` 一行判定为 FAIL，依据是「A/B 输入非同一份字节」与「日志中无 per-team hash」两点可验证事实（即**不可验证**，而非实测到一次字节不一致）；若该镜像结构属有意设计，仍需补齐 hash 记录才能满足 §11 的可验证性要求。
4. 批评者指出的四类未覆盖领域已列为 P3-14：Rule 31 病态合法 DSL 的 DoS、Unicode/编码、CPU/线程配额对称性、数值边界（±1000 常数上限、`pow` 溢出、负底数非整数指数）的规则级判定。其中 `evaluateAST` 的数值正确性已补测（`x19.ts`，390/390 与 JS oracle 一致），排除了「三套引擎共享同一数值 bug」的盲区。
5. 若干 P1（P1-7 / P1-15 / P1-21）涉及从未被实例化的 `RoundStateMachine` / `Competition`，属防御纵深风险；保留原编号，但已在报告 Findings 前言中标注其性质。

---

## 6. 对抗性验证结果

16 条关键主张由独立反驳者逐一尝试推翻，规则为「尽最大努力推翻，不确定时倾向判已推翻」。

**结果：15 条维持原判，1 条被成功推翻（C14）。**

| 主张 | 内容 | 反驳结论 |
|---|---|---|
| C1 | `selectShooter` 恒失败 | 未能推翻（high） |
| C2 | Runner 拒绝对象格式 DSL | 未能推翻（high） |
| C3 | 官方 starter 输出 3 参数 `add` | 未能推翻（high） |
| C4 | `alive` 永不递减、无击杀 | 未能推翻（high） |
| C5 | 官方射击路径无遮挡检查 | 未能推翻（high） |
| C6 | 无任何隔离机制 | 未能推翻（high） |
| C7 | 跨轮复用同一包目录且从不清理 | 未能推翻（high） |
| C8 | 孙进程在 SIGKILL 后存活 | 未能推翻（high） |
| C9 | `addFrame/logRound/startLogging` 零调用 | 未能推翻（high） |
| C10 | 提交路径未强制凸性/连续性/NaN/C² | 未能推翻（high） |
| C11 | `RoundStateMachine.finishRound` 在 B 先开火时判错 | 未能推翻（high） |
| C12 | 三套状态机，无一是 17 态 | 未能推翻（high） |
| C13 | `computeTimeMs` 系统性偏向第二个队伍 | 未能推翻（high，附量化修正，见下） |
| C14 | **Map Generator 判定为 PASS** | **已推翻（high）** |
| C15 | 校验只覆盖本方半场 x 区间 | 未能推翻（high） |
| C16 | 四个编排方法为死代码 | 未能推翻（high） |

### 6.1 C14 被推翻 → Map Generator 判定由 PASS 改为 FAIL

反驳者用真实源码在 457,815 张地图（pc 6–10、三种难度）上统计到：164 对同队距离 <2.5、32 个点位落在障碍物内、30 张 `validateMap` 判定非法，全局最小同队距离 **0.00000**。给出可复现种子：

```text
seed=1248124864, pointCount=6, difficulty=easy
  teamB: [[7.462,3.1],[9.639,-9.944],[12.144,-6.963],[19.38,3.336],[10.261,1.298],[7.462,3.1]]
  B1(7.462,3.100) ~ B6(7.462,3.100) 距离 0.0000
  (10.261,1.298) 落在半径 2.386 的圆形障碍内（距离 1.071 < 2.386）
  validateMap.valid=false  errors=['B1 和 B6 过近: 0.00','点 B5 在障碍物内部']
```

**主审计员独立复核（`x13.ts` / `x14.ts`）**：

- 直接复现该种子：`pc=6 easy/medium/hard` 三档全部 `valid=false`，同队最小距离 0.0000，含「点在障碍物内部」错误。
- 顺序种子扫描 300,000 张（pc 6–10、三种难度）：命中 **4 张非法地图**（`seed=126992/208300/223544/246424`），全部为同队两点完全重合。
- 根因确认：`generateTeamPoints` 在 1000 次尝试耗尽后的强制放置分支（`if (!placed)`）不做最小距离与障碍物复检。

**结论**：§20 明文要求的「no illegal spawn / minimum point distance / no spawn inside obstacle」在合法区间内**不成立**，Map Generator 行判定改为 **FAIL**。实际比赛影响有限（`MatchController.generateMap` 会用 `validateMap` 拦下并报错，但**没有重试**，操作者需手动更换 seed），故新增发现定级为 **P2-23**。

### 6.2 C13 的量化修正

反驳者未能推翻「存在系统性偏差且偏向第二个队伍」，但对措辞提出修正：在 80 次同质近似平局中，第二个队伍胜出约 **71%**、第一个队伍胜出约 **7.5%**、平局约 **20%**。因此报告中的表述已调整为「强系统性倾向」而非「确定性保证」。

### 6.3 覆盖度批评者（19 项意见）

原工作流中负责「覆盖度批判」的 agent 因脚本 `ReferenceError: RESULT_SCHEMA is not defined` 未能运行（16 个反驳者已全部完成，0 错误）。该步骤由主审计员另行补跑独立批评者（独立上下文，可读取 Gate Plan、报告、工作日志、源码与全部探针）。

**总体结论：未发现任何可推翻 FAIL 的条目**；P0 链经其独立复跑确认。其意见按处理情况分类：

| 类别 | 意见 | 处理 |
|---|---|---|
| 内部不一致 | §8 计数「21 FAIL / 2 PASS」与报告「22 FAIL / 1 PASS」矛盾 | **已修正**（§8 早于本表更新） |
| 内部不一致 | 审计目录仍在、`src/judge/.gb_c6_probe.txt` 写入生产树 | **已记录并清理**（§7.2/§7.3） |
| 盲区 | `evaluateAST` 数值正确性从无 oracle 验证（三套引擎共享同一 `Math.*` 实现） | **已补测**：`x19.ts` 30 条 AST × 13 个 x 点 = 390 次与 JS 原生表达式逐点比对，**全部一致**（含 24 处 NaN 语义） |
| 盲区 | `Competition.determineWinner` 判据错误且未被点名 | **已核实并新增 P2-24**（`judgeX=0` 处比大小；模块从未实例化） |
| 盲区 | Runner stdout 无上限、无 `RLIMIT_NPROC` | **已实测并新增 P2-25**（`x20.ts`：32 MiB 洪泛 → 宿主 heap +55.1 MiB，失败路径回传整个 stdout 作为 `dsl`） |
| 盲区 | `ReplayFrame` 字段不足以复现比赛 | **已核实并新增 P2-26** |
| 盲区 | Rule 31 病态 DSL、Unicode、CPU/线程配额、数值边界未测 | **已列为 P3-14**（如实记录为未覆盖） |
| 严重级别 | P1-7 / P1-15 / P1-21 属死代码，级别偏高 | **已保留编号并在 Findings 前言标注其性质**（防御纵深风险） |
| 证据类型 | 报告称「24 行全部有实际执行证据」过强 | **已修正措辞**（§5 自查表 + 报告 Findings 前言 + 相关矩阵行标注） |
| 已存在 | 指出「Direction 已验证但未在 Findings 中出现」 | **不需处理**：报告 Collision 行与 §5 补充核对均已载明 |
| 无问题 | 24 行矩阵与 §31 模板 1:1 对应，无重复计数；跨进程地图确定性经其独立复跑确认 | — |

---

## 7. 文件清点与清理

### 7.1 前一个 gate agent 的遗留物

| 路径 | 状态 | 内容 | 可否删除 |
|---|---|---|---|
| `_gate-audit/` | **存在 → 已删除** | 35 个文件：9 个 `exp-*.ts` 探针脚本 + `import-test.ts` + 25 个 `pkgs/*` 测试算法包（alpha/beta/cheatX/probeA/fast/slp1900/slp2100/infinite/crash/invaliddsl/spawnerchild/faststr/slp1900str 等） | **可以删除**。已验证：生产代码、`package.json`、`tsconfig.json`（仅 `include: src/**/*`）、README、Plans 中**零引用**；所有匹配项均来自审计目录自身 |

### 7.2 本轮产生的临时文件

| 路径 | 内容 |
|---|---|
| `_gate-audit-2/` | 14 个维度各自的探针脚本与测试算法包、`CLAUDE-CROSSCHECK/`（x1–x20 独立复核脚本及 pkgs，含 x19 oracle 对照与 x20 stdout 洪泛包）、`VERIFY/`（对抗性验证 C1–C16 的复现脚本） |
| `src/judge/.gb_c6_probe.txt` | **探针写入生产目录的残留物**（内容 `WRITE_JUDGE_DIR_OK`，10:37 生成）。它本身即是 ISOL-1「Runner 可写项目目录」的物理证据；属测试残留，必须删除 |
| `/tmp/gate_findings_full.txt` | 工作流 #1 的 105 条发现完整证据（770 行） |
| `/tmp/planv1.txt`、`/tmp/dist_out.txt`、`/tmp/src_out.txt` | 规则提取与源码对照的中间产物 |
| `/tmp/xcheck_grand_*.txt` | 独立 x8 进程存活探针的标记文件 |
| 运行期遗留的孤儿进程 | 已在验证后 `pkill` 清理 |

### 7.3 清理结果

```text
保留：
  Plans/Output/Plan 1 Gate Result.md     ← 最终审计报告
  Plans/Output/Plan 1 Gate 工作日志.md    ← 本文件

删除：
  _gate-audit/                     （前一个 agent 的 35 个文件 / 164K）
  _gate-audit-2/                   （本轮的 307 个文件 / 1.3M：探针脚本与测试包）
  src/judge/.gb_c6_probe.txt       （探针写入生产目录的残留物）
  /tmp/gate_findings_full.txt
  /tmp/planv1.txt、/tmp/dist_out.txt、/tmp/src_out.txt
  /tmp/xcheck_grand_*.txt、/tmp/xr_*.json （经查已不存在）
  所有探针留下的孤儿进程（经查已无）

清理后校验：
  Plans/Output/ 仅新增 Plan 1 Gate Result.md 与 Plan 1 Gate 工作日志.md
  find src -type f -not -name "*.ts" → 空
  ps aux | grep solver.py|xcheck|crossround → 空
```

清理前已确认上述目录**不被任何生产代码、配置或文档引用**（`tsconfig.json` 的 `include` 仅为 `src/**/*`，`grep` 排除审计目录自身后无命中），因此删除不影响项目构建与运行。

### 7.4 未修改声明

本轮全程未执行任何写入生产代码的操作。清理前后 `src/`、`dist/`、`package.json`、`tsconfig.json`、`README.md`、`starter/`、`Plans/Input/Gate Plan1.md`、`Plans/Input/Plan 2 — V1 Completion Plan.md`、`Plans/Input/Plan V1.rtf` 的内容与修改时间均未变化。

---

## 8. 结论

**FAIL**（依据与完整证据见 `Plans/Output/Plan 1 Gate Result.md`）。

24 项 Gate 中：22 FAIL、1 CONDITIONAL PASS（Simultaneous Start）、1 PASS（Complexity）。
（Map Generator 原判 PASS，经 C14 反驳复核后改为 FAIL，见第 6.1 节。）

核心原因：公开 API 无法完成任何一场比赛；Runner 拒绝官方算法输出契约；命中判定无遮挡且 alive 永不递减；Runner 无隔离且跨轮状态可持久化；MatchLog/AuditLog/Replay 均未接通。
