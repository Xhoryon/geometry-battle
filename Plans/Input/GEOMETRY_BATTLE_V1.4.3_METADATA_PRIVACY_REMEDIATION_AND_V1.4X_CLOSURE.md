# Geometry Battle V1.4.3 — Git Metadata Privacy Remediation + Independent Verification + V1.4.x Closure

> **任务类型 / Task Type**  
> Public Git metadata privacy remediation + exact-content preservation + remote-ref rewrite + GitHub object/cached-view verification + fresh independent audit + V1.4.x closure gate.
>
> **目标 / Goal**  
> 修复 V1.4.3 公开历史中一个 commit author metadata 暴露个人邮箱的问题，同时：
>
> - 不修改任何文件内容
> - 不修改 runtime
> - 不修改比赛规则
> - 不修改 V1.4.2
> - 保持 V1.4.3 最终 tree 内容完全一致
> - 仅修复 Git metadata / refs
> - 完成后由 fresh Agent 独立复核
>
> 如果本任务最终 PASS，则：
>
> ```text
> V1.4.x = CLOSED
> ```
>
> 后续不再创建 V1.4.4 来处理纯文档、展示或元数据问题。

---

# 0. 当前已知远端状态 / Known Remote State

Repository:

```text
https://github.com/Xhoryon/geometry-battle
```

当前公开 main：

```text
a480001b798878c30386e6ce7783fc305f56d18a
```

当前 V1.4.3 tag 指向：

```text
a480001b798878c30386e6ce7783fc305f56d18a
```

V1.4.3 当前 annotated tag object：

```text
4335806482a5eb4a8b71d8e3501eeba6681aeb3e
```

V1.4.2 immutable baseline：

```text
v1.4.2
→ e053b23549a0fbebf0d77baec277b0591c9a34dc
```

PR #3 clean head commit：

```text
f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

已知：

```text
a480001...  = 当前公开 V1.4.3 main/tag commit
f6b2a467... = PR #3 clean head commit
```

必须先重新验证：

```text
same tree
same parent
clean noreply metadata on candidate
```

只有全部成立，才允许用 `f6b2a467...` 作为 sanitized replacement。

---

# 1. Privacy Exception

正常规则：

```text
published tags immutable
no force push
```

但这次属于：

```text
privacy remediation
```

因此允许一个**有限例外**，但仅限：

```text
refs/heads/main
refs/tags/v1.4.3
```

并且必须保持：

```text
same tree
same parent
same file content
v1.4.2 unchanged
```

禁止把这次修复扩大成普通历史整理。

---

# 2. Two-Phase Execution

## Phase A — Metadata Remediation Agent

负责：

```text
freeze
backup
verify equivalence
rewrite refs safely
verify release
scan public refs/history
check old SHA accessibility
escalate to GitHub Support if necessary
handoff
```

## Phase B — Fresh Independent Privacy Auditor

负责：

```text
fresh clone
verify refs
verify content identity
verify privacy
verify old object accessibility
verify release
issue final closure decision
```

Phase A 不得自我批准。

---

# PART A — METADATA REMEDIATION

# 3. Freeze Repository Activity

执行前：

- 不允许其它 Agent push；
- 不 merge 新 PR；
- 不创建新 tag；
- 不让旧 clone 在修复过程中 push。

如果 public repo 正在变化：

```text
STOP
```

---

# 4. Fresh Remediation Clone

```bash
git clone https://github.com/Xhoryon/geometry-battle.git   geometry-battle-v1.4.3-privacy-remediation

cd geometry-battle-v1.4.3-privacy-remediation
git fetch origin --tags
```

不要直接在长期开发工作区做历史修复。

---

# 5. Record Before-State

运行：

```bash
git rev-parse origin/main
git rev-parse v1.4.2^{}
git rev-parse v1.4.3^{}
git rev-parse refs/tags/v1.4.3

git show -s --format=fuller origin/main
git show -s --format=fuller   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

预期：

