# Re-Gate Cycle 3 Result

> 本文件由**独立审计 Agent**编写。审计对象是冻结候选树，审计职责到"给出判定"为止。
> 审计期间未修改任何生产代码、测试、构建脚本或既有文档；本文件是唯一写入仓库的文件。

---

## 1. 审计对象

| 项目 | 值 |
|------|-----|
| 仓库 | `/Users/jiayihuang/Downloads/几何斗殴` |
| 分支 | `main` |
| HEAD | `18c05629d3ce2d2d6ee9dddaf988fda59ff051e2`（短 SHA `18c0562`） |
| `git status --short` | **空**（审计开始时、每次突变还原后、审计结束时均复验为 clean） |
| 审计时间 | 2026-09-09 16:50 CST（探针与套件复跑区间 16:20–17:0x CST） |
| 运行时 | Node v22.23.2 / TypeScript 5.9.3 / Python 3.9.6 / Darwin 25.5.0 arm64 |

```text
$ git log --oneline -5
18c0562 docs: update V1 Remediation Handoff for Re-Gate Cycle 3 (freeze baseline)
19602b4 remediation(cycle 3): fix Re-Gate Cycle 2 FAIL (D-1 P1, D-2/D-3 P3)
2b44b77 docs: update V1 Remediation Handoff for Re-Gate Cycle 2 (freeze baseline)
5a7f0c3 remediation(cycle 2): fix Re-Gate Cycle 1 FAIL blockers (P0-A/B, P1-A/B, P2-A/B, P3-A..D)
be3c4a5 docs: V1 Remediation Handoff (freeze baseline for independent re-gate)
```

`git status --short` 为空 ⇒ 冻结成立，深审继续。审计对象为 **Freeze HEAD = 18c0562**。

---

## 2. 审计方法与自设计探针清单

**原则**：`Plans/V1 Remediation Handoff.md` 是被推翻的对象，不是证据。Cycles 1/2 均在其中发现失实陈述，
故本轮对**每一条**成功声明重新独立验证，不抽样、不引用仓库自带测试作为结论依据
（自带测试只作为"被审计对象"，另行做承重与突变验证）。

### 2.1 自设计探针（全部位于 `/tmp/gb-audit3/`，未进入仓库）

| 探针 | 目的 | 调用方式（必须在项目目录下执行） |
|------|------|------|
| `/tmp/gb-audit3/probes/d1_probe.ts` | D-1：`sandboxRoot` 在 `/tmp` 下时读/列任意 `/tmp`；SBPL 结构断言；反向对照 | `npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit3/probes/d1_probe.ts` |
| `/tmp/gb-audit3/probes/findings_probe.ts` | D-2（40/6000 层诊断）、D-3（`INVALID_A` ⇔ `aErrorCode` 不变量扫描） | 同上 |
| `/tmp/gb-audit3/probes/cheat_probe.ts` | 19 项作弊攻击矩阵（正式 `runDuel` 路径，判定标准 `blocked:*`） | 同上 |
| `/tmp/gb-audit3/probes/integrity_probe.ts` | 跨回合持久化 / 进程树 / stdout 洪泛 / 包篡改 | 同上 |
| `/tmp/gb-audit3/probes/timing_probe.ts` | 结构性（人为 40ms GO 间隔）+ 统计性（120 轮）计时公平 | 同上 |
| `/tmp/gb-audit3/probes/e2e_driver.py` | 模拟人类操作员，通过 CLI 公开提示符驱动完整对局 | `python3 /tmp/gb-audit3/probes/e2e_driver.py` |
| `/tmp/gb-audit3/e2e/team-alpha`、`team-beta` | 现场新建的算法包（非 starter / 非 fixture） | 由 CLI `--a/--b` 上传 |

> 探针不得写入仓库，`npx ts-node` 必须从项目目录启动（在 `/tmp` 下会解析到另一个 ts-node）。

### 2.2 突变验证方法（不触碰冻结树）

生产代码**从未在仓库内被修改**。突变在**逐字节相同的副本**上进行：

```bash
rsync -a --exclude node_modules --exclude .git /Users/jiayihuang/Downloads/几何斗殴/ /tmp/gb-audit3/mut/
ln -s /Users/jiayihuang/Downloads/几何斗殴/node_modules /tmp/gb-audit3/mut/node_modules
# 基线：未突变时套件必须通过
# 突变：python3 定点替换生产代码 → 跑套件 → 观察是否失败
# 还原：cp <repo>/<file> /tmp/gb-audit3/mut/<file> → diff -q 必须无差异
```

副本与仓库的一致性用 `diff -rq` 验证（唯一差异是 `.DS_Store`）；因此副本上的失败可归因于突变本身。
仓库内 `git status --short` 全程为空，无需 `git checkout --` 还原（没有任何需要还原的东西）。

