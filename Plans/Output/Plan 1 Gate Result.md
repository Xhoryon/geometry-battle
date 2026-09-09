# Geometry Battle V1 Final Re-Gate

> 本报告依据 `Plans/Input/Gate Plan1.md` 第 31 节规定的格式撰写。
> 本轮为 **READ-ONLY AUDIT**：未修改任何生产代码、规则或配置。所有结论均以实际执行证据为准。

---

## Verdict

```text
FAIL
```

**理由（一句话）**：通过公开 API 无法完成哪怕一个 Round —— `selectShooter()` 恒失败、Runner 拒绝官方文档约定的算法输出格式、命中判定无遮挡检查且 alive 永不递减，同时 Runner 无任何隔离、跨 Round 状态可持久化，直接命中 Gate Plan §29 中 FAIL 的六项判据（比赛无法完成 / 明显不公平 / 可跨 Round 预计算 / Runner 相互污染 / Judge 结果错误 / Replay 无法可信复现）。

---

## Audit Baseline

```text
Branch:        N/A — 该目录不是 git 仓库（git rev-parse 返回 fatal: not a git repository）
HEAD:          N/A
Working Tree:  26 个 src/*.ts 源文件；dist/ 与 src/ 1:1 对应（26/26），
               dist 不比 src 旧，`npx tsc --noEmit` 退出码 0；
               dist/competition/MatchController.js:136 含与 src 相同的 `dsl: ''` 缺陷 —— src/dist 一致
Runtime:       macOS 26.5.1 (Darwin 25.5.0) arm64，Node v22.23.2，ts-node v10.9.2，
               Python 3.9.6，10 CPU / 16GB，package.json version 1.0.0
审计方式:      只读；仅生成临时测试文件（位于 _gate-audit-2/），审计结束后已全部删除
               （故下列各条 Reproduction 中的探针路径为历史记录，需按描述重建脚本才能重跑）
```

---

## Gate Matrix

| Gate | Result | Evidence |
|---|---|---|
| DSL / AST | **FAIL** | `parseDSL` 只校验节点数/深度，不校验 C²、连续性、NaN、凸性；`floor/ceil/round/sign/if` 可创建分段/不连续函数（DSL-2..DSL-8）。唯一可靠的是复杂度限制（见 Complexity 行） |
| C² | **FAIL** | 全代码库不存在二阶导连续性判定；`abs(sin x)` 在尖点处被判定 `valid:true`（DSL-2） |
| Convexity ≤100 | **FAIL** | 提交路径只走 `parseDSL`，从不调用 `countConvexityChanges`；`sin(20x)`（实测 conv=102）被接受（DSL-3）。采样混叠可把凸性变化数清零：`sin(125.66x)` 实测 count=0（DSL-6） |
| Complexity | **PASS** | 独立复核：127 节点/深度 7 → valid；129 节点 → `AST 节点数 129 超过限制 128`；深度 13 → `AST 深度 13 超过限制 12`；未知节点类型、非法 JSON、null 节点均被拒绝（x5.ts / x7.ts） |
| Collision | **FAIL** | 官方 `executeShots` 完全不查障碍物（J3；独立复核 `x16.ts`：障碍物在敌人**之前**与在敌人**之后**返回完全相同的 `hitsA:["B1"]`）；`isLineBlocked` 仅支持 segment/rectangle，圆形障碍永不遮挡（J5）；命中阈值 0.3 与 0.1 两套并存（J7）；校验期阈值 2.0（J10）；三套引擎结果互相矛盾（J4）。**已正确实现的部分**：point hit 的 single/multi/zero 三态与 Direction（A 左→右、B 右→左，射手后方点位不判击杀）在 `MatchController` 路径上正确（`x16.ts`）；但命中判定基于 0.1 步长采样折线而非精确曲线，不满足「Judge 使用完整精度」 |
| Map Generator | **FAIL** | 确定性、等数量、坐标范围、不崩溃均成立；但 §20 明文要求的「no illegal spawn / minimum point distance / no spawn inside obstacle」**不成立**：独立复核在 sanctioned 6–10 点区间扫描 300,000 张地图，命中 4 张非法地图（同队两点距离 0.0000），并复现出「点落在障碍物内部」的用例（P2-23）。`MatchController.generateMap` 会用 `validateMap` 拦下并返回错误（无重试），故实际比赛影响有限，但生成器自身的不变量被违反 |
| Algorithm Upload | **FAIL** | 上传不调用 `validatePackage()/parseManifest()`：坏 manifest、缺失 entry、错误 entry 均返回 `success:true` 并推进到 READY（SUB-01）；包哈希上传后从不复验，两轮之间替换磁盘算法内容仍按新内容执行且日志仍记旧哈希（SUB-02） |
| Runner Execution | **FAIL** | Runner 把 `output.dsl` 对象直接交给 `parseDSL()`（内部 `JSON.parse`），文档约定的 `{"dsl": {object}}` 一律 `INVALID_DSL`（BASELINE-P0-1）；官方 `starter/solver.py` 本身产出 3 参数 `add` 节点，永远非法（BASELINE-P0-3）；`memoryLimitMb` 声明但从未生效（ISOL-3） |
| Runner Isolation | **FAIL** | 无文件系统/网络/进程/环境隔离：可写项目目录与 home、可读 Judge 源码与对方算法包、可 DNS 解析与 TCP 外连、子进程继承全部宿主环境（含 token 类变量）（ISOL-1/4/5/6） |
| No Cross-Round State | **FAIL** | Round 2 成功读回 Round 1 写入的 cwd 文件、相对路径文件、/tmp、home、mmap、守护进程标记与 socket 回话；守护进程 PPID=1 在轮次结束后数分钟仍存活并继续服务（CR-01/CR-02、ISOL-2） |
| Equal RoundState | **FAIL** | A/B 收到的输入是镜像结构而非同一份字节：A 只见 B 的点、B 只见 A 的点，二者序列化结果不同；日志中只有 map hash（`b9f5323f8d514194`），不存在 per-team RoundState hash，§11 要求的「same RoundState hash」无法验证（FAIR-4）。**本行 FAIL 的依据是「无法验证」（无 per-team hash 可比对），而非实测到一次字节不一致** |
| Simultaneous Start | **CONDITIONAL PASS** | 代码中不存在 barrier，`executeCompute` 仅为 `Promise.all([...])`；但实测启动偏斜 median 0.004ms / p95 0.544ms / max 3.38ms，方向平衡（64/54），按 §12「不要硬判失败」的口径可接受。真正的不公平在计时口径（见 FAIR-1） |
| Timeout | **FAIL** | §14 要求「1990ms → accepted」：独立复核 sleep(1.99) 实测 `success:false, errorCode:TIMEOUT, computeTimeMs:2000`；孙进程在 SIGKILL 后以 PPID=1 存活（x8.ts）；`proc.kill('SIGKILL')` 只杀直接子进程 |
| Shooter Cancellation | **FAIL** | 官方路径无消除、无取消、无 alive 递减：A 先命中 B1 后，B 的 Runner 仍跑完并照常开火，`aliveA/aliveB` 恒为 8/8（F1、F6、J2） |
| 17-State Integration | **FAIL** | 三套互不相连的状态机（19/14/5+6 状态），没有任何一套是 17 阶段；`RoundStateMachine` 仅被 `src/index.ts` 的 demo 实例化，真实比赛走的是 `MatchPhase`（14 态，无 REVEAL）（STATE-P2-6、E2E-P1-4） |
| Human Selection | **FAIL** | 公开 API `selectShooter('A','A1')` 恒返回 `{"success":false,"error":"DSL 格式无效"}`（独立复核 x9.ts 第 5/6 步，P0-1）；在测试侧绕过该校验后进一步确认 A 选定即把 phase 置为 `LOCKED`，B 随后无法选择（`Invalid phase`，P0-12）—— 两个相互独立的阻断项 |
| Judge Control | **FAIL** | 只有 `judgeStart()`；无 NEXT ROUND / PAUSE / RESUME / END MATCH，无真实 3-2-1 倒计时（COUNTDOWN 在同一同步调用内被立即覆写为 COMPUTING）（STATE-P2-7） |
| Audience UI | **FAIL** | 全部 UI 为控制台 ASCII 文本；无 canvas/DOM/SVG/HTTP 服务；比赛场地是硬编码装饰框，不绘制真实点位/障碍/轨迹（UI-02）。证据为**实际运行** `demo-full-ui.ts`（仅输出 5 项，§22 的 14 项清单缺 9 项）+ 全仓检索的否定性结论 |
| Animation | **FAIL** | 动画层是死代码：`generateAnimationData`/`computeAnimationFrames` 无调用方，`hits` 硬编码为 `[]`，无逐帧时间戳、无播放循环、无障碍物停止（UI-04/05/06/07）。证据为**全仓符号检索的否定性结论**（未做逐帧运行） |
| MatchLog | **FAIL** | `MatchLogger.logRound()` 零调用点；实测完整流程后 `getMatchLog().rounds.length === 0`，`teamAHash/teamBHash` 为空串，`result` 硬编码 `'COMPLETE'`（LOGS-02、LOGS-08、独立复核 x9 第 14 步） |
| AuditLog | **FAIL** | 官方流程从不调用 `startLogging()`，`getMatchLog()` 返回 null、`getAuditLog()` 返回 `{}`；即使手动开启，也只有 4 类事件，缺 MatchEnd/裁判动作/平台错误/重启暂停（LOGS-03、LOGS-07、x9 第 16 步） |
| Replay | **FAIL** | `ReplayGenerator.addFrame()` 零调用点；实测 `getReplay()` 帧数 0；无落盘、无加载器（LOGS-01、E2E-P2-8、x9 第 15 步）。即使接线，`ReplayFrame` 也缺地图快照/时间戳/胜者（P2-26） |
| Full E2E Match | **FAIL** | 独立以纯公开 API 驱动完整流程（x9.ts）：第 5/6 步选择 shooter 双双失败，phase 停在 READY，`judgeStart()` 返回 false，`executeCompute()` 返回 `{success:false}`，`executeShots()` 全空，`finishRound()` 产出 round 0 的空日志，`getWinner()` 恒为 `draw`。一个 Round 都无法完成 |
| Clean Restart | **FAIL** | 无任何落盘：MatchLog/AuditLog/Replay 均只存在于内存，进程退出即丢失；无 `fromJson`/`loadReplay`，重启后无法加载上一场比赛（LOGS-09）。证据为**全仓检索的否定性结论**；「新实例状态干净」这一点未单独实测（§26 的真实缺口是无持久化） |

