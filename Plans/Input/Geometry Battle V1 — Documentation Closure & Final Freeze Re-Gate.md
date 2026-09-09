# Geometry Battle V1 — Documentation Closure & Final Freeze Re-Gate

## Authorization

此前自动 remediation/re-gate workflow 的 3-cycle 上限已经用尽。

Cycle 3 最终 Verdict：

```text
CONDITIONAL PASS
```

当前状态：

```text
V1 REMAINS NOT COMPETITION READY
```

本轮由用户明确授权一个**例外性的最终 Closure Round**。

这不是新的功能开发轮次，也不是继续进行一般 remediation。

本轮唯一目标：

> 修复 Cycle 3 独立审计确认的 E-1～E-4 四项纯文档失实，然后由一个全新的独立 Audit Agent 判断当前 HEAD 是否可以冻结为 `v1.0.0-competition`。

---

# 1. 严格 Scope

本轮 Development Agent 只允许修改：

```text
README.md
Plans/**/*.md
```

如果 E-1～E-4 的修复实际不需要修改某个文件，则不要修改。

明确禁止修改：

```text
src/
tests/
starter/
dist/
package.json
package-lock.json
tsconfig.json
.gitignore
runtime / sandbox configuration
```

以及任何生产逻辑。

如果发现必须修改生产代码才能解除 E-1～E-4：

```text
STOP
```

并报告原因。

不得扩大本轮范围。

---

# 2. 当前冻结实现基线

首先记录：

```text
Branch
HEAD
git status
```

当前用户报告基线：

```text
Branch: main
HEAD: 36e351a
Working tree: clean
```

必须自行重新确认，不要只相信摘要。

同时确认：

```bash
git diff 18c0562..HEAD -- src tests starter package.json tsconfig.json
```

仍为空。

---

# 3. 读取权威资料

至少读取：

```text
Plans/Input/Gate Plan1.md
Plans/Input/Plan 2 — V1 Completion Plan.md

Plans/Output/Re-Gate Cycle 3 Result.md
Plans/Output/V1 Remediation Handoff.md

README.md
Plans/README.md
```

以及 Cycle 3 中与 E-1～E-4 有关的实际测试文件，但本轮不得修改测试。

---

# 4. 只处理 E-1～E-4

## E-1 — Fairness 放大命令环境变量错误

当前文档使用了不存在的：

```text
ROUNDS_ORDER
ROUNDS_SWAP
```

实际实现使用：

```text
GB_FAIRNESS_ROUNDS
GB_FAIRNESS_SWAP_ROUNDS
```

修正文档中的执行命令。

要求：

- 命令可直接复制执行；
- 不会静默退回默认 300 / 150；
- 文档描述与真实测试代码一致。

修改后实际执行一次文档中的命令，证明环境变量确实生效。

记录实际轮数。

---

# 5. E-2 — D-1 Mutation Claim 失实

当前 Handoff 声称类似：

> D-1 两个组件中的任意一个被突变，测试都会失败。

Cycle 3 Audit 已证明该说法不成立：

```text
仅突变 selfPaths
→ runner-isolation 第 6 用例仍 6/6 PASS
```

不要为了让原声明成立而修改生产代码或测试。

正确处理方式是：

> 修改 Handoff，使其准确描述真实 mutation-bearing evidence。

必须明确：

- 哪种 mutation 会导致测试失败；
- 哪种 mutation 单独存在时不会失败；
- D-1 的行为性验证真正证明了什么；
- 不夸大测试承重能力。

原则：

```text
fix documentation claim
NOT implementation to fit documentation
```

---

# 6. E-3 — Numerical Oracle Claim 失实

当前 Handoff 声称：

```text
数值 oracle 已进入 permanent regression suite
```

但 Cycle 3 Audit 确认：

```text
tests/ 中不存在该 oracle
```

本轮禁止因为这条文档错误去新增测试，因为当前 scope 是 docs-only。

因此应将文档改为真实状态，例如：

```text
Numerical oracle was used during an earlier independent audit,
but is not part of the current permanent regression suite.
```

如果其他文档也声称其为：

```text
permanent
常驻
regression suite
```

同步修正。

不要删除历史报告中记录“当时运行过 oracle”的事实。

需要区分：

```text
historical audit evidence
```

和：

```text
current permanent regression
```

---

# 7. E-4 — Timing Definition 文档错误

当前 README 仍存在类似：

```text
从共享 GO 时刻起算
```

而 Cycle 3 独立审计确认真实实现为：

> 每一方从自己实际收到 / 进入 GO 的时间起算。

修正 README。

必须确保以下三者一致：

```text
implementation
README
Handoff
```

不要修改实现来迁就旧 README。

新的描述必须准确解释：

- 双方通过公平启动机制启动；
- 每个 Runner 的正式 compute latency 从自己的 GO 起点计时；
- 因此不能描述为一个完全相同的 shared timestamp；
- fairness test 验证的是 slot/order 不产生可利用的系统性优势。

不要使用比实现更强的措辞。

---

# 8. 历史审计报告保护

不要为了让历史报告的：

```text
line number
old path
old observation
```

看起来“当前仍正确”而改写其历史事实。

尤其：

- Cycle 1
- Cycle 2
- Cycle 3

是历史审计记录。

只在必要情况下添加清楚的：

```text
Historical note
Current location
Current line
```

说明。

不能把历史审计当时真实看到的内容改写成当前状态。

---

# 9. 已知存量漂移

此前记录的：

