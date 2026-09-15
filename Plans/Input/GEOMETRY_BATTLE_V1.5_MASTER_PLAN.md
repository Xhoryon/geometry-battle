# Geometry Battle V1.5.x Master Plan
## Tournament Simplicity · Secure Execution · Rule Refinement · Anti-Cheat

> **Status:** MASTER PLAN — IMPLEMENTATION NOT YET AUTHORIZED  
> **Baseline:** V1.4.x CLOSED  
> **Next development line:** V1.5.x
>
> **Core principle**
>
> ```text
> Keep complexity inside the platform.
> Keep the tournament simple for humans.
> Treat every contestant program as hostile by default.
> Preserve fairness through enforceable system invariants, not trust.
> ```
>
> 中文：
>
> ```text
> 复杂度留在平台内部。
> 简单性留给赛事组织者与参赛者。
> 正式比赛默认把所有参赛程序视为潜在恶意程序。
> 公平性依靠可强制执行、可审计的系统约束，而不是依赖信任。
> ```

---

# 0. V1.5.x Mission

V1.5.x 不只是继续给 V1.4 加功能。

V1.5.x 的目标是把 Geometry Battle 从：

```text
一个已经能运行的比赛平台
```

推进到：

```text
一个更容易启动、
更容易主持、
更容易理解、
更难作弊、
更能抵抗恶意程序、
并且规则更清晰的正式赛事平台
```

本版本线重点只有四件事：

1. **Frontend / Tournament UX Simplification**
2. **One-Command Startup & Environment Doctor**
3. **Sandbox Security / Anti-Cheat Hardening**
4. **Rule Revision 4 — Simplification & Fairness**

---

# 1. V1.4.x Closed Baseline

V1.5 必须建立在 V1.4.x 已冻结的公开基线上。

V1.4.x 已完成：

```text
V1.4.0  Platform Fairness + Tournament UX
V1.4.1  Complete Bilingual Documentation
V1.4.2  Language-Switchable Documentation
V1.4.3  Documentation Cleanup + Pair Integrity
V1.4.3  Git Metadata Privacy Remediation
```

V1.4.x：

```text
CLOSED
```

V1.5 不允许重新打开 V1.4 的纯文档尾巴。

---

# 2. Current Architecture Facts to Preserve

当前平台已经拥有大量不能轻易推翻的正确基础。

## 2.1 Server

当前正式启动入口：

```text
src/server/main.ts
```

已经具备：

```text
127.0.0.1 binding
automatic browser open
port collision fallback
runtime slot preparation
Tournament Mode default ON
Judge / Team / Spectator / Replay routes
judge capability token
per-match team tokens
graceful shutdown
fatal fail-stop behavior
```

V1.5 应在其上封装，而不是重新写一套 server。

## 2.2 Current npm Commands

当前主要命令：

```text
npm run app
npm run app:dev
npm run judge
npm test
npm run e2e
```

V1.5 的正式赛事入口目标：

```text
npm run tournament
```

开发入口目标：

```text
npm run dev
```

正式与开发路径必须明显分离。

---

# 3. Existing Sandbox Strengths

当前 `SandboxRunner` 已经具备大量正确安全能力：

```text
fresh sandbox per round
macOS sandbox-exec profile
network denial
filesystem scoping
environment scrubbing
memory limiting
process-group isolation
child-process denial
READY → GO startup barrier
per-side timing
stdout/stderr caps
result.json-only official output
process-tree cleanup
```

因此 V1.5 的 sandbox 目标不是：

```text
rewrite everything
```

而是：

```text
make the security model explicit,
auditable,
fail-closed,
easier to start,
harder to accidentally weaken.
```

---

# 4. Existing Runtime Model

当前 formal runtime 已经定义：

```text
CPython
stdlib-only
1 CPU core
1 thread
512 MB memory
500 ms compute budget
bounded stdout/stderr
```

目前 runtime detector 在 mismatch 时主要提供：

```text
MISMATCH signal
```

而不是自动阻止比赛。

V1.5 正式 Tournament Mode 应重新评估：

> 哪些 mismatch 只是 warning，哪些必须成为 hard blocker。

---

# 5. IMPORTANT — Gate 0 Rule Baseline Audit

**任何 V1.5 规则修改之前，必须先做 Gate 0。**

当前公开代码中存在需要先确认的 rule-source-of-truth 风险。

例如：

```text
src/core/Rules.ts
```

仍存在：

```text
EMITTERS A=(-18,0), B=(18,0)
```

以及“全局固定 Emitter”的历史说明。

而 V1.2+ 的公开比赛模型与 UI 已经围绕：

```text
participant-selected
pre-match locked
per-match Emitter
```

发展。

在 Rule Revision 4 之前必须确定：

```text
A. 这是仍在运行的真实逻辑？
B. 只是遗留 dead code？
C. 只是 stale comment？
D. 某些路径仍使用旧常量、某些路径使用新语义？
```

在这一点没有完全解释清楚之前：

```text
NO RULE REVISION
```

---

# 6. Gate 0 Deliverable — Rule Baseline Matrix

创建：

```text
docs/V1.5_RULE_BASELINE.md
```

逐项列出：

