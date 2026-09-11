# Geometry Battle — 开发日志

> 本文件记录 V1.1 Completion Wave（Revision 3）期间的开发过程：
> 目标 / 修改 / 理由 / 文件变化 / 测试 / 问题 / 风险 / 下一步。
>
> 规则修订的**权威文本**在
> `Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md`；
> 本文件是**过程记录**，不是规则。

---

## 阶段 0 — 基线与输入

**目标**：记录可寻址的起点，并把独立重审的待办当作本轮输入。

| 项 | 值 |
|---|---|
| 起点 HEAD | `0a420a8`（Revision 2 rebalance 完成） |
| 输入任务书 | `Plans/Input/Geometry Battle V1.1 — Revision 3 Final Completion Wave.md` |
| 输入审计 | `Plans/Output/V1.1 Revision 2 Independent Rule Re-Gate.md`（CONDITIONAL PASS） |
| `v1.0.0-competition` | `26d7970`（**全程未动**） |

**审计遗留（§21 CONSOLIDATED REMAINING WORK）**：4 项 P1（RC-1 / RC-2 / CK-1 / PLAT-1）
+ 若干 P2 + Stalemate 相关的 T1–T4。

**风险**：审计文件本身是证据，只读不改；本轮所有工作在新提交里。

---

## 阶段 1 — 平台 P2 修复（与 Revision 3 正交，先做）

**目标**：把重审报告 §19 的 PLAT-2/3/4/5 + PLAT-1 + P3-15 一次关闭。

| 编号 | 问题 | 修改 |
|---|---|---|
| PLAT-2 | `goTimeout` 不在 `finish()` 里清理 → 非成功收尾泄漏定时器，沙箱销毁后仍补发 SIGKILL | 与 `poller`/`drainTimer` 并列清理；声明上移规避 TDZ |
| PLAT-3 | 结果 drain grace 与 deadline 赛跑 → 2000ms 预算可静默缩水为 1950ms | 接受结果时即撤销 `goTimeout`；deadline 回调加 `pendingResult` 兜底 |
| PLAT-4 | pre-READY 失败把 `CANCELLED` 归因给**无辜**的一方 | 新增 `RUNNER_ABORT` 与 `cancel(reason)`；READY 中止双方都给 `'PEER'` → 回合码落到 `TECHNICAL_INVALID` |
| PLAT-5 | 轨迹末点比真实交点少一个自适应步长 → 贴边敌人可能漏判 | 越界处二分到真实交点；收尾对齐到精确的 `xEnd` |
| PLAT-1 | `algorithm-slot` 过期断言让全量回归长期 25/26 | 断言改为「出厂槽位 == canonical starter 的副本」；**未删除任何 manifest.json** |
| P3-15 | `runAll` 无零用例守卫 → 0 个用例也 exit 0 | 零用例判失败；另加可选 `expectedTests` |

**验证**：typecheck 0 错误；`algorithm-slot` 8/8（此前长期 7/8）；
`obstacle-block` 9/9、`alive-kill` 5/5、`convexity-aliasing` 8/8、`map-fairness` 8/8。

**风险**：PLAT-5 改了 Judge 的轨迹末点 —— 属于判定语义面，因此跑遍了全部判定套件，
并确保既有断言一条未改。

---

## 阶段 2 — Revision 3 核心：固定 Emitter

**目标**：把「每轮选一个 Shooter」换成「整场固定的 Emitter」。

### 2.1 关键设计决策

**Emitter 不进 `points` 数组**，而不是给点加 `role: 'emitter'` 标志。

理由：`getWinner()` / `aliveAfter` / `aliveEnemies` / `publicPoints` / `markDead()`
都是「遍历 Points」的路径。把它们放进同一个数组，就得在**每一处**加排除判断 ——
漏一处就是一次静默的判定错误。放在数组外，这些函数**一行都不用改**，
「Emitter 不可击杀 / 不计入存活」变成结构性事实而不是断言。

代价：`GeneratedMap` / `public_state` / `RoundStateCore` 多一个字段。
相比之下这是更小的代价。

### 2.2 文件变化

