## V1.4.0 (2026-09-13) — Platform Fairness & Tournament UX

V1.4 addresses platform fairness (Team A/B mirror symmetry), expands tournament participant
orientation, and delivers a comprehensive UX overhaul across all web roles.

Prepared from independently audited internal snapshot `7f6e39d0d4faaa34ca48981aaee44f0213a52337`.

### Highlights

#### Platform Fairness

- **Fixed Team A/B Mirror Asymmetry in Validator**: Corrected numerical sampling bias in
  coordinate validation that broke mirror invariance between Team A and Team B slots.
- **Permanent Mirror Fairness Regression Testing**: Added automated mirror-paired test suite
  to detect future platform slot bias.
- **Full-Match Symmetry Testing**: Validates that swapping teams produces swapped outcomes
  under controlled conditions.
- **Participant Mirror Self-Check Tooling**: Competitor-kit includes `check_mirror.py` and
  server-side `check-mirror.ts` for independent verification.

**Fairness Statement**: No platform slot bias was detected under tested mirror-paired
conditions (30 map seeds, same-solver pairs, n=60 matches). The old Validator bug is fixed,
and regression tests now guard the mirror invariant. See `docs/V1.4_FAIRNESS_REPORT.md` for
methodology and limitations.

#### Competition Protocol Hardening

- **Clarified Team Orientation Requirements**: Team A faces +x (right), Team B faces -x (left).
  Input coordinate ordering must respect team orientation to avoid breaking mirror symmetry.
- **Expanded Competitor-Kit Orientation Guidance**: Algorithm requirements document now
  explicitly states coordinate-ordering expectations and provides mirror diagnostic tools.
- **Host Operator Sleep-Timing Guidance**: Added documentation warning against system sleep
  during matches due to process-timer skew risks.

#### Frontend & UX Overhaul

- **Role-Based Home Page** (`/`): Entry point with Judge / Team A / Team B / Spectator /
  Replays navigation cards.
- **Redesigned Judge Workflow** (`/judge`): Improved phase-driven wizard with clearer
  step-by-step progression, better status visibility, and streamlined controls.
- **Improved Team Submission Flow** (`/team/a`, `/team/b`): Enhanced upload experience,
  preflight progress feedback, emitter selection workflow, and lock confirmation.
- **Redesigned Spectator Experience** (`/spectator`): Clean read-only tournament view with
  better match state presentation and localized phase descriptions.
- **Authoritative Replay Player** (`/replay/:matchId`): New timeline-based replay controls
  with round scrubbing, play/pause, and synchronized state visualization.
- **Expanded Bilingual UI**: Comprehensive Chinese/English localization across all new
  components and workflows.
- **Accessibility Improvements**: Enhanced keyboard navigation, ARIA labels, focus management,
  and screen-reader support across web application.

---

## V1.3.0 (2026-09-12) — Bilingual Tournament Experience

V1.3 brings a comprehensive bilingual (Chinese / English) localized user experience,
cross-phase run-to-end execution fixes, and robust end-to-end test synchronization.

Prepared from independently audited internal snapshot `febf1c69fb6cb78624811513149f477c4e30fac6`.

### Highlights

- **Bilingual Interface (i18n)**: Full Chinese (zh-CN) and English (en-US) support across
  the web application (Judge console, Team pages `/team/a` & `/team/b`, Spectator screen,
  Replay viewer).
- **Persistent Language Selection**: Language preference switches seamlessly with instant
  locale state persistence in `localStorage`.
- **Bilingual Documentation**: Comprehensive bilingual README with mirrored rulebooks,
  protocol specifications, and route maps.
- **Run-to-End Correctness Fix**: Resolved execution stall when advancing multiple rounds
  from non-initial phases (`REVEAL` / `PUBLIC`), ensuring seamless multi-round autoplay.
- **Protocol & Server Hardening**: Localized API error keys and message propagation; client
  transparently passes localized reasons.

---

# Release Notes

## V1.2 — Interactive Tournament Platform

