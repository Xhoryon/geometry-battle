# V1 Documentation Closure Handoff

> **本文件由 Development Agent 在例外性 Closure Round 中编写。**
> Development Agent **不得**宣布 PASS；本文件只声明「文档修正已完成」，不构成任何通过判定。
> 是否可冻结为 `v1.0.0-competition`，由**全新的独立 Audit Agent** 判定。

---

## 1. 本轮授权与范围

- 授权来源：[`Plans/Input/Geometry Battle V1 — Documentation Closure & Final Freeze Re-Gate.md`](../Input/Geometry%20Battle%20V1%20%E2%80%94%20Documentation%20Closure%20&%20Final%20Freeze%20Re-Gate.md)
- 唯一目标：修复 Cycle 3 独立审计确认的 **E-1～E-4** 四项**纯文档失实**。
- 允许修改：`README.md`、`Plans/**/*.md`。
- **禁止**修改：`src/`、`tests/`、`starter/`、`dist/`、`package.json`、`package-lock.json`、
  `tsconfig.json`、`.gitignore`、runtime / sandbox configuration 及任何生产逻辑。
- 未发生「必须改生产代码才能解除 E-1～E-4」的情形，故未触发 STOP。

---

## 2. 基线记录

| 项目 | 值 |
|---|---|
| 仓库 | `/Users/jiayihuang/Downloads/几何斗殴` |
| Branch | `main` |
| 用户报告基线 HEAD | `36e351a` |
| 本轮开工前实测 HEAD | `36e351a`（`git status --short` 显示任务书本身未跟踪） |
| 任务书提交 | `c05c07d docs(plans): add Documentation Closure round task document (human input)` |
| **Parent HEAD（Closure 提交的父）** | `c05c07d` |
| **Closure HEAD** | 本次提交 —— 即 `c05c07d` 的唯一子提交（`git log -1 --format=%H` 的返回值） |
| Working tree（交付时） | `clean` |

开工前自行复核（未依赖摘要）：

```bash
$ git log --oneline -3
c05c07d docs(plans): add Documentation Closure round task document (human input)
36e351a docs(plans): fix line-number drift and inaccurate reorg statements
5be48d3 docs(plans): update path references after Plans/ split + add Plans/README.md

$ git diff 18c0562..HEAD -- src tests starter package.json tsconfig.json
(空)
```

> 说明：开工时任务书 `Plans/Input/Geometry Battle V1 — Documentation Closure & Final Freeze Re-Gate.md`
> 处于未跟踪状态，会使工作区不 clean。为满足 §12「工作区必须 clean」，先将其作为
> **人输入文档**单独提交（`c05c07d`），再开始文档修正。

---

## 3. E-1～E-4 修正记录

