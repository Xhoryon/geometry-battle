# Geometry Battle V1.4.1 — Complete Bilingual Documentation + Sanitized Public Patch Release

> **任务类型 / Task Type**  
> Public documentation completeness remediation + sanitization + documentation regression gate + V1.4.1 patch release.
>
> **目标 / Goal**  
> 修复 V1.4.0 已公开仓库中“README 与所有公开说明文件没有全部实现完整中英双语”的发布缺口，并在不修改任何比赛逻辑的前提下发布 **V1.4.1**。
>
> **最高优先级 / Highest Priority**
>
> 1. **所有 public-facing explanatory documentation 必须完整支持 `zh-CN` + `en-US`。**
> 2. **脱敏必须继续保持为 release blocker。**
> 3. **不得修改或移动既有 `v1.4.0` tag。**
> 4. **不得改变 Engine / Judge / protocol / runtime / UI behavior。**
> 5. **发布完成后必须交给一个 fresh independent agent 做轻量 post-publish audit；本 Agent 不得自我批准。**

---

# 0. 已知公开状态 / Known Public State

公开仓库：

```text
https://github.com/Xhoryon/geometry-battle
```

当前已发布：

```text
V1.3 public commit:
01a237b20ceada70d55b071237ae80955419d23c

V1.4 public commit:
d1066c549f6c5039c388919da0ecbf9079d5e957
```

公开 tags：

```text
v1.3.0
v1.4.0
```

内部已批准 V1.4 RC：

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

V1.4.0 已完成平台、规则、公平性与 UX 独立审计。

**V1.4.1 不重新审这些产品逻辑，只修公开文档完整性。**

---

# 1. 已确认的文档缺口 / Confirmed Documentation Gap

公开 README 已大体采用双语结构，但当前公开树中至少存在以下问题：

```text
README.md
→ 基本双语，但版本顶部/新增段落需要重新做完整一致性检查

docs/ARCHITECTURE.md
→ 主体偏中文，缺少完整对应英文

docs/REPRODUCIBILITY.md
→ 主体偏中文，缺少完整对应英文

docs/RELEASE_NOTES.md
→ V1.3 / V1.4 主体偏英文，缺少完整对应中文

competitor-kit/ALGORITHM_REQUIREMENTS.md
→ 大量核心说明仍为中文主体
```

其它说明文件不得因为未被点名就跳过。

本任务必须对**全部 tracked Markdown**做 inventory。

---

# 2. Role

你是 **Geometry Battle V1.4.1 Bilingual Documentation & Sanitized Public Release Agent**。

你负责：

```text
inventory
classify
translate
cross-check
sanitize
add regression gate
validate
commit
push
tag
prepare/create GitHub Release
handoff to independent mini-auditor
```

你不负责：

```text
修改比赛规则
修改 Validator
修改 MatchEngine
修改 auth
修改 Replay authority
修改 UI behavior
重新做 fairness campaign
重新优化算法
```

---

# 3. Immutable Releases

以下对象视为不可变：

```text
public v1.3.0
public v1.4.0
internal V1.4 approved SHA 7f6e39d...
```

禁止：

```text
move v1.4.0
delete/recreate v1.4.0
force push
rewrite public history
amend d1066c5
```

V1.4.1 必须是：

```text
v1.4.0
   ↓
new documentation patch commit(s)
   ↓
v1.4.1
```

---

# 4. Repository Safety

