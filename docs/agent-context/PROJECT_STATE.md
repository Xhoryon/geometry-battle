# PROJECT_STATE —— 当前有效事实

> 这份文件只记录**此刻为真的事实**，不记录过程与历史。
> 最后更新：2026-09-13（**V1.4 波次**见 §1.3：平台公平性结论、Validator 网格锚点修复、选手手册与前端重构；V1.3 的 §1.1 / §1.2 保留为历史事实）。
>
> 与本文件配套的还有：[V1.2_CURRENT_HANDOFF.md](V1.2_CURRENT_HANDOFF.md)（本轮交接）、
> [V1.2_REQUIREMENTS.md](V1.2_REQUIREMENTS.md)（要做什么）、
> [ARCHITECTURE.md](ARCHITECTURE.md)（怎么分层）、
> [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)（怎么干活）、
> [V1.2_CONSERVATIVE_EXECUTION_SPEC.md](V1.2_CONSERVATIVE_EXECUTION_SPEC.md)（本轮执行规范）。

---

## 1. 仓库状态

| 项 | 值 |
|---|---|
| 分支 | `feature/v1.4-platform-ux`（从 V1.3 批准 RC `febf1c6` 分出；V1.3 分支 `feature/v1.3-localization` 停在同一 SHA） |
| HEAD | 见 `git log -1` —— 本文件自己也会产生提交，写死 SHA 就永远差一个 |
| V1.2 平台工作 | **13 个提交，位于 `b439e10` 之下**（`7b11a4f`…`9b44610`） |
| V1.2 发布基线 | `94a0788` —— 打了 `v1.2.0-competition` 的那一个提交，V1.3 从它分出，**未再改动** |
| V1.3 本地化基线 | `b0f2751` —— 独立终审的被审候选，**未 amend、未改写**（终审结论：CONDITIONAL PASS） |
| V1.3 RC 修复基线 | `f294c0e` —— 竞态稳定化提交；紧随其后的本地化收口提交见 §1.1 |
| V1.3 复评修复 | `1c889e1` 之上的**两笔** —— `fix(server): continue run-to-end from the current match phase` 与其后的 `test: … realistic wait budget`，见 §1.2 |
| 工作树 | 跟踪文件**干净**；另有 `experiments/algo-a/`（A-v1 会话残留的 1296 个未跟踪文件，不属于任何分支，本轮不删不提交） |
| V1.4 提交 | `git log --oneline febf1c6..HEAD`：feat(competitor) / fix(starter) / fix(core) Validator / test(platform) mirror-match / feat(web) / test(web) / test(platform) campaign / docs(state) |
| 版本标签 | **三个** release tag（`v1.0.0-competition` / `v1.1.0-competition` / `v1.2.0-competition`）**均未移动**；V1.3 与 V1.4 **均未打 tag**（按要求，留给发布负责人） |
| 推送 | **尚未推送** —— 合并/推送由人类决定 |
| 公开仓库 | <https://github.com/Xhoryon/geometry-battle> —— **独立脱敏导出历史**，与本地研发仓库 SHA 不互见 |

---

## 1.1 V1.3 RC 修复波（独立终审后）

终审（对 `b0f2751`）给出 **1 个 P1 + 4 个 P2**，本波逐一收口。

| 编号 | 问题 | 落点 | 验证 |
|---|---|---|---|
| P1 | `tournament.spec.ts` 在 `goto()` 后**立刻**读 `.slot__name`，board 尚未经 WS 到达时读到兜底串 `（未命名）`——实测 6 次完整 e2e 红 1 次 | `TeamPage` 根部新增 `data-board="ready" \| "pending"`；用例等它变 `ready` 再读 | tournament 演练 `--repeat-each=20` → **40/40** |
| P2-1 | 裁判七格步骤条是硬编码英文，中文模式下与阶段名同行混排 | `WIZARD_STAGES` / `WIZARD_STAGE_KEYS`（`translations.ts`）；`data-stage` 仍是机器标识。`phase-label` 只印引擎阶段（原先并排印步骤名，`READY` 下成了「就绪 · 就绪」） | `i18n`、双语浏览器核对 |
| P2-2 | 回放页硬编码 `first` / `R01` / `{rounds}R` | `replay.roundShort` / `replay.roundsBadge`；帧摘要复用 `replay.frameSummary`（中文表的 `first` 一并改成「先手」）。死键 `replay.frameKills` 移除 | `i18n`、双语浏览器核对 |
| P2-3 | 英文界面里冒出服务端中文（**大屏**与裁判台的本轮错误最显眼） | 服务端给键：`RoundSummaryView.errorKeys` / `errorParams`（`explainErrorKey`）+ `classifyMatch` 的 `reasonKey` / `reasonParams`；客户端 `localizeRoundErrors()` / `td()` 取译文，认不出回退原文 | `i18n`（含源码防漂移扫描）、双语浏览器核对（TIMEOUT 用例） |
| P2-4 | 难度 `easy/medium/hard` 原样显示 | `DIFFICULTY_KEYS` + `difficultyLabel()`（值不变，只翻显示）。回放读的是历史 `match.json`，认不出的值原样显示而不崩 | `i18n`、双语浏览器核对 |

**仍然保留服务端中文**（终审确认的既有边界，本波**未**扩大范围）：安装流水线 / 包校验错误
（`Package.ts` / `Manifest.ts` / `Runtime.ts`，带路径与体积参数的自由文本）、`EXPLAIN` 之外的
引擎自由文本、`/api` 路由层错误。客户端在这些路径上一律回退服务端原文。

