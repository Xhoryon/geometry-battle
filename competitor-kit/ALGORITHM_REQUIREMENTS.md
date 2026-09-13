<!-- bilingual-doc: zh-CN + en-US -->

# Geometry Battle V1.1 — 参赛算法开发要求

> 本文件是**正式发布版**参赛要求。它与平台实现（parser / validator / sandbox / preflight）
> 逐条对齐，并由 `tests/competitor-kit.ts` 持续核对。
> 文中提到的每一个文件、工具、规范都真实存在于 `competitor-kit/`。

# Geometry Battle V1.1 — Competitor Algorithm Requirements

> This is the **official release** of competitor requirements. It is aligned line-by-line with the platform
> implementation (parser / validator / sandbox / preflight) and continuously verified by `tests/competitor-kit.ts`.
> Every file, tool, and specification mentioned exists in `competitor-kit/`.

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
| [tools/check_mirror.py](tools/check_mirror.py) | 镜像自检（开发诊断：同一份代码在 A / B 两侧是否一致，见 §6.2） |

# 0. One-Minute Overview

You have exactly one thing to build:

```text
Write a solver.py
```

Each round it receives the current state (public state + reveal information) and outputs a **mathematical function** `f(x)`:

- The function MUST pass through your own **fixed Emitter**;
- The function must hit opponent positions in the attack direction;
- The function must avoid obstacles;
- The function must be finite, continuous, C², with limited convexity changes.

The platform handles maps, adjudication, timing, animation, win/loss — you do **not** implement these.

| Resource | Purpose |
|---|---|
| [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) | Python & modules available in sandbox (**zero third-party packages**) |
| [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md) | Complete DSL specification with legal/illegal examples |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | Field structure of the three JSON files |
| [starter/solver.py](starter/solver.py) | Minimal runnable template |
| [examples/](examples/) | Real engine input/output samples |
| [tools/validate_submission.py](tools/validate_submission.py) | Local validation tool |
| [tools/check_mirror.py](tools/check_mirror.py) | Mirror self-check (dev diagnostic: whether same code behaves identically on A / B sides, see §6.2) |

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

# 1. Submission Format

**Submission = one algorithm directory** (not a zip).

```text
my-algorithm/
├── solver.py          ← MUST exist, MUST be at directory root
├── optimizer.py       ← Optional: your own modules
└── utils/             ← Optional: your own subdirectories
```

Rules:

- Entry filename is **fixed** as `solver.py` and MUST be at package **root** (no nested subdirectory allowed).
- May include your own `.py` modules, `.json` / `.txt` / `.csv` / `.yaml` / `.md` data files.
- **Package root is added to `sys.path`**: same-directory modules can `import optimizer` directly,
  subdirectories can `from utils import helper`, no need to modify `sys.path` yourself
  (passes validation on first check, see [README.md](README.md) §5).
- Symlinks not allowed; package size ≤ 8 MB, file count ≤ 256.
- `manifest.json` optional. If provided, MUST contain `name` and `version`, and `entry` (if written) can only be `solver.py`.
- No compressed archive uploads. Provide directory directly.

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

# 2. Launch Contract (MUST)

The platform launches your algorithm with fixed parameters. **The `sys.argv` form you see is**:

```bash
python3 <your-package>/solver.py \
  --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```

Team B differs only in `--team B`; everything else is identical.

Therefore `solver.py` MUST accept four parameters:

```text
--team     "A" or "B" (only these two values possible)
--public   Public state file path
--reveal   Reveal state file path
--output   Result output file path
```

**Do NOT**:

- Assume working directory is the package directory;
- Assume input/output are fixed absolute paths (use the parameter values);
- Read input from stdin (V1.1 onwards input **only** via files);
- Write results to stdout (stdout is not the result channel).

Minimal skeleton:

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

    dsl = build_function(args.team, public, reveal)   # see §5
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

# 3. Input: Two JSON Files

Each round you receive two files, paths given by `--public` / `--reveal`.

| File | Phase | Contents |
|---|---|---|
| `public_state.json` | PUBLIC | Field boundaries + **fixed Emitter coordinates** + all **combat points** from both sides (including dead) |
| `reveal_state.json` | REVEAL | Obstacles + hash binding to public |

**Field details in [JSON_SCHEMA.md](JSON_SCHEMA.md).**

Key points:

- Both files are **byte-identical** for teams A and B; team identity only via `--team`.
- Points with `points[].alive == false` are **dead points**; do not target them.
- Launch anchor is **given directly as coordinates** in `public["emitters"][team]` (`{"x":…,"y":…}`),
  same value throughout the match. Emitter is not in `points`.
- public has **no** obstacles, no map seed. You cannot know obstacle positions before REVEAL.

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

# 4. Output: One JSON File

Write to the path specified by `--output`:

```json
{ "schema_version": "1.1", "dsl": <AST> }
```

- Top level **only allows** these two keys; one extra key is illegal.
- `schema_version` MUST be exactly the string `"1.1"`.
- `dsl` is the function AST, specification in [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md).

**Result submission (SHOULD-STRONG)**: Write temporary file first, `fsync`, then atomic replace with `os.replace()`.
Without this, platform may read the file mid-write and judge `INVALID_OUTPUT`;
atomic replace also ensures timing endpoint falls at the moment you "finish writing content".

**Only one official output per round**: final content of `output/result.json` is authoritative; do not write multiple copies.

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