```text
src/core/Rules.ts         +EMITTERS 常量；COMPUTE_TIMEOUT_MS 2000→500；
                          +STALEMATE_NO_PROGRESS_LIMIT=20；+HARD_ROUND_LIMIT=60
src/map/MapGenerator.ts   GeneratedMap +emitterA/emitterB（进哈希）；
                          validateMap 新增 Emitter 公平性检查
src/core/InputProtocol.ts public +emitters；reveal −shooters
src/core/Match.ts         删 selectShooter/lockShooter/locked/SELECT_SHOOTER；
                          +getEmitters()；+noProgressStreak/+terminalReason
src/core/Round.ts         状态机 19 → 16 阶段
src/core/Logs.ts          shooterA/B → emitterA/emitters；+noProgressStreak/endReason
src/ui/*、src/operator/*  跟随
```

### 2.3 终止保证（§17）

**把硬终止从 CLI 拿回引擎**：以前 `--max-rounds` 是操作台护栏，引擎自己不会结束
一场僵持。现在 `MatchEngine` 自己判定四类终局
（`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`），
CLI 的 `--max-rounds` 降级为纯兜底。这样「每场比赛都在有限时间内终止」
不再依赖任何调用方参数。

### 2.4 测试

- 删 `dual-shooter-selection`，新增 `fixed-emitter`（11 条结构断言）
- `locked-attack-right` 按 Rev 3 重写（10 条），核心从「Shooter 死了还打不打」
  改为「锁定攻击权的实质」；补上重审 VER-1 指出的**先手顺序负向回归**
- 全部套件适配新输入契约；fixture 算法的锚点改读 `public.emitters`

**踩到的坑（记录备查）**：
1. 给 `sniper`/`slow-sniper` 加 `first_enemy(public, team)` 时写成了
   `first_enemy(public, other)`，于是它去瞄**自己人** —— 端到端用例全部零击杀，
   但结构性用例全绿。教训：结构性用例不能替代端到端用例。
2. `dual-shooter-selection` 里的脚本化对局依赖「每轮人工选点」；
   改成固定锚点后必须重新搜种子（射线从常量出发不与第二个点共线），
   否则同归于尽的脚本不成立。

**风险**：这是本轮的**核心玩法变更**。它由人类明确决定（任务书 §2），
不是 Agent 的规则设计。

---

## 阶段 3 — Timeout benchmark（§11）

**目标**：用数据决定 500ms 是否可行，而不是拍脑袋。

**方法**：同一批 3 个 map condition × 2 摆位 × 3 配对，在 250 / 500 / 750 ms 下各跑一遍，
统计每个「队伍×回合」的 `TIMEOUT`。竞品算法**未做任何适配**（只把锚点读取
从 `reveal.shooters` 改成 `public.emitters`）。

| 预算 | 样本（队伍×回合） | TIMEOUT | 整场失败 |
|---|---|---|---|
| 250 ms | 128 | **20（15.6%，全部是 optimizer）** | 7 场 |
| 500 ms | 218 | **0** | 0 |
| 750 ms | 218 | **0** | 0 |

**结论**：按 §11 的判据 —— 500ms 没有让参考算法出现非预期 TIMEOUT，且明显收紧预算
—— **保持 500 ms**，不回升 2000 ms。

**产物**：`playtest/results/revision-3-timeout-bench/BENCHMARK.json`

**已知局限**：样本是 3 个条件，不是全量 30 个；500ms 的 0 超时结论有较大的置信区间。
最终 playtest（§32，180 场）会给出更大的样本作为补充证据。

---

## 阶段 4 — 规则文档与 Competitor Kit

**目标**：关闭 RC-1 / RC-2 / CK-1 / CK-2。

- **RC-1**：§0 新增全局生效声明 + **全文替换表**；逐条修正 §5/§6/§7/§8/§23/§37/
  §42/§51/§54/§55/§60/§61/§62；所有被废止的旧表述一律加
  **「历史记录（不删除）」** 标注 —— 原文一字未删。
- **RC-2**：§43 重写为「胜负只看战斗点」+ 43.1 Mutual Elimination + 43.2 其它判和分支。
- **CK-1/CK-2**：kit 的 JSON_SCHEMA（public 增 emitters / reveal 删 shooters）、
  ALGORITHM_REQUIREMENTS（§6 规则表补 Emitter / 场地边界永久终止 / 胜负；
  §6.1 重写；§15 终止规则改为四类穷举）、DSL_SPECIFICATION（示例锚点改真实 Emitter）、
  README（timeout 与 Emitter 措辞），examples 由真实引擎重新生成。
- 全部 timeout 文案 2000 → 500。

