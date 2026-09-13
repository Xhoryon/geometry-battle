<!-- bilingual-doc: zh-CN + en-US -->

# Reference Solver v2（独立 demo / 本地联调参考实现）

# Reference Solver v2 (Standalone Demo / Local Testing Reference Implementation)

> **这不是参赛作品。** 它是一份用于开发演示与本地联调的参考算法：
> 接口按 V1.1 规范逐条实现，策略层用来演示「如何不把局面打成一潭死水」。

> **This is not a competition submission.** It is a reference algorithm for development demonstration and local testing:
> the interface implements the V1.1 specification line by line, and the strategy layer demonstrates "how to avoid turning the game into a stalemate."

旧 demo 算法有一个已知毛病：**连续多个回合瞄同一个位置** —— 同一个目标点、
几乎同一条曲线，局面卡死、无进展，最终只能等 Stalemate 判和。
v2 专门修这个问题，并且把「修法」设计成**只用当前输入就能推出**的确定性规则
（沙箱每轮重建、禁止跨轮持久化，见 `ALGORITHM_REQUIREMENTS.md` §8 / M12）。

The old demo algorithm has a known issue: **aiming at the same position for multiple consecutive rounds** — the same target point,
almost the same curve, the game gets stuck with no progress, eventually ending in a Stalemate draw.
v2 specifically fixes this problem, and the "fix" is designed as a deterministic rule that **can be derived from current input alone**
(the sandbox is rebuilt each round, cross-round persistence is prohibited, see `ALGORITHM_REQUIREMENTS.md` §8 / M12).

---

## 1. 目录结构

## 1. Directory Structure

```text
demo/reference-solver-v2/
├── solver.py          入口（包根目录，平台只认这个名字）
├── gb_dsl.py          DSL 白名单节点 + 结构自检 + 平台求值器的 Python 镜像
├── gb_world.py        局面模型 + Judge 规则的只读镜像（用于给候选打分）
├── gb_candidates.py   候选曲线族
├── gb_select.py       轮换 slate、无进展抑制、打分与选枪
└── manifest.json      可选元数据
```

```text
demo/reference-solver-v2/
├── solver.py          Entry point (package root, platform only recognizes this name)
├── gb_dsl.py          DSL whitelist nodes + structural checks + Python mirror of platform evaluator
├── gb_world.py        State model + read-only mirror of Judge rules (for scoring candidates)
├── gb_candidates.py   Candidate curve families
├── gb_select.py       Rotation slate, no-progress suppression, scoring and selection
└── manifest.json      Optional metadata
```

平台会把**包根目录**加入 `sys.path`，所以同目录模块直接 `import gb_select` 即可，
不需要自己改 `sys.path`。只使用标准库（`math` / `json` / `os` / `sys` / `time` /
`hashlib` / `argparse` / `traceback`），无任何第三方依赖。

The platform adds the **package root directory** to `sys.path`, so modules in the same directory can simply `import gb_select`,
no need to modify `sys.path` yourself. Only uses standard library (`math` / `json` / `os` / `sys` / `time` /
`hashlib` / `argparse` / `traceback`), with no third-party dependencies.

启动契约、输入输出、原子写与规范一致：

Startup contract, input/output, and atomic write are consistent with the specification:

```bash
python3 solver.py --team A --public <public_state.json> --reveal <reveal_state.json> --output <result.json>
```

---

## 2. 策略摘要

## 2. Strategy Summary

### 2.1 候选族（每条都写成 `f(x) = y_emit + g(x − x_emit)`，`g(0) = 0`）

### 2.1 Candidate Families (each written as `f(x) = y_emit + g(x − x_emit)`, `g(0) = 0`)

| 族 | 形式 | 说明 |
|---|---|---|
| `line:<t>` | `a·u` | 过 Emitter 与目标 t 的直线（最平凡的一族） |
| `bend2:<t>±` | `a·u + b·u²` | 一个自由曲率，参数是「目标处的纵向偏移」±1.5 |
| `bend3:<t>±` | `a·u + c·u³` | 曲率随距离增长，参数 ±2.5 |
| `wave:<t>±` | `a·u + A·sin(w·u)` | 低频正弦（A=±1.6，w=0.25），凸性变号远低于 100 |
| `interp2:…` / `interp3:…` | Newton 插值多项式 | **精确穿过 Emitter + 2~3 个敌点**，一枪多点 |
| `interp2:<t>+wp…` / `interp3:<t>+wp…` | 同上，节点里含**路标** | 绕行：曲线被钉到挡路障碍物的外侧（两侧 × 余量 1.5/4.0 × 中心或边缘） |
| `flat` | `y_emit` | 兜底常函数 |