---

## 3. 逐项结果（附实际输出）

### 3.1 用户点名的 16 个套件：存在 + 通过 + 承重

16 个点名套件全部存在（另加 `map-fairness`、`hostile-input` 共 18 个）：

```text
$ npm test            # tests/run-all.ts，18 个套件各自独立进程
  ✓ dsl-contract             0.6s
  ✓ convexity-aliasing       0.5s
  ✓ official-starter         2.0s
  ✓ map-fairness             0.6s
  ✓ obstacle-block           0.5s
  ✓ dual-shooter-selection   7.4s
  ✓ shooter-cancel           8.8s
  ✓ alive-kill              13.0s
  ✓ roundstate-equality      0.6s
  ✓ full-match-e2e          20.8s
  ✓ runner-isolation         9.1s
  ✓ cross-round-cheat       11.4s
  ✓ package-tamper           3.2s
  ✓ timeout-boundary         7.1s
  ✓ process-tree-cleanup    11.9s
  ✓ hostile-input            7.4s
  ✓ timing-fairness        516.9s
  ✓ replay                  25.4s

18/18 套件通过   （exit code 0）
```

**测试承重性静态核查**（生产代码中不得存在测试后门）：

```text
$ grep -rnE "NODE_ENV\s*===\s*['\"]test|__test|process\.env\.GB_TEST|__TEST__|jest\.|mockImplementation" src/
[无输出]

$ grep -rn "process\.env" src/
[无输出]          # 生产代码根本不读取任何环境变量，不存在环境开关
```

测试只通过正式公开 API（`MatchEngine` / `runDuel` / `parseCanonicalDSL` / CLI）驱动；无状态注入、
无 monkey patch、无 `__test` 导出。

**突变验证**（4 次突变，均在 `/tmp/gb-audit3/mut` 副本上）：

| 突变 | 目标生产代码 | 突变内容 | 套件结果 | 承重？ |
|------|--------------|----------|----------|--------|
| **M-1** | `src/core/Ast.ts` | `if (depth > LIMITS.MAX_DEPTH)` → `if (false && depth > LIMITS.MAX_DEPTH)`（取消递归前守卫） | `hostile-input` **5/6** | **是** |
| **M-2** | `src/runner/SandboxRunner.ts` | `selfPaths` 加回 `sandboxRoot` **且**删除 `SYSTEM_DENIES` 短路（复现 Cycle 2 D-1 缺陷） | `runner-isolation` **5/6** | **是（组合）** |
| **M-2a** | `src/runner/SandboxRunner.ts` | **仅** `selfPaths` 加回 `sandboxRoot`（短路保留） | `runner-isolation` **6/6 通过** | **否**（见 E-2） |
| **M-3** | `src/core/Match.ts` | `errorCodeFor` 去掉 `?? (success && !final ? 'INVALID_DSL' : null)` 回填（复现 Cycle 2 D-3 缺陷） | `hostile-input` **5/6** | **是** |

M-1 实际输出（D-2 用例失败，诊断退化为后置检查文案）：

```text
✗ hostile-input: 刚好超过深度上限的 AST 被确定性拒绝（P0-A 深度守卫）
    断言失败: 必须由递归前的深度守卫拒绝（诊断需指明拒绝层号），
    实际: A 算法输出不合法: 输出不是合法 DSL: DEPTH_LIMIT: AST 深度 41 超过限制 12
```

M-2 实际输出（D-1 用例失败，profile 中 `/private/tmp` 兜底 deny 被静默丢弃）：

```text
✗ runner-isolation: sandboxRoot 位于 /tmp 下时，任意 /tmp 读取仍被拒绝（D-1 回归）
    断言失败: sandboxRoot 位于 /tmp 下时仍必须保留系统兜底 deny，实际 profile:
    ...
    (deny file-read* (subpath "/Users"))
    (deny file-read* (subpath "/private/tmp/gb-iso-tmp-BuZLIO/sandboxes"))
    (deny file-read* (subpath "/private/var/tmp"))      ← /private/tmp 那条消失
```

M-2a 实际输出（**证伪 Handoff**：单独突变 `selfPaths` 一处，D-1 用例仍通过）：

```text
✓ runner-isolation: sandboxRoot 位于 /tmp 下时，任意 /tmp 读取仍被拒绝（D-1 回归） (1195ms)
runner-isolation: 6/6 passed
```

M-3 实际输出：

```text
✗ hostile-input: 输出可解析但非法时，错误码与回合结果一致（D-3 回归）
    断言失败: aErrorCode 必须与 INVALID_A 一致，不得为 null（D-3）
      期望: "INVALID_DSL"   实际: null
```

