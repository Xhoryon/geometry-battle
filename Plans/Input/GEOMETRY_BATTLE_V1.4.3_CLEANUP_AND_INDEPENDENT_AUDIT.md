# Geometry Battle V1.4.3 — Documentation Cleanup + Independent Post-Publish Audit

> **统一任务书 / Combined Task**
>
> 本文件把 V1.4.3 的“文档清理补丁”和“发布后独立审核”放进同一份任务书。
>
> 但仍然必须分成两个执行阶段：
>
> - **Phase A — Cleanup & Release Agent**
> - **Phase B — Fresh Independent Auditor**
>
> **Phase B 必须由新的 Agent 执行。Phase A 不得自我批准。**

---

# 0. 已知公开基线 / Known Public Baseline

Repository:

```text
https://github.com/Xhoryon/geometry-battle
```

当前公开 `main`：

```text
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

不可移动的 V1.4.2：

```text
v1.4.2
→ e053b23549a0fbebf0d77baec277b0591c9a34dc
```

V1.4.2 已经建立：

```text
README.md              → English
README.zh-CN.md        → 简体中文

*.md                   ↔ *.zh-CN.md
language switch links
language-aware cross references
paired-doc regression gate
```

但远端仍存在需要清理的问题，例如：

- README 缺标准 `# Geometry Battle` H1；
- README 没有清晰的 current public release 说明；
- 部分拆分文档存在重复/错位 section；
- 部分语言文件仍可能残留 opposite-language prose；
- V1.4.2 的 language anti-vacuity gate 对 `mixed` 情况过宽；
- 需要一次真正从 GitHub remote fresh clone 的 post-publish audit。

V1.4.3 定位：

```text
Geometry Battle V1.4.3 — Documentation Cleanup & Pair Integrity
Geometry Battle V1.4.3 — 文档清理与语言对完整性
```

**这是纯文档 + 文档测试补丁。**

---

# 1. 全局禁止项 / Global Prohibitions

整个 V1.4.3 不得修改：

```text
competition rules
Validator behavior
MatchEngine behavior
runtime behavior
protocol semantics
auth behavior
Replay authority
Web runtime behavior
timing limits
Emitter semantics
DSL behavior
```

默认禁止改动：

```text
src/core/**
src/server/**
src/runner/**
src/submission/**
web/src/**
competition algorithms
runtime fixtures affecting behavior
```

允许改动：

```text
*.md
documentation index / manifest
documentation regression tests
test registration
small docs-only test helper
release notes
```

如果修文档时发现真实产品 bug：

```text
STOP
```

不要偷偷修进 V1.4.3。

---

# 2. 历史不可变 / Immutable History

禁止：

```text
move v1.4.2
delete/recreate v1.4.2
force push
rewrite public history
amend published commits
```

正确版本线：

```text
v1.4.2
e053b235...
    ↓
V1.4.3 cleanup commit(s)
    ↓
new main
    ↓
v1.4.3
```

---

# PART A — CLEANUP & RELEASE AGENT

# 3. Phase A Role

你是：

```text
Geometry Battle V1.4.3 Documentation Cleanup & Release Agent
```

你负责：

```text
verify actual Git state
create cleanup branch
inventory all Markdown
clean all language pairs
repair README
repair structure/anchors/links
strengthen paired-doc regression gate
mutation-test it
run tests
sanitize
open PR
merge after gates
create v1.4.3 tag
create bilingual GitHub Release
handoff exact state
STOP
```

你不负责：

```text
final independent approval
```

---

# 4. Verify Git Before Editing

运行：

```bash
git status --porcelain
git branch --show-current
git fetch origin --tags
git rev-parse origin/main
git rev-parse v1.4.2^{}
git remote -v
git log --oneline --decorate -12
```

必须确认：

