# Geometry Battle V1.1 — 参赛算法开发要求

> 本文件是**正式发布版**参赛要求。它与平台实现（parser / validator / sandbox / preflight）
> 逐条对齐，并由 `tests/competitor-kit.ts` 持续核对。
> 文中提到的每一个文件、工具、规范都真实存在于 `competitor-kit/`。

---

# 0. 一分钟概览

你要做的东西只有一件：

```text
写一个 solver.py
```

它每轮拿到当前局面（公开状态 + 揭盲信息），输出一个**数学函数** `f(x)`：

- 函数必须经过你自己的 Shooter；
- 函数在攻击方向上要「打得中」对方点位；
- 函数要避开障碍物；
- 函数必须有限、连续、C²、凸性变化有限。

平台负责地图、判定、计时、动画、胜负 —— 你**不需要**实现这些。

| 资料 | 用途 |
|---|---|
| [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) | 沙箱内可用的 Python 与模块（**第三方包为 0**） |
| [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md) | 函数 DSL 的完整规范与合法/非法示例 |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | 三个 JSON 文件的字段结构 |
| [starter/solver.py](starter/solver.py) | 可直接运行的最小模板 |
| [examples/](examples/) | 真实引擎产出的样例输入输出 |
| [tools/validate_submission.py](tools/validate_submission.py) | 本地自检工具 |

---

# 1. 提交物形态

**提交物 = 一个算法目录**（不是 zip）。

```text
my-algorithm/
├── solver.py          ← 必须存在，且必须在目录根部
├── optimizer.py       ← 可选：你自己的其它模块
└── utils/             ← 可选：你自己的子目录
```

规则：

- 入口文件名**固定**为 `solver.py`，且必须位于包**根目录**（不允许再套一层子目录）。
- 可以带自己的 `.py` 模块、`.json` / `.txt` / `.csv` / `.yaml` / `.md` 数据文件。
- **包根目录会被加入 `sys.path`**：同目录模块可直接 `import optimizer`，
  子目录可 `from utils import helper`，不需要你自己改 `sys.path`
  （首次自检即通过，见 [README.md](README.md) §5）。
- 不允许符号链接；包大小 ≤ 8 MB，文件数 ≤ 256。
- `manifest.json` 可选。如果提供，必须包含 `name` 与 `version`，且 `entry`（若写）只能是 `solver.py`。
- 不接受压缩包上传。请直接给出目录。

---

# 2. 启动契约（MUST）

平台用固定参数启动你的算法。**你看到的 `sys.argv` 形态是**：

```bash
python3 <你的包>/solver.py \
  --team A \
  --public  <沙箱>/input/public_state.json \
  --reveal  <沙箱>/input/reveal_state.json \
  --output  <沙箱>/output/result.json
```

Team B 只有 `--team B` 不同，其余完全相同。

因此 `solver.py` 必须接受四个参数：

```text
--team     "A" 或 "B"（只可能是这两个值）
--public   公开状态文件路径
--reveal   揭盲状态文件路径
--output   结果输出文件路径
```

**不要**：

- 假设工作目录是包的目录；
- 假设输入/输出是固定绝对路径（用参数给的值）；
- 从 stdin 读输入（V1.1 起输入**只**走文件）；
- 把结果写到 stdout（stdout 不是结果通道）。

最小骨架：

```python
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True)
    ap.add_argument("--public", required=True)
    ap.add_argument("--reveal", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.public, "rb") as f:
        public = json.loads(f.read().decode("utf-8"))
    with open(args.reveal, "r", encoding="utf-8") as f:
        reveal = json.load(f)

    dsl = build_function(args.team, public, reveal)   # 见 §5
    result = {"schema_version": "1.1", "dsl": dsl}

    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, args.output)

if __name__ == "__main__":
    sys.exit(main())
```

---

# 3. 输入：两份 JSON

每轮你会收到两份文件，路径由 `--public` / `--reveal` 给出。

| 文件 | 阶段 | 内容 |
|---|---|---|
| `public_state.json` | PRE-REVEAL | 场地边界 + 双方全部点位（**含死点**） |
| `reveal_state.json` | REVEAL | Shooter 编号 + 障碍物 + public 的哈希绑定 |

**字段细节见 [JSON_SCHEMA.md](JSON_SCHEMA.md)。**

要点：

- 两份文件对 A / B 双方**字节级完全相同**，队别只经 `--team` 传递。
- `points[].alive == false` 的点是**已死点**，不要再当目标。
- Shooter 的坐标不在 reveal 里：先取 `reveal["shooters"][team]` 得到 id，再回
  `public["points"]` 查坐标。