还原后逐文件 `diff -q` 全部无差异，仓库 `git status --short` 为空。

### 3.2 D-1（P1）：`sandboxRoot` 在 `/tmp` 下时任意 `/tmp` 读取仍被拒

```text
$ npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit3/probes/d1_probe.ts
--- SBPL profile (sandboxRoot under /tmp) ---
(deny default)
(deny network*)
(deny process-fork)
(allow file-read*)
(deny file-read* (subpath "/Users"))
(deny file-read* (subpath "/private/tmp/gb-audit3-d1-CIzsay/sandboxes"))
(deny file-read* (subpath "/private/tmp"))
(deny file-read* (subpath "/private/var/tmp"))
(allow file-read* (subpath ".../round-1/A-rji15g43"))
(allow file-write* (subpath ".../round-1/A-rji15g43/work"))
--- structural assertions ---
has (deny file-read* (subpath "/private/tmp")) = true
has (deny file-read* (subpath "/private/var/tmp")) = true
[TMP-ATTACK] sandboxRoot=/tmp/gb-audit3-d1-CIzsay/sandboxes
[TMP-ATTACK] preflight.ok = true
[REVERSE-CONTROL] preflight.ok = false
[REVERSE-CONTROL] errors = A 算法无法正常运行: 算法异常退出 (code=1): LEAK:ctrl_dir:/var/folders/.../gb-audit3-ctrl-YximAq
```

结论：**D-1 已修复**。① 结构断言：`sandboxRoot` 位于 `/tmp` 下时 profile 仍保留
`/private/tmp` 与 `/private/var/tmp` 两条兜底 deny；② 行为断言：探针在真实沙箱内读取/列举任意
非 deny 的 `/tmp` 文件全部被拒；③ **反向对照** `LEAK:ctrl_dir` 证明探针确实执行了（不是"算法自己没做"）。

### 3.3 D-2（P3）：深层 AST 诊断必须来自递归前的深度守卫

```text
$ npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit3/probes/findings_probe.ts
--- D-2 (40-layer AST, official preflight) ---
preflight.ok = false
A error = A 算法输出不合法: 输出不是合法 DSL: DEPTH_LIMIT: AST 深度超过限制 12（在第 13 层拒绝，未展开）
D2 has depth-guard marker /在第 \d+ 层拒绝/ = true
D2 has shooter-check text /相差/ = false
--- D-2 (6000-layer AST) ---
A error = A 算法无法正常运行: 算法输出的 DSL 嵌套过深，无法序列化（超出深度上限）
```

结论：**D-2 已修复**。40 层用例由 `parseNode` 入口守卫在**第 13 层**拒绝（`MAX_DEPTH=12`），
文案不含 Shooter 校验的"相差"，排除"先解析成功再被 Shooter 拒绝"的伪阳性；
6000 层走 `parseAlgorithmOutput` 的 stringify 归因分支，不再伪装成格式错误。M-1 证明该断言承重。

### 3.4 D-3（P3）：`result = INVALID_A` ⇒ `aErrorCode ≠ null`

```text
--- D-3 (forbidden operator, official round) ---
result = INVALID_A  aErrorCode = INVALID_DSL  aFunction = null
D3 consistent = true
--- D-3 invariant sweep ---
  nan:       result=INVALID_A aErrorCode=INVALID_DSL    invariant=true
  badvalue:  result=INVALID_A aErrorCode=INVALID_DSL    invariant=true
  notthrough:result=INVALID_A aErrorCode=INVALID_DSL    invariant=true
  garbage:   result=INVALID_A aErrorCode=INVALID_OUTPUT invariant=true
```

结论：**D-3 已修复**。M-3 证明该断言承重。

### 3.5 作弊再门禁（判定标准：平台/沙箱拒绝，而非"算法选择不做"）

```text
$ npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit3/probes/cheat_probe.ts
=== A) OFFICIAL PATH (MatchEngine.preflight) ===
preflight.ok = true
=== B) DETAILED ATTACK MATRIX (production runDuel) ===
  read_opp_source        blocked:PermissionError
  list_opp_source        blocked:PermissionError
  read_opp_sealed        blocked:PermissionError
  read_prev_match        blocked:PermissionError
  read_artifact_root     blocked:PermissionError
  read_judge_src         blocked:PermissionError
  read_users_home_file   blocked:PermissionError
  list_sandbox_root      blocked:PermissionError
  list_sealed_root       blocked:PermissionError
  write_project          blocked:PermissionError
  write_host_home        blocked:PermissionError
  write_shared_tmp       blocked:PermissionError
  write_outside_work     blocked:PermissionError
  fork_child             blocked:PermissionError
  spawn_subprocess       blocked:PermissionError
  network_connect        blocked:PermissionError
  read_etc_passwd        allowed
  read_own_pkg           allowed
  write_own_work         allowed
host-side marker files exist? project= false hostHome= false sharedTmp= false
```