| Family | Form | Description |
|---|---|---|
| `line:<t>` | `a·u` | Line through Emitter and target t (most trivial family) |
| `bend2:<t>±` | `a·u + b·u²` | One free curvature, parameter is "vertical offset at target" ±1.5 |
| `bend3:<t>±` | `a·u + c·u³` | Curvature grows with distance, parameter ±2.5 |
| `wave:<t>±` | `a·u + A·sin(w·u)` | Low-frequency sine (A=±1.6, w=0.25), convexity sign changes far below 100 |
| `interp2:…` / `interp3:…` | Newton interpolation polynomial | **Exactly passes through Emitter + 2~3 enemy points**, multi-kill shot |
| `interp2:<t>+wp…` / `interp3:<t>+wp…` | Same, nodes contain **waypoints** | Detour: curve pinned to outside of blocking obstacles (both sides × margin 1.5/4.0 × center or edge) |
| `flat` | `y_emit` | Fallback constant function |

`a` 永远由「曲线必须穿过目标」解出，所以每条候选都是一次**有保证的瞄准**：
只要中间没有终止事件，它必然命中它瞄的那个点。

`a` is always solved from "the curve must pass through the target", so each candidate is a **guaranteed aim**:
as long as there is no termination event in between, it will inevitably hit the point it aims at.

以 Emitter 为原点的增量写法的价值在于：`f(x_emit) = y_emit + g(0) = y_emit`
是**结构上的恒等式**，不受浮点累积误差影响（`DSL_SPECIFICATION.md` §9）。
提交前还会再算一次 `|f(x_emit) − y_emit|`，超过 1e-9 就整条丢弃。

The value of the incremental notation with Emitter as origin is that: `f(x_emit) = y_emit + g(0) = y_emit`
is a **structural identity**, not affected by floating-point accumulation errors (`DSL_SPECIFICATION.md` §9).
Before submission, `|f(x_emit) − y_emit|` is calculated again, and if it exceeds 1e-9, the entire candidate is discarded.

### 2.2 打分（每回合全部重算，不缓存）

### 2.2 Scoring (recalculated entirely each round, no caching)

每个候选都会被**模拟一遍**：按 `Judge.ts` 的同一套规则（攻击方向、首次障碍物接触
截断、首次离开 `y ∈ [-12,12]` 永久终止、`|f(x_p) − y_p| ≤ 1e-6`）算出这一枪能打死谁。

Each candidate is **simulated once**: following the same set of rules as `Judge.ts` (attack direction, first obstacle contact
truncation, first exit from `y ∈ [-12,12]` permanent termination, `|f(x_p) − y_p| ≤ 1e-6`) to calculate who this shot can kill.

```text
score = 1000 × 击杀数
      −  150 × 重复目标惩罚   ∈ [0, 1]
      − 0.02 × 曲线峰值       （轻微偏好起伏小的）
```

```text
score = 1000 × kill count
      −  150 × repeated-target penalty   ∈ [0, 1]
      − 0.02 × curve peak       (slight preference for smaller undulations)
```

击杀权重远大于所有惩罚之和，所以**「多杀一个点」永远压过「换一个目标」** ——
反重复是同等击杀数之间的裁决，不会以打空为代价。

The kill weight far exceeds the sum of all penalties, so **"killing one more point" always overrides "changing target"** —
anti-repetition is a tiebreaker between equal kill counts, not at the cost of missing a shot.

### 2.3 如何避免重复目标

### 2.3 How to Avoid Repeated Targets

**机制一：确定性轮换 slate（对应「repeated-target penalty」）**

**Mechanism 1: Deterministic rotation slate (corresponding to "repeated-target penalty")**

`round` 是公开输入。把当前存活敌点按 id 排成稳定序列 `E`（长度 n），
用 `match_id + team` 的 FNV-1a 哈希做相位：

`round` is public input. Sort current alive enemy points by id into a stable sequence `E` (length n),
use FNV-1a hash of `match_id + team` as phase:

```text
phase        = fnv1a(match_id + "|" + team) mod 997
slate_k      = E[(round − k + phase) mod n]        k = 1,2,3
权重          = (3,2,1)/6                         （越近的回合越重）
```