```text
origin/main =
e053b23549a0fbebf0d77baec277b0591c9a34dc

v1.4.2^{} =
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

不一致：

```text
STOP
```

---

# 5. Public Git Identity

检查：

```bash
git config --local user.name
git config --local user.email
```

必须：

```text
Xhoryon
260010709+Xhoryon@users.noreply.github.com
```

只允许修改 local config。

---

# 6. Branch

建议：

```text
docs/v1.4.3-cleanup-integrity
```

从：

```text
origin/main
```

创建。

---

# 7. Mandatory Markdown Inventory

运行：

```bash
git ls-files '*.md'
```

每个 tracked Markdown 必须分类：

```text
PAIRED_PUBLIC_DOC
EXEMPT_MACHINE_FIXTURE
EXEMPT_THIRD_PARTY
EXEMPT_INTERNAL_NON_PUBLIC
```

要求：

```text
unclassified = 0
```

所有面向人的公开说明默认属于：

```text
PAIRED_PUBLIC_DOC
```

---

# 8. Pairing Standard

长期标准：

```text
English canonical file
        ↕
language switch
        ↕
Simplified Chinese counterpart
```

命名：

```text
FILE.md
FILE.zh-CN.md
```

不要使用：

```text
FILE_zh.md
FILE.zh.md
FILE.cn.md
```

---

# 9. Navigation Standard

English file 顶部：

```html
<div align="right">

<strong>English</strong> | <a href="./FILE.zh-CN.md">简体中文</a>

</div>
```

Chinese file 顶部：

```html
<div align="right">

<a href="./FILE.md">English</a> | <strong>简体中文</strong>

</div>
```

实际 href 必须精确指向 counterpart。

---

# 10. README — Release Blocker

`README.md` 顶部必须至少：

```markdown
<div align="right">

<strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a>

</div>

# Geometry Battle
```

并明确：

```text
Current public release: V1.4.3
```

`README.zh-CN.md`：

```markdown
<div align="right">

<a href="./README.md">English</a> | <strong>简体中文</strong>

</div>

# Geometry Battle / 几何斗殴
```

并明确：

```text
当前公开版本：V1.4.3
```

两边都要说明：

```text
V1.4.3 only changes documentation quality/structure and documentation regression checks.
V1.4 competition/runtime semantics remain unchanged.
```

中文语义等价。

---

# 11. README Purity

English README：

- 说明性 prose 为英文；
- 允许 `简体中文` 导航标签；
- 允许 machine token / code / path / proper noun；
- 不允许整段中文自然语言残留。

Chinese README：

- 说明性 prose 为中文；
- 允许 `English` 导航标签；
- 允许 machine token / code / path / proper noun；
- 不允许整段英文自然语言残留。

---

# 12. README Structure

必须检查：

```text
one main H1
no duplicate major sections
logical heading order
no stale bilingual headings
no duplicated code blocks
no dead internal anchors
no stale current-version statement
```

---

# 13. Review Every Public Pair

不能只跑脚本。

每一个 public pair 都人工检查：

```text
same major scope
same section order
same normative meaning
no duplicate section
no missing section
no accidental reorder
no opposite-language prose block
no stale bilingual headings
no repeated code examples caused by split
```

---

# 14. Core Pairs

至少：

```text
README.md
README.zh-CN.md

docs/ARCHITECTURE.md
docs/ARCHITECTURE.zh-CN.md

docs/BILINGUAL_DOCUMENTATION.md
docs/BILINGUAL_DOCUMENTATION.zh-CN.md

docs/RELEASE_NOTES.md
docs/RELEASE_NOTES.zh-CN.md

docs/REPRODUCIBILITY.md
docs/REPRODUCIBILITY.zh-CN.md

docs/V1.4_FAIRNESS_REPORT.md
docs/V1.4_FAIRNESS_REPORT.zh-CN.md
```

---

# 15. Competitor Kit — Highest Priority

重点：

```text
competitor-kit/README.md
competitor-kit/README.zh-CN.md