结论：**16/16 攻击全部 BLOCKED**，且 3 个对照项按预期 allowed（证明探针确实执行）。
覆盖对手包/历史产物/宿主文件、项目目录与 `$HOME` 写入、`fork`/`subprocess`、`connect`、跨回合、
stdout 洪泛、进程树残留、包篡改。`read_etc_passwd = allowed` 为非阻塞观察（见 O-2）。

补充（`integrity_probe.ts`）：

```text
=== 1) CROSS-ROUND ===
  round-1 sandbox dir exists after duel = false
  sandboxRoot entries after duel = []
  round-2 read of round-1 file: success= true stderr= cross_round_read -> FileNotFoundError
=== 2) PROCESS TREE ===
  spawn attempt stderr = spawn -> PermissionError
  leftover processes matching marker = (none)
=== 3) STDOUT FLOOD ===
  success= false errorCode= OUTPUT_TOO_LARGE returned stdout bytes= 4096 other side ok= true
=== 4) PACKAGE TAMPER ===
  verifySeal before tamper = {"ok":true,...}
  verifySeal after tamper  = {"ok":false,"errors":["密封副本已被篡改：期望 ...，实际 ..."]}
  runRound with tampered seal threw = A 算法包在比赛期间被篡改: ...
```

### 3.6 地图生成器压力（`npm run stress`）

```text
Requested:        300,000
Generated:        300,000
Invalid maps:     0   <-- 必须为 0
Clean failures:   0
Seed retries:     227809
Elapsed:          6.0s
RESULT: PASS — generator 输出 0 张非法地图
```

结论：**≥300,000 张、0 张非法**（实测值，独立于 Handoff 记录；Handoff 的 5.8s 为不同机器负载下的记录）。

### 3.7 正式 E2E（干净启动 → 完整对局 → 停机 → 重启 → 回放）

使用现场新建、**不属于仓库**的算法包 `/tmp/gb-audit3/e2e/team-{alpha,beta}`，全程只用正式入口
`npx ts-node src/operator/cli.ts`，Shooter 由模拟人类操作员通过 CLI 公开提示符
（`Team A 选择 Shooter (点 id):`、`裁判确认 —— 按回车 START ROUND...`）逐个输入；
未改生产代码/内部 JSON/DB，未注入状态，未 monkey patch，未使用测试后门。

```text
  WINNER: B
  Rounds: 6   Kills: A=5 B=6
  Artifacts: /tmp/gb-audit3/e2e/artifacts/matches/MATCH-MTTUSNKP-30QS6G
```

产物核查（独立读取）：

```text
matchId MATCH-MTTUSNKP-30QS6G  winner B  rounds 6  finalAlive {'A': 0, 'B': 1}
audit events 61        （seq 严格递增，类型覆盖 MatchCreated→…→MatchEnded）
replay frames 6
hashes ac0c513bd5cd8d6b... / d3ffb07f0c3a0529...（均为完整 64 位十六进制）
```

停机 → 重启 → 回放（**新进程**；算法包已改名为 `.hidden`、沙箱目录已删除）：

```text
$ ls -d /tmp/gb-audit3/e2e/team-alpha /tmp/gb-audit3/e2e/team-beta
ls: /tmp/gb-audit3/e2e/team-alpha: No such file or directory
ls: /tmp/gb-audit3/e2e/team-beta: No such file or directory

$ npx ts-node src/operator/cli.ts --replay /tmp/gb-audit3/e2e/artifacts/matches/MATCH-MTTUSNKP-30QS6G
═══ REPLAY MATCH-MTTUSNKP-30QS6G — winner B (6 rounds) ═══
── ROUND 1 ──
  f_A(x) = -5.320655070245266 + -0.24836459862129737 * (x - -8.724981233943254)
  t_A=22.774ms  t_B=19.350ms  first=B
  hits A=[B2] B=[A4]   killed=[A4,B2] cancelled A=false B=false
  ...
  alive after: B1
（回放为只读记录，未重新运行任何算法）
REPLAY_EXIT=0
```

结论：**E2E 全链路通过**。回放不重跑算法（算法包与沙箱均已不存在，退出码 0）。

### 3.8 计时公平："每方以自己的 GO 起算"是真实的，不是文档

```text
$ npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit3/probes/timing_probe.ts
=== STRUCTURAL (deliberate 40ms GO gap) ===
  GO gap recorded (nsB-nsA) = 41.10 ms
  computeTimeMs A = 8.480  B = 5.583
  |A-B| = 2.897 ms (shared min(releaseNs) would show ~40ms bias)
  release() idempotent = true
```