```text
phase        = fnv1a(match_id + "|" + team) mod 997
slate_k      = E[(round − k + phase) mod n]        k = 1,2,3
weight       = (3,2,1)/6                         (more recent rounds are heavier)
```

候选的重复分 = 它瞄准的每个目标的 slate 权重取平均。于是「最近三个回合本该盯谁」
完全由**当前输入**算出来；同一个局面、同一个 round 必然得到同一个结果。

A candidate's repetition score = average of the slate weights of each target it aims at. Thus "who should have been targeted in the last three rounds"
is completely derived from **current input**; the same state, the same round will inevitably get the same result.

这是**惩罚而不是强制**：落在 slate 里的目标被降权 150 分，但只要多杀一个点
（+1000）就照样选它。

This is a **penalty, not enforcement**: targets in the slate are downweighted by 150 points, but as long as killing one more point
(+1000) still selects it.

**机制二：最平凡轨迹抑制（对应「repeated-trajectory / no-progress penalty」）**

**Mechanism 2: Most-trivial trajectory suppression (corresponding to "repeated-trajectory / no-progress penalty")**

「按当前局面能构造出的最平凡那条」= 过 Emitter、瞄 `|Δy|` 最小的存活敌点的直线
—— 也就是 starter 的默认选择，也正是旧 demo 每回合反复打的那一条。

"The most trivial one constructible from the current state" = line through Emitter, aiming at the alive enemy point with smallest `|Δy|`
— which is the starter's default choice, and exactly the one the old demo repeatedly fires every round.

判据是**两个条件同时成立**才算复读：

The criterion is that **both conditions must be true** to count as repetition:

1. 击杀集合与最平凡那条**完全相同**；
2. 两条曲线在攻击区间上的最大纵向差 **< 0.5**（形状也几乎重合）。

1. The kill set is **exactly the same** as the most trivial one;
2. The maximum vertical difference between the two curves over the attack interval is **< 0.5** (shapes also nearly coincide).

命中之后按排序**跳过它，换下一名候选**。跳过有一条硬约束：只有当存在另一个
非复读候选能拿到**同样的击杀数**时才跳；否则宁可复读，也不拿一次真实击杀去换姿势。

After a match, **skip it and switch to the next candidate** by order. Skipping has one hard constraint: only skip when there exists another
non-repetitive candidate that can achieve **the same kill count**; otherwise prefer repetition over trading a real kill for variety.

> 对照实测（单存活敌点、正前方同高、无障碍）：
> `chosen=bend2:B1:+1.5` / `baseline=line:B1` / `skipped=['line:B1']`
> —— 最平凡的直线被跳过，换了一条形状不同的曲线。

> Reference test (single alive enemy point, directly ahead at same height, no obstacles):
> `chosen=bend2:B1:+1.5` / `baseline=line:B1` / `skipped=['line:B1']`
> — the most trivial straight line was skipped, switched to a curve with different shape.

### 2.4 兜底

### 2.4 Fallback

任何异常（输入读不出、搜索抛错、预算耗尽）都退到 `f ≡ y_emit`：
它必然经过 Emitter（残差恒为 0）、C^∞、凸性 0、处处有限。
**本实现不存在「输出非法 DSL」或「空手退出」的代码路径。**

Any exception (input unreadable, search throws error, budget exhausted) falls back to `f ≡ y_emit`:
it necessarily passes through Emitter (residual always 0), C^∞, convexity 0, finite everywhere.
**This implementation has no code path for "outputting illegal DSL" or "exiting empty-handed".**

---

## 3. 与旧 demo 算法的区别

## 3. Differences from Old Demo Algorithm

| | 旧 demo | v2 |
|---|---|---|
| 目标过滤 | 瞄最近的敌点，未按 `alive` 过滤 | **只瞄 `alive: true`**，死点永不入选 |
| 目标选择 | 跨回合固定（同一目标反复打） | **每回合按当前局面重新模拟、重新打分** |
| 重复目标 | 无处理 | 从 `round` + 当前存活集合确定性推出的轮换 slate，降权 |
| 重复轨迹 | 无处理 | 与最平凡那条等价（同结果 + 同形状）直接跳过换下一条 |
| 一枪多点 | 不做 | Newton 插值精确穿过 2~3 个敌点 |
| 兜底 | 崩溃时直接退出 | `f ≡ y_emit`，任何路径都能交出合法结果 |
| 搜索预算 | 无显式预算 | 320 ms 自留预算，超预算即停并交出已有最优 |

