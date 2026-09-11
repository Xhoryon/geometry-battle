# PROJECT_STATE —— 当前有效事实

> 这份文件只记录**此刻为真的事实**，不记录过程与历史。
> 最后更新：2026-09-11（V1.2 开发中，工作树未提交）。
>
> 与它配套的还有三份：[V1.2_REQUIREMENTS.md](V1.2_REQUIREMENTS.md)（要做什么）、
> [ARCHITECTURE.md](ARCHITECTURE.md)（怎么分层）、
> [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)（怎么干活）。

---

## 1. 仓库状态

| 项 | 值 |
|---|---|
| 分支 | `feature/v1.1-ui-protocol`（**名字已过时**，内容早已是 V1.2；没有另开分支） |
| HEAD | `ecedff6` —— *feat(server): participant endpoints, tournament mode, and the judge prepare step (V1.2)* |
| 工作树 | **脏**：V1.2 的前端与测试改动**大量未提交**（`git status` 见下） |
| 版本标签 | `README.md` 已写 **V1.2 Platform**；仓库里没有 V1.2 的 git tag |
| 公开仓库 | <https://github.com/Xhoryon/geometry-battle> —— **独立脱敏导出历史**，与本地研发仓库 SHA 不互见 |

未提交的一批改动覆盖 `README.md` / `competitor-kit/*` / `src/{core,server,ui,operator}` /
`tests/*` / `web/*`。**没有一次提交**，因此 clone 或 CI 拿到的仍是 V1.1 末态。

> ⚠ 接手第一件事：确认这批改动是你预期的，然后**提交**。在此之前，
> 「V1.2 已完成」只存在于这个工作区里。

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
| 公开时机 | 第 1 轮起 | **双方都锁定之后**（之前对方在服务端载荷里根本拿不到） |
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
| 浏览器上传算法包（目录 / 文件 / ZIP） | `TeamPage.tsx`、`web/src/api/client.ts`、`web/src/api/zip.ts` | `server-team`、e2e |
| 参赛者只读浏览自己的源码 | `GET /api/team/source`、`client.ts#fetchTeamSource` | `server-team` |
| **主办方查看上传的算法源码** | `GET /api/judge/source`、`SlotView.fileList`、`JudgePage` 源码面板 | `server-team` |
| 每队自选并锁定 Fixed Emitter | `Match.ts`、`/api/team/select-emitter`、`lock-emitter` | `fixed-emitter`、`server-team`、e2e |
| 锁定前双方互相不可见 | `Match.ts` 快照置 null + `TeamBoard` 按队裁剪 | `server-team`、e2e |
| phase-driven 裁判向导 | `web/src/pages/JudgePage.tsx`（12 阶段 `STEPS`） | e2e |
| **锦标赛模式的执行门禁** | `session.ts#tournamentRejection` + `boards.ts#isBundledAlgorithm` | `server-team` |
| 观众大屏展示双方锚点 | `web/src/pages/SpectatorPage.tsx` | e2e |
| **Preflight 真的检验锚点处理** | `MapGenerator#decoyEmitters` + `LocalPreflight` | `preflight-decoy` |
| 障碍物按真几何绘制（椭圆） | `web/src/arena/projection.ts`、`ArenaCanvas.tsx` | `web-projection` |
| 参考解 v2 | `demo/reference-solver-v2/` | preflight、`server-team` |

> **浏览器验收演练 `npm run e2e` 现在是通的**（2 passed）。它此前**从未跑完过** ——
> V1.2 重写 spec 时 `clickAction` 直接点收进 `Advanced` 折叠区的按钮，
> 隐藏元素永远等不到可见性。详见 development_log 阶段 12.6。

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

**下一步的线索（已定位，未解决）**：把那一轮的输入单独喂给 `solver.py`，
它会**选出能击杀的那一枪**（`wave:A9:+1.6`，击杀 A9）；
而同一轮在实际比赛里提交的是打不中的 `wave:A9:-1.6`。
已排除：非确定性（同一输入连跑 5 次输出逐字节相同）、预算不足（`capped` 只影响多点候选）。
**同一份输入，沙箱里与沙箱外的选择不同** —— 下一个要查的就是这条。
（另：`gb_world.simulate` 的 `step` 参数只影响**场地边界**扫描，
障碍物检测固定在 160 步 —— 所以 `_verify` 的「细步长复核」并不比粗步长更细。）

### 5.3 尚未覆盖的验收面

- **ZIP 上传路径没有端到端覆盖**：`unzipToFiles` 的两个分支（`stored` / `deflate`）
  只在代码中存在，没有测试。`web/e2e` 走的是 `setInputFiles` 的普通文件路径。
- `npm run e2e` 需要系统装有 Google Chrome（配置里 `channel: 'chrome'`）。
- 终端操作台（`src/operator/`）没有锦标赛模式 —— 它是操作员显式指定
  `--a/--b` 的入口，不存在「自动落回模板」的情形，因此**刻意未加**。
- `JudgePage` 的 `emitterRows` 兜底分支在当前协议下不可达（协议里
  `emitterSelection` 是必填字段）—— 留着是为了老服务端，无害。

---

## 6. 怎么验证（按改动范围挑，不要每次都跑全量）

```bash
npm run typecheck && npm run typecheck:web     # 两端类型检查，秒级
npx ts-node tests/run-all.ts server-team       # 参赛者端 / 锦标赛门禁 / 裁判源码
npx ts-node tests/run-all.ts web-server        # HTTP + WS 端到端
npx ts-node tests/run-all.ts web-projection    # 前端投影与观众板白名单
npx ts-node tests/run-all.ts competitor-kit     # 选手文档 + examples 防漂移
npx ts-node tests/run-all.ts judge-console     # 终端裁判屏文案
npx ts-node tests/run-all.ts <suite> [...]     # 任意组合，只跑指定套件
npm test                                       # 全量 34 套件（含 timing-fairness，约 10 分钟）
npm run e2e                                    # Playwright 浏览器演练（约 15 秒，需要 Chrome）
```

`tests/run-all.ts` 在失败时**正确**地 `exit 1`。

**最近一次完整验证（2026-09-11，全部通过）：**

```text
npm run typecheck / typecheck:web   → 0 错误
npm test                            → 34/34 套件通过，exit 0
npm run e2e                         → 2 passed（真浏览器完整赛事演练，14.3s）
```

> ⚠ **不要在门禁运行期间改源码。** 每个套件是独立的 `ts-node` 进程，
> 中途落盘会让后启动的套件读到半改状态，产出「看似失败、单跑却通过」的假红。
> 要改就先停下门禁。

---

## 7. 文档地图

| 文件 | 讲什么 |
|---|---|
| `README.md` | 对外总览：规则、协议、Runtime、路由、锦标赛模式 |
| `competitor-kit/` | **面向选手**的手册（他们只读这个） |
| `docs/development_log.md` | 阶段式开发日志（**停在 V1.1 阶段 11**，无 V1.2 条目） |
| `docs/agent-context/` | **本目录** —— 给接手的 AI / 开发者的当前事实 |
| `Plans/Input/` | 人写的 Plan、规范与任务书 |
| `Plans/Output/` | 审计报告与历史交接文档（**历史**，可能与代码不符） |
| `playtest/` | 归档的试玩报告与选手包 —— `playtest/competitors/` **不要修改** |
