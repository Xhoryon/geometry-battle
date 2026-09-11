# solver-optimizer — Algorithm B (Optimization Solver)

Geometry Battle V1.1 playtest competitor. Maximises attack-function quality
inside the official time budget — clearly slower than the fast solver by design.

## Strategy

A genuine time-budgeted search over several families, all exact by construction:

* **Exact multi-target interpolation** — `f(x) = y_s + Σ c_k·V^k`, `V = (x−x_s)/L`,
  solved in `fractions.Fraction` (Newton divided differences → monomial) and
  Richardson-refined against the arithmetic of the emitted AST. Degree ladder up
  to K = 10 (a round has ≤ 10 enemy points).
* **Subset selection** — greedy seeding (enemy shooter first), local swap
  refinement, randomised restarts seeded deterministically from
  `match_id + round + team`.
* **Spare-degree sweep** — an over-determined subset has one free leading
  coefficient; the search sweeps that genuine one-parameter family to thread gaps.
* **Trigonometric** — `a·sin(b·u)`, `a·sin(b·u) + c·(1−cos(d·u))`,
  `a·u + c·sin(b·u)`; 1- and 2-point exact fits over a guarded frequency grid.
* **Composite** — `a·u + b·(exp(c·u)−1)` and `a·u + b·(√(1+c·u)−1)` with explicit
  domain guards (exp overflow, sqrt/log non-positive).
* **Obstacle-aware scoring** — kills strictly before trajectory termination,
  shooter bonus, clearance reward, node and steepness penalties.

The fallback (a legal line through the enemy shooter) is evaluated first and
always wins if nothing better survives.

## Budget

`config.json` → `budget_ms` (default 1500) + `slack_ms` (default 150); the
official 2000 ms timeout is never a normal operating state. A missing or corrupt
`config.json` falls back safely.

## Structure

```
solver.py        entry point, config, atomic emit, diagnostics
config.json      budget_ms / slack_ms
gboptim/
  astlib.py      DSL builders + structural limits
  evaluator.py   independent AST evaluator (value + analytic 1st/2nd deriv)
  geometry.py    obstacle signed distance + first-contact
  fit.py         exact rational interpolation + refinement
  scoring.py     obstacle-aware screening + scoring
  search.py      the time-budgeted search
  world.py       (public, reveal, team) → board
```

Independent of `solver-fast` — nothing is imported across packages.