---

## Findings

> **对抗性验证**：16 条 P0/P1 级关键结论由 16 个独立反驳者逐一尝试推翻（规则：尽最大努力推翻，不确定时倾向判已推翻）。结果 15 条维持原判、1 条被成功推翻 —— **Map Generator 由 PASS 改为 FAIL**（见 P2-23），并据此修正了本报告与 Gate Matrix。反驳者另对 P1-10 的措辞提出量化修正（71% / 7.5% / 20%，已采纳）。
>
> **覆盖度批评**：独立批评者复查了 Gate Plan、报告、工作日志、源码与全部探针，未发现任何能推翻 FAIL 结论的条目（P0 链经其独立复跑确认）。其提出的缺口已处理：新增 P2-24（`determineWinner` 判据错误）、P2-25（stdout 无上限，实测 +55.1 MiB）、P2-26（`ReplayFrame` 字段不足）、P3-13（弱 LCG）、P3-14（未覆盖领域清单）；并补测 `evaluateAST` 数值正确性（x19.ts：390/390 与 JS oracle 一致，排除了「三套引擎共享同一数值 bug」的盲区）。批评者指出的工作日志计数不一致与遗留测试文件，已在收尾中修正与清理。
>
> **证据类型说明**：P0/P1 与 P2 的绝大多数条目基于**实际运行**（探针脚本或端到端驱动）；少数条目（如 Audience UI / Animation 的「不存在」判定、Clean Restart 的「无落盘/无加载器」）基于**全仓符号检索的否定性证据**，已在条目中如实标注。P1-7 / P1-15 / P1-21 涉及未被实例化的死代码（`RoundStateMachine`、`Competition`），属防御纵深风险而非官方路径缺陷，保留原编号但在此说明。
>
> 原始 105 条发现按主题合并为下列条目；每条末尾的括号内为原始 Finding ID，便于追溯。
> 完整原始证据（含每个维度的复现命令与输出）见工作日志 `Plans/Output/Plan 1 Gate 工作日志.md`。

### P0 — Blocker

#### P0-1 人类选择 Shooter 恒失败，Round 无法开始

- **Problem**：`MatchController.selectShooter()` 构造 `shooterInfo` 时硬编码 `dsl: ''`，随后调用 `Judge.validateShooter()`，其第一步即 `parseDSL('')` 失败，函数永远返回 `{success:false, error:'DSL 格式无效'}`。阶段因此永远停在 `READY`，无法进入 `LOCKED`。
- **Evidence**：独立复核 `x9.ts`：`[5] selectA {"success":false,"error":"DSL 格式无效"}`、`[6] selectB` 同、`[7] phase READY`、`[8] judgeStart false`。源码 `src/competition/MatchController.ts:223`（`dsl: '' // DSL will be computed`）→ `src/judge/Judge.ts` 的 `parseDSL(shooter.dsl)`。8 个独立维度（DSL/Judge/Fairness/UI/Logs/StateMachine/E2E/Submission）分别以各自脚本复现同一结果。
- **Impact**：正式比赛的主流程在第一步即断裂；后续 COMPUTE / SHOT / ROUND_RESULT / MATCH_END 全部不可达。这是整个 V1 的中心阻断项。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x9.ts`（或任何构造 `new MatchController` → `uploadTeamA/B` → `generateMap` → `selectShooter` 的脚本）。
- **Recommended remediation**：选择阶段只校验「该点位存在且合法」（在己方 x 区间、非死亡点、不在障碍物内），不得校验尚不存在的 DSL；把函数合法性校验推迟到算法产出 DSL 之后的 COMPUTE/Judge 阶段。
- *（BASELINE-P0-2、DSL-1、F3、FAIR-2、J1、UI-01、STATE-P0-1、E2E-P0-1、LOGS-05、SUB-04）*

#### P0-2 Runner 拒绝文档约定的算法输出格式

- **Problem**：`AlgorithmRunner` 取出 `output.dsl` 后直接传给 `parseDSL(dsl)`，而 `parseDSL` 对入参执行 `JSON.parse`。README、`starter/solver.py` 与既有示例全部输出 `{"dsl": <object>}`，于是被强制转成字符串 `"[object Object]"` 并解析失败。只有「双重编码」（`{"dsl": "<json 字符串>"}`）才能成功，而该写法未见于任何文档。
- **Evidence**：对照实验 `x2.ts`：`pkgs/objfmt`（dsl 为对象）→ `{success:false, errorCode:'INVALID_DSL', error:"DSL 解析失败: SyntaxError: \"[object Object]\" is not valid JSON"}`；`pkgs/strfmt`（dsl 为字符串）→ `{success:true}`。源码 `src/runner/AlgorithmRunner.ts:130`（`const dsl = output.dsl || ...`）与 `:144`（`parseDSL(dsl)`，无 `JSON.stringify`）。
- **Impact**：任何按官方文档实现的算法永远被判 `INVALID_DSL`，双方均无有效输出，Round 无法产生命中与胜负。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x2.ts`。
- **Recommended remediation**：确定唯一契约并在三处对齐（runner / starter / README）：要么 runner 对对象入参执行 `JSON.stringify` 后再 `parseDSL`，要么明确要求算法输出 JSON 字符串并修正 starter；同时补一条「真实跑通 starter」的集成测试。
- *（BASELINE-P0-1、SUB-03、F5、FAIR-3、CR-04、LOGS-04、E2E-P0-2、STATE-P1-3）*

#### P0-3 官方 starter 算法本身非法

- **Problem**：`starter/solver.py` 构造的 `add` 节点带 **3 个参数**，而 `parseDSL` 要求二元运算符恰好 2 个参数。
- **Evidence**：`x1.ts`：直接执行 `python3 starter/solver.py` 得到该 AST，再 `parseDSL(JSON.stringify(dsl))` → `{valid:false, errors:['add 需要 2 个参数']}`。
- **Impact**：即使 P0-2 的契约问题修复，参考算法依然无法通过 Runner，团队按「快速上手」文档操作会直接得到非法函数。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x1.ts`。
- **Recommended remediation**：把表达式改为全二元嵌套（如 `add(add(0.1*x, 0.5*sin(0.3*x)), base_y)`），并加入「starter 必须通过 preflight」的测试。
- *（BASELINE-P0-3）*

#### P0-4 比赛永远无法结束：alive 永不递减、无击杀

- **Problem**：`executeShots()` 只填 `hitsA/hitsB`，从不递减 `aliveA/aliveB`；`killedA/killedB` 始终为空数组；`finishRound()` 的 `aliveA<=0 || aliveB<=0` 判断永不为真，`getWinner()` 恒返回 `draw`。
- **Evidence**：独立复核 `x9.ts` 第 17 步：完成一轮流程后 `alive 8 8`，`getWinner()` 为 `draw`。`grep` 显示 `aliveA/aliveB` 仅在 `MatchController.ts:190-191`（`generateMap`）被赋值，`killedA/killedB` 只在 344/345/390 行被置空。
- **Impact**：胜负模型（一方存活数归零 → 获胜）不可达，比赛无法收束；Audience UI 的 `getMatchResult()` 永远为 null。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x9.ts`，观察第 17 步。
- **Recommended remediation**：在 `executeShots()` 中按命中（且未被障碍物遮挡）递减被命中方存活数并记录被淘汰点位，`finishRound()/getWinner()` 改读更新后的存活数。
- *（J2、E2E-P0-3、STATE-P0-2、LOGS-06）*

