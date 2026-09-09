# Geometry Battle V1 — Re-Gate Cycle 2 独立审计报告

- 审计角色：独立审计代理（对抗性；**未编写本仓库任何一行代码**）
- 审计日期：2026-09-09
- 审计对象：`Plans/Output/V1 Remediation Handoff.md` 的全部成功声明
- 仓库：`/Users/jiayihuang/Downloads/几何斗殴/`
- 判定标准：**主动尝试推翻每一条声明**；只有全部尝试失败且无 P0/P1 才写 PASS。

---

## 1. 最终判定（Verdict）

> **FAIL — 不授予 `COMPETITION READY`。**

- **阻塞项：1 条 P1**（隔离缺陷，见第 12 节 D-1）：`buildProfile` 的 `covers()` 自保护过滤
  会在 `sandboxRoot` 位于 `/tmp` 之下时**静默丢弃系统兜底 deny `/private/tmp`**，
  使沙箱内算法可读取任意未被显式 deny 的 `/tmp` 文件，**包括其他场次的密封包**。
  已通过官方 `MatchEngine` 路径端到端复现（读到 `{"name":"other-match-team-B",...}`）。
- 其余**全部核验项通过**：Cycle 1 的四项移除条件 (a)(b)(c)(d) 均达成，
  7 处更正声明逐条属实，计时公平性、地图生成器 30 万张、取消语义、
  密封/防篡改、完整 E2E 与只读回放均无缺陷。
- 另有 2 条 P3（非阻塞）：集成层深度回归测试不承重、诊断字段不一致。
- **默认 macOS 环境（`TMPDIR=/var/folders/...`）不触发该 P1**；
  但 `env -u TMPDIR`、`TMPDIR=/tmp`、cron/CI/容器等场景会触发。
  修复条件见第 12 节 D-1「移除条件」。

---

## 2. 基线冻结校验

| 项目 | 要求 | 实测 | 结论 |
|---|---|---|---|
| `git rev-parse HEAD` | `2b44b77dbe9b5121bd252be06070b095d39cbaf0` | `2b44b77dbe9b5121bd252be06070b095d39cbaf0` | ✅ |
| `git branch --show-current` | `main` | `main` | ✅ |
| `git status --short` | 空 | 空（0 行） | ✅ |

基线冻结成立，审计在冻结基线上进行。

**审计纪律声明**：本次审计**未修改任何生产代码、测试、配置、脚本**。
唯一的仓库内写入是本报告 `Plans/Output/Re-Gate Cycle 2 Result.md`。
所有探针脚本位于 `/tmp/gb-audit2/`。突变实验在 `/tmp/gb-audit2/mutant`（rsync 副本 + 软链
`node_modules`）中进行，不触碰原仓库。

> 过程披露：一次探针的路径替换失误曾在仓库根临时生成 `art/ deep13/ deep40/ starterX/ sb/`
> 五个目录（均为探针数据，非源码）。已全部删除；删除后重新校验
> `git status --short` 为空、`HEAD` 未变。原仓库内容与基线一致。

---

## 3. 审计方法

不依赖仓库自带测试的结论。自写探针（`/tmp/gb-audit2/probes/`）：

| 探针 | 用途 |
|---|---|
| `deep_probe.ts` | (a) 超深 DSL：6000 层对象 / 6000 层字符串 / 10 万层数组，走官方 `MatchEngine` |
| `abort_probe.ts` | (b) 中止路径产物落盘 |
| `iso_probe.ts` | (c) 官方 `MatchEngine.preflight` 下的越界矩阵 + 反向对照 |
| `profile_dump.ts` | 直接 dump `prepareSandbox` 生成的 SBPL 文本 |
| `xmatch_probe.ts` / `xmatch_default.ts` | 跨场次密封包读取（`sandboxRoot` 在 `/tmp` 下 vs 默认） |
| `sym_timing_probe.ts` | 计时公平性（对称固定工作量包，120 轮 + 150 对换序） |
| `map_stress_probe.ts` | 30 万张地图，**自写**合法性判据 |
| `cancel_probe.ts` | 取消语义 17 项（单元 + 集成） |
| `tamper_probe.ts` | 密封哈希 / 篡改检测 |
| `seed_search.ts` | 用官方 `generateMapOrNull` 离线搜索「必然终局」种子，供 E2E 使用 |
| `mutant_*.ts` / `dsl-contract` 等 | (d) 突变实验：确认回归测试会因缺陷而失败 |