> **Emitter 坐标不是常量。** 它由每支队伍在每场比赛开始前，从**自己的初始点**里
> 选定并锁定（见 [§6.1](#61-固定-emitter本场选定后整场不变)）。因此**必须**
> 从 `public_state.emitters[team]` 读，不要写死任何坐标。
>
> 锁定之后它整场不变 —— `public_state.emitters` 在同一场比赛的每一轮里都一样。

示例（Team A，Emitter 记为 `(x_e, y_e)`，`f(x) = y_e + 0.3·(x − x_e)` 展开后
`y_e = 0`、`x_e = −18` 的情形；**实际数值请从 `public_state.emitters` 取**）：

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

# 5. Function Legality (MUST)

Your `dsl` MUST simultaneously satisfy:

1. **Structural legality**: Only whitelisted 14 node types, exact arity, depth ≤ 12, nodes ≤ 128, constants ≤ 1000.
2. **Through Emitter**: `|f(x_emitter) − y_emitter| ≤ 1e-6` (Rule Revision 3 §4).
3. **Finite**: Finite everywhere in attack range, `|f(x)| ≤ 1e6`.
4. **Continuous, C¹, C²**.
5. **Convexity sign changes ≤ 100**.
6. **Domain legality**: No division by zero, no square root of negative, no log of non-positive.

Complete error codes and adjudication details in [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md).

**Construction suggestion (SHOULD)**: Write function in incremental form with Emitter as origin:

```text
u = x − x_emitter
f(x) = y_emitter + g(u), g(0) = 0
```

This way `f(x_emitter) = y_emitter` is an identity, unaffected by floating-point error.

> **Emitter coordinates are not constants.** Each team selects and locks one from **their own initial points**
> before each match starts (see [§6.1](#61-固定-emitter本场选定后整场不变)). Therefore you MUST
> read from `public_state.emitters[team]`; do not hardcode any coordinates.
>
> After locking it stays constant throughout the match — `public_state.emitters` is identical every round of the same match.

Example (Team A, Emitter denoted `(x_e, y_e)`, `f(x) = y_e + 0.3·(x − x_e)` expanded with
`y_e = 0`, `x_e = −18`; **read actual values from `public_state.emitters`**):

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

> `variable` node **MUST** be written as `{"type": "variable", "value": "x"}`.
> Writing `{"type":"variable"}` or `{"type":"variable","name":"x"}` will be judged illegal.

---

# 6. 比赛规则（平台侧）

这些规则决定你的函数**是否命中**，你不需要实现它们，但需要理解它们才能选对策略。

| 项目 | 规则 |
|---|---|
| 场地 | `x ∈ [-20, 20]`，`y ∈ [-12, 12]` |
| A 队区域 | `x ∈ [-20, -4]` |
| B 队区域 | `x ∈ [4, 20]` |
| **固定 Emitter** | 每队**开赛前从自己的初始点选定一个**并锁定；整场比赛不变。坐标见 `public_state.emitters[team]` |
| 攻击方向 | A 向 `+x`；B 向 `-x`（方向、遍历与数组顺序的完整说明见 §6.2） |
| 有效攻击范围 | A：`x ∈ [x_e, 20]`；B：`x ∈ [-20, x_e]`，其中 `x_e` 是本队 Emitter 的 x 坐标 |
| 命中判定 | `|f(x_p) − y_p| ≤ 1e-6`，且目标点在该方向上、且位于**首次终止事件之前** |
| 障碍物 | 轨迹**第一次**接触障碍物即终止；接触点**之前**的点可被命中，接触点及其之后不受影响 |
| **场地边界** | 轨迹**第一次**离开 `y ∈ [-12, 12]` 即**永久终止**；此后即使函数重新进入场地，攻击也**不恢复**；终止点之后的敌人不可命中。x 方向同理（`x ∉ [-20, 20]`） |
| 先手 | 双方都完成计算后，**耗时更短**的一方先结算 |
| 攻击权 | **START 之后双方各获得一次本轮独立且不可撤销的攻击权**（见下） |
| 胜负 | 只看**战斗点**。一方战斗点全灭、另一方仍有 → 该方胜；双方同轮全灭 → **DRAW** |

> 「命中判定」的 1e-6 与「经过 Emitter」的 1e-6 是两个**不同**概念：
> 前者属于 Judge 规则，后者属于函数合法性。请不要把它们混用。

# 6. Match Rules (Platform Side)

These rules determine whether your function **hits**; you do not implement them, but need to understand them to choose the right strategy.

| Item | Rule |
|---|---|
| Field | `x ∈ [-20, 20]`, `y ∈ [-12, 12]` |
| Team A zone | `x ∈ [-20, -4]` |
| Team B zone | `x ∈ [4, 20]` |
| **Fixed Emitter** | Each team **selects one from their own initial points before match start** and locks it; constant throughout match. Coordinates in `public_state.emitters[team]` |
| Attack direction | A towards `+x`; B towards `-x` (full explanation of direction, traversal, and array order in §6.2) |
| Valid attack range | A: `x ∈ [x_e, 20]`; B: `x ∈ [-20, x_e]`, where `x_e` is this team's Emitter x coordinate |
| Hit determination | `|f(x_p) − y_p| ≤ 1e-6`, and target point is in that direction and located **before first termination event** |
| Obstacles | Trajectory terminates on **first** contact with obstacle; points **before** contact point can be hit, contact point and after are unaffected |
| **Field boundary** | Trajectory **permanently terminates** on **first** exit from `y ∈ [-12, 12]`; even if function re-enters field, attack does **not resume**; enemies after termination point cannot be hit. Same for x direction (`x ∉ [-20, 20]`) |
| Initiative | After both sides complete calculation, side with **shorter time** adjudicates first |
| Attack rights | **After START both sides each gain one independent and irrevocable attack right for this round** (see below) |
| Victory/defeat | Only **combat points** count. One side's combat points eliminated while other still has some → that side wins; both eliminated same round → **DRAW** |

> The 1e-6 in "hit determination" and the 1e-6 in "through Emitter" are two **different** concepts:
> the former belongs to Judge rules, the latter to function legality. Please do not conflate them.

## 6.1 固定 Emitter：本场选定后整场不变

每支队伍有一个**固定 Emitter**。它由**你们自己**在开赛前选定 ——
从本队初始点里挑一个，点下去，然后锁定（比赛页上按 `Lock`）：

```text
本场选定    从**本方初始点**里选一个；选定前比赛不会开始
整场不变    一经锁定，本场所有轮次都是同一个点，不可更换
公开        双方**都锁定之后**，两个坐标才会公开
            （对方锁定前你看不到它的选择，它也看不到你的）
不可击杀    它不是战斗点；轨迹穿过它不产生任何效果
```

**被选为 Emitter 的那个点会从 `points` 里移除** —— 它从此不是战斗点。
所以你一队 8 个初始点、选了 1 个当 Emitter 之后，场上本队的战斗点只剩 7 个，
对方的击杀目标也相应少一个。这是**策略的一部分**：拿一个点换一个更有利的发射位置。

因此你的每一轮函数都必须满足：

```text
|f(x_e) − y_e| ≤ 1e-6      ← (x_e, y_e) 是**本场**的 Emitter，逐场不同
```

`f(x) = y_e + g(x − x_e)` 这种以 Emitter 为原点的增量写法最省事，
而且天然不受坐标变化影响 —— 换一场比赛换个锚点，这段代码一个字都不用改。

**读 Emitter 的唯一正确方式：**

```python
s = public["emitters"][a.team]      # {"x": ..., "y": ...}
x_e, y_e = s["x"], s["y"]
```

不要写死 `-18` / `18`，也不要假设它落在场地中央某处。

## 6.1 Fixed Emitter: Selected for This Match, Constant Throughout

Each team has one **fixed Emitter**. It is selected by **you yourselves** before match start —
pick one from your own initial points, click it, then lock (press `Lock` on match page):

```text
Selected per match   Pick one from **your side's initial points**; match won't start until selected
Constant throughout  Once locked, same point for all rounds of this match, cannot change
Public              Two coordinates only public **after both sides lock**
                    (you cannot see opponent's choice before they lock, they cannot see yours)
Unkillable          Not a combat point; trajectory passing through it produces no effect
```

**The point selected as Emitter is removed from `points`** — it is no longer a combat point.
So if your team has 8 initial points and selects 1 as Emitter, your team's combat points on field are only 7,
and opponent's kill targets correspondingly one fewer. This is **part of strategy**: trade one point for a more favorable launch position.

Therefore your function every round MUST satisfy:

```text
|f(x_e) − y_e| ≤ 1e-6      ← (x_e, y_e) is **this match's** Emitter, varies per match
```

`f(x) = y_e + g(x − x_e)` this incremental form with Emitter as origin is most convenient,
and naturally unaffected by coordinate changes — switch match, switch anchor, this code needs zero modification.

**The only correct way to read Emitter:**

```python
s = public["emitters"][a.team]      # {"x": ..., "y": ...}
x_e, y_e = s["x"], s["y"]
```

Do not hardcode `-18` / `18`, and do not assume it falls at field center somewhere.

### 攻击权在 START 时锁定

- **对方打掉你一个战斗点，不会取消你本轮的攻击。** START 之后双方的攻击权就已锁定：
  只要你在自己的时间预算内交出了合法函数，你的攻击**照样执行**。
- 攻击**不执行**的唯一原因是算法侧的问题：`TIMEOUT`、`INVALID`、`CRASH`。
- 本轮不重算：`public_state.json` / `reveal_state.json` 在 START 后冻结，
  不因第一击的结果而改变。

### Attack Rights Lock at START

- **Opponent eliminating one of your combat points does not cancel your attack this round.** After START both sides' attack rights are locked:
  as long as you submit a legal function within your time budget, your attack **executes normally**.
- Attack **not executing** has only one reason: algorithm-side issues: `TIMEOUT`, `INVALID`, `CRASH`.
- Round does not recalculate: `public_state.json` / `reveal_state.json` freeze after START,
  do not change due to first strike result.

### Emitter 不是打击目标

`points` 里**只有战斗点**，Emitter 不在其中。**不要去瞄对方的 Emitter** ——
它不可击杀，打它不产生任何收益。要把对方的战斗点清零，只能打 `points` 里那些点。

> 规则沿革：早期 V1.1 试玩规则曾规定「先手击杀对方 Shooter ⇒ 对方本轮攻击取消」，
> 经实测造成严重的策略坍缩（速度成为胜负的唯一通道），已由人类决定废止。
> 之后一度改为「每轮选一个存活点当 Shooter」，再后来把锚点固定成常量 Emitter。
> **现行 V1.2 规则**把锚点**交还给队伍**：开赛前双方各自从本方点里选一个并锁定，
> 整场不变 —— 于是「从哪里开火」重新成为一个可以经营的策略维度，
> 而「逐轮选点」那套流程仍然不存在。

### Emitter Is Not a Strike Target

`points` contains **only combat points**; Emitter is not among them. **Do not aim at opponent's Emitter** —
it is unkillable, hitting it produces no benefit. To zero out opponent's combat points, can only hit those points in `points`.

> Rule evolution: Early V1.1 playtest rules once specified "initiative eliminates opponent Shooter ⇒ opponent's attack this round cancelled",
> which empirically caused severe strategy collapse (speed became the only path to victory), decided by humans to abolish.
> Later changed to "each round select one living point as Shooter", then later fixed anchor as constant Emitter.
> **Current V1.2 rules** return anchor **to teams**: before match start both sides each select one from their own points and lock,
> constant throughout match — thus "from where to fire" becomes a strategy dimension that can be cultivated again,
> while the "per-round point selection" process still does not exist.

## 6.2 坐标方向与镜像 / Orientation & Symmetry

> V1.4 新增的**说明**，不改变任何规则 —— 它只是把引擎一直以来的行为写清楚。
> 上面 §6 表格里「攻击方向」「有效攻击范围」两行就是本节的浓缩版。
> **English.** Added in V1.4 as an explanation only — no rule changes; it spells out what the engine has always done.

```text
Team A 的前进方向 = x 增大 / Team A forward direction = increasing x
Team B 的前进方向 = x 减小 / Team B forward direction = decreasing x
```

### 6.2.1 函数 vs 遍历 / Function vs traversal

你交出的始终是一个普通的数学函数 `y = f(x)`：它对任何 `x` 都有定义，本身**没有方向**。
方向来自 Judge 的**遍历**方式：

- Team A：从 `x = x_e` 出发向 `x = 20` 遍历（x 增大）；遍历区间 `[x_e, 20]`。
- Team B：从 `x = x_e` 出发向 `x = -20` 遍历（x 减小）；遍历区间 `[-20, x_e]`。
- 遍历区间就是「有效攻击范围」—— 函数合法性（§5）只在这段区间上校验，区间之外的 `f(x)` 平台不看。
  合法性校验的采样也从本队 Emitter 出发、沿进攻方向推进（V1.4 起对双方一致）。
- 遍历在**首次终止事件**处停止：第一次接触任何障碍物，或第一次离开场地
  （`y ∉ [-12, 12]` 或 `x ∉ [-20, 20]`）；之后即使函数重新回到场内，攻击也不恢复。
- 「首次接触**之前**」是相对于遍历方向说的：对 A 是 `x` 更小的一侧，对 B 是 `x` 更**大**的一侧。
  同理，「目标位于攻击方向上」对 A 意味着 `x_p ≥ x_e`，对 B 意味着 `x_p ≤ x_e`。

**English.** What you submit is always an ordinary function `y = f(x)` — it is defined for every `x`
and has no direction of its own. Direction comes from how the Judge **traverses** it: Team A walks from
`x = x_e` towards `x = 20` (increasing x) over `[x_e, 20]`; Team B walks from `x = x_e` towards `x = -20`
(decreasing x) over `[-20, x_e]`. That traversal interval is the firing domain — function legality (§5) is
checked only there — and its sampling also starts at your own Emitter and walks in the attack direction (identical for both sides since V1.4). Traversal stops at the **first termination event**: the first contact with any obstacle,
or the first exit from the field (`y ∉ [-12, 12]` or `x ∉ [-20, 20]`); the attack does not resume even if the
graph re-enters the field. "Before the first contact" is direction-relative: for A it means smaller x, for B
it means **larger** x. Likewise "in the attack direction" means `x_p ≥ x_e` for A and `x_p ≤ x_e` for B.

**建议（SHOULD，不是强制 API）**：在算法内部统一用一个**局部前进坐标** `u`，让两侧共用同一套代码：

```text
Team A：u = x − x_e          Team B：u = x_e − x
前进方向恒为 +u；敌人 / 障碍物的坐标先换算到 u，再做几何
```

把 `u` 空间里算好的多项式（或任何满足 `g(0) = 0` 的 `g(u)`）换回 `x` 的 AST 时，
**只有 `u` 这个节点随队别变化**：

```python
def u_node(team, x_e):
    X = {"type": "variable", "value": "x"}
    E = {"type": "number", "value": x_e}
    # A: u = x − x_e        B: u = x_e − x
    return {"type": "sub", "args": [X, E]} if team == "A" else {"type": "sub", "args": [E, X]}

def poly_in_u(team, x_e, y_e, coeffs):
    """f(x) = y_e + c1·u + c2·u² + …（没有常数项，所以 f(x_e) = y_e 恒成立）"""
    u = u_node(team, x_e)
    node = {"type": "number", "value": y_e}
    for k, c in enumerate(coeffs, start=1):
        term = {"type": "mul", "args": [{"type": "number", "value": c},
                                        {"type": "pow", "args": [u, {"type": "number", "value": k}]}]}
        node = {"type": "add", "args": [node, term]}
    return node
```

**English.** Recommended (SHOULD — not a mandatory API): work internally in a local forward coordinate
`u` — `u = x − x_e` for Team A, `u = x_e − x` for Team B — so that "forward" is always `+u` and both sides
share one code path. When turning a `u`-space polynomial (or any `g(u)` with `g(0) = 0`) back into an `x`
AST, the only team-dependent node is `u` itself: `sub(x, x_e)` for A versus `sub(x_e, x)` for B, exactly as
in the sketch above.

Team B 的直线示例（`f(x) = y_e + 0.3·(x_e − x)`，举例取 `x_e = 18`、`y_e = 0`；
**实际数值请从 `public_state.emitters.B` 取**）：

<!-- AST-PARSE-OK -->
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
            { "type": "number", "value": 18 },
            { "type": "variable", "value": "x" }
          ]
        }
      ]
    }
  ]
}
```

> 与 §5 的 Team A 示例对照：同样是「沿前进方向每单位上升 0.3」的直线，用 `x` 写出来斜率符号相反。
> **English.** Compare with the Team A example in §5: the same "rises 0.3 per unit forward" line has the
> opposite slope once it is written in `x`.

### 6.2.2 数组顺序保证 / Array-order guarantees

引擎对 `public_state.points` 与 `reveal_state.obstacles` 的顺序**只**保证下面这些：

| 数组 | 保证 |
|---|---|
| `points` | 先是 Team A 的全部条目，再是 Team B 的全部条目；组内按地图**生成 / 放置顺序**（`A1, A2, …`、`B1, B2, …`），**不**按 x、不按到 Emitter 的距离、不按任何几何量排序 |
| `points` | 整场比赛**每一轮顺序相同、条目数相同**：被击杀的点**留在原位**，只把 `alive` 置为 `false` |
| `points` | 被锁定为 Emitter 的两个点被**移除**，其余编号**不重新编号** —— 所以 `A1` 可能从头到尾不存在，编号也不一定连续 |
| `obstacles` | 按生成顺序编号 `O1..On`，整场每轮都是同一个数组 |

**不要假设数组顺序代表 x 从小到大、离 Emitter 从近到远，或任何其它几何排序。**
要按几何选目标，就自己按 `x` / `u` / 距离排序。

**English.** The engine guarantees exactly this about `public_state.points` and `reveal_state.obstacles`:
`points` lists all Team A entries first, then all Team B entries, each group in map **generation / placement
order** (`A1, A2, …`, `B1, B2, …`) — **not** sorted by x, by distance to the Emitter, or by any other
geometric quantity; the order and the entry count are identical every round of the match (killed points stay
in place with `alive: false`); the two points locked as Emitters are removed and the remaining ids are **not
renumbered**, so `A1` may be absent for the whole match and ids need not be contiguous; `obstacles` are
numbered `O1..On` in generation order and the array is the same every round.
**Do not assume array order is geometric order.** If you want targets by geometry, sort by `x` / `u` /
distance yourself.

### 6.2.3 双侧兼容（MUST） / Both-side compatibility (MUST)

**同一正式提交必须能够在 Team A 与 Team B 两侧正确运行。** 槽位由赛事方分配，你的代码只会通过
`--team` 得知自己在哪一侧；两份输入 JSON 对双方逐字节相同。只在 A 侧调试过的算法换到 B 侧，
最常见的症状是：筛选敌人时写了 `p["x"] > x_e`（B 侧一个都筛不到 → 崩溃或交出退化函数）、
把「前进」写死成 `+x`、或把首次接触的「之前 / 之后」写反。

**English.** **The same formal submission MUST run correctly as Team A and as Team B.** Slots are assigned by the
organisers; your code learns its side only through `--team`, and both input JSON files are byte-identical for
the two sides. The classic symptoms of a solver that was only ever debugged as Team A: filtering enemies with
`p["x"] > x_e` (which matches nothing on the B side and then crashes or emits a degenerate function),
hard-coding "forward" as `+x`, or inverting "before / after" the first contact.

两件事都要自检 / Check both:

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm   # 默认 A、B 各跑一次（同一个世界）
python3 competitor-kit/tools/check_mirror.py ./my-algorithm          # 镜像世界：A@原世界 ↔ B@镜像，反之亦然
```