#### P0-5 上传阶段没有任何包校验

- **Problem**：`uploadTeamA/uploadTeamB` 只对目录做 SHA-256 计算，从不调用 `validatePackage()` 或 `parseManifest()`，也不从 manifest 读取 entry（entry 由调用方单独传入）。非法包被标记为上传成功并推进到 READY，错误直到比赛中途才暴露。
- **Evidence**：SUB-01：坏 manifest → `success:true`（而 `validatePackage` 本身能正确报 `manifest.json 解析失败`）；缺 entry 文件 → `success:true`；错误 entry → `success:true` 且随后 compute 以 exit code 2 崩溃。**独立复核 `x17.ts`**：Python 语法错误包、运行时抛异常包、无输出包三者 `uploadTeamA` 全部返回 `success:true, errors=[]`（执行期才分别报 `CRASH` / `CRASH` / `INVALID_OUTPUT`）。`grep` 显示 `validatePackage/parseManifest` 在比赛流程中零调用点。
- **Impact**：Gate Plan §7 要求的 Package 校验 / Entrypoint 校验 / Preflight 在正式流程中不存在，`generateMap()` 一被调用就把阶段置为 READY。
- **Reproduction**：`npx ts-node _gate-audit-2/SUBMISSION/upload-test.ts`、`wrong-entry-test.ts`。
- **Recommended remediation**：上传时执行 `validatePackage()+parseManifest()`，entry 只从 `manifest.entry` 读取并校验文件存在，全部通过后才计算哈希与推进阶段。
- *（SUB-01、E2E-P2-9）*

#### P0-6 包哈希从不复验，算法可在比赛中被替换

- **Problem**：哈希只在后台上传时计算一次，执行前从不重算或比对，执行体与记录哈希之间没有绑定。
- **Evidence**：SUB-02：上传后哈希 `f380610926163330`；在两轮之间把磁盘上的 `solver.py` 换成 `999*x+123`；Round 2 实际执行了新内容（`round2 ran REPLACED content => true`），当前包哈希变为 `d6234c8bae06e229`，而 `MatchLog.teamAHash` 仍是旧的 `f380610926163330`。
- **Impact**：直接回答 Gate Plan §8 的提问 —— 「比赛开始后能否在不重新验证的情况下替换算法」= **能**。无防篡改能力，日志反而为替换前的「干净」哈希背书。
- **Reproduction**：`npx ts-node _gate-audit-2/SUBMISSION/hash-replace3.ts`。
- **Recommended remediation**：校验时固定内容哈希并在每轮执行前重算比对；或把已校验的包复制到密封只读沙箱目录后再执行；不一致则拒绝该轮并记篡改事件。
- *（SUB-02）*

#### P0-7 Runner 无任何文件系统隔离

- **Problem**：子进程以宿主身份、`cwd=packagePath` 运行，可读写项目目录、home、/tmp，并读取 Judge 源码、MatchController、MapGenerator 与对方算法包。
- **Evidence**：ISOL-1 `probe-fs`：`write_project_dir=/Users/jiayihuang/Downloads/几何斗殴/WRITTEN_BY_ALGO.txt`、`write_home OK`、`read_judge_src READ_OK len=4248`、`read other team starter solver READ_OK len=1202`。CR-03 进一步证明 A 可写 B 的包目录、B 可写 A 的包目录。**独立复核 `x12.ts`**：`judge_src read=true len=4248`、`match_controller read=true len=14191`、`other_team_solver read=true len=586`、`write_project=true`、`write_home=true`、`env_count=105`。
- **Impact**：使「跨 Round 预计算」与「读取对方算法 / 逆向 Judge 规则」成为可行；包哈希完整性在运行期形同虚设。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x12.ts`（或 `_gate-audit-2/ISOLATION/driver.ts`）。
- **Recommended remediation**：每次执行为算法建立真实边界（容器 / chroot / macOS sandbox-exec），cwd 指向只读快照 + 可写临时目录，屏蔽项目树与对方包。
- *（ISOL-1、CR-03）*

#### P0-8 跨 Round 状态可持久化

- **Problem**：同一算法包目录被所有轮次复用为 cwd 且从不清理，/tmp、home、mmap、socket、守护进程均可跨轮携带状态。
- **Evidence**：CR-01：Round 2 成功读回 `cwd_file='round1_cwd'`、`rel_file='round1_rel'`、`/tmp='round1_tmp'`、`home_file='round1_home'`、`mmap='round1_mmap'`、`daemon_marker='daemon_wrote_round1'`、`socket_readback='HELLO_FROM_ROUND1'`；CR-02 守护进程 PPID=1 存活 2.5–3 分钟并继续服务；ISOL-2 读回 `{"round":1,"from":"TEAM_A","attack_secret":"choose_this_next_round"}`。**独立复核 `x11.ts`**：Round 2 读回 `{包目录/xr_state.json: {"round":1}, /tmp/xr_state.json: {"round":1}}`，Round 3 读回 `{"round":2}`。
- **Impact**：地图（障碍物 + 敌我点位）在全部轮次间保持不变，算法可在 Round 1 做重计算并把结果缓存下来供后续轮次复用 —— 这正是 §10 要禁止的「预处理」。属于比赛完整性问题，而非单纯的沙箱不足。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x11.ts`（或 `_gate-audit-2/CROSSROUND/test_crossround.ts`、`test_net.ts`）。
- **Recommended remediation**：每轮把 manifest+solver 复制进一次性目录作为 cwd 并在轮末删除（或使用 overlayfs/容器丢弃写层），同时清理 /tmp 与进程树。
- *（ISOL-2、CR-01、CR-02）*

#### P0-9 官方命中判定完全不考虑障碍物遮挡

- **Problem**：`MatchController.executeShots()` 只用 `pointOnTrajectory(trajectory, point, 0.3)` 做距离判定，从不引用 `config.map.obstacles`。
- **Evidence**：J3：构造 A(-14,0)、B(4,0)，矩形障碍 `x[0,8] y[-1,1]` 正好横在两者之间，A 的函数 `f=0`，`executeShots()` 仍返回 `hitsA ["B1"]`。`grep` 确认 331–410 行无任何 obstacle 引用。**独立复核 `x10.ts`**：无障碍、矩形障碍、圆形障碍（圆心 (2,0) 半径 3）三种情形下 `executeShots()` 返回完全相同 —— `{"hitsA":["B1"],"hitsB":["A1"],"winner":"A"}`。
- **Impact**：Gate Plan §5 的 Obstacles 判据不成立 —— 障碍物对官方流程的结果没有任何影响，「躲在障碍物后面的敌人存活」被违反。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x10.ts`（或 `_gate-audit-2/JUDGE/ts-match-controller-shots.ts`）。
- **Recommended remediation**：在 `executeShots()` 中加入「射手→敌人」线段与全部障碍物类型的遮挡判定，并按传播顺序在首次相交处截断轨迹。
- *（J3）*

#### P0-10 核心比赛流水线是死代码

- **Problem**：`executeCompute / executeShots / finishRound / startLogging` 在 `src/` 中没有任何调用点；随仓库交付的入口只演示模块与渲染状态。
- **Evidence**：F4：`grep -rniE '\.executeShots\(|\.executeCompute\(|\.finishRound\(|\.startLogging\(' src/` 只返回定义本身；唯一真实调用是 `demo-full-ui.ts` 的 `getMatchLog()` 与 `AudienceScreenUI.ts` 的 `getWinner()`。
- **Impact**：即使修复了上述缺陷，交付物中也不存在能跑完整场比赛的入口；§17/§21 的 E2E 无从谈起。
- **Reproduction**：`grep` 全仓。
- **Recommended remediation**：提供真正的端到端驱动器（或 CLI/操作台），串联 `startLogging → generateMap → selectShooter → judgeStart → executeCompute → executeShots → finishRound → getMatchLog`。
- *（F4）*

#### P0-11 Shooter 消除与射击取消未实现

- **Problem**：先解出的 A 命中 B 的 shooter 后，B 的 Runner 不被终止、B 的射击不被取消、被击杀点位不被移除。
- **Evidence**：F1：`alpha_killer(123ms)` 命中 B1+B3 后，`beta_victim(428ms)` 仍产出 `hitsB==[A1]`，`Promise.all` 总耗时 429ms（B 跑完）；`aliveA/aliveB` 从不递减。F6：`RoundStateMachine.executeShot` 的 `shooterEliminated/shotCancelled` 分支因无任何代码把 `shooterId` 置 null 而不可达。
- **Impact**：Gate Plan §16 的「B SHOOTER ELIMINATED / B SHOT CANCELLED / 终止 B Runner」全部无法发生，比赛无法通过淘汰取胜。
- **Reproduction**：`npx ts-node _gate-audit-2/ORDERING/ordering-audit.ts` SECTION 2。
- **Recommended remediation**：把 `Promise.all` 改为有序流程：首个解到达并完成射击结算后，终止第二个 Runner 进程组、取消其射击、递减被击杀方存活数并写入 RoundLog。
- *（F1、F6）*

#### P0-12 A 队选择 Shooter 后阶段直接变为 LOCKED，B 队无法再选择

- **Problem**：`selectShooter()` 在任意一队选择成功后无条件把 `phase` 置为 `LOCKED`（`MatchController.ts:238`），而该方法的入口守卫只允许 `READY` 或 `SELECT_SHOOTER`（`:203`）。因此 A 选择成功后，B 的 `selectShooter` 一律返回 `'Invalid phase'`。这是与 P0-1 **相互独立**的第二个阻断项：即使 P0-1 被修复，比赛仍无法进行。
- **Evidence**：在测试侧临时替换 `Judge.validateShooter`（**仅测试进程内的模块属性，未修改任何源码文件**）绕过 P0-1 后真实驱动：`select A1 → {success:true} → phase LOCKED`；`select B1 → {success:false, error:"Invalid phase"} → phase LOCKED`。同时确认「Lock 后不可修改」成立：`select A2 → {success:false, error:"Invalid phase"}`。脚本：`x18.ts`。
- **Impact**：§18 的「A/B 独立」不成立；双方各自选择 Shooter 的流程在实现上互斥。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x18.ts`。
- **Recommended remediation**：选择成功后应先进入一个「一方已选、等待另一方」的中间态（如 `SELECT_SHOOTER`，该枚举值当前已声明但从未被赋值），待双方都选定后才置 `LOCKED`。