```text
origin/main =
a480001b798878c30386e6ce7783fc305f56d18a

v1.4.3^{} =
a480001b798878c30386e6ce7783fc305f56d18a

refs/tags/v1.4.3 =
4335806482a5eb4a8b71d8e3501eeba6681aeb3e

v1.4.2^{} =
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

任何不一致：

```text
STOP
```

以真实 remote 为准重新评估。

---

# 6. Do Not Re-Publish the Personal Email

不要把旧 personal email 复制到：

```text
commit messages
docs
release notes
public issues
PR comments
committed audit reports
```

搜索时从旧 commit 动态获取：

```bash
OLD_EMAIL="$(git show -s --format='%ae'   a480001b798878c30386e6ce7783fc305f56d18a)"
```

不要：

```bash
echo "$OLD_EMAIL"
```

公共日志只报告：

```text
personal email match = YES/NO
```

---

# 7. Local-Only Backup Refs

创建本地备份：

```bash
git branch backup/pre-privacy-main   a480001b798878c30386e6ce7783fc305f56d18a

git tag backup-pre-privacy-v1.4.3   4335806482a5eb4a8b71d8e3501eeba6681aeb3e
```

这些 backup refs：

```text
LOCAL ONLY
```

绝对不能 push。

---

# 8. Verify Candidate Metadata

```bash
git show -s --format=fuller   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

必须确认：

```text
Author name = Xhoryon
Author email = public GitHub noreply
Committer name = Xhoryon
Committer email = public GitHub noreply
```

否则：

```text
STOP
```

---

# 9. Exact Tree Equivalence

```bash
OLD_TREE="$(git rev-parse   a480001b798878c30386e6ce7783fc305f56d18a^{tree})"

NEW_TREE="$(git rev-parse   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3^{tree})"

test "$OLD_TREE" = "$NEW_TREE"
```

必须 PASS。

不一致：

```text
STOP
```

---

# 10. Exact Parent Equivalence

```bash
OLD_PARENT="$(git rev-parse   a480001b798878c30386e6ce7783fc305f56d18a^)"

NEW_PARENT="$(git rev-parse   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3^)"

test "$OLD_PARENT" = "$NEW_PARENT"
```

必须 PASS。

---

# 11. File Diff Must Be Empty

```bash
git diff --exit-code   a480001b798878c30386e6ce7783fc305f56d18a   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

必须：

```text
exit 0
```

任何文件差异：

```text
STOP
```

---

# 12. V1.4.2 Must Stay Outside Rewrite

确认：

```bash
git rev-parse v1.4.2^{}
```

必须保持：

```text
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

本任务不得更新：

```text
v1.4.0
v1.4.1
v1.4.2
```

---

# 13. Public Local Git Identity

```bash
git config --local user.name "Xhoryon"
git config --local user.email   "260010709+Xhoryon@users.noreply.github.com"
```

禁止改 global config。

---

# 14. Prepare Clean Main Locally

```bash
git branch -f main   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

检查：

```bash
git rev-parse main
git diff --exit-code origin/main main
```

第二条必须 exit 0。

---

# 15. Rewrite Main With Force-With-Lease Only

执行：

```bash
git push origin   main:main   --force-with-lease=refs/heads/main:a480001b798878c30386e6ce7783fc305f56d18a
```

禁止：

```bash
git push --force
git push --mirror
git push --force --mirror
```

如果 lease 失败：

```text
STOP
```

remote 已变化，必须重新 fetch + review。

---

# 16. Verify Remote Main

```bash
git fetch origin
git rev-parse origin/main
```

必须：

```text
f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

再验证：

```bash
git diff --exit-code   a480001b798878c30386e6ce7783fc305f56d18a   origin/main
```

必须 0。

---

# 17. Recreate Annotated `v1.4.3`

删除**本地** tag：

```bash
git tag -d v1.4.3
```

重新创建：

```bash
git tag -a v1.4.3   f6b2a4677e67b8797c6e52a9947b5ddeecab9be3   -m "Geometry Battle V1.4.3 — Documentation Cleanup & Pair Integrity"
```

检查：

```bash
git cat-file -p v1.4.3
git show -s --format=fuller v1.4.3^{}
```

Tagger 必须是 noreply identity。

---

# 18. Rewrite V1.4.3 Tag With Lease

旧 remote tag ref object 预期：

```text
4335806482a5eb4a8b71d8e3501eeba6681aeb3e
```

执行：