| Rule | Authoritative constant | Engine usage | Server/API | Frontend | Tests | Competitor docs | Verdict |
|---|---|---|---|---|---|---|---|
| Emitter | ? | ? | ? | ? | ? | ? | CONSISTENT / DRIFT |
| HIT epsilon | ? | ? | ? | ? | ? | ? | |
| Attack direction | ? | ? | ? | ? | ? | ? | |
| Timeout | ? | ? | ? | ? | ? | ? | |
| Stalemate | ? | ? | ? | ? | ? | ? | |
| Hard round limit | ? | ? | ? | ? | ? | ? | |
| Initiative | ? | ? | ? | ? | ? | ? | |
| Attack rights | ? | ? | ? | ? | ? | ? | |
| DSL limits | ? | ? | ? | ? | ? | ? | |
| Runtime limits | ? | ? | ? | ? | ? | ? | |

Gate 0 要求：

```text
critical unexplained drift = 0
```

---

# 7. V1.5.x Release Structure

建议拆成四个清晰版本。

## V1.5.0 — Tournament Startup & UX Simplification

重点：

```text
one-command startup
Environment Doctor
Judge UX simplification
Team UX simplification
security/readiness visualization
human-readable error model
```

规则：

```text
NO intentional competition rule changes
```

## V1.5.1 — Secure Runner & Anti-Cheat

重点：

```text
sandbox backend abstraction
formal-mode fail-closed policy
Safe Python Profile
package sealing
runtime identity
anti-persistence
resource enforcement
malicious-submission regression corpus
```

规则：

```text
competition geometry semantics unchanged
```

## V1.5.2 — Rule Revision 4

重点候选：

```text
simultaneous resolution
deterministic solver seed
rule simplification
replay reproducibility
```

这是唯一默认允许：

```text
intentional competition semantic changes
```

的 V1.5.x 阶段。

## V1.5.3 — Adversarial RC & Tournament Release

重点：

```text
hostile-submission campaign
fresh-machine startup
full tournament rehearsal
frontend E2E
security audit
rule regression
```

目标：

```text
V1.5 competition release
```

---

# 8. Global V1.5 Design Principles

### Principle A — Simple outside, strict inside

用户只应看到必要动作。

内部仍可保持复杂的：

```text
validation
hashing
sandboxing
preflight
state machine
auth
replay persistence
```

### Principle B — Fail closed

正式 Tournament Mode：

```text
security check fails
→ START unavailable
```

禁止：

```text
sandbox unavailable
→ silently run unrestricted
```

### Principle C — Development mode is visibly unsafe

如果开发模式允许降低隔离：

UI 与 terminal 必须明确显示：

```text
UNSAFE DEVELOPMENT MODE
NOT FOR FORMAL TOURNAMENT USE
```

### Principle D — Untrusted contestant model

参赛算法默认：

```text
untrusted / potentially malicious
```

安全不能依赖：

```text
good intentions
code review
import string scanning
```

### Principle E — Defense in depth

正式安全链：

```text
Upload Policy
   ↓
Package Validation
   ↓
Preflight
   ↓
Package Seal
   ↓
OS Sandbox
   ↓
Resource Limits
   ↓
Runtime Monitoring
   ↓
Forced Cleanup
   ↓
Audit Artifact
```

### Principle F — Reproducibility

正式比赛应尽可能满足：

```text
same package
+ same official input
+ same rule version
+ same deterministic seed
→ reproducible output
```

V1.5.2 前不强行承诺完全 deterministic。

---

# TRACK A — FRONTEND / TOURNAMENT UX

# 9. Frontend Goal

当前页面已经覆盖：

```text
Home
Judge
Team
Spectator
Replay
```

V1.5 不需要增加更多角色。

目标：

```text
reduce cognitive load
reduce visible internal phases
surface readiness
surface actionable errors
```

---

# 10. Judge UX — New Top-Level Model

Judge 顶层只显示：

```text
SETUP
READY
LIVE
RESULT
```

内部仍可保留：

```text
upload
validate
preflight
emitter lock
reveal
START
round resolution
match end
```

但这些属于 secondary detail。

---

# 11. Judge Control Center

目标 UI：

```text
┌─────────────────────────────────────────────────────┐
│ Geometry Battle — Tournament Control Center        │
├───────────────────┬─────────────────┬───────────────┤
│ Team A            │ Platform        │ Team B        │
│ Algorithm   ✓     │ Sandbox    ✓    │ Algorithm ✓   │
│ Preflight   ✓     │ Runtime    ✓    │ Preflight ✓   │
│ Locked      ✓     │ Security   ✓    │ Locked    ✓   │
├───────────────────┴─────────────────┴───────────────┤
│                [ START MATCH ]                      │
└─────────────────────────────────────────────────────┘
```

---

# 12. Tournament Readiness

Server 提供 authoritative readiness projection。

概念模型：

```text
TournamentReadiness
```

包含：

```text
platformReady
sandboxReady
runtimeReady
teamAReady
teamBReady
matchReady
blockers[]
warnings[]
```

前端不得自己推断 START 是否安全。

---

# 13. Actionable Error Model

错误展示两层：

## Human message

```text
Team B cannot start.
The uploaded algorithm failed preflight.
```

## Technical details

```text
PREFLIGHT_CRASH
exit code
bounded stderr
package hash
```

普通用户先看 human message；开发者再展开 technical details。

