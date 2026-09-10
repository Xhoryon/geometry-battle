# 几何斗殴 (Geometry Battle) — V1 Platform

**AI Vibecoding 函数图像对抗比赛系统**

---

## 概述

双方队伍各提交一个算法包，装进两个**固定槽位** `algorithms/team-a` 与 `algorithms/team-b`。
每个回合，平台分两阶段向双方注入**逐字节相同**的输入文件
（`public_state.json` → `reveal_state.json`），双方算法各自输出一条函数曲线 `y = f(x)`；
曲线从自己的 Shooter 出发，在射程内**严格经过对方点**即构成击杀。

判定由平台唯一的 Canonical Judge 完成，算法不得自行判定胜负。
**START 之前，参赛代码一行都不会运行**；结果只经 `output/result.json` 交付，
stdout **不是** IPC 通道 —— 见 [算法协议](#2-算法协议两阶段输入文件--argv)。

---

## 快速开始

### 1. 算法包结构（固定槽位 + 固定入口）

算法包投放进两个**永久存在**的槽位：

```
algorithms/
├── team-a/            → Team A Algorithm Slot
│   └── solver.py      # 唯一正式入口（必须存在）
└── team-b/            → Team B Algorithm Slot
    └── solver.py
```

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
输出不合法），现有槽位**一个字节都不会变**，坏包只停留在 `algorithms/.staging/`。
槽位元数据（安装时间、包哈希、preflight 结论）写在 `algorithms/.slots/`，
它**不属于算法包**，不进包哈希、也不会被复制进沙箱。

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
| deadline | 2000 ms 内形成完整合法文件 → 接收；否则 TIMEOUT |
| ONE OUTPUT ONLY | 每回合只接收一次结果，不能重新提交 |
| stdout | **不是**结果通道，仅被捕获/限长/留档 |
| stderr | 允许有限 debug log，有大小限制，不参与判定 |

SDK 模板见 [`starter/solver.py`](starter/solver.py)（含 `emit()` 原子写实现）。

**输入分两次交付（V1.1 两阶段协议）：**

| 阶段 | 文件 | 内容 |
|------|------|------|
| PRE-REVEAL | `public_state.json` | 轮次、场地、**双方全部点**（含 `alive: false` 的死点）；**不含**障碍物、种子、任何 Shooter |
| REVEAL | `reveal_state.json` | 增量：双方 Shooter id、障碍物、以及 `public_state_sha256` |

`public_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"map":{"xmin":-20,"xmax":20,"ymin":-12,"ymax":12},"points":[{"id":"A1","team":"A","x":-14,"y":6,"alive":true},{"id":"A2","team":"A","x":-10,"y":-3,"alive":false}]}
```

`reveal_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"public_state_sha256":"92fa…","shooters":{"A":"A4","B":"B2"},"obstacles":[{"id":"O1","type":"rectangle","xmin":-1,"xmax":2,"ymin":-5,"ymax":1},{"id":"O2","type":"circle","cx":4,"cy":3,"radius":2}]}
```

**绑定自检（建议选手在入口处照抄）：**

```python
import hashlib
assert hashlib.sha256(open(a.public, "rb").read()).hexdigest() == reveal["public_state_sha256"]
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)`（两个十六进制串拼接后再哈希）
写入比赛日志与回放，可事后独立复核；两份文件的确切字节即 `sha256` 字段值，可用 `shasum -a 256` 验证。

**三段式节奏（公平性关键）：**

```
PRE-REVEAL   public_state.json 就位，算法进程尚未创建
   ↓  双方选点并 LOCK
REVEAL       reveal_state.json 生成，算法仍未运行
   ↓  裁判按下 START（现场可停任意久，停多久都不影响公平）
START        宿主此刻才放行算法进程 → 倒计时 3-2-1 → GO → 计算
```

计时仍从**各自** GO 写入时刻起算，与 V1.0 一致。

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

by_id = {p["id"]: p for p in public["points"]}
s = by_id[reveal["shooters"][a.team]]                      # Shooter 坐标在 public 点表里查
enemies = [p for p in public["points"] if p["team"] != a.team and p["alive"]]
t = enemies[0]

# f(x) = y_s + m·(x - x_s)：严格经过自己的 Shooter，且是 C^∞ 的
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
| 单次计算超时 | 2000 ms（每方从自己的 GO 写入时刻起算） |
| 内存上限 | 512 MB |
| CPU / 线程 | 1 核 / 1 线程（`OMP_NUM_THREADS` 等全部钉死为 1） |
| stdout 上限 | 256 KB |
| stderr 上限 | 64 KB |

**函数硬性要求：** 必须经过自己的 Shooter（`|f(x_s) − y_s| ≤ 1e-6`，`ε = HIT_EPSILON`），
在射击区间内有限、连续、C²。
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
| 超时 | 2000 ms |

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
- **先手**：先输出合法解的一方先开火；若其击杀击杀了对方的 Shooter，则对方的攻击被取消

---

## 运行

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

# 类型检查
npm run typecheck

# 回归测试（24 个套件，清单见 tests/run-all.ts）
npm test

# 地图生成器压力验证（默认 300,000 张）
npm run stress
```

---

## 项目结构

```
几何斗殴/
├── algorithms/        # 固定算法槽位（比赛工作人员与选手最关心的区域）
│   ├── team-a/        #   Team A Slot —— 根目录必须有 solver.py
│   ├── team-b/        #   Team B Slot
│   └── .staging/ .slots/   # 上传暂存区 / 安装记录（不属于算法包，已 gitignore）
├── src/
│   ├── core/          # Ast / Validator / Judge / Match / Round / Rules / RoundState / InputProtocol / Logs
│   ├── field/         # 场地与点
│   ├── obstacle/      # 障碍物几何与距离函数
│   ├── map/           # MapGenerator（含 §47 公平性过滤）
│   ├── submission/    # 包校验 / 密封 / 防篡改 / 算法槽位 / 固定 Runtime
│   ├── runner/        # SandboxRunner（sandbox-exec + 进程组 + 计时屏障）
│   ├── operator/      # 正式操作台 CLI
│   ├── ui/            # 操作台 / 观众屏 / 裁判屏
│   └── visualizer/    # 函数与轨迹可视化
├── starter/           # 官方 Starter Algorithm（槽位出厂即为它的副本）
├── tests/             # 回归测试套件 + 算法 fixture
└── Plans/
    ├── Input/         # 人输入的 Plan、规范与任务书
    └── Output/        # 审计报告、工作日志与交接文档
```

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

- Plan V1 §28 只定义了「一方全部点死亡则比赛立即结束」，**没有定义僵局（stalemate）规则**。
  引擎保持该语义不变：双方都打不中时 `getWinner()` 持续返回 `null`。
  操作台侧有 `--max-rounds`（默认 50）护栏，达到上限即停止并报告 `UNDECIDED`，
  产物照常落盘，由裁判按赛事规则裁定。出厂 starter 与它对局时会僵持（都不绕障碍物），
  因此**不要用 starter 当正式对手**。
- 操作台用 `--a/--b` 上传时会把算法**安装进槽位**（规范 §31/§32 的正式流程）。
  默认槽位是仓库内的 `algorithms/`，所以一次真实上传会让工作区出现改动 ——
  这是设计使然（槽位就是投放点）。想避免改动工作区就加 `--slots <临时目录>`。
- 本 README 描述的是 V1 平台能力，最终比赛可用性由独立 Re-Gate 审计结论决定。