### P1 — Competition Critical

#### P1-1 宣称的 C² 连续性校验并不存在

- **Problem**：`checkContinuity` 只对非有限值/NaN 报错，不存在二阶导连续性判定；`abs`、`floor`、`ceil`、`round`、`sign`、`if` 等可创建尖点/分段函数。
- **Evidence**：DSL-2：`abs(sin x)` 在 `x=-14` 处（尖点）经 `validateShooter` 返回 `valid:true`。全仓 `grep 'c2|二阶|second der|C²'` 无实现。
- **Impact**：违反 Plan V1 规则 15；带尖角的轨迹被接受。
- **Reproduction**：`validateShooter({dsl:'{"type":"abs",...}'})`。
- **Recommended remediation**：实现真正的 C² 判定（高阶有限差分或解析禁止非 C² 算子），或把文档中的「C²」改为如实描述。

#### P1-2 凸性 ≤100 在提交路径上未被执行

- **Problem**：提交路径只调用 `parseDSL`，而 `parseDSL` 从不调用 `countConvexityChanges`。
- **Evidence**：DSL-3：`sin(20x)` 经 Runner 返回 `success:true`、`parseDSL.valid=true`、实测 conv=102，仍被 `executeCompute` 接受并可命中。
- **Impact**：高振荡非法函数可当作合法射击参与比赛。
- **Reproduction**：`runAlgorithm(pkg/badconv,'solver.py',rs)` 后检查凸性计数。
- **Recommended remediation**：在 compute/shot 路径上对算法输出的 DSL 调用 `FunctionGraph.validate`。

#### P1-3 NaN / Infinity 未被拒绝

- **Problem**：`parseDSL` 从不求值 AST，`sqrt(-1)`、`div(1,0)`、`log(x<0)` 均判定合法。
- **Evidence**：DSL-4：三例 `parseDSL.valid=true`；`nanfn` 经 Runner 亦 `success:true`。
- **Impact**：在定义域上无定义的函数被接受，轨迹静默为空而非判为 INVALID SHOT。
- **Reproduction**：`parseDSL('{"type":"sqrt","args":[{"type":"number","value":-1}]}').valid === true`。
- **Recommended remediation**：在提交路径按队伍 x 区间采样求值，出现非有限值即拒绝。

#### P1-4 连续性检查无法发现跳变

- **Problem**：`floor/ceil/round/sign` 在每个采样点都是有限值，因此被判定为连续。
- **Evidence**：DSL-5：`floor(x)` 经 `checkContinuity` 返回 `{continuous:true, issues:[]}`。
- **Impact**：阶跃/斜坡函数被当作连续函数使用。
- **Reproduction**：`checkContinuity(parseDSL('{"type":"floor",...}').ast, -20, -4, 0.01)`。
- **Recommended remediation**：检测单侧极限的跳变，而非只检测非有限值。

#### P1-5 采样混叠可把凸性变化数清零

- **Problem**：`countConvexityChanges` 使用固定步长 0.05，频率与之对齐的高频振荡会被采成「无凸性变化」。
- **Evidence**：DSL-6：`sin(125.66x)`（ω=2π/0.05）实测 `count=0`、`checkContinuity=true`、`parseDSL.valid=true`、`validateShooter.valid=true`；真实函数凸性变化数为数百。
- **Impact**：非法高复杂度函数可被「洗白」为合法低凸性函数，≤100 规则被绕过。
- **Reproduction**：`countConvexityChanges(ast,-20,-4,0.05).count === 0`。
- **Recommended remediation**：改用自适应/随机化采样或解析二阶导判定。

#### P1-6 不存在单一权威 Judge，三套引擎互相矛盾

- **Problem**：同一 DSL + 地图 + 障碍物被三套独立实现解释，结果互斥；`parseDSL` 在 7 个生产点被独立调用，没有共享的 canonical AST。
- **Evidence**：J4：同一场景（`f=0`、B 在 (4,0)、矩形障碍 [0,8]）下 `determineWinner='B'`、`RoundStateMachine='hit=false'`、`MatchController='hitsA=[B1]'`。
- **Impact**：违反 §6；Replay/审计与 UI 可能读到与判定不一致的结果。
- **Reproduction**：`npx ts-node _gate-audit-2/JUDGE/ts-canonical-dataflow.ts`。
- **Recommended remediation**：收敛为单一裁决模块，其余消费其记录结果而非各自重算。

#### P1-7 圆形/多边形障碍永不遮挡

- **Problem**：`isLineBlocked` 只处理 segment 与 rectangle。
- **Evidence**：J5：圆形障碍（圆心 [2,0]、半径 3）横在 shooter(-14,0) 与 enemy(4,0) 之间，`executeShot` 仍返回 `hit=true kill=true`；而 `MapGenerator` 按 50% 概率生成圆形障碍。
- **Impact**：约一半的生成障碍无法阻挡射击，碰撞语义随地图随机变化。
- **Reproduction**：`npx ts-node _gate-audit-2/JUDGE/ts-statmachine-occlusion.ts`。
- **Recommended remediation**：扩展到全部障碍物类型。

#### P1-8 MatchLog 击杀归属颠倒

- **Problem**：`aKills` 被赋值为 `hitsB.length`、`bKills` 被赋值为 `hitsA.length`，而 `hitsA` 是 A 打中的 B 方点位（即 A 的战果）。
- **Evidence**：J6 / UI-09：A 的轨迹命中 B1 后，日志为 `aKills 0 bKills 1 aHits ["B1"] bHits []`；源码 `MatchController.ts:428-429`。
- **Impact**：日志、回放与观众端击杀数全部反向。
- **Reproduction**：构造 A 命中 B1 的一轮后读取 RoundLog。
- **Recommended remediation**：改为 `aKills=hitsA.length`、`bKills=hitsB.length`。

#### P1-9 命中容差是玩法半径而非数值误差 epsilon

- **Problem**：0.3（MatchController）与 0.1（StateMachine）是决定击杀的碰撞阈值，而校验期的避障阈值是 2.0，三者语义不一致。
- **Evidence**：J7：距曲线 0.2 与 0.29 判命中、0.31 判未命中；StateMachine 中 dy=0.05 命中、dy=0.15 未命中；校验期 `isOnObstacle` 阈值 2。
- **Impact**：结果取决于走哪条路径，与「容差仅用于数值误差」的规则不符。
- **Reproduction**：调整半径 0.1/0.3 观察命中翻转。
- **Recommended remediation**：定义唯一的、有文档的命中 epsilon，并区分「浮点误差容差」与「玩法命中半径」。

#### P1-10 计时口径存在系统性顺序偏差，稳定偏向第二个启动的队伍