| Finding | Before | Correction | Verification |
|---|---|---|---|
| **E-1** Fairness 放大命令环境变量错误 | `Plans/Output/V1 Remediation Handoff.md` §6 与 §7 称可用 `ROUNDS_ORDER` / `ROUNDS_SWAP` 放大样本，并给出 `ROUNDS_ORDER=1000 ROUNDS_SWAP=500 npx ts-node tests/timing-fairness.ts`。这两个变量在 `tests/timing-fairness.ts` 中**根本不存在**，按文档执行会**静默退回默认 300 / 150 轮** | §6 改为 `GB_FAIRNESS_ROUNDS` / `GB_FAIRNESS_SWAP_ROUNDS`，并说明 `GB_FAIRNESS_MIN`（默认 100，仅冒烟时调低）的真实作用；§7 命令改为真实变量名，并补一条 ~20s 的冒烟命令 | **实跑文档命令**：`GB_FAIRNESS_ROUNDS=1000 GB_FAIRNESS_SWAP_ROUNDS=500 npx ts-node tests/timing-fairness.ts` → 3/3 passed，退出码 0；测试名打印「同算法对局 **1000** 轮」（787.6s）与「配对换序 **500×2** 轮」（656.3s），**未**退回 300/150 |
| **E-2** D-1 Mutation Claim 失实 | Handoff §2 Cycle 3 表 D-1 行称两个修复分量「**二者均为承重点：突变任一处，D-1 回归用例即失败**」；§5 亦称「已做突变承重验证」而未限定范围 | 改为**逐分量实测的承重关系**：① `selfPaths` 收窄**不单独承重**（单独回退 → `runner-isolation` 6/6 PASS）；② `SYSTEM_DENIES` 短路**承重**（单独回退 → 5/6 FAIL）；并明确「不得宣称突变任一处即失败」 | **独立突变实验**（在 `/tmp` 副本进行，原仓库零改动）：<br>① 仅回退 `selfPaths` → **6/6 PASS**；<br>② 仅回退 `SYSTEM_DENIES` 短路 → **5/6 FAIL**（失败用例正是 D-1 回归）；<br>③ 两者同时回退 → **5/6 FAIL** |
| **E-3** Numerical Oracle Claim 失实 | Handoff §2 P3-14 行与 §4 P3-14 行称「数值 oracle（30 AST × 13 点 × 390 次比对）**已入常驻回归**」，回归测试列 `dsl-contract`；`tests/` 中并不存在该 oracle | 改为真实状态：该 oracle 属 **Plan 1 审计探针 `x19.ts`（historical audit evidence，不在仓库）**，**不属于当前常驻回归套件**；`dsl-contract` 仅有 3 处单点 `evaluateNode` 断言。**未**为此新增测试（本轮 docs-only） | 全仓 `grep`：`tests/` 中无 `390`/`oracle` 字样；Handoff 两处 P3-14 行现均写明「未入常驻回归」。**保留**历史报告记录「当时运行过 oracle」的事实（`Plans/Output/Plan 1 Gate Result.md` 第 451 行未改） |
| **E-4** Timing Definition 文档错误 | `README.md` 第 130 行称超时「从**共享 GO** 时刻起算」，第 200 行称「由宿主写入同一个 GO 时刻；两侧计时相对同一时刻起算」——描述的是 Cycle 1 已修复的偏置形态 | README 改为：READY 握手后宿主**先后**写入 GO；每方 compute latency 与超时预算均从**自己的** GO 写入时刻起算；`releaseSkewUs` 仅为诊断量；fairness 测试验证的是 slot/顺序**不产生可利用的系统性优势**（**不**声称绝对公平）。措辞不弱于也不强于实现 | 实现侧复核 `src/runner/SandboxRunner.ts`：每 runner 独立 `releaseNs`（`:618`），`runDuel` 分别 `runnerA.release()` / `runnerB.release()`（`:727-728`），`releaseSkewUs` 仅作诊断；Handoff §2 P1-10 / P1-19 / P1-B 与 §6 均已为「各自 GO 起算」 |

另修正 **O-1（非阻塞）**：Handoff §2 P2-15 行「83 事件」→「84 事件（8 轮 E2E，见 §3）」，与同文档 §3 一致。

---

## 4. 变更文件清单

```text
README.md
Plans/README.md
Plans/Output/V1 Remediation Handoff.md
Plans/Output/Re-Gate Cycle 1 Result.md
Plans/Output/Re-Gate Cycle 2 Result.md
Plans/Output/Re-Gate Cycle 3 Result.md
Plans/Output/V1 Documentation Closure Handoff.md   ← 本文件
```

全部为 `.md`；**没有**任何 `src/`、`tests/`、`starter/`、构建配置或 runtime 配置被修改。

---

## 5. 历史审计报告保护（§8）的处理方式

对 Cycle 1 / 2 / 3 三份历史审计报告，**只加说明、不改写历史事实**：

- 各报告开头新增 **Historical note / Current location**：记录审计当时的 HEAD，以及
  被引用内容在**当前** HEAD 上的实际位置（Cycle 1：`Ast.ts:186`→201、`Ast.ts:224-236`→256-268、
  `SandboxRunner.ts:667-672` 已移除、`cli.ts` 193→121；Cycle 2：`Ast.ts:132-138` 未变、
  `Ast.ts:257` 当时即指向 nodeCount 检查（措辞不精确，非漂移）、`SandboxRunner.ts:308-351`→316-359、
  `:606-629`→614-637、`:503`/`:508`→511/516、`Match.ts:717-724`→726-733）。
- Cycle 3 报告：H-5 与 §5 E-4 现象的 README 行号**恢复为审计当时所见**（第 198 行），
  另加 current note 说明该段现位于第 200 行；§4 表下方新增 Current location 注，列出
  H-1…H-4 引用内容在 Handoff 中的当前行号。