---

# 14. Judge START Button

`START MATCH` 必须由 server readiness 控制。

任一正式 blocker 存在：

```text
disabled
```

同时显示：

```text
Why can't I start?
```

列出具体动作。

---

# 15. Team Page Simplification

Team 页面目标不超过四个一级步骤：

```text
1. Upload
2. Verify
3. Lock
4. Ready
```

不要要求参赛者理解：

```text
slot replacement
hash pipeline
sandbox internals
server lifecycle
```

---

# 16. Team Algorithm Card

建议展示：

```text
Algorithm name
Package status
Package hash (short)
Preflight status
Lock status
Last error
```

只有必要时展开：

```text
full SHA-256
technical preflight log
manifest details
```

---

# 17. Security Status in Judge UI

Judge 应直接看到：

```text
Secure Runner       ✓
Network blocked     ✓
Environment scrub   ✓
Memory limit        ✓
Process isolation   ✓
Package sealed      ✓
Runtime verified    ✓
```

任一 formal requirement RED：

```text
START disabled
```

---

# 18. Spectator Page

Spectator 不显示：

```text
internal security failures
private tokens
package source
sandbox internals
```

只显示比赛相关：

```text
score
round
live arena
team names
match status
result
```

---

# 19. Replay Page

Replay 增加：

```text
Verified Match
```

状态。

Replay metadata 可显示：

```text
ruleset version
platform version
Team A package hash
Team B package hash
map hash
round count
end reason
```

但不泄露：

```text
private tokens
host paths
sandbox paths
```

---

# 20. Frontend Refactor Goal

避免继续把所有逻辑堆入大页面。

推荐拆成：

```text
pages/
  JudgePage.tsx
  TeamPage.tsx

components/tournament/
  ReadinessPanel.tsx
  TeamStatusCard.tsx
  SecurityStatus.tsx
  MatchControls.tsx
  ErrorExplanation.tsx
  TechnicalDetails.tsx
```

保持：

```text
server authoritative state
```

而不是把 match state machine 复制到 UI。

---

# 21. Frontend Accessibility

V1.5.0 Gate：

```text
keyboard usable
focus visible
button disabled reason accessible
status not color-only
Chinese + English parity
four-viewport check
```

---

# TRACK B — STARTUP SIMPLIFICATION

# 22. One Formal Command

目标：

```bash
npm run tournament
```

完成：

```text
Environment Doctor
→ prepare runtime
→ verify security
→ build/reuse frontend
→ start server
→ open Judge page
```

---

# 23. Development Command

目标：

```bash
npm run dev
```

对应：

```text
server dev mode
vite HMR
developer diagnostics
```

开发命令不得被 README 描述成正式比赛入口。

---

# 24. Tournament Launcher

建议新增：

```text
src/startup/TournamentLauncher.ts
```

职责：

```text
run Doctor
decide eligibility
prepare directories
start server
open browser
print concise summary
```

---

# 25. Environment Doctor

建议：

```text
src/startup/Doctor.ts
```

输出结构化：

```text
DoctorReport
```

检查：

```text
Node runtime
Python runtime
sandbox mechanism
filesystem permissions
runtime slot root
artifact directory
sandbox temp root
port availability
frontend dist/build readiness
security self-test
```

---

# 26. Doctor Severity

每项：

```text
PASS
WARN
BLOCK
```

正式比赛：

```text
BLOCK count > 0
→ Tournament not eligible
```

---

# 27. Example Doctor Output

```text
Geometry Battle V1.5 Tournament Doctor

Node Runtime          PASS
Python Runtime        PASS
Sandbox Backend       PASS
Network Isolation     PASS
Filesystem Isolation  PASS
Memory Enforcement    PASS
Runtime Slots         PASS
Artifacts Directory   PASS
Frontend Build        PASS

Tournament Eligible: YES
```

---

# 28. Startup Terminal Output

最终 terminal 尽量只显示：

```text
Geometry Battle V1.5

Platform       READY
Sandbox        SECURE
Tournament     ELIGIBLE

Judge          http://127.0.0.1:...
Spectator      http://127.0.0.1:...

Browser opened.
```

详细信息通过：

```text
--verbose
```

展开。

---

# 29. Port Handling

保留当前：

```text
default port
fallback on EADDRINUSE
```

但 Doctor/Launcher 必须把实际端口作为正式状态返回。

禁止 silent port change。

---

# 30. Frontend Build Caching

`npm run tournament` 不应长期每次无条件做昂贵 rebuild。

可设计：

```text
source fingerprint
→ dist current?
→ reuse
```

但 build cache 不是 V1.5.0 必须首轮实现的 blocker。

---

# 31. Startup Recovery

如果 startup 中途失败：

```text
clear human error
no half-started formal match
no stale lock
no zombie Vite
no orphan server
```

---

# 32. Formal vs Development Boundary

正式：

```text
TournamentMode = true
Doctor hard gates
safe sandbox required
real uploaded package required
```

开发：

```text
TournamentMode = false possible
factory solver possible
relaxed diagnostics possible
```

必须在：

```text
terminal
Judge UI
server status
```

全部可见。

---

# TRACK C — SANDBOX / SECURE RUNNER

# 33. Security Mission

V1.5.1 的目标：