- **Problem**：`computeTimeMs` 的 `startTime` 在同步前段（构建 inputJson、pyEnv）之前捕获，且 A 总在 `Promise.all` 数组的第一位，导致 A 的起点比 B 早约 1ms，B 的 `computeTimeMs` 系统性偏小。`Date.now()` 只有 1ms 分辨率。
- **Evidence**：FAIR-1 `order-bias.ts`（N=80，同一份平凡算法，仅交换 `Promise.all` 参数顺序）：顺序 [A,B] → `meanA-meanB=+0.763ms`；顺序 [B,A] → `-0.637ms`，胜者标签随之翻转。对抗性复核进一步量化：同质近似平局中**第二个被调用的队伍胜出约 71%**、第一队胜出约 7.5%、平局约 20% —— 是强系统性倾向而非 100% 确定性。
- **Impact**：在真实计算时间接近时，「先解者」由进程调度顺序而非算法速度决定 —— 正是 §12/§15 要排除的不公平。
- **Reproduction**：`npx ts-node _gate-audit-2/FAIRNESS/order-bias.ts`。
- **Recommended remediation**：用 `process.hrtime.bigint()/performance.now()` 在启动两者之前捕获统一时间基准，或由算法侧回传首个时间戳；在容差内采用确定性 tie-break。

#### P1-11 `memoryLimitMb` 从未生效

- **Problem**：`RunnerConfig.memoryLimitMb` 已声明但没有任何 rlimit/cgroup/prlimit 调用。
- **Evidence**：ISOL-3 `probe-mem`：子进程实测 `RLIMIT_AS=[9223372036854775807,9223372036854775807]`（无限制），RLIMIT_CPU/DATA/RSS/FSIZE 同样无限制。
- **Impact**：内存失控的算法可耗尽宿主内存并拖垮对方进程，宣称的 512MB 限制不提供任何保护。
- **Reproduction**：在 Runner 下运行 `probe-mem`。
- **Recommended remediation**：在 spawn 前设置 `RLIMIT_AS/RLIMIT_DATA`，并设置 `RLIMIT_CPU/RLIMIT_NPROC`。

#### P1-12 只杀直接子进程，孙进程成为孤儿

- **Problem**：`proc.kill('SIGKILL')` 作用于直接子进程 PID，不作用于进程组。
- **Evidence**：独立复核 `x8.ts`：超时后 `ps -o pid,ppid,stat -p 52479` 显示 `PPID=1, STAT=Ss`，且仍在写文件；T-01 与 CR-02 记录了同一现象并确认守护进程存活数分钟。`grep` 显示全仓只有 `AlgorithmRunner.ts:90` 一处 kill，`destroyRunner()` 从未被调用。
- **Impact**：算法可留下后台守护进程跨轮携带状态并持续占用资源，违反 §10 与 §14。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x8.ts`。
- **Recommended remediation**：以 `detached:true` 启动并按进程组 `kill(-pid)`；轮末遍历并回收全部后代。

#### P1-13 子进程继承完整宿主环境，含敏感凭据

- **Problem**：`env: { ...process.env, ... }` 把宿主全部环境变量交给算法。
- **Evidence**：ISOL-5 `probe-env`：`VAR_COUNT=109`，其中含 `ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_MESSAGING_TOKEN`、`SSH_AUTH_SOCK` 以及人为注入的 `GB_SECRET_PASSWORD / GB_HIDDEN_FLAG / GB_INTERNAL_MATCH_PATH`。
- **Impact**：算法可读取操作者凭据、使用 SSH agent，并结合网络访问外泄。
- **Reproduction**：`probe-env` → 读 `/tmp/gb_env_report.json`。
- **Recommended remediation**：不传递 `process.env`，改为最小白名单环境（仅解释器所需 PATH 与一次性 TMPDIR）。

#### P1-14 子进程网络不受限制

- **Problem**：无 egress 管控。
- **Evidence**：ISOL-6 `probe-net`：`dns_8.8.8.8 RESOLVED`、`dns_example.com RESOLVED 172.66.147.243`、`tcp_8.8.8.8:53 CONNECT_OK`、`tcp_example.com:80 CONNECT_OK`。
- **Impact**：可外泄读取到的内容、进行队间串通或把计算卸载到远程服务器。
- **Reproduction**：`probe-net` → 读 `/tmp/gb_net_report.json`。
- **Recommended remediation**：按轮隔离网络命名空间或按 cgroup/uid 拒绝 OUTPUT。

#### P1-15 「先解者优先」只是无副作用的比较

- **Problem**：`executeShots()` 在比较 `computeTimeMs` 得出局部 `winner` 之前，已经把两条轨迹的命中都算完了，且 `winner` 从不被 `finishRound/getWinner` 使用。
- **Evidence**：F2：`winner` 随耗时翻转（A=139/B=337 → A；A=329/B=127 → B），但两次射击始终都被执行，先解不带来任何优势。
- **Impact**：§15 的机制在代码中不存在，速度对胜负没有影响。
- **Reproduction**：`npx ts-node _gate-audit-2/ORDERING/ordering-audit.ts` SECTION 1。
- **Recommended remediation**：实现真正的先手优先级（先结算先解方轨迹，若淘汰对方 shooter 则取消对方射击），或明确改用别的回合裁决规则并删除误导性比较。

#### P1-16 MatchLog 从不被写入

- **Problem**：`finishRound()` 把 RoundLog 推入 `this.state.roundLogs`，从不调用 `logger.logRound()`。
- **Evidence**：LOGS-02 / BASELINE-P1-1：完整流程后 `getMatchLog().rounds.length === 0`；`grep` 显示 `logRound()` 零调用点。独立复核 `x9.ts` 第 14 步同样为 `rounds: 0`。
- **Impact**：§25 要求的 state hash、shooters、函数哈希、耗时、命中、取消、超时/非法、结果全部缺失。
- **Reproduction**：`npx ts-node _gate-audit-2/LOGS/audit-logs.ts`。
- **Recommended remediation**：在 `finishRound()` 中同时调用 `this.logger?.logRound(log)`，并保证每轮开始前已 `startLogging()`。

#### P1-17 `startLogging()` 在官方流程中从不被调用

- **Problem**：`MatchController.logger` 与 `.audit` 因此恒为 null，所有 `this.audit?.log(...)` 都是空操作。
- **Evidence**：LOGS-03：`getMatchLog()=>null`、`getAuditLog()=>{}`；`startLogging` 定义于 `MatchController.ts:477` 且零调用点；`demo-full-ui.ts` 自建了一个 `MatchLogger` 但从不调用 `match.startLogging()`。
- **Impact**：官方流程既不产生 MatchLog 也不产生审计轨迹。
- **Reproduction**：`npx ts-node _gate-audit-2/LOGS/audit-logs.ts` TEST1。
- **Recommended remediation**：在比赛初始化（matchId 已知、上传之前）调用 `startLogging()`。

#### P1-18 Replay 完全不可用

- **Problem**：`ReplayGenerator.addFrame()` 零调用点，无落盘、无加载器。
- **Evidence**：LOGS-01：完整比赛后 `getReplay()` 为 `{"frames":[]}`；`grep` 确认无调用点；`ReplayGenerator` 仅有 `constructor/addFrame/getFrames/toJson`。独立复核 `x9.ts` 第 15 步：`frames 0`。
- **Impact**：§24 失败 —— 既无法生成回放，也无法保存与重启后加载。
- **Reproduction**：`npx ts-node _gate-audit-2/LOGS/audit-logs.ts`。
- **Recommended remediation**：每轮写入 ReplayFrame，并补充 `fromJson/toFile/loadReplay` 与落盘时机。

#### P1-19 超时预算与 §14 的判定口径不符

- **Problem**：`computeTimeMs` 覆盖「spawn → 解释器启动 → 运行 → close」的全过程，因此真实的算法工作窗口小于 2000ms；§14 要求「1990ms 结果 → accepted」不成立。
- **Evidence**：独立复核 `x8.ts`：`sleep(1.99)` → `success:false, errorCode:TIMEOUT, computeTimeMs:2000, wall=2003`。T-03 `boundary_repeat.ts`：solve=1950ms 成功（compute≈1997），solve=1990ms 超时（harness wallMs=2002–2004）；无操作基线耗时 17–40ms。
- **Impact**：边界解释与日志口径会误导团队与裁判；「1990ms 应被接受」的规则无法兑现。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x8.ts`。
- **Recommended remediation**：明确并文档化「总进程墙钟」预算，或在解释器就绪后起表；超时报告应使用真实测量值而非固定 `config.timeoutMs`。

#### P1-20 17 阶段状态机未接入真实比赛

- **Problem**：`MatchController` 走自己的 `MatchPhase`（无 REVEAL），`RoundStateMachine` 仅被 demo 实例化。
- **Evidence**：E2E-P1-4：`grep` 显示 `RoundStateMachine` 只在 `src/index.ts:95` 出现；`getPhase()` 返回值来自 `MatchPhase`。STATE-P2-6：三套状态机分别有 19/14/5+6 个状态，没有一套是 17。
- **Impact**：§17 的集成要求与操作者期望的「START ROUND / Reveal / NEXT ROUND」序列不存在。
- **Reproduction**：`npx ts-node _gate-audit-2/STATE/enumerate_states.ts`。
- **Recommended remediation**：确定唯一的 17 阶段权威状态机并让真实比赛走它，或补齐 REVEAL 与手动 NEXT_ROUND 门。