**风险**：kit 的文档示例会被 `tests/competitor-kit.ts` 拿去跑真实 parser/validator，
因此改示例值必须同步改测试里的 `DOC_SHOOTER` —— 否则「示例通过校验」会变成空转。

---

## 阶段 5 — 后续（本文件在开发过程中持续追加）

见下文各阶段。

---

## 阶段 6 — 最终 playtest 暴露的一个真 bug（本轮引入、本轮修复）

**现象**：Revision 3 的第一次 180 场 playtest 跑完，**180 场全部记成 `draw`**，
三对配对的 `wins` 全是 0。

**根因**：`MatchEngine.getMatchLog()` / `getReplay()` 里的 `winner` 字段写成了

```ts
winner: this.terminalReason ? 'draw' : this.getWinner() ?? 'draw',
```

`terminalReason` 在**任何**终局（包括 `ELIMINATION`）都会被设置，于是这个三元表达式
把「一方全灭」的比赛也强制写成 `draw`。逐场核对确认：
`s1010-p8-medium__hybrid-A` 的 `endReason=ELIMINATION`、`finalAlive={A:0,B:3}`，
而 `winner` 却写着 `draw`。

注意 `RoundResult.winner`（内存返回值）是**对的** ——
`const finalWinner = winner ?? (this.terminalReason ? 'draw' : null)`。
错的只有落盘的日志与回放。这也解释了为什么此前的套件全部通过：
**没有一条用例断言过「ELIMINATION 时日志里的 winner 是谁」**。

**修复**：`winner: this.getWinner() ?? 'draw'` —— 胜者只由存活战况决定（规范 §43）。

**新增回归**：`tests/full-match-e2e.ts` 的
「ELIMINATION 必须记下真正的胜者，不得记成 draw（回归）」，
按 `endReason` 分支断言 winner 与 `finalAlive` 的对应关系
（ELIMINATION → 幸存方；MUTUAL_ELIMINATION → 双方归零且判和；
STALEMATE / HARD_ROUND_LIMIT → 判和且双方都还有点）。

**处理**：第一次 playtest 的产物是**有缺陷引擎的输出**，整体删除并重跑。
删除是刻意的：留一份已知错误的归档只会让后续引用踩雷；
本文件与回归用例保留了它的完整记录。

**教训**：终局相关的字段（winner / endReason）必须有**逐终局分支**的断言，
否则「四类终局」的新代码路径里，任何一条都可能悄悄写错而全套件全绿。

---

## 阶段 7 — UI/UX 与赛事操作

**目标**：把 §23–§27 的 UI/UX 面落到实处。

| 面 | 交付 |
|---|---|
| Audience Screen | `src/ui/ArenaView.ts`：真实几何的等宽字符渲染（场地/障碍物/固定 Emitter/战斗点生死/A·B 轨迹）+ 图例 + 坐标标尺 |
| 观众模式 | `--audience`：只输出观众屏，隐藏槽位路径、包哈希、decoy seed、状态哈希、产物目录、回放命令 |
| Team Interface | `TeamControllerUI` 重写为只读面板；旧的点位控制器删除 |
| Judge Console | 现有操作台覆盖 §24 的全部动作；`tests/operator-e2e.ts` 盯着「不需要开发者介入」 |
| Error UX | `renderRoundStatus()` 明确说出 TIMEOUT / INVALID / CRASH / RUNNER CANCELLED |

**踩到的坑**：`--audience` 第一版只挡了「产物目录」一处，槽位面板、包哈希、
decoy seed、public/reveal 状态哈希**全都还在打**。是 `operator-e2e` 的
「不得出现 `/Users/` 或 `/var/folders/`」与「不得出现 `sha256 =`」两条断言把它逼出来的
—— 观众模式的正确性只能靠**黑盒扫描输出文本**来保证，不能靠「我记得挡了」。

**未做（如实记录）**：没有动画（`computeAnimationFrames` 仍未接线）；没有键盘驱动的 TUI；
没有引入任何前端依赖。

---

## 阶段 8 — 终止保证的逐边界回归

**动机**：180 场最终 playtest 里 `HARD_ROUND_LIMIT` **一次都没触发** ——
「四类穷举」的代码路径里有一条从没被执行过。这在审计里是典型的
「写了但没验证」风险。