若双方共用 `min(releaseNs)`，后释放方会被多计约 40ms；实测两侧耗时差仅 2.9ms ⇒ **各自起算成立**。
统计口径（三次独立 120 轮运行）：`aFasterRate = 0.517 / 0.633 / 0.575`，
`median(timeA-timeB) = -0.005 / -0.108 / -0.045 ms`（基准耗时约 5ms，差值 ≤ 2%，属宿主调度噪声）。
仓库自带套件（300 轮，本轮实跑）与换序配对（150 对）是决定性的：

```text
[fairness] rounds=300 releaseSkewUs(median=21.708 p95=37.125) timeDiffMs(median=-0.008 p95=0.437)
           medianTimeA=5.06ms medianTimeB=5.08ms aFasterRate=0.527
[fairness-swap] pairs=150 X胜率(当A)=0.497 X胜率(当B)=0.510 Δ=0.013
```

同一张地图换序后胜率差 Δ=0.013（< 0.05）⇒ 不存在由数组顺序/进程创建顺序造成的系统性偏差。
结论：**计时公平性成立**。注意：README 对"从哪个 GO 起算"的描述失实（见 E-4）。

### 3.9 Handoff §1–§9 逐条核对

| 节 | 声明 | 独立核验 | 结论 |
|----|------|----------|------|
| §1 | 起点 `9a3e5b9`、C1 `0db2dbe`、C2 `5a7f0c3`、C3 `19602b4`、分支 `main`、clean、Node v22/TS5/Py3.9.6/Darwin 25.5.0 arm64 | 全部 `git log -1 <sha>` 命中；`git status --short` 空；版本实测一致 | 属实 |
| §2 | 12/12 P0、27/27 P1、24/26 P2、11/14 P3 的修复与回归测试映射 | 对应套件全部存在且通过；抽查的 D-1/D-2/D-3 突变承重成立 | 大体属实（P2-15、P3-14 两项见 §4） |
| §3 | 8 轮对局 `MATCH-MTTU393K-BXZUQX`、winner B、84 事件、8 帧、包哈希 | 直接读取 `/tmp/gb-e2e/artifacts-cycle3/.../MATCH-MTTU393K-BXZUQX`：winner B、rounds 8、finalAlive `{A:0,B:6}`、84 事件、8 帧、哈希逐字符一致、`replay.json` 中 `solver.py/manifest.json/__gb_bootstrap/__gb_profile/sandboxes/python3` 命中数均为 0 | 属实 |
| §4 | P2-18/P2-21/P3-14 未修；僵局为规范缺口 | 见 O-4…O-7；僵局已独立复现（自建直线解算器在多个 seed 下不终止） | 属实（除 P3-14 的"oracle 已入回归"，见 E-3） |
| §5 | 6/5/3/6 tests；攻击表；env 白名单；进程组/RSS | 测试计数实测 6/5/3/6；`scrubEnv` 只保留 `PATH/HOME/TMPDIR/LANG/LC_ALL/PYTHON*/GB_TEAM`；探针复跑全部 BLOCKED | 属实 |
| §6 | 300 轮 + 150 对；`aFasterRate≈0.5`；压力 300k/0；"可用 `ROUNDS_ORDER`/`ROUNDS_SWAP` 放大" | 数值属实；**环境变量名失实**（见 E-1） | 部分失实 |
| §7 | 18/18 套件；套件-文件映射；"放大命令 `ROUNDS_ORDER=1000 ROUNDS_SWAP=500 …`" | 18/18 属实、映射属实；**命令无效**（见 E-1） | 部分失实 |
| §8 | 8 条已知限制 | 逐条核验属实（`668/790` 回合为对方包的历史记录，未能逐位复现，但僵局现象已独立复现） | 属实 |
| §9 | `git diff --stat 19602b4..HEAD` 只有 2 个文件 | 实测 `Plans/Re-Gate Cycle 2 Result.md` + `Plans/V1 Remediation Handoff.md`，共 2 files changed | 属实 |

### 3.10 声明限制的评估（可接受边界 vs 阻塞）

| 限制 | 评估 |
|------|------|
| 僵局规范缺口 | **可接受边界**（规范层，非实现缺陷）：平台不误判胜负、每回合落盘、不崩溃。但**赛事必须**在规则中补一条人工介入/终止条件（见 O-4）。 |
| P2-18 裁判控制面不完整 | **可接受**：正式比赛路径完整；异常时操作员可终止进程，且截至上一完成回合的产物可读（已实测每回合落盘）。 |
| P2-21 动画未接线 | **可接受**：纯视觉层，用户已明确推迟。 |
| P3-14 未覆盖领域 | **可接受但须如实记录**：无构造性 DoS 测试 ⇒ 不等于"不存在"，仅表示未发现入口。 |
| 依赖 macOS `sandbox-exec` | **部署边界**：本次赛事环境为 Darwin，成立；迁移 Linux 必须重新验证隔离与内存限制。 |