#### P1-21 `RoundStateMachine.finishRound()` 在 B 先开火时判错胜者

- **Problem**：逻辑为 `first.hit ? 'A' : 'B'`，且 `first.kill` 时同时给双方击杀数 +1，ShotResult 未记录开火方。
- **Evidence**：STATE-P1-4：B 先 `executeShot('B','A')` 命中 A，随后 A 也命中，`finishRound()` 返回 `'A'`，击杀为 `{A:1,B:1}`。
- **Impact**：胜者与击杀统计双双错误。
- **Reproduction**：`npx ts-node _gate-audit-2/STATE/semantics_sm.ts` S2。
- **Recommended remediation**：在 ShotResult 中记录开火方与时刻，按真正首个成功命中判定胜者，且不重复计数。

#### P1-22 不存在比赛可用的观众 UI

- **Problem**：全部 UI 是控制台 ASCII 文本，无浏览器/DOM/Canvas/SVG/HTTP 服务；比赛场地是硬编码装饰框。
- **Evidence**：UI-02：全仓 `grep getContext|canvas|document.createElement|<svg|innerHTML|http.createServer|express|socket` 零命中；无任何 `.html/.css/.svg` 文件；`AudienceScreenUI.render()` 中的 MATCH FIELD 是写死的 `'│    A    ●●●●    B    │'`。**独立运行 `src/demo-full-ui.ts`**：§22 的 14 项要求里，实际输出仅有 `ROUND 0`、`Shooter: ???`、`0 ALIVE`、`Phase: SETUP` 与一个错误胜者 `TEAM B WINS!`（`Rounds Played: 0`）；point IDs、obstacles、A/B computing、compute time、function expression、trajectory、hits、shooter elimination 全部缺失，比赛场地是硬编码装饰框。
- **Impact**：观众看不到真实几何（点位、ID、障碍、轨迹、命中位置），无法作为正式比赛投影屏。结论与 §22 要求的标准措辞一致：**UI infrastructure exists but competition audience UI not complete**。
- **Reproduction**：`npx ts-node src/demo-full-ui.ts`。
- **Recommended remediation**：建立真实渲染目标（Canvas/SVG 或坐标映射的 TUI）并接入 visualizer。

#### P1-23 动画层是死代码

- **Problem**：`sampleFunctionPoints / computeAnimationFrames / generateAnimationData / mathToCanvas / pointsToSvgPath` 均无调用方；无播放循环；`generateAnimationData` 硬编码 `hits: []`；无逐帧时间戳；无障碍物停止。
- **Evidence**：UI-04：唯一外部引用是 `AudienceScreenUI.ts:8` 的一个未使用 import；全仓无 `setTimeout|requestAnimationFrame|animate` 播放代码。UI-05：每帧 `hits` 均为 0。UI-06：曲线穿过障碍物后仍继续延伸（`max x reached = 9.95`，障碍边界 x=2）。UI-07：`animationDuration=450ms` 声明但无任何读取方。
- **Impact**：§23 描述的功能在运行的产品中不存在。
- **Reproduction**：`npx ts-node _gate-audit-2/UI/run-anim.ts`。
- **Recommended remediation**：接入真实播放循环与渲染面，或删除该层；若保留，需把裁判命中列表与障碍停止逻辑接进去。

#### P1-24 比赛结束前可能显示错误胜者

- **Problem**：`getWinner()` 在 `aliveA <= 0` 时返回 `'B'`，而 `aliveA` 初始为 0（只有 `generateMap` 之后才会被赋值）。
- **Evidence**：UI-03：`demo-full-ui.ts` 输出 `TEAM B WINS!` 且 `Rounds Played: 0`、双方击杀均为 0。
- **Impact**：投影或操作台可能展示错误胜者。
- **Reproduction**：`npx ts-node src/demo-full-ui.ts`，读 `[STEP 5] Match End Screen`。
- **Recommended remediation**：仅在 `phase==MATCH_END` 且至少完成一轮时渲染胜者。

#### P1-25 `finishRound()` 未按阶段设防，可伪造回合日志

- **Problem**：`finishRound()` 不检查 `phase`，在 READY 阶段调用也会产出并追加 RoundLog。
- **Evidence**：独立复核 `x9.ts` 第 12 步：在从未进入 COMPUTING 的情况下返回 `{"round":0, ..., "result":"COMPLETE"}`。E2E-P1-7：白盒循环中 `roundLogsLength=25` 而 `roundNumber` 停在 1。
- **Impact**：日志不可信，可被写入未真实发生的回合。
- **Reproduction**：`npx ts-node _gate-audit-2/CLAUDE-CROSSCHECK/x9.ts`。
- **Recommended remediation**：把 `finishRound()` 限制在 ROUND_RESULT 阶段。

#### P1-26 MatchLog 哈希为空、结果硬编码

- **Problem**：`teamAHash/teamBHash` 在 `startLogging()` 时捕获（早于上传），实测为空串；`RoundLog.result` 硬编码 `'COMPLETE'`；`MatchLogger.toJson()` 内部调用 `endMatch('draw')`。
- **Evidence**：LOGS-08：`getMatchLog() => teamAHash:"", teamBHash:"", winner:"draw"`；`ReplayLogger.ts:101`、`MatchController.ts:430`。
- **Impact**：§25 要求的「队伍算法哈希」与超时/非法/取消字段永远不准确。
- **Reproduction**：`npx ts-node _gate-audit-2/LOGS/audit-logs.ts` TEST2。
- **Recommended remediation**：在上传后构造/更新 MatchLogger 的哈希，`result` 由 `RunnerResult.errorCode` 推导，`toJson()` 使用真实胜者。

#### P1-27 校验只覆盖本方半场，敌方半场的违规不被检查

- **Problem**：`Judge.validateShooter` 对 A 队传入的 x 区间是 `[-20,-4]`、对 B 队是 `[4,20]`，因此连续性、凸性、场内边界与障碍物检查全部只作用于本方半场；函数在敌方半场的行为（越界、跳变、凸性爆炸）完全不受约束。
- **Evidence**：对抗性复核 C15：构造「本方半场合法、敌方半场 `y=1000`」的分段函数 → 经 `validateShooter` 判定 `valid`；同一函数改用全场地范围 `[-20,20]` 校验则被「函数图像超出场地边界」拒绝。源码 `src/judge/Judge.ts` 的 `graph.validate('A', teamRange)` 硬编码为本方区间。
- **Impact**：团队可以在敌方半场放置任意违规行为（越界、突变），校验形同虚设。
- **Reproduction**：`npx ts-node _gate-audit-2/VERIFY/C15/*.ts`。
- **Recommended remediation**：用全场地 x 区间 `[-20,20]` 做函数合法性校验（或至少覆盖射手到敌方点位的有效射击走廊）。

### P2 — Important