先检查：

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
git remote -v
git tag --list --format='%(refname:short) %(objectname)'
git log --oneline --decorate -12
```

确认当前操作的是 **PUBLIC repository**。

要求 public repo local identity：

```bash
git config --local user.name
git config --local user.email
```

必须是：

```text
Xhoryon
260010709+Xhoryon@users.noreply.github.com
```

如果不是，只设置 local config。

禁止修改 global git config。

---

# 5. 建议分支 / Branch

从当前 public `main` / `v1.4.0` 后创建：

```text
docs/v1.4.1-complete-bilingual
```

开始前验证：

```bash
git rev-parse v1.4.0^{}
```

必须指向已发布的 V1.4.0 public commit。

如果不是预期 public V1.4.0：

STOP。

---

# 6. First Mandatory Inventory

必须执行：

```bash
git ls-files '*.md'
```

将结果写入一个工作用 inventory。

**不要只翻译 docs/ 和 competitor-kit/ 顶层文件。**

对每一个 tracked `.md` 分类：

```text
REQUIRED_BILINGUAL
MACHINE_FIXTURE
THIRD_PARTY / OFFICIAL_TEXT
NOT_PUBLIC_FACING
```

但豁免必须非常严格。

---

# 7. Bilingual Scope Policy

默认规则：

> **任何公开仓库中供人阅读、解释项目、比赛、算法、规则、复现、架构、实验、发布或操作流程的 Markdown，都属于 REQUIRED_BILINGUAL。**

包括但不限于：

```text
README.md
docs/**/*.md
competitor-kit/**/*.md
playtest/**/*REPORT*.md
playtest/**/README.md
starter/**/README.md
demo/**/README.md
任何公开说明、报告、指南、方法、手册
```

---

# 8. What Is Exempt

只有以下类型可豁免：

### A. 官方 License 原文
官方许可文本不得为了双语而修改。

### B. 真正的机器 fixture
仅 parser/test fixture、非用户说明、且没有被公共文档引用时才可豁免。

### C. 第三方原文
必须明确来源并说明不可直接翻译原件的原因。

---

# 9. What Is NOT a Valid Exemption

以下理由均不成立：

```text
太长
技术文档
旧版本报告
playtest
国际用户可能不看
README 已经有英文
```

如果它是公开说明，就必须双语。

---

# 10. Do Not Delete Documentation to Pass

严禁为了满足双语检查：

```text
删除单语报告
隐藏文件
取消 README 链接
把证据文件移出 Git
```

不能用“减少文档数量”代替翻译。

---

# 11. Preferred Bilingual Style

继续使用**同文件双语**。

推荐：

```markdown
# 架构 / Architecture

## 1. 分层 / Layers

### 中文
完整中文内容……

### English
Complete English content…
```

短段落可：

```markdown
**中文。** …

