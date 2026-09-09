# 独立审计报告 — Geometry Battle V1 Re-Gate（Cycle 1）

审计 Agent：独立审计（与修复编写者无共享上下文）
审计日期：2026-09-09
审计对象文档：`Plans/Output/V1 Remediation Handoff.md`（**被审计对象，非事实来源**）

> **Historical note / Current location（2026-09-09 追加）**：本报告记录**审计当时（HEAD `be3c4a5`）**
> 的真实观察，按历史保护原则不改写。其后的 Cycle 2 / Cycle 3 修复改动了生产代码，故部分
> 源码行号已漂移：`Ast.ts:186`（无深度检查的递归点）→ 现第 201 行；`Ast.ts:224-236`
> （`NODE_LIMIT`/`DEPTH_LIMIT` 后置检查）→ 现第 256-268 行；`SandboxRunner.ts:667-672`
> （双方共用 `releaseNs` 的赋值块）已被 Cycle 2 的 P1-B 修复**移除**；`cli.ts` 第 193 行
> （循环外唯一一次 `persistArtifacts`）→ 现第 121 行，且语义已变（改为循环内每回合落盘）。
> 报告的**事实结论与判定不受影响**。

---

## 0. 审计对象与基线

| 项目 | 值 |
|---|---|
| 仓库 | `/Users/jiayihuang/Downloads/几何斗殴` |
| 分支 | `main` |
| HEAD（开始） | `be3c4a5f61656a7a5d2756da35fbd27ecaa925f0` |
| `git status --short`（开始） | 空（clean） |
| HEAD（结束） | `be3c4a5f61656a7a5d2756da35fbd27ecaa925f0` |
| `git status --short`（结束） | 空（clean） |
| 只读承诺 | 未修改任何被 git 跟踪的文件；未 commit/checkout/reset；全部探针在 `/tmp/gb-audit/` 下 |
| 交叉验证 | `git diff --stat 0db2dbe..HEAD` = 仅 `Plans/Output/V1 Remediation Handoff.md`（469 行）—— 冻结声明属实 |

`Package.ts` 含 2 个裸 NUL 字节（偏移 2854/2864），故 grep 视其为二进制文件；审计期间所有源码结论均以字节级读取为准。

---

## 1. 最终判定

**FAIL**

理由见第 6 节。

---

## 2. 独立探针清单

所有探针均为审计方自行编写，未复用仓库自带测试作为判据（仓库测试仅作对照）。