competitor-kit/ALGORITHM_REQUIREMENTS.md
competitor-kit/ALGORITHM_REQUIREMENTS.zh-CN.md

competitor-kit/DSL_SPECIFICATION.md
competitor-kit/DSL_SPECIFICATION.zh-CN.md

competitor-kit/JSON_SCHEMA.md
competitor-kit/JSON_SCHEMA.zh-CN.md

competitor-kit/RUNTIME_MANIFEST.md
competitor-kit/RUNTIME_MANIFEST.zh-CN.md
```

这是正式参赛协议层。

结构或语义问题均为 release blocker。

---

# 16. Known Structural Risk

V1.4.2 拆分后曾出现类似：

```text
# 6. Match Rules
...
# 5. Function Requirements
```

这种重复/错位编号。

V1.4.3 必须逐篇清除。

---

# 17. Section Number Integrity

对编号文档检查：

```text
0
1
2
3
...
```

要求：

```text
no duplicate major number
no backwards insertion
no orphan subsection
no subsection under wrong parent
```

例如：

```text
# 5
# 6
# 5
```

必须失败。

---

# 18. Code-Block Duplication

检查同一文档里：

```text
back-to-back duplicated code
repeated JSON example
repeated CLI skeleton
same example appearing twice because both language halves were retained
```

机器代码本身可以在两种语言版本分别出现，但单个语言文件中不应机械重复。

---

# 19. Example Comments

文档里的示例 comment 尽量对应语言：

English:

```python
# binding self-check
```

Chinese:

```python
# 绑定自检
```

不要为此修改真实 source code。

---

# 20. Cross-Language Links

English docs：

```text
prefer English canonical docs
```

Chinese docs：

```text
prefer .zh-CN.md docs
```

source/code/json links不需要语言化。

---

# 21. Anchors

检查：

```text
same-file anchors
cross-file anchors
README links
competitor section links
```

必须根据实际 GitHub heading anchor 规则验证。

---

# 22. Release Notes

更新：

```text
docs/RELEASE_NOTES.md
docs/RELEASE_NOTES.zh-CN.md
```

增加：

```text
V1.4.3 — Documentation Cleanup & Pair Integrity
V1.4.3 — 文档清理与语言对完整性
```

明确：

```text
documentation-only
no runtime change
no rule change
```

并诚实写：

```text
V1.4.2 introduced switchable language pairs.
V1.4.3 cleans structural split artifacts and strengthens pair-integrity checks.
```

---

# 23. Strengthen `bilingual-docs`

现有 gate 中以下能力必须保留：

```text
git ls-files inventory
pair completeness
exact link parsing
numeric parity
normative parity
```

同时修复 V1.4.2 的 anti-vacuity 弱点。

---

# 24. Inventory Gate

必须从：

```bash
git ls-files '*.md'
```

获得真实 inventory。

每个文件：

```text
paired
or explicit exemption
```

任何新未分类 Markdown：

```text
RED
```

---

# 25. Pair Gate

必须检查：

```text
English exists
Chinese exists
no orphan .zh-CN.md
```

删除任一 side：

```text
RED
```

---

# 26. Exact Switch-Href Gate

不能只检查存在：

```text
English
简体中文
```

必须：

1. parse `<a href>`;
2. identify language-switch href;
3. resolve relative target;
4. compare to exact expected counterpart;
5. verify target exists.

例如：

```text
ALGORITHM_REQUIREMENTS_zh.md
```

而真实是：

```text
ALGORITHM_REQUIREMENTS.zh-CN.md
```

必须 RED。

---

# 27. Language Purity Gate

V1.4.2 的：

```text
mixed → PASS
```

不能保留。

预处理可去掉：

```text
fenced code
inline code
URLs
HTML tags
known machine identifiers
```

然后以 prose paragraph 为单位检查。

English file：

```text
substantial Chinese prose block = 0
```

Chinese file：

```text
substantial English prose block = 0
```

允许：

```text
Team A
Team B
Emitter
Preflight
START
JSON
Python
Validator
MatchEngine
```

等技术 token。

---

# 28. Structure Gate

新增或强化：

```text
duplicate major heading detection
duplicate numbered section detection
backwards numbered section detection
obvious adjacent duplicated code block detection
```

优先覆盖：

```text
README
ALGORITHM_REQUIREMENTS
DSL_SPECIFICATION
JSON_SCHEMA
RUNTIME_MANIFEST
```

---

# 29. Numeric Parity

至少 pin：

```text
500 ms
512 MB
1 core / 1 核
1 thread / 1 线程
20 rounds
60 rounds
8 MB
256 files
1e-6
[-20, 20]
[-12, 12]
AST depth
AST node count
constant limit
convexity limit
stdout/stderr limits
```

不要只依赖“出现次数差不多”。

关键规范直接 assert value。

---

# 30. Normative Parity

至少两边都必须明确：

```text
same formal submission MUST work as Team A and Team B
Team A forward = +x
Team B forward = -x
solver.py required
network access prohibited
subprocess prohibited
500 ms compute limit
official Preflight does not run check_mirror
check_mirror is a development diagnostic
```

---

# 31. Manual Semantic Spot Check

至少人工对照：

```text
README rules summary
ALGORITHM_REQUIREMENTS
DSL_SPECIFICATION
RUNTIME_MANIFEST
JSON_SCHEMA
```

重点：

```text
MUST / SHOULD / MAY strength
numbers
exceptions
prohibitions
scope
```

---

# 32. Documentation Index

`docs/BILINGUAL_DOCUMENTATION*` 必须描述当前模型：

```text
English canonical ↔ .zh-CN counterpart
```

不得继续描述 V1.4.1 的：

```text
single file contains zh-CN + en-US
```

---

# 33. Sanitization Is Release-Blocking

重新扫描：

```text
real username
personal email
real hostname
real machine path
credentials
agent state
```

真实泄漏要求：

```text
0
```

---

# 34. Path Classification

扫描：

```text
/Users/
/private/tmp
/var/folders/
Downloads/
Desktop/
```

分类：

```text
REAL PERSONAL PATH
GENERIC SECURITY SENTINEL
PUBLIC PLACEHOLDER
```

Generic sentinel 可保留，但最终报告必须列出理由。

---

# 35. Agent-State Scan

要求 0：

```text
.claude
.codex
workflow IDs
TaskOutput
journal.jsonl
scratchpad
subagent identifiers
private memory
local agent-report paths
```

---

# 36. Credential Scan

真实 credential = 0。

至少检查：

```text
ghp_
github_pat_
sk-
Bearer
Authorization:
PRIVATE KEY
OPENSSH
password=
api_key
client_secret
token=
```

---

# 37. Runtime-Diff Gate

提交前：

```bash
git diff --name-only v1.4.2..HEAD
```

然后：

```bash
git diff --exit-code v1.4.2..HEAD --   src/core   src/server   src/runner   src/submission
```

并人工确认：

```text
web/src runtime diff = 0
competition algorithm diff = 0
```

---

# 38. Targeted Verification

必须 PASS：

```text
bilingual-docs
competitor-kit
i18n
npm run typecheck
npm run typecheck:web
```

---

# 39. Full Test

在正常负载下跑一次：

```bash
npm test
```

要求：

```text
all documentation-related suites green
```

如果只剩已知环境依赖的 operator-e2e：

- 保留完整日志；
- 明确证明与 docs diff 无关；
- 不改 runtime；
- 不改阈值掩盖失败。

---

# 40. E2E Policy

若：

```text
web/src diff = 0
```

无需重跑完整 Playwright matrix。

可做：

```text
app startup smoke
```

若 web runtime 有变化：

```text
STOP
```

---

# 41. Mutation Tests — Mandatory

全部在隔离副本执行，不污染 branch。

### Mutation A — missing pair

删除：

```text
README.zh-CN.md
```

Expected:

```text
RED
```

### Mutation B — broken switch

把 README 中文 href 改成不存在的：

```text
README_zh.md
```

Expected:

```text
RED
```

### Mutation C — unclassified Markdown

新增：

```text
docs/ONLY_ENGLISH.md
```

Expected:

```text
RED
```

### Mutation D — numeric drift

只改一边：

```text
500 ms → 600 ms
```

Expected:

```text
RED
```

### Mutation E — normative drift

删除或弱化：

```text
Team B forward = -x
same formal submission MUST work on both sides
```

Expected:

```text
RED
```

### Mutation F — language residue

English doc 加一整段中文 prose。

Expected:

```text
RED
```

Chinese doc 加一整段 English prose。

Expected:

```text
RED
```

### Mutation G — duplicated numbered section

复制一个：

```text
# 5. ...
```

Expected:

```text
RED
```

---

# 42. PR

建议：

```text
V1.4.3 — Documentation Cleanup & Pair Integrity / 文档清理与语言对完整性
```

PR body 双语。

不要夸大成：

```text
perfect translation
mathematically guaranteed parity
```

允许：

```text
critical numeric/normative parity checks passed
all paired-doc regression gates passed
manual structural review completed
```

---

# 43. Merge Preconditions

只有全部满足才可 merge：

```text
[ ] README fixed
[ ] all public pairs reviewed
[ ] duplicate/misordered sections removed
[ ] language residue removed
[ ] links/anchors fixed
[ ] bilingual-docs PASS
[ ] competitor-kit PASS
[ ] i18n PASS
[ ] typecheck PASS
[ ] typecheck:web PASS
[ ] full npm test completed
[ ] mutation A–G RED as expected
[ ] sanitization PASS
[ ] runtime diff = 0
```

---

# 44. Merge + Tag

正常 merge / squash 均可。

禁止 force。

记录 new `main` SHA。

创建：

```bash
git tag -a v1.4.3   -m "Geometry Battle V1.4.3 — Documentation Cleanup & Pair Integrity"

