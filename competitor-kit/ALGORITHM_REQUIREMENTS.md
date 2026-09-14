<div align="right">

**English** | <a href="./ALGORITHM_REQUIREMENTS.zh-CN.md">简体中文</a>

</div>



# Geometry Battle V1.1 — Competitor Algorithm Requirements

> This is the **official release** of competitor requirements. It is aligned line-by-line with the platform
> implementation (parser / validator / sandbox / preflight) and continuously verified by `tests/competitor-kit.ts`.
> Every file, tool, and specification mentioned exists in `competitor-kit/`.

---

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

# 1. Submission Format

**Submission = one algorithm directory**.

```text
my-algorithm/
├── solver.py          ← required, must be at directory root
├── optimizer.py       ← optional: your own modules
└── utils/             ← optional: your own subdirectories
```

Rules:

- Entry filename is **fixed** as `solver.py` and MUST be at package **root** (no nested subdirectory allowed).
- May include your own `.py` modules, `.json` / `.txt` / `.csv` / `.yaml` / `.md` data files.
- **Package root is added to `sys.path`**: same-directory modules can `import optimizer` directly,
  subdirectories can `from utils import helper`, no need to modify `sys.path` yourself
  (passes validation on first check, see [README.md](README.md) §5).
- Symlinks not allowed; package size ≤ 8 MB, file count ≤ 256.
- `manifest.json` optional. If provided, MUST contain `name` and `version`, and `entry` (if written) can only be `solver.py`.

---



```bash
python3 <your-package>/solver.py \
  --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```



```text
--team     "A" or "B" (only these two values possible)
--public   Public state file path
--reveal   Reveal state file path
--output   Result output file path
```




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



```json
{ "schema_version": "1.1", "dsl": <AST> }
```




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