| # | 探针 | 命令 | 关键输出 | 判定 |
|---|---|---|---|---|
| A1 | 全流程 E2E（自写算法包 + 人类选人 + 重启回放） | `npx ts-node src/operator/cli.ts --a /tmp/gb-audit/e2e/team-alpha --b /tmp/gb-audit/e2e/team-beta --seed ... --artifacts ...` 由 `/tmp/gb-audit/probes/e2e_driver.py` 逐字符驱动提示符 | `WINNER: A`，7 回合；`alive` 严格递减；`--replay` 在密封包与沙箱删除后仍可加载 | 通过 |
| A2 | 产物完整性 | python 解析 `match.json/audit.json/replay.json` | 73 事件、seq 1..73 严格递增、时间戳可解析；replay 7 帧且不含 `solver.py/manifest.json/__gb_bootstrap/__gb_profile/sandboxes/python3/exec(` | 通过 |
| B1 | 真实沙箱攻击（自写恶意包，走生产 `runDuel`） | `npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit/probes/sandbox_probe.ts` | 平台源码/密封包/沙箱根/项目写/$HOME 写/共享 tmp 写/`/etc` 写/fork/subprocess/popen/DNS/TCP/UDP/bind 全部 `BLOCKED:PermissionError`；对照「读自己的包」「写自己的 work/」`ALLOWED` | 通过 |
| B2 | 跨回合持久化 | 同上 ROUND 2 | 上一回合沙箱目录 `FileNotFoundError`；宿主无 daemon 残留 | 通过 |
| B3 | 内存/洪泛上限 | 同上 | 900MB → `MEMORY_LIMIT`（880MB 触发）；32MiB stdout → `OUTPUT_TOO_LARGE`，**stdout 被截断至 4096 字节** | 通过（文档数字失实，见 P3-A） |
| B4 | 宿主环境泄漏 | `/tmp/gb-audit/probes/env_probe.ts`（父进程注入 `GB_AUDIT_SECRET`/`AWS_SECRET_ACCESS_KEY`/`OPENAI_API_KEY`） | 沙箱内 `SECRET-LIKE KEYS: []`；仅 macOS 注入 `SDKROOT/CPATH/LIBRARY_PATH/MANPATH/PWD/SHLVL/__CF_USER_TEXT_ENCODING` | 通过 |
| B5 | **对手源包 / 上一场密封包可读性** | `/tmp/gb-audit/probes/leak_probe.ts`（`denyReadPaths` 与 `Match.runRound` 完全一致：`[当前sealedRoot, PLATFORM_ROOT]`） | `OPPONENT SOURCE DIR → READ_OK bytes=2928`；`PREVIOUS MATCH SEALED PKG → READ_OK bytes=3308`；`CURRENT MATCH SEALED ROOT → BLOCKED`；`PLATFORM SOURCE → BLOCKED` | **失败（P0-B）** |
| C1 | 包密封/篡改（自写哈希实现） | `/tmp/gb-audit/probes/tamper_probe.ts` | 独立重算哈希与 `hashFileList` 一致（分隔符为 `\0`，见 P3-B）；改内容/加文件/删文件/改名/移目录/换序/整包替换 → 7/7 `verifySeal.ok=false`；`hash` 与顺序无关、与目录结构有关 | 通过 |
| C2 | 中途篡改密封副本（走 MatchEngine） | `/tmp/gb-audit/probes/e2e_tamper.ts` | 替换密封副本 → 下一轮抛 `MatchEngineError: A 算法包在比赛期间被篡改`，审计事件 `PackageTampered` | 通过 |
| C3 | 上传后替换**源包** | 同上 T1 | 比赛仍用密封副本（`aFunctionMath` 含原斜率 0.123456，不含替换后的 0.999999）；**但无任何告警/审计事件** | 部分失败（P3-A 文档失实） |
| C4 | 包结构校验负例 | `/tmp/gb-audit/probes/pkg_neg.ts` | 缺 manifest/坏 JSON/非 python/entry 非 .py/entry 缺失/.exe/符号链接/超 8MiB → 9/9 拒绝；正例与嵌套 entry 通过 | 通过 |
| D1 | 计时公平（同算法 300 轮） | `/tmp/gb-audit/probes/timing_probe.ts` | `releaseSkewUs median=22.208 p95=32.792 max=77.833`；`timeDiffMs(A−B) median=−0.0185 p95=0.397`；`medianTimeA=4.651ms medianTimeB=4.675ms`；`aFaster=130 bFaster=137 ties=32`，`aFasterRate=0.4869`（排除并列） | 通过（存在微小机制性偏置，见 P1-B） |
| D2 | 换序配对 100 对 | 同上 | `X 胜率(当A)=0.430`，`X 胜率(当B)=0.490`，`Δ=−0.060`；符号检验不显著（43 vs 49，p≈0.62） | 通过（N=100 的 95% 置信区间约 ±10pp，无法排除 <10pp 的偏置） |
| D3 | 释放顺序机制 | 源码 + 统计 | `runnerA.release(releaseNs)` 先于 `runnerB.release(releaseNs)`；`releaseSkewUs = t1−t0`；双方 `computeTimeMs` 均以同一 `releaseNs` 为基准 → 后释放方（恒为 B）被计入 ~22µs 交付延迟 | 仍有问题（P1-B） |
| E1 | 地图生成 300,000 采样（审计方自写合法性判据） | `N=300000 DIFF=medium PC=8 npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit/probes/map_probe.ts` | `ok=190795 fail=109205 retryRate=0.3640`，`time=4.07s`，**独立判据违规 0 条**；`min same-team d=2.5000`、`min clearance=1.5000`、`min obstacle inset=0.0000`；A/B 坐标分布对称 | 通过 |
| E2 | 拒绝原因分解（自写 RNG 复刻） | `/tmp/gb-audit/probes/map_cause.ts` | `obstacleInField` 拒绝率：easy 13.56% / medium 36.40% / **hard 60.92%**；`formsWall=0` | 通过（设计冗余，见 P3-C） |
| E3 | 失败语义 / 换种子 | `/tmp/gb-audit/probes/mapexhaust.ts` | `hard/10` 单种子拒绝率 61.10%；`generateMapOrNull` 2000 次无耗尽，最大种子跨度 20；`generateMap` 未抛错 | 通过 |
| E4 | 地图确定性 + 独立哈希 | `/tmp/gb-audit/probes/mapdet.ts` | 同种子 → 同 `stateHash`；独立重算哈希 == `computeMapHash`；`stateHash == computeMapHash(map)` | 通过 |
| F1 | DSL 绕过（17 向量） | `/tmp/gb-audit/probes/dsl_probe.ts` | NaN/Inf/log 负域/exp 溢出/pow 爆炸/负底分数幂/abs/min/floor/if/比较/未知算子/常量>1000/混叠/凸性>100/采样预算/不过 shooter → 全部拒绝；3 个合法对照接受 | 通过 |
| F2 | 深度/节点限制 | 同上 + `dsl_extra.ts` | depth 11 接受、depth 13 `DEPTH_LIMIT`；**depth ≥ 5000 → `RangeError: Maximum call stack size exceeded`**；200 元宽节点 `BAD_ARITY` | **失败（P0-A）** |
| F3 | Judge 四类障碍 / 方向 / 容差 / oracle | `dsl_probe.ts` | 4 类障碍全部 `OBSTACLE` 截断；障碍前命中/障碍后不命中；反向射击不命中；容差恰为 `HIT_EPSILON=1e-6`（9e-7 命中、1.1e-6 不命中）；数值 oracle `maxAbsErr=1.776e-15` | 通过 |
| G1 | 日志/回放审计 | 见 A2 | 通过 | 通过 |
| H1 | 官方 starter（独立执行） | `/tmp/gb-audit/probes/starter_probe.ts` | 3 组不同 shooter 位置 → `success=true` 且 DSL `valid=true` | 通过 |
| H2 | RoundState 载荷对称 | `/tmp/gb-audit/probes/payload_probe.ts` | 双方 payload 400 字节，除 `team_id` 外逐字节一致 | 通过 |
| H3 | 取消契约 | `/tmp/gb-audit/probes/cancel_contract.ts` | 120/120 轮恰好一方被取消，`bothSuccess=0` | 通过 |
| H4 | 取消竞态（能否「死点开火」） | `/tmp/gb-audit/probes/cancel_race.ts` | 200 轮中仅 1 次取消（几何受限），未复现竞态 | 未能复现 |
| I1 | 仓库回归测试（对照） | `npm test` → `/tmp/gb-repo-tests.log` | `17/17 套件通过` | 通过 |
| I2 | 进程残留 | `ps -axo command` | 无 `sandbox-exec`/`__gb_`/`gb-audit` 残留 | 通过 |