---

## 4. Handoff 失实清单

| # | 位置 | 声明 | 实测 | 复现命令 | 等级 |
|---|------|------|------|----------|------|
| **H-1** | §6 第 399 行、§7 第 519 行 | 可用 `ROUNDS_ORDER` / `ROUNDS_SWAP` 环境变量放大；`ROUNDS_ORDER=1000 ROUNDS_SWAP=500 npx ts-node tests/timing-fairness.ts` | 套件只读 `GB_FAIRNESS_ROUNDS` / `GB_FAIRNESS_SWAP_ROUNDS` / `GB_FAIRNESS_MIN`；`ROUNDS_ORDER`/`ROUNDS_SWAP` 被完全忽略 | 见下方 E-1 | **阻塞（E-1）** |
| **H-2** | §2 Cycle 3 表 D-1 行（第 193 行） | "①…②…**二者均为承重点：突变任一处，D-1 回归用例即失败**" | 只突变 ①（`selfPaths` 加回 `sandboxRoot`、保留短路）时 `runner-isolation` **6/6 通过** | 见下方 E-2 | **阻塞（E-2）** |
| **H-3** | §2 P3-14 行（第 165 行）、§4 P3-14 行（第 315 行） | "数值 oracle（30 AST × 13 点 × 390 次比对）**已入常驻回归**"，回归测试列 `dsl-contract` | `tests/` 中不存在该 oracle：全仓无 `390`/`oracle` 字样，`evaluateNode` 在测试中仅 3 处单点断言；390/390 oracle 属 Plan 1 审计探针 `x19.ts`（不在仓库） | 见下方 E-3 | **阻塞（E-3）** |
| **H-4** | §2 P2-15 行（第 135 行） | "83 事件覆盖全流程" | 同一文档 §3 记 84 事件（8 轮）；本轮 6 轮对局为 61 事件。83 为陈旧数字 | `grep -n "83 事件\|84 事件" "Plans/V1 Remediation Handoff.md"` | 非阻塞（O-1） |
| **H-5** | `README.md` 第 130、198 行（非 Handoff，但属"既有文档"） | "单次计算超时 2000 ms（**从共享 GO 时刻起算**）"、"由宿主写入同一个 GO 时刻；**两侧计时相对同一时刻起算**" | 实现为每方以自己 `release()` 返回的 GO 时刻起算（`SandboxRunner.ts` 每 runner 独立 `releaseNs`；`releaseSkewUs` 仅为诊断量） | 见下方 E-4 | **阻塞（E-4）** |

> 说明：H-1…H-3、H-5 均为"纯文档失实"，不改变代码行为，但会误导复现者/审计者与赛事操作员，
> 属用户判据中的"至少阻塞"。H-4 为措辞/陈旧数字，P3。

---

## 5. 阻塞项

### E-1（文档失实 / 可复现性）：公平性套件的"放大"环境变量名错误，命令静默失效

- **现象**：Handoff §6 与 §7 两处声明可用 `ROUNDS_ORDER` / `ROUNDS_SWAP` 放大样本，
  并给出命令 `ROUNDS_ORDER=1000 ROUNDS_SWAP=500 npx ts-node tests/timing-fairness.ts`。
  实际套件只读 `GB_FAIRNESS_ROUNDS` / `GB_FAIRNESS_SWAP_ROUNDS`（默认 300 / 150）。
- **复现命令**：

  ```bash
  # 同时设置"文档名"与"真实名"，看套件标题用的是哪个
  GB_FAIRNESS_ROUNDS=5 GB_FAIRNESS_SWAP_ROUNDS=5 GB_FAIRNESS_MIN=1 \
  ROUNDS_ORDER=9 ROUNDS_SWAP=9 npx ts-node tests/timing-fairness.ts
  ```

- **实际输出**：

  ```text
  ✓ timing-fairness: 同算法对局 5 轮 —— 释放偏差与耗时对称
  ✓ timing-fairness: 配对换序 5×2 轮 —— 胜率无顺序偏移
  ```

  另：`ROUNDS_ORDER=7 ROUNDS_SWAP=7` 单独运行时，25s 内首个用例仍未结束（仍按 300 轮在跑）。

- **为何影响审计可信度**：按 §7 的"放大验证命令"执行会**静默使用默认样本量**，
  执行者却以为已放大到 1000/500 轮，从而得到虚假的"已加大样本验证"结论。