git push origin v1.4.3
```

禁止：

```bash
git push --tags
```

---

# 45. Verify Old Tag

必须再次：

```bash
git rev-parse v1.4.2^{}
```

结果仍然必须：

```text
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

---

# 46. GitHub Release

创建：

```text
Geometry Battle V1.4.3 — Documentation Cleanup & Pair Integrity / 文档清理与语言对完整性
```

Release body 仍用一个 body 内：

```text
中文 section
English section
```

因为 GitHub Release metadata 不支持 paired Markdown switch。

不得引用本机 `/tmp/...` 作为公开依赖。

---

# 47. Suggested Release Body

```markdown
## 中文

V1.4.3 是一个纯文档与文档回归测试补丁。

本版本：

- 清理 V1.4.2 语言拆分后残留的重复章节与错位结构；
- 恢复 README 标准标题与当前版本说明；
- 清理语言对中的 opposite-language prose 残留；
- 修复语言切换与内部链接；
- 强化 paired-document 回归门禁；
- 新增结构顺序与语言纯度检查；
- 重新执行隐私、路径与凭据扫描。

不修改比赛规则、Validator、MatchEngine、runtime、协议、鉴权、Replay authority 或 Web runtime behavior。

## English

V1.4.3 is a documentation-only cleanup and documentation-regression patch.

This release:

- removes duplicated and misplaced sections left by the V1.4.2 language split;
- restores the canonical README title and current-release statement;
- removes opposite-language prose residue;
- repairs language-switch and internal documentation links;
- strengthens paired-document regression checks;
- adds structural-order and language-purity checks;
- re-runs privacy, path, and credential scans.

It does not change competition rules, Validator behavior, MatchEngine behavior, runtime behavior, protocol semantics, authorization, replay authority, or Web runtime behavior.
```

