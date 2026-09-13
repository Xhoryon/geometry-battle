<!-- bilingual-doc: zh-CN + en-US -->

# Release Notes / 发行说明

## V1.4.0 (2026-09-13) — Platform Fairness & Tournament UX
## V1.4.0 (2026-09-13) — 平台公平性与锦标赛用户体验

V1.4 addresses platform fairness (Team A/B mirror symmetry), expands tournament participant
orientation, and delivers a comprehensive UX overhaul across all web roles.

V1.4 解决平台公平性问题（Team A/B 镜像对称）、扩展参赛者定向说明，并对所有 Web 角色进行全面的用户体验改版。

Prepared from independently audited internal snapshot `7f6e39d0d4faaa34ca48981aaee44f0213a52337`.

准备自经独立审计的内部快照 `7f6e39d0d4faaa34ca48981aaee44f0213a52337`。

### Highlights / 亮点

#### Platform Fairness / 平台公平性

- **Fixed Team A/B Mirror Asymmetry in Validator**: Corrected numerical sampling bias in
  coordinate validation that broke mirror invariance between Team A and Team B slots.
- **修复 Validator 中的 Team A/B 镜像不对称**：修正坐标验证中的数值采样偏差，该偏差破坏了 Team A 与 Team B 槽位之间的镜像不变性。

- **Permanent Mirror Fairness Regression Testing**: Added automated mirror-paired test suite
  to detect future platform slot bias.
- **永久镜像公平性回归测试**：添加自动化镜像配对测试套件，以检测未来的平台槽位偏差。

- **Full-Match Symmetry Testing**: Validates that swapping teams produces swapped outcomes
  under controlled conditions.
- **全场对称性测试**：验证在受控条件下交换队伍会产生交换的结果。

- **Participant Mirror Self-Check Tooling**: Competitor-kit includes `check_mirror.py` and
  server-side `check-mirror.ts` for independent verification.
- **参赛者镜像自检工具**：competitor-kit 包含 `check_mirror.py` 和服务端 `check-mirror.ts` 用于独立验证。

**Fairness Statement**: No platform slot bias was detected under tested mirror-paired
conditions (30 map seeds, same-solver pairs, n=60 matches). The old Validator bug is fixed,
and regression tests now guard the mirror invariant. See `docs/V1.4_FAIRNESS_REPORT.md` for
methodology and limitations.

**公平性声明**：在经测试的镜像配对条件下（30 个地图种子、相同求解器配对、n=60 场比赛）未检测到平台槽位偏差。旧的 Validator bug 已修复，回归测试现在保护镜像不变性。详见 `docs/V1.4_FAIRNESS_REPORT.md` 了解方法论和限制。

#### Competition Protocol Hardening / 竞赛协议加固

- **Clarified Team Orientation Requirements**: Team A faces +x (right), Team B faces -x (left).
  Input coordinate ordering must respect team orientation to avoid breaking mirror symmetry.
- **明确队伍朝向要求**：Team A 面向 +x（右），Team B 面向 -x（左）。输入坐标顺序必须尊重队伍朝向以避免破坏镜像对称。

- **Expanded Competitor-Kit Orientation Guidance**: Algorithm requirements document now
  explicitly states coordinate-ordering expectations and provides mirror diagnostic tools.
- **扩展 competitor-kit 朝向指引**：算法要求文档现在明确说明坐标顺序预期并提供镜像诊断工具。

- **Host Operator Sleep-Timing Guidance**: Added documentation warning against system sleep
  during matches due to process-timer skew risks.
- **主机操作员休眠计时指引**：添加文档警告在比赛期间避免系统休眠，以防进程计时器偏移风险。

#### Frontend & UX Overhaul / 前端与用户体验改版

- **Role-Based Home Page** (`/`): Entry point with Judge / Team A / Team B / Spectator /
  Replays navigation cards.
- **基于角色的主页**（`/`）：包含裁判 / Team A / Team B / 观众 / 回放导航卡片的入口点。