**English.** …
```

---

# 12. Translation Quality Standard

要求：

```text
semantic equivalence
same normative strength
same numbers
same paths
same command semantics
same limitations
same warnings
same scope
```

不是逐字机翻。

---

# 13. Normative Language Parity

重点检查：

```text
MUST / 必须
MUST NOT / 禁止/不得
SHOULD / 应当
MAY / 可以
recommended / 建议
optional / 可选
```

不得出现强度漂移。

---

# 14. Numeric Parity

特别保护：

```text
500 ms
512 MB
1 core
1 thread
20 rounds
60 rounds
8 MB
256 files
1e-6
[-20, 20]
[-12, 12]
schema versions
sample sizes
hashes
```

任何中英数值不一致都是 blocker。

---

# 15. Machine Tokens Stay Exact

通常不要翻译：

```text
Team A
Team B
Emitter
Preflight
START
PUBLIC
REVEAL
MATCH_END
ELIMINATION
MUTUAL_ELIMINATION
STALEMATE
HARD_ROUND_LIMIT
NOT_THROUGH_SHOOTER
JSON keys
CLI flags
DSL operator names
```

---

# 16. README Audit

重新检查整个 `README.md`。

要求：

- 所有用户说明中英文对等；
- 标题双语；
- Quick Start 双语；
- routes 双语；
- tournament workflow 双语；
- competitor instructions 双语；
- fairness statement 双语；
- license scope 双语。

特别修正顶部版本漂移。

推荐：

```text
当前公开版本：V1.4.1
Current public release: V1.4.1
```

并说明：

```text
V1.4.1 是基于 V1.4 runtime 的完整双语文档补丁。
V1.4.1 is a complete bilingual-documentation patch over the V1.4 runtime.
```

---

# 17. docs/ARCHITECTURE.md

必须完整双语，保持技术细节。

至少覆盖：

```text
MatchEngine authority
terminal/web peer entry points
SpectatorBoard whitelist
frontend zero judging
protocol mirror types
sandbox layout
timing fairness
START gate
preflight decoy
replay authority
```

---

# 18. docs/REPRODUCIBILITY.md

必须完整双语。

确保：

```text
public evidence scope
what was omitted
path placeholders
raw artifact sampling policy
reproduction commands
limitations
```

都双语。

---

# 19. docs/RELEASE_NOTES.md

V1.3 / V1.4 / V1.4.1 全部采用双语。

---

# 20. docs/V1.4_FAIRNESS_REPORT.md

必须完整双语。

一致描述：

```text
Validator bug
mirror invariant
same-solver design
sample sizes
firstSolver result
map-distribution result
limitations
host-sleep anomaly
```

不得把“未检测到平台槽位偏差”翻译成绝对数学证明。

---

# 21. competitor-kit/README.md

完整双语。

包括：

```text
what to submit
workflow
tools
preflight
mirror checker
runtime assumptions
starter
```

---

# 22. competitor-kit/ALGORITHM_REQUIREMENTS.md

最高优先级文档之一。

完整双语。

所有 MUST 条款逐项对齐。

---

# 23. competitor-kit/RUNTIME_MANIFEST.md

完整双语。

保持：

```text
Python/runtime version
stdlib availability
third-party packages
filesystem layout
resource constraints
network/process/thread restrictions
```

---

# 24. competitor-kit/DSL_SPECIFICATION.md

完整双语。

公式、阈值、error code 不得漂移。

---

# 25. competitor-kit/JSON_SCHEMA.md

完整双语。

字段名保持原文，人类说明双语。

---

# 26. Nested Public Reports

对 `git ls-files '*.md'` 发现的其它 public-facing reports 一并翻译。

特别关注：

```text
playtest/
demo/
starter/
```

---

# 27. Re-Verify Documentation Facts

翻译过程中不要机械复制过期事实。

关键声明回查当前 source/tests。

发现原文错误：

- 先确认；
- 中英同时修正；
- 记录；
- 不扩大成产品改动。

---

# 28. Potential Documentation Drift

特别检查：

```text
README top version
fairness sample descriptions
Release Notes fairness counts
array ordering wording
orientation wording
starter behavior
Preflight vs check_mirror
browser/OS claims
```

---

# 29. Bilingual Marker

建议所有 REQUIRED_BILINGUAL 文档加入：

```html
<!-- bilingual-doc: zh-CN + en-US -->
```

marker 只是机器 gate，不替代语义审查。

---

# 30. Bilingual Documentation Manifest

新增：

```text
docs/BILINGUAL_DOCUMENTATION.md
```

它本身也必须双语。

内容：

```text
all required bilingual files
exemptions
rationale
style rule
maintenance rule
```

---

# 31. Permanent Regression Gate

新增：

```text
tests/bilingual-docs.ts
```

或等价测试。

目标：

> 防止未来新增单语公开说明。

---

# 32. Gate — Inventory Completeness

测试必须检查每一个 tracked `.md`：

- 在 bilingual manifest；
- 或 explicit exemption。

新增 Markdown 未分类时必须红。

---

# 33. Gate — Marker

所有 REQUIRED_BILINGUAL 必须有 bilingual marker。

---

# 34. Gate — Heading Structure

主要标题采用：

```text
中文 / English
```

或等价可检测结构。

防止新增纯单语大章节。

---

# 35. Gate — Language Presence

每个 REQUIRED_BILINGUAL 文档至少检查：

```text
Chinese character coverage > minimum
English word coverage > minimum
```

避免整篇中文只加一句 “English version”。

---

# 36. Gate — Numeric Literal Parity

尽可能实现 lightweight numeric checker。

至少对 competition-critical docs 建立数值 parity assertions。

---

# 37. Gate — Normative Spot Checks

至少钉死：

```text
MUST / 必须
MUST NOT / 禁止
500 ms
8 MB
256 files
Team A +x
Team B -x
```

---

# 38. Gate Registration

如使用 `tests/run-all.ts`，注册：

```text
bilingual-docs
```

---

# 39. Documentation Link Audit

检查 Markdown internal links 与 GitHub heading anchors。

双语标题变化不能制造 dead anchors。

---

# 40. README Fence Audit

用 state-machine 检查 code fences。

不要只看 fence 数量偶数。

---

# 41. Runtime Modification Boundary

允许：

```text
*.md
tests/bilingual-docs.ts
tests/run-all.ts
small docs-check helper
```

默认禁止：

```text
src/core/**
src/server/**
src/runner/**
runtime-relevant web/src/**
competition algorithm behavior
```

如果文档修复需要改 runtime：

STOP。

---

# 42. Code Comments

source-code comments 不要求全部双语。

starter 中面向参赛者的重要说明注释可选双语，但不得改行为。

---

# 43. LICENSE

官方 PolyForm License 保持原文。

不要为了双语修改 LICENSE。

---

# PART B — SANITIZATION

# 44. Sanitization Remains a Release Blocker

翻译和复制内部资料时必须重新做完整脱敏。

---

# 45. Identity Scan

扫描：

```text
jiayihuang
Jerry
Jerrys-MacBook-Pro
personal email
```

要求真实身份匹配 = 0。

---

# 46. Machine Path Scan

扫描：

```text
/Users/jiayihuang
/Users/
/private/tmp/
/var/folders/
Downloads/
Desktop/
```

分类：

```text
REAL LEAK
GENERIC SECURITY SENTINEL
PUBLIC PLACEHOLDER
```

真实个人路径必须 0。

---

# 47. Agent State Scan

扫描：

```text
.claude
.codex
scratchpad
workflow IDs
wf_
TaskOutput
journal.jsonl
subagent
agentId
memory/
```

public docs 不能泄漏内部 Agent 编排。

---

# 48. Secret Scan

扫描：

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

逐项分类。

真实凭证必须 0。

---

# 49. Copy/Paste Risk

特别检查有没有从内部报告复制：

```text
/Users/...
/tmp/claude...
workflow IDs
internal branch paths
private report paths
```

---

# 50. Git History Safety

不要先 commit 敏感文本再删。

每次 commit 前先 scan。

---

# 51. Allowlisted Sentinels

通用安全字符串可以保留，例如：

```text
/Users/
/private/tmp
```

仅当它们是 security test / deny list / negative assertion。

最终报告列出 count + files + rationale。

---

# PART C — V1.4.1 PUBLIC RELEASE

# 52. Version Positioning

V1.4.1 是：

```text
Documentation completeness patch + documentation regression tests
```

明确：

```text
No competition rules changed.
No runtime behavior changed.
No fairness behavior changed.
No UI behavior changed.
```

---

# 53. Commit Scope Verification

提交前：

```bash
git diff --name-only v1.4.0..HEAD
```

预期只有 docs 与 docs-test。

若出现 runtime source：

STOP。

---

# 54. Suggested Commits

建议 2–3 个：

```text
docs: complete bilingual public documentation
test(docs): enforce bilingual documentation coverage
docs: add V1.4.1 release notes
```

---

# 55. Public Git Identity

每次 commit 前确认 local noreply identity。

---

# 56. Targeted Verification

至少：

```text
bilingual-docs
competitor-kit
i18n
Markdown/link checks
```

---

# 57. Product-Safety Verification

确认：

```text
src/core unchanged
src/server unchanged
src/runner unchanged
runtime web source unchanged
```

无需重做 V1.4 fairness campaign。

---

# 58. Type Verification

跑：

```bash
npm run typecheck
npm run typecheck:web
```

---

# 59. Full npm test

优先在正常负载下完整跑一次：

```bash
npm test
```

只跑一次即可。

timing-fairness 若受环境影响，按已有政策分类，不改阈值。

---

# 60. E2E Policy

若 runtime web diff = 0：

完整 11/11 E2E 不强制。

至少做 app startup smoke。

若 runtime web file 有变化：

必须 full E2E。

---

# 61. Final Pre-Commit Sanitization

commit 前：

```text
real username = 0
real personal path = 0
personal email = 0
secret = 0
agent state = 0
```

---

# 62. Commit and Push

记录 public V1.4.1 commit SHA。

正常：

```bash
git push origin main
```

禁止 force。

---

# 63. Tag V1.4.1

验证 main 后：

```bash
git tag -a v1.4.1 -m "Geometry Battle V1.4.1 — Complete Bilingual Documentation"
git push origin v1.4.1
```

禁止 `git push --tags`。

---

# 64. Verify Old Tags

确认：

```text
v1.3.0 unchanged
v1.4.0 unchanged
v1.4.1 → new patch commit
```

---

# 65. GitHub Release

Title：

```text
Geometry Battle V1.4.1 — Complete Bilingual Documentation / 完整双语文档
```

Release body 必须双语，并说明：

```text
docs-only + docs regression
no runtime/rule change
sanitization re-run
```

---

# 66. README Release Status

README：

```text
当前公开版本：V1.4.1
Current public release: V1.4.1
```

并说明 runtime semantics remain V1.4。

---

# 67. Internal Tag Policy

默认不创建新的 internal competition tag。

内部平台 V1.4 approved runtime source 仍是：

```text
7f6e39d...
```

除非用户另行要求。

---

# PART D — POST-PUSH HANDOFF

# 68. Do Not Self-Approve

上传完成后，本 Agent 只能给：

```text
V1.4.1 PUBLISHED — READY FOR POST-PUBLISH MINI AUDIT
```

不能自我最终 PASS。

---

# 69. Mini-Audit Handoff Data

必须交付：

```text
repository
v1.4.0 tag target
v1.4.1 tag target
diff
Markdown inventory
bilingual manifest
exemption list
sanitization report
test results
GitHub Release status
```

---

# 70. Final Implementation Report

```text
GEOMETRY BATTLE V1.4.1 BILINGUAL DOCUMENTATION PATCH PUBLISHED

Repository:
Branch:
Base v1.4.0:
New HEAD:
v1.4.1:

=== DOCUMENT INVENTORY ===
Tracked Markdown:
Required bilingual:
Exempt:
Unclassified:

=== COMPLETED DOCUMENTS ===
README:
ARCHITECTURE:
REPRODUCIBILITY:
RELEASE_NOTES:
V1.4_FAIRNESS_REPORT:
Competitor Kit:
Other public docs:

=== REGRESSION GATE ===
bilingual-docs:
inventory completeness:
heading coverage:
language presence:
numeric parity:
normative checks:
link/anchor check:
README fence check:

=== SANITIZATION ===
real username:
real machine path:
personal email:
secret:
agent state:
allowlisted sentinels:

=== PRODUCT SAFETY ===
runtime source changed:
rules changed:
Validator changed:
web runtime changed:
protocol changed:

=== VERIFICATION ===
typecheck:
typecheck:web:
targeted tests:
npm test:
E2E policy/result:

=== GIT ===
v1.3.0 unchanged:
v1.4.0 unchanged:
v1.4.1:
force push:
git push --tags:

=== RELEASE ===
GitHub Release:
Release body bilingual:

FINAL IMPLEMENTATION STATUS:
V1.4.1 PUBLISHED — READY FOR POST-PUBLISH MINI AUDIT
```

---

# 71. Stop Conditions

STOP if:

1. 需要移动 `v1.4.0`；
2. 需要 force push；
3. 翻译要求修改 runtime；
4. 发现真实 secret；
5. 新 commit 含个人路径；
6. gate 只能靠删除公共文档通过；
7. diff 出现意外 runtime code；
8. public Git identity 不是 noreply；
9. 旧 tag 目标变化。

---

# 72. Definition of Done

```text
[ ] every tracked Markdown classified
[ ] every human-facing explanatory Markdown bilingual
[ ] no silent documentation deletion
[ ] README current version fixed
[ ] ARCHITECTURE bilingual
[ ] REPRODUCIBILITY bilingual
[ ] RELEASE_NOTES bilingual
[ ] V1.4_FAIRNESS_REPORT bilingual
[ ] all Competitor Kit explanatory Markdown bilingual
[ ] nested public reports handled
[ ] normative parity checked
[ ] numeric parity checked
[ ] bilingual regression test added
[ ] new Markdown cannot bypass manifest
[ ] links/anchors checked
[ ] README fences checked
[ ] sanitization PASS
[ ] real machine paths 0
[ ] secrets 0
[ ] agent state 0
[ ] runtime source unchanged
[ ] v1.4.0 unchanged
[ ] main pushed without force
[ ] v1.4.1 tagged explicitly
[ ] GitHub Release body bilingual
[ ] independent mini-audit handoff prepared
```

---

# 73. Final Principle

从 V1.4.1 开始建立永久规则：

> **Geometry Battle 的所有公开说明文档默认必须同时服务中文与英文读者。**

未来新增 public-facing Markdown 若没有两种语言的等价信息：

> **documentation gate 必须失败。**

同时继续保持：

> **公开仓库只包含脱敏后的产品与公共工程证据，不成为内部开发环境的取证转储。**