- public 里**没有**障碍物、没有地图种子。你在 REVEAL 之前不可能知道障碍物位置。

---

# 4. 输出：一份 JSON

写到 `--output` 指定的路径：

```json
{ "schema_version": "1.1", "dsl": <AST> }
```

- 顶层**只允许**这两个键，多一个就非法。
- `schema_version` 必须精确是字符串 `"1.1"`。
- `dsl` 是函数 AST，规范见 [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)。

**结果提交（SHOULD-STRONG）**：先写临时文件、`fsync`、再 `os.replace()` 原子替换。
不这样做时，平台可能在文件写了一半时读到它并判 `INVALID_OUTPUT`；
原子替换同时保证计时终点落在你「写完内容」的那一刻。

**每轮只允许一次正式输出**：以 `output/result.json` 的最终内容为准，不要写多份。

---

# 5. 函数合法性（MUST）

你的 `dsl` 必须同时满足：

1. **结构合法**：只用白名单的 14 种节点，元数精确，深度 ≤ 12，节点 ≤ 128，常数 ≤ 1000。
2. **经过 Shooter**：`|f(x_s) − y_s| ≤ 1e-6`。
3. **有限**：攻击范围内处处有限，`|f(x)| ≤ 1e6`。
4. **连续、C¹、C²**。
5. **凸性变号 ≤ 100**。
6. **定义域合法**：不出现除零、负数开方、非正取对数。

完整错误码与判定细节见 [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)。

**构造建议（SHOULD）**：把函数写成以 Shooter 为原点的增量形式：

```text
u = x − x_s
f(x) = y_s + g(u)，g(0) = 0
```

这样 `f(x_s) = y_s` 是恒等式，不受浮点误差影响。

示例（Team A，Shooter `S = (-14, 2)`，`f(x) = 2 + 0.3·(x + 14)`）：

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 2 },
    {
      "type": "mul",
      "args": [
        { "type": "number", "value": 0.3 },
        {
          "type": "sub",
          "args": [
            { "type": "variable", "value": "x" },
            { "type": "number", "value": -14 }
          ]
        }
      ]
    }
  ]
}
```

> `variable` 节点**必须**写 `{"type": "variable", "value": "x"}`。
> 写成 `{"type":"variable"}` 或 `{"type":"variable","name":"x"}` 都会被判非法。

---

# 6. 比赛规则（平台侧）

这些规则决定你的函数**是否命中**，你不需要实现它们，但需要理解它们才能选对策略。

| 项目 | 规则 |
|---|---|
| 场地 | `x ∈ [-20, 20]`，`y ∈ [-12, 12]` |
| A 队区域 | `x ∈ [-20, -4]` |
| B 队区域 | `x ∈ [4, 20]` |
| 攻击方向 | A 向 `+x`；B 向 `-x` |
| 有效攻击范围 | A：`x ∈ [x_s, 20]`；B：`x ∈ [-20, x_s]` |
| 命中判定 | `|f(x_p) − y_p| ≤ 1e-6`，且目标点在该方向上、且位于**首次障碍物接触之前** |
| 障碍物 | 函数轨迹先碰到障碍物 → 该次攻击被阻挡 |
| 先手 | 双方都完成计算后，**耗时更短**的一方先结算 |

> 「命中判定」的 1e-6 与「经过 Shooter」的 1e-6 是两个**不同**概念：
> 前者属于 Judge 规则，后者属于函数合法性。请不要把它们混用。

---

# 7. Runtime 与资源（MUST 遵守）

完整清单见 [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md)。核心事实：

| 项目 | 值 |
|---|---|
| Python | CPython 3.9.6 |
| 第三方包 | **无**（`numpy` / `scipy` / `sympy` / `torch` 等均不可用） |
| CPU | 1 核 |
| 线程 | 1（线程环境变量被钉为 1） |
| 内存 | 512 MB |
| 单轮超时 | 2000 ms |
| stdout | ≤ 256 KB，且不是结果通道 |
| stderr | ≤ 64 KB，可用于有限调试 |

数学计算请用标准库：`math` / `cmath` / `decimal` / `fractions` / `statistics` /
`random` / `itertools` / `functools`。

**禁止**：`pip install` / `conda install` 等任何安装行为（沙箱拒绝进程创建且无网络）。

---

# 8. 工作区与临时文件（MUST 遵守）

沙箱内可写的地方只有两处：

```text
output/     只用于写 result.json
当前工作目录  等价于 TMPDIR，可写，可放临时文件
```

**正确做法**：

```python
import tempfile

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    tmp = f.name
    f.write(json.dumps(result))