---

# 48. Phase A Final Report

输出：

```text
GEOMETRY BATTLE V1.4.3 CLEANUP RELEASE PUBLISHED

Repository:
Base v1.4.2:
Branch:
PR:
Merge SHA:
v1.4.3 tag:
Release URL:

=== INVENTORY ===
Tracked Markdown:
Paired public:
Exempt:
Unclassified:

=== CLEANUP ===
README H1:
README current release:
Duplicate headings:
Section-order issues:
Opposite-language prose:
Switch links:
Cross-links:
Anchors:

=== REGRESSION GATE ===
Inventory:
Pair completeness:
Exact href:
Language purity:
Structure:
Numeric parity:
Normative parity:
Links:

=== MUTATIONS ===
A:
B:
C:
D:
E:
F:
G:

=== SANITIZATION ===
real username:
real path:
personal email:
credentials:
agent state:
generic sentinels:

=== PRODUCT SAFETY ===
src/core diff:
src/server diff:
src/runner diff:
src/submission diff:
web runtime diff:
competition semantics:

=== TESTS ===
bilingual-docs:
competitor-kit:
i18n:
typecheck:
typecheck:web:
npm test:
operator-e2e classification:
app smoke:

=== GIT ===
v1.4.2 unchanged:
force push:
git push --tags:
public identity:

FINAL PHASE A STATUS:
V1.4.3 PUBLISHED — READY FOR INDEPENDENT POST-PUBLISH AUDIT
```