```bash
git push origin   refs/tags/v1.4.3:refs/tags/v1.4.3   --force-with-lease=refs/tags/v1.4.3:4335806482a5eb4a8b71d8e3501eeba6681aeb3e
```

如果当前 Git 版本/服务不支持安全 tag lease：

```text
STOP
```

不要退化成 blind force。

改用能够提供：

```text
expected old ref → new ref
```

的 compare-and-swap 方法。

---

# 19. Verify Tag and Old Tags

```bash
git fetch origin --tags --force

git rev-parse v1.4.0^{}
git rev-parse v1.4.1^{}
git rev-parse v1.4.2^{}
git rev-parse v1.4.3^{}
```

要求：

```text
v1.4.2 =
e053b23549a0fbebf0d77baec277b0591c9a34dc

v1.4.3 =
f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

只有：

```text
main
v1.4.3
```

允许变化。

---

# 20. Verify GitHub Release

检查：

```text
https://github.com/Xhoryon/geometry-battle/releases/tag/v1.4.3
```

必须：

```text
exists
published
still bilingual
resolves through v1.4.3
```

Release body 不需要修改。

---

# 21. Reachable Public History Email Scan

从旧 commit 动态获取邮箱，不打印值。

在 fresh fetch / fresh clone 中检查：

```text
all remote branches
all public tags
main history
tag history
```

目标：

```text
personal email in public reachable refs = 0
```

注意本地 backup refs 不算 public，但绝不能被 push。

---

# 22. Enumerate Public Refs

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

确认不存在：

```text
backup/*
old-main/*
privacy-backup/*
```

公开 backup ref。

发现：

```text
P1 / FAIL
```

---

# 23. PR #3 Head Verification

PR #3 clean head：

```text
f6b2a467...
```

确认其 author/committer 都是 noreply。

PR head 本身无需重写。

---

# 24. Old Commit May Remain Accessible

即使 branch/tag 已清洁，旧 SHA：

```text
a480001b798878c30386e6ce7783fc305f56d18a
```

可能仍存在于：

```text
direct commit URL
GitHub cached view
PR metadata
GitHub internal retained object/ref
clones/forks
```

所以：

> **移动 main/tag 不等于 GitHub 端彻底删除旧 metadata。**

---

# 25. Direct Old-SHA Test

检查旧 commit URL/API。

分类：

## Case A — GOOD

```text
404 / no longer publicly retrievable
```

## Case B — BLOCKER

```text
old commit still publicly retrievable
and personal email still rendered
```

Case B：

```text
GitHub purge/support escalation required
```

---

# 26. PR / Cached Reference Check

检查：

```text
PR #3 page
merge_commit_sha
cached commit pages
```

如果旧 SHA 仍然可以从普通 GitHub UI/API 导航到，并显示个人邮箱：

```text
GITHUB-HOSTED RESIDUAL PRIVACY REFERENCE
```

---

# 27. GitHub Support Escalation

如果旧 SHA 仍可访问，向 GitHub Support 提交 private removal request。

说明：

```text
repository
old commit SHA
privacy-sensitive personal email was present in commit metadata
main and v1.4.3 have already been rewritten to clean equivalents
tree/content unchanged
request removal of cached commit view / retained PR reference / unreachable object if eligible
```

不要在公开 issue/PR 里再次粘贴个人邮箱。

---

# 28. Support Outcome

不要假设 GitHub 一定批准 purge。

### If approved

等待完成，重新测试 old SHA。

### If declined

保存 private support outcome。

此时：

- 可以声明 user-controlled public refs 已清洁；
- 不能声称 GitHub 所有后台对象已不存在。

如果本项目坚持：

```text
old SHA must no longer publicly render the personal email
```

那么 closure 仍 BLOCKED。

---

# 29. Do Not Create V1.4.4

这次不创建：

```text
v1.4.4
```

因为：

```text
no file content change
no runtime change
no product change
```

这是：

```text
V1.4.3 privacy metadata correction
```

V1.4.3 仍然是 V1.4.x 最终 release。

---

# 30. No New Content Commit

不要创建一个新：

```text
privacy cleanup commit
```

因为新 commit 不会删除旧 commit metadata。

正确方法是：

```text
ref/history remediation
```

---

# 31. Phase A Final Report

```text
GEOMETRY BATTLE V1.4.3 METADATA PRIVACY REMEDIATION

=== BEFORE ===
old main:
old v1.4.3:
old tag object:
v1.4.2:

=== CLEAN CANDIDATE ===
candidate:
tree equal:
parent equal:
file diff:
author identity:
committer identity:

=== REF REMEDIATION ===
main:
main force-with-lease:
v1.4.3:
tag force-with-lease:
blind force used:
mirror push used:

=== IMMUTABILITY ===
v1.4.0:
v1.4.1:
v1.4.2:

=== PUBLIC RELEASE ===
GitHub Release:
Release bilingual:
Release resolves:

=== PRIVACY ===
reachable public refs personal email:
old SHA accessible:
PR/cached residual:
GitHub Support required:
GitHub Support outcome:

=== CONTENT SAFETY ===
tree changed:
files changed:
runtime changed:
rules changed:

FINAL PHASE A STATUS:
READY FOR FRESH INDEPENDENT PRIVACY AUDIT
```

Phase A STOP。

---

# PART B — FRESH INDEPENDENT PRIVACY AUDIT

# 32. Phase B Role

新开 fresh Agent：

```text
Geometry Battle V1.4.3 Independent Metadata Privacy Auditor
```

不要使用 Phase A 工作目录。

---

# 33. Fresh Clone After Rewrite

```bash
git clone https://github.com/Xhoryon/geometry-battle.git   geometry-battle-v1.4.3-privacy-audit

cd geometry-battle-v1.4.3-privacy-audit
git fetch --tags
```

---

# 34. Verify Main

```bash
git rev-parse origin/main
```

预期：

```text
f6b2a4677e67b8797c6e52a9947b5ddeecab9be3
```

如果 Phase A 最终使用了另一个 approved clean equivalent commit，则以最终记录为准，但必须重新验证：

```text
same tree
same parent
noreply author
noreply committer
```

---

# 35. Verify V1.4.3

```bash
git rev-parse v1.4.3^{}
```

必须与：

```text
origin/main
```

一致。

---

# 36. Verify V1.4.2

```bash
git rev-parse v1.4.2^{}
```

必须：

```text
e053b23549a0fbebf0d77baec277b0591c9a34dc
```

否则：

```text
P1 / FAIL
```

---

# 37. Exact Content Preservation

独立验证：

```text
tree identity = PASS
parent identity = PASS
file diff = 0
```

如果 old commit 本地仍可引用：

```bash
git diff --exit-code   a480001b798878c30386e6ce7783fc305f56d18a   v1.4.3^{}
```

应为 0。

---

# 38. Verify Metadata

```bash
git show -s --format=fuller origin/main
git show -s --format=fuller v1.4.3^{}
git cat-file -p v1.4.3
```

要求：

```text
author = public noreply
committer = public noreply
tagger = public noreply
```

---

# 39. Public Reachable Email Scan

Auditor 自己获取 old email，但不打印值。

扫描：

```text
origin/main
all remote branches
all public tags
```

要求：

```text
personal email matches = 0
```

---

# 40. Remote Ref Hygiene

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

检查：

```text
no public backup ref
no old-main ref
no privacy-backup ref
```

---

# 41. GitHub Release Audit

确认：

```text
v1.4.3 Release exists
published
bilingual
still points through clean v1.4.3 tag
```

---

# 42. Old SHA Privacy Test

独立访问旧 SHA。

严格 closure PASS 条件：

```text
old commit no longer publicly exposes personal email
```

若仍公开可见：

```text
P1 / closure BLOCKED
```

直到 GitHub-hosted residual exposure得到解决，或用户明确改变 closure 标准。

---

# 43. PR #3 Audit

确认：

```text
PR head is clean
normal PR view does not expose personal email
```

若 GitHub 的 retained merge object 仍可公开导航并显示邮箱：

记录 blocker。

---

# 44. GitHub Support Verification

如果 Phase A 提交了 Support request：

Auditor 必须检查：

```text
actual outcome
old SHA after purge
cached view after purge
```

仅有：

```text
ticket submitted
```

不算 PASS。

---

# 45. No Runtime Re-Test Needed

因为目标是：

```text
same tree
same parent
```

所以无需重新跑：

```text
npm test
fairness campaign
Playwright matrix
```

文件内容 identity 就是核心产品安全证据。

---

# 46. Severity

## P0

```text
real secret/private key
catastrophic privacy exposure
```

## P1

```text
personal email still reachable in public branch/tag history
old SHA still publicly renders personal email under strict closure policy
v1.4.2 moved
tree changed
runtime/content changed
blind force caused unrelated history loss
public backup ref exposes old commit
```

## P2

```text
stale cache without personal data rendered
minor Release metadata mismatch
```

## P3

```text
cosmetic metadata wording
```

---

# 47. Phase B Report

```text
# Geometry Battle V1.4.3 Metadata Privacy Audit

## Refs
origin/main:
v1.4.0:
v1.4.1:
v1.4.2:
v1.4.3:

## Exact Content Preservation
tree identity:
parent identity:
file diff:
runtime/content diff:

## Metadata
main author:
main committer:
tagger:
personal email in reachable branch/tag history:

## Public Ref Hygiene
remote heads:
remote tags:
accidental backup refs:

## GitHub Release
exists:
bilingual:
resolves to clean tag:

## Old Object
old SHA publicly accessible:
personal email visible:
PR/cached reference:
Support purge:
post-purge result:

## Findings
P0:
P1:
P2:
P3:

## Final Decision
```

---

# 48. Allowed Final Decisions

只能：

```text
PASS — V1.4.3 METADATA PRIVACY REMEDIATION VERIFIED
```

或：

```text
CONDITIONAL PASS — <specific residual GitHub-hosted blocker>
```

或：

```text
FAIL — <P0/P1 blocker>
```

---

# 49. V1.4.x Closure Gate

只有出现：

```text
PASS — V1.4.3 METADATA PRIVACY REMEDIATION VERIFIED
```

之后，正式声明：

```text
GEOMETRY BATTLE V1.4.x — CLOSED
```

---

# 50. Meaning of CLOSED

关闭后：

```text
V1.4.0 — platform fairness + tournament UX
V1.4.1 — complete bilingual documentation
V1.4.2 — language-switchable documentation
V1.4.3 — documentation cleanup + pair integrity
V1.4.3 — Git metadata privacy correction
```

全部视为完成。

不再创建：

```text
V1.4.4
V1.4.5
...
```

处理普通：

```text
README polish
translation style
formatting
metadata cleanup
```

除非发现新的：

```text
security/privacy blocker
competition correctness blocker
serious release-integrity problem
```

---

# 51. Next Line

V1.4.x CLOSED 后：

```text
next real product development → V1.5
```

V1.5 应对应真正产品能力，而不是文档小修。

---

# 52. Final Closure Statement

只有独立 PASS 后使用：

```text
Geometry Battle V1.4.x is formally closed.

The V1.4 platform, fairness remediation, bilingual documentation,
language-switchable documentation, pair-integrity cleanup,
public sanitization, and Git metadata privacy remediation have
all completed their required release and independent verification gates.

Future product development proceeds on the V1.5 line.
```

中文：

```text
Geometry Battle V1.4.x 正式关闭。

V1.4 平台、公平性修复、完整双语文档、语言切换文档、
语言对完整性清理、公开脱敏以及 Git metadata 隐私修复，
均已完成对应的发布与独立审核门禁。

后续产品开发进入 V1.5 版本线。
```

---

# 53. Stop Conditions

立即 STOP，如果：

1. clean candidate tree 与旧 V1.4.3 不一致；
2. parent 不一致；
3. v1.4.2 需要移动；
4. remote main 在 remediation 前被别人更新；
5. force-with-lease 失败；
6. 唯一可行方案变成 blind force；
7. 需要 `git push --mirror`；
8. 文件内容发生变化；
9. public backup ref 被意外 push；
10. old SHA 仍公开显示个人邮箱且 purge 尚未完成。

---

# 54. Final Principle

本任务不是代码发布。

它必须满足：

```text
same files
same tree
same parent
clean metadata
safe refs
verified remote
privacy closure
```

只有这些全部成立：

```text
V1.4.x = CLOSED
```