> 即使参赛算法主动尝试越权，平台仍然保持边界。

不是：

> 检查 source 看起来没问题，所以相信它。

---

# 34. Sandbox Backend Abstraction

建议逐步抽象为：

```text
SandboxBackend
```

概念接口：

```text
probe()
prepare()
spawn()
enforce()
cleanup()
report()
```

---

# 35. Initial Backend Scope

V1.5.1 不要求同时支持所有 OS。

第一目标：

```text
macOS formal backend
```

未来再考虑：

```text
Linux backend
Windows backend
```

但：

```text
unsupported formal backend
→ fail closed
```

---

# 36. Isolation Report Becomes Contract

当前已有 isolation report。

V1.5.1 应升级为 formal eligibility contract：

```text
networkDenied
filesystemScoped
envScrubbed
memoryLimited
processGroupIsolated
childProcessDenied
```

任何 formal-required field false：

```text
MATCH START BLOCKED
```

---

# 37. Sandbox Doctor Self-Test

比赛前运行平台自带 benign probes。

验证：

```text
forbidden network access rejected
forbidden host path rejected
allowed input readable
allowed output writable
forbidden arbitrary output rejected
child-process policy enforced
environment secrets absent
memory enforcement active
cleanup succeeds
```

只使用 harmless fixtures。

不要把真实 exploit payload 放进公开测试库。

---

# 38. Safe Submission Profile

正式提交允许的小集合：

```text
.py
.json
.txt
.csv
.yaml
.yml
.md
```

明确拒绝：

```text
native binaries
shared libraries
executables
archives-inside-archives
symlinks
hardlinks
device nodes
```

---

# 39. Package Limits

保留/重新验证：

```text
package bytes
file count
path depth
single-file max
filename length
```

防止资源滥用与病态包结构。

具体数值由 V1.5.1 spec 冻结。

---

# 40. Safe Python Profile

当前 runtime：

```text
stdlib only
```

V1.5.1 可研究：

```text
allowed stdlib subset
```

优先允许算法相关：

```text
math
json
hashlib
statistics
random
collections
heapq
bisect
itertools
functools
dataclasses
```

正式规则可禁止不必要模块：

```text
subprocess
socket
ctypes
multiprocessing
```

但：

> import policy 不是主安全边界。

安全仍依赖 OS sandbox。

---

# 41. Import Policy Implementation Principle

禁止只靠：

```text
grep "import subprocess"
```

应该是：

```text
package policy
+
runtime import policy where feasible
+
OS sandbox
```

三层。

---

# 42. Environment Scrubbing

Formal runner 只传最小环境。

原则：

```text
no host tokens
no cloud credentials
no shell config
no personal paths
no unrelated env
```

必要的线程限制变量保留。

---

# 43. Filesystem Model

继续坚持：

```text
app/      read-only
input/    read-only
output/   constrained write
work/     bounded temporary write
```

禁止算法读：

```text
host home
repo private files
other team package
other team sandbox
artifact storage
auth/token files
```

---

# 44. Output Policy

正式判定唯一可信算法输出：

```text
output/result.json
```

stdout/stderr：

```text
diagnostic only
bounded
never result channel
```

---

# 45. Result Integrity

记录：

```text
result bytes
result SHA-256
DSL validation result
compute time
isolation report
```

---

# 46. Process Policy

正式算法：

```text
one controlled process tree
```

Runner 必须：

```text
kill entire process group
cleanup on timeout
cleanup on crash
cleanup after valid output
```

防止跨轮后台存活。

---

# 47. Cross-Round Persistence Invariant

正式 invariant：

```text
Round N private state
MUST NOT persist into Round N+1
```

允许跨轮知道的信息只能来自官方输入。

禁止依赖：

```text
leftover file
daemon
child process
shared memory
host temp data
network
environment mutation
```

---

# 48. Memory / CPU / Thread Enforcement

Formal runtime 应验证：

```text
memory cap actually enforced
CPU quota policy documented
thread limit enforced
timeout enforced
```

Doctor 不只检查配置存在，还应执行 harmless enforcement probe。

---

# 49. Runtime Mismatch Policy

现状中 runtime mismatch 可能只是报告。

V1.5.1 建议分类：

## HARD BLOCK

```text
wrong Python major/minor
sandbox unavailable
memory enforcement unavailable
thread policy cannot be enforced
security isolation failed
```

## WARN

```text
non-essential host metadata difference
optional browser condition
```

最终写入：

```text
docs/V1.5_SECURITY_SPEC.md
```

---

# 50. Package Seal

生命周期：

```text
UPLOAD
  ↓
VALIDATE
  ↓
PREFLIGHT
  ↓
SEAL
  ↓
LOCK
  ↓
MATCH
```

---

# 51. Seal Manifest

LOCK 后记录：

```text
package SHA-256
per-file manifest
entry hash
validation result
preflight result
runtime profile ID
ruleset ID
platform build ID
```

---

# 52. Immutable During Match

正式 match 开始后：

```text
package content cannot change
```

如果 slot hash 与 lock hash 不一致：

```text
MATCH BLOCKED / ABORTED
```

不能 silently continue。

---

# 53. Runtime Artifact

每场保存：

```text
match_manifest.json
```

建议包含：

