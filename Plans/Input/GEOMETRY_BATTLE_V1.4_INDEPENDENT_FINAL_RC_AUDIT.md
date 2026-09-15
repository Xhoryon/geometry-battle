# Geometry Battle V1.4 — Independent Final RC Audit

> **用途 / Purpose**  
> 交给一个全新、独立、高性能 Auditor Agent，对 Geometry Battle V1.4 Release Candidate 做最终发布审计。
>
> Auditor **没有参与 V1.4 实现**。所有开发报告都只是 claims，必须独立检查 Git、源码、测试、公平性证据、真实浏览器行为、文档与发行边界。
>
> **审计模式 / Audit Mode**：read-mostly, evidence-first, no silent remediation.

---

# 0. 最终目标

只回答一个问题：

> **当前 V1.4 RC 是否可以正式发布？**

最终只能给出三种结论之一：

```text
PASS — APPROVED FOR V1.4 RELEASE
```

```text
CONDITIONAL PASS — <specific finite blocker(s)>
```

```text
FAIL — <P0/P1 blocker(s)>
```

如果 PASS，必须额外写：

```text
APPROVED RELEASE CANDIDATE HEAD:
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

Auditor **不得自行创建 tag、push、配置 remote 或继续开发**。

---

# 1. Authoritative Candidate

V1.3 已批准内部基线：

```text
febf1c69fb6cb78624811513149f477c4e30fac6
```

V1.4 当前候选：

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

预期分支：

```text
feature/v1.4-platform-ux
```

开发侧报告提交序列：

```text
0b5f671  feat(competitor)
f965cf0  fix(starter)
f24ffa7  fix(core) Validator
5fbe0c5  test(platform) mirror-match
0191ed4  feat(web)
78d9652  test(web)
185a992  test(platform) campaign
7f6e39d  docs(state)
```

不要直接相信这些值，先用 Git 验证。

---

# 2. Auditor Role

你是 Geometry Battle V1.4 **独立最终审计员**。

你的工作是：

```text
verify
reproduce
inspect
challenge
classify
decide
```

不是：

```text
develop
redesign
rewrite
polish
optimize algorithms
```

不得把审计悄悄变成开发波次。

---

# 3. Audit Discipline

必须遵守：

1. 所有开发总结都视为 claims，不是 proof。
2. 优先检查实际 Git tree、实际源码、实际测试、实际浏览器。
3. 关键结论必须有可复核证据。
4. P0/P1 先报告，不自动修复。
5. P2/P3 正常只记录。
6. 不为“跑绿”而修改测试、规则、阈值或计时预算。
7. 不重新打开与 V1.4 无直接关系的旧审计。

---

# 4. Git Safety

审计期间禁止：

```text
git push
git push --force
git tag
git tag -f
git reset --hard
git rebase
git commit --amend
git filter-repo
git remote add
```

禁止移动任何既有 competition release tag。

禁止创建 V1.4 tag。

---

# 5. Use a Clean Audit Tree

开发工作树报告存在历史残留：

```text
experiments/algo-a/
```

约 1296 个未跟踪文件，不属于 V1.4。

优先建立 detached audit worktree：

```bash
git worktree add ../geometry-battle-v1.4-audit \
  --detach \
  7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

或用 `git archive` 建立精确 RC tree。

不要删除原开发 worktree 的历史残留。

---

# 6. Initial Repository Verification