**做法**：给 `MatchOptions` 加**测试专用**的阈值覆盖
（`stalemateNoProgressLimit` / `hardRoundLimit`，默认仍是冻结的 20 / 60；
操作台 CLI **不暴露**这两个参数），然后新增 `tests/termination.ts`（5 条）
把两条边界都逼出来：

- 双方都打不中 → 连续零击杀达标 → `STALEMATE` / DRAW，逐轮 streak 可复核；
- 把僵持阈值抬到硬上限之上 → 必须由 `HARD_ROUND_LIMIT` 收场；
- 一条击杀就把计数清零（逐轮比对定义）；
- 多组条件下 `endReason` 必须落在四类之内，且 winner 与 endReason 对应正确。

---

## 阶段 9 — 最终验证与交付

见 `Plans/Output/V1.1 Completion Wave Report.md` 与
`Plans/Output/V1.1 Release Candidate Handoff.md`。

**本轮新增/重写的套件**：`fixed-emitter`(11) / `locked-attack-right`(10) /
`termination`(5) / `arena-view`(7) / `operator-e2e`(4)；
删除 `dual-shooter-selection`。

---

## 阶段 10 — Known-Gap Closure（`fd4c6b1` 之后）

**目标**：只关闭**已经明确知道**的 Release Candidate 缺口，不碰核心规则。

### 10.1 轨迹动画接线

**问题**：`computeAnimationFrames` 是死代码，而且写法本身有两个毛病 ——
每帧从头重采样（O(帧数 × 点数)），并且以**函数**为输入。

**为什么以函数为输入是错的**：观众要看的是**判定结果**。原始函数会一路画到定义域
尽头，而真实轨迹在第一次障碍物接触或第一次离开 Arena 处**永久终止**。
用函数重采样会画出一条穿过障碍物的曲线 —— 现场看到的就是错的。

**做法**：
- `src/ui/TrajectoryAnimator.ts`：帧源是**已判定的轨迹**（`computeTrajectoryFrames`），
  增量揭示；播放器在 TTY 上原位重绘（自写 ANSI，零依赖），非 TTY 退化为首/中/尾三帧。
- `ArenaView` 支持按比例揭示轨迹（`revealA` / `revealB`），只影响绘制。
- `computeAnimationFrames` 保留为薄封装（先采样一次，再交给增量切分），
  并在注释里写明「观众屏请用轨迹版」。

### 10.2 正式裁判入口

**问题**：唯一能开赛的入口是 `npx ts-node src/operator/cli.ts` —— 那就是开发 CLI。

**做法**：新增 `npm run judge`（`src/operator/judge.ts`）+ `src/ui/JudgeConsole.ts`：
- **不给任何参数**也能开一场正规比赛（算法从固定槽位取，种子自动生成）；
- 交互式菜单覆盖 §24 的 12 个动作（载入 / 校验 / 开始 / 揭晓 / START / 结算 /
  跑完 / 回放 / 审计 / 重置 / 退出）；
- `--auto` 供无人值守演练；`--spectator` 切到大屏；
- `cli.ts` 保留为底层诊断工具，两者共用同一个 `MatchEngine` 与同一套 UI 组件。

### 10.3 简洁观众屏

`AudienceScreenUI.renderSpectatorBoard()`：大竞技场 + 一行状态 + 一行结果。
没有控制台、没有哈希、没有路径、没有 JSON。由 `--spectator` 与
`operator-e2e` 的「大屏不泄漏」断言共同保证。

### 10.4 完整赛事演练

`tests/operator-e2e.ts` 从 4 条扩到 8 条，走**正式裁判入口**完成
「启动 → 载入算法 → 校验 → 比赛 → 终局 → 回放 → 审计 → 重置 → 下一场」，
并断言「只给 `--auto` 也能开赛」。

---

### 10.5 过程中发现并修复的三个真问题

**(1) 新增的裁判测试污染了仓库工作区。**
测试忘了传 `--slots`，安装流水线把参考算法**真的装进了受跟踪的 `algorithms/`**。
这与 `hostile-input` 曾经踩过的是同一个坑（记忆里记着，却在新测试里重犯了）。
处理：`git checkout` + `git clean` 还原槽位；`runJudge()` 一律传 `--slots <tmp>`；
新增「测试不得改写仓库里的固定算法槽位」回归 —— 它直接检查出厂状态
（每个槽位只有 `manifest.json` + `solver.py`，且 `solver.py` 与 starter 逐字节相同）。