```text
match_id
platform_version
ruleset_id
runtime_profile_id
Team A package hash
Team B package hash
map hash
input hashes
round result hashes
isolation status
end reason
```

---

# TRACK D — ANTI-CHEAT

# 54. Threat Model

创建：

```text
docs/V1.5_THREAT_MODEL.md
```

至少覆盖：

```text
host filesystem read
other-team data read
network communication
persistent daemon
subprocess escape
environment credential read
resource exhaustion
oversized output/log flooding
timestamp manipulation
result tampering
package modification after preflight
cross-round private state
non-deterministic hidden input
UI/API role abuse
token leakage
replay tampering
```

---

# 55. Anti-Cheat Philosophy

不要定义：

```text
cheating = bad-looking code
```

应该定义：

```text
cheating = behavior outside the formal competition contract
```

平台尽量技术性阻止；无法阻止的：

```text
detect
log
invalidate
```

---

# 56. No Secret Cross-Team Information

Team A 与 Team B 正式 sandbox：

```text
cannot read each other's package
cannot read each other's private logs
cannot read hidden operator data
```

---

# 57. Network Policy

正式算法：

```text
no network
```

包括：

```text
internet
LAN
localhost services
```

除非未来明确引入官方 IPC。

---

# 58. Clock / Entropy Policy

V1.5.2 研究：

```text
wall-clock
OS entropy
host randomness
```

是否构成 hidden input。

如果采用 deterministic solver model：

```text
platform-provided seed
```

成为唯一正式随机源。

---

# 59. Replay Verification

目标：

```text
package hash
+ round input hashes
+ seed
+ output hash
```

允许离线复查。

观众客户端仍不重新运行 Judge。

---

# 60. Security Telemetry

记录 security-critical events：

```text
sandbox setup failure
policy denial
timeout
memory limit
child-process denial
package hash mismatch
result validation failure
cleanup failure
```

但 spectator 不展示私密诊断。

---

# 61. Anti-Cheat Fixture Corpus

新增：

```text
tests/security-fixtures/
```

只包含 benign fixtures，验证边界。

类别：

```text
forbidden-read attempt
network attempt
child-process attempt
oversized-output attempt
memory-pressure fixture
timeout fixture
cross-round persistence fixture
package-mutation fixture
```

不收集真实恶意软件。

---

# 62. Security Mutation Philosophy

对安全 gate 做 mutation：

```text
disable network denial
→ security test RED

disable env scrub
→ RED

skip package rehash
→ RED

allow process survivor
→ RED
```

mutation 仅在隔离工作副本中执行。

---

# TRACK E — RULE REVISION 4

# 63. Rule Revision Objective

不是为了“规则更多”。

而是：

```text
less ambiguity
less hardware sensitivity
less exploitable edge behavior
more strategy clarity
more spectator clarity
```

---

# 64. Candidate R4-1 — Simultaneous Resolution

当前 compute-time initiative 值得重新评估。

候选：

```text
Round State Frozen
      ↓
Both Teams Compute
      ↓
Validate Both Outputs
      ↓
Resolve Both Valid Attacks
      ↓
Apply Kills Simultaneously
```

---

# 65. Why Study Simultaneous Resolution

可能减少：

```text
micro-timing sensitivity
filesystem timestamp dependence
scheduler sensitivity
initiative confusion
hardware-performance incentive
```

同时更容易解释：

```text
双方都从同一个回合状态出招
```

---

# 66. Simultaneous Resolution Is NOT Pre-Approved

必须实验。

比较：

```text
V1.4 initiative
vs
R4 simultaneous
```

指标：

```text
win asymmetry
draw rate
mutual elimination rate
average rounds
stalemate rate
strategy diversity
first-side bias
same-solver mirror behavior
spectator understandability
```

---

# 67. Candidate R4-2 — Deterministic Solver Seed

候选：

```text
official solver_seed
```

每轮由平台提供。

目标：

```text
same package
same input
same seed
→ same output
```

---

# 68. Determinism Benefits

改善：

```text
replay verification
dispute resolution
debugging
anti-hidden-input
cross-machine comparison
```

---

# 69. Determinism Enforcement Research

必须回答：

```text
Can wall clock be hidden?
Can OS randomness be hidden?
Can process IDs leak entropy?
Can filesystem timestamps leak entropy?
Can deterministic behavior be tested reliably?
```

如果无法可靠强制：

不要把 deterministic 写成不可实现的 MUST。

可先：

```text
SHOULD + official seed
```

再升级。

---

# 70. Candidate R4-3 — Function Legality Simplification

研究：

```text
current C1/C2 / convexity / domain checks
```

是否过于复杂。

目标：

```text
participant can understand legality
validator can enforce reliably
strategy space stays rich
```

---

# 71. Rule Simplification Experiment

候选变化必须通过：

```text
legal-function corpus
invalid-function corpus
boundary cases
mirror cases
performance
strategy playtest
```

---

# 72. Emitter Rule

V1.5 不默认修改 Emitter。

先完成 Gate 0 baseline audit。

如果当前真实规则是 participant-selected per match，则优先保留。

只有数据证明有问题时再动。

---

# 73. Stalemate / Round Limit

现有 no-progress limit 与 hard round limit 不要随意改。

若 R4 simultaneous resolution 显著改变比赛分布，再重新评估。

