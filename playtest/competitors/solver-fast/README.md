<!-- bilingual-doc: zh-CN + en-US -->

# solver-fast — Algorithm A (Fast Tactical Solver)

几何斗殴 V1.1 playtest 参赛算法。以最快速度生成稳定、合法、战术价值高的攻击函数。

## 策略

一个小型、有序、封闭形式的候选池 — 无搜索：

1. **刺杀优先**：直线射手 → 敌方射手。优先击杀敌方射手会取消对手整轮。
2. **直线** 穿过每个存活敌方点。
3. **二次曲线** 穿过敌方射手 + 另一点，然后穿过点对。
4. **单参数弯曲族** `f = y_s + a·u + b·u^k`（k ∈ {2,3,4}，a、b 求解使曲线精确穿过射手 + 一个目标） — 主要的避障工具，因为不同的 `k` 免费提供不同的弯曲。
5. **三次曲线** 穿过射手 + 点对 / 三点组。
6. 少数 **精确正弦** 穿过射手和一个目标。

每个候选都是构造精确的（与其目标点完全重合）并用 **保守** 障碍扫描评分（Lipschitz 隧道 + 二分；当不确定时，假定被阻挡）。候选池采用惰性遍历并提前停止：

* 在射手击杀 **加上** 另一击杀时立即停止，
* 在三重击杀时停止，
* 在持有射手击杀后达到软上限时停止，
* 否则在硬上限停止。

一条平凡合法的后备直线（射手 → 敌方射手）总是可用；一个合法的弱射击胜过 TIMEOUT 或 INVALID 射击。

## 目标 / 预算

* 合法性 ≈ 100 %，典型运行时间 < 200 ms，硬内部上限 ~600 ms，远低于 2000 ms 平台超时。

## 结构

```
solver.py       入口点、预算、提前停止策略、原子发射
gb_world.py     回合 (public, reveal, team) → 棋盘 (shooter, enemies, obstacles)
gb_dsl.py       DSL 构建器 + 结构筛查 + 自有 AST 求值器
gb_geom.py      障碍几何 + 保守轨迹扫描
gb_cand.py      候选封闭形式 + 评分
gb_screen.py    合法性筛查（廉价 + 密集，守门发射）
gb_pool.py      有序候选池
```

与 `solver-optimizer` 独立 — 包之间无导入。

---

# solver-fast — Algorithm A (Fast Tactical Solver)

Geometry Battle V1.1 playtest competitor. Produces a stable, legal, tactically
valuable attack function as fast as possible.

## Strategy

A small, ordered, closed-form candidate pool — nothing is searched:

1. **Assassination first**: the straight line shooter → enemy shooter. Killing
   the enemy shooter while firing first cancels the entire enemy round.
2. **Lines** through each alive enemy point.
3. **Quadratics** through the enemy shooter + one more point, then through pairs.
4. **1-parameter bend family** `f = y_s + a·u + b·u^k` (k ∈ {2,3,4}, a,b solved
   so the curve passes exactly through shooter + one target) — the main
   obstacle-evasion tool, since different `k` give different bends for free.
5. **Cubics** through the shooter + pairs / triples.
6. A few **exact sines** through the shooter and one target.

Every candidate is exact by construction (passes through its targets identically)
and is scored with a **conservative** obstacle scan (Lipschitz tunnel + bisect;
when inconclusive, assume blocked). The pool is walked lazily and stops early:

* immediately on a shooter kill **plus** another kill,
* on a triple kill,
* after a soft cap once a shooter kill is held,
* otherwise at the hard cap.

A trivially legal fallback line (shooter → enemy shooter) is always available;
a legal weak shot beats a TIMEOUT or an INVALID shot.

## Targets / budget

* legality ≈ 100 %, typical runtime < 200 ms, hard internal cap ~600 ms,
  well under the 2000 ms platform timeout.

## Structure

```
solver.py       entry point, budget, early-stop policy, atomic emit
gb_world.py     turn (public, reveal, team) → board (shooter, enemies, obstacles)
gb_dsl.py       DSL builders + structural screen + own AST evaluator
gb_geom.py      obstacle geometry + conservative trajectory scan
gb_cand.py      candidate closed forms + scoring
gb_screen.py    legality screen (cheap + dense, gates emission)
gb_pool.py      the ordered candidate pool
```

Independent of `solver-optimizer` — nothing is imported across packages.