**(2) 裁判台在管道输入下挂死。**
两个叠加的原因：`readline` 在开赛前的载入 / Preflight 期间（好几秒）就已因 stdin EOF
触发 `close`，第二次提问抛 `readline was closed`；而输入耗尽后又把空串当成
「未知动作」无限循环。
处理：**双模式输入** —— TTY 走 readline 提示，非 TTY 一次性读完所有行、逐行回答，
行用完后优雅退出。附带好处：裁判台本身可以被脚本驱动。

**(3) 控制台重复实现了引擎的门禁。**
我用 `phase === 'READY'` 判断「能否开赛」，而 `MatchEngine.startMatch()` 真正的判据是
「上传完毕（`UPLOAD_B`）+ `preflightDone`」—— 于是**校验通过之后反而开不了赛**。
处理：删掉影子规则，直接把引擎返回的结论报出来。
**教训与 Revision 3 的 Emitter 一致：判定只能有一个来源，UI 不许再猜一套。**

### 10.6 验证范围（Fast Verification）

本次改动只落在 `src/ui/`、`src/visualizer/AudienceDisplay.ts`（动画部分）、
新增的 `src/operator/judge.ts` 与测试文件；**核心判定 / 计时 / 沙箱 / DSL 一行未改**。
因此只跑定向集：

```text
npm run typecheck            → 0 错误
tests/arena-view.ts          → 13/13
tests/judge-console.ts       → 7/7
tests/operator-e2e.ts        → 8/8（含 6 场真实比赛）
```

其余套件记为 `UNCHANGED — PRIOR PASS EVIDENCE`（`fd4c6b1` 的 29/29），
可用 `git diff --name-only fd4c6b1..HEAD -- src/core/ src/runner/ src/map/ src/submission/`
确认为空。

---

## 阶段 11 — 本地 Web UI（`42e5417` 之后）

任务书：`Plans/Input/Geometry Battle V1.1 Local Web UI.md`。
设计 spec：`Plans/Output/V1.1 Local Web UI Design Spec.md`。
交接：`Plans/Output/V1.1 Local Web UI Handoff.md`。

把稳定的 Engine / Judge / Replay 包装成 `npm run app` 一键启动的本地比赛应用。
**未改一行核心判定**（`src/core/` `src/runner/` `src/map/` `src/submission/` `competitor-kit/`
零 diff），终端裁判台也**一字未动**。

### 11.1 架构：视图投影服务端

被否决的方案是「薄 HTTP 代理」（把原始 `MatchSnapshot` 丢给浏览器，各页面自己挑字段）。
问题不在代码量，而在**保证的性质**：那样「观众看不见 hash / 路径 / 诊断」会退化成
前端黑名单 —— 只要有人往快照里加一个字段，大屏就静默泄漏。

本设计把这条保证变成结构性事实：`spectatorBoard()` 是**逐字段白名单**拷贝，
没拷贝到的字段浏览器根本收不到。

```
web/ (React + Vite + Canvas 2D)  ──REST 命令 / WS board──  src/server/ (ts-node)
                                                                └─ 只读消费 src/core
```

### 11.2 施工中改掉的两处设计

**(1) `run-to-end` 从「阻塞请求」改成后台任务。**
原设计让 HTTP 请求一直挂到比赛结束 —— 一场最长 60 轮，那是分钟级请求，
浏览器与 undici 都有超时，现场也不该「点一下然后转圈」。
改成后台推进 + board 上暴露 `busy`，进度靠 WS 推的 board 看。

**(2) Content-Type 校验只作用于 POST。**
原先对所有非 GET 方法要求 JSON 体，于是 `PUT /api/health` 回 415 而不是 405 ——
把一个纯粹的路由问题报成了协议问题。命令语义只有 POST 有。

### 11.3 施工中抓到的三个真问题

**(1) 越权测试的「全 null」是假绿。**
`resolveMatchDir` 的越权用例一开始全绿 —— 因为我传错了根目录（传了 tmp 根而不是
`artifactRoot`），于是**所有** id 都解析为 null，包括合法 id。
加了「真实存在的 matchId 必须解析得到」的正向对照才暴露出来。
**教训**：只断言「全部被拒绝」的用例，在实现整体坏掉时也是绿的。

**(2) 观众板对照断言写错，测的是空集合。**
`collectKeys` 的闭包捕获了外层的 `keys`，传入 `r.finalBoard` 后仍写进同一个集合，
`judgeKeys` 永远为空。同样是「反空转对照」把它抓出来的。