**本波实测（2026-09-12）**：

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm run typecheck:web` | 0 错误 |
| `npm test` | **38/38 套件通过**（共 313 个用例；其中 `i18n` 由 10 条增至 **13** 条） |
| `npx playwright test … tournament.spec.ts --repeat-each=20` | **40/40 passed** |
| `npx playwright test … tournament.spec.ts --repeat-each=30` | **60/60 passed** |
| `npm run e2e` | 18 次完整运行中 **17 次全绿**；其中出现过 **1 次 2 failed（未复现）**，见下 |
| 浏览器双语核对 | 裁判步骤条 / 难度 / 本轮错误 / 大屏系统文案 / 回放帧标号与摘要 |

> **那次未解释的 e2e 失败**：本波第一批三次连跑中的第 2 次报 `tournament.spec.ts:267`
> 与 `:425` 两个用例失败（后者依赖前者装好的槽位，属级联）。该次运行的完整日志被
> `tail -4` 截断，失败断言未能取到。
>
> **2026-09-12 晚的独立复评已专门复跑并留全量日志**：`tournament.spec --repeat-each=30`
> → 60/60；另加 **50 次连续完整 `npm run e2e`**（每次 8 用例、约 30 秒）全绿 ——
> tournament.spec 累计 **110 次连续干净执行**，**未能复现**，也未找到幸存的失败机制。
> 按历史频率（1/18）估算，110 次全绿的概率约 0.2%。**不再列为未决项。**

---

## 1.2 `run-to-end` 的阶段契约（V1.3 复评 P1 修复）

**问题**：`runToEndBlocker()`（`boards.ts`，与裁判板「连续跑完余下回合」按钮的
`enabled` **共用同一判据**）把 **READY / PUBLIC / REVEAL** 三个阶段都判为「可以连续推进」，
而 `MatchSession.runToEnd()` 的循环原本**无条件**重放 `beginRound(); revealRound();`
—— 那套次序只在 READY 起点成立。从 REVEAL 起点进入时：

```text
beginRound()      REVEAL → PUBLIC（把本轮已经生成好的揭盲打回「等待揭盲」）
revealRound()     见 pendingReveal 已存在 → 提前返回，不推回 REVEAL
judgeStartRound() phase !== 'REVEAL' → { ok: false }
循环 return       比赛永久停在 PUBLIC / 0 回合
```

此后 reveal / start-round / run-to-end 全部退化为空操作（同一条提前返回分支），
**唯一出路是换场重开** —— 而换场会作废双方已经锁定的 Emitter。界面上触发它的
就是裁判的正常两步：「揭晓本轮」→「连续跑完余下回合」。

**归因**：`94a0788`（V1.2 发布基线）里是同一段代码，**不是 V1.3 引入的**；
`b0f2751..1c889e1` 完全没碰 `session.ts` / `core/Match.ts`。此前零覆盖 ——
既有 e2e 与 `server-team` 一律在 **READY** 阶段点 run-to-end。

**允许的阶段集合**：`runToEndBlocker()` 放行 ⟺ `endReason === 'NONE'` ∧ 有地图 ∧
`phase ∈ { READY, PUBLIC, REVEAL }`。其中 **PUBLIC 没有任何 HTTP 命令会停在那一格**
（它是 `reveal` 命令内部的中间态），保留它是防御性的；REVEAL 则是裁判真正的落点。

**修复**（竞争规则、哈希、Emitter 语义、计时预算、算法输入、载荷一律未动）：

| 落点 | 改动 |
|---|---|
| `session.ts` | 新增 `runToEndPreparation(phase)`：把「每个允许阶段还差哪一步」写成一张显式的表（READY → 冻结本轮输入 + 揭盲；PUBLIC → 只揭盲；REVEAL → 都不做，直接 START）。循环据此从**当前阶段**接着走，绝不重放已发生的阶段；遇到表外阶段如实报错退出，**不空转** |
| `core/Match.ts` `beginRound()` | 本轮**已经揭晓**时不得把阶段回退到 PUBLIC。判据只认「同一轮的 reveal 是否已生成」，因此 `READY → PUBLIC` 的正常推进不受影响，已冻结的输入字节与哈希也一个都不碰 |
| `core/Match.ts` `revealRound()` | 缓存分支命中时把阶段**留在 REVEAL**（幂等返回既有哈希，同时兑现自己的后置条件）。这条顺带关掉同一根因的第二条 UI 路径：`reveal` 动作在 REVEAL 阶段同样是 enabled 的，重复点「揭晓」曾经同样会把比赛打回 PUBLIC |

**验证**：

| 命令 | 结果 |
|---|---|
| `npx ts-node tests/run-to-end-phases.ts` | **5/5** —— READY / PUBLIC / REVEAL 各跑一场真比赛到终局；REVEAL 那条另断言整场采样中不出现 `PUBLIC + round 0` 卡死签名，且结算用的就是裁判**已经揭晓过**的那份 `roundStateHash`（证明现状被保留、未被重放） |
| `npm run typecheck` / `typecheck:web` | 0 错误 |
| `npm test` | **39/39 套件**（318 个用例；本波新增 `run-to-end-phases` 5 条） |
| `npm run e2e` | **9 passed**（新增裁判侧 E2E：揭晓本轮后直接 run-to-end → 终局；它在旧实现上会红） |

**旧实现对照**（全程在隔离副本 `/tmp/v13fix-old` 里做，主工作树未参与）：

| 腿 | 内容 | 结果 |
|---|---|---|
| A | 修复后的实现 + 新套件 | 5/5 绿（基线） |
| B | 只把 `runToEndPreparation('REVEAL')` 改回「重放 begin+reveal」 | 红 —— 契约用例指名报出 `期望 {beginRound:false,revealRound:false}，实际 {true,true}` |
| C | 只把引擎两处阶段回退还原 | 红 —— 幂等用例报 `beginRound() 不得让已揭晓的本轮回退到 PUBLIC` |
| D | `session.ts` + `Match.ts` 全部还原到 `1c889e1`，跑**新浏览器 E2E** | **红** —— 板上留下「当前阶段 PUBLIC 不能 START ROUND（需已 REVEAL）」，永不终局 |

> A/B/C 一起说明**两条修复各自都被独立钉住**（只回退任一条都会有测试变红）；
> D 说明新 E2E 对旧实现**有判别力**，不是一条只会永远变绿的摆设。

> **新套件的等待预算是测试参数，不是竞赛阈值**：`waitForMatchEnd` 给 5 分钟、E2E 的
> 「终局 or 后台错误」竞争窗口给 300 秒（对照：演练里 run-to-end 的预算本就是 600 秒）。
> 起因是初次给了 90 秒，而负载高时 arc-sweep vs parabola-arc 会因「本轮双方都超时 →
> 无击杀」一路打到硬上限、每轮还要现起两个沙箱，实测有一次跑到 **round 21 仍在正常推进**
> （采样序列单调递增，不是卡死），90 秒不够。僵持上限（20）、硬回合上限（60）、
> 500ms 计算预算、释放/计时语义**一个字都没动**。

> **`timing-fairness` 是环境敏感用例，与本次改动无关**：本波完整 `npm test` 中它红过一次
> （`aFasterRate=0.812`，阈值 0.4–0.6；当时 load 3.28，`XprotectService` 占 45%）。
> 隔离副本里同机对照：**旧实现 `1c889e1` → 0.407（贴着下界通过）**，修复后实现 → 0.483（通过）
> —— 同一份代码在同一条用例上既红又绿，判据本身在 0.4 边界附近不稳定。该用例测的是
> 沙箱运行器（`runDuel`）的释放顺序，本波未触碰该路径。**未放宽阈值。**

---

## 1.3 V1.4 波次（2026-09-13）—— 平台公平性 · 选手手册 · 前端 UX

任务书 `Plans/Input/GEOMETRY_BATTLE_V1.4_PLATFORM_FAIRNESS_HANDBOOK_FRONTEND_TASK.md`；过程见 `V1.4_DEVELOPMENT_LOG.md`。

### 平台公平性（`Plans/Output/V1.4_PLATFORM_FAIRNESS_REPORT.md`）

```text
PLATFORM MIRROR FAIRNESS:  PASS        （修复 Validator 网格锚点后；L1–L6 永久测试全绿；probe 自战 119/120 对逐回合精确镜像，唯一例外是宿主休眠，复跑通过）
SLOT WIN BIAS:             DISPROVEN   （probe / solver-fast / B-v1 共 167 对分胜负镜像配对，换槽后胜者 167/167 互换）
FIRST-SOLVER BIAS:         DISPROVEN   （4465 个非并列回合 P(A 先)=0.491 [0.476, 0.506]；且 Locked Attack Right 下先手顺序不改变击杀集合）
MAP DISTRIBUTION BIAS:     DISPROVEN   （27,000 张图 × 14 个配对指标，最小 p 0.16，最大 |d_z| 0.009）
```

- **唯一发现并修复的平台不对称**（`f24ffa7`，`src/core/Validator.ts`）：四条采样循环原本从 `domain[0]` 起步 —— A 是 Emitter、B 是场地边 −20，
  镜像函数在两侧被采到不同的 x，阈值附近合法性会翻转（复现：凸性 101 vs 100）。修复后网格从本队 Emitter 出发沿进攻方向推进：
  **A 侧采样逐位不变**（6000 个边缘函数结论 / 错误码 / 计数全同，仅信息性 `maxAbsCurvature` 末位 ulp 可能不同），B 侧成为 A 的精确镜像。
  **不改任何规则常量。** 手册已写明（`competitor-kit/ALGORITHM_REQUIREMENTS.md §6.2.1`、`DSL_SPECIFICATION.md §7`）。
- **永久测试**：`tests/mirror-helpers.ts`（变换 M）、`tests/mirror-fairness.ts`（L1–L5，纯函数 ≈18 s：2400 随机 AST + 198 定向探针 + 5,812,510 个轨迹点逐位镜像 + 先手顺序无关性）、
  `tests/mirror-match.ts`（L6，真沙箱 ≈65 s：symmetry-probe 自战，用 CommonJS 导出替换 `generateMapOrNull` 让引擎拿到镜像地图；高负载下以 environment/probe **明确失败**而非静默通过）。
- **探针** `tests/fixtures/algos/symmetry-probe/`（哈希 `86f59fe2d6a6…`）：在局部前进坐标 u 里算，镜像输入 ⇒ 逐位镜像输出；**审计 fixture，不得进 Tournament Mode**。
- **实验脚本与结果摘要**：`experiments/v1.4-fairness/`（`stats` / `mapstats` / `selfplay` / `summary` / `analyze`.ts + `results/*.json`）；原始产物在仓库外。
- **先手顺序为什么不影响胜负**：`resolveOrderedShots` 里先手方只能击杀对方的点，后手方的目标集合不受影响，没有取消分支（Rule Rev 3 §3/§8）。
  `firstSolver` 只是被记录与显示的量。

### 选手手册与工具（`0b5f671`、`f965cf0`）

- `ALGORITHM_REQUIREMENTS.md §6.2 坐标方向与镜像 / Orientation & Symmetry`（双语）：A 前进 = x 增大、B = x 减小；函数 vs 遍历；建议的局部坐标 u；
  **数组顺序保证**（points：A 组在前、组内为放置顺序、每轮相同、死点原位 `alive:false`、被锁定为 Emitter 的两点移除且**不重编号**；obstacles：`O1..On` 生成顺序）；
  **双侧兼容 MUST**（同一提交必须能在 A、B 两侧正确运行）。`JSON_SCHEMA.md §4` 修正「id 会随击杀减少」（错的）。
- `competitor-kit/tools/check_mirror.py` → `src/operator/check-mirror.ts`（判定全在 TS）：同一 solver A@世界 ↔ B@镜像世界（两对），比较规范化几何与 `judgeShot` 结算；
  PASS / WARN / FAIL，exit 0/1/2；两侧都失败也是 FAIL；不崩溃的 Team-A-only（B 侧退化合法函数）只得 WARN 但会被点名。**开发诊断，官方 Preflight 不运行。**
- starter 四份副本同步去掉「Emitter 是常量」的过期措辞；starter 包哈希变为 `0be87671344d…`（bundled 名单是运行期算哈希，不受影响）。

### 前端（`web/`，只动 `web/**` 与 `tests/web-wizard.ts`，服务端零改动）

| 能力 | 落点 |
|---|---|
| 首页 `/`：选择身份 + 最近比赛；令牌只经 fragment 导航、不存储；`/replays` 列表 | `pages/HomePage.tsx`、`ReplaysPage.tsx`、`pages/accessLink.ts`、`components/ReplayTable.tsx` |
| AppShell（品牌 / 导航 / 语言 / 连接标签）+ 状态设计系统（neutral/waiting/ready/active/warning/error/terminal） | `components/AppShell.tsx`、`StatusBadge` / `StatusLine` / `SectionHeader` / `PrimaryAction` / `TeamLabel` / `ErrorNotice` / `ConnectionTag` / `PreflightBadge` |
| 七态连接状态（connecting / waiting / live / reconnecting / disconnected / unauthorized / unreachable），三块板都带 `data-board="pending\|ready"` | `api/client.ts` `BoardFeed.status` |
| 裁判台七步向导（比赛筹备 → 算法就绪 → 锚点锁定 → 就绪 → 揭晓 → 进行中 → 终局），每步一个主动作；终局主位置 = 回放链接；`reset` 只在 Advanced 且**两步确认**；危险动作不绑 ⌘/Ctrl+Enter；队伍卡不显示任何服务端路径 | `pages/JudgePage.tsx`、纯模型 `pages/judgeWizard.ts` |
| 参赛者页四块（算法包 / 源码 / Emitter / 状态）六步（上传 → 校验 → Preflight → 选择 → 锁定 → 等待）；锁定后 `data-locked` + 显式 LOCKED 文案 | `pages/TeamPage.tsx`、纯模型 `pages/teamSteps.ts` |
| 观众记分板式大屏，终局横带不遮最后一帧；除语言开关外零按钮 | `pages/SpectatorPage.tsx`、`pages/spectatorView.ts` |
| 回放播放器（prev / play·pause / next / 第 N / 共 M / 时间轴 / 0.5× 1× 2× 只改动画速度 / 键盘 ←→ Space Home End）；只用已落盘帧 | `pages/ReplayPage.tsx`、纯模型 `pages/replayPlayer.ts` |
| §33 残留：`firstSolver` / `endReason` / winner 全部走翻译键（机器枚举留在 `data-*`），`difficultyLabel` 加 own-property 守卫 | `i18n/translations.ts`（406 键/语言） |
| 单测 `tests/web-wizard.ts`（22 条：向导表 / pickPrimary / 标签助手 / 步骤模型 / 播放器模型 / 源码扫描含 `data-board` 与减弱动效）；e2e 新增 `web/e2e/viewports.spec.ts`（zh/en × 1024×768 / 1280×720 / 1440×900 / 1920×1080 × 7 路线：无溢出 / 无裸键 / 无占位 / 画布可见 / 零页面错误） | `tests/web-wizard.ts`、`web/e2e/*.spec.ts`（11 条） |

浏览器 QA 报告：`Plans/Output/V1.4_BROWSER_QA_REPORT.md`（macOS Chrome 实测；Windows / Safari **未测试**）。

---

## 2. 唯一权威：MatchEngine

**比赛判定只有一个来源：`src/core/Match.ts` 的 `MatchEngine`。**

前端与服务端**不得**重新实现以下任何一项：

- hit detection（命中判定）
- obstacle / boundary 语义（首次接触即永久终止）
- winner
- timing（先手、耗时、超时预算）
- stalemate（僵持计数与判和）

`src/server/boards.ts` 里**没有任何**这类计算 —— 每个字段都是引擎查询的拷贝。
新增字段前先问一句「这是引擎的结论，还是我又算了一遍？」

`buildActions()` 的 `enabled` 判据必须**逐条抄自引擎自己用的那个条件**，
不许拿 `phase === 'READY'` 之类的代理量去猜。V1.1 正是因为这一点翻过车。

---

## 3. 规则契约（当前为真）

### 3.1 与 V1.1 的唯一差异：锚点由各队自选（V1.2 §一）

| | V1.1（作废） | **V1.2（当前）** |
|---|---|---|
| 固定 Emitter | 平台常量 A `(-18,0)` / B `(18,0)` | **每队开赛前从自己的初始点里选一个并锁定** |
| 何时确定 | 编译期 | `EMITTER_SELECT` 阶段，双方各自 `selectEmitter` → `lockEmitter` |
| 公开时机 | 第 1 轮起 | **双方都锁定之后**（之前没有对方令牌的调用方在服务端载荷里根本拿不到 —— 见 §4「访问模型」） |
| 与 `points` 的关系 | 不在 `points` 里 | **被选中的那个点会从 `points` 里移除** |
| 射击区间 | `[x_e, 20]` / `[-20, x_e]`（x_e 是常量） | 同形，但 `x_e` 逐场不同 |

实现在 `Match.ts`：`EMITTER_SELECT` 阶段（`:590`）、`selectEmitter`（`:642-666`）、
`lockEmitter`（`:669-695`，双锁后 `:686` 把这个点从 `points` 里过滤掉）、
`getEmitters()`（`:733-741`，返回裸坐标 `{id, position}`，没有 `alive`）。

`Rules.EMITTERS` 常量**仍然存在**，但只剩两处用途：
**preflight 的 decoy 世界**与 **MapGenerator 的出生点间距**。比赛路径不再用它。

### 3.2 未变的冻结值

| 项目 | 值 |
|---|---|
| 命中判定 | `\|f(x_p) − y_p\| ≤ 1e-6`（`HIT_EPSILON`） |
| 障碍物/边界 | 轨迹在**首次接触**（或离开场地）处**永久终止**；`OBSTACLE_CONTACT_EPS = 1e-3` |
| 凸性变号上限 | 100 |
| 单次计算上限 | **500 ms**（每方从自己的 GO 写入时刻起算） |
| `STALEMATE` | 连续 **20** 回合双方合计击杀为 0 → DRAW |
| `HARD_ROUND_LIMIT` | 第 **60** 回合 → DRAW |
| 先手判定 | 耗时更短者先开火；`TIE_EPS_MS = 0.05` 内视为同时 |
| Runtime | CPython 3.9.6 / 无第三方包 / 1 核 1 线程 / 512 MB |
| 算法入口 | 包根目录的 `solver.py`（`main.py` 等一律不接受） |

终止保证：`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`
四类覆盖全部情形，判定落在引擎内部 —— 任何入口都跑不出一场不终止的比赛。

### 3.3 已废除的概念（不要在任何地方复活）

`Shooter` / `SHOOTER LOCK` / `ShotCancelled` / `ShooterSelected` / `ShooterLocked` /
`BothLocked` / 每轮选点。审计日志里出现这些事件名即为 bug（有回归盯着）。

> 例外：错误**码** `NOT_THROUGH_SHOOTER` 仍是稳定标识（测试与选手文档引用它），
> 但它的**消息正文**已改用现行术语 Emitter。改名属于对外契约变更，需要单独决定。

---

## 4. V1.2 已交付

| 能力 | 落点 | 验证 |
|---|---|---|
| 参赛者页 `/team/a` `/team/b` | `web/src/pages/TeamPage.tsx`、`App.tsx:80-81` | e2e、`server-team` |
| 浏览器上传算法包（目录 / 文件 / ZIP） | `TeamPage.tsx`、`web/src/api/client.ts`、`web/src/api/zip.ts` | `server-team`、e2e、`web-zip` |
| 参赛者只读浏览自己的源码 | `GET /api/team/source`、`client.ts#fetchTeamSource` | `server-team` |
| **主办方查看上传的算法源码** | `GET /api/judge/source`、`SlotView.fileList`、`JudgePage` 源码面板 | `server-team` |
| 每队自选并锁定 Fixed Emitter | `Match.ts`、`/api/team/select-emitter`、`lock-emitter` | `fixed-emitter`、`server-team`、e2e |
| 锁定前双方互相不可见 | `Match.ts` 快照置 null + `TeamBoard` 按队裁剪 | `server-team`、e2e |
| phase-driven 裁判向导 | `web/src/pages/JudgePage.tsx`（12 阶段 `STEPS`） | e2e |
| **锦标赛模式的执行门禁** | `session.ts#tournamentRejection` + `boards.ts#isBundledAlgorithm` | `server-team` |
| 观众大屏展示双方锚点 | `web/src/pages/SpectatorPage.tsx` | e2e |
| **Preflight 真的检验锚点处理** | `MapGenerator#decoyEmitters` + `LocalPreflight` | `preflight-decoy` |
| 障碍物按真几何绘制（椭圆） | `web/src/arena/projection.ts`、`ArenaCanvas.tsx` | `web-projection` |
| 参考解 v2 | `demo/reference-solver-v2/` | preflight、`server-team`、`demo-repro` |

### 本地化（V1.3）

| 能力 | 落点 | 验证 |
|---|---|---|
| 集中式 i18n 层（**无散落的 `locale === 'zh' ? … : …`**） | `web/src/i18n/`：`types.ts` / `translations.ts` / `I18nContext.tsx` / `useI18n.ts` | `i18n`、`e2e/i18n.spec` |
| 支持 `zh-CN` / `en-US`，每语言 **406** 条文案（V1.4） | `translations.ts`（中文表是唯一事实来源，英文表键不全**编译不过**） | `i18n` |
| 一个共享语言开关（**不是五个独立选择器**） | `web/src/components/LanguageSwitch.tsx`，五条路由头部共用 | `e2e/i18n.spec` |
| 解析顺序：已保存 → 浏览器语言 → 兜底；`localStorage` 键 `geometry-battle.locale` | `I18nContext.tsx#resolveInitialLocale` | `i18n`、`e2e/i18n.spec` |
| 选择跨刷新、跨路由保持；`<html lang>` 与 `document.title` 同步 | `I18nProvider`（挂在路由**之上**）；`index.html` 只放兜底初值 | `e2e/i18n.spec` |
| 裁判动作文案由**服务端给稳定 key**，客户端翻译 | `ActionView.labelKey` / `labelParams` / `hintKey` / `hintParams`（`protocol.ts` + `boards.ts`） | `i18n`（扫 `boards.ts` 源码比对两表） |
| **`td()` 必须把插值参数透传下去** | `JudgePage#actionLabel/actionHint`、`TeamPage#actionHint` | `i18n`（扫 `web/src` 禁止 `td(…, undefined, …)`）、`e2e/i18n.spec` |
| README 全篇双语（配对章节）；围栏配对正确、文内锚点全部指得到标题 | `README.md` | `i18n`（围栏/锚点自洽） |
| 本轮错误由**服务端给键**（`explainErrorKey`），客户端按语言渲染 | `RoundSummaryView.errorKeys` / `errorParams`（`protocol.ts` + `boards.ts`）；`localizeRoundErrors()` | `i18n`（源码扫描 + 两份映射同步检查）、浏览器核对 |
| 回放打不开的原因由服务端给键（`classifyMatch` 的 `reasonKey`） | `replays.ts` + 回放路由透传；`ReplayPage` 用 `td()` | `i18n`（扫 `replays.ts`）、浏览器核对 |
| 裁判七格步骤条 / 难度枚举的显示文案随语言，**标识符与协议值不变** | `WIZARD_STAGES` + `WIZARD_STAGE_KEYS` + `DIFFICULTY_KEYS` / `difficultyLabel()` | `i18n`、浏览器核对 |

**语言是纯展示的**：它不进入 `MatchEngine`、比赛状态、`public_state` / `reveal_state`、
WebSocket 载荷、回放产物、任何哈希，也不进入参赛算法的输入。因此**服务端文案不按语言渲染**
（那会让同一个 board 因客户端而异）—— 服务端给 **key**，客户端翻译。

### 界面

V1.3 的四屏走查已被 V1.4 前端重构整体取代，见 §1.3「前端」表与 `Plans/Output/V1.4_BROWSER_QA_REPORT.md`。
`npm run e2e` 现为 **11 条**（双语 5 + 中文赛事 3 + ZIP 1 + 视口巡检 2），仍需系统 Chrome。

### 访问模型（capability token）

**背景**：Final RC Audit 判定的唯一阻断项（P1）。此前 `/api/team/*` 与
`ws?topic=team-*` 的队别**完全由请求参数决定**（`body.team` / `?team=` / `?topic=`），
服务端没有任何身份校验 —— 任何能访问 127.0.0.1 的调用方都能读到对方 reveal 前的
Emitter 选择、代对方改选/锁定锚点、覆盖对方已提交的算法包、读对方源码。

**同一个洞也在裁判面**：`boards.ts` 的裁判板「Emitter 选择在这里给全」，
而 `/api/judge/state` 与 `ws?topic=judge` 同样没有校验 ⇒ **只给参赛者加令牌关不掉它**，
打开 `/judge` 就能看到对方的选择。所以两侧一起设了卡。

| 面 | 凭证 | 生命周期 |
|---|---|---|
| `/api/judge/*`、`ws?topic=judge` | 裁判令牌 | **进程生命周期**（每场轮换会让组织者自己的裁判页自我锁死） |
| `/api/team/*`、`ws?topic=team-{a,b}` | **该队**的令牌 | **随 `matchId` 自动轮换** |
| spectator / replay / trajectory / health / 静态资源 | 无 | —（已是脱敏只读投影，大屏语义要求可匿名访问） |

- 队伍令牌 = `HMAC-SHA256(裁判令牌, \`${matchId}:${team}\`)`（`src/server/tokens.ts`）。
  `newMatch()` 整体换引擎 ⇒ `matchId` 必变 ⇒ 上一场的令牌**自动失效**。
  轮换因此不需要任何可变状态，也不存在「忘了清旧令牌」「轮换与在途请求竞争」。
- **换场会主动断开已建立的参赛者 WS。** 令牌轮换只让**新请求**失效 —— 已经建立的
  WS 不会自己重扫，它会带着上一场的授权继续收到新场次的（本队）只读状态。
  `ws.ts` 因此在连接建立时记住授权时的 `matchId`，推送前发现已换场就 `close(4401)`
  （**在推送之前**判断，否则陈旧连接会先收到一条新场次的 board 再被关闭）。
  只对参赛者 topic 生效 —— 裁判令牌是进程生命周期的，观众大屏本来就该跨场开着。
- 传输：HTTP POST **只认请求头** `X-GB-Token`（令牌不进 request-line）；
  HTTP GET 允许回退 `?t=`（方便 curl / 测试探测）；WS 只能走 `?t=`
  （浏览器无法给 WebSocket 设请求头）。
- **页面 URL 用 fragment `#t=`**：fragment 不发给服务端 ⇒ 不进 request-line、
  不进 Referer、不进日志。裁判台入口 `${url}/judge#t=…`，由启动 banner 打印并自动打开。
- **发放**：裁判台侧栏「参赛者入口」面板给出两条可复制链接（`data-testid="team-link-{A,B}"`），
  **每场更新一次**。组织者把对应那条发给各队。
- 失败语义：HTTP **401**（鉴权属协议层错误，与 `http.ts` 头部「只有协议层错误才 4xx」一致）；
  WS 用**应用自定义关闭码 4401**（`protocol.ts` 的 `WS_INVALID_TOKEN`）——
  浏览器读不到 WS 握手失败的 HTTP 状态，那只会表现成 1006，与「服务没起来」同形，
  会让前端无上限重连。

**门禁顺序是硬约束**（被既有用例钉死）：Host/Origin/Content-Type（403/415）→
body 解析（坏 JSON 400）→ **鉴权（401）** → 分派。且门禁必须走**精确路径**，
不能 `startsWith('/api/judge/')` —— 否则「未知接口回 404」会变成 401。

**裁判台链接不得外传**：裁判板合法地同时显示双方的选择，拿着裁判令牌就等于
同时拿到两队的权限，也能下达 `reveal` / `start` / `reset` / `install`。

回归：`tests/team-auth.ts`（第 37 个套件，12 条）覆盖无令牌 / 错队令牌 / 裁判面无令牌 /
畸形令牌不 500 / 换场后旧令牌失效 / **WS 未授权时一个字节都不发** /
**换场必须断掉已建立的参赛者 WS 且断开前不再推新场次** /
**换场不得影响裁判与观众的连接** / 以及「公开面仍须匿名可用」的反向对照。

### 锦标赛模式（默认开）

`isBundledAlgorithm(hash)` 命中**平台发行树**的包一律不许上场：
`starter/`、`algorithms/team-{a,b}`、`competitor-kit/starter`、`demo/*`、
`playtest/competitors/*`。

四个执行入口**都**设了卡（只把按钮变灰是不够的 —— 直接的 POST 不读 `enabled`）：

| 入口 | 位置 |
|---|---|
| 参赛者上传 | `session.ts#uploadPackage`（**先判后装**） |
| 按路径安装 | `session.ts#install`（先判后装） |
| 密封进本场 | `session.ts#useSlot` |
| 向导主按钮 | `session.ts#prepareMatch`（它绕过 `useSlot`，必须单独设卡） |

`tests/fixtures/algos/*` **不在**名单里：那是测试脚手架，不是发行物。
`--no-tournament` 是唯一的例外通道，**仅用于开发自测**。

---

## 5. 已知缺口 / 未决项

按重要性排序。前三条是**真实且可复现**的。

### 5.1 Preflight 的锚点盲区 —— **已修复**

V1.2 把锚点改成逐场选定之后，preflight 的 decoy 世界一度仍在下发平台常量，
于是它只能验证「算法能跑」，验证不了「算法会从 `public_state.emitters` 读锚点」：
一个写死 `-18` 的算法会通过本地自检与官方 Preflight，然后在正赛**每一轮**
被判 `NOT_THROUGH_SHOOTER`。

代码里留着证据：`validateOutcome` 曾有一个参数 `shooterPos`，两个调用点早就在传
`decoyMap.teamA[0]`，但函数体内从未使用 —— 原设计就是 decoy 用 decoy 地图上的点，
实现漂移成了常量，且输入与校验**一致地**漂移，所以谁也没发现。

现状：`MapGenerator.decoyEmitters(map)` 统一给出「decoy 地图上双方各自的第一个点」，
输入构造与校验共用它，并把这两个点从 `points` 里移除（与正式回合一致）；
`LocalPreflight` 也改用同一条规则。回归见 `tests/preflight-decoy.ts` +
`tests/fixtures/algos/hardcoded-anchor/`。

### 5.2 demo/reference-solver-v2：**已部分改善，仍未达成其宣称目标**

它宣称解决「反复瞄同一个位置」。**目标仍未达成**，但本轮找到了真正的主因并做了修复。

**主因（已修）**：候选曲线族里所有自由曲率都只有 ±1.5 / ±2.5 y 单位，
量级上就够不着「障碍物后面」的目标。一旦直线被障碍物挡住，
每个候选的轨迹都在半路终止、击杀数恒为 0 —— 评分退化成「比谁更不复读」，
局面永不改变。实测某局 A 的九条直线**全部**被同一个圆挡住，`end_x` 停在离锚点
5 个单位处。

修复：新增**绕行路标**候选族（`gb_candidates.obstacle_waypoint_candidates`）——
对每个挡路的障碍物，把曲线钉到它外侧（两侧 × 两档余量 × 中心/边缘两种钉法），
由模拟器淘汰。同时给 `interp_through` 加了 `focus_targets`，
让路标不污染「瞄过谁」的陈旧度统计。

**效果（三个种子，hard / 10 点，A+B 合计击杀）**：

| seed | 改动前 | 改动后 |
|---|---|---|
| 777 | 11 | 14 |
| 424242 | 8 | 16 |
| 20250911 | 8 | 9 |

耗时上界 287 ms / 500 ms，零超时。

**仍未解决**：三局**都仍以 `STALEMATE` 收场**。停滞段是一个**周期 2 极限环** ——
从第 7 轮起双方各在两条**打不中**的射击之间来回（`blockedB` 逐轮完全重复），
20 个零击杀回合后判和。求解器自己也知道那两枪打不中（`kills=0`）。

### 5.2.1 「直调 vs 沙箱分歧」—— **查清了：那个分歧不存在**

曾报告（本文件的前一版也这么写）：「同一轮输入，直接跑 `solver.py` 会选中能击杀
的那一枪，而官方沙箱提交的是打不中的那条」。按规范 §81–§92 做完整调查后，
结论是**那是我自己的复现输入有问题**，不是求解器的问题：

```text
直调   : 95ad922b5e4e1dbb × 10
沙箱   : 95ad922b5e4e1dbb × 10
结论   : 两侧各自稳定且一致，并且等于当年那一场实际提交的那一枪
```

根因：当时那份「复现输入」是由**回放帧**拼出来的，而回放帧里障碍物存的是
平台**核心形态** `{"type":"circle","center":[x,y]}`；协议真正下发给算法的是
`{"type":"circle","cx":…,"cy":…}`。`gb_world` 里写的是 `ob.get("cx", 0.0)` ——
**缺键时静默退化成 0.0**，圆被悄悄挪到 x=0。输入错了，但答案看起来完全合理，
于是「复现出来的现象」与真实比赛毫无关系。

已做的三件事：

1. **冻结忠实 fixture**：`tests/fixtures/demo-stall/`（停滞那轮的 public/reveal，
   加上 `source.json` 记录引擎当年的哈希与该场实际提交）。
2. **新增 `tests/demo-repro` 套件**：先断言 fixture 的 sha256 **逐字节等于**
   引擎记录的 `publicStateHash`，再直调 / 沙箱各 10 次比对。
   第一条就是当初能避免整场误判的控制 —— 已做变异检验（改动 fixture → 变红）。
3. **去掉使能因素**：`gb_world` 在 `build_world` 边界处一次性归一化障碍物，
   两种形状都收，**认不出来就报错**，不再静默退化成 0。

**剩下的真问题**就是周期 2 极限环本身（策略问题，不是可复现性问题）。
按规范 §93，它排在可复现性之后；当前尚未处理。

### 5.3 尚未覆盖的验收面

- **服务端 / 引擎自产的自由文案不随语言变化。** 它们是平台权威诊断（锦标赛拒绝、
  安装流水线错误、引擎错误原文），仍是中文，并以原样透传到界面。结构化字段 ——
  阶段枚举、动作 key、错误码（`NOT_THROUGH_SHOOTER` 等）—— 与语言无关，一律不变。
  要真正双语化它们，得让语言跨进比赛载荷，或把每条消息都改成 code + 参数，
  那是另一波的事。
- `npm run e2e` 需要系统装有 Google Chrome（配置里 `channel: 'chrome'`）。
- 终端操作台（`src/operator/`）没有锦标赛模式 —— 它是操作员显式指定
  `--a/--b` 的入口，不存在「自动落回模板」的情形，因此**刻意未加**。
- `JudgePage` 的 `emitterRows` 兜底分支在当前协议下不可达（协议里
  `emitterSelection` 是必填字段）—— 留着是为了老服务端，无害。

---

### 5.4 宿主 idle sleep 会让当轮双方 TIMEOUT（运行手册项，不是引擎缺陷）

V1.4 自战战役里唯一一次异常：裁判机进入 Idle/Maintenance Sleep 475 s，当轮双方 TIMEOUT（`TECHNICAL_INVALID`），
按零击杀计入 STALEMATE 计数。引擎按规则处理正确；**正式比赛前用 `caffeinate -dims` 或关闭自动睡眠。**

### 5.5 B-v1 自然地图下的 A 侧劣势 —— solver 观察项

B-v1 自战两组共 180 场原局 P(A 胜 | 分胜负) = 0.397（p = 0.029），但其镜像配对胜者 68/68 互换 ⇒ **不是槽位效应**；第二组 90 seed 未复现（0.472）。
归属 solver 与几何交互研究，与平台无关。

### 5.6 回放列表 / 侧栏的队名是「Team A / Team B」

`src/server/replays.ts` 写入的 `teamAName` 目前是队别名而非算法名（产物 `match.json` 如此）；前端在等于队别标签时去重显示。
若要显示算法名，是服务端改动，本轮未做。

### 5.7 服务端自由文案仍不随语言（延续 5.3）

`CommandResult.errors` / `JudgeBoard.lastError` / `runToEndBlocker` 仍是中文自由文本；V1.4 前端把它们按**来源**分层放置（package / preflight / round / judge / connection / server），
标题句翻译、正文原样透传。要真正双语化需服务端给 key（另一波）。

## 6. 怎么验证（按改动范围挑，不要每次都跑全量）

```bash
npm run typecheck && npm run typecheck:web     # 两端类型检查，秒级
npx ts-node tests/run-all.ts server-team       # 参赛者端 / 锦标赛门禁 / 裁判源码
npx ts-node tests/run-all.ts web-server        # HTTP + WS 端到端
npx ts-node tests/run-all.ts web-projection    # 前端投影与观众板白名单
npx ts-node tests/run-all.ts competitor-kit     # 选手文档 + examples 防漂移
npx ts-node tests/run-all.ts judge-console     # 终端裁判屏文案
npx ts-node tests/run-all.ts <suite> [...]     # 任意组合，只跑指定套件
npx ts-node tests/run-all.ts mirror-fairness    # 平台镜像公平性 L1–L5（纯函数，≈18 s）
npx ts-node tests/run-all.ts mirror-match       # L6 真沙箱（≈65 s，高负载会以 environment/probe 明确失败）
npx ts-node tests/run-all.ts web-wizard         # 裁判向导 / 参赛者步骤 / 回放播放器的纯模型
npm test                                       # 全量 42 套件（含 timing-fairness 与 mirror-match，约 15 分钟）
npm run e2e                                    # Playwright 浏览器演练（约 15 秒，需要 Chrome）
```

`tests/run-all.ts` 在失败时**正确**地 `exit 1`。

**最近一次完整验证（2026-09-13，V1.4 最终门禁，全部通过）：**

```text
npm run typecheck / typecheck:web   → 0 错误
npm test                            → 42/42 套件通过，357 个用例，20 分 33 秒（load 1.5–3.0；
                                      timing-fairness 806 s 通过、mirror-match 67 s、mirror-fairness 18 s、
                                      competitor-kit 14 s、web-wizard 0.5 s）
npm run e2e                         → 11 passed（50.1 s）：双语 5 + 中文赛事 3 + ZIP 1 + 视口巡检 2
                                      （中英各一次完整赛事演练：首页 → 上传 → Preflight → 选锁 → 揭晓 → START →
                                        连续跑完 → 大屏 → 终局 → 回放播放器 → 两步确认换场 → 第二场）
```

V1.3 那次（2026-09-12）的记录：39/39 套件 318 用例、e2e 9 passed —— 作为对照保留在 `V1.4_DEVELOPMENT_LOG.md` 阶段 1。

> 上述全量是在 **`BTLEServer` 占满一个核、load average 一度到 14.5** 的情况下跑完的，
> 仍然零假红 —— 但这是运气好，不是你下次可以照抄的前提：见下面第二条警告。

> ⚠ **不要在门禁运行期间改源码。** 每个套件是独立的 `ts-node` 进程，
> 中途落盘会让后启动的套件读到半改状态，产出「看似失败、单跑却通过」的假红。
> 要改就先停下门禁。
>
> ⚠ **机器忙也会造成假红。** 单次计算预算是冻结的 500 ms；负载一高，
> 沙箱里的 python 就会超时，依赖「每轮都有合法函数」的套件集体变红
> （实测见过整个套件耗时膨胀 40 倍的）。识别方法：`uptime` +
> `ps -A -o %cpu,comm | sort -rn | head`；处理办法见 DEVELOPMENT_RULES §2。

---

## 7. 文档地图

| 文件 | 讲什么 |
|---|---|
| `README.md` | 对外总览：规则、协议、Runtime、路由、锦标赛模式 |
| `competitor-kit/` | **面向选手**的手册（他们只读这个） |
| `docs/development_log.md` | 阶段式开发日志（V1.1 阶段 0 → V1.2 阶段 13；V1.3 起的记录见 `docs/agent-context/`） |
| `docs/agent-context/V1.4_DEVELOPMENT_LOG.md` | **V1.4 波次的完整过程记录**（各 Track 子代理原文 + 审核 + lead 收尾） |
| `Plans/Output/V1.4_PLATFORM_FAIRNESS_REPORT.md` | V1.4 平台公平性报告（方法 / 数据 / 四条结论 / 缺陷 / 局限 / 复现） |
| `Plans/Output/V1.4_BROWSER_QA_REPORT.md` | V1.4 浏览器 QA：路由 × 视口 × 语言矩阵、跨平台状态 |
| `experiments/v1.4-fairness/` | 公平性实验脚本与结果摘要 JSON |
| `docs/agent-context/` | **本目录** —— 给接手的 AI / 开发者的当前事实 |
| `Plans/Input/` | 人写的 Plan、规范与任务书 |
| `Plans/Output/` | 审计报告与历史交接文档（**历史**，可能与代码不符） |
| `playtest/` | 归档的试玩报告与选手包 —— `playtest/competitors/` **不要修改** |