---

# 74. Rule Versioning

如果 V1.5.2 修改正式规则：

必须新增明确：

```text
ruleset_id
```

例如概念：

```text
GB-R4
```

不要仅依赖 app version string。

---

# 75. Protocol Versioning

如果新增 solver_seed / runtime profile / rule metadata 影响输入 schema：

必须评估：

```text
schema version bump
```

禁止 silent schema drift。

---

# 76. Backward Compatibility

V1.5.2 应明确：

```text
old V1.4 algorithm package source
```

是否仍可运行。

可能：

```text
source-compatible
protocol-incompatible
```

必须写清楚。

---

# 77. Rule Revision Gate

Rule Revision 4 只有全部满足才能进入正式：

```text
Rule spec complete
Engine implementation complete
Judge tests pass
mirror tests pass
same-solver campaign pass
map campaign pass
stalemate metrics acceptable
security interaction reviewed
docs bilingual
competitor kit updated
replay supports ruleset id
```

---

# VERSION PLAN — V1.5.0

# 78. V1.5.0 Scope

IN：

```text
TournamentLauncher
Environment Doctor
npm run tournament
npm run dev
Judge top-level simplification
Team top-level simplification
readiness API
security/readiness dashboard
actionable errors
startup logs
```

OUT：

```text
rule changes
new DSL
deterministic seed
sandbox policy redesign
cross-platform expansion
```

---

# 79. V1.5.0 Acceptance

Normal path：

```text
git clone
npm install
npm run tournament
```

然后：

```text
Doctor passes
browser opens
Judge page ready
```

正常情况无需手工处理：

```text
port management
slot creation
dist path selection
server URL construction
```

---

# 80. V1.5.0 Fresh-Machine Test

fresh clone 上：

```text
install
tournament command
upload two legal packages
preflight
lock
start
complete match
open replay
```

---

# 81. V1.5.0 No-Rule-Diff Gate

比较 V1.4.3：

```text
core rule constants unchanged
Judge semantics unchanged
Runner competition semantics unchanged
```

需要改规则时：

```text
defer to V1.5.2
```

---

# VERSION PLAN — V1.5.1

# 82. V1.5.1 Scope

IN：

```text
SandboxBackend abstraction
formal security eligibility
Doctor security probes
Safe Submission Profile
package sealing
runtime profile identity
anti-persistence tests
security fixture corpus
formal fail-closed
```

OUT：

```text
geometry rule revision
simultaneous resolution
deterministic seed contract
```

---

# 83. V1.5.1 Formal Security Gate

正式比赛 START 必须证明：

```text
sandbox PASS
network PASS
filesystem PASS
env PASS
process PASS
memory PASS
package seal PASS
runtime PASS
```

否则：

```text
NOT TOURNAMENT ELIGIBLE
```

---

# 84. V1.5.1 Adversarial Review

独立 security reviewer 检查：

```text
sandbox policy
package pipeline
preflight
hashing
process cleanup
token exposure
filesystem paths
output handling
logs
```

---

# VERSION PLAN — V1.5.2

# 85. V1.5.2 Scope

正式：

```text
Rule Revision 4
```

默认候选：

```text
simultaneous resolution
official solver seed
reproducibility metadata
```

可能：

```text
function legality simplification
```

但只有实验支持才加入。

---

# 86. V1.5.2 Mandatory Experimental Baseline

所有规则候选都必须：

```text
A/B compare against V1.4 behavior
```

不能只看新规则自己“感觉好”。

---

# 87. V1.5.2 Balance Metrics

至少：

```text
team-side win rate
first-action effects
draw rate
stalemate rate
mutual elimination
round count distribution
hit frequency
strategy-family performance
mirror consistency
runtime timeout rate
```

---

# VERSION PLAN — V1.5.3

# 88. V1.5.3 Scope

不是继续加功能。

这是：

```text
RC hardening
```

---

# 89. V1.5.3 Campaigns

运行：

```text
fresh-machine tournament startup
UI E2E
two-team full match
replay verification
malicious-fixture campaign
package tamper campaign
sandbox failure campaign
runtime mismatch campaign
same-solver fairness
mirror fairness
rule edge cases
```

---

# 90. V1.5.3 Release Gate

只有：

```text
P0 = 0
P1 = 0
```

才发布。

P2 必须显式分类。

---

# 91. Audit Strategy

不要每一小步都跑巨大 audit。

正常开发：

```text
targeted tests
track-specific gates
small mutations
```

重大综合审计：

```text
V1.5.3 RC only
```

---

# 92. Branch Strategy

建议：

```text
feature/v1.5-startup-ux
feature/v1.5-secure-runner
feature/v1.5-rule-r4
release/v1.5-rc
```

---

# 93. No Parallel Rule + Sandbox Rewrite

禁止一个大 commit 同时：

```text
change Runner security
+
change combat resolution
+
redesign frontend
```

必须能单独归因。

---

# 94. Suggested Code Architecture

可能新增：

```text
src/startup/
  Doctor.ts
  TournamentLauncher.ts
  types.ts

src/security/
  TournamentEligibility.ts
  SecurityReport.ts

src/runner/
  SandboxRunner.ts
  backends/
    SandboxBackend.ts
    MacOSSandboxBackend.ts
```