**(3) URL 规范化会吃掉 `..`。**
`GET /api/replays/../../etc/passwd` 被 `new URL()` 规范化成 `/etc/passwd`，
落到静态处理器（同样被拒），因此**回不到** replay 路由的 404。
这不是漏洞，但说明「用某个具体状态码断言越权」是脆的 ——
改成断言「绝不成功 + 绝不透露路径」，并在映射层单测里做精确断言。

### 11.4 安全

只绑定 `127.0.0.1` 挡不住 CSRF 与 DNS rebinding（请求确实来自本机）。
三道闸：Host 白名单、Origin 必须缺席或同源、POST 必须是 JSON 体；不出 CORS 头。
WS upgrade 走同一套校验 —— 否则一个恶意网页可以直接开一条直通裁判 topic 的信道。
replay 的 `matchId` 是唯一会长进文件路径的用户输入：字符白名单 + **枚举命中**
（路径从服务端自有列表里选，从来不拼）+ resolve 复核。

### 11.5 前端

React 19 + Vite 8，三条路由 `/judge` `/spectator` `/replay/:matchId`，
竞技场用 Canvas 2D 绘制。视觉方向取自项目的世界 —— **坐标纸**：
网格、轴、刻度数字都画出来（判定就发生在这些坐标里），
签名元素是轨迹的发光头与**终止环**（攻击在哪里停下：命中 / 撞墙 / 出界）。
两队用 aqua / amber（CVD 安全的高分离对），命中瞬间用白热闪，不引入第三种彩色。
轨迹动画由 `requestAnimationFrame` 直接改画布，不经过 React state。

### 11.6 验证

```text
npm run typecheck              → 0 错误（含新增 src/server/）
npm run typecheck:web          → 0 错误
npm run build:web              → 24 modules，dist 246 kB
npx ts-node tests/web-projection.ts  → 20/20
npx ts-node tests/web-server.ts      → 18/18（真 HTTP + 真 WS + 真算法）
npm run e2e                    → 1 passed（Playwright 真浏览器完整演练）
```

演练跑的是真比赛：seed 700001 / 6 点 / easy 下 3 回合 MUTUAL_ELIMINATION，
逐轮击杀 5/4/3，每侧轨迹 400 点（上线前降采样到 240）。

---

## 阶段 12 — V1.2 Interactive Tournament Experience（`ecedff6` 之后）

V1.2 的全部改动都在这个阶段。它只改**规则的一处**，但把整条参赛者路径从
「终端投递」搬到了浏览器，并把裁判台重做成阶段驱动的向导。

### 12.1 规则修正案：锚点交还给队伍

V1.1 的固定 Emitter 是平台常量（A `(-18,0)` / B `(18,0)`）。V1.2 起，
**每队在开赛前从自己的初始点里选一个并锁定**：

```text
SETUP → … → PREFLIGHT → START → EMITTER_SELECT → READY → PUBLIC → REVEAL → …
```

`lockEmitter` 双锁之后，被选中的那个点**从 `points` 数组里物理移除**
（`Match.ts`），于是「敌方目标枚举 / 存活计数 / 胜负判定 / 回放绘制」
这些遍历 `points` 的路径**结构性地**碰不到它 —— 不需要在每处加角色判断。
`Rules.EMITTERS` 常量只剩两处用途：preflight 的 decoy 世界与 MapGenerator 的出生点间距。

双方的选点在**都锁定之前互不可见**，且这不是前端隐藏：引擎快照在未公开时
把 `emitters` 置为 `null`，服务端按观看者角色裁剪，参赛者板上**没有**对方的字段。

### 12.2 参赛者路径

`/team/a` `/team/b` 两页：浏览器上传算法包（目录 / 文件 / ZIP，ZIP 在浏览器里
用 `DecompressionStream` 展开，服务端保持零依赖）、只读浏览自己的源码、
在列表或画布上点选锚点并锁定。

上传走的是**同一条**安装流水线（staging → validate → preflight → hash → seal → replace），
浏览器没有任何绕过校验的通道。

### 12.3 锦标赛模式：从「界面建议」变成「执行门禁」