Phase A 到这里 STOP。

---

# PART B — FRESH INDEPENDENT POST-PUBLISH AUDIT

# 49. Phase B Role

使用一个全新的 Agent：

```text
Geometry Battle V1.4.3 Independent Post-Publish Documentation Auditor
```

不能使用 Phase A 的工作目录。

Phase A 报告只是线索，不是证据。

---

# 50. Fresh Clone

推荐：

```bash
git clone https://github.com/Xhoryon/geometry-battle.git   geometry-battle-v1.4.3-audit

cd geometry-battle-v1.4.3-audit
git fetch --tags
git checkout --detach v1.4.3
```

---

# 51. Verify Remote Objects

记录：

```bash
git rev-parse origin/main
git rev-parse v1.4.1^{}
git rev-parse v1.4.2^{}
git rev-parse v1.4.3^{}
```

必须：

```text
v1.4.2 =
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

`main` 必须包含 v1.4.3。

---

# 52. Verify GitHub Release

检查：

```text
releases/tag/v1.4.3
```

必须存在。

Release body：

```text
Chinese section
English section
no private paths
no agent-state references
```

---

# 53. Diff Scope

运行：

```bash
git diff --name-status v1.4.2..v1.4.3
git diff --stat v1.4.2..v1.4.3
```

预期只出现：

```text
Markdown
docs-test
test registration/helper
```

unexpected runtime source：

```text
P1 / FAIL
```

---

# 54. Runtime Safety

运行：

```bash
git diff --exit-code v1.4.2..v1.4.3 --   src/core   src/server   src/runner   src/submission
```

再人工检查：

```text
web/src
operator runtime
competition algorithms
```

要求：

```text
runtime diff = 0
```

---

# 55. Independent Inventory

运行：

```bash
git ls-files '*.md'
```

Auditor 自己统计：

```text
tracked
paired public
exempt
unclassified
orphan
```

要求：

```text
unclassified = 0
orphan = 0
```

---

# 56. Manual Switch Check

至少实际打开：

```text
README pair
ARCHITECTURE pair
ALGORITHM_REQUIREMENTS pair
DSL_SPECIFICATION pair
one playtest pair
```

验证：

```text
EN → CN works
CN → EN works
```

---

# 57. README Audit

English：

```text
# Geometry Battle
Current public release: V1.4.3
```

Chinese：

```text
# Geometry Battle / 几何斗殴
当前公开版本：V1.4.3
```

检查：

```text
no stale current version
no duplicate H1
no mixed full-language section
switch works
anchors work
fences balanced
```

---

# 58. Competitor Structural Audit

重点：

```text
ALGORITHM_REQUIREMENTS
DSL_SPECIFICATION
JSON_SCHEMA
RUNTIME_MANIFEST
README
```

独立检查：

```text
section order
duplicate numbered section
missing section
wrong parent
duplicate code
stale bilingual heading
```

---

# 59. Language Purity

自动 gate 之外人工抽查。

English：

```text
no substantial Chinese prose
```

Chinese：

```text
no substantial English prose
```

允许：

```text
technical token
code
commands
proper nouns
navigation label
```

---

# 60. Semantic Parity

至少检查：

```text
README rules
ALGORITHM_REQUIREMENTS
RUNTIME_MANIFEST
DSL_SPECIFICATION
JSON_SCHEMA
```

重点：

```text
MUST / 必须
MUST NOT / 不得
SHOULD / 建议
MAY / 可以
```

---

# 61. Critical Values

独立核对：

```text
500 ms
512 MB
1 core / 1 核
1 thread / 1 线程
20 rounds
60 rounds
8 MB
256 files
1e-6
field bounds
AST limits
```

---

# 62. Orientation

两边必须：

```text
Team A forward = +x
Team B forward = -x
same formal submission MUST work on both sides
```

---

# 63. Preflight Boundary

两边必须明确：

```text
official Preflight / validate_submission
```

与：

```text
check_mirror = development diagnostic
```

不同。

---

# 64. Run Docs Gate

运行：

```text
bilingual-docs
```

必须 PASS。

---

# 65. Independent Mutations

Phase B 再独立做 A–G：

```text
A delete README.zh-CN.md → RED
B break href → RED
C add unclassified Markdown → RED
D 500→600 on one side → RED
E weaken Team B/both-side rule → RED
F insert opposite-language prose → RED
G duplicate numbered section → RED
```

不复用 Phase A mutation 结果。

---

# 66. Link & Anchor Audit

自动检查后手动抽查：

```text
README anchors
README → docs
Chinese README → Chinese docs
English competitor → English docs
Chinese competitor → Chinese docs
```

---

# 67. Remote Sanitization

审计的是 GitHub 上已经上传的对象。

要求：

```text
real username = 0
personal email = 0
real machine path = 0
agent state = 0
credentials = 0
```

generic sentinel 可 allowlist。

---

# 68. Commit Metadata

检查：

```bash
git log v1.4.2..v1.4.3 --format=fuller
```

应使用 public noreply identity。

私人邮箱：

```text
P1
```

---

# 69. Phase B Tests

至少独立跑：

```text
bilingual-docs
competitor-kit
i18n
npm run typecheck
npm run typecheck:web
```

如果 diff docs-only：

```text
无需重新跑大型 fairness campaign
无需 27,000-map campaign
无需完整 Playwright matrix
```

可做：

```text
app startup smoke
```

---

# 70. Severity

### P0

```text
real secret
catastrophic privacy leak
```

### P1

```text
v1.4.2 moved
unexpected runtime change
major structural corruption remains
critical competitor semantic mismatch
core switch broken
personal identity/path leak
paired-doc gate vacuous
```

### P2

```text
isolated low-risk prose residue
minor broken doc anchor
one non-critical duplicate paragraph
release wording mismatch
```

### P3

```text
style
punctuation
format polish
```

---

# 71. Phase B Final Report

```text
# Geometry Battle V1.4.3 Independent Post-Publish Audit