---

## 3. 问题清单

### P0-A｜深度嵌套 AST 使操作台崩溃，整场比赛中止且零落盘（严重度：P0）

**现象**
提交包输出一个深度约 6000 的嵌套 AST（`neg` 链，约 120KB，远低于 256KB stdout 上限）后，宿主 `ts-node` 进程抛出未捕获的 `RangeError: Maximum call stack size exceeded`，比赛中止；`artifacts/` 下只有密封副本，**没有 `match.json` / `audit.json` / `replay.json`**。

**复现步骤**
1. 构造包：`round==0`（Preflight）输出合法小 AST；其余回合输出 `'{"type":"neg","args":['×6000 + '{"type":"number","value":1}' + ']}'×6000` 的 JSON 字符串。
2. `npx ts-node src/operator/cli.ts --a /tmp/gb-audit/crash-pkg --b /tmp/gb-audit/e2e/team-beta --seed 777 --points 6 --difficulty easy --artifacts /tmp/gb-audit/crash-artifacts2 --auto`
3. 亦可直接让包在 Preflight 崩溃：`--a /tmp/gb-audit/crash-always ...`

**证据**
```
RangeError: Maximum call stack size exceeded
    at isPlainObject (/Users/jiayihuang/Downloads/几何斗殴/src/core/Ast.ts:115:56)
    at parseNode (/Users/jiayihuang/Downloads/几何斗殴/src/core/Ast.ts:125:8)
    at parseNode (/Users/jiayihuang/Downloads/几何斗殴/src/core/Ast.ts:186:19)   ← 递归 6000 层
EXIT=1
# artifacts 目录下仅有 sealed/... 4 个文件；无 match.json/audit.json/replay.json
```
Preflight 崩溃同样：
```
═══ 2. Preflight（真实沙箱内跑一次算法）═══
操作台错误: Maximum call stack size exceeded
EXIT=1
files under artifact dir: 4
```
根因（源码）：`parseNode(raw, issues, depth)` 接收 `depth` 但**从未检查**，无条件递归 `parseNode(a, issues, depth+1)`（`src/core/Ast.ts:186`）；`NODE_LIMIT`/`DEPTH_LIMIT` 在 `analyzeComplexity(ast)` **之后**才检查（`src/core/Ast.ts:224-236`），而此时树已建好、栈已耗尽。深度 13 能被干净拒绝只是因为递归尚未爆栈。