`check_mirror.py` 是**开发诊断**，官方 Preflight 不运行它：`FAIL`（一侧合法、镜像侧崩溃 / 超时 / 非法）
几乎总是 bug；两侧都失败同样记 `FAIL`（那不是镜像问题 —— 先跑 `validate_submission.py`）；
`WARN`（两侧都合法但几何不同）是合法的，只是提醒你确认不对称是有意为之。
**但若 `WARN` 的两对配对都报「结算不一致」（命中 / 阻挡 / 终止原因不同），那就是同一个「只会打 Team A」bug
的不崩溃形态（B 侧交出了退化但合法的函数）—— 退出码虽是 0，请像 `FAIL` 一样认真对待。**
**English.** `check_mirror.py` is a development diagnostic; the official Preflight does not run it. `FAIL`
(one side legal, its mirror crashing / timing out / illegal) is almost always a bug; both sides failing is also
`FAIL` (not a mirror issue — run `validate_submission.py` first); `WARN` (both legal, but the geometry differs)
is legal — it only asks you to confirm that the asymmetry is intentional. **But a `WARN` whose two pairs both
report a different judge outcome (hits / blocked / end reason) is the non-crashing form of the same Team-A-only
bug (the B side emitted a degenerate but legal function) — the exit code is 0, but treat it as seriously as
`FAIL`.**

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