## Remote Release
Repository:
origin/main:
v1.4.1:
v1.4.2:
v1.4.3:
GitHub Release:
Old tags unchanged:

## Diff Scope
Markdown:
Docs-test:
Runtime:
Runtime diff:

## Inventory
Tracked Markdown:
Paired public:
Exempt:
Unclassified:
Orphans:

## README
English H1:
Chinese H1:
Version:
Purity:
Switch:
Anchors:
Fences:

## Core Docs
ARCHITECTURE:
REPRODUCIBILITY:
RELEASE_NOTES:
FAIRNESS_REPORT:
BILINGUAL_DOCUMENTATION:

## Competitor Kit
README:
ALGORITHM_REQUIREMENTS:
DSL_SPECIFICATION:
JSON_SCHEMA:
RUNTIME_MANIFEST:
Section order:
Duplicates:
Semantic parity:
Numeric parity:
Normative parity:

## Other Public Docs
Algorithms:
Demo:
Playtest:

## Regression Gate
Inventory:
Pairs:
Exact href:
Purity:
Structure:
Numeric:
Normative:
Links:

## Mutations
A:
B:
C:
D:
E:
F:
G:

## Sanitization
identity:
email:
machine paths:
agent state:
credentials:
sentinel allowlist:
commit metadata:

