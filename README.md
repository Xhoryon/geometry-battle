<!-- bilingual-doc: zh-CN + en-US -->

# Geometry Battle

**An educational algorithm competition sandbox for computational geometry,
algorithm optimization, and AI-assisted programming.**

中文名：几何斗殴 · 当前版本：V1.4 Platform（中英双语界面 + 平台公平性）

**许可：PolyForm Noncommercial License 1.0.0** —— *source-available for noncommercial use*。
**这不是 OSI 认可的开源许可**，商业用途需另行授权，详见 [许可与使用范围](#许可与使用范围--license--scope)。

---

## 概述 / Overview

双方队伍各提交一个算法包，装进两个**固定槽位** `runs/slots/team-a` 与 `runs/slots/team-b`
（**运行期槽位根** = 正式投递点；仓库里的 `algorithms/` 只是出厂 fixture，见 §1）。
每个回合，平台分两阶段向双方注入**逐字节相同**的输入文件
（`public_state.json` → `reveal_state.json`），双方算法各自输出一条函数曲线 `y = f(x)`；
曲线从自己的**固定 Emitter** 出发，在射程内**严格经过对方点**即构成击杀。

判定由平台唯一的 Canonical Judge 完成，算法不得自行判定胜负。
**START 之前，参赛代码一行都不会运行**；结果只经 `output/result.json` 交付，
stdout **不是** IPC 通道 —— 见 [算法协议](#2-算法协议两阶段输入文件--argv--algorithm-protocol-two-phase-input-files--argv)。

**English.** Both teams submit one algorithm package each, installed into two permanent
slots — `runs/slots/team-a` and `runs/slots/team-b`. The **runtime slot root** is the
official delivery point; the `algorithms/` directory in the repo is only a factory
fixture (see §1). Each round the platform injects **byte-identical** input files into
both sandboxes (`public_state.json` → `reveal_state.json`), and each algorithm returns
one curve `y = f(x)`. The curve leaves that team's **Fixed Emitter** and kills an
opponent point when it passes exactly through it, within range.

Judging is done by the platform's single canonical Judge — algorithms never decide the
outcome themselves. **Not one line of contestant code runs before START**, and results
are delivered only through `output/result.json`; stdout is **not** an IPC channel
(see [the algorithm protocol](#2-算法协议两阶段输入文件--argv--algorithm-protocol-two-phase-input-files--argv)).


### V1.2 规则一览 / V1.2 rules at a glance

> **与 V1.1 的唯一规则差异**：固定 Emitter 不再是平台常量，而是**每队开赛前
> 从自己的点里选定一个**（V1.2 §一）。其余全部不变。

| 项目 | 值 |
|------|-----|
| 攻击函数 | 每回合输出一条 `y = f(x)`，必须严格经过自己的 Emitter（`\|f(x_e) − y_e\| ≤ 1e-6`） |
| 固定 Emitter | **开赛前由各队从自己的初始点里选定并锁定**，本场不变；是**数学发射锚点**，不是战斗点、不可击杀。坐标见 `public_state.emitters[team]` |
| 战斗点 | 双方各自的点位（含 `alive: false` 的死点）；对方**存活**的战斗点位于射程内且函数严格经过即击杀 |
| 障碍物 / 场地边界 | 轨迹在**首次障碍物接触**处永久终止；场地 `x ∈ [-20, 20]`、`y ∈ [-12, 12]` |
| 单次计算上限 | **500 ms**（每方从自己的 GO 写入时刻起算；另有 512 MB / 1 核 / 1 线程） |
| `STALEMATE` | 连续 **20** 个回合双方合计击杀数为 **0** → DRAW |
| `HARD_ROUND_LIMIT` | 到达第 **60** 回合（无论局面如何）→ DRAW |

四类终止方式（`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`）
覆盖全部情形，判定在引擎内部，任何入口都跑不出一场不终止的比赛 —— 见 [场地与判定](#6-场地与判定--field--judging)。

**English.** The **only** rule change from V1.1 is the Fixed Emitter: it is no longer a
platform constant but is **chosen before the match by each team from its own points**.
Everything else is unchanged.

| Item | Value |
|------|-----|
| Attack function | One `y = f(x)` per round; it must pass exactly through your own Emitter (`\|f(x_e) − y_e\| ≤ 1e-6`) |
| Fixed Emitter | Chosen and locked by each team from its own starting points **before the match**; fixed for the whole match; a **mathematical anchor**, not a combat point and not killable. Coordinates are in `public_state.emitters[team]` |
| Combat points | Each side's own points (including dead ones, `alive: false`). An opponent combat point that is **alive**, inside range, and passed exactly through by the curve is killed |
| Obstacles / boundary | The trajectory **ends permanently at first obstacle contact**; field is `x ∈ [-20, 20]`, `y ∈ [-12, 12]` |
| Compute budget | **500 ms** per side, measured from that side's own GO write; also 512 MB / 1 core / 1 thread |
| `STALEMATE` | **20** consecutive rounds with **0** kills on both sides combined → DRAW |
| `HARD_ROUND_LIMIT` | Reaching round **60** (whatever the position) → DRAW |

The four end reasons (`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` /
`HARD_ROUND_LIMIT`) cover every case; the decision is inside the engine, so no entry
point can produce a match that never terminates — see
[field & judging](#6-场地与判定--field--judging).


---

## 能力与版本 / Capabilities & versions

**中文.** 当前是 **V1.4 Platform**。四层能力叠在一起：

- **V1.1 —— 规则与判定冻结。** 两阶段输入协议（`public_state.json` → `reveal_state.json`）、
  14 个算子的 DSL 白名单、500 ms 计算预算、沙箱隔离与公平启动、四类终止保证。
- **V1.2 —— Interactive Tournament Experience。** 参赛者页（`/team/a` `/team/b`）、
  浏览器上传算法包（ZIP / 目录 / 单个 `solver.py`）、**每队开赛前自选并锁定本场的
  Fixed Emitter**、主办方在网页上查看上传的算法源码、阶段驱动的裁判向导、
  **锦标赛模式的服务端执行门禁**（平台自带算法一律不许上场）、
  以及按队别的 capability 访问令牌。
- **V1.3 —— Bilingual Localization。** 裁判台 / 参赛者页 / 观众大屏 / 回放四屏的
  中英双语界面，每屏常驻同一个语言开关（选择写入 `localStorage`，跨刷新与跨路由保持），
  以及本 README 的双语化。
- **V1.4 —— Platform Fairness · Handbook · UX Refresh。** 平台镜像公平性的永久测试
  （Level 1–6，`tests/mirror-*.ts`）与同包自战 / 先手 / 地图分布战役（结论：镜像公平 PASS，
  槽位 / 先手 / 地图偏差均 DISPROVEN，见 `docs/V1.4_FAIRNESS_REPORT.md`）；
  修复了唯一发现的平台不对称（Validator 采样网格锚点）；选手手册新增「坐标方向与镜像」
  与镜像自检工具 `check_mirror.py`；前端重构为赛事系统：首页 `/`（选择身份 + 最近比赛）、
  七步裁判向导、参赛者页四块六步与显式 LOCKED、观众记分板式大屏、回放播放器，统一状态
  设计系统与连接状态，双语 406 条文案，四种视口巡检。

**规格支持 `zh-CN` 与 `en-US` 两种语言，解析顺序是：已保存的选择 → 浏览器语言 →
兜底。** 浏览器语言是 `zh-*` 时用中文，**其余一律英文**；手动选择覆盖自动检测。

**English.** The platform is currently **V1.4**, which stacks four layers:

- **V1.1 — frozen rules and judging.** The two-phase input protocol
  (`public_state.json` → `reveal_state.json`), the 14-operator DSL whitelist, the 500 ms
  compute budget, sandbox isolation with a fair start, and the four-way termination
  guarantee.
- **V1.2 — Interactive Tournament Experience.** Participant pages (`/team/a` `/team/b`),
  browser upload of algorithm packages (ZIP / folder / a single `solver.py`), **each team
  choosing and locking this match's Fixed Emitter before the match**, the organiser
  reading uploaded source in the Web UI, a phase-driven judge wizard, a
  **server-enforced Tournament Mode** (no platform-shipped algorithm may play), and
  per-team capability access tokens.
- **V1.3 — Bilingual Localization.** Chinese and English across all four screens (judge,
  participant, spectator, replay), with one shared language switch on each screen
  (persisted to `localStorage`, surviving refresh and route changes), plus this bilingual
  README.
- **V1.4 — Platform Fairness · Handbook · UX Refresh.** Permanent mirror-fairness tests
  (Levels 1–6, `tests/mirror-*.ts`) plus same-solver self-play / first-solver / map-distribution
  campaigns (verdict: mirror fairness PASS; slot, first-solver and map bias all DISPROVEN — see
  `docs/V1.4_FAIRNESS_REPORT.md`); the one platform asymmetry found (the
  Validator's sampling-grid anchor) is fixed; the competitor handbook gains "Orientation &
  Symmetry" and the `check_mirror.py` self-check; the frontend becomes a tournament system: a
  Home page `/` (choose your role + recent matches), a seven-stage judge wizard, a four-block /
  six-step participant page with an explicit LOCKED state, a scoreboard-style spectator screen,
  a replay player, one status design system and connection-state model, 406 bilingual strings
  per locale, and a four-viewport sweep.

**Exactly two locales are supported, `zh-CN` and `en-US`, resolved in this order: saved
choice → browser language → fallback.** A `zh-*` browser gets Chinese; **everything else
gets English**; a manual choice overrides automatic detection.

---

## 快速开始 / Quick Start

### 1. 算法包结构（固定槽位 + 固定入口） / Algorithm package structure (fixed slots, fixed entry)

算法包投放进两个**永久存在**的槽位。**正式投递点是运行期槽位根**：

```
runs/slots/                     ← 运行期槽位根（正式投递点；被 .gitignore 忽略）
├── team-a/                     → Team A Algorithm Slot
│   └── solver.py               # 唯一正式入口（必须存在）
├── team-b/                     → Team B Algorithm Slot
│   └── solver.py
├── .staging/                   # 上传暂存区，不属于算法包
└── .slots/                     # 槽位元数据，不属于算法包
```

> **为什么不是 `algorithms/`。** 安装流水线会用 rename **整体替换** `team-a` / `team-b`。
> 若直接对着 `algorithms/` 操作，一场正规比赛就会改写**受 git 跟踪**的文件
> （工作区变脏，甚至可能把选手算法误提交进仓库）。
> 因此：
>
> - `algorithms/team-a|b` 是**出厂 fixture**（受跟踪、只读语义）。首次启动时，
>   运行期槽位根若为空会从它**播种一次**；之后**再也不看它** —— 改
>   `algorithms/` 不会改变比赛用的算法。
> - 入口（`npm run app` / `npm run judge` / `npm run operator`）默认都用
>   `runs/slots`，可以用 `--slots <dir>` 换。裁判台顶部的两张队伍卡会显示
>   **算法名 + 密封哈希（短形式）+ 来源状态 + Preflight + Emitter 锁定 + 计算状态**，
>   文件清单与源码在「审计 · 源码核对」里逐个可读；界面**不显示**任何服务端绝对路径。

- **入口被冻结为包根目录的 `solver.py`**：`main.py` / `run.py` / `my_solver.py`
  都不再被接受，平台**不读取** `manifest.entry` 来决定执行什么。
- 允许携带自己的内部模块与子目录（`optimizer.py`、`utils/`…）。
- `manifest.json` 现在是**可选**元数据（名称 / 版本 / 语言）。若写了 `entry`，
  只允许写 `solver.py`，写成别的会被明确拒绝（不静默忽略）。

**manifest.json（可选）：**

```json
{
  "name": "My Team",
  "version": "1.0.0",
  "entry": "solver.py",
  "language": "python"
}
```

包的限制：

| 项目 | 限制 |
|------|------|
| 单包体积 | ≤ 8 MB |
| 文件数 | ≤ 256 |
| 允许的扩展名 | `.py` `.json` `.txt` `.md` `.csv` `.yaml` `.yml` |
| 符号链接 | 不允许 |
| 入口 | **固定为包根目录的 `solver.py`** |

**上传与替换（非破坏性）：**

```
Upload → staging → validate → preflight → hash → seal → replace
```

赛事方**不会**把压缩包直接解压到槽位。任何一步失败（结构非法、跑不起来、
输出不合法），现有槽位**一个字节都不会变**，坏包只停留在 `<槽位根>/.staging/`。
槽位元数据（安装时间、包哈希、preflight 结论、上传来源）写在 `<槽位根>/.slots/`，
它**不属于算法包**，不进包哈希、也不会被复制进沙箱。
（正式比赛里 `<槽位根>` = `runs/slots`，见上。）

**English.** A package goes into one of two **permanent** slots. The official delivery
point is the **runtime slot root** (`runs/slots/`, git-ignored); the entry point is
frozen to `solver.py` at the package root — `main.py`, `run.py` or `my_solver.py` are
no longer accepted, and the platform does **not** read `manifest.entry` to decide what
to run. Internal modules and subdirectories (`optimizer.py`, `utils/`…) are allowed.
`manifest.json` is **optional** metadata; if you write `entry`, the only accepted value
is `solver.py` — anything else is rejected explicitly rather than silently ignored.

> **Why not `algorithms/`?** The install pipeline replaces `team-a` / `team-b` wholesale
> via rename. Operating on `algorithms/` would mean a real match rewrites
> **git-tracked** files. So `algorithms/team-a|b` is a tracked, read-only **factory
> fixture**: the runtime slot root is seeded from it once on first start and never
> consulted again. Changing `algorithms/` will not change the algorithm a match runs.

Package limits and the non-destructive upload pipeline:

| Item | Limit |
|------|-------|
| Package size | ≤ 8 MB |
| File count | ≤ 256 |
| Allowed extensions | `.py` `.json` `.txt` `.md` `.csv` `.yaml` `.yml` |
| Symlinks | Not allowed |
| Entry | **`solver.py` at the package root** |

```
Upload → staging → validate → preflight → hash → seal → replace
```

The organiser never unpacks an archive straight into a slot. If any step fails
(bad structure, won't run, illegal output) the existing slot does not change by a
single byte; the bad package stays in `<slot root>/.staging/`. Slot metadata (install
time, package hash, preflight result, upload source) lives in `<slot root>/.slots/`,
which is **not part of the package** — it is excluded from the package hash and is never
copied into a sandbox.


### 2. 算法协议（两阶段输入文件 + argv） / Algorithm protocol (two-phase input files + argv)

平台不再把状态写进 stdin。每个回合，宿主以如下 argv 启动算法进程（**四个参数固定**）：

```
python3 solver.py --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```

**队别只经 `--team A|B` 传递**；两份 JSON 对 A、B **逐字节相同**，双方可各自 `sha256` 复核。
除 `--team` 的取值外，文件名、参数顺序、Runtime、输入输出格式对双方完全一致。

算法把结果**只写进 `--output` 指定的文件**：

```json
{"schema_version": "1.1", "dsl": {"type": "add", "args": [...]}}
```

`dsl` 可以是 AST 对象，也可以是 AST 的 JSON 字符串。结果文件的约束：

| 约束 | 说明 |
|------|------|
| 只允许两个键 | `schema_version`（必须是 `"1.1"`）与 `dsl`；`hits` / `winner` / `computeTime` 之类一律非法 |
| 原子写 | 先写 `result.json.tmp`，`flush` + `fsync` 后原子 `rename` 成 `result.json` |
| deadline | 500 ms 内形成完整合法文件 → 接收；否则 TIMEOUT |
| ONE OUTPUT ONLY | 每回合只接收一次结果，不能重新提交 |
| stdout | **不是**结果通道，仅被捕获/限长/留档 |
| stderr | 允许有限 debug log，有大小限制，不参与判定 |

SDK 模板见 [`starter/solver.py`](starter/solver.py)（含 `emit()` 原子写实现）。

**输入分两次交付（V1.1 两阶段协议）：**

| 阶段 | 文件 | 内容 |
|------|------|------|
| PRE-REVEAL | `public_state.json` | 轮次、场地、**双方的固定 Emitter 坐标**、**双方全部点**（含 `alive: false` 的死点）；**不含**障碍物、地图种子 |
| REVEAL | `reveal_state.json` | 增量：障碍物、以及 `public_state_sha256` |

`public_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"map":{"xmin":-20,"xmax":20,"ymin":-12,"ymax":12},"emitters":{"A":{"x":-18,"y":0},"B":{"x":18,"y":0}},"points":[{"id":"A1","team":"A","x":-14,"y":6,"alive":true},{"id":"A2","team":"A","x":-10,"y":-3,"alive":false}]}
```

`reveal_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"public_state_sha256":"92fa…","obstacles":[{"id":"O1","type":"rectangle","xmin":-1,"xmax":2,"ymin":-5,"ymax":1},{"id":"O2","type":"circle","cx":4,"cy":3,"radius":2}]}
```

> **V1.2 §一：锚点由各队自选，不再是平台常量，也不再是每轮选出的「Shooter」。**
> 开赛前，双方各自从**自己的初始点**里选一个并锁定；锁定之后它**整场不变**、
> 不可击杀、不计入存活数、也不是胜利目标 —— 它只是攻击函数的**数学发射锚点**，
> 不是战斗点，因此**不在 `points` 里**（被选中的那个点会从 `points` 中被移除）。
>
> 双方**都锁定之后**，两个坐标才公开：`public_state.json` 的 `emitters` 从这里开始
> 每一轮都是同一对坐标。在此之前，**没有你那一队令牌的调用方在服务端载荷里根本拿不到**
> 你的选择 —— 不是前端藏起来，是服务端不发（见下面「访问令牌」）。
> `reveal_state.json` 里**没有**、也不会有 `shooters` 字段。

**绑定自检（建议选手在入口处照抄）：**

```python
import hashlib
assert hashlib.sha256(open(a.public, "rb").read()).hexdigest() == reveal["public_state_sha256"]
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)`（两个十六进制串拼接后再哈希）
写入比赛日志与回放，可事后独立复核；两份文件的确切字节即 `sha256` 字段值，可用 `shasum -a 256` 验证。

**三段式节奏（公平性关键）：**

```
PRE-REVEAL   public_state.json 就位（含固定 Emitter），算法进程尚未创建
   ↓
REVEAL       reveal_state.json 生成（障碍物），算法仍未运行
   ↓  裁判按下 START（现场可停任意久，停多久都不影响公平）
START        宿主此刻才放行算法进程 → 倒计时 3-2-1 → GO → 计算
```

**每轮不再有人工选点、也没有 SHOOTER LOCK**：锚点在开赛前一次性选定并锁定，
之后整场固定，PUBLIC 阶段双方拿到的就是同一对 Emitter 坐标。

计时从**各自** GO 写入时刻起算。

> **Preflight 用的是 decoy 锚点。** 赛前那次沙箱冒烟跑的是一个与本场比赛无关的
> decoy 世界，它下发的锚点取自 **decoy 地图上双方各自的第一个点** —— 与正赛一样
> 是逐场不同的坐标，不是平台常量。因此一个**写死坐标**的算法会在 Preflight
> 就被拦下（`NOT_THROUGH_SHOOTER`），不会拖到正赛。本地自检工具同此规则。

**最小可运行示例（官方 starter 的简化版）：**

```python
import argparse, hashlib, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True, choices=["A", "B"])
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
ap.add_argument("--output", required=True)
a = ap.parse_args()

raw = open(a.public, "rb").read()
public = json.loads(raw.decode("utf-8"))
reveal = json.load(open(a.reveal))
assert hashlib.sha256(raw).hexdigest() == reveal["public_state_sha256"]  # 绑定自检
```

**English.** The platform no longer writes state to stdin. Each round the host starts
the algorithm process with exactly four arguments:

```
python3 solver.py --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```

**Team identity travels only through `--team A|B`.** The two JSON files are
**byte-identical** for A and B, so either side can verify them with `sha256`
independently. Apart from the value of `--team`, filenames, argument order, runtime and
I/O format are identical for both sides.

The algorithm writes its result **only** to the file given by `--output`:

```json
{"schema_version": "1.1", "dsl": {"type": "add", "args": [...]}}
```

`dsl` may be an AST object or a JSON string of one. Result-file constraints:

| Constraint | Meaning |
|------|------|
| Exactly two keys | `schema_version` (must be `"1.1"`) and `dsl`; `hits` / `winner` / `computeTime` and the like are all illegal |
| Atomic write | Write `result.json.tmp`, `flush` + `fsync`, then atomically `rename` to `result.json` |
| Deadline | A complete, legal file within 500 ms is accepted; otherwise TIMEOUT |
| ONE OUTPUT ONLY | One result per round — you cannot resubmit |
| stdout | **Not** a result channel; it is captured, length-capped and archived only |
| stderr | Limited debug logging allowed; length-capped, never part of judging |

Input is delivered in two phases:

| Phase | File | Contents |
|------|------|------|
| PRE-REVEAL | `public_state.json` | Round, field, **both teams' Fixed Emitter coordinates**, **all points on both sides** (including `alive: false` dead ones); **no** obstacles, no map seed |
| REVEAL | `reveal_state.json` | Delta: the obstacles, plus `public_state_sha256` |

> **V1.2 §1: the anchor is chosen by each team, not a platform constant, and not a
> per-round "Shooter".** Before the match each side picks one of **its own starting
> points** and locks it. Once locked it is **fixed for the whole match**, cannot be
> killed, is not counted in alive totals and is not a win condition — it is only the
> **mathematical anchor** of the attack function, not a combat point, and therefore
> **not in `points`** (the chosen point is removed from `points`).
>
> Both coordinates become public only **after both sides have locked**; from then on
> `public_state.json`'s `emitters` holds the same pair every round. Before that, a
> caller **without that team's token cannot obtain your choice from the server at all**
> — it is not hidden by the frontend, the server does not send it (see
> [access tokens](#访问令牌v12每场轮换--access-tokens-v12-rotated-every-match)). There is no `shooters`
> field in `reveal_state.json`, and there never will be.

Binding self-check (worth copying into your entry point):

```python
import hashlib
assert hashlib.sha256(open(a.public, "rb").read()).hexdigest() == reveal["public_state_sha256"]
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)` (concatenate the two hex
strings, then hash) is written into the match log and the replay, so it can be
re-verified independently afterwards; the exact bytes of the two files are the `sha256`
field values and can be checked with `shasum -a 256`.

**Three-phase rhythm (this is what makes it fair):**

```
PRE-REVEAL   public_state.json in place (with the Fixed Emitter); no process created
   ↓
REVEAL       reveal_state.json produced (obstacles); the algorithm still is not running
   ↓  the judge presses START (it may sit here as long as it likes — no effect on fairness)
START        only now does the host release the process → 3-2-1 countdown → GO → compute
```

There is no per-round manual point selection and no SHOOTER LOCK: the anchor is chosen
and locked once before the match and then fixed. Timing is measured from **each side's
own** GO write.

> **Preflight uses decoy anchors.** The pre-match sandbox smoke run uses a decoy world
> unrelated to this match, and the anchors it hands out come from **the first point of
> each side on the decoy map** — per-match coordinates, not platform constants. An
> algorithm with **hard-coded coordinates** is therefore stopped at Preflight
> (`NOT_THROUGH_SHOOTER`) instead of failing in the real match. The local self-check
> tool follows the same rule.


```python
# Emitter 是**本场选定**的（逐场不同），必须从 public 里读，不要写死坐标
s = public["emitters"][a.team]
enemies = [p for p in public["points"] if p["team"] != a.team and p["alive"]]
t = enemies[0]

# f(x) = y_e + m·(x - x_e)：严格经过自己的 Emitter，且是 C^∞ 的
m = 0.0 if abs(t["x"] - s["x"]) < 1e-6 else (t["y"] - s["y"]) / (t["x"] - s["x"])

dsl = {
    "type": "add",
    "args": [
        {"type": "number", "value": s["y"]},
        {"type": "mul", "args": [
            {"type": "number", "value": m},
            {"type": "sub", "args": [{"type": "variable", "value": "x"},
                                     {"type": "number", "value": s["x"]}]},
        ]},
    ],
}

# 唯一的正式输出通道：tmp + 原子 rename（stdout 不是 IPC）
tmp = a.output + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump({"schema_version": "1.1", "dsl": dsl}, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, a.output)
```

完整可运行版本见 [`starter/solver.py`](starter/solver.py)。

### 3. DSL 白名单 / DSL whitelist

**允许的运算符（全部，共 14 个）：**

| 类别 | 运算符 |
|------|--------|
| 叶子 | `number`（`value` 为数值）、`variable`（`value` 必须是 `"x"`） |
| 二元 | `add` `sub` `mul` `div` `pow` |
| 一元 | `neg` `sin` `cos` `tan` `sqrt` `log` `exp` |

**禁止：** `if` / `else` / `switch` / `?:`、`min` / `max` / `floor` / `ceil` / `round` /
`sign` / `abs` / `step` / `Heaviside`，以及任何布尔与比较运算。

> 之所以禁止 `abs`/`min`/`max`，是因为它们可以在一点处制造不可导的折角，
> 破坏 C² 连续性假设，也让「凸性变化次数」失去意义。

**English.** Fourteen operators in total:

| Kind | Operators |
|------|--------|
| Leaves | `number` (`value` is numeric), `variable` (`value` must be `"x"`) |
| Binary | `add` `sub` `mul` `div` `pow` |
| Unary | `neg` `sin` `cos` `tan` `sqrt` `log` `exp` |

**Forbidden:** `if` / `else` / `switch` / `?:`, `min` / `max` / `floor` / `ceil` /
`round` / `sign` / `abs` / `step` / `Heaviside`, and any boolean or comparison
operation.

> `abs` / `min` / `max` are forbidden because they can create a non-differentiable
> corner at a point, breaking the C² continuity assumption and making "number of
> convexity sign changes" meaningless.


### 4. 限制规则 / Limits

| 限制 | 值 |
|------|-----|
| AST 节点数 | ≤ 128 |
| AST 深度 | ≤ 12 |
| 常量绝对值 | ≤ 1000 |
| 凸性变号次数（射击区间内） | ≤ 100 |
| 抗混叠采样预算 | ≤ 400,000 点 |
| 单次计算超时 | **500 ms**（每方从自己的 GO 写入时刻起算） |
| 内存上限 | 512 MB |
| CPU / 线程 | 1 核 / 1 线程（`OMP_NUM_THREADS` 等全部钉死为 1） |
| stdout 上限 | 256 KB |
| stderr 上限 | 64 KB |

**函数硬性要求：** 必须经过自己的**固定 Emitter**（`|f(x_e) − y_e| ≤ 1e-6`，`ε = HIT_EPSILON`），
在射击区间内有限、连续、C²。`x_e` / `y_e` 是**本场选定**的锚点坐标，逐场不同 ——
从 `public_state.emitters[team]` 读，不要写死任何数值。
射击区间随之从锚点起算：A 为 `x ∈ [x_e, 20]`、B 为 `x ∈ [-20, x_e]`。
（注意：这里的 1e-6 与「命中判定」的 1e-6 是两个**不同**概念，不要混用。）

**English.**

| Limit | Value |
|------|-----|
| AST nodes | ≤ 128 |
| AST depth | ≤ 12 |
| Constant magnitude | ≤ 1000 |
| Convexity sign changes (within the firing interval) | ≤ 100 |
| Anti-aliasing sample budget | ≤ 400,000 points |
| Compute timeout | **500 ms** (each side, from its own GO write) |
| Memory | 512 MB |
| CPU / threads | 1 core / 1 thread (`OMP_NUM_THREADS` etc. all pinned to 1) |
| stdout | 256 KB |
| stderr | 64 KB |

**Hard function requirements:** the curve must pass through your **Fixed Emitter**
(`|f(x_e) − y_e| ≤ 1e-6`, `ε = HIT_EPSILON`) and be finite, continuous and C² over the
firing interval. `x_e` / `y_e` are the **per-match chosen** anchor coordinates — read
them from `public_state.emitters[team]`, never hard-code them. The firing interval
starts at the anchor: A is `x ∈ [x_e, 20]`, B is `x ∈ [-20, x_e]`.
(Note: this 1e-6 and the 1e-6 in hit detection are two **different** things.)


### 5. 固定 Runtime（双方完全相同） / Frozen runtime (identical for both sides)

正式比赛冻结统一 Runtime，双方环境逐项一致：

| 项目 | 冻结值 |
|------|--------|
| 解释器 | CPython 3.9.6（`/usr/bin/python3`） |
| 第三方包 | **NONE**（只有标准库；`numpy` / `scipy` / `sympy` 等一律不可用） |
| CPU 配额 | 1 核 |
| 内存配额 | 512 MB |
| 线程上限 | 1（`OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS` / `NUMEXPR_NUM_THREADS` / `VECLIB_MAXIMUM_THREADS`） |
| 超时 | 500 ms |

冻结清单的唯一来源是 [`src/submission/Runtime.ts`](src/submission/Runtime.ts) 的 `FROZEN_RUNTIME`。
开赛时平台会**实测**宿主解释器并与清单比对，结果写入审计日志（`RuntimeFrozen` 事件）；
不一致不会阻断比赛，但会如实记录，供人工核对。

> **为什么是「无第三方包」**：沙箱 `scrubEnv` 设置 `PYTHONNOUSERSITE=1`，且 SBPL 拒绝读取
> `/Users`，所以开发机用户级 site-packages 里的 `numpy` / `scipy` 在沙箱内**无法 import**。
> 早期文档曾把宿主探测到的 `numpy 2.0.2` / `scipy 1.13.1` 写成冻结依赖，那是**宿主观测**，
> 会诱导参赛者写出必然 `ModuleNotFoundError` 的算法，已修正。
> 沙箱内可用模块的权威清单是 [`competitor-kit/RUNTIME_MANIFEST.md`](competitor-kit/RUNTIME_MANIFEST.md)，
> 由 `tests/runtime-manifest.ts` 在真实沙箱里逐条验证。

线程数被钉死为 1 是公平性要求：默认情况下 BLAS/OpenMP 会吃满所有核，
「谁的机器核多」就会变成计时优势。

**English.** A real match freezes one runtime, item by item identical for both sides:

| Item | Frozen value |
|------|--------|
| Interpreter | CPython 3.9.6 (`/usr/bin/python3`) |
| Third-party packages | **NONE** (standard library only; `numpy` / `scipy` / `sympy` are simply unavailable) |
| CPU quota | 1 core |
| Memory quota | 512 MB |
| Thread cap | 1 (`OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS` / `NUMEXPR_NUM_THREADS` / `VECLIB_MAXIMUM_THREADS`) |
| Timeout | 500 ms |

The single source of truth for this list is `FROZEN_RUNTIME` in
`src/submission/Runtime.ts`. At match start the platform **measures** the host
interpreter and compares it with the list; the result goes into the audit log (a
`RuntimeFrozen` event). A mismatch does not block the match — it is recorded honestly
for human review.

> **Why "no third-party packages":** the sandbox's `scrubEnv` sets
> `PYTHONNOUSERSITE=1`, and SBPL denies reading `/Users`, so a user-level `numpy` /
> `scipy` on the development machine **cannot be imported** inside the sandbox.
> Early documentation listed the host's `numpy 2.0.2` / `scipy 1.13.1` as frozen
> dependencies — but those packages are **unavailable** inside the sandbox. That was a
> **host observation**, and it would have led contestants to write algorithms that must
> fail with `ModuleNotFoundError`. It has been corrected. The
> authoritative list of modules available inside the sandbox is
> `competitor-kit/RUNTIME_MANIFEST.md`, verified item by item in a real sandbox by
> `tests/runtime-manifest.ts`.

The thread cap is a fairness requirement: by default BLAS/OpenMP saturate every core,
and "whose machine has more cores" would become a timing advantage.


### 6. 场地与判定 / Field & judging

- 场地：`x ∈ [-20, 20]`，`y ∈ [-12, 12]`
- 队伍区域：A 队 `x ∈ [-20, -4]`，B 队 `x ∈ [4, 20]`
- 攻击方向：A 向 `+x`，B 向 `-x`
- **遍历方向**：判定沿攻击方向遍历函数图像 —— A 从 `x_e` 向 `x = 20`（x 增大），B 从 `x_e` 向 `x = -20`（x 减小）；遍历区间即有效攻击范围，函数合法性只在这段上校验。「首次接触之前」是相对遍历方向而言的：对 B 来说「之前」= x 更大的一侧
- **数组顺序**：`points` 先列 A 队再列 B 队，组内按生成顺序，整场每轮相同；死点留在原位（`alive: false`），被锁定为 Emitter 的两个点被移除且**不重新编号**（`A1` 可能不存在）；`obstacles` 为 `O1..On` 生成顺序、整场不变。**不要假设数组顺序代表几何顺序**（不按 x、不按距离排序）
- **两侧兼容**：同一正式提交必须能够在 Team A 与 Team B 两侧正确运行。自检：`python3 competitor-kit/tools/validate_submission.py <目录>`（与官方 Preflight 同一份判定代码，A、B 各跑一次）与 `python3 competitor-kit/tools/check_mirror.py <目录>`（镜像一致性 —— 开发诊断，官方 Preflight 不运行）
- **命中**：`|f(x_p) − y_p| ≤ 1e-6`，且该点位于攻击方向上、且位于**首次障碍物接触之前**
- **障碍物**：轨迹在第一次与任何障碍物接触处终止；接触点之前的点可被击杀，接触点及其之后的点不受影响
- **先手**：先输出合法解的一方先开火，后手随后开火
- **锁定攻击权**：START 之后双方各获得一次本轮独立且不可撤销的攻击权。固定 Emitter 只是攻击函数的**数学发射锚点**，它**不会死**（不在 `points` 里），函数仍必须满足 `f(x_e) = y_e`。攻击不执行的唯一原因是 `TIMEOUT` / `INVALID` / `CRASH`。
- **同归于尽**：若某一轮结束后双方存活数同时归零，判 **DRAW**（`endReason = MUTUAL_ELIMINATION`），不得因为谁是先手就把胜利判给先手方

**终止保证（Rule Revision 3 §17）：四类结束方式覆盖全部情形，任何合法比赛都在有限时间内终止。**
终止判定落在引擎内部，不是调用方可选的参数 —— 因此任何入口（终端裁判台、Web UI）
都跑不出一场不终止的比赛。

| 终止原因 | 触发条件 | 结果 |
|---|---|---|
| `ELIMINATION` | 一方存活数归零、另一方仍有存活 | 幸存方获胜 |
| `MUTUAL_ELIMINATION` | 同一轮结束后双方同时归零 | DRAW |
| `STALEMATE` | **连续 20 个回合双方合计击杀数为 0** | DRAW |
| `HARD_ROUND_LIMIT` | 到达**第 60 回合**（无论局面如何） | DRAW |

僵持计数器按**击杀**归零，不看命中、也不看谁先手：双方都交了合法解但谁也打不中，
同样计入僵持。判和就是判和 —— 平台没有任何隐藏评分或 tiebreak。

**English.**

- Field: `x ∈ [-20, 20]`, `y ∈ [-12, 12]`
- Team zones: A `x ∈ [-20, -4]`, B `x ∈ [4, 20]`
- Attack direction: A toward `+x`, B toward `-x`
- **Traversal direction:** the Judge walks the graph in the attack direction — A from `x_e` towards `x = 20` (increasing x), B from `x_e` towards `x = -20` (decreasing x); that interval is the firing domain and function legality is checked only there. "Before the first contact" is direction-relative: for B, "before" means larger x
- **Array order:** `points` lists Team A first, then Team B, each in generation order, identical every round; dead points stay in place (`alive: false`), the two points locked as Emitters are removed and ids are **not renumbered** (`A1` may be absent); `obstacles` are `O1..On` in generation order and never change. **Do not assume array order is geometric order** (not sorted by x or by distance)
- **Both sides:** the same formal submission MUST run correctly as Team A and as Team B. Self-check with `python3 competitor-kit/tools/validate_submission.py <dir>` (the same judging code as the official Preflight, run once per team) and `python3 competitor-kit/tools/check_mirror.py <dir>` (mirror consistency — a development diagnostic the official Preflight does not run)
- **Hit:** `|f(x_p) − y_p| ≤ 1e-6`, the point is in the attack direction, and it lies **before the first obstacle contact**
- **Obstacles:** the trajectory ends at the first contact with any obstacle; points before the contact can be killed, the contact point and everything after it are unaffected
- **First mover:** whichever side returns a legal solution first fires first; the other fires afterwards
- **Locked attack right:** after START each side gets one independent, irrevocable attack for the round. The Fixed Emitter is only the **mathematical anchor** of the attack function; it **never dies** (it is not in `points`) and the function must still satisfy `f(x_e) = y_e`. The only reasons an attack does not execute are `TIMEOUT` / `INVALID` / `CRASH`.
- **Mutual destruction:** if both sides reach zero alive at the end of the same round it is a **DRAW** (`endReason = MUTUAL_ELIMINATION`) — being the first mover must not hand you the win

**Termination guarantee: the four end reasons cover every case, so every legal match
ends in finite time.** The decision lives inside the engine and is not a caller-supplied
option — therefore no entry point (terminal judge console, Web UI) can produce a match
that never terminates.

| End reason | Trigger | Result |
|---|---|---|
| `ELIMINATION` | One side reaches zero alive while the other still has points | Survivor wins |
| `MUTUAL_ELIMINATION` | Both sides reach zero at the end of the same round | DRAW |
| `STALEMATE` | **20 consecutive rounds with 0 kills on both sides combined** | DRAW |
| `HARD_ROUND_LIMIT` | Reaching **round 60** (whatever the position) | DRAW |

The stalemate counter resets on **kills** — not on hits, and not on who moved first:
both sides submitting legal solutions that hit nothing still counts as stalemate.
A draw is a draw — the platform has no hidden scoring and no tiebreak.


---

## 运行 / Running

### 本地 Web UI（推荐） / Local Web UI (recommended)

```bash
npm install
npm run app          # 构建前端 → 起服务 → 绑定 127.0.0.1:17800 → 自动开浏览器
```

打开后：

| 路由 | 需要令牌 | 用途 |
|---|---|---|
| `/` | 否 | **首页**（V1.4）：选择身份（裁判 / Team A / Team B / 观众）+ 最近比赛列表。裁判与参赛者入口提示需要本场访问链接（可粘贴链接或令牌，只经 URL fragment 导航，不存储、不进查询串）；**入口可见 ≠ 已授权** |
| `/team/a` `/team/b` | **是**（该队的） | **参赛者页**：四块（算法包 / 源码 / Emitter / 状态）、六步（上传 → 校验 → Preflight → 选择 → 锁定 → 等待开赛）；上传 ZIP / 目录 / 单个 `solver.py` → 只读浏览自己的源码 → 从自己的点里选定并锁定本场 Fixed Emitter，锁定后显式 **LOCKED · 本场比赛中不可更改** |
| `/judge` | **是**（裁判的） | 裁判台（七步 phase-driven 向导：比赛筹备 → 算法就绪 → 锚点锁定 → 就绪 → 揭晓 → 进行中 → 终局）：每一步只有一个主动作，其余收在 Advanced；终局主位置是「本场回放」，**换场 / 重置需两步确认**（会清除双方 Emitter 锁定并更换 matchId 与参赛者链接）。可查看双方上传的算法源码 |
| `/spectator` | 否 | 观众大屏（记分板式：Team A 存活 · 锚点 │ 回合 · 阶段 │ Team B 存活 · 锚点；竞技场居中；页脚 A 计算 │ 先手 │ B 计算；终局横带 TEAM X WINS / DRAW · 原因 · ROUND N 不遮挡最后一帧）。**只读**，除语言开关外无任何按钮，无任何诊断信息 |
| `/replays` | 否 | 已结束比赛的列表（胜者 / 终局原因 / 回合数 / 结束时间），点进回放 |
| `/replay/:matchId` | 否 | 回放播放器：上一轮 / 播放·暂停 / 下一轮 / 第 N / 共 M 轮 / 时间轴 / 0.5× 1× 2×（只改动画速度）；用已落盘的 match/replay 重放，**不重新运行任何算法、不重算函数、不重新裁判** |

**English.** No terminal needed for the normal flow.

| Route | Token | Purpose |
|---|---|---|
| `/` | No | **Home** (V1.4): choose your role (Judge / Team A / Team B / Spectator) + recent matches. The judge and team cards say an access link is required (paste a link or token — it navigates via the URL fragment only, is never stored and never enters the query string); **navigation visibility ≠ authorization** |
| `/team/a` `/team/b` | **Yes** (that team's) | **Participant page**: four blocks (Algorithm / Source / Emitter / Status), six steps (Upload → Validate → Preflight → Pick → Lock → Wait for start); upload ZIP / folder / a single `solver.py` → read-only browse of your own source → pick and lock this match's Fixed Emitter; after locking the block reads **LOCKED · cannot be changed for this match** |
| `/judge` | **Yes** (the judge's) | Judge console (seven-stage phase-driven wizard: Match Setup → Algorithm Ready → Emitter Lock → Ready → Reveal → Running → Match End): exactly one primary action per stage, everything else under Advanced; at Match End the primary control is "This match's replay", and **reset / new match needs a two-step confirm** (it clears both Emitter locks and rotates the matchId and participant links). The uploaded source can be read here |
| `/spectator` | No | Spectator screen (scoreboard layout: Team A alive · Emitter │ Round · phase │ Team B alive · Emitter; arena centred; footer A compute │ first solver │ B compute; a terminal band TEAM X WINS / DRAW · reason · ROUND N that never covers the last frame). **Read-only**, no button other than the language switch, no diagnostics at all |
| `/replays` | No | List of finished matches (winner / end reason / rounds / ended at), linking into replays |
| `/replay/:matchId` | No | Replay player: previous / play·pause / next / Round N of M / timeline / 0.5× 1× 2× (animation speed only); replays the stored match/replay **without re-running any algorithm, recomputing any function or re-judging** |


### 访问令牌（V1.2，每场轮换） / Access tokens (V1.2, rotated every match)

`/judge` 与 `/team/*` 都要求一个访问令牌。它**不是账号密码**，而是 capability：
**谁拿到，谁就能行使那一面的权限。**

| 面 | 令牌 |
|---|---|
| 裁判台 | **裁判令牌**（进程生命周期；跟着每场轮换会让裁判按一次 new-match 就锁死自己开着的页面） |
| 参赛者页 | **该队**的令牌，由 `HMAC(裁判令牌, matchId + 队别)` 派生 —— **每场自动失效**，上一场的人不该继续持有下一场的访问权 |

怎么用：

1. `npm run app` 启动后，**终端会打印裁判台链接**（形如
   `http://127.0.0.1:17800/judge#t=…`），并自动打开它。令牌在 URL 的 **fragment**
   里 —— fragment 不发给服务端，所以它不进请求行、不进 `Referer`、不进日志。
2. 裁判台侧栏的**「参赛者入口」**面板给出两条可复制链接（`/team/a#t=…`、
   `/team/b#t=…`）。把对应那条发给各队。
3. **每开新的一场这两条链接都会更新**，旧链接立即失效；队伍页会明确提示
   「本场令牌已失效」，并说明去要新链接（不会无休止地重连）。

> ⚠ **裁判台链接不要外传。** 裁判板合法地同时显示双方的选择 —— 拿着裁判令牌
> 等于同时拿到两队的权限，也能下达揭晓 / START / 重置 / 安装。
> 它是给**组织者**的，不是给选手的。

裁判台的**正式主流程是「使用槽位算法」** —— 选手把算法投进**运行期槽位**
`runs/slots/team-a|team-b` 之后，裁判点两下就能开赛，不需要知道任何文件路径。
`/judge` 顶部的两张队伍卡会写出**算法名、密封哈希（短形式）、来源状态、Preflight、
Emitter 锁定与计算状态**，投的是不是选手那份，一眼可对；「审计 · 源码核对」里的文件清单
可以逐一点开**直接看源码**。界面上**没有**任何服务端绝对路径。

换算法有两条路：往运行期槽位根投递（正式流程），或在
`Advanced · 替换算法与比赛设置` 里填**服务端**上的目录绝对路径（临时换）。
两条路都写的是同一处。

> 往仓库里的 `algorithms/` 投算法**不会**影响比赛 —— 它只是出厂 fixture。

**English.** `/judge` and `/team/*` both require an access token. It is **not a
username/password** — it is a capability: **whoever holds it can act as that side.**

| Surface | Token |
|---|---|
| Judge console | **Judge token** — process lifetime. Rotating it every match would lock the organiser out of their own open page after one new-match |
| Participant page | **That team's** token, derived as `HMAC(judge token, matchId + team)`. It **expires every match**, because the previous match's people should not keep access to the next one |

How to use it:

1. After `npm run app`, the **terminal prints the judge link** (like
   `http://127.0.0.1:17800/judge#t=…`) and opens it. The token sits in the URL
   **fragment**, which is not sent to the server — so it never reaches the request
   line, the `Referer`, or any log.
2. The judge console's **"Participant entry"** panel gives two copyable links
   (`/team/a#t=…`, `/team/b#t=…`). Send each team its own.
3. **Both links are reissued for every new match** and the old ones stop working
   immediately. The participant page says so plainly ("this match's token is no longer
   valid") and tells the player to ask for a new link — it does not reconnect forever.

> ⚠ **Do not share the judge link.** The judge board legitimately shows both sides'
> choices, so holding the judge token means holding both teams' authority plus the
> ability to issue reveal / START / reset / install. It is for the **organiser**, not
> for players.

The judge console's **main flow is "use the algorithm in the slot"**: once players have
delivered to the **runtime slots** `runs/slots/team-a|team-b`, the judge starts a match
in two clicks without knowing any file path. The two team cards at the top of `/judge`
show the **algorithm name, sealed hash (short form), source status, Preflight, Emitter
lock and compute state**, so "is this the players' package?" is answerable at a glance;
the file list under "Audit · Source review" can be opened file by file to **read the
source directly**. No server absolute path is shown anywhere in the UI.

There are two ways to swap an algorithm: deliver to the runtime slot root (the formal
flow), or type an absolute directory path **on the server** under
`Advanced · replace algorithm & match settings` (temporary). Both write to the same
place.

> Delivering into the repo's `algorithms/` does **not** affect a match — that is only a
> factory fixture.


### 锦标赛模式（V1.2，默认开启） / Tournament Mode (V1.2, on by default)

正式比赛**不允许平台自带的算法上场**。服务端对下列四个入口逐一设卡，
只要算出来的包哈希命中「平台发行树」（`starter/`、`algorithms/team-*`、
`competitor-kit/starter`、`demo/*`、`playtest/competitors/*`），一律拒绝：

| 入口 | 行为 |
|---|---|
| 参赛者页上传 | **先判后装** —— 拒绝时槽位一个字节都不写 |
| `install`（Advanced 按路径安装） | 拒绝，且不碰槽位 |
| `use-slot` | 槽位里躺着自带算法时不许密封进本场 |
| `prepare`（向导主按钮） | 同上 —— 它是最容易被绕过的那一条 |

这不是「界面上把按钮变灰」：按钮的 `enabled` 只是提示，
真正的拒绝在**执行时**发生，一个直接的 `POST` 绕不过去。

```bash
npm run app -- --no-tournament   # 开发自测用：允许出厂 starter 上场
```

> `--no-tournament` **只用于开发自测**。正式赛事加了这个开关，
> 一场「正规比赛」就可能跑在模板算法上。
>
> 终端操作台（`src/operator/cli.ts`）是操作员显式指定 `--a/--b` 的专用入口，
> 不存在「自动落回模板」的情形，因此没有这个开关。

服务只绑定 `127.0.0.1`，并对命令请求做 Host + Origin 校验（拒绝跨站控制与 DNS rebinding）。

```bash
npm run app:dev      # 开发模式：服务 + vite dev server（HMR）
npm run e2e          # Playwright 浏览器完整赛事演练（真实算法 + 真实浏览器）
```

> 浏览器演练默认用**系统已装的 Google Chrome**（`channel: 'chrome'`）。
> 若要改用 Playwright 自带内核，删掉 `web/e2e/playwright.config.ts` 里的 `channel`
> 后跑一次 `npx playwright install chromium`。

**English.** A real match **does not allow a platform-shipped algorithm to play.** The
server checks four entry points; if the computed package hash hits the **platform
distribution tree** (`starter/`, `algorithms/team-*`, `competitor-kit/starter`,
`demo/*`, `playtest/competitors/*`) it is refused:

| Entry point | Behaviour |
|---|---|
| Participant upload | **Authorise before installing** — on refusal the slot is not written by a single byte |
| `install` (Advanced, by path) | Refused, slot untouched |
| `use-slot` | A bundled algorithm sitting in the slot cannot be sealed into the match |
| `prepare` (the wizard's main button) | Same — this is the easiest one to bypass |

This is not "grey out the button": a button's `enabled` is only a hint. The real refusal
happens **at execution time**, and a direct `POST` cannot get around it.

```bash
npm run app -- --no-tournament   # development only: allow the factory starter to play
```

> `--no-tournament` is for **development smoke testing only**. With it on, a "real
> match" can end up running the template algorithm.
>
> The terminal operator console (`src/operator/cli.ts`) is a dedicated entry point where
> the operator names `--a/--b` explicitly, so it cannot silently fall back to the
> template — it has no such switch.

The server binds `127.0.0.1` only and validates Host + Origin on command requests
(blocking cross-site control and DNS rebinding).

```bash
npm run app:dev      # dev mode: server + vite dev server (HMR)
npm run e2e          # Playwright browser rehearsal of a full match (real algorithms + real browser)
```

> The browser rehearsal uses the **system-installed Google Chrome** by default
> (`channel: 'chrome'`). To use Playwright's bundled engine instead, delete `channel`
> from `web/e2e/playwright.config.ts` and run `npx playwright install chromium` once.


### 终端（fallback，与 Web UI 完全等价） / Terminal (fallback, equivalent to the Web UI)

```bash
npm install

# 操作台（正式入口）—— 直接使用槽位里已就绪的算法
npx ts-node src/operator/cli.ts
npx ts-node src/operator/cli.ts --seed 42 --points 8 --difficulty hard
npx ts-node src/operator/cli.ts --auto                              # 无人值守

# 上传新算法到槽位（staging → validate → preflight → hash → seal → replace）
npx ts-node src/operator/cli.ts --a ./pkgA --b ./pkgB
npx ts-node src/operator/cli.ts --a ./pkgA --slots /tmp/gb-slots    # 换用别的槽位根目录

npx ts-node src/operator/cli.ts --replay ./artifacts/matches/<id>   # 只读回放

# 类型检查（平台 + 服务端；前端另有 typecheck:web）
npm run typecheck
npm run typecheck:web

# 回归测试（38 个套件，清单见 tests/run-all.ts）
npm test
npm test -- web-projection web-server      # 只跑指定套件

# 地图生成器压力验证（默认 300,000 张）
npm run stress
```

**English.** Every entry point uses `runs/slots` by default and takes `--slots <dir>` to
point elsewhere. `npm test` runs the regression suites (see `tests/run-all.ts` for the
list); `npm test -- <suite> <suite>` runs only the named ones. `npm run stress` is the
map-generator stress check.

---

## 项目结构 / Repository structure

```
几何斗殴/
├── runs/              # 运行期状态（已 gitignore）
│   └── slots/         #   ★ 运行期槽位根 = 正式算法投递点
│       ├── team-a/    #     Team A Slot —— 根目录必须有 solver.py
│       ├── team-b/    #     Team B Slot
│       └── .staging/ .slots/   # 上传暂存区 / 安装记录（不属于算法包）
├── algorithms/        # canonical 出厂 fixture（受 git 跟踪，只读语义）
│   ├── team-a/        #   Team A Slot 的出厂内容 —— 首次启动播种到 runs/slots
│   └── team-b/        #   Team B Slot 的出厂内容
│                      #   ⚠ 改这里**不会**改变比赛用的算法；投递请写 runs/slots
├── src/
│   ├── core/          # Ast / Validator / Judge / Match / Round / Rules / RoundState / InputProtocol / Logs
│   ├── field/         # 场地与点
│   ├── obstacle/      # 障碍物几何与距离函数
│   ├── map/           # MapGenerator（含 §47 公平性过滤）
│   ├── submission/    # 包校验 / 密封 / 防篡改 / 算法槽位 / 固定 Runtime
│   ├── runner/        # SandboxRunner（sandbox-exec + 进程组 + 计时屏障）
│   ├── operator/      # 正式操作台 CLI 与裁判台（终端）
│   ├── ui/            # 终端操作台 / 观众屏 / 裁判屏（终端 fallback）
│   ├── visualizer/    # 函数与轨迹可视化
│   └── server/        # 本地 Web UI 的服务端（HTTP + WS + MatchSession）
├── web/               # 本地 Web UI 的前端（React + Vite + Canvas 2D）
│   ├── src/           #   首页 / 回放列表 / 参赛者页 / 裁判台 / 观众大屏 / 回放播放器 + Arena 画布
│   └── e2e/           #   Playwright 完整赛事演练（中英）+ 四视口双语巡检
├── starter/           # 官方 Starter Algorithm（槽位出厂即为它的副本）
├── demo/              # 参考解（reference-solver-v2）
├── tests/             # 回归测试套件 + 算法 fixture
└── docs/              # 文档：规则、架构、发布说明、公平性报告
```

**English.** `runs/slots/` is the runtime state and the official delivery point (and is
git-ignored). `algorithms/` is the tracked factory fixture — first start seeds
`runs/slots` from it once, and changing it afterwards does not change the algorithm a
match runs. `src/core/` holds the engine and the canonical Judge; `src/server/` is the
local Web server (HTTP + WS + MatchSession); `web/` is the frontend (React + Vite +
Canvas 2D); `tests/` holds the regression suites and algorithm fixtures;
`docs/` contains rules, architecture, release notes, and fairness reports.


---

## 本地 Web UI 的边界 / Where the local Web UI stops

Web UI 是一个**包装层**，不是第二个引擎。三条结构性约束：

1. **服务端不新增任何判定。** `src/server/` 里每个命令都是对 `MatchEngine`
   （或终端裁判台共用的 `MatchSetupUI`）的一次调用；每个 board 字段都是引擎查询的拷贝。
   命中 / 先手 / 击杀 / 胜负 / 僵持的计算一处也没有。
   *UI 不许再猜一套规则* —— 动作按钮的启用判据逐条抄自引擎自己用的那个条件
   （例：`startMatch()` 的真实判据是「双方已上传 + `preflightDone`」，
   就读 `isPreflightPassed()`，**不许**拿 `phase === 'READY'` 这类代理量去猜）。

2. **观众板是逐字段白名单。** `spectatorBoard()` 显式构造每一个字段，
   没被拷贝的字段浏览器**根本收不到**。因此「大屏不泄漏开发者诊断」
   是传输层的结构性事实，而不是一句需要人工维护的约定。
   两道回归守着它：`tests/web-projection.ts`（键集合被钉死）与
   `tests/web-server.ts`（真跑完一场后扫描观众通道）。

3. **按队隔离也在传输层。** `teamBoard()` 是另一个逐队白名单：对方的选择、
   槽位、源码、包哈希一个字段都不在里面。**且服务端要先确认你有资格问这一队** ——
   只按队别裁剪载荷是不够的，那只是「谁问都给、给的东西不同」；
   没有令牌的话，任何人都能问对方那一队。见上面「访问令牌」，
   回归在 `tests/team-auth.ts`。

> 裁判板是**权威视角**，它**合法地**同时包含双方的选择（裁判要据此推进比赛）。
> 所以隔离的边界是「谁拿到哪一份板」，不是「板里有没有某个字段」。

轨迹的处理遵循同一条原则：**画布只消费引擎判定出的轨迹点**，浏览器只做
reveal 比例的逐帧揭示，从不求值函数 —— 重新求值会画出一条穿过障碍物的曲线，
而真实轨迹在第一次接触障碍物处就永久终止了。

**English.** The Web UI is a **wrapper**, not a second engine. Three structural
constraints:

1. **The server adds no judging of its own.** Every command in `src/server/` is one call
   into `MatchEngine` (or `MatchSetupUI`, shared with the terminal console), and every
   board field is a copy of an engine query. Hit / first-mover / kills / winner /
   stalemate are computed nowhere else. *The UI must not guess a second rule set* —
   a button's enabling condition is copied line by line from the condition the engine
   itself uses (e.g. `startMatch()` really requires "both uploaded + `preflightDone`",
   so the UI reads `isPreflightPassed()` and must **not** infer it from something like
   `phase === 'READY'`).
2. **The spectator board is a per-field whitelist.** `spectatorBoard()` constructs every
   field explicitly; anything not copied the browser **never receives**. "The big screen
   leaks no developer diagnostics" is therefore a transport-layer fact, not a convention
   someone has to maintain. Two regressions guard it: `tests/web-projection.ts` (the key
   set is pinned) and `tests/web-server.ts` (scans the spectator channel after a real
   match).
3. **Per-team isolation is also at the transport layer.** `teamBoard()` is another
   per-team whitelist: the opponent's choice, slot, source and package hash are all
   absent. **And the server first confirms you are entitled to ask for that team** —
   trimming the payload by team is not enough, because that is "answer anyone, with
   different contents"; without a token anyone could ask as the other team. See
   [access tokens](#访问令牌v12每场轮换--access-tokens-v12-rotated-every-match), regression in
   `tests/team-auth.ts`.

> The judge board is the **authoritative view** and **legitimately** contains both
> sides' choices (the judge needs them to run the match). So the isolation boundary is
> "who receives which board", not "does a board contain a given field".

Trajectories follow the same principle: **the canvas only consumes trajectory points the
engine has already judged.** The browser reveals them frame by frame and never evaluates
the function — re-evaluating would draw a curve straight through an obstacle, whereas the
real trajectory ends permanently at first contact.


---

## 隔离与公平性 / Isolation & fairness

- 每次计算运行在独立的 `sandbox-exec` 沙箱中：默认拒绝、拒绝网络、拒绝 `fork`。
  沙箱内是**四区**布局 —— `app/`（只读算法包）、`input/`（只读的两份输入 JSON，0444）、
  `output/`（只写的 `result.json`）、`work/`（可写临时区，唯一可写的目录）。
- 写权限只开放 `file-write-data` / `file-write-create` / `file-write-unlink`（够用：tmp + fsync +
  原子 rename、覆盖写、建子目录、写 `__pycache__`），**`utimes` 被拒绝** —— 算法无法回拨
  自己结果文件的时间戳。计时终点取结果文件的 mtime，若它能被参赛代码改写，计时就可被伪造。
- 平台源码目录、密封包目录、**算法槽位目录**、`/Users`、沙箱根目录、对手沙箱均不可读。
- 宿主环境变量不继承（只保留 `PATH`/`HOME`/`TMPDIR`/`LANG`/`LC_ALL`/`PYTHON*`/`GB_TEAM`，
  以及钉死为 1 的线程数变量）。
- **START 是硬门禁**：REVEAL 之后算法进程仍被扣住，直到裁判按下 START 才放行；
  未 START 直接计算会被引擎拒绝（`tests/stage-gating.ts`、`tests/pre-start-execution.ts`）。
  REVEAL 与 START 之间可以停任意久，停多久都不影响公平。
- **preflight 用 decoy 世界**：赛前冒烟跑的是由 `matchId` 派生的独立种子生成的地图，
  与实际比赛种子无关（撞车时自动换种子），因此它不会变成本轮障碍物的预览；
  审计日志记录 `decoySeed` 与 `matchSeed` 两个值（`tests/preflight-decoy.ts`）。
- 公平启动：双方进程都完成 READY 握手后，宿主才先后写入 GO；每个 Runner 的正式
  compute latency 与超时预算都从**自己的** GO 时刻起算，因此不是双方共用一个时间戳。
  `startSkewUs`（审计字段 `startSkewNs`）只是两次 GO 时刻之间的偏差，不参与计时。
  两次 GO 写入之前，双方的轮询器与超时预算已由 `prepare()` 提前挂好、stdin 写入路径
  也预热过，`stdin.end()`（EOF 信号，不参与计时）推迟到下一拍 —— 否则夹在两次写入
  之间的宿主开销会整体计入**先写方**的耗时，形成方向固定的偏置。
- **打点在 `write('GO')` 之后**（Re-Gate Cycle 2 B-1）：交付发生在这次调用的**内部**，
  而写入调用本身不免费（实测首次约 10.7µs、第二次约 3.0µs）。此前锚点取在写入之前，
  先释放方被白算了一整个 write 耗时 —— 两次 GO 真正到达子进程只差约 4–9µs，
  却被记成 5–8µs 的耗时差，方向固定地把先释放方记成「更慢」（7/7 次观测
  aFasterRate 均小于 0.5）。修正后锚点即交付时刻，`aFasterRate` 回到 0.5 附近；
  永久回归见 `tests/timing-fairness.ts` 的「GO 打点必须落在 write() 之后」用例。
  `startSkewUs` 中位数约 5µs，仍比先手判定阈值 `TIE_EPS_MS = 0.05`（50µs）小一个数量级。
- 计时终点是**结果文件自身写成的时刻**（`mtime`，纳秒），不是宿主轮询回调的执行时刻：
  轮询回调是串行的，先返回的一方会推迟后一方的读数（V1.1 实现期实测该偏置达 100µs 量级）。
  `mtime` 由内核在写入时打戳、随 rename 保留、且因沙箱拒绝 `utimes` 而不可伪造；
  取不到或换算不合理时退回轮询时刻。
- `timing-fairness` 验证的是 slot / 顺序不产生可利用的系统性优势（同算法下「A 更快」
  的比例接近 0.5、换序胜率差有界），**不构成「绝对公平」的保证**。
- 每回合使用全新沙箱，回合结束后整个目录被销毁（无跨回合持久化）。

**English.**

- Every computation runs in its own `sandbox-exec` sandbox: deny by default, deny
  network, deny `fork`. Inside is a **four-zone** layout — `app/` (read-only package),
  `input/` (the two read-only input JSONs, 0444), `output/` (write-only `result.json`),
  `work/` (writable scratch, the only writable directory).
- Write access grants only `file-write-data` / `file-write-create` /
  `file-write-unlink` (enough for tmp + fsync + atomic rename, overwrite, creating
  subdirectories, writing `__pycache__`). **`utimes` is denied** — an algorithm cannot
  roll back its own result file's timestamp, and the timing endpoint is that file's
  mtime; if contestant code could rewrite it, timing could be forged.
- The platform source directory, sealed-package directories, the **algorithm slot
  directories**, `/Users`, the sandbox root and the opponent's sandbox are all
  unreadable.
- Host environment variables are not inherited (only `PATH`/`HOME`/`TMPDIR`/`LANG`/
  `LC_ALL`/`PYTHON*`/`GB_TEAM`, plus the thread-count variables pinned to 1).
- **START is a hard gate:** after REVEAL the algorithm process is still held back until
  the judge presses START. Computing without START is refused by the engine
  (`tests/stage-gating.ts`, `tests/pre-start-execution.ts`). The judge may sit between
  REVEAL and START as long as it likes; that has no effect on fairness.
- **Preflight uses a decoy world:** the pre-match smoke run uses a map generated from a
  seed derived from `matchId`, unrelated to the actual match seed (it re-rolls on
  collision), so it cannot become a preview of this round's obstacles. The audit log
  records both `decoySeed` and `matchSeed` (`tests/preflight-decoy.ts`).
- Fair start: the host writes GO to both sides only after both processes complete their
  READY handshake, and each Runner's compute latency and timeout budget start from
  **its own** GO. `startSkewUs` (audit field `startSkewNs`) is merely the gap between the
  two GO writes and never enters the timing. Before both writes, both pollers and
  timeout budgets are already armed by `prepare()` and the stdin write path is warmed;
  `stdin.end()` (the EOF signal, not part of timing) is deferred to the next tick —
  otherwise host overhead sandwiched between the two writes would be charged in full to
  **whichever side was written first**, a fixed-direction bias.
- **The anchor is taken after `write('GO')`:** delivery happens *inside* that call, and
  the write itself is not free (measured ~10.7 µs the first time, ~3.0 µs the second).
  The anchor used to be taken before the write, so the side released first was charged a
  whole write for free — the two GOs reached their processes only ~4–9 µs apart but were
  recorded as a 5–8 µs difference, systematically marking the first-released side as
  "slower" (7/7 observations had `aFasterRate` below 0.5). With the anchor at the actual
  delivery, `aFasterRate` returned to ~0.5; the permanent regression is the "GO anchor
  must be taken after write()" case in `tests/timing-fairness.ts`. Median `startSkewUs`
  is ~5 µs, an order of magnitude below the first-mover threshold `TIE_EPS_MS = 0.05`
  (50 µs).
- The timing endpoint is the moment the **result file itself was written** (`mtime`,
  nanoseconds), not when the host's polling callback ran: callbacks are serial, so
  whichever side returns first delays the other's reading (measured at ~100 µs during
  V1.1). `mtime` is stamped by the kernel, survives the rename, and cannot be forged
  because the sandbox denies `utimes`; when it is unavailable or inconsistent the poll
  time is used instead.
- `timing-fairness` verifies that slot and order confer no exploitable systematic
  advantage (with identical algorithms the "A was faster" rate is near 0.5 and the
  win-rate gap under swapping is bounded). It is **not** a guarantee of absolute
  fairness.
- A fresh sandbox is used every round and the whole directory is destroyed afterwards
  (no cross-round persistence).


---

## 可复现性 / Reproducibility

**中文.** 一场比赛可以**事后独立复核**，不需要重跑任何算法：

- `match.json` / `audit.json` / `replay.json` 落在 `artifacts/matches/<matchId>/`；
- 逐轮记录 `roundStateHash = SHA256(publicStateHash + revealStateHash)`。拿到当年那两份
  输入字节的人，可以用 `shasum -a 256` **独立验证「算法当时究竟看到了什么」**；
- 回放只消费已落盘的轨迹与结果 —— **不重新运行算法、不重新求值函数、不重算判定**；
- 引擎的判定是确定性的：同一份输入 + 同一套冻结 Runtime ⇒ 同一个结果。

参考解的可复现性另有一条专用回归 `tests/demo-repro`：同一份**逐字节忠实**的输入，
在**直接执行**与**官方沙箱**两条路径下各跑 10 次，必须逐字节一致，并且等于当年那一场
实际提交的那一枪。那份 fixture 的 sha256 也会被拿来与引擎当年记录的哈希比对 ——
防止「复现输入其实不是算法当年收到的那份」。

**English.** A match can be **re-verified independently after the fact**, without
re-running any algorithm:

- `match.json` / `audit.json` / `replay.json` land in `artifacts/matches/<matchId>/`;
- `roundStateHash = SHA256(publicStateHash + revealStateHash)` is recorded per round.
  Anyone holding those two input files can verify **what the algorithms actually saw**
  with `shasum -a 256`;
- a replay consumes only the stored trajectories and results — it **never re-runs an
  algorithm, re-evaluates a function, or recomputes a judgement**;
- the engine's judging is deterministic: same input + same frozen runtime ⇒ same result.

The reference solver has its own regression, `tests/demo-repro`: one **byte-faithful**
input is run ten times down each path — **direct execution** and the **official
sandbox** — and the results must be byte-identical to each other *and* to the shot that
match actually submitted. The fixture's sha256 is also compared against the hash the
engine recorded at the time, so a "reproduction input" that is not the input the
algorithm actually received cannot go unnoticed.

---

## 已知限制 / Known limitations

- **僵局与终止**由引擎负责，见上文「终止保证」：STALEMATE（连续 20 回合零击杀）
  与 HARD_ROUND_LIMIT（第 60 回合）都会判 DRAW 并正常终局，不存在「跑不完等裁判裁定」。
  操作台的 `--max-rounds`（默认与引擎硬上限一致，即 60）只是操作台侧的兜底护栏，
  不改变引擎判定。出厂 starter 与自己对局时确实会走到 STALEMATE（都不绕障碍物）——
  那是一场合法的平局，不是卡死；但正式对手仍应换掉 starter。
- 操作台用 `--a/--b` 上传时会把算法**安装进槽位**（规范 §31/§32 的正式流程）。
  默认槽位根是 `runs/slots`（运行期槽位，被 gitignore），**不会**污染工作区。
  想换位置就加 `--slots <dir>`。
- 本 README 描述的是 **V1.3** 平台能力，最终比赛可用性由独立审计结论决定。
- **本地化（V1.3）只覆盖 Web 层自己写的文案。** 服务端 / 引擎自产的自由文本
  （锦标赛拒绝、安装流水线错误、引擎错误原文）仍以平台规范的中文原样透传 ——
  浏览器语言是**纯展示**的，不得进入比赛载荷，所以那些消息无法按客户端语言渲染。
  结构化的机器字段（阶段枚举、动作 key、`NOT_THROUGH_SHOOTER` 之类的错误码）
  与语言无关，一律不变。

**English.**

- **Stalemate and termination** are the engine's job, see "Termination guarantee" above:
  both STALEMATE (20 consecutive kill-free rounds) and HARD_ROUND_LIMIT (round 60) end
  as a DRAW with a normal match end — there is no "runs forever, judge decides". The
  operator console's `--max-rounds` (defaulting to the engine's own hard limit, 60) is
  only a safety rail on the console side and does not change engine judging. The shipped
  starter playing itself does reach STALEMATE (neither side goes around obstacles) —
  that is a legal draw, not a hang; a real opponent should still replace the starter.
- Uploading with the console's `--a/--b` **installs the algorithm into the slot** (the
  formal §31/§32 flow). The default slot root is `runs/slots` (the runtime slot root
  your current installed build reports, git-ignored), so it does **not** dirty the
  working tree. Pass `--slots <dir>` to point elsewhere.
- This README describes the **V1.3** platform capabilities; final competition usability
  is subject to an independent audit.
- Localization (V1.3) covers every string the **Web layer** authors. Free-form
  diagnostic messages produced by the **server/engine** (tournament refusals, install
  pipeline errors, engine error text) still travel as the platform's canonical Chinese
  text: the browser's locale is presentation-only and must not enter the competition
  payload, so those messages cannot be rendered per-client on the server. Structured,
  machine-readable fields — phase enums, action keys, error codes such as
  `NOT_THROUGH_SHOOTER` — are language-independent and unchanged.


---

## 版本沿革 / Release provenance

**中文.** 本仓库是 Geometry Battle 的**公开发布版本**，采用独立的脱敏历史。

- **公开 tag**：`v1.2.0`、`v1.3.0`、`v1.4.0`。
- **内部审计来源**：
  - V1.3 公开发布基于独立审计的内部快照 `febf1c69fb6cb78624811513149f477c4e30fac6`。
  - V1.4 公开发布基于独立审计的内部快照 `7f6e39d0d4faaa34ca48981aaee44f0213a52337`。
- **公开 Git 提交标识符与内部 SHA 刻意不同**，因为公开仓库使用经过脱敏的发布历史。
- 已发布的 tag **从不移动**，历史**从不改写**（不 force push、不 rebase 已发布的提交）。

**English.** This repository is the **public release** of Geometry Battle, using an
independent sanitized history.

- **Public tags**: `v1.2.0`, `v1.3.0`, `v1.4.0`.
- **Internal audit provenance**:
  - V1.3 public distribution prepared from independently audited internal snapshot `febf1c69fb6cb78624811513149f477c4e30fac6`.
  - V1.4 public distribution prepared from independently audited internal snapshot `7f6e39d0d4faaa34ca48981aaee44f0213a52337`.
- **Public Git commit identifiers intentionally differ from internal SHAs** because the
  public repository uses a sanitized release history.
- Published tags are **never moved** and the history is **never rewritten** (no force
  push, no rebasing published commits).

---

## 许可与使用范围 / License & scope

### 定位 / Positioning

Geometry Battle 是一个**教育性的算法竞赛沙盒**，用于：

- **教育** —— 课堂演示、自学者练习「平台实现 + 算法设计」的完整闭环；
- **算法优化** —— 在同一评测框架下对比不同的搜索 / 拟合 / 几何策略；
- **计算几何实验** —— 障碍物求交、轨迹终止、凸性分析等问题的实验场；
- **AI-assisted / vibecoding practice** —— 让 AI 结对产出真正可参赛的算法包；
- **编程竞赛** —— 班级、社团或自组织的对抗赛。

**English.** Geometry Battle is an **educational algorithm competition sandbox** for:
**education** (classroom demos, self-study of the full platform-plus-algorithm loop);
**algorithm optimisation** (comparing search / fitting / geometry strategies under one
harness); **computational geometry experiments** (obstacle intersection, trajectory
termination, convexity analysis); **AI-assisted / vibecoding practice** (pairing with an
AI to produce a genuinely competitive package); and **programming competitions** (class,
club or self-organised matches).


### 许可 / License

本项目采用 **[PolyForm Noncommercial License 1.0.0](LICENSE)**，全文见仓库根目录的
[`LICENSE`](LICENSE)（与 [官方原文](https://polyformproject.org/licenses/noncommercial/1.0.0)
逐字节一致，未作任何改写）。

> **这不是 OSI 认可的开源许可。**
> 准确的说法是 **source-available for noncommercial use** —— 源码公开可见、
> 可自由用于非商业目的，但**不满足** OSI 开源定义中「不得限制使用领域」这一条。
> 请勿将它称为 "open source" 或 "OSI-approved"。

在**非商业目的**下，你被允许：

| 权利 | 说明 |
|------|------|
| 使用 | 运行平台、办比赛、做课程作业 |
| 学习 | 阅读与研究源码、规则设计与判定实现 |
| 修改 | 改规则、换判定、增删算子与可视化 |
| 再分发 | 分发原版，或分发你的修改版 |

*非商业目的* 包括个人研究、实验与测试、个人学习、业余爱好项目，以及慈善机构、
教育机构、公共研究机构、公共安全与卫生机构、环保机构和政府机构的使用 ——
**不论其经费来源**。再分发时**必须随附本许可条款**（或指向它的 URL），
另见 PolyForm 的 Notices 条款。

**English.** This project is licensed under the
**[PolyForm Noncommercial License 1.0.0](LICENSE)**; the full text is in
[`LICENSE`](LICENSE) at the repository root (byte-identical to the
[official text](https://polyformproject.org/licenses/noncommercial/1.0.0), not rewritten
in any way).

> **This is not an OSI-approved open source licence.** The accurate description is
> **source-available for noncommercial use**: the source is publicly visible and free to
> use for noncommercial purposes, but it does not satisfy the OSI open source
> definition's requirement of no field-of-use restriction. Please do not call it
> "open source" or "OSI-approved".

Under **noncommercial purposes** you may use, study, modify and redistribute this
project (original or modified) — for personal research, experiments and testing,
personal study, hobby projects, and use by charitable organisations, educational
institutions, public research institutions, public safety or health organisations,
environmental organisations and government institutions, **regardless of how they are
funded**. Redistribution must include these licence terms (or a URL pointing to them) —
see PolyForm's Notices clause.


### 商业用途 / Commercial use

**商业用途不在本许可的授权范围内。** 若要将本项目或其修改版用于商业目的 ——
包括但不限于付费课程、商业培训、商业竞赛平台、托管服务、咨询交付，
或集成进商业产品 —— **必须事先取得作者另行签发的授权**。

授权联系：<https://github.com/Xhoryon>

**English.** **Commercial use is not granted by this licence.** Using this project or a
modified version for commercial purposes — including but not limited to paid courses,
commercial training, commercial competition platforms, hosted services, consulting
deliverables, or integration into a commercial product — **requires a separate licence
from the author first.**


### 版权 / Copyright

Copyright (c) 2026 Jiayi Huang — <https://github.com/Xhoryon>