# 7. Runtime and Resources (MUST Comply)

Complete list in [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md). Core facts:

| Item | Value |
|---|---|
| Python | CPython 3.9.6 |
| Third-party packages | **None** (`numpy` / `scipy` / `sympy` / `torch` etc. all unavailable) |
| CPU | 1 core |
| Threads | 1 (thread environment variables pinned to 1) |
| Memory | 512 MB |
| Per-round timeout | **500 ms** (Rule Revision 3 §11) |
| stdout | ≤ 256 KB, and not the result channel |
| stderr | ≤ 64 KB, usable for limited debugging |

For mathematical computation use standard library: `math` / `cmath` / `decimal` / `fractions` / `statistics` /
`random` / `itertools` / `functools`.

**Forbidden**: `pip install` / `conda install` or any installation behavior (sandbox rejects process creation and has no network).

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

# 8. Working Directory and Temporary Files (MUST Comply)

Sandbox has only two writable locations:

```text
output/            Only for writing result.json
Current working directory  Equivalent to TMPDIR, writable, can place temporary files
```

**Correct approach**:

```python
import tempfile

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    tmp = f.name
    f.write(json.dumps(result))
```

Or use relative paths directly (relative to current working directory).

**Do not hardcode**:

```text
/tmp
/work
/Users/...
```