```text
u = x − x_emitter
f(x) = y_emitter + g(u), g(0) = 0
```




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
> before each match starts (see [§6.1](#61-fixed-emitter)). Therefore you MUST
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



# 5. Function Requirements (Legality Constraints)

Once the function's DSL tree passes parsing, Judge verifies whether it is a **legal function**:

```text
|f(x_e) − y_e| ≤ 1e-6      ← (x_e, y_e) is **this match's** Emitter, varies per match
```

**The only correct way to read Emitter:**

```python
s = public["emitters"][a.team]      # {"x": ..., "y": ...}
x_e, y_e = s["x"], s["y"]
```

## 6.1 Fixed Emitter: Selected for This Match, Constant Throughout

Each team has one **fixed Emitter**. It is selected by **you yourselves** before match start —
pick one from your own initial points, click it, then lock (press `Lock` on match page):

- **Selected per match**: Pick one from **your side's initial points**; match won't start until selected
- **Constant throughout**: Once locked, same point for all rounds of this match, cannot change
- **Public**: Two coordinates only public **after both sides lock** (you cannot see opponent's choice before they lock, they cannot see yours)
- **Unkillable**: Not a combat point; trajectory passing through it produces no effect

**The point selected as Emitter is removed from `points`** — it is no longer a combat point.
So if your team has 8 initial points and selects 1 as Emitter, your team's combat points on field are only 7,
and opponent's kill targets correspondingly one fewer. This is **part of strategy**: trade one point for a more favorable launch position.

Therefore your function every round MUST satisfy `|f(x_e) − y_e| ≤ 1e-6`, where `(x_e, y_e)` is **this match's** Emitter, which varies per match.

**The only correct way to read Emitter:**

```python
s = public["emitters"][a.team]      # {"x": ..., "y": ...}
x_e, y_e = s["x"], s["y"]
```

Do not hardcode `-18` / `18`, and do not assume it falls at field center somewhere.

### Attack Rights Lock at START

- **Opponent eliminating one of your combat points does not cancel your attack this round.** After START both sides' attack rights are locked:
  as long as you submit a legal function within your time budget, your attack **executes normally**.
- Attack **not executing** has only one reason: algorithm-side issues: `TIMEOUT`, `INVALID`, `CRASH`.
- Round does not recalculate: `public_state.json` / `reveal_state.json` freeze after START,
  do not change due to first strike result.




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

> V1.4 addition: this section is **explanatory** only — no rule changes; it spells out what the engine has always done.
> The rows "Attack direction" and "Valid attack range" in the §6 table above are the condensed version of this section.

**Team A faces +x (right); Team B faces -x (left).**

**Team A 的前进方向 = x 增大**  
**Team B 的前进方向 = x 减小**

Team A forward direction = increasing x  
Team B forward direction = decreasing x

### 6.2.1 Function vs traversal

**What you submit is always an ordinary function `y = f(x)`** — it is defined for every `x`
and has no direction of its own. Direction comes from how the Judge **traverses** it: Team A walks from
`x = x_e` towards `x = 20` (increasing x) over `[x_e, 20]`; Team B walks from `x = x_e` towards `x = -20`
(decreasing x) over `[-20, x_e]`. That traversal interval is the firing domain — function legality (§5) is
checked only there — and its sampling also starts at your own Emitter and walks in the attack direction (identical for both sides since V1.4). Traversal stops at the **first termination event**: the first contact with any obstacle,
or the first exit from the field (`y ∉ [-12, 12]` or `x ∉ [-20, 20]`); the attack does not resume even if the
graph re-enters the field. "Before the first contact" is direction-relative: for A it means smaller x, for B
it means **larger** x. Likewise "in the attack direction" means `x_p ≥ x_e` for A and `x_p ≤ x_e` for B.

**Recommended (SHOULD — not a mandatory API)**: work internally in a local forward coordinate
`u` — `u = x − x_e` for Team A, `u = x_e − x` for Team B — so that "forward" is always `+u` and both sides
share one code path. When turning a `u`-space polynomial (or any `g(u)` with `g(0) = 0`) back into an `x`
AST, the only team-dependent node is `u` itself: `sub(x, x_e)` for A versus `sub(x_e, x)` for B, exactly as
in the sketch below:

```python
def u_node(team, x_e):
    X = {"type": "variable", "value": "x"}
    E = {"type": "number", "value": x_e}
    # A: u = x − x_e        B: u = x_e − x
    return {"type": "sub", "args": [X, E]} if team == "A" else {"type": "sub", "args": [E, X]}

def poly_in_u(team, x_e, y_e, coeffs):
    """f(x) = y_e + c1·u + c2·u² + … (no constant term, so f(x_e) = y_e always holds)"""
    u = u_node(team, x_e)
    node = {"type": "number", "value": y_e}
    for k, c in enumerate(coeffs, start=1):
        term = {"type": "mul", "args": [{"type": "number", "value": c},
                                        {"type": "pow", "args": [u, {"type": "number", "value": k}]}]}
        node = {"type": "add", "args": [node, term]}
    return node
```

Team B line example (`f(x) = y_e + 0.3·(x_e − x)`, with `x_e = 18`, `y_e = 0` for illustration;
**read actual values from `public_state.emitters.B`**):

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

> Compare with the Team A example in §5: the same "rises 0.3 per unit forward" line has the
> opposite slope once it is written in `x`.

### 6.2.2 Array-order guarantees

The engine guarantees exactly this about `public_state.points` and `reveal_state.obstacles`:

| Array | Guarantee |
|---|---|
| `points` | All Team A entries first, then all Team B entries; within each group by map **generation / placement order** (`A1, A2, …`, `B1, B2, …`), **not** sorted by x, by distance to the Emitter, or by any other geometric quantity<br>先是 Team A 的全部条目，再是 Team B 的全部条目；每组内部按地图生成/放置顺序（`A1, A2, …`、`B1, B2, …`），**不按** x、离 Emitter 的距离或任何其它几何量排序 |
| `points` | Order and entry count identical every round of the match: killed points stay in place with `alive: false` |
| `points` | The two points locked as Emitters are removed and the remaining ids are **not renumbered** — so `A1` may be absent for the whole match and ids need not be contiguous<br>被锁定为 Emitter 的两个点会被移除，剩余 id **不重新编号** —— 所以 `A1` 可能整场缺席，id 不必连续 |
| `obstacles` | Numbered `O1..On` in generation order; the array is the same every round |

**Do not assume array order is geometric order.** If you want targets by geometry, sort by `x` / `u` / distance yourself.

**不要假设数组顺序代表 x 从小到大、离 Emitter 从近到远，或任何其它几何排序。**如果想按几何顺序处理目标，请自行按 `x` / `u` / 距离排序。

### 6.2.3 Both-side compatibility (MUST)

**The same formal submission MUST run correctly as Team A and as Team B.** Slots are assigned by the
organisers; your code learns its side only through `--team`, and both input JSON files are byte-identical for
the two sides. The classic symptoms of a solver that was only ever debugged as Team A: filtering enemies with
`p["x"] > x_e` (which matches nothing on the B side and then crashes or emits a degenerate function),
hard-coding "forward" as `+x`, or inverting "before / after" the first contact.

**同一正式提交必须能够在 Team A 与 Team B 两侧正确运行。**槽位由组织方分配；你的代码仅通过 `--team` 得知自己的阵营，且两侧收到的输入 JSON 文件逐字节相同。只在 Team A 调试过的求解器的典型症状：用 `p["x"] > x_e` 过滤敌方（在 B 侧匹配不到任何目标，然后崩溃或输出退化函数）、将"前进"硬编码为 `+x`、或反转"首次接触之前/之后"的判断。

Check both:

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm   # default runs A, B once each (same world)
python3 competitor-kit/tools/check_mirror.py ./my-algorithm          # mirror world: A@original ↔ B@mirror, and vice versa
```

`check_mirror.py` is a **development diagnostic**; the official Preflight does not run it. `FAIL`
(one side legal, its mirror crashing / timing out / illegal) is almost always a bug; both sides failing is also
`FAIL` (not a mirror issue — run `validate_submission.py` first); `WARN` (both legal, but the geometry differs)
is legal — it only asks you to confirm that the asymmetry is intentional. **But a `WARN` whose two pairs both
report a different judge outcome (hits / blocked / end reason) is the non-crashing form of the same Team-A-only
bug (the B side emitted a degenerate but legal function) — the exit code is 0, but treat it as seriously as
`FAIL`.**

`check_mirror.py` 是**开发诊断工具**；官方 Preflight 不会运行它。`FAIL`（一侧合法，其镜像崩溃/超时/非法）几乎总是 bug；两侧都失败同样记 `FAIL`（不是镜像问题——先跑 `validate_submission.py`）；`WARN`（两侧都合法，但几何不同）是合法的——它只是要求你确认非对称是刻意设计。**但如果 `WARN` 的两对结果报告了不同的裁判结果（命中/被阻挡/终止原因），则是同一个"只在 Team A 调试"bug 的不崩溃形式（B 侧输出了退化但合法的函数）——退出码为 0，但应像 `FAIL` 一样严肃对待。**

---






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

**Working directory**: `cwd` and `TMPDIR` are the only writable areas available; use them for any temporary files.

**Do not hardcode absolute paths** — these either do not exist in the sandbox or are rejected (`PermissionError`):

```text
/tmp
/work
/Users/...
```

**Sandbox is destroyed and rebuilt every round**: do not expect files written in Round 1 to still be readable in Round 2.

---





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




# 10. Randomness and Reproducibility (MAY)

If strategy requires random search:

- May use local PRNG;
- **Do not** depend on external random services (no network);
- Suggest using this round's public information to construct internal seed, e.g. `match_id + round + team`;
- Do not try to use hidden map seed — you cannot get it.

---

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
| M15 | 同一正式提交必须能够在 Team A 与 Team B 两侧正确运行（仅 `--team` 不同；见 §6.2.3） |



## SHOULD (Strongly recommended, does not affect interface legality)

| # | Recommendation | Reason |
|---|---|---|
| S1 | Use temporary file + atomic replace for result | Avoid being read mid-content and judged `INVALID_OUTPUT` |
| S2 | Use `f(x) = y_s + g(x − x_s)` form | `f(x_s) = y_s` becomes an identity, avoiding floating-point error |
| S3 | Use `tempfile` or relative paths for temporary files | Hardcoded paths rejected by sandbox |
| S4 | Reserve time budget for writing file in computation | Avoid getting stuck at 500 ms boundary |
| S5 | Print limited debug info to stderr | stdout exceeding limit is failure |
| S6 | Filter `points` by `alive` | Dead points are not valid targets |



## MAY (Optional strategies)

| # | Option |
|---|---|
| Y1 | Use this round's public information to construct random seed for local search |
| Y2 | Analytical construction + numerical fine-tuning |
| Y3 | Geometric obstacle avoidance (e.g. bypass obstacle intervals) |
| Y4 | No shared state between rounds, but use same code to adapt to different situations |

---



```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```


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



```bash
python3 competitor-kit/tools/check_mirror.py ./my-algorithm
```

Run the mirror self-check as well (a development diagnostic, see §6.2.3; the official Preflight
does not run it). It runs the same code once in the decoy world and once in its mirror (A on the original ↔ B
on the mirror, and the reverse pair) and compares the normalised geometry and the Judge outcome of the two
sides: `PASS` consistent, `WARN` both legal but asymmetric, `FAIL` one side legal while its mirror fails (both
sides failing is also `FAIL` — not a mirror issue, run `validate_submission.py` first). A `WARN` whose two
pairs both differ in judge outcome deserves the same attention as `FAIL` (see §6.2.3).


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

> Both tools require Node.js (bundled with competition repository). They are available when run from repository root.

---

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



# 14. How to Read Error Messages

The platform tells you failure reasons verbatim, for example:

```text
Missing fixed entrypoint solver.py (V1.1 §3: file must exist at package root)
Algorithm output invalid: output is not legal DSL: FORBIDDEN_OPERATOR: operator "abs" is forbidden
Algorithm output invalid: output is not legal DSL: DEPTH_LIMIT: AST depth exceeds limit 12 (rejected at layer 13, not expanded)
Algorithm output invalid: output is not legal DSL: NOT_THROUGH_SHOOTER: f(-18) = 0, differs from Emitter y = 7.707 by 7.708e+0 > ε=0.000001
Algorithm timeout (>500ms without generating valid output/result.json)
```

If Python throws an exception, you see the traceback's **head and tail** (middle frames are omitted),
root cause (`ModuleNotFoundError` / `SyntaxError` / your exception message) always preserved at tail.

---







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

# 17. Pre-submission Checklist

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
[ ] 作为 --team A 和 --team B 均正确运行:check_mirror.py 无 FAIL(WARN 须确认非对称为刻意设计)
```

---



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