判定标准统一为：**真实发起攻击 / 真实构造缺陷**，而不是"算法自己选择不做"。

---

## 4. 移除条件 (a)：深度 / 节点限制先于递归下降

**结论：PASS（生产行为正确）。**

代码复核：

- `src/core/Ast.ts:132-138`：`parseNode(raw, issues, depth)` 的**第一件事**就是
  `if (depth > LIMITS.MAX_DEPTH) { issues.push({code:'DEPTH_LIMIT', ...}); return null; }`
  —— 守卫在递归展开**之前**，递归深度被硬性限制在 `MAX_DEPTH+1` 帧内。
- `src/core/Ast.ts:257`：`complexity.depth > LIMITS.MAX_DEPTH` 的第二道防线（递归之后）。
- `src/runner/SandboxRunner.ts:308-351`：`parseAlgorithmOutput` 把
  「解析失败」与「序列化失败（`sawDslUnserializable`）」分开，后者归因为
  `算法输出的 DSL 嵌套过深，无法序列化（超出深度上限）`。

独立探针实测（官方 `MatchEngine` / CLI 路径）：

| 载荷 | 实测 |
|---|---|
| 6000 层嵌套对象 | `result: INVALID_A`，`aErrorCode: INVALID_OUTPUT`，无宿主异常逃逸 |
| 10 万层嵌套数组 | `result: INVALID_A`，`aErrorCode: INVALID_OUTPUT` |
| always-deep 6000（Preflight 阶段） | `preflight.ok=false`，错误串 = `算法输出的 DSL 嵌套过深，无法序列化（超出深度上限）` —— **归因到「嵌套过深」而非「缺少 dsl 字段」** |
| 6000 层字符串 | `result: INVALID_A`，但 `aErrorCode: null`（见 P3-D3） |

探针结束打印 `ALL PROBES COMPLETED WITHOUT HOST CRASH`；无 `RangeError` 逃逸到控制台。

---

## 5. 移除条件 (b)：逐回合落盘（含中止 / 异常路径）

**结论：PASS。**

`src/operator/cli.ts` 共 4 处 `persistNow(engine)`：`startMatch` 后（179）、每回合后（214）、
赛末（218）、`catch` 中止路径（235）。

独立探针（真实中止：第 3 回合杀掉宿主进程）：

| 产物 | 实测 |
|---|---|
| `match.json` | 可解析，3427 B，`rounds=3`，`winner=draw`，逐回合 `INVALID_A,INVALID_A,INVALID_A` |
| `audit.json` | 可解析，7823 B，32 个事件 |
| `replay.json` | 可解析，126332 B，3 帧 |

`host stack trace in output: false` —— 中止路径不泄漏宿主栈。

---

## 6. 移除条件 (c)：`denyReadPaths` 覆盖 + 反向对照 + 过宽 deny

**结论：命名目标全部 BLOCKED（PASS）；但发现 1 条 P1 绕过（系统兜底 deny 被自保护过滤丢弃）。**

`src/core/Match.ts:717-724`：`sandboxDenyReadPaths()` 返回
`[sealedRoot, artifactRoot, PLATFORM_ROOT, pkgA.sourceDir, pkgB.sourceDir]` —— 覆盖了
**双方 `sourceDir` 与 `artifactRoot`**（不再只是 `sealedRoot`），与 Handoff §5 更正一致。

官方 `MatchEngine.preflight` 下的恶意包实测（`iso_probe.ts` 场景 1）：