These paths either do not exist or are rejected by sandbox (`PermissionError`).

**Sandbox is destroyed and rebuilt every round**: do not expect files written in Round 1 to still be readable in Round 2.

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

# 9. Time Budget (MUST)

- Per-round computation time limit **500 ms**, counting from the moment you receive `GO`.
- Exceeding 500 ms without producing legal `result.json` → this round `TIMEOUT`.
- Both sides **each** count from their own `GO` moment; no "shared timestamp" concept.
- Exit promptly after writing result; platform does not wait after process exits.

Common time traps:

| Trap | Suggestion |
|---|---|
| Symbolic regression / evolutionary search iterates too many times | Do budget check first, leave time for writing file |
| Use high-degree polynomial or rapidly oscillating function | Sample point count explodes (`OSCILLATION_LIMIT`) |
| Repeatedly read large files | Input files are small, read once is enough |
| Print large amount of logs to stdout | 256 KB limit, exceeding judges failure |

---

# 10. 随机性与可复现（MAY）

如果策略需要随机搜索：

- 可以使用本地 PRNG；
- **不要**依赖外部随机服务（无网络）；
- 建议用本轮公开信息构造内部种子，例如 `match_id + round + team`；
- 不要试图使用隐藏地图种子 —— 你拿不到它。

# 10. Randomness and Reproducibility (MAY)