- 终端输出转录块**逐字保留**，不改写其中当时可见的行号与路径。

---

## 6. 存量漂移分类（§9）

| 项 | 类型 | 处理 |
|---|---|---|
| README「16 个必需套件 + 地图公平性」 | **当前用户文档事实错误**（实际 18 套件） | **已修正**为「18 个套件：16 个点名套件 + map-fairness + hostile-input」 |
| README 环境变量白名单漏 `LC_ALL` | **当前用户文档事实错误**（`scrubEnv` 含 `LC_ALL: 'C.UTF-8'`） | **已修正** |
| README / Handoff 的「共享 GO」表述 | **当前用户文档事实错误**（E-4） | **已修正** |
| Cycle 1 / 2 报告中的源码行号漂移 | 历史审计记录 | **不改写**，加 current note |
| Cycle 3 报告中的 Handoff / README 行号 | 历史审计记录 | **不改写**，加 current note |

---

## 7. 验证结果

### A. Scope verification

```bash
$ git diff --name-only c05c07d..HEAD
README.md
Plans/README.md
Plans/Output/V1 Documentation Closure Handoff.md
Plans/Output/Re-Gate Cycle 1 Result.md
Plans/Output/Re-Gate Cycle 2 Result.md
Plans/Output/Re-Gate Cycle 3 Result.md
Plans/Output/V1 Remediation Handoff.md

$ git diff 18c0562..HEAD -- src tests starter package.json package-lock.json tsconfig.json
(空)
```

### B. Link verification

- 全部 Markdown 本地相对链接扫描：**0 broken**（含本文件被 4 处引用后复扫）。
- 扫描范围：仓库内全部 `.md`（排除 `node_modules/`、`.git/`、`dist/`）。

### C. E-1 command verification

见第 3 节 E-1 行：文档命令原样复制执行，实测轮数 1000 / 500×2，**未**静默退回默认值。

### D. Claim verification

全文搜索 `ROUNDS_ORDER`、`ROUNDS_SWAP`、`shared GO`、`共享 GO`、`numerical oracle`、
`数值 oracle`、`permanent regression`、`常驻回归`、`16 个必需套件`：

- 输入任务书中的出现属于**只读任务书本身**（记录「错误名 vs 正确名」），不改；
- Cycle 3 报告中的出现属**历史审计证据**，且上下文明确其为当时发现，不改；
- Handoff 与 README 中的**当前陈述**已全部修正，无残留失实。

### E. 类型检查（§11）

```bash
$ npx tsc --noEmit
(无输出，退出码 0)
```

### F. 提交与工作区

```text
Production-code diff: NONE
Test-code diff:       NONE
Broken links:         0
Working tree:         clean
```

---

## 8. 本轮**未**做 / 范围外事项（如实声明）

1. **未**重新运行全部 18 个套件或 300k 地图压力验证 —— §11 明确本轮不需要（生产代码禁止修改）；
   仅按 §11 执行 `tsc --noEmit`，并按 §4 实跑 fairness 命令、按 §5 做 D-1 突变实验。
2. **未**新增任何测试（E-3 的正确处理是改文档，而非新增 oracle 测试）。
3. **R-1（范围外观察，已披露）**：`src/runner/SandboxRunner.ts` 文件头注释第 19-20 行
   （「计时从同一个共享的 release 时刻开始」）与字段注释第 64 行（「相对共享 release 时刻的耗时」）
   仍是 P1-B 修复前的**陈旧措辞**。它们位于 `src/`，属 §1 明令禁止修改的范围，故**未改动**。
   事实澄清：`git diff 18c0562..HEAD -- src` 为空，说明这两处注释与 Cycle 3 已通过的实现树
   **字节一致**，是**既有**陈旧注释、非本轮引入；其**行为实现**（每 runner 独立 `releaseNs`）
   与修正后的 README / Handoff 完全一致。是否需要清理，留待独立审计判定与后续授权。
4. 本轮**不**宣布任何通过判定。

---

## 9. 结论

```text
DOCUMENTATION CLOSURE COMPLETE
READY FOR FINAL INDEPENDENT FREEZE RE-GATE
```

下一步（不在本文件职责内）：由**全新的独立 Audit Agent** 执行 §14～§18 的最终冻结审计。
只有该审计给出 `PASS — COMPETITION READY`，才允许 `tag v1.0.0-competition`。