```
opp_source_dir  blocked:PermissionError   own_source_dir blocked:PermissionError
artifact_root   blocked:PermissionError   sealed_root    blocked:PermissionError
prev_sealed_pkg blocked:PermissionError   prev_match_json blocked:PermissionError
platform_source blocked:PermissionError   platform_root_dir blocked:PermissionError
sandbox_root    blocked:PermissionError   write_project  blocked:PermissionError
write_home      blocked:PermissionError   write_shared_tmp blocked:PermissionError
fork_child      blocked:PermissionError   spawn_subprocess blocked:PermissionError
network_connect blocked:PermissionError
read_own_package allowed   write_work allowed
tmp_file        allowed   ← 泄漏（见 D-1）
tmp_list        allowed   ← 泄漏（见 D-1）
```

- **反向对照**（场景 2）：未被 deny 的目录 `outside_dir: allowed` → 证明探针确实执行、
  不存在「探针整体失效导致的假 BLOCKED」。✅
- **无过宽 deny**（场景 3）：算法可读自己的包（`read_own_package allowed`）、
  可写自己的 `work/`（`write_work allowed`）；生产默认 `sandboxRoot`（`/var/folders/...`）下
  `preflight.ok = true`。✅
- **P1**：当 `sandboxRoot` 位于 `/tmp` 之下时，`/tmp` 读取与列举被放行。

---

## 7. 移除条件 (d)：常驻回归测试的承重性（突变验证）

在 `/tmp/gb-audit2/mutant` 上做单点/双点突变，观察对应用例是否**真的失败**：

| 移除条件 | 常驻测试 | 突变 | 结果 | 承重 |
|---|---|---|---|---|
| (a) 深度守卫 | `tests/dsl-contract.ts` | 删除 `Ast.ts` 两处深度检查 | 8/10（2 条失败，报 `应报 DEPTH_LIMIT，实际 PARSE_ERROR`） | ✅ |
| (b) 逐回合落盘 | `tests/hostile-input.ts` | 删除 `cli.ts` 每回合 `persistNow` | 4/5（`中止前必须已落盘至少一个回合` 失败） | ✅ |
| (c) denyReadPaths | `tests/runner-isolation.ts` | 把 `sandboxDenyReadPaths()` 收窄为仅 `sealedRoot` | 4/5（`官方路径必须拒绝算法读取双方源包与产物目录` 失败，报 `LEAK:own_source_dir:...`） | ✅ |

> 附：`tests/hostile-input.ts` 的两条深度用例**不承重** —— 见 P3-D2。

---

## 8. Cheat Re-Gate 越界攻击矩阵（自建恶意包，官方路径）

| 攻击 | 期望 | 实测 |
|---|---|---|
| 读平台源码 `PLATFORM_ROOT` | BLOCKED | `blocked:PermissionError` ✅ |
| 读对手源包 / 密封包 | BLOCKED | `blocked:PermissionError` ✅ |
| 读上一场次密封包（显式 deny 路径） | BLOCKED | `blocked:PermissionError` ✅ |
| 列沙箱根目录 | BLOCKED | `blocked:PermissionError` ✅ |
| 写项目目录 / `$HOME` / 共享 tmp | BLOCKED | `blocked:PermissionError` ✅ |
| `fork()` / `subprocess` | BLOCKED | `blocked:PermissionError` ✅ |
| 真实 `connect()` 外网 | BLOCKED | `blocked:PermissionError` ✅ |
| 跨 Round 文件 / socket / daemon | BLOCKED | 目录销毁 / `PermissionError` / `ps` 无标记 ✅ |
| 洪泛 stdout 5 MB | 限长 | `OUTPUT_TOO_LARGE`，返回体 `slice(0,4096)` ✅ |
| **读任意 /tmp 文件（未被显式 deny）** | BLOCKED | **`allowed` ❌（P1-D1）** |

---

## 9. 计时公平性