不要求机械遵守文件名，目标是职责清晰。

---

# 95. Authoritative Status Model

Server 应输出：

```text
PlatformStatus
TournamentReadiness
SecurityStatus
RuntimeStatus
TeamSubmissionStatus
```

Frontend 只消费这些投影。

---

# 96. Single Source of Truth

禁止：

```text
frontend reimplements readiness rules
Doctor has one security rule
server has another
Runner has another
```

推荐：

```text
TournamentEligibility
```

作为 formal eligibility 单一判断。

---

# 97. Error Taxonomy

建立稳定分类：

```text
STARTUP_*
SUBMISSION_*
PREFLIGHT_*
SANDBOX_*
RUNTIME_*
MATCH_*
SECURITY_*
```

每个 code 配：

```text
human zh
human en
technical details
operator action
```

---

# 98. Logging

正式 log：

```text
structured
bounded
no secrets
no capability tokens
no personal machine paths
```

---

# 99. Audit Artifact Separation

Public replay artifact：

```text
safe competition metadata
```

Private operator diagnostics：

```text
more detailed security/log data
```

不要把宿主敏感信息塞进 replay。

---

# 100. Token Security

继续保证：

```text
judge token not logged
team tokens rotate per match
team cannot access opponent capability
spectator has no write capability
```

V1.5 security audit重新验证。

---

# 101. Browser Security

正式 local server 继续：

```text
127.0.0.1
```

除非未来明确设计 LAN tournament mode。

V1.5 不默认开放：

```text
0.0.0.0
```

---

# 102. Formal Match Invariants

V1.5 最终形成机器可测试 invariant：

```text
one authoritative Judge
same official input bytes for A/B where specified
same runtime profile
same security profile
package immutable after lock
no network
no cross-team file access
no cross-round private state
bounded resources
finite match termination
replay from persisted authoritative data
```

---

# 103. Security Invariant Tests

每个 invariant：

```text
positive test
negative/mutation test
```

---

# 104. Performance

安全不能让启动变得痛苦。

目标：

```text
Doctor normal path: few seconds
preflight: predictable
round sandbox startup: bounded
UI transitions: immediate
```

先 measure，再冻结阈值。

---

# 105. Observability

Doctor / Runner / Server 统一 event IDs。

用于：

```text
debug
audit
support
```

但不让用户看到一堆内部 trace。

---

# 106. Rule Experiment Separation

建议有 ruleset abstraction。

实验 R4 时：

```text
V1.4 baseline
R4 candidate
```

可并行模拟。

正式 release 只启用一个。

---

# 107. Security Test Ethics

V1.5 anti-cheat 开发只使用：

```text
harmless boundary probes
synthetic fixtures
non-destructive adversarial tests
```

不把真实恶意软件、持久化工具或外部攻击框架纳入项目。

---

# 108. Documentation Deliverables

V1.5 建议新增：

```text
docs/V1.5_MASTER_PLAN.md
docs/V1.5_RULE_BASELINE.md
docs/V1.5_STARTUP_SPEC.md
docs/V1.5_SECURITY_SPEC.md
docs/V1.5_THREAT_MODEL.md
docs/V1.5_RULE_REVISION_4_SPEC.md
docs/V1.5_RELEASE_GATES.md
```

公开前继续遵守：

```text
English canonical
↔
.zh-CN counterpart
```

---

# 109. Internal Development Records

内部可维护：

```text
V1.5 decision log
experiment result log
security finding log
```

但不要自动发布：

```text
agent prompts
raw subagent transcripts
personal paths
internal workflow state
```

---

# 110. Security Finding Severity

## P0

```text
host secret exposure
sandbox escape
arbitrary host write
cross-team confidential access
remote code execution outside intended sandbox
```

## P1

```text
network allowed in formal mode
package mutable after lock
cross-round private state
security gate bypass
runtime profile not enforced
rule fairness regression
```

## P2

```text
isolated diagnostic leak
non-critical UI readiness mismatch
bounded recovery issue
```

## P3

```text
cosmetic UX
wording
non-blocking polish
```

---

# 111. Release Philosophy

V1.5.x 不追求：

```text
maximum feature count
```

而追求：

```text
operator confidence
contestant clarity
security confidence
rule clarity
reproducibility
```

---

# 112. Public Product Message

V1.5 最终应能用一句话解释：

> **Start a secure local algorithm tournament with one command, upload two algorithms, and let the platform enforce the rest.**

中文：

> **一条命令启动安全的本地算法赛事，上传双方算法，其余公平性、安全性与判定全部由平台负责。**

---

# 113. V1.5.0 Gate Checklist

```text
[ ] Gate 0 rule baseline complete
[ ] critical baseline drift = 0
[ ] npm run tournament works
[ ] Environment Doctor exists
[ ] formal mode fail-stop on startup blockers
[ ] Judge reduced to SETUP/READY/LIVE/RESULT
[ ] Team flow simplified
[ ] actionable errors
[ ] security/readiness visible
[ ] zh/en UI parity
[ ] rule semantics unchanged
[ ] typecheck PASS
[ ] web typecheck PASS
[ ] targeted tests PASS
[ ] browser E2E PASS
[ ] fresh clone startup PASS
```

---

# 114. V1.5.1 Gate Checklist