首先执行：

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
git show --no-patch --oneline HEAD
git log --oneline --decorate febf1c6..HEAD
git diff --stat febf1c6..HEAD
git tag --list --format='%(refname:short) %(objectname)'
git remote -v
```

记录：

```text
candidate SHA
commit count
commit order
working tree
tags
remote
```

如果候选 SHA 不等于：

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

停止审计并报告。

---

# 7. V1.4 Audit Scope

V1.4 的核心变更包括：

```text
A. Platform mirror fairness
B. Validator numerical sampling fix
C. Permanent fairness tests
D. Same-solver / mirror campaign
E. Competitor Kit / handbook
F. Mirror checker
G. Starter synchronization
H. Home / Judge / Team / Spectator / Replay UX
I. Shared status/error UI
J. Localization expansion
K. Accessibility
L. Browser / E2E workflow
M. Documentation / project state
```

---

# 8. Do Not Reopen Unrelated History

除非 V1.4 产生直接新证据，不重新完整审计：

```text
V1.2 ZIP/DEFLATE
旧 capability token 架构
旧 host-path 修复
旧 Emitter lock privacy
V1.3 README fence
V1.3 全历史 localization
旧 run-to-end 修复全过程
A-v1/B-v1 谁更强
demo solver period-2
历史 playtest balance
```

---

# PART A — PLATFORM FAIRNESS

# 9. Core Question

本轮平台审计最重要的问题：

> **Team A 与 Team B 是否在平台层面镜像公平？**

必须区分：

```text
solver bug
platform bug
map sampling artifact
OS scheduling noise
true slot bias
```

不能直接用 raw win rate 推导平台偏差。

---

# 10. Independently Reproduce the Old Validator Bug

开发报告声称 V1.3 Validator 有真实不对称：

```text
Team A numerical sampling grid effectively starts from own Emitter
Team B grid was anchored from domain[0] / -20 field side
```

导致：

```text
mirror-equivalent functions
→ sampled at non-mirrored x
→ threshold-adjacent legality can diverge
```

Auditor 必须独立：

1. 查看 V1.3 baseline 的旧 `Validator.ts`；
2. 理解相关 numerical sampling loops；
3. 构造至少一个稳定 reproducer；
4. 证明旧实现存在 A/B divergence；
5. 证明 divergence 来自 sampling grid，而不是 solver output 不镜像。

不要只运行新测试然后宣称旧 bug 存在。

---

# 11. Validate the V1.4 Validator Fix

检查 V1.4 `Validator.ts`。

期望：

```text
Team A:
start at own Emitter
advance toward +x