自写**对称固定工作量**算法包（`symline` 400k 循环，A/B 两侧逻辑完全一致），
经官方 `runDuel` 路径：

**批次 1（同包对自身，120 轮 ≥ 100 轮要求）**

```
releaseSkewUs  median=19.375  p95=26.042  max=47.833     （仅诊断量）
timeDiffMs(A-B) median=0.0503 p95=1.4345
medianTimeA=29.295ms   medianTimeB=29.308ms
aFaster=53  bFaster=61  ties(<=0.05ms)=6
aFasterRate(all)=0.4417   （剔除平局 0.4649）
```

在 `timing-fairness` 的 (0.4, 0.6) 硬断言区间内；与 Handoff §6 的 0.497 同量级。

**批次 2（换序配对，150 对 / 300 场，X=400k vs Y=520k）**

```
X胜率(当A)=0.4867   X胜率(当B)=0.4867   Δ=0.0000
（打印值 0.2433 是探针分母写成 duels 的显示口径；xWinA=73，实际分母 150）
双方均未命中对方 Shooter 的场次: 154/300（障碍遮挡）
```

- **Δ = 0.0000**：同一张地图换序，无 array/Promise/runner 创建顺序导致的胜率偏差。
- 有决胜的场次里，**更快的一方（X）全胜**，方向正确。
- 代码复核：`release()`（`SandboxRunner.ts:606-629`）在写入 GO **之前**记录本侧
  `releaseNs`，每方以**自己的 GO 时刻**起算，`release()` 幂等 —— 与 Handoff §6/§8 #2 一致。

---

## 10. 地图生成器 / 取消语义 / 密封与防篡改

**地图生成器（30 万张）**

| 判据来源 | 结果 |
|---|---|
| 官方 `npm run stress` | `Requested/Generated=300,000`，`Invalid maps: 0`，`Seed retries: 227,809`，5.8 s |
| **自写判据**（区域/净空/同队间距/障碍内含/数量/有限性/哈希格式/确定性） | `invalid=0`（zone=0 clearance=0 sameTeamDist=0），`determinism checked=500 mismatch=0`，6.4 s |

**取消语义（`cancel_probe.ts`，17/17 通过）**

- `CANCELLED_A` / `CANCELLED_B` 与 `INVALID_*` 为**不同结果码**，互斥；
- 串行：先手击杀对方 Shooter → 后手**守卫可达且不开火**（`shots.B === null`）；
  仅击杀非 Shooter 时后手仍开火；
- 并列先手：双方基于**同一开战前快照**同时开火、互相击杀、不产生取消；
- 方向对称（B 先手同样成立）。

**密封 / 防篡改（`tamper_probe.ts`，12/12 通过）**

- 独立重算 `hashFileList`：内容变更 / 新增 / 删除 / 改名 / 重排 / 整包替换均被检出；
- `src/submission/Package.ts` **0 个 NUL 字节**（grep 不当作二进制）；
- 注释如实记录「密封后不再复验原始包目录」（P3-A #4 已知边界）。

---

## 11. 完整 E2E 与回放

**算法包**：审计代理现场新建（`/tmp/gb-audit2/e2e2/team-alpha|team-beta`），
自写二次曲线族避障求解器，两侧仅注释不同（SHA-256 不同）。**未改动任何生产代码**，
未注入状态、未打补丁、未绕过官方 API。

**运行命令**

```
npx ts-node -O '{"module":"commonjs"}' src/operator/cli.ts \
  --a /tmp/gb-audit2/e2e2/team-alpha --b /tmp/gb-audit2/e2e2/team-beta \
  --seed 1 --points 6 --difficulty easy \
  --artifacts /tmp/gb-audit2/e2e2/artifacts --auto
```

（种子 1 由 `seed_search.ts` 用官方 `generateMapOrNull` + 与算法包一致的规则离线筛选，
保证在 A 先手与 B 先手两种顺序下均 6 回合内终局；随机种子 20260909 会落入规范层僵局，
属 Handoff §8 #1 已声明的已知限制。）