- **Redesigned Judge Workflow** (`/judge`): Improved phase-driven wizard with clearer
  step-by-step progression, better status visibility, and streamlined controls.
- **重新设计的裁判工作流**（`/judge`）：改进的阶段驱动向导，具有更清晰的分步进度、更好的状态可见性和简化的控制。

- **Improved Team Submission Flow** (`/team/a`, `/team/b`): Enhanced upload experience,
  preflight progress feedback, emitter selection workflow, and lock confirmation.
- **改进的队伍提交流程**（`/team/a`、`/team/b`）：增强的上传体验、预检进度反馈、emitter 选择工作流和锁定确认。

- **Redesigned Spectator Experience** (`/spectator`): Clean read-only tournament view with
  better match state presentation and localized phase descriptions.
- **重新设计的观众体验**（`/spectator`）：干净的只读锦标赛视图，具有更好的比赛状态呈现和本地化阶段描述。

- **Authoritative Replay Player** (`/replay/:matchId`): New timeline-based replay controls
  with round scrubbing, play/pause, and synchronized state visualization.
- **权威回放播放器**（`/replay/:matchId`）：新的基于时间线的回放控制，具有回合拖动、播放/暂停和同步状态可视化。

- **Expanded Bilingual UI**: Comprehensive Chinese/English localization across all new
  components and workflows.
- **扩展的双语 UI**：所有新组件和工作流的全面中英文本地化。

- **Accessibility Improvements**: Enhanced keyboard navigation, ARIA labels, focus management,
  and screen-reader support across web application.
- **无障碍改进**：增强的键盘导航、ARIA 标签、焦点管理以及 Web 应用程序的屏幕阅读器支持。

---

## V1.3.0 (2026-09-12) — Bilingual Tournament Experience
## V1.3.0 (2026-09-12) — 双语锦标赛体验

V1.3 brings a comprehensive bilingual (Chinese / English) localized user experience,
cross-phase run-to-end execution fixes, and robust end-to-end test synchronization.

V1.3 带来全面的双语（中文/英文）本地化用户体验、跨阶段连续执行修复以及健壮的端到端测试同步。

Prepared from independently audited internal snapshot `febf1c69fb6cb78624811513149f477c4e30fac6`.

准备自经独立审计的内部快照 `febf1c69fb6cb78624811513149f477c4e30fac6`。

### Highlights / 亮点

- **Bilingual Interface (i18n)**: Full Chinese (zh-CN) and English (en-US) support across
  the web application (Judge console, Team pages `/team/a` & `/team/b`, Spectator screen,
  Replay viewer).
- **双语界面（i18n）**：Web 应用程序的完整中文（zh-CN）和英文（en-US）支持（裁判控制台、队伍页面 `/team/a` 和 `/team/b`、观众屏幕、回放查看器）。

- **Persistent Language Selection**: Language preference switches seamlessly with instant
  locale state persistence in `localStorage`.
- **持久语言选择**：语言偏好无缝切换，并在 `localStorage` 中即时持久化区域设置状态。

- **Bilingual Documentation**: Comprehensive bilingual README with mirrored rulebooks,
  protocol specifications, and route maps.
- **双语文档**：全面的双语 README，包含镜像规则手册、协议规范和路由地图。

- **Run-to-End Correctness Fix**: Resolved execution stall when advancing multiple rounds
  from non-initial phases (`REVEAL` / `PUBLIC`), ensuring seamless multi-round autoplay.
- **连续执行正确性修复**：解决了从非初始阶段（`REVEAL` / `PUBLIC`）推进多个回合时的执行停滞，确保无缝多回合自动播放。

- **Protocol & Server Hardening**: Localized API error keys and message propagation; client
  transparently passes localized reasons.
- **协议与服务器加固**：本地化 API 错误键和消息传播；客户端透明传递本地化原因。

---

## V1.2 — Interactive Tournament Platform
## V1.2 — 交互式锦标赛平台