Team B:
start at own Emitter
advance toward -x
```

在镜像状态下应有：

```text
x_B(i) = -x_A(i)
```

确认修复没有改变：

```text
COMPUTE_TIMEOUT_MS
TIE_EPS_MS
HIT_EPSILON
OBSTACLE_CONTACT_EPS
Emitter tolerance
convexity limit
oscillation limit
AST limits
victory conditions
stalemate limit
hard round limit
```

---

# 12. Correctness Fix vs Rule Change

明确回答：

> 这次行为变化是改变正式规则，还是让实现符合本来已经存在的规则？

检查：

```text
Rules
DSL specification
Judge traversal
participant protocol
historical documented domain
```

若正式语义一直是：

```text
A: Emitter → +20
B: Emitter → -20
```

则 Validator 修复应归类为 correctness/fairness fix，而非规则改版。

---

# 13. A-Side Preservation

开发侧声称对约 6000 个边界函数，修复前后 Team A：

```text
valid/invalid identical
issue codes identical
convexity count identical
maxAbsValue identical
maxAbsSlope identical
```

仅 `maxAbsCurvature` 可能因表达式重排发生 last-ULP 差异，且不参与 verdict。

独立抽样复核。

必须回答：

```text
该 last-ULP 差异是否可能改变正式合法性？
```

若不能，记录为 informational。

---

# 14. B-Side Intended Changes

检查 B-side legality 在旧 bug 修复后发生变化是否符合预期。

至少 spot-check：

```text
div pole near edge
convexity threshold
tan/domain pole
curvature/noise
```

区分：

```text
compatibility-visible correctness change
```

与：

```text
unintended rule change
```

---

# 15. Mirror Helpers

检查：

```text
tests/mirror-helpers.ts
```

至少确认：

```text
point
Emitter
Combat Point
circle
rectangle
segment
polygon
team identity
IDs
GeneratedMap fields
attack direction semantics
```

重点：

- rectangle xmin/xmax 正确交换；
- polygon winding reversal 不影响 Judge 几何；
- GeneratedMap 没有字段被遗漏；
- obstacle order 没被无意义改变。

---

# 16. `mapHash` Helper Nuance

若测试 helper 在 mirror core 中保留 original `mapHash`：

确认它在被测 resolution path 中只是 metadata。

如果不影响：

```text
hits
winner
termination
trajectory
```

可记 P3/test-helper limitation。

如果影响正式判定，升级。

---

# 17. Mirror-Fairness Non-Vacuity

检查：

```text
tests/mirror-fairness.ts
```

开发过程中 random L4 曾出现：

```text
0 hits
```

导致 hits assertions 空洞。

最终报告称已修成大量真实命中。

Auditor 检查 assertions 是否真的要求：

```text
hits > 0
per-family hit coverage > 0
hitDetails compared
killed compared
```

而不是仅打印计数。

---

# 18. Invalid-Function Coverage

最终定向 probes 报告为约 198 个。

检查至少包含：

```text
convexity-straddle
tan/domain pole
div pole near edge
narrow spike
curvature/noise floor
```

旧 Validator 应至少对部分探针稳定红，新 Validator 应恢复镜像一致。

---

# 19. Validation Metrics

检查 mirror comparison 是否比较：

```text
valid
issue codes
convexityChanges
maxAbsValue
maxAbsSlope
maxAbsCurvature
```

如果 informational metric 被要求 bit-exact，判断测试是否过度严格。

不要因为这个问题直接修改测试；只记录风险。

---

# 20. Trajectory Mirror

检查 trajectory mirror test。

开发报告称有数百万 points 的镜像比较。

确认 assertions 实际覆盖：

```text
x mirrored
y equal
termination correspondence
direction
```

而不是只统计点数。

---

# 21. JudgeShot Mirror

检查：

```text
blocked
endReason
hits
hitDetails
killed
trajectory
```

确认既有：

```text
random real-hit cases
constructed multi-kill cases
```

---

# 22. Ordered Resolution Mirror

检查 ordered-shot / round resolution：

```text
original killed-A/killed-B
↔ mirrored killed-B/killed-A
```

并检查：

```text
both-hit cores
already-dead semantics
```

---

# 23. Full Match Mirror

运行永久 `mirror-match` suite。

确认：

```text
original winner A → mirror winner B
original winner B → mirror winner A
draw → draw
```

相关：

```text
round count
kills
replay trajectory
```

应满足对应关系。

注意：

> 单轮 firstSolver 不要求镜像，因为受真实 OS scheduling 影响。

---

# 24. Symmetry Probe Solver

检查：

```text
tests/fixtures/algos/symmetry-probe/**
```

要求：

- deterministic；
- 正确方向归一化；
- A/B 语义镜像；
- 无 hidden cross-round state；
- 无网络；
- 无 seed hardcode；
- 仅 test/audit fixture；
- 未暴露成 Tournament Mode 正式 bundled competitor。

---

# 25. Fairness Campaign Methodology

检查：

```text
experiments/v1.4-fairness/
Plans/Output/V1.4_PLATFORM_FAIRNESS_REPORT.md
```

开发报告声称大约：

```text
probe       240 matches / 120 pairs
solver-fast 180 / 90 pairs
B-v1        180 / 90 pairs
```

确认：

- original + mirror 成对；
- same package vs same package；
- 平台相同；
- 无按胜负删样本；
- 没有因不利结果改 seed；
- environmental anomaly 被透明记录。

---

# 26. Slot-Win Bias Conclusion

开发结论：

```text
SLOT WIN BIAS: DISPROVEN
```

主证据包括：

```text
167/167 decisive mirrored pairs
winner swaps
```

审计应判断措辞是否过强。

更稳健的 release 表述可以是：

```text
No platform slot bias detected under the tested mirror-paired conditions.
```

区分：

```text
mirror invariant evidence
```

与：

```text
unpaired natural-map raw win rate
```

---

# 27. B-v1 Original-Only Observation

开发报告保留：

```text
B-v1 original-only A-side ~0.397, p~0.029
```

同时镜像配对胜者全部交换。

不要因此自动扩大 seed campaign。

检查是否存在：

```text
actual platform invariant violation
```

若没有，记录为：

```text
solver × sampled geometry observation
```

而非 release blocker。

---

# 28. First-Solver Bias

开发侧报告：

```text
4465 non-tied rounds
P(A first) ≈ 0.491
95% CI ≈ [0.476, 0.506]
```

检查：

- denominator；
- tie handling；
- CI method；
- event extraction；
- timeout/invalid handling。

无需重跑全部 4465。

---

# 29. First-Solver Semantics

更重要的是检查规则：

```text
both algorithms compute from START snapshot
both valid attacks execute
```

确认：

```text
firstSolver
```

不会：

- 取消第二发；
- 改变第二发计算输入；
- 让第二边因第一边死亡而不执行已锁定攻击。

若只影响 live execution order，记录。

---

# 30. Map Distribution

开发报告：

```text
27,000 maps
14 paired metrics
min p ~0.16
max |d_z| ~0.009
```

检查：

- 统计代码；
- sample generation；
- metrics；
- left/right-sensitive geometry；
- effect-size calculation。

不要把“不显著”写成数学证明。

推荐措辞：

```text
No material map-distribution asymmetry detected at the tested scale.
```

---

# 31. Host Sleep Anomaly

campaign 曾出现 host idle sleep 导致超长单场和 timeout。

确认：

- 透明记录；
- 没删掉不利结果；
- 没修改 500ms；
- 正常复跑/镜像证据存在。

如果如此：

分类为 operator/environment limitation。

---

# PART B — COMPETITOR KIT / HANDBOOK

# 32. Sources

重点检查：

```text
competitor-kit/README.md
competitor-kit/ALGORITHM_REQUIREMENTS.md
competitor-kit/RUNTIME_MANIFEST.md
competitor-kit/DSL_SPECIFICATION.md
competitor-kit/JSON_SCHEMA.md
README.md
starter copies
```

---

# 33. Orientation & Symmetry

中英文必须一致写清：

```text
Team A forward = increasing x
Team B forward = decreasing x
```

检查局部坐标示例数学正确。

---

# 34. Both-Side Requirement

必须明确：

```text
The same formal submission MUST run correctly as Team A and as Team B.
```

中文同样必须是：

```text
必须
```

不能出现中文 MUST、英文 may 的强度漂移。

---

# 35. Array Ordering

回查实际 protocol/server code。

检查文档对以下说法是否真实：

```text
Combat Point order
x sorting
placement order
dead-point handling
Emitter removal
ID renumbering
obstacle IDs/order
```

不能承诺 runtime 没有保证的排序。

---

# 36. JSON Schema Drift

开发侧报告修复了类似：

```text
id 会随击杀减少
```

的旧错误描述。

确认最终 JSON/schema 文档与真实协议一致。

---

# 37. Validation Grid Documentation

DSL 文档应明确：

```text
sampling starts at own Emitter
advances in attack direction
two sides' sampling grids mirror
```

检查中英文与真实 Validator 一致。

---

# 38. Mirror Checker

检查：

```text
competitor-kit/tools/check_mirror.py
src/operator/check-mirror.ts
```

要求：

- Python wrapper 不复制 Judge/Validator；
- TS 使用正式 parser/validator；
- relative path 规则明确；
- 不依赖开发机绝对路径。

---

# 39. PASS / WARN / FAIL Semantics

开发侧报告：

```text
PASS / WARN / FAIL
exit 0 / 1 / 2
```

独立测试：

1. 正常双侧 solver；
2. A-only crash；
3. B-only crash；
4. 两侧都失败；
5. B 返回合法但明显退化攻击；
6. 镜像语义不匹配。

特别防止：

```text
legal but wrong-on-one-side
```

被判 PASS。

---

# 40. Formal Preflight Boundary

确认 mirror checker 只是：

```text
development diagnostic
```

没有偷偷变成新的 formal Tournament Mode rejection rule。

正式 Preflight 语义保持。

---

# 41. Starter Synchronization

重点审：

```text
f965cf0
```

回答：

```text
STARTER UPDATE: KEEP / REVERT
```

检查：

- starter copies 应相同处 byte-identical；
- 修改与 V1.4 docs/runtime 对齐；
- 无隐藏 competitive advantage；
- 无正式规则修改；
- 无 internal benchmark 泄漏。

**hash 改变本身不是失败。**

---

# PART C — FRONTEND / UX

# 42. Authority Boundary

前端 V1.4 改动不得改变：

```text
Engine authority
Judge rules
match semantics
hashes
replay authority
participant inputs
Emitter semantics
500ms compute budget
```

浏览器必须仍然只是：

```text
projection + interaction + animation
```

---

# 43. Run Real Application

启动真实应用：

```bash
npm install
npm run app
```

打开：

```text
/
/judge
/team/a
/team/b
/spectator
/replays
/replay/:matchId
```

不要仅从源码审 UI。

---

# 44. Both Locales

真实检查：

```text
zh-CN
en-US
```

至少验证：

- whole-page switch；
- refresh persistence；
- route persistence；
- accessibility strings；
- no raw keys；
- no unresolved placeholders。

---

# 45. Home

检查：

```text
role selection
Judge
Team A
Team B
Spectator
Recent Replays
```

导航存在不代表获得权限。

---

# 46. Token / Capability Safety

开发侧称 access links/token 使用 fragment 且不持久化。

检查：

- 不写 query string；
- 不在 body 泄漏；
- 不写不安全 localStorage；
- 不进入普通 logs；
- 不因 Home 页面绕过 auth。

---

# 47. Judge IA

确认 Judge 真正变成 phase-driven workflow，而不是旧按钮换位置。

检查七阶段和实际 machine phase mapping。

---

# 48. Judge Primary Action

每阶段应有一个视觉明显主操作。

检查：

```text
PrimaryAction
disabled reason
why text
```

不要同时多个同权重 CTA。

---

# 49. Judge Advanced

低级操作进入 Advanced。

确认：

- 必要功能仍可达；
- 主流程不依赖 Advanced；
- destructive/debug action 不成为默认按钮。

---

# 50. Judge Team Cards

应安全显示：

```text
algorithm name
short hash
origin/source-safe metadata
Preflight
Emitter lock
compute
```

不得显示：

```text
slotRoot
absolute source path
artifactDir
/Users/...
/private/tmp/...
```

最好用真实 `/tmp/...` slot root 做 DOM scan。

---

# 51. Source Review

确认：

- 文件列表；
- source preview；
- auth；
- traversal protection；
- no absolute path leak；
- no stale client fake source。

---

# 52. Reset Safety

检查：

- reset 二步确认；
- impact text；
- cancel；
- shortcut 不直接 reset；
- Reveal/Start 不被多余确认拖慢。

---

# 53. Match-End UX

终局应明显提供 Replay。

不要求必须使用某一个组件，只要求主流程明确。

---

# 54. Team Workflow

两队都走：

```text
Upload
→ Validate
→ Preflight
→ Select Emitter
→ LOCK
→ Wait
→ Match
```

检查 UI 与 server authoritative state 一致。

---

# 55. LOCK UX

LOCK 后：

```text
clearly immutable
```

要求：

- text；
- not color-only；
- refresh 后仍锁；
- server 真不可变。

---

# 56. Team Error UX

检查：

```text
upload
package validation
preflight
lock
connection
round
```

错误靠近相关操作。

正常英文流程不能大面积出现平台中文。

---

# 57. Board Readiness Boundary

历史上：

```text
WS connected != authoritative board ready
```

V1.4 不得回归。

检查：

```text
data-board=pending|ready
```

必须由 authoritative board 决定。

---

# 58. Spectator

确认：

- read-only；
- 除语言控制外无比赛动作；
- Arena 是视觉中心；
- scoreboard / round / alive / first / compute / kills 清楚。

---

# 59. Terminal Spectator

终局横带应显示：

```text
winner/draw
end reason
round
```

但不应完全遮掉最后一帧。

---

# 60. Replay Authority — P1 Boundary

Replay 必须使用：

```text
persisted authoritative artifacts only
```

不得：

```text
rerun solver
recompute function legality
recompute hit
recompute winner
```

源码与实际行为都要检查。

---

# 61. Replay Player

检查：

```text
Previous
Play/Pause
Next
timeline
Round N / Total
0.5x / 1x / 2x
```

速度只改变 animation/presentation timing。

---

# 62. Replay Previous Polish

检查：

```text
firstSolver tie / none
endReason label
winner label
difficulty lookup
```

轻微 raw enum 若不影响 correctness，可 P2/P3。

---

# 63. Safe Difficulty Lookup

避免 prototype-chain lookup 让：

```text
__proto__
constructor
toString
```

产生错误 UI。

检查是否使用 `Object.hasOwn` 或等价安全方式。

---

# 64. Navigation

检查 AppShell：

```text
Home
Judge
Teams
Spectator
Replays
Language
```

Team 页面隐藏 Judge 链接只算 UX，不算 security。

真正 auth 仍必须 server-side。

---

# 65. Status Design System

检查 shared status components 与七态：

```text
neutral
waiting
ready
active
warning
error
terminal
```

不要求完美设计系统，只要求同义状态表现一致。

---

# 66. Error UX

检查错误来源是否至少被合理分层：

```text
participant
package
preflight
round
judge
connection
server
```

关键错误应告诉用户：

```text
发生了什么
能否恢复
下一步是什么
```

---

# PART D — LOCALIZATION / ACCESSIBILITY

# 67. Key Parity

开发侧报告：

```text
zh-CN 406
en-US 406
```

独立统计实际 key。

检查：

```text
same key set
same placeholder set
no empty required values
```

不要把“必须正好 406”当成功条件。

---

# 68. Browser Wiring

实际页面检查：

```text
Home
Judge
Team A/B
Spectator
Replays
Replay
```

两语言。

正常 flow：

```text
raw translation keys = 0
unresolved {placeholder} = 0
```

---

# 69. Mixed-Language Boundary

用户算法名、源码、机器 error code 可以原样。

平台自己的普通文案不应在 en-US 大量出现中文。

free-text server fallback 可以作为已记录边界，但不能破坏正常流程。

---

# 70. Accessibility

检查：

```text
role=alert/status
aria-current
aria-pressed
aria-describedby
aria-valuetext
focus-visible
prefers-reduced-motion
```

不做正式 WCAG certification。

只报告真实 usability blocker。

---

# 71. Keyboard

用真实键盘 spot-check：

```text
Tab
Shift+Tab
Enter
Space
```

关键动作不能仅靠鼠标 hover。

---

# 72. Color Independence

以下状态不能只靠颜色：

```text
LOCKED
error
ready
winner
disabled
```

---

# PART E — LAYOUT / BROWSER

# 73. Viewports

至少：

```text
1024×768
1280×720
1440×900
1920×1080
```

高风险 routes 两语言检查。

关注：

```text
horizontal overflow
header collision
arena collapse
button clipping
timeline overflow
source viewer overflow
English expansion
```

---

# 74. Known Header Wrap

已知：

```text
1280 EN header metadata may wrap
```

只要：

```text
no overlap
no overflow
no hidden action
```

不应成为 blocker。

---

# 75. Browser / OS Claims

开发侧实际只测：

```text
macOS Google Chrome
```

最终报告必须诚实：

```text
macOS Chrome: TESTED
macOS Safari: NOT TESTED
Windows Chrome: NOT TESTED
Windows Edge: NOT TESTED
```

除非 Auditor 实际运行。

---

# 76. Static Cross-Platform Review

检查是否新引入：

```text
macOS-only filesystem assumptions
Cmd-only critical actions
unsupported browser API without fallback
Windows-invalid filenames
```

重点：

```text
File API
WebSocket
localStorage
Canvas
Decompression
keyboard modifiers
```

---

# 77. Keyboard Shortcuts

快捷键只能辅助。

所有关键比赛操作必须有 visible button。

若有 macOS Meta 分支，应有 Ctrl 等价或不影响核心流程。

---

# 78. Canvas Boundary

确认 UI 重构没有恢复历史 circle rendering bug。

非均匀映射下 circle 在屏幕空间应按正确 ellipse 投影。

浏览器不得独立做 Judge geometry。

---

# 79. Frontend Performance

轻量检查：

- WS update 不明显卡顿；
- Canvas 正常；
- Replay 正常；
- 无明显巨大新依赖；
- 无每帧整页重建造成可见性能问题。

无需专业 benchmark。

---

# PART F — REAL BROWSER QA

# 80. Real Tournament Rehearsal

Auditor 至少亲自走一场：

```text
Home
→ upload A/B
→ source review
→ Preflight
→ select Emitters
→ lock
→ READY
→ Reveal
→ START
→ rounds/run-to-end
→ Spectator
→ terminal
→ Replay
→ reset/new match confirmation if applicable
```

不能只依赖 E2E。

---

# 81. Chinese Flow

关键完整流程：

```text
zh-CN
```

检查：

```text
mixed language
raw enum
layout
errors
statuses
```

---

# 82. English Flow

同样：

```text
en-US
```

检查平台中文残留和英文扩展布局。

语言切换按钮写 `中文` 属于合理例外。

---

# 83. Missing Replay

打开不存在的 replay。

确认：

- UI 正常 not-found；
- HTTP 404 console line 可以接受；
- app 不 crash。

---

# 84. Connection Recovery

做一次简单 reconnect 检查即可：

```text
connecting
connected
reconnecting
disconnected
board pending
board ready
```

不要扩展成 chaos engineering。

---

# PART G — TEST QUALITY

# 85. Test Registration

检查：

```text
tests/run-all.ts
```

确认新增 suites 真正注册并运行，例如：

```text
mirror-fairness
mirror-match
web-wizard
```

---

# 86. Typecheck Coverage

项目已知 `npm run typecheck` 不一定覆盖 tests/web。

因此完整验证必须包含：

```text
npm run typecheck
npm run typecheck:web
npm test
```

不要把 typecheck 当作测试 TS 文件一定被编译的证明。

---

# 87. Mutation / Anti-Vacuity Spot Checks

不需要重复完整 mutation campaign。

任选 3–5 个强检查：

### Mirror

故意不 swap rectangle xmin/xmax → mirror tests 应红。

### Validator

临时恢复旧 B sampling anchor → targeted fairness 应红。

### Probe

B 方向写反 → mirror-match 应红。

### Wizard

primary action stage mapping 错一格 → web-wizard 应红。

### Board ready

移除 authoritative board wait → 相应 contract/E2E 应红。

### i18n

删 required key → compile/i18n 应红。

所有 mutation 在隔离副本中做。

---

# 88. Timing-Fairness Policy

如果 `timing-fairness` 失败：

先保存完整日志并记录：

```text
uptime
load
high CPU processes
actual metric
```

禁止：

```text
loosen threshold
change 500ms
delete test
silently rerun until green
```

如果 full gate 正常绿，不需要大规模重复 timing。

---

# PART H — DOCUMENTATION

# 89. Platform Fairness Report

读取：

```text
Plans/Output/V1.4_PLATFORM_FAIRNESS_REPORT.md
```

抽查：

```text
sample sizes
mirror-pair counts
firstSolver stats
mapstats
probe hash
sleep anomaly
```

与实际 tooling/artifacts 对照。

---

# 90. Browser QA Report

读取：

```text
Plans/Output/V1.4_BROWSER_QA_REPORT.md
```

确认：

```text
routes
locales
viewports
browser
known limitations
```

没有夸大 Safari/Windows 支持。

---

# 91. Development Log

读取：

```text
docs/agent-context/V1.4_DEVELOPMENT_LOG.md
```

可以包含：

```text
failed attempts
429
402
interrupted subagents
red mutations
```

这些不是产品 failure。

重点是记录是否诚实、最终 tree 是否完整。

---

# 92. Subagent 429 / 402

开发报告称：

```text
A4 report agent → 429
F5/V2 → 402
```

检查：

- lead 的手工收尾有实际实现和测试支持；
- 没伪称失败 Agent 自己完成；
- 无缺失重要交付。

若完整，记 process note。

---

# 93. PROJECT_STATE

检查：

```text
docs/agent-context/PROJECT_STATE.md
```

应只保留当前稳定事实。

检查：

- branch；
- current V1.4 state；
- suite counts；
- fairness conclusions；
- known limitations；
- 无明显过期结论。

---

# 94. README

检查：

- `/`；
- `/replays`；
- V1.4 capabilities；
- participant workflow；
- bilingual consistency；
- commands 实际可执行；
- no absolute machine path。

---

# 95. Tournament Host Checklist

正式操作文档应建议：

```text
power connected
disable automatic sleep
avoid heavy background load
sandbox smoke test
```

macOS 可提供：

```bash
caffeinate -i
```

作为 operator guidance。

不能让平台核心逻辑依赖它。

---

# PART I — SECURITY / PRIVACY REGRESSION

# 96. Authorization

V1.4 UI 改造不得破坏：

```text
Team auth
Judge auth
WS pre-board auth
match-change token/capability invalidation
```

做 targeted regression 即可。

---

# 97. Home Cannot Bypass Auth

从 `/` 点 Judge / Team：

没有有效 capability 时仍不能看到授权 board 或执行 privileged action。

UI link 不得成为权限。

---

# 98. Absolute Path Leakage

搜索和浏览器检查：

```text
/Users/
/private/
/tmp/
slotRoot
artifactDir
absolute source path
```

generic negative-test literals 不算泄漏。

真实具体 host path 才算。

---

# 99. Secret Scan

快速扫描：

```text
ghp_
github_pat_
Bearer
Authorization:
PRIVATE KEY
password=
api_key
token=
```

区分 test literal 与真实 secret。

真实 credential = P0/P1。

---

# 100. Runtime Artifacts

候选 commit 不应包含：

```text
node_modules
dist
screenshots
scratchpad
runtime uploads
populated slots
temporary campaign logs
personal algo-a fixtures
.DS_Store
```

除非明确属于小型、必要、可复现的正式 test evidence。

---

# PART J — STARTER RELEASE DECISION

# 101. Required Decision

最终报告必须单独给：

```text
STARTER UPDATE:
KEEP / REVERT
```

推荐 KEEP 条件：

```text
starter matches V1.4 public kit
copies are synchronized
no formal rule change
no internal benchmark logic leak
tests pass
```

REVERT 条件：

```text
unnecessary churn
content drift
internal-only content
runtime mismatch
```

hash 改变本身不是理由。

---

# PART K — FULL GATE

# 102. Full Verification

在 reasonably normal machine load 下跑一次：

```bash
npm run typecheck
npm run typecheck:web
npm test
npm run e2e
```

开发侧预期：

```text
typecheck       0 errors
typecheck:web   0 errors
npm test        42/42 suites, 357 tests
npm run e2e     11 passed
```

实际值为准。

记录：

```text
exit code
suite count
test count
duration
system load
```

---

# 103. Failure Policy

如果任何命令失败：

```text
保留完整输出
不使用 tail 丢掉断言
不静默重试
```

分类：

```text
product
test
environment
audit setup
```

环境性判断必须有证据。

---

# 104. No Heavy Repeat Campaign

如果 full gate 绿：

不要继续：

```text
50x e2e
500 more seeds
10x timing
```

除非出现具体新 race/reproducer。

---

# 105. Run Heavy Gate Without Competing Campaigns

正式 full gate 前确认：

```text
fairness campaign stopped
background heavy workflow stopped
machine load reasonable
```

避免把环境竞争误判为 timing regression。

---

# PART L — SEVERITY

# 106. P0

示例：

```text
real secret leak
authorization bypass
authoritative match/replay corruption
catastrophic release failure
```

---

# 107. P1

Release blocker，例如：

```text
mirror legality still differs
Validator fix changes unrelated rules
normal tournament workflow broken
Judge/Team auth bypass
Replay recomputes result
stable platform slot bias with reproducible cause
competitor docs contradict runtime in a competition-critical way
mirror checker false-PASSes a known one-side bug
```

---

# 108. P2

例如：

```text
specific viewport issue
isolated localization residue
rare free-text fallback
non-critical untested action
small docs ambiguity
```

---

# 109. P3

例如：

```text
wording
spacing
cosmetic raw enum
optional test hardening
minor design consistency
```

---

# PART M — FINAL REPORT

# 110. Required Report Structure

最终输出必须按以下结构：

```text
# Geometry Battle V1.4 Independent Final Audit

## Repository
Branch:
Candidate HEAD:
Audit tree:
Working tree:
Commit range:
Tags:
Remote:

## Platform Fairness
Old Validator bug independently reproduced:
Validator fix correctness:
Rule change vs correctness fix:
A-side preservation:
B-side intended change:
Mirror helper correctness:
Mirror-fairness non-vacuity:
Old-bug RED/GREEN:
Full-match mirror:
Same-solver methodology:
Slot bias conclusion:
First-solver bias:
Map-distribution conclusion:
Environmental sleep handling:

## Competitor Kit
Orientation docs:
Array ordering:
Both-side requirement:
Validation-grid docs:
Mirror checker:
PASS/WARN/FAIL:
Formal Preflight unchanged:
Starter synchronization:
STARTER UPDATE: KEEP / REVERT

## Frontend
Home:
Judge:
Team A/B:
Spectator:
Replay:
Navigation:
Status system:
Error UX:
Connection/board-ready:
Danger actions:
Replay authority:
Path leakage:
Auth regression:

## Localization
zh keys:
en keys:
Key parity:
Placeholder parity:
Chinese workflow:
English workflow:
Raw-key leakage:
Mixed-language issues:

## Accessibility / Layout
Keyboard:
ARIA:
Color independence:
Reduced motion:
1024×768:
1280×720:
1440×900:
1920×1080:

## Browser / OS Evidence
macOS Chrome:
macOS Safari:
Windows Chrome:
Windows Edge:

## Verification
typecheck:
typecheck:web:
npm test:
npm run e2e:
Tournament rehearsal:
Mutation spot checks:
Timing environment:

## Repository Hygiene
algo-a leftovers in candidate:
scratch files:
runtime artifacts:
secrets:
personal paths:

## Findings
P0:
P1:
P2:
P3:

## Final Decision
```

---

# 111. Exact Final Decision

只允许：

```text
PASS — APPROVED FOR V1.4 RELEASE
```

或：

```text
CONDITIONAL PASS — <specific finite blocker(s)>
```

或：

```text
FAIL — <P0/P1 blocker(s)>
```

如果 PASS：

```text
APPROVED RELEASE CANDIDATE HEAD:
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

---

# 112. PASS Means Stop

如果 PASS：

**立即停止。**

不要：

```text
顺便修 P2
顺便跑更多 seed
顺便优化 Replay
顺便 redesign UI
顺便重新审 V1.2/V1.3
```

发布负责人后续处理：

```text
internal v1.4.0-competition
public sanitized/update export
lightweight public distribution audit
public v1.4.0
GitHub Release
```

Auditor 不负责这些动作。

---

# 113. Conditional / Fail Requirements

每个 blocker 必须提供：

```text
Severity:
File/path:
Reproducer:
Expected:
Actual:
Why release-blocking:
Minimal safe remediation:
Required re-gate:
```

不要只写“有问题”。

---

# 114. No Silent Remediation

发现 P0/P1 后先报告。

除非发布负责人明确授权，不要：

```text
edit
commit
amend
tag
push
```

保持独立审计链。

---

# 115. Final Principle

本审计不是为了证明：

> “开发 Agent 做了很多测试。”

而是独立验证：

> **Geometry Battle V1.4 是否已经在平台公平性、规则实现、参赛者协议、裁判操作、观赛、回放、安全和可复现性上形成可信的 Release Candidate。**

优先保障：

```text
Correctness
Fairness
Authority
Security
Reproducibility
Clarity
Usability
```

不追求：

```text
zero P3
perfect screenshots
infinite sample size
perfect development history
```