```

或直接用相对路径（相对当前工作目录）。

**不要硬编码**：

```text
/tmp
/work
/Users/...
```

这些路径要么不存在，要么被沙箱拒绝（`PermissionError`）。

**每轮沙箱都会销毁重建**：不要指望 Round 1 写的文件在 Round 2 还能读到。

---

# 9. 时间预算（MUST）

- 单轮计算时间上限 **2000 ms**，从你收到 `GO` 的时刻起算。
- 超过 2000 ms 未产出合法 `result.json` → 本轮 `TIMEOUT`。
- 双方**各自**从自己的 `GO` 时刻起算，不存在「共享一个时间戳」的说法。
- 写结果后请尽快退出；进程退出后平台不再等待。

常见的时间陷阱：

| 陷阱 | 建议 |
|---|---|
| 符号回归 / 进化搜索迭代太多次 | 先做预算检查，留出写文件的时间 |
| 用高次多项式或快速振荡函数 | 采样点数会爆（`OSCILLATION_LIMIT`） |
| 反复读大文件 | 输入文件很小，读一次即可 |
| 打印大量日志到 stdout | 有 256 KB 上限，超限判失败 |

---

# 10. 随机性与可复现（MAY）

如果策略需要随机搜索：

- 可以使用本地 PRNG；
- **不要**依赖外部随机服务（无网络）；
- 建议用本轮公开信息构造内部种子，例如 `match_id + round + team`；
- 不要试图使用隐藏地图种子 —— 你拿不到它。

---

# 11. MUST / SHOULD / MAY 一览

## MUST（不满足 → Preflight 失败 / Invalid Shot / Timeout / 违规）

| # | 要求 |
|---|---|
| M1 | 包根目录存在 `solver.py` |
| M2 | 接受 `--team / --public / --reveal / --output` 四个参数 |
| M3 | 从 `--public` / `--reveal` 读输入（不读 stdin） |
| M4 | 向 `--output` 写 `{"schema_version":"1.1","dsl":…}`，且只有这两个键 |
| M5 | DSL 结构合法（白名单 / 元数 / 深度 ≤12 / 节点 ≤128 / 常数 ≤1000） |
| M6 | `variable` 节点显式写 `"value": "x"` |
| M7 | `|f(x_s) − y_s| ≤ 1e-6` |
| M8 | 攻击范围内有限、连续、C¹、C²，凸性变号 ≤100 |
| M9 | 2000 ms 内完成并产出结果 |
| M10 | 不访问网络、不创建子进程、不读取对手或平台文件 |
| M11 | 不修改输入文件、不修改自己的包 |
| M12 | 不跨轮保存状态（沙箱每轮重建） |
| M13 | 不洪泛 stdout / stderr |
| M14 | 只用 [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) 列出的模块 |

## SHOULD（强烈建议，不影响接口合法性）

| # | 建议 | 理由 |
|---|---|---|
| S1 | 结果用临时文件 + 原子替换 | 避免被读到半截内容而判 `INVALID_OUTPUT` |
| S2 | 用 `f(x) = y_s + g(x − x_s)` 形式 | `f(x_s) = y_s` 成为恒等式，规避浮点误差 |
| S3 | 临时文件用 `tempfile` 或相对路径 | 硬编码路径会被沙箱拒绝 |
| S4 | 给计算留出写文件的时间预算 | 避免卡在 2000 ms 边界 |
| S5 | 用 stderr 打有限调试信息 | stdout 超限即失败 |
| S6 | 对 `points` 按 `alive` 过滤 | 死点不是合法目标 |

## MAY（可选策略）

| # | 选项 |
|---|---|
| Y1 | 用本轮公开信息构造随机种子做局部搜索 |
| Y2 | 解析式构造 + 数值微调 |
| Y3 | 针对障碍物做几何规避（如绕开障碍物区间） |
| Y4 | 多轮之间不共享状态，但用同一份代码自适应不同局面 |

---

# 12. 本地自检（SHOULD）

提交前先跑：

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```

它会用**与官方 Preflight 相同**的 parser / validator 和沙箱执行路径检查你的包，
并逐项报告：

```text
Entrypoint        PASS
Package           PASS
CLI / startup     PASS
Runtime           PASS
Input             PASS
Result JSON       PASS
DSL               PASS
Function legality PASS
Timeout           PASS
```

失败时会给出可读原因（例如 `NOT_THROUGH_SHOOTER` 会打印残差与容差）。

> 该工具需要 Node.js（比赛仓库自带）。它在仓库根目录运行时可用。

---

# 13. 官方 Preflight

正式提交后平台会执行 Preflight，检查内容包括：

