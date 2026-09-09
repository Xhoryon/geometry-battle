# 几何斗殴 (Geometry Battle) — V1 Platform

**AI Vibecoding 函数图像对抗比赛系统**

---

## 概述

双方队伍各提交一个算法包。每个回合，平台分两阶段向双方注入**逐字节相同**的输入文件
（`public_state.json` → `reveal_state.json`），双方算法各自输出一条函数曲线 `y = f(x)`；
曲线从自己的 Shooter 出发，在射程内**严格经过对方点**即构成击杀。

判定由平台唯一的 Canonical Judge 完成，算法不得自行判定胜负。
**START 之前，参赛代码一行都不会运行** —— 见 [算法协议](#2-算法协议两阶段输入文件--argv)。

---

## 快速开始

### 1. 算法包结构

```
my-team/
├── manifest.json      # 必须
└── solver.py          # entry 指向的入口文件
```

**manifest.json：**

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
| entry | 必须是包内存在的 `.py` 文件 |

### 2. 算法协议（两阶段输入文件 + argv）

平台不再把状态写进 stdin。每个回合，宿主以如下 argv 启动算法进程：

```
python solver.py --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json
```

**队别只经 `--team A|B` 传递**；两份 JSON 对 A、B **逐字节相同**，双方可各自 `sha256` 复核。
算法在 stdout 输出**一行 JSON**：

```json
{"dsl": {"type": "...", "args": [...]}}
```

`dsl` 可以是 AST 对象，也可以是 AST 的 JSON 字符串。多输出的一律以最后一次可解析的 JSON 为准。

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
import argparse, hashlib, json

ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True, choices=["A", "B"])
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
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
print(json.dumps({"dsl": dsl}))
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
| stdout 上限 | 256 KB |

**函数硬性要求：** 必须严格经过自己的 Shooter（`f(x_s) = y_s`），
在射击区间内有限、连续、C²。

### 5. 场地与判定

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

# 操作台（正式入口）
npx ts-node src/operator/cli.ts --a ./pkgA --b ./pkgB
npx ts-node src/operator/cli.ts --a ./pkgA --b ./pkgB --seed 42 --points 8 --difficulty hard
npx ts-node src/operator/cli.ts --a ./pkgA --b ./pkgB --auto        # 无人值守
npx ts-node src/operator/cli.ts --replay ./artifacts/matches/<id>   # 只读回放

# 类型检查
npm run typecheck

# 回归测试（22 个套件，清单见 tests/run-all.ts）
npm test

# 地图生成器压力验证（默认 300,000 张）
npm run stress
```

---

## 项目结构

```
几何斗殴/
├── src/
│   ├── core/          # Ast / Validator / Judge / Match / Round / Rules / RoundState / InputProtocol / Logs
│   ├── field/         # 场地与点
│   ├── obstacle/      # 障碍物几何与距离函数
│   ├── map/           # MapGenerator（含 §47 公平性过滤）
│   ├── submission/    # 包校验 / 密封 / 防篡改
│   ├── runner/        # SandboxRunner（sandbox-exec + 进程组 + 计时屏障）
│   ├── operator/      # 正式操作台 CLI
│   ├── ui/            # 操作台 / 观众屏 / 裁判屏
│   └── visualizer/    # 函数与轨迹可视化
├── starter/           # 官方 Starter Algorithm
├── tests/             # 回归测试套件 + 算法 fixture
└── Plans/
    ├── Input/         # 人输入的 Plan、规范与任务书
    └── Output/        # 审计报告、工作日志与交接文档
```

---

## 隔离与公平性

- 每次计算运行在独立的 `sandbox-exec` 沙箱中：默认拒绝、拒绝网络、拒绝 `fork`。
  沙箱内是三区布局 —— `app/`（只读算法包）、`input/`（只读的两份输入 JSON，0444）、
  `work/`（**唯一**可写目录）。
- 平台源码目录、密封包目录、`/Users`、沙箱根目录、对手沙箱均不可读。
- 宿主环境变量不继承（只保留 `PATH`/`HOME`/`TMPDIR`/`LANG`/`LC_ALL`/`PYTHON*`/`GB_TEAM`）。
- **START 是硬门禁**：REVEAL 之后算法进程仍被扣住，直到裁判按下 START 才放行；
  未 START 直接计算会被引擎拒绝（`tests/stage-gating.ts`、`tests/pre-start-execution.ts`）。
  REVEAL 与 START 之间可以停任意久，停多久都不影响公平。
- **preflight 用 decoy 世界**：赛前冒烟跑的是由 `matchId` 派生的独立种子生成的地图，
  与实际比赛种子无关（撞车时自动换种子），因此它不会变成本轮障碍物的预览；
  审计日志记录 `decoySeed` 与 `matchSeed` 两个值（`tests/preflight-decoy.ts`）。
- 公平启动：双方进程都完成 READY 握手后，宿主才先后写入 GO；每个 Runner 的正式
  compute latency 与超时预算都从**自己的** GO 写入时刻起算，因此不是双方共用一个
  时间戳。`releaseSkewUs` 只是两次 GO 写入之间交付延迟的诊断量，不参与计时。
- `timing-fairness` 验证的是 slot / 顺序不产生可利用的系统性优势（同算法下「A 更快」
  的比例接近 0.5、换序胜率差有界），**不构成「绝对公平」的保证**。
- 每回合使用全新沙箱，回合结束后整个目录被销毁（无跨回合持久化）。

---

## 已知限制

- Plan V1 §28 只定义了「一方全部点死亡则比赛立即结束」，**没有定义僵局（stalemate）规则**。
  若双方都无法命中对方，比赛在规范上可能不终止。操作台会持续回合直至分出胜负；
  如遇长时间僵局请人工介入并记录为赛事异常。
- 本 README 描述的是 V1 平台能力，最终比赛可用性由独立 Re-Gate 审计结论决定。