> License: **PolyForm Noncommercial License 1.0.0** (see root [`LICENSE`](../LICENSE)).
> *Source-available for noncommercial use* — **NOT** an OSI-approved open-source license.
> Commercial use requires separate authorization. See [README License & Usage Scope](../README.md#license--usage-scope).

> 许可：**PolyForm Noncommercial License 1.0.0**（见根 [`LICENSE`](../LICENSE)）。
> *source-available for noncommercial use* —— **不是** OSI 认可的开源许可，商业用途需另行授权。详见 [README 的许可与使用范围](../README.md#许可与使用范围)。

### Rule Differences from V1.1 (Only One)
### 与 V1.1 的规则差异（只有一条）

**Fixed Emitter is no longer platform-fixed; each team selects from their own points before match start and locks it.**

**Fixed Emitter 不再由平台固定，改为每队开赛前从自己的点里选定并锁定。**

In V1.1, A/B team emitters were fixed at `(-18, 0)` / `(18, 0)`; in V1.2, each side selects
one from **their own initial points**, submits and locks it, and it remains unchanged throughout
the match. The emitter is still a **mathematical firing anchor** — cannot be killed, does not
count toward survival, is not a combat point, is not in `points` (the selected point is removed
from `points`).

V1.1 中 A/B 队锚点恒为 `(-18, 0)` / `(18, 0)`；V1.2 中双方各自从**自己的初始点**里选一个、提交并锁定，之后整场不变。锚点仍是**数学发射锚点** —— 不可击杀、不计入存活数、不是战斗点、不在 `points` 里（被选中的那个点会从 `points` 中移除）。

All other rules (`y = f(x)` attack function, 500 ms computation limit, `STALEMATE = 20`,
`HARD_ROUND_LIMIT = 60`, four termination types) **remain unchanged**.

其余规则（`y = f(x)` 攻击函数、500 ms 计算上限、`STALEMATE = 20`、`HARD_ROUND_LIMIT = 60`、四类终止方式）**全部不变**。

### Participant Experience
### 参赛者体验

- **Team Pages** `/team/a` `/team/b`: Upload your algorithm package (ZIP / directory / single `solver.py`)
  → **read-only browse your own source code** → select and lock your Fixed Emitter from your own points.
- **参赛者页** `/team/a` `/team/b`：上传自己的算法包（ZIP / 目录 / 单个 `solver.py`）→ **只读浏览自己的源码** → 从自己的点里**选定并锁定**本场 Fixed Emitter。

- **Choice remains confidential until reveal**: Both coordinates are only made public **after both sides have locked**.
  Before that, callers without that team's token receive no coordinate in **server payload** at all —
  not hidden by frontend, but not sent by server.
- **选择在揭晓前保密**：双方**都锁定之后**两个坐标才公开。在此之前，没有该队令牌的调用方在**服务端载荷里**根本拿不到该队的选择 —— 不是前端藏起来，是服务端不发。

### Tournament Mode (Enabled by Default)
### 锦标赛模式（默认开启）

Official matches **do not allow platform-bundled algorithms**. The server guards all four entry
points; any package hash matching the "platform release tree" (`starter/`, `algorithms/team-*`,
`competitor-kit/starter`, `demo/*`, `playtest/competitors/*`) is rejected: team page upload
(**validate before install**), `install` (install by path), `use-slot`, `prepare` (wizard main button).

正式比赛**不允许平台自带的算法上场**。服务端对四个入口逐一设卡，只要包哈希命中「平台发行树」（`starter/`、`algorithms/team-*`、`competitor-kit/starter`、`demo/*`、`playtest/competitors/*`）一律拒绝：参赛者页上传（**先判后装**）、`install`（按路径安装）、`use-slot`、`prepare`（向导主按钮）。

Actual rejection happens **at execution time**, not by graying out buttons — a direct `POST` cannot bypass.
`npm run app -- --no-tournament` disables it, **for development self-testing only**.

真正的拒绝发生在**执行时**，不是把按钮变灰 —— 一个直接的 `POST` 绕不过去。`npm run app -- --no-tournament` 可关闭，**仅用于开发自测**。

### Authorization & Access Control
### 授权与访问控制

`/judge` and `/team/*` require access tokens (capability, not account/password):

`/judge` 与 `/team/*` 要求访问令牌（capability，不是账号密码）：

| Role | Token |
|---|---|
| Judge Console | Judge token, **process lifetime** |
| Team Pages | Team token = `HMAC(judge token, matchId + team)`, **auto-expires per match** |

| 面 | 令牌 |
|---|---|
| 裁判台 | 裁判令牌，**进程生命周期** |
| 参赛者页 | 该队令牌 = `HMAC(裁判令牌, matchId + 队别)`，**每场自动失效** |

Tokens travel in URL **fragment** (not sent to server, not in request line / `Referer` / logs).
`/spectator`, `/replay/:matchId`, trajectories, and health checks remain **anonymous read-only**.

令牌走 URL 的 **fragment**（不发给服务端，不进请求行 / `Referer` / 日志）。`/spectator`、`/replay/:matchId`、轨迹与健康检查保持**匿名只读**。

The judge console legitimately displays both teams' choices simultaneously, so **do not share judge console links externally**.

裁判板合法地同时显示双方选择，因此**裁判台链接不要外传**。

### Web UI / Web 用户界面

| Route | Purpose |
|---|---|
| `/judge` | Judge Console: phase-driven wizard — load → validate → **both sides lock Emitter** → reveal → START → settlement → terminal → reset → next match; can view both teams' uploaded source |
| `/team/a` `/team/b` | Team Pages: upload / source browsing / select and lock Emitter |
| `/spectator` | Spectator Screen: read-only, no diagnostic info |
| `/replay/:matchId` | Replay: replay using persisted match/audit/replay data, **without re-running any algorithms** |

| 路由 | 用途 |
|---|---|
| `/judge` | 裁判台：phase-driven 向导 —— 载入 → 校验 → **双方锁定 Emitter** → 揭晓 → START → 结算 → 终局 → 重置 → 下一场；可查看双方上传的源码 |
| `/team/a` `/team/b` | 参赛者页：上传 / 源码浏览 / 选定并锁定 Emitter |
| `/spectator` | 观众大屏：只读，无任何诊断信息 |
| `/replay/:matchId` | 回放：用已落盘的 match/audit/replay 重放，**不重新运行任何算法** |

### Upload & Validation
### 上传与校验

- Supports **ZIP (`stored` and `deflate` compression modes)**, directory, single `solver.py`.
- 支持 **ZIP（`stored` 与 `deflate` 两种压缩方式）**、目录、单个 `solver.py`。

- Browser-side unpacking uses platform-bundled `DecompressionStream('deflate-raw')`,
  and **counts bytes while decompressing**, immediately aborts if over budget — avoids deflate bombs killing the tab.
- 浏览器侧解包用平台自带的 `DecompressionStream('deflate-raw')`，并**边解边计字节**，超预算立即中止 —— 避免 deflate 炸弹打死标签页。

- Organizers **do not** directly extract archives into slots. If any step fails (invalid structure, won't run, invalid output),
  existing slot **remains unchanged**, bad package stays only in `<slotRoot>/.staging/`.
- 赛事方**不会**把压缩包直接解压到槽位。任何一步失败（结构非法、跑不起来、输出不合法），现有槽位**一个字节都不会变**，坏包只停留在 `<槽位根>/.staging/`。

### Platform (Inherited from V1.1)
### 平台（自 V1.1 起沿用）

Two-phase input protocol (`public_state.json` → `reveal_state.json`), START hard gate,
strict `output/result.json` IPC, fixed runtime (CPython 3.9.6 / no third-party packages),
`sandbox-exec` four-zone sandbox, timing anchor after `write('GO')`, timing endpoint at result file mtime.

两阶段输入协议（`public_state.json` → `reveal_state.json`）、START 硬门禁、`output/result.json` 严格 IPC、固定 Runtime（CPython 3.9.6 / 无第三方包）、`sandbox-exec` 四区沙箱、计时锚点落在 `write('GO')` 之后、以结果文件 mtime 为计时终点。

---

## Reference Solver (Demo) Notes
## 参考解（demo）说明

`demo/reference-solver-v2/` is a **teaching / local testing** reference implementation.

`demo/reference-solver-v2/` 是一个**教学 / 本地联调用**的参考实现。

- It is **not an optimal solution**, nor does it represent the platform's capability ceiling.
- 它**不是最优解**，也不代表平台的能力上限。

- Against some opponents it enters a **period-2 stalemate** (both sides alternate between two shots that miss).
  This is a **strategy quality** limitation, **not a platform correctness issue** — the engine will properly judge it a draw per `STALEMATE`.
- 与部分对手对局时会走进**周期 2 的僵持**（双方在两条打不中的射击之间来回）。这是**策略质量**的局限，**不是平台正确性问题** —— 引擎会按 `STALEMATE` 正常判和。

- Reproducibility is enforced by `tests/demo-repro.ts` (direct call and official sandbox each 10 times, byte-identical).
- 可复现性由 `tests/demo-repro.ts` 钉死（直调与官方沙箱各 10 次、逐字节一致）。

- **Do not** treat it as a guarantee of "always converges" or "always wins".
- **不要**把它当成「总能收敛」或「总能获胜」的保证。

---

## Public Tree Verification Results & One Known Test Environment Dependency
## 公开树的验证结果与一处已知的测试环境依赖

On a **fresh clone** (no local runtime remnants):

在**全新克隆**（无任何本机运行期残留）上执行：

| Check | Result |
|---|---|
| `npm install` | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:web` | PASS |
| `npm test` | **38 / 39 suites** (single failure below) |
| `competitor-kit/tools/validate_submission.py starter` | PASS (`PRE-FLIGHT PASS`, 2 teams × 9 sections) |

| 检查 | 结果 |
|---|---|
| `npm install` | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:web` | PASS |
| `npm test` | **38 / 39 套件**（唯一失败见下） |
| `competitor-kit/tools/validate_submission.py starter` | PASS（`PRE-FLIGHT PASS`，2 队别 × 9 分节） |

### Single Failing Test
### 唯一失败用例

`tests/operator-e2e.ts`:
`judge: 只给 --auto 就能开一场正规比赛（不需要 --a/--b，不需要开发 flag）`,
assertion `Team A: READY` fails.

`tests/operator-e2e.ts` 的 `judge: 只给 --auto 就能开一场正规比赛（不需要 --a/--b，不需要开发 flag）`，断言 `Team A: READY` 不成立。

**Root cause (unrelated to this release's sanitization, reproduced on internal audit commit)**:
Judge console slot-ready state reads not the current Preflight result, but the on-disk install record
`<slotRoot>/.slots/<team>.json` field `preflight.ok`. This directory is `.gitignore`'d,
so **any fresh clone lacks it**. Internal dev machines have it because prior `install` runs
(that record's `installed_at` is 2026-09-10, `source` points to
`playtest/competitors/solver-fast`, see `.gitignore` comment for that directory).

**根因（与本发行版的脱敏无关，已在内部审计提交上复现）**：裁判台控制台的槽位就绪状态并非本次 Preflight 的结果，而是读**磁盘上的安装记录** `<slotRoot>/.slots/<team>.json` 的 `preflight.ok` 字段。该目录被 `.gitignore` 忽略，因此**任何全新克隆都不含它**。内部开发机上它存在，是因为先前跑过 `install`（那份记录的 `installed_at` 为 2026-09-10，`source` 指向 `playtest/competitors/solver-fast`，见 `.gitignore` 中对该目录的说明）。

**Exclusion process**: Temporarily removing the similarly-ignored `algorithms/.slots/` and
`algorithms/.staging/` from the internal audit tree, **the same test fails identically** (7/8, same assertion).
Thus this test has an **environment dependency** — it passes on dev machines via leftover runtime state, must fail on clean trees.
**This is not a product defect, and this release does not fix it** (fixing it would require modifying audited test code,
beyond "public export" scope).

**排除过程**：把内部审计树上同样被忽略的 `algorithms/.slots/` 与 `algorithms/.staging/` 临时移走后，**同一个用例以完全相同的方式失败**（7/8，同一断言）。因此该用例是**环境依赖**的 —— 它在开发机上靠遗留的运行期状态而通过，在干净树上必然失败。**这不是产品缺陷，本发行版也没有修它**（修它需要改动经审计的测试代码，超出「公开导出」的范围）。

### Platform Behavior Unaffected
### 平台行为未受影响

The same `--auto` path on the public tree actually completes Preflight and runs to termination,
`match.json` / `audit.json` / `replay.json` all properly written — only the console's
`READY` **string presentation** fails, because its source is that disk record.

同一条 `--auto` 路径在公开树上会真的跑完 Preflight 并一路打到终止，`match.json` / `audit.json` / `replay.json` 均正常落盘 —— 失败的只是控制台上 `READY` 这**一个字符串的呈现**，因为它的来源是那份磁盘记录。

### About Timing Fairness Suite
### 关于计时公平性套件

`timing-fairness` uses **razor-edge statistical assertions** (`aFasterRate ∈ (0.4, 0.6)`, plus swap win-rate delta and
timing median delta). When **machine is idle** it stably passes on public tree (measured `aFasterRate = 0.447`);
if run concurrently with other heavy loads it may exceed bounds. It verifies "slot/order produces no exploitable systemic advantage",
**does not constitute an absolute fairness guarantee**.

`timing-fairness` 是**刀锋统计断言**（`aFasterRate ∈ (0.4, 0.6)`，另有换序胜率差与耗时中位数差）。在**机器空闲**时它在公开树上稳定通过（实测 `aFasterRate = 0.447`）；若与其它重负载并发运行则可能越界。它验证的是「槽位/次序不产生可利用的系统性优势」，**不构成绝对公平的保证**。

---

## Version Source / 版本来源

### V1.4

This public V1.4 release was prepared from an **internally independently audited** competition source snapshot:

本公开 V1.4 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

That internal snapshot's final audit conclusion: `PASS — APPROVED FOR V1.4 RELEASE`.

该内部快照的最终审计结论为 `PASS — APPROVED FOR V1.4 RELEASE`。

### V1.3

This public V1.3 release was prepared from an **internally independently audited** competition source snapshot:

本公开 V1.3 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
febf1c69fb6cb78624811513149f477c4e30fac6
```

That internal snapshot's final audit conclusion: `CONDITIONAL PASS — APPROVED FOR V1.3 RELEASE`.

该内部快照的最终审计结论为 `CONDITIONAL PASS — APPROVED FOR V1.3 RELEASE`。

### V1.2

This public V1.2 release was prepared from an **internally independently audited** competition source snapshot:

本公开 V1.2 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
94a0788231c62f2e72abaa719609a70031a41433
```

That internal snapshot's final audit conclusion: `PASS — APPROVED FOR V1.2 RELEASE`.

该内部快照的最终审计结论为 `PASS — APPROVED FOR V1.2 RELEASE`。

---

This public repository uses an **independent, sanitized release history**, so **public Git commit identifiers
do not correspond to internal development repository commit identifiers**. The above SHA-1 identifiers
are provenance evidence for internal audit snapshots; public repository version tags (`v1.2.0`, `v1.3.0`, `v1.4.0`)
point to corresponding public release commits.

本公开仓库使用**独立的、经过脱敏的发行历史**，因此**公开 Git 提交标识与内部开发仓库的提交标识不互通**。上述 SHA-1 标识是内部审计快照的来源证据，公开仓库的版本标签（`v1.2.0`、`v1.3.0`、`v1.4.0`）指向对应的公开发行提交。
