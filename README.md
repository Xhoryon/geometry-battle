# 几何斗殴 (Geometry Battle) — V1 Platform

**AI Vibecoding 函数图像对抗比赛系统**

---

## 概述

双方队伍各提交一个算法包。每个回合，平台给双方注入相同的 `RoundState`（地图、障碍物、双方所有点的坐标、各自的 Shooter），
双方算法各自输出一条函数曲线 `y = f(x)`；曲线从自己的 Shooter 出发，在射程内**严格经过对方点**即构成击杀。

判定由平台唯一的 Canonical Judge 完成，算法不得自行判定胜负。

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

### 2. 算法协议（stdin / stdout）

平台把 `RoundState` 以**一行 JSON** 写入算法进程的 stdin；算法必须在 stdout 输出**一行 JSON**：

```json
{"dsl": {"type": "...", "args": [...]}}
```

`dsl` 可以是 AST 对象，也可以是 AST 的 JSON 字符串。多输出的一律以最后一次可解析的 JSON 为准。

**输入字段：**

```json
{
  "round": 1,
  "team_id": "A",
  "state_hash": "…",
  "map_seed": 12345,
  "map_hash": "…",
  "obstacles": [ … ],
  "points":    [{"id": "A1", "team": "A", "position": {"x": -12.3, "y": 4.1}}, …],
  "shooters":  {"A": {"id": "A1", "position": {"x": -12.3, "y": 4.1}}, "B": { … }},
  "team_a_x_range": [-20, -4],
  "team_b_x_range": [4, 20],
  "field": {"x_min": -20, "x_max": 20, "y_min": -12, "y_max": 12}
}
```

**最小可运行示例（官方 starter 的简化版）：**

```python
import json, sys

state = json.loads(sys.stdin.readline())
team = state["team_id"]
s = state["shooters"][team]["position"]
enemies = [p for p in state["points"] if p["team"] != team]

# f(x) = y_s + m·(x - x_s)：严格经过自己的 Shooter，且是 C^∞ 的
t = enemies[0]["position"]
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
sys.stdout.write(json.dumps({"dsl": dsl}) + "\n")
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
| 单次计算超时 | 2000 ms（从共享 GO 时刻起算） |
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

# 回归测试（16 个必需套件 + 地图公平性）
npm test

# 地图生成器压力验证（默认 300,000 张）
npm run stress
```

---

## 项目结构

```
几何斗殴/
├── src/
│   ├── core/          # Ast / Validator / Judge / Match / Round / Rules / RoundState / Logs
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
└── Plans/             # 设计文档与 Gate 记录
```

---

## 隔离与公平性

- 每次计算运行在独立的 `sandbox-exec` 沙箱中：默认拒绝、拒绝网络、拒绝 `fork`，
  只允许读自己的包、只允许写自己的 `work/` 目录。
- 平台源码目录、密封包目录、`/Users`、沙箱根目录均不可读。
- 宿主环境变量不继承（只保留 `PATH`/`HOME`/`TMPDIR`/`LANG`/`PYTHON*`/`GB_TEAM`）。
- 双方进程都完成 READY 握手后，由宿主写入同一个 GO 时刻；两侧计时相对同一时刻起算，
  与进程创建顺序无关。
- 每回合使用全新沙箱，回合结束后整个目录被销毁（无跨回合持久化）。

---

## 已知限制

- Plan V1 §28 只定义了「一方全部点死亡则比赛立即结束」，**没有定义僵局（stalemate）规则**。
  若双方都无法命中对方，比赛在规范上可能不终止。操作台会持续回合直至分出胜负；
  如遇长时间僵局请人工介入并记录为赛事异常。
- 本 README 描述的是 V1 平台能力，最终比赛可用性由独立 Re-Gate 审计结论决定。