## Product Safety
src/core:
src/server:
src/runner:
src/submission:
web runtime:
competition semantics:

## Verification
bilingual-docs:
competitor-kit:
i18n:
typecheck:
typecheck:web:
app smoke:
Phase A full-test evidence:

## Findings
P0:
P1:
P2:
P3:

## Final Decision
```

---

# 72. Allowed Final Decisions

只能：

```text
PASS — V1.4.3 DOCUMENTATION CLEANUP & PAIR INTEGRITY APPROVED
```

或：

```text
CONDITIONAL PASS — <finite documentation blocker(s)>
```

或：

```text
FAIL — <P0/P1 blocker(s)>
```

---

# 73. PASS Means Freeze

若 PASS：

```text
STOP
```

不要继续：

```text
V1.4.4
cosmetic README churn
code-comment translation
fairness reruns
UI polish
```

V1.4 文档线正式关闭。

---

# 74. Combined Definition of Done

只有 Phase A + Phase B 都完成，整个任务才完成：

```text
[ ] v1.4.2 unchanged
[ ] README H1 restored
[ ] current release = V1.4.3
[ ] all Markdown classified
[ ] all public docs paired
[ ] no orphan translations
[ ] all switches exact
[ ] all 19 pairs manually reviewed
[ ] duplicate/misordered sections removed
[ ] opposite-language prose residue removed
[ ] English links prefer English docs
[ ] Chinese links prefer Chinese docs
[ ] language purity gate strengthened
[ ] structure gate added
[ ] numeric parity gate passes
[ ] normative parity gate passes
[ ] mutation A RED
[ ] mutation B RED
[ ] mutation C RED
[ ] mutation D RED
[ ] mutation E RED
[ ] mutation F RED
[ ] mutation G RED
[ ] bilingual-docs PASS
[ ] competitor-kit PASS
[ ] i18n PASS
[ ] typecheck PASS
[ ] typecheck:web PASS
[ ] Phase A full npm test executed once
[ ] sanitization PASS
[ ] runtime diff = 0
[ ] PR merged normally
[ ] v1.4.3 tag pushed explicitly
[ ] GitHub Release created
[ ] fresh independent audit performed
[ ] remote Git-object sanitization PASS
[ ] independent final PASS
```

---

# 75. Final Principle

V1.4.2 建立了可切换语言文档架构。

V1.4.3 的任务是把它清理成长期稳定状态：

```text
clean structure
clean language separation
exact navigation
stable pair integrity
strong regression protection
sanitized public history
independent verification
```

最终要求：

> English 用户进入 English 文档后不需要滚过中文正文。

> 中文用户进入简体中文文档后不需要滚过英文正文。

> 未来出现单语漂移、坏链接、关键数值漂移、MUST 语义漂移或重复章节时，回归门禁应立即失败。