| ID | Problem | Evidence / Reproduction | Impact | Remediation |
|---|---|---|---|---|
| P2-1 | 不存在真实 barrier | `executeCompute` 仅 `Promise.all`；`grep barrier\|broadcast\|semaphore` 无命中（FAIR-5） | 启动同步是「偶然」而非「保证」；当前实测偏斜可接受，但任何改动都可能失守 | 记录并接受实测偏斜，或实现真正的启动屏障 |
| P2-2 | 无 per-team RoundState hash | RoundLog.stateHash 记录的是地图哈希（`b9f5323f8d514194`），不含 shooter 位置（FAIR-4） | §11 的「双方日志记录同一 RoundState hash」无法验证 | 记录基于实际发送字节的 per-team hash，并使用完整 SHA-256 |
| P2-3 | 无操作台 / CLI 流程 | README 只文档化 `MatchController` 方法；无任何 CLI/操作入口（BASELINE-P2-1） | 「操作者如何开始比赛」既未文档化也未实现 | 提供并文档化操作台/CLI |
| P2-4 | README 与实现不符 | 宣称「17 阶段」实为 19；宣称「C² 连续性校验」实为仅查非有限值；算子列表漏 floor/ceil/round/sign（BASELINE-P2-2） | 团队与操作者预期错误 | 修正文档或补齐实现 |
| P2-5 | 无面向用户的上传流程 | `MatchSetupUI.uploadTeamA/B` 无调用方；demo 只打印「uploaded」（SUB-05） | 无法通过 UI 完成提交 | 接入真实上传流程并从 manifest 取 entry |
| P2-6 | 不存在的包路径抛未捕获 ENOENT | `uploadTeamA(nonexistent)` → `[THREW] ENOENT`（SUB-06） | 路径笔误直接使提交流程崩溃 | 增加存在性检查并返回结构化错误 |
| P2-7 | 允许 floor/ceil/round/sign/if 等算子 | `parseDSL({type:'sign'}).valid === true`；README 未列出这些算子（DSL-7） | 规则与实现不一致 | 若要求 C² 则禁止这些算子，或补齐 C² 校验并对齐文档 |
| P2-8 | 无 INVALID SHOT 语义 | `finishRound` 硬编码 `result:'COMPLETE'`；`INVALID_A/B` 从未被赋值（DSL-8） | §20 的 INVALID SHOT 未体现在日志与规则中 | 引入显式的 INVALID 分类并写入 RoundLog |
| P2-9 | `minDistanceToObstacle` 是死配置 | 只在 `Judge.ts:19/24` 出现；实际阈值硬编码为 2.0（J9） | 配置项无效，语义不明 | 接线或删除该配置 |
| P2-10 | 校验期避障阈值 2.0 过严 | `checkObstacleCollision(f=5, obs[3,7]) = true`；dist 1.9→true、2.1→false（J10） | 与 0.3/0.1 的命中阈值语义冲突 | 统一为一个距离函数与一个阈值 |
| P2-11 | demo 与实际流程脱节 | `demo-full-ui.ts` 从不调用 `uploadTeamA/B`，`generateMap` 失败（J8、UI-10） | 误导操作者对就绪度的判断 | 让 demo 走真实流程或明确标注为占位 |
| P2-12 | 先解者判定受调度抖动支配 | 同一空算法耗时 min=122 / median=135 / max=141（跨度 19ms）（T-02） | 近似相等时胜负近似随机 | 使用高精度单调时钟并加入确定性 tie-break |
| P2-13 | `pointCount` 无上限 | pc=2000 → 11.8s；pc=5000 → 挂起（MAP-1） | 越界入参可在校验前挂起平台 | 在函数入口校验/钳制取值范围 |
| P2-14 | 强制放置回退绕过约束 | pc=20 → tooClose=1/inObs=2；pc=50 → tooClose=400（MAP-2） | 高密度下会静默产出非法地图 | 回退时改为失败或带约束的重试 |
| P2-15 | AuditLog 事件面不完整 | 仅 MatchStarted/AlgorithmUploaded×2/MapGenerated；无 MatchEnd/裁判动作/平台错误/重启暂停（LOGS-07） | 审计轨迹覆盖不全 | 补齐事件类型与发出点 |
| P2-16 | `RoundStateMachine` 7/19 阶段不可达 | 有效流程停在 SECOND_SOLUTION（STATE-P2-5） | 状态机无法表达射击/结果/下一轮 | 补齐转移与消除机制 |
| P2-17 | 三套互不相连的状态机 | 19/14/5+6 状态，无一是 17；Competition 与 RoundStateMachine 均为死代码（STATE-P2-6） | 状态漂移风险 | 收敛为唯一权威状态机 |
| P2-18 | 裁判控制过于简陋 | 只有 `judgeStart()`；无 NEXT ROUND/PAUSE/RESUME/END MATCH；无真实倒计时（STATE-P2-7） | 操作者无法按 §19 控制比赛 | 补齐控制面与可观测倒计时 |
| P2-19 | Lock 语义未强制 | `setShooter('A','A1')` 后可再次 `setShooter('A','A2')` 覆盖（STATE-P2-8） | 「Lock 后不可修改」不成立 | 已锁定后拒绝再次选择并校验点位存活 |
| P2-20 | UI 消费的射击判定是另一套近似实现 | `executeShots` 用 0.3 半径、无遮挡、无命中顺序、不填 killed（UI-08） | 即便 UI 可用也会误报比赛 | 统一到权威 Judge |
| P2-21 | 动画无障碍停止 / 无播放时序 | UI-06 / UI-07 | §23 要求未满足 | 接入障碍截断与按 `animationDuration` 的播放驱动 |
| P2-22 | 无任何落盘 | 进程退出即丢失 MatchLog/AuditLog/Replay；无 fromJson/loadReplay（LOGS-09） | §26 仅在「同进程新实例」意义上成立 | 落盘并提供加载 API |
| P2-23 | **地图生成器在合法区间内仍可产出非法地图** | 强制放置回退（`generateTeamPoints` 的 `if (!placed)` 分支）跳过最小距离与障碍物检查。**独立复核**：`seed=1248124864, pc=6, easy` → `teamB` 含两个完全重合的点 `B1(7.462,3.100) ~ B6(7.462,3.100) d=0.0000`，且 `(10.261,1.298)` 落在半径 2.386 的圆形障碍内，`validateMap.valid=false`；顺序种子扫描 300,000 张（pc 6–10、三种难度）命中 4 张非法地图（`seed=126992/208300/223544/246424`）。对抗性反驳者在 457,815 张地图上统计到 164 对同队距离 <2.5、32 个障碍内点位、30 张 `validateMap` 非法 | §20 的「no illegal spawn / minimum point distance / no spawn inside obstacle」被违反；`MatchController.generateMap` 会拦下并报错（无重试），操作者需手动换 seed | 回退时继续搜索直到满足「与全部同队点距离 ≥2.5 且不在任何障碍物内」，或直接判定生成失败而不是产出非法点 |
| P2-24 | **`Competition` 的胜负判据与规则完全不同** | `determineWinner`（`src/judge/Judge.ts:152`）在 `judgeX`（默认 0）处比较 `f_A(judgeX)` 与 `f_B(judgeX)` 的数值大小定胜负（`yA > yB ? 'A' : 'B'`），与规则 11/28「先命中对方 shooter 者胜」毫无关系；`Competition.executeRound` 以 `judgeX=0` 调用它（`Competition.ts:188`）。全仓 `grep "new Competition("` 无命中 —— 该模块从未被实例化 | 死代码，但一旦被接线即得到**错误**的胜负判据；审计若不点名，修复 P0 链时可能误用 | 删除该模块，或将其判据改为调用权威 Judge 的命中结果 |
| P2-25 | **Runner 对算法输出无任何字节上限** | `proc.stdout.on('data', d => stdout += d.toString())`（`AlgorithmRunner.ts:100-106`）无 maxBuffer、无截断；失败路径 `catch` 分支把**整个 stdout** 作为 `dsl` 返回（`AlgorithmRunner.ts:164`）。**独立复核 x20.ts**：32 MiB stdout 洪泛 → 宿主 `heapUsed` 由 88.0 MiB 涨到 143.2 MiB（+55.1 MiB），`result.dsl` 为 32 MiB 的垃圾字符串；同时 `grep RLIMIT\|NPROC\|setrlimit` 无命中，无 `RLIMIT_NPROC` 限制 | 不受信算法可单方面决定宿主内存占用（多轮累积 → OOM），且垃圾串会被后续日志/回放继续持有 | 对 stdout 设字节上限并截断/拒绝，对子进程设置 `RLIMIT_AS`/`RLIMIT_NPROC`/输出上限 |
| P2-26 | **`ReplayFrame` 字段不足以复现比赛** | `src/replay/ReplayLogger.ts:49-62` 的帧结构只有 round/phase/shooter 位置/两条轨迹/hits/killed/timer，**没有逐帧时间戳、没有地图与障碍物快照、没有本回合胜者、没有取消/超时字段** | 即使把 `addFrame()` 接线，回放也无法重建一场比赛（§24 要求「可复现」） | 补齐地图快照、逐帧时间戳、回合结果与取消/超时字段 |

### P3 — Polish