- **建议解除条件**：把 §6/§7 的变量名与命令改为 `GB_FAIRNESS_ROUNDS` / `GB_FAIRNESS_SWAP_ROUNDS`
  （可选补充 `GB_FAIRNESS_MIN`），并在套件 README/注释中固化；或反向让套件同时接受文档中的别名。

### E-2（文档失实）：D-1 的"突变任一处即失败"不成立

- **现象**：Handoff §2 Cycle 3 表 D-1 行声明两个修复组件"均为承重点：突变任一处，
  D-1 回归用例即失败"。实测**仅**突变组件 ①（`selfPaths` 加回 `sandboxRoot`）时，
  D-1 回归用例仍然通过——因为组件 ②（`SYSTEM_DENIES` 短路）会独立保住 `/private/tmp` 这条 deny。
- **复现命令**（在 `/tmp/gb-audit3/mut` 副本上）：

  ```bash
  # 仅把 selfPaths 改回缺陷形态，保留 SYSTEM_DENIES 短路
  python3 - <<'EOF'
  p='/tmp/gb-audit3/mut/src/runner/SandboxRunner.ts'
  s=open(p).read().replace("  const selfPaths = [sandboxDir, work];",
                           "  const selfPaths = [sandboxDir, work, sandboxRoot];")
  open(p,'w').write(s)
  EOF
  cd /tmp/gb-audit3/mut && npx ts-node tests/runner-isolation.ts
  ```

- **实际输出**：

  ```text
  ✓ runner-isolation: sandboxRoot 位于 /tmp 下时，任意 /tmp 读取仍被拒绝（D-1 回归） (1195ms)
  runner-isolation: 6/6 passed
  ```

- **为何影响审计可信度**：这是对"突变承重验证"本身的过度声明——审计者若据此认为两个组件
  都已被独立承重，会高估回归测试的判别力（真正承重的只有短路一处）。
- **建议解除条件**：把该句改为"组件 ② 为承重点：突变它会使 D-1 用例失败；
  组件 ① 与 ② 共同构成修复，但仅突变 ① 不足以触发失败"，或补充一条只针对 ① 的独立断言。

### E-3（文档失实）：声称"数值 oracle 已入常驻回归"，实际不存在

- **现象**：Handoff §2 P3-14 行与 §4 P3-14 行均称"数值 oracle（30 AST × 13 点 × 390 次比对）
  已入常驻回归"，回归测试列 `dsl-contract`。仓库 `tests/` 中**不存在**该 oracle。
- **复现命令**：

  ```bash
  grep -rn "390\|oracle\|Oracle" tests/ src/ ; echo "[end]"          # 无输出
  grep -rn "evaluateNode" tests/*.ts                                  # 仅 3 处单点断言
  ls -d _gate-audit-2                                                # No such file or directory
  ```

- **实际输出**：`grep` 无任何命中；`evaluateNode` 在测试中仅出现于 `dsl-contract.ts`
  的 `x=3 / x=5 / x=-12` 三处点值断言。390/390 oracle 实为 Plan 1 审计探针
  `Plans/Plan 1 Gate 工作日志.md` 中的 `x19.ts`（不在仓库、非常驻回归）。
- **为何影响审计可信度**：把一次性审计探针声称为"常驻回归"，直接虚增了 P3-14 的覆盖度，
  使"数值正确性已纳入持续回归"这一结论不成立。
- **建议解除条件**：要么把数值 oracle 真正落为 `tests/` 下的常驻用例（≥30 AST × ≥13 点与
  独立 JS 参考实现逐点比对），要么把两处措辞改为"该 oracle 属 Plan 1 审计探针，未入常驻回归"。

### E-4（文档失实 / 公平性机制被误述）：README 称计时"从共享 GO 时刻起算"

- **现象**：`README.md` 第 130 行"单次计算超时 | 2000 ms（**从共享 GO 时刻起算**）"、
  第 198 行"由宿主写入同一个 GO 时刻；**两侧计时相对同一时刻起算**"。
  这与实现（每方以自己 `release()` 的 GO 时刻起算）以及 Handoff §2 的
  P1-10 / P1-19 / P1-B（"从本队自己的 GO 时刻起算（Cycle 2 修正）"）直接矛盾——
  描述的正是 Cycle 1 已修复的偏置形态。
- **复现命令**：

  ```bash
  grep -n "共享\|自己的 GO\|GO 时刻" README.md
  grep -n "releaseNs" src/runner/SandboxRunner.ts   # 每个 runner 各自 releaseNs
  ```