| | Old demo | v2 |
|---|---|---|
| Target filtering | Aims at nearest enemy, not filtered by `alive` | **Only aims at `alive: true`**, dead points never selected |
| Target selection | Fixed across rounds (same target repeatedly) | **Re-simulates and re-scores each round based on current state** |
| Repeated target | No handling | Deterministic rotation slate derived from `round` + current alive set, downweighted |
| Repeated trajectory | No handling | Equivalent to most trivial (same result + same shape) directly skipped for next |
| Multi-kill shot | Not done | Newton interpolation exactly passes through 2~3 enemy points |
| Fallback | Exits directly on crash | `f ≡ y_emit`, any path can deliver legal result |
| Search budget | No explicit budget | 320 ms reserved budget, stops when exceeded and delivers best so far |

**实测（`--difficulty hard --points 10`，自我对局，A+B 合计击杀）**：

**Actual test (`--difficulty hard --points 10`, self-play, A+B combined kills)**:

| seed | 加入绕行候选前 | 之后 |
|---|---|---|
| 777 | 11 | 14 |
| 424242 | 8 | 16 |
| 20250911 | 8 | 9 |

| seed | Before detour candidates | After |
|---|---|---|
| 777 | 11 | 14 |
| 424242 | 8 | 16 |
| 20250911 | 8 | 9 |

三局**都仍以 `STALEMATE` 收场** —— 「不再复读」这个目标**没有达成**。
细节与可复现线索见 §4 第 7 条。

All three games **still end in `STALEMATE`** — the goal of "no more repetition" **was not achieved**.
Details and reproducibility clues see §4 item 7.

---

## 4. 已知局限（请勿当成保证）

## 4. Known Limitations (Do Not Treat as Guarantees)

1. **轮换是重建出来的，不是账本。** 真正的历史无法获得。slate 是用**当前**存活
   集合反推「过去几个回合本该盯谁」；点位阵亡之后 n 变小、序列整体位移，
   重建结果会与实际打过的目标错位。它是「避免复读」的启发式，不是可靠记录。
   规则改写（例如换成用击杀数当相位）会改变轮换序列。

1. **Rotation is reconstructed, not a ledger.** True history cannot be obtained. The slate uses the **current** alive
   set to deduce "who should have been targeted in past rounds"; after point deaths n becomes smaller, the sequence shifts overall,
   reconstruction results will be misaligned with actually targeted points. It is a heuristic for "avoiding repetition", not a reliable record.
   Rule rewrites (e.g., switching to kill count as phase) will change the rotation sequence.

2. **只惩罚、不保证。** 如果所有可选目标都落在 slate 里，或者换目标要少杀一个点，
   算法照样会复读 —— 这是刻意的取舍。

2. **Only penalty, no guarantee.** If all selectable targets fall in the slate, or changing targets means killing one less point,
   the algorithm will still repeat — this is a deliberate tradeoff.

3. **打分用的是 Judge 的近似实现。** `gb_world.py` 按 `Judge.ts` 的规则重写了一遍，
   但搜索期步长（0.02）比平台（0.005）粗。因此定稿前会用**比平台更细**的步长
   （0.002）复核一次，复核不同意就换下一名候选。这与平台判定仍可能有极小的
   边界差异 —— 它只影响「选哪条曲线」，选错最多这一枪打空，不会产出非法结果。

3. **Scoring uses an approximate implementation of Judge.** `gb_world.py` rewrites the rules from `Judge.ts`,
   but the search phase step size (0.02) is coarser than the platform (0.005). Therefore, before finalization, it re-checks with a **finer than platform** step size
   (0.002), and if the re-check disagrees, switches to the next candidate. This may still have minimal
   boundary differences from platform judgment — it only affects "which curve to choose", a wrong choice at most misses the shot, will not produce illegal results.

4. **不打对方的 Emitter。** Emitter 不是战斗点（规范 §3/§6），打它没有收益。

4. **Does not target opponent's Emitter.** Emitter is not a battle point (specification §3/§6), targeting it has no benefit.

