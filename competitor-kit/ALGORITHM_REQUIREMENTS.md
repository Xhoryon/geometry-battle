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

- 函数必须经过你自己的**固定 Emitter**；
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
| `public_state.json` | PUBLIC | 场地边界 + **固定 Emitter 坐标** + 双方全部**战斗点**（含死点） |
| `reveal_state.json` | REVEAL | 障碍物 + public 的哈希绑定 |

**字段细节见 [JSON_SCHEMA.md](JSON_SCHEMA.md)。**

要点：

- 两份文件对 A / B 双方**字节级完全相同**，队别只经 `--team` 传递。
- `points[].alive == false` 的点是**已死点**，不要再当目标。
- 发射锚点在 `public["emitters"][team]` 里**直接给出坐标**（`{"x":…,"y":…}`），
  整场比赛都是同一个值。`points` 里没有 Emitter。
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
2. **经过 Emitter**：`|f(x_emitter) − y_emitter| ≤ 1e-6`（Rule Revision 3 §4）。
3. **有限**：攻击范围内处处有限，`|f(x)| ≤ 1e6`。
4. **连续、C¹、C²**。
5. **凸性变号 ≤ 100**。
6. **定义域合法**：不出现除零、负数开方、非正取对数。

完整错误码与判定细节见 [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)。

**构造建议（SHOULD）**：把函数写成以 Emitter 为原点的增量形式：

```text
u = x − x_emitter
f(x) = y_emitter + g(u)，g(0) = 0
```

这样 `f(x_emitter) = y_emitter` 是恒等式，不受浮点误差影响。

Emitter 坐标是**常量**（A：`(-18, 0)`，B：`(18, 0)`），因此 `u = x + 18`（A 队）
或 `u = x − 18`（B 队）可以直接写进代码，也可以从 `public_state.emitters` 读。