If strategy requires random search:

- May use local PRNG;
- **Do not** depend on external random services (no network);
- Suggest using this round's public information to construct internal seed, e.g. `match_id + round + team`;
- Do not try to use hidden map seed — you cannot get it.

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
| M15 | 同一正式提交必须能够在 Team A 与 Team B 两侧正确运行（只有 `--team` 不同；见 §6.2.3） |

# 11. MUST / SHOULD / MAY Overview

## MUST (Not satisfied → Preflight failure / Invalid Shot / Timeout / violation)

| # | Requirement |
|---|---|
| M1 | Package root contains `solver.py` |
| M2 | Accept four parameters `--team / --public / --reveal / --output` |
| M3 | Read input from `--public` / `--reveal` (not stdin) |
| M4 | Write `{"schema_version":"1.1","dsl":…}` to `--output`, with only these two keys |
| M5 | DSL structurally legal (whitelist / arity / depth ≤12 / nodes ≤128 / constants ≤1000) |
| M6 | `variable` node explicitly writes `"value": "x"` |
| M7 | `|f(x_s) − y_s| ≤ 1e-6` |
| M8 | Finite, continuous, C¹, C² in attack range, convexity sign changes ≤100 |
| M9 | Complete and produce result within 500 ms |
| M10 | No network access, no subprocess creation, no reading opponent or platform files |
| M11 | Do not modify input files, do not modify own package |
| M12 | No cross-round state persistence (sandbox rebuilt every round) |
| M13 | Do not flood stdout / stderr |
| M14 | Only use modules listed in [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) |
| M15 | Same formal submission MUST run correctly on both Team A and Team B sides (only `--team` differs; see §6.2.3) |

## SHOULD（强烈建议，不影响接口合法性）

| # | 建议 | 理由 |
|---|---|---|
| S1 | 结果用临时文件 + 原子替换 | 避免被读到半截内容而判 `INVALID_OUTPUT` |
| S2 | 用 `f(x) = y_s + g(x − x_s)` 形式 | `f(x_s) = y_s` 成为恒等式，规避浮点误差 |
| S3 | 临时文件用 `tempfile` 或相对路径 | 硬编码路径会被沙箱拒绝 |
| S4 | 给计算留出写文件的时间预算 | 避免卡在 500 ms 边界 |
| S5 | 用 stderr 打有限调试信息 | stdout 超限即失败 |
| S6 | 对 `points` 按 `alive` 过滤 | 死点不是合法目标 |

## SHOULD (Strongly recommended, does not affect interface legality)

| # | Recommendation | Reason |
|---|---|---|
| S1 | Use temporary file + atomic replace for result | Avoid being read mid-content and judged `INVALID_OUTPUT` |
| S2 | Use `f(x) = y_s + g(x − x_s)` form | `f(x_s) = y_s` becomes an identity, avoiding floating-point error |
| S3 | Use `tempfile` or relative paths for temporary files | Hardcoded paths rejected by sandbox |
| S4 | Reserve time budget for writing file in computation | Avoid getting stuck at 500 ms boundary |
| S5 | Print limited debug info to stderr | stdout exceeding limit is failure |
| S6 | Filter `points` by `alive` | Dead points are not valid targets |

## MAY（可选策略）

| # | 选项 |
|---|---|
| Y1 | 用本轮公开信息构造随机种子做局部搜索 |
| Y2 | 解析式构造 + 数值微调 |
| Y3 | 针对障碍物做几何规避（如绕开障碍物区间） |
| Y4 | 多轮之间不共享状态，但用同一份代码自适应不同局面 |

## MAY (Optional strategies)

| # | Option |
|---|---|
| Y1 | Use this round's public information to construct random seed for local search |
| Y2 | Analytical construction + numerical fine-tuning |
| Y3 | Geometric obstacle avoidance (e.g. bypass obstacle intervals) |
| Y4 | No shared state between rounds, but use same code to adapt to different situations |

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