**影响**
任何一支队伍都能用不到 256KB 的合法 stdout **让整场比赛无法完成**，并**销毁全部审计产物**。这直接推翻 Handoff §4/§8「平台行为正确（不误判、不崩溃、每轮落盘）」与「已落盘的产物仍完整可读」，也使上一轮 Gate 中唯一 PASS 的 Complexity 行失效。

---

### P0-B｜沙箱可读取对手源包、上一场密封包与任意 `/tmp` 文件（严重度：P0）

**现象**
`Match.runRound` 只把 `[this.sealedRoot, PLATFORM_ROOT]` 传给 `denyReadPaths`。当双方源包放在 `sealedRoot` 之外（正是 CLI 的常规用法：`--a <dir> --b <dir>`，Handoff 自己的 E2E 就用 `/tmp/gb-e2e/team-alpha|team-beta`）时，算法进程可读取**对手的源码**；`artifactRoot` 每次指定新目录时，**上一场比赛的密封包**也可读；`/tmp` 整个目录可枚举。

**复现步骤**
`npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit/probes/leak_probe.ts`（`denyReadPaths` 与生产代码逐字一致）

**证据**
```
[OPPONENT SOURCE DIR (--b package)]      success=true stderr="READ_OK bytes=2928 sha=f12281af151d69c6"
[PREVIOUS MATCH SEALED PKG]              success=true stderr="READ_OK bytes=3308 sha=10790872d080fa9a"
[CURRENT MATCH SEALED ROOT (must be blocked)] success=true stderr="BLOCKED PermissionError ..."
[PLATFORM SOURCE (must be blocked)]      success=true stderr="BLOCKED PermissionError ..."
```
同一结论在整场沙箱探针中重现：`read_opp_source_pkg ALLOWED`、`read_tmp_secret ALLOWED`、`list_tmp ALLOWED`、`list_match_artifacts ALLOWED`（`/tmp/gb-audit/sandbox-probe.log`）。