**结果**

```
Preflight  ✓ PASSED
WINNER: A    Rounds: 11   Kills: A=6 B=5
Artifacts: /tmp/gb-audit2/e2e2/artifacts/matches/MATCH-MTTSJEU6-773E78
```

**产物与回放**

| 检查 | 实测 |
|---|---|
| `match.json` / `audit.json` / `replay.json` 存在且可解析 | ✅（28258 / 18522 / 460199 B） |
| `match.json` 关键字段 | `winner=A`，`rounds=11`，含双方包哈希 |
| 隐藏源码包 + 删除沙箱后 `--replay` | ✅ 正常播放；末行打印「回放为只读记录，未重新运行任何算法」 |
| `replay.json` 中的算法/沙箱痕迹 | `solver.py`=0，`manifest.json`=0，`__gb_bootstrap`=0，`__gb_profile`=0，`sandbox`=0，`python3`=0 |

---

## 12. 新发现缺陷、Handoff 更正复核、未验证项

### 12.1 新发现缺陷

#### D-1（P1，阻塞）`covers()` 自保护过滤丢弃系统兜底 deny → 任意 /tmp 读取

- **位置**：`src/runner/SandboxRunner.ts` `buildProfile`（`covers(p, self)` 过滤 + `SYSTEM_DENIES`），
  配合 `src/core/Match.ts:717-724` `sandboxDenyReadPaths()`。
- **根因**：`covers(p, self) = p === self || self.startsWith(p + path.sep)`，
  `selfPaths = [sandboxDir, sandboxRoot, work]`。当 `sandboxRoot` 位于 `/tmp` 之下时，
  `covers('/private/tmp', sandboxRoot) === true`（`/tmp` 是 `/private/tmp` 的符号链接），
  于是**系统兜底 deny `/private/tmp` 被整条丢弃**。
- **复现 1（profile 文本）**：`npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/profile_dump.ts`
  - `sandboxRoot=/var/folders/.../gb-profcheck` → `(deny file-read* (subpath "/private/tmp"))` **存在**；
  - `sandboxRoot=/tmp/gb-profcheck` → 该行 **缺失**（`/private/tmp deny 存在? false`），
    `/private/var/tmp` 仍在。
- **复现 2（端到端读取）**：`npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/xmatch_probe.ts`
  - 实测输出：
    ```
    preflight.ok = false
    errors = A 算法无法正常运行: 算法异常退出 (code=1):
      LEAK:OTHER_SEALED_PKG:{"name":"other-match-team-B","algorithm"|TMP_LIST:1C9641E0-...,30-seconds-of-code,...
    | B 算法无法正常运行: 算法异常退出 (code=1): LEAK:tmp_file:/tmp/gb-audit2-shared-secret.txt
    ```
  - **对照**：同一探针把 `sandboxRoot` 换成默认 `os.tmpdir()` → `preflight.ok = true`（无泄漏）。
- **复现 3（官方 CLI）**：`env -u TMPDIR npx ts-node src/operator/cli.ts ... --auto`
  （`os.tmpdir()` 退化为 `/tmp` → `sandboxRoot=/tmp/geometry-battle-runs`）同样触发。
- **影响**：沙箱内算法可读任意未被显式 deny 的 `/tmp` 文件、可列举 `/tmp`；
  在「多场次并发、产物目录位于 `/tmp` 下」时，**可读取其他场次的密封包**
  （已验证读到 `other-match-team-B` 的 `manifest.json` 前 40 字节）—— 属隔离与竞赛诚信缺陷。
  注意范围：本场次自己的 `sourceDir` / `artifactRoot` / `sealedRoot` / `PLATFORM_ROOT`
  **仍然 BLOCKED**（它们被单独显式 deny）。