| ID | Problem | Evidence | Remediation |
|---|---|---|---|
| P3-1 | README 宣称「Runner 隔离执行」 | `spawn('python3', ...)` 无沙箱（BASELINE-P3-1） | 修正措辞或实现真实隔离 |
| P3-2 | `package.json` 的 `test` 等同 `start` | `{test:'ts-node src/index.ts'}`（BASELINE-P3-2） | 引入真实测试运行器与集成测试 |
| P3-3 | 包哈希忽略文件名与目录结构 | 同内容不同文件名 → 同哈希（SUB-07） | 哈希纳入相对路径 |
| P3-4 | `computeTimeMs` 含解释器启动开销 | 空算法仍测得 22–40ms（F7） | 明确并文档化计时边界 |
| P3-5 | `Date.now()` 无亚毫秒分辨率；DSL 校验不计入超时 | 所有 `computeTimeMs` 均为整数（T-04） | 改用高精度时钟 |
| P3-6 | macOS 无 /dev/shm，但设计未区分平台 | `shm_file:false`（CR-05） | 引入沙箱时按平台挂载 per-round tmpfs |
| P3-7 | 圆形障碍可越出场地；`validateMap` 不校验障碍几何 | 6000 张图中 439 个越界形状（MAP-3） | 增加障碍几何校验 |
| P3-8 | stateHash 截断至 64bit 且从不复算 | 篡改点位后哈希不变（MAP-4） | 使用完整 SHA-256 并复算比对 |
| P3-9 | difficulty 枚举未校验 | `difficulty:'xxx'` → TypeError（MAP-5） | 校验枚举值 |
| P3-10 | 跨队过近只是警告 | 0.05 距离仅产生 warning（MAP-6） | 按硬规则处理 |
| P3-11 | Competition 模块自相矛盾且从不实例化 | 接口 6 态 / 字段 5 态（STATE-P3-9） | 修正或删除 |
| P3-12 | 命名误导：「Isolated Sandbox Runner」 | 无任何沙箱代码（ISOL-7） | 修正注释与文档 |
| P3-13 | `SeededRandom` 是弱 LCG 且低位精度丢失 | `this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff`（`MapGenerator.ts:34`）：`seed` 最大 2³¹，乘积约 2⁶¹ > 2⁵³，双精度尾数丢失低位后再取模，低位随机性退化。**跨进程确定性不受影响**（反驳者实测 3 个独立进程输出同一 JSON 与同一 stateHash） | 换成 `xorshift`/`mulberry32` 等 32 位安全 PRNG（保持确定性） |
| P3-14 | **未覆盖领域（如实记录）**：① Rule 31「构造病态但合法的 DSL 使 Judge 卡死」未测（校验采样步长固定，成本有界，未找到可放大的入口）；② Unicode/编码（非 ASCII 输出、CJK 路径、UTF-8 序列化）零测试；③ CPU 限额/线程数/数学库版本在 A/B 间的对称性未测（只有 `memoryLimitMb` 声明未生效）；④ 数值边界（常数 ±1000 上限、`pow` 溢出为 Inf、负底数非整数指数为 NaN）只做了 oracle 抽查未做规则级判定测试 | 结论不覆盖上述四项；`evaluateAST` 数值正确性已补测（x19.ts：30 条 AST × 13 个 x 点 = 390 次与 JS 原生表达式逐点比对，全部一致，含 24 处 NaN 语义） | 在下一轮补测这四类，并把数值正确性 oracle 纳入常驻回归 |

---

## Full Match Evidence

**结论：无法完成任何一场完整比赛。** 以下为独立以纯公开 API 驱动的结果（`x9.ts`）：

```text
Map seed:               20260909
Team A package/hash:    _gate-audit-2/CLAUDE-CROSSCHECK/pkgs/teamA  c64da7a7c57d0e89
Team B package/hash:    _gate-audit-2/CLAUDE-CROSSCHECK/pkgs/teamB  5af433a2fef5e447
Map stateHash:          b9f5323f8d514194
Round count:            0            ← 无法开始
Winner:                 draw
Timeouts:               0（未进入 COMPUTING）
Invalid shots:          N/A（未产生射击）
Shooter cancellations:  N/A（机制不存在）
Replay verified:        NO — getReplay().frames.length === 0
```

逐阶段实测：

```text
[0] phase SETUP
[2] uploadA {"s":true,"h":"c64da7a7c57d0e89"}
[3] uploadB {"s":true,"h":"5af433a2fef5e447"}
[4] map     {"s":true,"seed":20260909,"hash":"b9f5323f8d514194"}
[5] selectA {"success":false,"error":"DSL 格式无效"}      ← P0-1
[6] selectB {"success":false,"error":"DSL 格式无效"}      ← P0-1
[7] phase READY
[8] judgeStart false, phase READY
[9] compute {"s":false,"A":null,"B":null}
[11] shots  {"hitsA":[],"hitsB":[],"killedA":[],"killedB":[],"winner":"draw"}
[12] finishRound {"round":0,...,"result":"COMPLETE"}      ← P1-25（无阶段防护）
[13] phase READY winner draw
[14] matchLog {"rounds":0,"winner":"draw","hashA":"","hashB":""}  ← P1-16/P1-26
[15] replay frames 0                                      ← P1-18
[16] audit MatchStarted,AlgorithmUploaded,AlgorithmUploaded,MapGenerated  ← P1-17（仅手动开启后）
[17] alive 8 8 roundNumber 0                              ← P0-4
```

补充证据（白盒注入绕开 P0-1 后仍然失败）：`_gate-audit-2/E2E/` 的 25 轮循环中 `aliveA/aliveB` 恒为 8/8、`getWinner()` 恒为 `draw`、`MATCH_END` 不可达。

---

## Runner Fairness Evidence

```text
RoundState equality:      FAIL — A/B 输入为镜像结构而非同一份字节（A 只见 B 的点、B 只见 A 的点），
                          且日志中只有 map hash（b9f5323f8d514194），不存在 per-team RoundState hash，
                          §11 的「same RoundState hash」无法验证（FAIR-4）
Start skew:               CONDITIONAL — 代码中无 barrier；实测 median 0.004ms / p95 0.544ms /
                          max 3.38ms，方向平衡 64/54（FAIR-5）。但计时口径存在系统性偏差：
                          交换 Promise.all 顺序后 meanA-meanB 由 +0.763ms 变为 -0.637ms（FAIR-1）
Network isolation:        FAIL — DNS 解析与 TCP 外连均成功（ISOL-6）
Filesystem isolation:     FAIL — 可写项目目录/home/tmp；可读 Judge 源码、MatchController
                          与对方算法包；A/B 可互相读写包目录（ISOL-1、CR-03）
Process cleanup:          FAIL — 超时后孙进程 PPID=1 存活并继续运行（独立复核 x8.ts、T-01、CR-02）
Cross-round persistence:  FAIL — cwd 文件、相对路径文件、/tmp、home、mmap、守护进程、socket、
                          TCP 全部可跨轮读回（CR-01、ISOL-2）
```

---

## Final Blocking Items

以下为真正阻止 `v1.0.0-competition` 冻结的项目（P0 全部 + 直接决定胜负/完整性的 P1）：

1. **P0-1** 人类选择 Shooter 恒失败 → 一个 Round 都无法开始。
2. **P0-12** A 选定即置 LOCKED、B 无法选择 → 与 P0-1 独立的第二个选择阻断项。
3. **P0-2 / P0-3** Runner 与官方 starter 的 DSL 契约不成立 → 任何算法输出都被判非法。
4. **P0-4** alive 永不递减、无击杀 → 比赛永远无法产生胜者。
5. **P0-5 / P0-6** 上传无校验、哈希不复验 → 非法包可通过，算法可在比赛中被替换。
6. **P0-7 / P0-8** Runner 无隔离、跨 Round 状态可持久化 → 可直接预计算与窃取对方算法，比赛完整性失效。
7. **P0-9** 官方命中判定不考虑障碍物 → 地图与障碍物对结果无影响，§5 判据不成立。
8. **P0-10 / P0-11** 核心流水线为死代码、消除与取消机制不存在 → 无端到端可运行路径，淘汰制不可达。
9. **P1-10** 计时口径系统性偏向第二个启动的队伍 → 近实时胜负由调度顺序决定。
10. **P1-19** 超时预算与 §14 判定口径不符（1990ms 结果被超时）。
11. **P1-12** 孙进程在超时后存活 → 遗留进程与跨轮携带状态。
12. **P1-16 / P1-17 / P1-18 / P1-26** MatchLog / AuditLog / Replay 均未接通 → 无任何可复核记录。
13. **P1-1 / P1-2 / P1-3 / P1-4 / P1-5 / P1-6 / P1-7 / P1-27** DSL 规则与 Judge 判据大面积缺失或不一致 → 合法性判定不可信。
14. **P1-20 / P1-22 / P1-23** 17 阶段状态机、观众 UI、动画均未接入 → §17/§22/§23 不成立。

---

## Recommendation

```text
Is Geometry Battle V1 safe to freeze as
v1.0.0-competition?
NO
```

**依据**：Gate Plan §29 的 FAIL 判据被逐条命中 —— 比赛无法完成、存在明显不公平、可跨 Round 预计算、Runner 相互污染、Judge 结果错误、Replay 无法可信复现。24 项 Gate 中 22 项 FAIL、1 项 CONDITIONAL PASS（Simultaneous Start）、1 项 PASS（Complexity）。本结论基于实际执行证据，未对任何代码、规则或配置做修改。

**最小的解除路径建议**（不构成本轮改动）：先修复 P0-1 → P0-2/P0-3 → P0-4 这条「能跑通一轮」的主链，再补齐 P0-5..P0-11 的完整性与隔离，最后处理 P1 中的计时口径与日志/回放接线；每修一项都应补一条端到端回归测试。

**主链修复后最可能暴露的问题**（覆盖度批评者指出，宜在下次 CONDITIONAL→PASS 复审前处理）：P2-24（`determineWinner` 的错误胜负判据，若被接线会直接判错胜者）、P2-25（Runner 输出无上限，可被算法单方面耗尽宿主内存）、P2-26（`ReplayFrame` 字段不足，接线后仍无法复现比赛）。