**影响**
比赛公平性被破坏：选手算法可在运行期读取对手提交的算法并即时针对性构造反制；亦可跨场次窃取对手历史函数（`artifactRoot/matches/*/match.json` 含完整 `aFunction`/`bFunctionMath`）。Handoff §5 表格「读取对手密封包 BLOCKED」只在「当前场次 sealedRoot」这一狭窄条件下成立，属**以偏概全的成功声明**。

---

### P1-A｜产物只在整场比赛结束后一次性落盘（严重度：P1）

**现象**
`src/operator/cli.ts` 在 `while (engine.getWinner() === null)` 循环**之外**只调用一次 `persistArtifacts(dir, engine.getArtifacts())`（第 193 行）。任何中止（崩溃、操作员 Ctrl-C、进程被杀）都会丢失全部日志。

**证据**
P0-A 的两次复现中，`artifacts/` 只有 4 个密封副本文件，无 `match.json`/`audit.json`/`replay.json`；`MatchEngine` 自身也从不落盘（`persistArtifacts` 仅由 CLI 调用）。

**影响**
推翻 Handoff §8 Known Limitation #4「异常处置需操作员终止进程；已落盘的 `match.json` / `audit.json` / `replay.json` 仍完整可读」与「每轮都落盘」。比赛无法复盘的场景恰恰是最需要日志的异常场景。

---

### P1-B｜计时：后释放方被系统性计入释放交付延迟（严重度：P1，轻微但机制确定）

**现象**
`runDuel` 先 `runnerA.release(releaseNs)` 再 `runnerB.release(releaseNs)`，两侧 `computeTimeMs` 都以**同一个** `releaseNs` 为基准。B 的 `GO` 在墙上时间上晚到 `releaseSkewUs`，却被从 `releaseNs` 起算 → B 被多计约 `releaseSkewUs`。

**证据**
- 源码：`src/runner/SandboxRunner.ts:667-672`（`const releaseNs = ...; t0; runnerA.release; t1; runnerB.release`）。
- 实测：`releaseSkewUs median=22.208µs`，而 `timeDiffMs(A−B) median=−0.0185ms ≈ −releaseSkewUs`，`medianTimeB − medianTimeA = +24µs`。
- 与 `TIE_EPS_MS=0.05ms` 相比：并列判定吸收了大部分偏置，但「B 真实更快 <~22µs」的情形会被抹成并列（B 丢胜），「A 真实更快 28–72µs」会被放大成 A 胜。
- 符号检验：130 vs 137（p≈0.71），N=300 下噪声大于该效应，**无法在统计上确立方向**；但机制由构造决定。

**影响**
Handoff §6「不存在由 array order / Promise order / runner creation order 造成的系统性胜率偏差」不成立：机制客观存在且方向固定（恒对 B 不利）。属可接受的量级，但声明应改为「偏置 < ~80µs 且被 50µs 并列容差吸收」。

---

### P2-A｜被取消的回合记为 `INVALID_A` / `INVALID_B`（严重度：P2）

**现象**
Shooter 被先解者击杀后，该队回合结果写入 `RoundLog.result = 'INVALID_B'`（或 `INVALID_A`），与「算法输出非法」同码。

**证据**（我方 E2E `match.json`）
```
r2 result=INVALID_B first=A bFn=False cancB=True aHits=['B2']
r6 result=INVALID_A first=B aFn=False cancA=True bHits=['A1']
```
**影响**
下游消费者（计分、复盘、审计）会把「被取消」误读为「算法非法」，归因错误。Handoff P2-8 声称「显式区分 TIMEOUT/INVALID/TECHNICAL」，但取消语义并未独立编码（需同时读 `cancelledA/B` 才能还原）。

---

### P2-B｜有序射击循环中的取消守卫是死代码（严重度：P2）