最初的实现只在 board 的 `enabled` 上做提示，而三个执行入口（`prepare` /
`use-slot` / `install`）根本不查它 —— 一个直接的 POST 就能让一场「锦标赛」
跑在出厂模板上（服务端启动时会把 `algorithms/team-*` 播种进槽位）。
另外上传端点是**先装后拒**：包已经写进槽位了，拒绝只改了返回值。

现在 `MatchSession.tournamentRejection` 在四个入口逐一设卡，且**先判后装**；
`isBundledAlgorithm` 覆盖整个发行树（`starter/` `algorithms/` `competitor-kit/starter`
`demo/*` `playtest/competitors/*`）。测试私有 fixture 不在名单里。

### 12.4 preflight 的锚点盲区（本轮引入、本轮修复）

锚点变成逐场选定之后，preflight 的 decoy 世界**仍在下发平台常量** ——
于是它只能验证「算法能跑」，验证不了「算法会从 `public_state.emitters` 读锚点」。
一个写死 `-18` 的算法会顺利通过本地自检与官方 Preflight，然后在正赛**每一轮**
被判 `NOT_THROUGH_SHOOTER`。

代码里留着证据：`validateOutcome` 有一个参数 `shooterPos`，两个调用点早就在传
`decoyMap.teamA[0]`，但函数体内从未使用它 —— 原设计就是让 decoy 用 decoy 地图上的点，
实现中途漂移成了常量，而输入与校验两边一致地漂移，所以谁也没发现。

修法：`decoyEmitters(map)`（落在 `MapGenerator`）给出「decoy 地图上双方各自的第一个点」，
输入构造与校验**共用同一个来源**，并把这两个点从 `points` 里移除（与正式回合一致）。
本地自检工具 `LocalPreflight` 一并改用同一条规则 —— 它原先也读 `map.emitterA/B`，
同样放行写死坐标的包，而它的文档还承诺着「本地自检规则 == 官方 Preflight 规则」。

新增 `tests/fixtures/algos/hardcoded-anchor`（函数恒为 `y=0`，即「只经过 (-18,0)」）
与 `preflight-decoy` 的一条回归，双向钉死这条性质。

### 12.5 障碍物的「视觉重叠」：几何早就对了，错的是绘制

`347180b` 已经把几何侧修好（`MIN_OBSTACLE_CLEARANCE = 1.0`）。
现场看到的「重叠」来自渲染：`projection.ts` 把圆半径**只按 x 轴**缩放，
而绘图区几乎不可能正好是 40:24 的等比缩放 —— 宽屏下圆被画得偏高，
轨迹看着在碰到障碍物之前就停了，两个其实有间距的障碍物看着在重叠。

改成两个轴各按自己的尺度缩放、画布用 `ctx.ellipse`。回归断言的是**几何等式**：
数学圆上任意一点投影后必须落在画出的椭圆上（`((px-cx)/rx)² + ((py-cy)/ry)² = 1`），
覆盖四个尺寸 —— 其中 400×240 恰好等于场地比例，是旧实现唯一看不出问题的尺寸。

### 12.6 那条「永远跑不过」的验收演练

V1.1 的 `npm run e2e` 是通过的。V1.2 重写 spec 之后**从未跑完过**，
原因是 `clickAction` 直接点 `[data-action="…"]`：向导每一步只把一个动作放在
主按钮上，其余收进 `Advanced Controls` 折叠区（`<details>`），
点击隐藏元素会一直等可见性，于是测试挂到超时。

作者其实写了 `openAdvanced()`，只是没接进去。修好之后又暴露两处：
向导在 SETUP 步把 `use-slot-a` 排在 `prepare` 前面（把「一步做完」的主按钮
挤进了折叠区）；坏包用例断言「未就绪」，但槽位里已装好的包**本来就不该被
一次失败的上传动到**，显示「已就绪」才是诚实的。

### 12.7 文档

`README.md` 从 V1.1 更新到 V1.2（规则表、锚点语义、四条路由、锦标赛模式、
套件数 32 → 34）。`competitor-kit/` 是**选手唯一会读的东西**，而它整篇还在教
「Emitter 是常量 `(-18,0)`」—— 全部改掉，并加了一条防漂移回归
（禁止再出现那几句旧话术，同时要求正向写明从 `public_state.emitters` 读）。
本文件此前停在阶段 11。

### 12.8 验证

