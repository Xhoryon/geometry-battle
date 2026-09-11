# ARCHITECTURE —— 分层与边界

> 只讲**结构约束**，不讲历史。最后更新：2026-09-11。

---

## 1. 分层

```
                          ┌─────────────────────────┐
                          │   MatchEngine           │  ← 唯一判定来源
                          │   src/core/Match.ts     │
                          └───────────┬─────────────┘
                                      │ 只读查询
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   ┌────▼─────┐              ┌────────▼────────┐            ┌───────▼──────┐
   │ 终端入口  │              │  Web 服务端      │            │  测试 / 压力  │
   │ operator/│              │  src/server/     │            │  tests/      │
   │ ui/      │              │  MatchSession    │            └──────────────┘
   └──────────┘              └────────┬─────────┘
                                      │ board 投影（逐字段白名单）
                             ┌────────▼─────────┐
                             │  Web 前端         │
                             │  web/src/        │  ← 零判定，只画与点
                             └──────────────────┘
```

**要点**：终端入口与 Web 服务端是**平级**的两条入口，共用 `MatchSetupUI`
（`src/ui/MatchSetupUI.ts`）这条安装/校验/开赛链路。两份实现会慢慢分叉，
所以 Web 侧不重写它。

---

## 2. 三条硬边界

### 2.1 服务端不新增判定

`src/server/` 里每个命令都是对 `MatchEngine`（或 `MatchSetupUI`）的**一次调用**；
每个 board 字段都是引擎查询的**拷贝**。

`boards.ts` 顶部那条「快照摘要必须纯内存、无 IO」的注释同样是硬约束：
它每 100ms 被调用一次，任何文件系统访问都会变成每秒十次的哈希开销。

### 2.2 观众板是逐字段白名单

`spectatorBoard()` **显式构造每一个字段**。没被拷贝的字段浏览器根本收不到 ——
所以「大屏不泄漏开发者诊断」是**传输层的结构性事实**，不是一句人工维护的约定。

由 `tests/web-projection.ts` 钉死键集合、`tests/web-server.ts` 真跑一场后扫频道。

刻意不含：包哈希、包名、槽位目录、seed、审计、isolation、任何文件路径。

### 2.3 前端不得重新实现

**hit detection / obstacle・boundary 语义 / winner / timing / stalemate**
一项都不许在前端出现。它们只在 `MatchEngine` 里算。

两条推论：

- **可用性只来自服务端。** 按钮的 `disabled` 只读 `board.actions[].enabled`，
  阶段名只用来决定**展示哪一段**，绝不用来猜「能不能点」。
  V1.1 的裁判台正是拿 `phase === 'READY'` 去猜可用性而翻车
  （校验通过了反而开不了赛）。
- **画布只消费引擎判定出的轨迹点。** 浏览器只做 reveal 比例的逐帧揭示，
  **从不重新求值函数** —— 重新求值会画出一条穿过障碍物的曲线，
  而真实轨迹在第一次接触障碍物处就永久终止了。

---

## 3. 协议层

`src/server/protocol.ts` 是**服务端与浏览器共用**的类型与消息名。

> **它不得 import 任何 node 内置模块，也不得 import `src/core`。**
> 它会被 Vite 打进浏览器 bundle —— 一旦带上 node 依赖，前端直接构建失败。

因此 `WirePoint` / `WireObstacle` / `WirePhase` 等是核心类型的**结构镜像**，
不是重导出。镜像漂移由 `boards.ts` 顶部的**编译期断言**兜住：
真实类型一旦新增成员而镜像没跟上，`npm run typecheck` 立刻报错。

### 三条板

| 板 | 消费者 | 特征 |
|---|---|---|
| `SpectatorBoard` | `/spectator` | 逐字段白名单，**无**任何诊断 |
| `JudgeBoard extends SpectatorBoard` | `/judge` | 追加槽位、审计、运行时、`emitterSelection`、`SlotView.fileList` |
| `TeamBoard` | `/team/a` `/team/b` | 按队别裁剪；锁定前对方的选择**不在载荷里** |

`TeamBoard` 的三条硬规矩写在它的类型注释里，改它之前先读那段。

---

## 4. 沙箱与隔离

每次计算运行在独立的 `sandbox-exec` 沙箱里：默认拒绝、拒绝网络、拒绝 `fork`。

四区布局：`app/`（只读算法包）、`input/`（只读的两份 JSON，0444）、
`output/`（只写的 `result.json`）、`work/`（可写临时区，唯一可写目录）。

几处**不能动**的设计（每一条都有回归盯着）：

- 写权限只开 `file-write-data` / `file-write-create` / `file-write-unlink`，
  **`utimes` 被拒绝** —— 否则算法可以回拨结果文件的 mtime，而计时终点正是取它。
- **计时终点是结果文件自身写成的时刻**（mtime，纳秒），不是宿主轮询回调的时刻。
  轮询回调是串行的，先返回的一方会推迟后一方的读数。
- **打点在 `write('GO')` 之后**，不是之前。交付发生在这次调用的内部，
  而写入调用本身不免费；锚点取在写入之前会给先释放方白算一整个 write 耗时。
  回归在 `tests/timing-fairness.ts`。
- **START 是硬门禁**：REVEAL 之后算法进程仍被扣住，直到裁判按 START 才放行。
- **preflight 用 decoy 世界**：种子由 `matchId` 派生，与实际比赛种子无关。
  ⚠ 但 decoy 世界目前**仍沿用平台常量锚点** —— 见
  [PROJECT_STATE.md §5.1](PROJECT_STATE.md#51-preflight-不检验锚点处理陷阱已写入选手文档)。

---

## 5. 一次计算的完整时序

```
PRE-REVEAL   public_state.json 就位（含本场锚点），算法进程尚未创建
   ↓
REVEAL       reveal_state.json 生成（障碍物），算法仍未运行
   ↓  裁判按下 START（现场可停任意久，停多久都不影响公平）
START        宿主此刻才放行算法进程 → 倒计时 3-2-1 → GO → 计算
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)` 写进比赛日志与回放，
事后可用 `shasum -a 256` 独立复核。

---

## 6. 一个回合内引擎的判定顺序

1. 双方各自在自己的沙箱里算，计时从**各自**的 GO 写入时刻起算。
2. 先交出合法解的一方先开火（`TIE_EPS_MS = 0.05` 内视为同时，双方**同时**结算）。
3. 每方：从自己的锚点出发，在射击区间内求值 → 找**首次障碍物接触 / 离开场地**
   → 在此之前、且在攻击方向上、且 `|f(x_p) − y_p| ≤ 1e-6` 的对方**存活**战斗点被击杀。
4. 结算后判终止：`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`。

**`resolveOrderedShots` 里没有任何「取消」分支** —— 先手方击杀对方某个点
**不会**终止对方的进程，对方的攻击照常执行。这是 V1.1 试玩得出的结论
（速度成为胜负唯一通道），已在规则里废除。