5. **绕行是「枚举 + 打分」，不是路径规划。** 遇到挡路的障碍物时会生成一批
   把曲线钉到它外侧的路标候选（`obstacle_waypoint_candidates`），由模拟器淘汰。
   它不做真正的路径搜索，因此「必须连续绕过两块以上障碍物」的情形仍可能找不到解。
   之所以加这一族：直线 / 二次 / 三次 / 正弦的自由曲率只有 ±1.5 / ±2.5 y 单位，
   量级上就够不着障碍物后面的目标 —— 一旦直线被挡住，所有候选的击杀数都是 0。

5. **Detour is "enumeration + scoring", not path planning.** When encountering blocking obstacles, it generates a batch of
   waypoint candidates that pin the curve to its outside (`obstacle_waypoint_candidates`), eliminated by the simulator.
   It does not do real path search, so scenarios "must consecutively bypass two or more obstacles" may still find no solution.
   The reason for adding this family: straight line / quadratic / cubic / sine have free curvature of only ±1.5 / ±2.5 y units,
   in magnitude cannot reach targets behind obstacles — once the straight line is blocked, all candidates have kill count 0.

6. **发射锚点从输入读取，不写死。** 本实现只依赖 `public["emitters"][team]`，
   因此无论平台用「整场固定常量」还是「开局锁定后整场不变」的模型都能工作；
   只有在输入完全读不出来时，才会退到最后兜底的常量。

6. **Emitter anchor point is read from input, not hardcoded.** This implementation only relies on `public["emitters"][team]`,
   so it works whether the platform uses a "fixed constant throughout" or "locked at game start then unchanged throughout" model;
   only when input is completely unreadable does it fall back to the final fallback constant.

7. **死锁没有完全解决。** 加了绕行候选之后，对局从「一枪都打不中」变成
   「双方都能打到 7~8 个点」，但**三个测试种子仍全部以 `STALEMATE` 收场**：
   停滞段是一个周期 2 极限环，双方各在两条打不中的射击之间来回。
   这是**策略**问题，不是可复现性问题 —— 可复现性已由 `tests/demo-repro`
   钉死（直调与官方沙箱各 10 次、逐字节一致），详见
   `docs/agent-context/PROJECT_STATE.md` §5.2。

7. **Deadlock not fully resolved.** After adding detour candidates, the game went from "can't hit any shot" to
   "both sides can hit 7~8 points", but **all three test seeds still end in `STALEMATE`**:
   the stalemate segment is a period-2 limit cycle, both sides alternating between two shots that miss.
   This is a **strategy** problem, not a reproducibility problem — reproducibility has been nailed down by `tests/demo-repro`
   (direct call and official sandbox each 10 times, byte-for-byte identical), see
   `docs/agent-context/PROJECT_STATE.md` §5.2.

---

## 5. 本地自检与联调

## 5. Local Self-Check and Testing

```bash
# 平台自检（必须 PASS）
npx ts-node src/operator/validate-submission.ts demo/reference-solver-v2

# 真实比赛（槽位指向临时目录，不动仓库的 algorithms/）
npx ts-node src/operator/cli.ts --a demo/reference-solver-v2 --b starter \
  --slots /tmp/gb-demo-slots --artifacts /tmp/gb-demo-artifacts \
  --seed 555 --points 6 --difficulty easy --auto
```

```bash
# Platform self-check (must PASS)
npx ts-node src/operator/validate-submission.ts demo/reference-solver-v2

# Real match (slots point to temporary directory, does not touch repo's algorithms/)
npx ts-node src/operator/cli.ts --a demo/reference-solver-v2 --b starter \
  --slots /tmp/gb-demo-slots --artifacts /tmp/gb-demo-artifacts \
  --seed 555 --points 6 --difficulty easy --auto
```

stderr 会打印一行机器可读的决策摘要（stdout 不是结果通道）：

stderr prints a machine-readable decision summary line (stdout is not the result channel):

```text
GB_REF2 {"alive": 8, "baseline": "line:B5(kills=1)", "candidates": 81,
         "chosen": "interp2:B4+B7(kills=2,stale=0.00,trivial=0)", "ms": 70.3, ...}
```

`candidates` 是本回合实际模拟过的候选数，`skipped` 列出被反重复规则跳过的候选，
`ms` 是搜索耗时（自留预算 320 ms，远低于平台 500 ms 上限）。

`candidates` is the number of candidates actually simulated this round, `skipped` lists candidates skipped by anti-repetition rules,
`ms` is search time (reserved budget 320 ms, far below platform 500 ms limit).