**现象**
`src/core/Match.ts` 中 `if (!simultaneous && !shooter.alive) { cancelled[team]=true; ... }` 位于射击循环内，但击杀在循环**之后**才应用（`for (const id of killedSet) p.alive=false`），故 `shooter.alive` 在循环内恒为 `true`，该分支不可达。

**证据**
源码顺序（`Match.ts:471-490`）；我方 200 轮对局中 `cancelled*` 全部来自 `onFirstResult` 回调（`ShotCancelled` 审计事件 reason=`shooter eliminated by first solver`）。

**影响**
「死点开火」的唯一防线是**进程 kill**。我方以「瞬时求解器 + onFirstResult 恒返回 true」做了 120 轮定向测试，`bothSuccess=0`、每轮恰一方被取消，**未能复现**死点开火（见第 4 节）。因此本项按「潜在缺陷、未复现」记录，不单独判 P0。

---

### P3-A｜文档失实清单（Handoff 自身）

| # | Handoff 声明 | 实测 | 位置 |
|---|---|---|---|
| 1 | 「不崩溃」「每轮都落盘」 | 深 AST → 宿主崩溃、零落盘 | §4 僵局段、§8 |
| 2 | 「已落盘的产物仍完整可读」 | 中止即零产物（只在赛末落盘） | §8 Known Limitation #4 |
| 3 | 「stdout 截断至 256 KB」 | 实际上限 256KB，**保留内容被 `slice(0,4096)` 截到 4096 字节** | §5 表格 |
| 4 | 「替换原始包会触发哈希不匹配告警」 | 无任何告警/审计事件（源包在密封后不再复验） | `Package.ts` 模块注释 |
| 5 | `aFasterRate=0.480` 与同节 `aFasterRate = 0.510` | 同文档自相矛盾 | §6 |
| 6 | 「`releaseSkewUs` 是双方相对同一 releaseNs 的实际释放时刻偏差」（暗示无害） | 正是该偏差被计入后释放方耗时 | §6 |
| 7 | 「读取对手密封包 BLOCKED」 | 仅当前 sealedRoot 被拒；对手**源包**与上一场密封包可读 | §5 表格 |

---

### P3-B｜`Package.ts` 含 2 个裸 NUL 字节（严重度：P3）

`hashFileList` 的字段分隔符是真实的 `\x00`（偏移 2854、2864），源码视图/`cat`/`Read` 均不可见，`grep` 将文件判为二进制而静默跳过（`grep -rn hashFileList src/` 只命中 `src/index.ts`）。功能上 `\0` 分隔优于空格（可防路径/分隔符注入），但**不可见字符 + 二进制化**会削弱人工评审与静态检索，且未在 README/Handoff 中说明。审计方以 `\0` 分隔独立重算，哈希与 `hashFileList` 一致。

---

### P3-C｜`obstacleInField` 造成大量种子拒绝（严重度：P3）

生成器在「中心 ±3」内取心、半径/半宽最大 6，随后要求障碍完全落在场内，故拒绝率很高：easy 13.56%、medium 36.40%、**hard 60.92%**（`map_cause.ts`，300k/档）。`generateMapOrNull` 平均消耗 2.566 个种子/张（hard），最坏 20 个；300k 张 4.07s（74k 张/s）。**无正确性影响**（300,000 张独立判据 0 违规），仅属实现冗余（可直接夹取中心而非整种子丢弃）。

---

### P3-D｜其余观察

- 沙箱根遗留空父目录（`cleanupSandbox` 只删回合目录；`runs/AUDIT-ISO` 空目录保留）。
- macOS 注入 `SDKROOT/CPATH/LIBRARY_PATH/MANPATH/PWD/SHLVL/__CF_USER_TEXT_ENCODING`（Handoff 已如实记录；无密钥泄漏）。
- 生成器仅产出 rectangle/circle（segment/polygon 仅存在于 Judge/校验侧），Handoff 未声称会生成四类，不构成失实。

