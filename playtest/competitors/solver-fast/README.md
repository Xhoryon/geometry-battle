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