- Cycle 1 / Cycle 2 源码行号因后续修复而漂移；
- Cycle 3 H-1～H-4 对 Handoff 的部分行号因头部插入而漂移；
- README “16 个必需套件 + 地图公平性”与当前 18 套件不符；

本轮需要分类。

原则：

### 如果它是当前用户文档中的事实错误

修正。

例如：

```text
README 当前声称 16 suites
实际是 18 suites
```

属于当前 README 事实失实，应修正。

### 如果它是历史审计记录中记录“当时第几行”

不改写历史证据。

可以增加 current-note，但不得篡改历史结果。

---

# 10. 文档修改后验证

必须执行：

## A. Scope verification

确认：

```bash
git diff --name-only <baseline>..HEAD
```

只有允许的 `.md` 文件。

并确认：

```bash
git diff <baseline>..HEAD -- src tests starter package.json package-lock.json tsconfig.json
```

为空。

---

## B. Link verification

重新扫描所有 Markdown 本地相对链接。

要求：

```text
0 broken links
```

---

## C. E-1 command verification

直接复制文档中的 fairness 命令运行。

确认：

```text
GB_FAIRNESS_ROUNDS
GB_FAIRNESS_SWAP_ROUNDS
```

真实控制了轮数。

---

## D. Claim verification

全文搜索：

```text
ROUNDS_ORDER
ROUNDS_SWAP
shared GO
共享 GO
numerical oracle
数值 oracle
permanent regression
常驻回归
16 个必需套件
```

确认不存在仍然失实的当前陈述。

历史 transcript / quoted audit output 可以保留，但必须能够从上下文看出它是历史证据。

---

# 11. 不重新开发 V1

本轮 Development Agent 不需要重新跑全部 18 suites 或 300k map stress 来“证明代码没坏”。

因为生产代码禁止修改。

但至少执行：

```text
tsc --noEmit
```

和必要的文档命令验证。

如果希望额外运行现有 test suite 可以，但不得因此修改测试或生产代码。

---

# 12. Commit

文档 closure 完成后建立一个单独 commit。

例如：

```text
docs(v1): close cycle-3 documentation blockers
```

记录：

```text
Closure HEAD
Parent HEAD
Changed files
Working tree
```

工作区必须：

```text
clean
```

---

# 13. Development Agent 最终输出

Development Agent 不得宣布 PASS。

只能输出：

```text
DOCUMENTATION CLOSURE COMPLETE
READY FOR FINAL INDEPENDENT FREEZE RE-GATE
```

并生成：

```text
Plans/Output/V1 Documentation Closure Handoff.md
```

至少记录：

| Finding | Before | Correction | Verification |
|---|---|---|---|
| E-1 | ... | ... | ... |
| E-2 | ... | ... | ... |
| E-3 | ... | ... | ... |
| E-4 | ... | ... | ... |

同时记录：

```text
Baseline HEAD
Closure HEAD
Production-code diff: NONE
Test-code diff: NONE
Broken links: 0
Working tree: clean
```

---

# 14. 启动 Fresh Independent Audit Agent

Closure commit 完成后启动一个**全新 Audit Agent**。

它不得继承 Development Agent 的成功判断。

角色：

```text
FINAL FREEZE AUDITOR
READ ONLY
```

本轮审计重点不需要机械重做此前所有工作，但必须独立确认：

1. Cycle 3 的 4 个 Conditional blockers 是否全部真实解除；
2. Closure commit 是否只有文档修改；
3. 是否意外引入新的文档失实；
4. 当前 HEAD 的生产代码确实与 Cycle 3 已通过实现相同；
5. Cycle 3 的实现层 PASS 证据仍对应当前生产树。

---

# 15. Final Audit 必须独立验证 E-1～E-4

## E-1

直接从当前文档复制 fairness command。

运行。

确认实际 rounds 与文档一致。

---

## E-2

阅读：

```text
runner-isolation test
SandboxRunner implementation
Handoff claim
```

确认新措辞不再夸大 mutation coverage。

---

## E-3

检查：

```text
tests/
```

确认文档现在准确区分：

```text
historical numerical oracle
vs
permanent regression suite
```

---

## E-4

检查正式 timing implementation。

确认 README 的计时定义与代码一致。

---

# 16. Final Auditor 还必须检查 docs-only 属性

确认：

```text
Cycle 3 implementation baseline
→ current HEAD
```

不存在：

```text
src/
tests/
starter/
runtime config
```

变化。

如果发现任何未经过新实现审计的代码变化：

```text
FAIL
```

不得沿用 Cycle 3 实现 PASS。

---

# 17. 最终 Verdict

只能给：

```text
PASS — COMPETITION READY
```

或：

```text
CONDITIONAL PASS
```

或：

```text
FAIL
```

---

# 18. PASS 条件

只有当：

- E-1 CLOSED
- E-2 CLOSED
- E-3 CLOSED
- E-4 CLOSED
- docs-only change verified
- no new material inconsistency
- current production tree equals independently passed Cycle 3 implementation tree
- working tree clean

才可以：

```text
PASS — COMPETITION READY
```

并明确回答：

```text
Is current HEAD safe to freeze as
v1.0.0-competition?

YES
```

---

# 19. 如果 PASS

停止所有开发。

不要继续 UI polish。

先：

```text
tag v1.0.0-competition
```

并保存最终：

```text
HEAD
tag
audit report
handoff
working-tree status
```

之后再开启独立的：

```text
V1.1 UI / UX / Visual Polish
```

阶段。

---

# 20. 如果仍不是 PASS

不要自动开始第五次修复。

STOP。

报告剩余 blocker，由用户决定是否继续。