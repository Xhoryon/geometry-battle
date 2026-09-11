# Geometry Battle

**An educational algorithm competition sandbox for computational geometry,
algorithm optimization, and AI-assisted programming.**

中文名：几何斗殴 · 当前版本：V1.1 Platform

**许可：PolyForm Noncommercial License 1.0.0** —— *source-available for noncommercial use*。
**这不是 OSI 认可的开源许可**，商业用途需另行授权，详见 [许可与使用范围](#许可与使用范围)。

---

## 概述

双方队伍各提交一个算法包，装进两个**固定槽位** `runs/slots/team-a` 与 `runs/slots/team-b`
（**运行期槽位根** = 正式投递点；仓库里的 `algorithms/` 只是出厂 fixture，见 §1）。
每个回合，平台分两阶段向双方注入**逐字节相同**的输入文件
（`public_state.json` → `reveal_state.json`），双方算法各自输出一条函数曲线 `y = f(x)`；
曲线从自己的**固定 Emitter** 出发，在射程内**严格经过对方点**即构成击杀。

判定由平台唯一的 Canonical Judge 完成，算法不得自行判定胜负。
**START 之前，参赛代码一行都不会运行**；结果只经 `output/result.json` 交付，
stdout **不是** IPC 通道 —— 见 [算法协议](#2-算法协议两阶段输入文件--argv)。

### V1.1 规则一览

| 项目 | 值 |
|------|-----|
| 攻击函数 | 每回合输出一条 `y = f(x)`，必须严格经过自己的 Emitter（`\|f(x_e) − y_e\| ≤ 1e-6`） |
| 固定 Emitter | A 恒为 `(-18, 0)`、B 恒为 `(18, 0)`，整场不变；是**数学发射锚点**，不是战斗点、不可击杀 |
| 战斗点 | 双方各自的点位（含 `alive: false` 的死点）；对方**存活**的战斗点位于射程内且函数严格经过即击杀 |
| 障碍物 / 场地边界 | 轨迹在**首次障碍物接触**处永久终止；场地 `x ∈ [-20, 20]`、`y ∈ [-12, 12]` |
| 单次计算上限 | **500 ms**（每方从自己的 GO 写入时刻起算；另有 512 MB / 1 核 / 1 线程） |
| `STALEMATE` | 连续 **20** 个回合双方合计击杀数为 **0** → DRAW |
| `HARD_ROUND_LIMIT` | 到达第 **60** 回合（无论局面如何）→ DRAW |

四类终止方式（`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` / `HARD_ROUND_LIMIT`）
覆盖全部情形，判定在引擎内部，任何入口都跑不出一场不终止的比赛 —— 见 [场地与判定](#6-场地与判定)。

---

## 快速开始

### 1. 算法包结构（固定槽位 + 固定入口）

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
>   `runs/slots`，可以用 `--slots <dir>` 换。裁判台的「算法槽位」面板会显示
>   **投递点路径 + 算法名 + 来源 + 哈希**，投的是什么一眼可对。

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

### 2. 算法协议（两阶段输入文件 + argv）

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

> **Revision 3：锚点是常量，不再是每轮选出的「Shooter」。**
> Team A 的 Emitter 恒为 `(-18, 0)`、Team B 恒为 `(18, 0)`，**整场不变**、
> 不可击杀、不计入存活数、也不是胜利目标 —— 它只是攻击函数的**数学发射锚点**，
> 不是战斗点，因此**不在 `points` 里**。
> 它属于**公开**结构：从第 1 轮起就在 `public_state.json` 的 `emitters` 里可见，
> 不需要等揭盲。`reveal_state.json` 里**没有**、也不会有 `shooters` 字段。

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

Revision 3 起**每轮不再有人工选点、也没有 SHOOTER LOCK**：锚点整场固定，
PUBLIC 阶段双方拿到的就是同一对 Emitter 坐标。

计时从**各自** GO 写入时刻起算。

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

# 固定 Emitter 从第 1 轮起就在 public 里，是常量，不必去 points 里找
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

### 3. DSL 白名单

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

### 4. 限制规则

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
在射击区间内有限、连续、C²。`x_e` / `y_e` 是**常量**（A 为 `(-18, 0)`、B 为 `(18, 0)`）。
（注意：这里的 1e-6 与「命中判定」的 1e-6 是两个**不同**概念，不要混用。）

### 5. 固定 Runtime（双方完全相同）

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

### 6. 场地与判定

- 场地：`x ∈ [-20, 20]`，`y ∈ [-12, 12]`
- 队伍区域：A 队 `x ∈ [-20, -4]`，B 队 `x ∈ [4, 20]`
- 攻击方向：A 向 `+x`，B 向 `-x`
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

---

## 运行

### 本地 Web UI（推荐）

```bash
npm install
npm run app          # 构建前端 → 起服务 → 绑定 127.0.0.1:17800 → 自动开浏览器
```

打开后：

| 路由 | 用途 |
|---|---|
| `/judge` | 裁判台：载入算法 → 校验 → 开赛 → 揭晓 → START → 结算 → 终局 → 重置 → 下一场 |
| `/spectator` | 观众大屏：满屏竞技场 + 轨迹动画 + 存活数 + 计算状态。**只读**，无任何诊断信息 |
| `/replay/:matchId` | 回放：用已落盘的 match/audit/replay 重放，**不重新运行任何算法** |

裁判台的**正式主流程是「使用槽位算法」** —— 选手把算法投进**运行期槽位**
`runs/slots/team-a|team-b` 之后，裁判点两下就能开赛，不需要知道任何文件路径。
`/judge` 的「算法槽位」面板会写出**投递点路径、算法名、来源与包哈希**，
投的是不是选手那份，一眼可对。

换算法有两条路：往运行期槽位根投递（正式流程），或在
`Advanced · 替换算法与比赛设置` 里填**服务端**上的目录绝对路径（临时换）。
两条路都写的是同一处。

> 往仓库里的 `algorithms/` 投算法**不会**影响比赛 —— 它只是出厂 fixture。

服务只绑定 `127.0.0.1`，并对命令请求做 Host + Origin 校验（拒绝跨站控制与 DNS rebinding）。

```bash
npm run app:dev      # 开发模式：服务 + vite dev server（HMR）
npm run e2e          # Playwright 浏览器完整赛事演练（真实算法 + 真实浏览器）
```

> 浏览器演练默认用**系统已装的 Google Chrome**（`channel: 'chrome'`）。
> 若要改用 Playwright 自带内核，删掉 `web/e2e/playwright.config.ts` 里的 `channel`
> 后跑一次 `npx playwright install chromium`。

### 终端（fallback，与 Web UI 完全等价）

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

# 回归测试（32 个套件，清单见 tests/run-all.ts）
npm test
npm test -- web-projection web-server      # 只跑指定套件

# 地图生成器压力验证（默认 300,000 张）
npm run stress
```

---

## 项目结构

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
│   ├── src/           #   裁判台 / 观众大屏 / 回放三页 + Arena 画布
│   └── e2e/           #   Playwright 完整赛事演练
├── starter/           # 官方 Starter Algorithm（槽位出厂即为它的副本）
├── tests/             # 回归测试套件 + 算法 fixture
└── Plans/
    ├── Input/         # 人输入的 Plan、规范与任务书
    └── Output/        # 审计报告、工作日志与交接文档
```

---

## 本地 Web UI 的边界

Web UI 是一个**包装层**，不是第二个引擎。两条结构性约束：

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

轨迹的处理遵循同一条原则：**画布只消费引擎判定出的轨迹点**，浏览器只做
reveal 比例的逐帧揭示，从不求值函数 —— 重新求值会画出一条穿过障碍物的曲线，
而真实轨迹在第一次接触障碍物处就永久终止了。

---

## 隔离与公平性

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

---

## 已知限制

- **僵局与终止**由引擎负责，见上文「终止保证」：STALEMATE（连续 20 回合零击杀）
  与 HARD_ROUND_LIMIT（第 60 回合）都会判 DRAW 并正常终局，不存在「跑不完等裁判裁定」。
  操作台的 `--max-rounds`（默认与引擎硬上限一致，即 60）只是操作台侧的兜底护栏，
  不改变引擎判定。出厂 starter 与自己对局时确实会走到 STALEMATE（都不绕障碍物）——
  那是一场合法的平局，不是卡死；但正式对手仍应换掉 starter。
- 操作台用 `--a/--b` 上传时会把算法**安装进槽位**（规范 §31/§32 的正式流程）。
  默认槽位根是 `runs/slots`（运行期槽位，被 gitignore），**不会**污染工作区。
  想换位置就加 `--slots <dir>`。
- 本 README 描述的是 V1.1 平台能力，最终比赛可用性由独立 Re-Gate 审计结论决定。

---

## 许可与使用范围

### 定位

Geometry Battle 是一个**教育性的算法竞赛沙盒**，用于：

- **教育** —— 课堂演示、自学者练习「平台实现 + 算法设计」的完整闭环；
- **算法优化** —— 在同一评测框架下对比不同的搜索 / 拟合 / 几何策略；
- **计算几何实验** —— 障碍物求交、轨迹终止、凸性分析等问题的实验场；
- **AI-assisted / vibecoding practice** —— 让 AI 结对产出真正可参赛的算法包；
- **编程竞赛** —— 班级、社团或自组织的对抗赛。

### 许可

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

### 商业用途

**商业用途不在本许可的授权范围内。** 若要将本项目或其修改版用于商业目的 ——
包括但不限于付费课程、商业培训、商业竞赛平台、托管服务、咨询交付，
或集成进商业产品 —— **必须事先取得作者另行签发的授权**。

授权联系：<https://github.com/Xhoryon>

### 版权

Copyright (c) 2026 Jiayi Huang — <https://github.com/Xhoryon>