再跑一次镜像自检（开发诊断，见 §6.2.3；官方 Preflight 不运行它）：

```bash
python3 competitor-kit/tools/check_mirror.py ./my-algorithm
```

它把同一份代码放进 decoy 世界及其镜像世界里各跑一遍（A@原世界 ↔ B@镜像世界，反之亦然），
比较两侧规范化后的几何与结算：`PASS` 一致、`WARN` 两侧都合法但不对称、`FAIL` 一侧合法而镜像侧失败
（两侧都失败同样记 `FAIL`，那不是镜像问题 —— 先跑 `validate_submission.py`）。两对都「结算不一致」的
`WARN` 要像 `FAIL` 一样认真对待（见 §6.2.3）。
**English.** Run the mirror self-check as well (a development diagnostic, see §6.2.3; the official Preflight
does not run it). It runs the same code once in the decoy world and once in its mirror (A on the original ↔ B
on the mirror, and the reverse pair) and compares the normalised geometry and the Judge outcome of the two
sides: `PASS` consistent, `WARN` both legal but asymmetric, `FAIL` one side legal while its mirror fails (both
sides failing is also `FAIL` — not a mirror issue, run `validate_submission.py` first). A `WARN` whose two
pairs both differ in judge outcome deserves the same attention as `FAIL` (see §6.2.3).

> 两个工具都需要 Node.js（比赛仓库自带）。它们在仓库根目录运行时可用。

# 12. Local Self-Check (SHOULD)