示例（Team A，Emitter `(-18, 0)`，`f(x) = 0 + 0.3·(x + 18)`）：

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 0 },
    {
      "type": "mul",
      "args": [
        { "type": "number", "value": 0.3 },
        {
          "type": "sub",
          "args": [
            { "type": "variable", "value": "x" },
            { "type": "number", "value": -18 }
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
| **固定 Emitter** | A：`(-18, 0)`；B：`(18, 0)`。**整场比赛不变**，本轮发射锚点 |
| 攻击方向 | A 向 `+x`；B 向 `-x` |
| 有效攻击范围 | A：`x ∈ [-18, 20]`；B：`x ∈ [-20, 18]` |
| 命中判定 | `|f(x_p) − y_p| ≤ 1e-6`，且目标点在该方向上、且位于**首次终止事件之前** |
| 障碍物 | 轨迹**第一次**接触障碍物即终止；接触点**之前**的点可被命中，接触点及其之后不受影响 |
| **场地边界** | 轨迹**第一次**离开 `y ∈ [-12, 12]` 即**永久终止**；此后即使函数重新进入场地，攻击也**不恢复**；终止点之后的敌人不可命中。x 方向同理（`x ∉ [-20, 20]`） |
| 先手 | 双方都完成计算后，**耗时更短**的一方先结算 |
| 攻击权 | **START 之后双方各获得一次本轮独立且不可撤销的攻击权**（见下） |
| 胜负 | 只看**战斗点**。一方战斗点全灭、另一方仍有 → 该方胜；双方同轮全灭 → **DRAW** |

> 「命中判定」的 1e-6 与「经过 Emitter」的 1e-6 是两个**不同**概念：
> 前者属于 Judge 规则，后者属于函数合法性。请不要把它们混用。

## 6.1 固定 Emitter：本轮的发射锚点

每支队伍有一个**固定 Emitter**，它在整场比赛中：

```text
固定        坐标不变，所有轮次都是同一个点
公开        从第 1 轮的 public_state.json 起就能看到（emitters.A / emitters.B）
不可更换    不由任何人选择，也不随回合变化
不可击杀    它不是战斗点，轨迹穿过它不产生任何效果
```

因此你的每一轮函数都必须满足：

```text
|f(x_emitter) − y_emitter| ≤ 1e-6      ← Emitter 是常量，这个约束每轮完全一样
```

`f(x) = y_emitter + g(x − x_emitter)` 这种以 Emitter 为原点的增量写法最省事。

### 攻击权在 START 时锁定

- **对方打掉你一个战斗点，不会取消你本轮的攻击。** START 之后双方的攻击权就已锁定：
  只要你在自己的时间预算内交出了合法函数，你的攻击**照样执行**。
- 攻击**不执行**的唯一原因是算法侧的问题：`TIMEOUT`、`INVALID`、`CRASH`。
- 本轮不重算：`public_state.json` / `reveal_state.json` 在 START 后冻结，
  不因第一击的结果而改变。

### Emitter 不是打击目标

`points` 里**只有战斗点**，Emitter 不在其中。**不要去瞄对方的 Emitter** ——
它不可击杀，打它不产生任何收益。要把对方的战斗点清零，只能打 `points` 里那些点。

> 规则沿革：早期 V1.1 试玩规则曾规定「先手击杀对方 Shooter ⇒ 对方本轮攻击取消」，
> 经实测造成严重的策略坍缩（速度成为胜负的唯一通道），已由人类决定废止。
> 之后一度改为「每轮选一个存活点当 Shooter」；**现行规则**进一步把锚点固定成
> 常量 Emitter，Shooter Selection 这一整个流程已被删除。
> 标记为 **V1.1 Playtest Rules — Revision 3**。

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
| 单轮超时 | **500 ms**（Rule Revision 3 §11） |
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

- 单轮计算时间上限 **500 ms**，从你收到 `GO` 的时刻起算。
- 超过 500 ms 未产出合法 `result.json` → 本轮 `TIMEOUT`。
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
| M9 | 500 ms 内完成并产出结果 |
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
| S4 | 给计算留出写文件的时间预算 | 避免卡在 500 ms 边界 |
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
算法输出不合法: 输出不是合法 DSL: NOT_THROUGH_SHOOTER: f(-18) = 0，与 Emitter y = 7.707 相差 7.708e+0 > ε=0.000001
算法超时（>500ms 内未生成合法的 output/result.json）
```

如果 Python 抛异常，你会看到 traceback 的**头与尾**（中间的调用帧会被省略），
根因（`ModuleNotFoundError` / `SyntaxError` / 你的异常消息）一定保留在尾部。

---

# 15. 比赛终止（Revision 3 起已全部实现）

**每场合法比赛都在有限时间内终止。** 引擎自己保证这一点 —— 不依赖任何外部参数。
比赛结束的可能方式**穷举**如下：

| `endReason` | 含义 | 结果 |
|---|---|---|
| `ELIMINATION` | 一方战斗点全灭、另一方仍有 | 另一方获胜 |
| `MUTUAL_ELIMINATION` | 同一轮结束后双方战斗点**同时**归零 | **DRAW** |
| `STALEMATE` | 连续 **20** 个回合双方都没能击杀任何一个点 | **DRAW** |
| `HARD_ROUND_LIMIT` | 到达硬回合上限 **60** | **DRAW** |

补充说明：

- **同归于尽是可能的**：先手清零对方、后手凭已锁定的攻击权再清零先手方 → DRAW。
  先手**不会**因为「先动手」而被判胜。
- **僵持会被判和**：如果局面冻结（双方都打不动对方），20 个连续零击杀回合后判 DRAW；
  无论局面如何，第 60 回合一定结束。
- 没有 `UNDECIDED` 这个状态了 —— 它是旧版本里「外部轮数上限」的产物。

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
[ ] 函数严格经过自己的固定 Emitter（建议用增量形式）
[ ] 攻击范围内有限、连续、C²、凸性 ≤100
[ ] 没有使用任何第三方包
[ ] 临时文件用 tempfile / 相对路径
[ ] 结果用原子替换写入
[ ] 单轮耗时留有余量（< 500 ms）
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

1. 从 `public["emitters"][team]` 取自己的固定 Emitter 坐标 —— 它是常量，
   **不在 `points` 里**，不需要（也无法）去点表里查；
2. 在存活敌人里选一个目标（默认选 |Δy| 最小的）；
3. 构造一条**严格经过自己的 Emitter** 的直线，斜率做限幅，避免冲出场地；
4. 原子写入 `result.json`。

直线是 C^∞ 的，凸性变号为 0，天然满足全部函数合法性规则 —— 这正是它的价值：
**先把接口跑通，再谈策略。**