```text
npm run typecheck / typecheck:web     → 0 错误
npm test                              → 34/34 套件通过
npm run e2e                           → 2 passed（真浏览器完整赛事演练）
competitor-kit/tools/validate_submission.py starter           → PRE-FLIGHT PASS
competitor-kit/tools/validate_submission.py hardcoded-anchor  → PRE-FLIGHT FAIL
                                        （NOT_THROUGH_SHOOTER，报出样例世界的真实锚点）
```

演练跑的是真比赛：`/team/a` `/team/b` 各自上传真实算法包 → 各自选锚点并锁定 →
揭晓 → START → 逐轮 → 终局 → 大屏 → 回放 → Reset → 第二场。
每一处交互都是**点界面上的按钮**，不直接调 API。

本轮新增/强化的回归（每条都做过「注入旧 bug → 确认变红 → 还原」）：

```text
preflight-decoy      decoy 锚点取自 decoy 地图，写死坐标的算法被拦下
web-projection       圆的屏幕几何 = 数学圆在投影下的像（非等比尺寸）
server-team          锦标赛门禁四个入口 + 主办方查看上传源码（含路径泄漏）
competitor-kit       选手文档不得再把 Emitter 写成平台常量
```

---

## 阶段 13 — V1.2 保守收口：提交拆分、规范缺口、demo 可复现性调查

本阶段按 `docs/agent-context/V1.2_CONSERVATIVE_EXECUTION_SPEC.md` 执行。

### 13.1 把未提交的全部 V1.2 工作拆成 7 个提交

工作树里积压的改动此前从未提交（43 改 + 4 新增）。按主题拆成可独立 review / revert 的
七个提交：agent context、平台正确性、参赛者工作流、裁判工作流、竞技场渲染、
选手文档、demo 求解器。拆分过程中未改动任何文件内容，拆完重跑全量基线仍是 34/34。

（staging 一律用显式路径，`git add .` 已按规范禁用；每个提交前 `git diff --cached` 核对。）

### 13.2 对照规范补齐的缺口

- **源码预览的受控降级**：超长文件此前是**拒绝**、二进制会被当 utf-8 读成乱码。
  改成截断 + 「已截断」标注、二进制返回「不提供预览」，都不尝试解码。
- **锁定前可改选**：原测试只覆盖「锁定后不可更换」，「锁定」的语义不完整，补上另一半。
- **参赛者页刷新恢复**：LOCK 之后刷新，选择与锁定状态必须原样回来。
- **隐藏选择是传输层性质**：浏览器演练改为把 B 端收到的**每条 WebSocket 文本帧**
  都记下来逐字检查 —— 只断言 DOM 抓不到服务端泄漏。已用变异检验确认这一点。

### 13.3 「直调 vs 沙箱分歧」——查清是**伪命题**

规范 §81 把「同一输入直调选中能击杀的一枪、沙箱提交打不中的那条」
列为 demo 的头号问题。按 §83/§84 完整调查后，结论是**那个分歧不存在**：

```text
直调   : 95ad922b5e4e1dbb × 10
沙箱   : 95ad922b5e4e1dbb × 10
```

两侧各自稳定、并且等于当年那一场实际提交的那一枪。

根因是**复现输入本身错了**：它由回放帧拼出，而回放帧里障碍物存的是平台**核心形态**
`{"type":"circle","center":[x,y]}`；协议真正下发的是 `{"type":"circle","cx":…,"cy":…}`。
`gb_world` 里写的是 `ob.get("cx", 0.0)` —— **缺键静默退化成 0.0**，圆被悄悄挪到 x=0。
输入错了，答案却看起来完全合理，于是「复现出来的现象」与真实比赛毫无关系。

三件事：冻结逐字节忠实的 fixture（`tests/fixtures/demo-stall/`，含 `source.json`
记录引擎当年的哈希与该场提交）；新增 `tests/demo-repro` —— 先断言 fixture 的 sha256
**等于引擎记录的哈希**（这条就是当初能避免整场误判的控制，已做变异检验），
再直调 / 沙箱各 10 次比对；最后去掉使能因素 —— `gb_world` 在边界处归一化障碍物，
两种形状都收、**认不出来就报错**，不再静默当作 0。

### 13.4 仍未解决

demo 的**周期 2 极限环**（停滞段双方各在两条打不中的射击之间来回）。这是**策略**问题，
不是可复现性问题；按规范 §93 排在可复现性之后，本轮未处理。
`tests/demo-repro` 只保证「同样的输入 → 同样的结果」，**不保证结果能赢**。