```text
[ ] SandboxBackend boundary established
[ ] formal sandbox eligibility enforced
[ ] network denial tested
[ ] filesystem isolation tested
[ ] env scrub tested
[ ] memory enforcement tested
[ ] child-process policy tested
[ ] process cleanup tested
[ ] package sealing implemented
[ ] package rehash before match
[ ] cross-round persistence regression
[ ] security fixtures safe/non-destructive
[ ] security mutations RED
[ ] no competition rule change
```

---

# 115. V1.5.2 Gate Checklist

```text
[ ] Rule Revision 4 spec frozen
[ ] baseline vs candidate comparison
[ ] simultaneous resolution decision evidence-based
[ ] deterministic seed decision evidence-based
[ ] protocol/schema version decision
[ ] ruleset_id implemented
[ ] engine tests
[ ] mirror tests
[ ] same-solver tests
[ ] map distribution tests
[ ] stalemate/round metrics
[ ] competitor kit updated
[ ] docs bilingual
```

---

# 116. V1.5.3 Gate Checklist

```text
[ ] fresh-machine rehearsal
[ ] malicious-fixture campaign
[ ] package tamper campaign
[ ] sandbox failure campaign
[ ] runtime mismatch campaign
[ ] full browser tournament
[ ] replay verification
[ ] security independent audit
[ ] rules independent audit
[ ] P0 = 0
[ ] P1 = 0
[ ] release sanitization PASS
```

---

# 117. What Not to Do

V1.5 不要：

```text
rewrite everything
add Docker just because security sounds better
support every OS at once
change all rules at once
depend on source-code scanning for security
make frontend authoritative
add live AI into formal match runtime
allow insecure fallback in Tournament Mode
turn every small change into a giant audit
```

---

# 118. AI Usage Boundary

赛前：

```text
participants may use AI to develop algorithms
```

正式 match runtime：

```text
no live AI
no network
frozen submission
```

保持这一边界。

---

# 119. First Implementation Order

不要现在直接做 V1.5.0 UI。

第一步：

```text
GATE 0
```

顺序：

```text
1. Rule Baseline Audit
2. Startup Architecture Audit
3. Sandbox Security Baseline
4. Frontend Workflow Baseline
5. Freeze V1.5.0 spec
6. Only then implement
```

---

# 120. Gate 0 — Exact Tasks

Agent 应检查：

```text
src/core/Rules.ts
src/core/*
src/server/session*
src/server/protocol*
src/runner/SandboxRunner.ts
src/submission/*
tests/*
competitor-kit/*
README*
web/src/pages/*
```

---

# 121. Gate 0 Questions

必须回答：

```text
What is the real Emitter behavior?
Where is initiative decided?
What exactly ends a round?
What exactly ends a match?
What is authoritative timing?
What resources are actually enforced?
Which security checks are warnings vs blockers?
What formal state enables START?
Which UI stages are purely presentation?
What facts are duplicated across layers?
```

---

# 122. Gate 0 Output

只输出调查与建议。

不要修改 runtime。

最终状态：

```text
V1.5 GATE 0 COMPLETE — READY TO FREEZE V1.5.0 SPEC
```

---

# 123. Gate 0 Stop Conditions

STOP if discovering：

```text
active code/docs rule mismatch
security invariant believed enforced but actually not enforced
different server/CLI competition semantics
frontend state able to bypass server readiness
runtime mismatch silently changes competition behavior
```

这些先解决 baseline，不能假装不存在。

---

# 124. V1.5 Success Definition

最终成功不是：

```text
more code
```

而是赛事组织者只需要：

```text
1. Start Geometry Battle
2. Upload Team A
3. Upload Team B
4. Lock / Ready
5. Start Match
```

平台负责：

```text
runtime
sandbox
hashes
security
preflight
fair start
judging
persistence
replay
```

---

# 125. Final Security Principle

> **Normal contestants should not need to think about sandbox security.**
>
> **Malicious contestants should not be able to bypass it.**

---

# 126. Final UX Principle

> **Do not expose implementation complexity merely because the platform internally needs it.**

---

# 127. Final Rule Principle

> **A rule should exist because it improves strategy, fairness, clarity, or enforceability — not because the implementation happens to support it.**

---

# 128. Final V1.5.x Sequence

```text
V1.4.x CLOSED
      ↓
Gate 0 — Baseline Audit
      ↓
V1.5.0 — Tournament Startup + UX
      ↓
V1.5.1 — Secure Runner + Anti-Cheat
      ↓
V1.5.2 — Rule Revision 4
      ↓
V1.5.3 — Adversarial RC
      ↓
V1.5 RELEASE
```

---

# 129. Immediate Next Action

**Do not begin implementation yet.**

Give this Master Plan to an Agent and instruct it：

```text
Execute ONLY Gate 0.

Do not change production code.
Do not change rules.
Do not redesign UI yet.

Audit the current V1.4.3 repository and produce:
- V1.5_RULE_BASELINE.md
- startup baseline
- sandbox/security baseline
- frontend workflow baseline
- list of confirmed inconsistencies
- V1.5.0 scope recommendation

Then STOP with:

V1.5 GATE 0 COMPLETE — READY TO FREEZE V1.5.0 SPEC
```

Only after reviewing Gate 0 should V1.5.0 implementation begin.