> 许可：**PolyForm Noncommercial License 1.0.0**（见根 [`LICENSE`](../LICENSE)）。
> *source-available for noncommercial use* —— **不是** OSI 认可的开源许可，
> 商业用途需另行授权。详见 [README 的许可与使用范围](../README.md#许可与使用范围)。

### 与 V1.1 的规则差异（只有一条）

**Fixed Emitter 不再由平台固定，改为每队开赛前从自己的点里选定并锁定。**

V1.1 中 A/B 队锚点恒为 `(-18, 0)` / `(18, 0)`；V1.2 中双方各自从**自己的初始点**里
选一个、提交并锁定，之后整场不变。锚点仍是**数学发射锚点** —— 不可击杀、不计入存活数、
不是战斗点、不在 `points` 里（被选中的那个点会从 `points` 中移除）。

其余规则（`y = f(x)` 攻击函数、500 ms 计算上限、`STALEMATE = 20`、
`HARD_ROUND_LIMIT = 60`、四类终止方式）**全部不变**。

### 参赛者体验

- **参赛者页** `/team/a` `/team/b`：上传自己的算法包（ZIP / 目录 / 单个 `solver.py`）
  → **只读浏览自己的源码** → 从自己的点里**选定并锁定**本场 Fixed Emitter。
- **选择在揭晓前保密**：双方**都锁定之后**两个坐标才公开。在此之前，
  没有该队令牌的调用方在**服务端载荷里**根本拿不到该队的选择 ——
  不是前端藏起来，是服务端不发。

### 锦标赛模式（默认开启）

正式比赛**不允许平台自带的算法上场**。服务端对四个入口逐一设卡，只要包哈希命中
「平台发行树」（`starter/`、`algorithms/team-*`、`competitor-kit/starter`、
`demo/*`、`playtest/competitors/*`）一律拒绝：参赛者页上传（**先判后装**）、
`install`（按路径安装）、`use-slot`、`prepare`（向导主按钮）。

真正的拒绝发生在**执行时**，不是把按钮变灰 —— 一个直接的 `POST` 绕不过去。
`npm run app -- --no-tournament` 可关闭，**仅用于开发自测**。

### 授权与访问控制

`/judge` 与 `/team/*` 要求访问令牌（capability，不是账号密码）：

| 面 | 令牌 |
|---|---|
| 裁判台 | 裁判令牌，**进程生命周期** |
| 参赛者页 | 该队令牌 = `HMAC(裁判令牌, matchId + 队别)`，**每场自动失效** |

令牌走 URL 的 **fragment**（不发给服务端，不进请求行 / `Referer` / 日志）。
`/spectator`、`/replay/:matchId`、轨迹与健康检查保持**匿名只读**。

裁判板合法地同时显示双方选择，因此**裁判台链接不要外传**。

### Web UI

| 路由 | 用途 |
|---|---|
| `/judge` | 裁判台：phase-driven 向导 —— 载入 → 校验 → **双方锁定 Emitter** → 揭晓 → START → 结算 → 终局 → 重置 → 下一场；可查看双方上传的源码 |
| `/team/a` `/team/b` | 参赛者页：上传 / 源码浏览 / 选定并锁定 Emitter |
| `/spectator` | 观众大屏：只读，无任何诊断信息 |
| `/replay/:matchId` | 回放：用已落盘的 match/audit/replay 重放，**不重新运行任何算法** |

### 上传与校验

- 支持 **ZIP（`stored` 与 `deflate` 两种压缩方式）**、目录、单个 `solver.py`。
- 浏览器侧解包用平台自带的 `DecompressionStream('deflate-raw')`，
  并**边解边计字节**，超预算立即中止 —— 避免 deflate 炸弹打死标签页。
- 赛事方**不会**把压缩包直接解压到槽位。任何一步失败（结构非法、跑不起来、输出不合法），
  现有槽位**一个字节都不会变**，坏包只停留在 `<槽位根>/.staging/`。

### 平台（自 V1.1 起沿用）

两阶段输入协议（`public_state.json` → `reveal_state.json`）、START 硬门禁、
`output/result.json` 严格 IPC、固定 Runtime（CPython 3.9.6 / 无第三方包）、
`sandbox-exec` 四区沙箱、计时锚点落在 `write('GO')` 之后、以结果文件 mtime 为计时终点。

---

## 参考解（demo）说明

`demo/reference-solver-v2/` 是一个**教学 / 本地联调用**的参考实现。

- 它**不是最优解**，也不代表平台的能力上限。
- 与部分对手对局时会走进**周期 2 的僵持**（双方在两条打不中的射击之间来回）。
  这是**策略质量**的局限，**不是平台正确性问题** —— 引擎会按 `STALEMATE` 正常判和。
- 可复现性由 `tests/demo-repro.ts` 钉死（直调与官方沙箱各 10 次、逐字节一致）。
- **不要**把它当成「总能收敛」或「总能获胜」的保证。

---

## 公开树的验证结果与一处已知的测试环境依赖

在**全新克隆**（无任何本机运行期残留）上执行：

| 检查 | 结果 |
|---|---|
| `npm install` | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:web` | PASS |
| `npm test` | **38 / 39 套件**（唯一失败见下） |
| `competitor-kit/tools/validate_submission.py starter` | PASS（`PRE-FLIGHT PASS`，2 队别 × 9 分节） |

### 唯一失败用例

`tests/operator-e2e.ts` 的
`judge: 只给 --auto 就能开一场正规比赛（不需要 --a/--b，不需要开发 flag）`，
断言 `Team A: READY` 不成立。

**根因（与本发行版的脱敏无关，已在内部审计提交上复现）**：
裁判台控制台的槽位就绪状态并非本次 Preflight 的结果，而是读**磁盘上的安装记录**
`<slotRoot>/.slots/<team>.json` 的 `preflight.ok` 字段。该目录被 `.gitignore` 忽略，
因此**任何全新克隆都不含它**。内部开发机上它存在，是因为先前跑过 `install`
（那份记录的 `installed_at` 为 2026-09-10，`source` 指向
`playtest/competitors/solver-fast`，见 `.gitignore` 中对该目录的说明）。

**排除过程**：把内部审计树上同样被忽略的 `algorithms/.slots/` 与
`algorithms/.staging/` 临时移走后，**同一个用例以完全相同的方式失败**（7/8，同一断言）。
因此该用例是**环境依赖**的 —— 它在开发机上靠遗留的运行期状态而通过，在干净树上必然失败。
**这不是产品缺陷，本发行版也没有修它**（修它需要改动经审计的测试代码，
超出「公开导出」的范围）。

### 平台行为未受影响

同一条 `--auto` 路径在公开树上会真的跑完 Preflight 并一路打到终止，
`match.json` / `audit.json` / `replay.json` 均正常落盘 —— 失败的只是控制台上
`READY` 这**一个字符串的呈现**，因为它的来源是那份磁盘记录。

### 关于计时公平性套件

`timing-fairness` 是**刀锋统计断言**（`aFasterRate ∈ (0.4, 0.6)`，另有换序胜率差与
耗时中位数差）。在**机器空闲**时它在公开树上稳定通过（实测 `aFasterRate = 0.447`）；
若与其它重负载并发运行则可能越界。它验证的是「槽位/次序不产生可利用的系统性优势」，
**不构成绝对公平的保证**。

---

## 版本来源

### V1.4

本公开 V1.4 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

该内部快照的最终审计结论为 `PASS — APPROVED FOR V1.4 RELEASE`。

### V1.3

本公开 V1.3 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
febf1c69fb6cb78624811513149f477c4e30fac6
```

该内部快照的最终审计结论为 `CONDITIONAL PASS — APPROVED FOR V1.3 RELEASE`。

### V1.2

本公开 V1.2 发行版准备自**内部经独立审计的**竞赛源码快照：

```text
94a0788231c62f2e72abaa719609a70031a41433
```

该内部快照的最终审计结论为 `PASS — APPROVED FOR V1.2 RELEASE`。

---

本公开仓库使用**独立的、经过脱敏的发行历史**，因此**公开 Git 提交标识与内部开发
仓库的提交标识不互通**。上述 SHA-1 标识是内部审计快照的来源证据，
公开仓库的版本标签（`v1.2.0`、`v1.3.0`、`v1.4.0`）指向对应的公开发行提交。