- **触发条件**：`sandboxRoot` 落在 `/tmp` 或 `/private/tmp` 之下。
  默认 macOS（`TMPDIR=/var/folders/...`）不触发；`env -u TMPDIR` / `TMPDIR=/tmp` /
  cron / 部分 CI / 容器环境会触发。
- **移除条件**（满足其一即可，并须补测试）：
  1. `covers()` 自保护过滤**只允许丢弃会阻断 `sandboxDir` / `work` 自身的 deny**
     （判定对象改为 `sandboxDir`/`work`，而不是 `sandboxRoot`）；
     **系统兜底 deny（`/private/tmp`、`/private/var/tmp`）永不参与过滤**；
  2. 或：把系统兜底 deny 写在过滤**之后**单独追加，依赖末尾
     `(allow file-read* (subpath sandboxDir))`（SBPL 后匹配者胜）保证沙箱自身可读；
  3. 新增常驻回归测试：`sandboxRoot` 位于 `/tmp` 下时，算法对**未被显式 deny 的 `/tmp` 文件**
     的读取与列举必须 `BLOCKED`（现 `runner-isolation` 只覆盖显式 deny 的路径，故漏检）；
  4. 建议在 CLI / `MatchEngine` 侧校验 `sandboxRoot` 不得落在系统临时根下。

#### D-2（P3）集成层深度回归测试不承重

- **位置**：`tests/hostile-input.ts`（两条深度用例）。
- **复现**：在 `/tmp` 副本中删除 `src/core/Ast.ts` 的两处深度检查后运行
  `npx ts-node -O '{"module":"commonjs"}' tests/hostile-input.ts` → **5/5 passed**。
- **原因**：`/^A 算法(无法正常运行|输出不合法)/` + `/嵌套过深|不是合法 DSL|缺少 dsl 字段/`
  断言过宽 —— 守卫缺失后，40 层 AST 被接受，随后因 `NOT_THROUGH_SHOOTER`
  （函数不过 Shooter）被拒，错误串仍以 `A 算法输出不合法` 开头，断言照样成立。
  真正把关的是 `tests/dsl-contract.ts`（同突变 → 2 条失败）。
- **影响**：集成层无法发现深度守卫回退（单元层可发现）。不阻塞 V1。

#### D-3（P3）诊断字段不一致

- **位置**：`deep6000-string` 场景。
- **实测**：`result: INVALID_A` 但 `aErrorCode: null`（同探针其余场景均为 `INVALID_OUTPUT`）。
- **影响**：仅诊断可读性，判定结果正确。

### 12.2 Handoff 7 处更正复核（逐条）

| # | Handoff 声明 | 复核结论 |
|---|---|---|
| 1 | §4 僵局段落改为「规范缺口 + 三条有限声明」，不再声称必定终止 | ✅ 实测：朴素包 `seed=20260909/6v6/easy` 72 回合零进展；换避障算法同图 11 回合终局。表述属实 |
| 2 | §5 表格：stdout 上限用完整字节数，**返回给调用方的 stdout 被 `slice(0,4096)`** | ✅ `SandboxRunner.ts:503` 用完整 `stdoutBytes` 判限，`:508` 返回 `stdout.slice(0,4096)` |
| 3 | §5 表格：对手**源包目录**与 **`artifactRoot`** 已纳入 deny | ✅ `sandboxDenyReadPaths()` 返回 5 条路径；`runner-isolation` 承重（第 7 节） |
| 4 | §6：`releaseSkewUs` 是两次 GO 写入间隔、**仅诊断量**，不参与计时 | ✅ `release()` 先记本侧 `releaseNs` 再写 GO；实测 median 19.375 µs |
| 5 | §6：`aFasterRate` 是真正的公平性指标（同算法应 ≈0.5） | ✅ 120 轮实测 0.4417（剔除平局 0.4649），在 (0.4,0.6) 硬断言内 |
| 6 | §8 #2：`readySkewMs`/`releaseSkewUs` 都很大但都不参与计时 | ✅ 与代码一致，且批次 2 Δ=0.0000 交叉印证 |
| 7 | §8 #4：产物每回合落盘，当前进行中回合可能未落盘 | ✅ abort 探针 3/3 回合产物可读 |