- **实际输出**：

  ```text
  README.md:130:| 单次计算超时 | 2000 ms（从共享 GO 时刻起算） |
  README.md:198:- 双方进程都完成 READY 握手后，由宿主写入同一个 GO 时刻；两侧计时相对同一时刻起算，

  src/runner/SandboxRunner.ts:615:      if (released) return releaseNs ?? process.hrtime.bigint();
  src/runner/SandboxRunner.ts:618:      releaseNs = process.hrtime.bigint();
  src/runner/SandboxRunner.ts:481:      computeTimeMs: releaseNs !== null ? Number(process.hrtime.bigint() - releaseNs) / 1e6 : ...
  ```

- **为何影响审计可信度**：README 是赛事操作员与参赛者的第一手文档；把公平性核心机制
  （各自起算）误述为已被废除的共享起算，会让读者对计时口径产生错误认知，也与
  Handoff 自身的修复声明冲突。
- **建议解除条件**：把 README 两处改为"每方以自己 `release()` 返回的 GO 时刻起算；
  `releaseSkewUs` 仅为诊断量，不参与计时"。

---

## 6. 非阻塞观察

- **O-1（P3，措辞）**：Handoff §2 P2-15"83 事件"与 §3"84 事件"自相矛盾（8 轮=84，6 轮=61）。建议改为与 §3 一致。
- **O-2（P3）**：沙箱内 `read_etc_passwd = allowed`（`/etc/passwd` 可读）。非竞赛机密、无对手数据，
  但 README"只允许读自己的包"属简化表述；如需严格，可把 `/etc` 纳入兜底 deny。
- **O-3（P3）**：进程被 SIGKILL 中止时（如 `hostile-input` 的 CLI 用例），默认沙箱根会残留
  `<matchId>` 目录（正常回合结束时 `readdirSync(sandboxRoot)` 为空，已由 `cross-round-cheat` 断言）。
  因 `sandboxRoot` 被整体 deny，残留不构成泄漏；建议定期清理或接受该行为并文档化。
- **O-4（规范层，须赛事规则确认）**：僵局无自动终止。平台行为已如实限定（不误判胜负、每回合落盘、
  病态载荷记 `INVALID_OUTPUT`）。**建议**：赛事规则补充"人工介入/终止条件"后方可用于正式比赛。
- **O-5（P2-18）**：无 `PAUSE`/`RESUME`/`END MATCH`（已 grep 确认）。可接受，操作员可终止进程。
- **O-6（P2-21）**：动画未接线。可接受（视觉层，用户已推迟）。
- **O-7（P3-14）**：无"病态但合法 DSL 使 Judge 卡死"的构造性测试。可接受但不得外推为"不存在"。
- **O-8（部署边界）**：依赖 macOS `sandbox-exec`；迁移 Linux 必须重新验证隔离与内存限制路径。
- **O-9（P3-C）**：`obstacleInField` 拒绝率高未修，无正确性影响（300k/0 非法）。

---

## 7. 最终判定

**CONDITIONAL PASS**

理由：**实现层全部独立核验通过** —— 16 个点名套件存在且通过（18/18）、无测试后门、
关键断言突变承重成立、D-1/D-2/D-3 均已修复、作弊矩阵 16/16 BLOCKED、
压力 300k/0 非法、正式 E2E 全链路（含停机重启回放）通过、计时公平性成立。
**不存在**影响竞赛完整性的可利用隔离/判定/计时/作弊漏洞、崩溃、数据丢失或可伪造结果。

但存在 4 条**纯文档失实**（E-1…E-4），按用户判据"至少阻塞"，故不给出
`PASS — COMPETITION READY`。上述 4 条全部为文档更正（无需改代码），
完成后即可转为 `PASS — COMPETITION READY`。

---

## 8. 未修改生产代码声明

**声明**：本次审计**未修改**仓库内任何生产代码、测试、构建脚本或既有文档。
突变验证全部在逐字节相同的 `/tmp/gb-audit3/mut` 副本上进行（副本经 `diff -rq` 与仓库比对，
唯一差异为 `.DS_Store`），因此**不存在需要 `git checkout --` 还原的仓库改动**。
本文件 `Plans/Re-Gate Cycle 3 Result.md` 是唯一写入仓库的文件（审计报告本身）。

**证据**：

```text
# 审计开始 / 每次突变后 / 审计结束（写本文件之前）
$ git status --short
[空]

# 突变副本与仓库的一致性（还原后）
$ diff -rq --exclude node_modules --exclude .git /Users/jiayihuang/Downloads/几何斗殴 /tmp/gb-audit3/mut
Only in /Users/jiayihuang/Downloads/几何斗殴: .DS_Store

# 写本文件之后
$ git status --short
?? "Plans/Re-Gate Cycle 3 Result.md"      ← 仅审计报告本身（git 因路径含空格加引号）
```