Before submission run:

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```

It checks your package using the **same parser / validator as official Preflight** and sandbox execution path,
reporting each item:

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

On failure gives readable reason (e.g. `NOT_THROUGH_SHOOTER` prints residual and tolerance).

Then run mirror self-check (development diagnostic, see §6.2.3; official Preflight does not run it):

```bash
python3 competitor-kit/tools/check_mirror.py ./my-algorithm
```

It runs the same code once in the decoy world and once in its mirror world (A on original ↔ B on mirror, and the reverse pair),
comparing normalized geometry and adjudication of the two sides: `PASS` consistent, `WARN` both legal but asymmetric, `FAIL` one side legal while its mirror fails
(both sides failing is also `FAIL` — not a mirror issue, run `validate_submission.py` first). A `WARN` whose two
pairs both report different adjudication outcomes should be treated as seriously as `FAIL` (see §6.2.3).
**English.** Run the mirror self-check as well (a development diagnostic, see §6.2.3; the official Preflight
does not run it). It runs the same code once in the decoy world and once in its mirror (A on the original ↔ B
on the mirror, and the reverse pair) and compares the normalised geometry and the Judge outcome of the two
sides: `PASS` consistent, `WARN` both legal but asymmetric, `FAIL` one side legal while its mirror fails (both
sides failing is also `FAIL` — not a mirror issue, run `validate_submission.py` first). A `WARN` whose two
pairs both differ in judge outcome deserves the same attention as `FAIL` (see §6.2.3).

> Both tools require Node.js (bundled with competition repository). They are available when run from repository root.

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

> ✅ **Preflight 会替你检查 Emitter 处理。**
> decoy 世界的锚点取的是**decoy 地图上双方各自的第一个点**，不是平台常量 ——
> 与正赛一样是「逐场不同」的坐标。因此一个**写死坐标**的算法会在这里直接
> `FAIL`（`Function legality` 一节报 `NOT_THROUGH_SHOOTER`），当场就能发现，
> 不会拖到正赛才炸。本地自检工具用的是同一条规则。
>
> 从 `public_state.emitters[team]` 读锚点，仍然是最省事的写法。

# 13. Official Preflight

After formal submission the platform executes Preflight, checking:

```text
Package structure / solver.py / Python startup / CLI arguments
Decoy Public JSON / Decoy Reveal JSON / Result JSON / DSL validity
Runtime / Timeout / Sandbox compatibility
```

Preflight uses an **independent decoy world** (seed derived from `matchId`),
unrelated to this round's obstacles, so it leaks no hidden information.

Algorithm enters `READY` state only after Preflight `PASS`.

> ✅ **Preflight checks Emitter handling for you.**
> The decoy world's anchor takes **each side's first point on the decoy map**, not platform constants —
> just like real matches, coordinates that "vary per match". Therefore an algorithm that **hardcodes coordinates** will
> `FAIL` right here (`Function legality` section reports `NOT_THROUGH_SHOOTER`), discovered immediately,
> not dragged to real match to explode. Local self-check tool uses the same rule.
>
> Reading anchor from `public_state.emitters[team]` remains the most convenient approach.

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

# 14. How to Read Error Messages

The platform tells you failure reasons verbatim, for example:

```text
缺少固定入口 solver.py（V1.1 §3：包根目录必须存在该文件）
算法输出不合法: 输出不是合法 DSL: FORBIDDEN_OPERATOR: 运算符 "abs" 被禁止
算法输出不合法: 输出不是合法 DSL: DEPTH_LIMIT: AST 深度超过限制 12（在第 13 层拒绝，未展开）
算法输出不合法: 输出不是合法 DSL: NOT_THROUGH_SHOOTER: f(-18) = 0，与 Emitter y = 7.707 相差 7.708e+0 > ε=0.000001
算法超时（>500ms 内未生成合法的 output/result.json）
```

If Python throws an exception, you see the traceback's **head and tail** (middle frames are omitted),
root cause (`ModuleNotFoundError` / `SyntaxError` / your exception message) always preserved at tail.

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

# 15. Match Termination (Fully Implemented Since Revision 3)

**Every legal match terminates in finite time.** The engine guarantees this itself — not depending on any external parameter.
Possible ways the match ends are **exhaustively** as follows:

| `endReason` | Meaning | Outcome |
|---|---|---|
| `ELIMINATION` | One side's combat points eliminated while other still has some | Other side wins |
| `MUTUAL_ELIMINATION` | After same round ends both sides' combat points **simultaneously** reach zero | **DRAW** |
| `STALEMATE` | Consecutive **20** rounds where both sides failed to eliminate any point | **DRAW** |
| `HARD_ROUND_LIMIT` | Reached hard round limit **60** | **DRAW** |

Additional notes:

- **Mutual destruction is possible**: initiative zeros opponent, second strike with already-locked attack right then zeros initiative side → DRAW.
  Initiative **will not** be judged winner for "moving first".
- **Stalemate judged as draw**: If situation freezes (both sides cannot hit each other), after 20 consecutive zero-kill rounds judge DRAW;
  regardless of situation, round 60 definitely ends.
- No more `UNDECIDED` state — it was a product of "external round limit" in old versions.

Algorithm does not need to judge whether match has ended; each round just solve based on current input.

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

# 16. Prohibited Actions

The following behaviors are violations:

```text
1.  Network access / calling online services
2.  Creating subprocesses (subprocess / multiprocessing will be rejected by sandbox)
3.  Reading opponent algorithms, platform source, or Judge source
4.  Modifying match JSON or result timestamps
5.  Saving state across Rounds
6.  Starting background daemons
7.  Flooding stdout / stderr
8.  Modifying own package or input files
9.  Outputting piecewise / illegal DSL (if / abs / min / max / floor etc.)
10. Depending on third-party packages outside RUNTIME_MANIFEST.md
```

Sandbox will **technically** block most of these (process creation, network, unauthorized read/write, timestamp modification),
but "sandbox blocked it" does not equal "allowed to try". Please write algorithms according to rules.

---

# 17. 提交前检查清单

```text
[ ] 包根目录有 solver.py
[ ] 四个参数都能正常解析
[ ] 输入只从 --public / --reveal 读取
[ ] 结果写到 --output，且只有 schema_version + dsl
[ ] schema_version 是 "1.1"
[ ] variable 节点写了 value: "x"
[ ] 函数严格经过自己的固定 Emitter（从 public_state.emitters 读，别写死坐标）
[ ] 攻击范围内有限、连续、C²、凸性 ≤100
[ ] 没有使用任何第三方包
[ ] 临时文件用 tempfile / 相对路径
[ ] 结果用原子替换写入
[ ] 单轮耗时留有余量（< 500 ms）
[ ] 不访问网络、不创建进程
[ ] 本地自检 PASS（默认 A、B 各跑一次 —— 两队都要 PASS）
[ ] 以 --team A 与 --team B 都能正确运行：check_mirror.py 无 FAIL（WARN 需确认不对称是有意为之）
```

# 17. Pre-Submission Checklist

```text
[ ] Package root has solver.py
[ ] All four parameters parse correctly
[ ] Input only read from --public / --reveal
[ ] Result written to --output with only schema_version + dsl
[ ] schema_version is "1.1"
[ ] variable node writes value: "x"
[ ] Function strictly passes through own fixed Emitter (read from public_state.emitters, don't hardcode coordinates)
[ ] Finite, continuous, C² in attack range, convexity ≤100
[ ] No third-party packages used
[ ] Temporary files use tempfile / relative paths
[ ] Result written with atomic replace
[ ] Per-round time has margin (< 500 ms)
[ ] No network access, no process creation
[ ] Local self-check PASS (default runs A, B once each — both teams must PASS)
[ ] Runs correctly as both --team A and --team B: check_mirror.py no FAIL (WARN requires confirming asymmetry is intentional)
```

---

# 18. 示例

- 最小可运行模板：[starter/solver.py](starter/solver.py)
- 真实输入输出样例：[examples/](examples/)
- DSL 合法 / 非法示例：[DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)

## Starter 的策略

Starter 做的事情很简单（它只是**接口正确**的示例，不追求强度）：

1. 从 `public["emitters"][team]` 取自己的固定 Emitter 坐标 —— 它是**本场选定的**，
   同一场内不变、逐场不同；它**不在 `points` 里**，不需要（也无法）去点表里查；
2. 在存活敌人里选一个目标（默认选 |Δy| 最小的）；
3. 构造一条**严格经过自己的 Emitter** 的直线，斜率做限幅，避免冲出场地；
4. 原子写入 `result.json`。

直线是 C^∞ 的，凸性变号为 0，天然满足全部函数合法性规则 —— 这正是它的价值：
**先把接口跑通，再谈策略。**

# 18. Examples

- Minimal runnable template: [starter/solver.py](starter/solver.py)
- Real input/output samples: [examples/](examples/)
- DSL legal/illegal examples: [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)

## Starter's Strategy

Starter does something simple (it is merely an example with **correct interface**, not pursuing strength):

1. Get own fixed Emitter coordinates from `public["emitters"][team]` — it is **selected for this match**,
   constant within same match, varies per match; it is **not in `points`**, no need (nor ability) to look in point list;
2. Select a target among living enemies (defaults to selecting smallest |Δy|);
3. Construct a line **strictly passing through own Emitter**, slope clamped to avoid exiting field;
4. Atomic write to `result.json`.

Line is C^∞, convexity sign changes 0, naturally satisfies all function legality rules — this is precisely its value:
**Get the interface working first, then discuss strategy.**