```text
Package structure / solver.py / Python startup / CLI arguments
Decoy Public JSON / Decoy Reveal JSON / Result JSON / DSL validity
Runtime / Timeout / Sandbox compatibility
```

Preflight 使用**独立的 decoy 世界**（种子由 `matchId` 派生），
与本轮比赛的障碍物无关，因此它不会泄漏任何隐藏信息。

Preflight `PASS` 后算法才进入 `READY` 状态。

---

# 14. 错误信息怎么读

平台会把失败原因原样告诉你，例如：

```text
缺少固定入口 solver.py（V1.1 §3：包根目录必须存在该文件）
算法输出不合法: 输出不是合法 DSL: FORBIDDEN_OPERATOR: 运算符 "abs" 被禁止
算法输出不合法: 输出不是合法 DSL: DEPTH_LIMIT: AST 深度超过限制 12（在第 13 层拒绝，未展开）
算法输出不合法: 输出不是合法 DSL: NOT_THROUGH_SHOOTER: f(-15.33) = 0，与 Shooter y = 7.707 相差 7.708e+0 > ε=0.000001
算法超时（>2000ms 内未生成合法的 output/result.json）
```

如果 Python 抛异常，你会看到 traceback 的**头与尾**（中间的调用帧会被省略），
根因（`ModuleNotFoundError` / `SyntaxError` / 你的异常消息）一定保留在尾部。

---

# 15. 比赛终止与 Stalemate

```text
STALEMATE RULE: NOT YET IMPLEMENTED
```

当前引擎的**正式规则**只有：

```text
ELIMINATION   —— 一方全部点位被击杀
```

**尚未实现**（属于拟议规则，不是当前生效规则）：

```text
STALEMATE           —— 双方都无法推进时的自动判定
MAX_NO_PROGRESS_ROUNDS
MAX_TOTAL_ROUNDS
```

也就是说：

- 当双方都存活时，引擎**不会自行宣布胜者**；
- 如果一场比赛跑满外部设置的最大轮数仍未分出胜负，平台会报告 `UNDECIDED`，
  由裁判按赛事规则裁定 —— 这不是比赛规则的一部分，而是测试/运行时的外部限制。

算法不需要判断比赛是否结束，每轮只根据当前输入求解即可。

---

# 16. 禁止事项

以下行为属于违规：

```text
1.  网络访问 / 调用在线服务
2.  创建子进程（subprocess / multiprocessing 会被沙箱拒绝）
3.  读取对手算法、平台源码或 Judge 源码
4.  修改比赛 JSON 或结果时间戳
5.  跨 Round 保存状态
6.  启动后台 daemon
7.  洪泛 stdout / stderr
8.  修改自己的包或输入文件
9.  输出分段 / 非法 DSL（if / abs / min / max / floor 等）
10. 依赖 RUNTIME_MANIFEST.md 之外的第三方包
```

沙箱会**技术性地**阻止其中大部分（进程创建、网络、越权读写、修改时间戳），
但「沙箱拦住了」不等于「允许尝试」。请按规则写算法。

---

# 17. 提交前检查清单

```text
[ ] 包根目录有 solver.py
[ ] 四个参数都能正常解析
[ ] 输入只从 --public / --reveal 读取
[ ] 结果写到 --output，且只有 schema_version + dsl
[ ] schema_version 是 "1.1"
[ ] variable 节点写了 value: "x"
[ ] 函数严格经过 Shooter（建议用增量形式）
[ ] 攻击范围内有限、连续、C²、凸性 ≤100
[ ] 没有使用任何第三方包
[ ] 临时文件用 tempfile / 相对路径
[ ] 结果用原子替换写入
[ ] 单轮耗时留有余量（< 2000 ms）
[ ] 不访问网络、不创建进程
[ ] 本地自检 PASS
```

---

# 18. 示例

- 最小可运行模板：[starter/solver.py](starter/solver.py)
- 真实输入输出样例：[examples/](examples/)
- DSL 合法 / 非法示例：[DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)

## Starter 的策略

Starter 做的事情很简单（它只是**接口正确**的示例，不追求强度）：

1. 从 `reveal["shooters"][team]` 取自己的 Shooter id；
2. 回 `public["points"]` 查它的坐标；
3. 在存活敌人里选一个目标（默认选 |Δy| 最小的）；
4. 构造一条**严格经过 Shooter** 的直线，斜率做限幅，避免冲出场地；
5. 原子写入 `result.json`。

直线是 C^∞ 的，凸性变号为 0，天然满足全部函数合法性规则 —— 这正是它的价值：
**先把接口跑通，再谈策略。**