---

## 4. 未能验证项

| 项 | 原因 |
|---|---|
| UI 层（`AudienceScreenUI` / `MatchSetupUI` / `AudienceDisplay` 动画） | 无独立可观测契约，未构造探针 |
| P1-1 C² 校验、P1-4 多尺度跳变、P1-19 超时边界 | 仅跑通仓库测试，未自建判据 |
| P1-20 19 阶段全可达性 | 仅间接观察（回放 `phase` 字段 + 回合完成） |
| P1-25 `finishRound` 守卫 | 未构造非法转换攻击 |
| 取消竞态「死点开火」 | 120 次定向试验未复现（`cancel_contract.ts`），但**未证明不存在** |
| Linux 上的隔离与内存限制 | 环境仅 macOS Darwin |
| 换序实验 <10pp 的偏置 | N=100 的 95% 置信区间约 ±10pp |

---

## 5. P0/P1 逐条独立判定

### P0（12 条）

| Finding | 独立判定 | 依据 |
|---|---|---|
| P0-1 人类选择 Shooter 恒失败 | **真的修好了** | 自写 driver 走 CLI 提示符完成整场选人 |
| P0-2 Runner 输出协议 | **真的修好了** | 对象与 JSON 字符串两种 `dsl` 均被接受 |
| P0-3 官方 starter 非法 | **真的修好了** | 独立执行 3 组 shooter 位置，DSL 全部合法 |
| P0-4 永不结束、无击杀 | **真的修好了** | E2E 每轮有击杀且 7 回合结束；容差恰为 1e-6 |
| P0-5 上传无包校验 | **真的修好了** | 9 类负例全拒 + 正例/嵌套 entry 通过 |
| P0-6 包哈希不复验 | **真的修好了** | 7 类篡改全检出；中途替换密封副本抛错 |
| P0-7 无文件系统隔离 | **仍有问题** | 平台源码/密封根/写操作/网络均拦，但对手源包、上一场密封包、任意 `/tmp` 可读（P0-B） |
| P0-8 跨 Round 可持久化 | **真的修好了** | 回合目录销毁，回读 `FileNotFoundError` |
| P0-9 判定无视障碍物 | **真的修好了** | 四类障碍统一截断，前后关系正确 |
| P0-10 流水线是死代码 | **真的修好了** | 正式 CLI 完成全流程并落盘 |
| P0-11 消除/取消未实现 | **真的修好了** | 取消契约 120/120 生效；但循环内守卫为死代码（P2-B） |
| P0-12 A 选完即 LOCKED | **真的修好了** | 双方各自锁定后才可 START ROUND |

### P1（27 条）