另：`src/submission/Package.ts` 密封注释如实记录「密封后不再复验原始包目录」（P3-A #4），
文件 0 个 NUL 字节 —— 与 Handoff 一致。

### 12.3 未验证 / 边界项（如实列出，未以「应该没问题」代替）

1. **Linux 部署未验证** —— 平台面向 Darwin（`sandbox-exec`），Handoff §8 #7 已声明；
   我的结论**仅适用于 macOS**。
2. **内存限制（宿主 60 ms RSS 轮询）未做独立压力验证**（本轮时间预算内未做）。
3. **Unicode / CJK 路径 / 非 ASCII 输出的编码路径未独立验证**。
4. **Rule 31「病态但合法 DSL 使 Judge 卡死」无构造性测试**（Handoff §4 已声明）；
   我未找到可放大的入口，但**未证明其不存在**。
5. **P2-18（无 PAUSE/RESUME/END MATCH）与 P2-21（动画未接线）** 未实现，
   Handoff 已声明为非本轮范围 —— 我确认其现状与声明一致，但**不构成对 V1 的功能背书**。
6. **计时公平性仅在单机 macOS 上验证**，未跨机器 / 跨负载验证。
7. 本报告**不是**对 `v1.0.0-competition` 的授权；在 D-1 修复并补测试前，
   不应把本仓库标记为 `COMPETITION READY`。

---

## 附：关键命令与实测数字速查

```bash
# 基线
git rev-parse HEAD          # 2b44b77dbe9b5121bd252be06070b095d39cbaf0
git branch --show-current   # main
git status --short          # (空)

# (a) 超深 DSL
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/deep_probe.ts
#   deep6000-object → INVALID_A / INVALID_OUTPUT；always-deep → 「嵌套过深，无法序列化」；无宿主崩溃

# (b) 中止落盘
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/abort_probe.ts
#   match.json 3427B/rounds=3；audit.json 7823B/32 events；replay.json 126332B/3 frames

# (c) 隔离 + 反向对照
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/iso_probe.ts
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/profile_dump.ts
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/xmatch_probe.ts        # LEAK
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/xmatch_default.ts      # preflight.ok=true

# (d) 突变承重性（/tmp 副本，不触碰原仓库）
cd /tmp/gb-audit2/mutant && npx ts-node -O '{"module":"commonjs"}' tests/dsl-contract.ts
#   删除 Ast.ts 两处深度检查 → 8/10（失败）

# 计时公平性
npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/sym_timing_probe.ts
#   aFasterRate(all)=0.4417；换序 Δ=0.0000

# 地图 30 万张（自写判据）
N=300000 npx ts-node -O '{"module":"commonjs"}' /tmp/gb-audit2/probes/map_stress_probe.ts
#   invalid=0；determinism 500/500

# 完整 E2E + 回放
npx ts-node -O '{"module":"commonjs"}' src/operator/cli.ts --a /tmp/gb-audit2/e2e2/team-alpha \
  --b /tmp/gb-audit2/e2e2/team-beta --seed 1 --points 6 --difficulty easy \
  --artifacts /tmp/gb-audit2/e2e2/artifacts --auto
#   WINNER: A  Rounds: 11  Kills: A=6 B=5
npx ts-node -O '{"module":"commonjs"}' src/operator/cli.ts \
  --replay /tmp/gb-audit2/e2e2/artifacts/matches/MATCH-MTTSJEU6-773E78
#   回放为只读记录，未重新运行任何算法
```

**一句话结论：除 D-1（P1，`covers()` 丢弃 `/private/tmp` 兜底 deny → 可读其他场次密封包）
外，Cycle 1 的四项移除条件与 Handoff 的更正声明均经独立探针证实；因存在该隔离缺陷，判定 FAIL。**