| Finding | 独立判定 | 依据 |
|---|---|---|
| P1-1 C² 校验 | 未能验证 | 未自建判据 |
| P1-2 凸性 ≤100 | **真的修好了** | `sin(20x)` → `CONVEXITY_LIMIT`（conv=191） |
| P1-3 NaN/Infinity | **真的修好了** | `sqrt(-1)`/`div(1,0)`/`log(x<0)` 全拒 |
| P1-4 跳变检测 | 未能验证 | 未自建判据 |
| P1-5 采样混叠 | **真的修好了** | `sin(125.66x)` → `CONVEXITY_LIMIT`（conv=1199） |
| P1-6 单一 Judge | **真的修好了** | 旧模块确认删除，仅 `src/core/Judge.ts` |
| P1-7 四类障碍遮挡 | **真的修好了** | rect/circle/segment/polygon 全部 `OBSTACLE` |
| P1-8 击杀归属 | **真的修好了** | A 的 `aHits` 全为 B 点，反之亦然 |
| P1-9 容差统一 | **真的修好了** | 命中边界恰为 1e-6 |
| P1-10 计时顺序偏置 | **仍有问题** | 共享 `releaseNs` 已实现，但后释放方被计入 ~22µs（P1-B） |
| P1-11 内存限制 | **真的修好了** | 900MB → `MEMORY_LIMIT` |
| P1-12 孙进程成孤儿 | **真的修好了** | fork/subprocess 被拒 + 无残留进程 |
| P1-13 继承宿主环境 | **真的修好了** | 注入 3 个密钥变量均未泄漏 |
| P1-14 网络不受限 | **真的修好了** | DNS/TCP/UDP/bind 全拒 |
| P1-15 先解者语义 | **真的修好了** | 先解者先射击、取消生效 |
| P1-16 MatchLog 落盘 | **仍有问题** | 只在赛末一次性落盘（P1-A） |
| P1-17 `startLogging()` | **真的修好了** | 73 个审计事件覆盖全流程 |
| P1-18 Replay 不可用 | **真的修好了** | 密封包/沙箱删除后仍可加载，无重跑 |
| P1-19 超时口径 | 未能验证 | 仅跑仓库测试 |
| P1-20 19 阶段接线 | 间接验证 | 回合完成 + 回放 `phase` 字段 |
| P1-21 B 先开火判错胜者 | **真的修好了** | 存在 `first=B` 回合且结算一致 |
| P1-22 观众 UI | 未能验证 | 未构造探针 |
| P1-23 动画层 | 未能验证（开发方已声明 DEFERRED） | — |
| P1-24 结束前显示错误胜者 | 未能验证 | 未构造探针 |
| P1-25 `finishRound` 守卫 | 未能验证 | 未构造非法转换 |
| P1-26 MatchLog 哈希为空 | **真的修好了** | `match.json` 含真实 64 位包哈希 |
| P1-27 只校验本方半场 | 间接验证 | 校验区间覆盖整个射击区间 |

---

## 6. 最终判定

**FAIL**

1. 任何一支队伍用约 120KB 的合法 stdout（深度 ~6000 的 AST）即可让操作台进程崩溃、整场比赛无法完成，并在崩溃时**丢失全部 `match.json`/`audit.json`/`replay.json`**（P0-A + P1-A）；Preflight 阶段同样可触发。这同时推翻 Handoff「不崩溃」「每轮落盘」「已落盘产物仍完整可读」三条声明。
2. 沙箱隔离**不完整**：`denyReadPaths` 只覆盖当前 `sealedRoot` 与平台根目录，对手**源包**、上一场**密封包**、`/tmp` 任意文件、历史 `match.json` 均可被算法进程读取（P0-B），直接破坏比赛公平性与包密封的保密目的。
3. 计时机制存在方向固定的微小系统偏置（后释放方恒被计入 ~22µs 释放延迟），Handoff 的「不存在系统性偏差」结论不成立（P1-B，量级可接受但结论失实）。
4. 其余核心语义（选人、判定、障碍、四类障碍、容差、包校验、篡改检测、跨回合隔离、环境白名单、网络、内存、日志/回放、地图合法性 300k/0 违规）经独立探针**确认可用**，修复工作整体质量高、覆盖面广。
5. 依据判定阈值「任何 P0（比赛无法完成、隔离被破坏）→ 只能 FAIL」，本轮不得给 PASS，也不满足 CONDITIONAL PASS 的条件（存在未解决且影响比赛完整性的 P0 项）。

**解除 FAIL 的最小条件**
- 深度/节点限制必须在**递归下降之前**生效（解析改为显式栈或带深度上限的迭代解析），且解析异常必须被 `parseAlgorithmOutput` 捕获为 `INVALID_OUTPUT`，不得逃逸到操作台；
- `persistArtifacts` 至少每回合落盘一次（或崩溃处理器落盘）；
- `denyReadPaths` 必须包含双方 `sourceDir` 与 `artifactRoot`（而非仅 `sealedRoot`）；
- 上述三项各自需要一条独立回归测试，且审计方会用同样探针复测。
