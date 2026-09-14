<div align="right">

**English** | <a href="./README.zh-CN.md">简体中文</a>

</div>

# Reference Solver v2 (Standalone Demo / Local Testing Reference Implementation)

> **This is not a competition submission.** It is a reference algorithm for development demonstration and local testing:
> the interface implements the V1.1 specification line by line, and the strategy layer demonstrates "how to avoid turning the game into a stalemate."

The old demo algorithm has a known issue: **aiming at the same position for multiple consecutive rounds** — the same target point,
almost the same curve, the game gets stuck with no progress, eventually ending in a Stalemate draw.
v2 specifically fixes this problem, and the "fix" is designed as a deterministic rule that **can be derived from current input alone**
(the sandbox is rebuilt each round, cross-round persistence is prohibited, see `ALGORITHM_REQUIREMENTS.md` §8 / M12).

---

## 1. Directory Structure

```text
demo/reference-solver-v2/
├── solver.py          Entry point (package root, platform only recognizes this name)
├── gb_dsl.py          DSL whitelist nodes + structural checks + Python mirror of platform evaluator
├── gb_world.py        State model + read-only mirror of Judge rules (for scoring candidates)
├── gb_candidates.py   Candidate curve families
├── gb_select.py       Rotation slate, no-progress suppression, scoring and selection
└── manifest.json      Optional metadata
```

The platform adds the **package root directory** to `sys.path`, so modules in the same directory can simply `import gb_select`,
no need to modify `sys.path` yourself. Only uses standard library (`math` / `json` / `os` / `sys` / `time` /
`hashlib` / `argparse` / `traceback`), with no third-party dependencies.

Startup contract, input/output, and atomic write are consistent with the specification:

```bash
python3 solver.py --team A --public <public_state.json> --reveal <reveal_state.json> --output <result.json>
```

---

## 2. Strategy Summary

### 2.1 Candidate Families (each written as `f(x) = y_emit + g(x − x_emit)`, `g(0) = 0`)

| Family | Form | Description |
|---|---|---|
| `line:<t>` | `a·u` | Line through Emitter and target t (most trivial family) |
| `bend2:<t>±` | `a·u + b·u²` | One free curvature, parameter is "vertical offset at target" ±1.5 |
| `bend3:<t>±` | `a·u + c·u³` | Curvature grows with distance, parameter ±2.5 |
| `wave:<t>±` | `a·u + A·sin(w·u)` | Low-frequency sine (A=±1.6, w=0.25), convexity sign changes far below 100 |
| `interp2:…` / `interp3:…` | Newton interpolation polynomial | **Exactly passes through Emitter + 2~3 enemy points**, multi-kill shot |
| `interp2:<t>+wp…` / `interp3:<t>+wp…` | Same, nodes contain **waypoints** | Detour: curve pinned to outside of blocking obstacles (both sides × margin 1.5/4.0 × center or edge) |
| `flat` | `y_emit` | Fallback constant function |

`a` is always solved from "the curve must pass through the target", so each candidate is a **guaranteed aim**:
as long as there is no termination event in between, it will inevitably hit the point it aims at.

The value of the incremental notation with Emitter as origin is that: `f(x_emit) = y_emit + g(0) = y_emit`
is a **structural identity**, not affected by floating-point accumulation errors (`DSL_SPECIFICATION.md` §9).
Before submission, `|f(x_emit) − y_emit|` is calculated again, and if it exceeds 1e-9, the entire candidate is discarded.

### 2.2 Scoring (recalculated entirely each round, no caching)

Each candidate is **simulated once**: following the same set of rules as `Judge.ts` (attack direction, first obstacle contact
truncation, first exit from `y ∈ [-12,12]` permanent termination, `|f(x_p) − y_p| ≤ 1e-6`) to calculate who this shot can kill.

```text
score = 1000 × kill count
      −  150 × repeated-target penalty   ∈ [0, 1]
      − 0.02 × curve peak       (slight preference for smaller undulations)
```

The kill weight far exceeds the sum of all penalties, so **"killing one more point" always overrides "changing target"** —
anti-repetition is a tiebreaker between equal kill counts, not at the cost of missing a shot.

### 2.3 How to Avoid Repeated Targets

**Mechanism 1: Deterministic rotation slate (corresponding to "repeated-target penalty")**

`round` is public input. Sort current alive enemy points by id into a stable sequence `E` (length n),
use FNV-1a hash of `match_id + team` as phase:

```text
phase        = fnv1a(match_id + "|" + team) mod 997
slate_k      = E[(round − k + phase) mod n]        k = 1,2,3
weight       = (3,2,1)/6                         (more recent rounds are heavier)
```

A candidate's repetition score = average of the slate weights of each target it aims at. Thus "who should have been targeted in the last three rounds"
is completely derived from **current input**; the same state, the same round will inevitably get the same result.

This is a **penalty, not enforcement**: targets in the slate are downweighted by 150 points, but as long as killing one more point
(+1000) still selects it.

**Mechanism 2: Most-trivial trajectory suppression (corresponding to "repeated-trajectory / no-progress penalty")**

"The most trivial one constructible from the current state" = line through Emitter, aiming at the alive enemy point with smallest `|Δy|`
— which is the starter's default choice, and exactly the one the old demo repeatedly fires every round.

The criterion is that **both conditions must be true** to count as repetition:

1. The kill set is **exactly the same** as the most trivial one;
2. The maximum vertical difference between the two curves over the attack interval is **< 0.5** (shapes also nearly coincide).

After a match, **skip it and switch to the next candidate** by order. Skipping has one hard constraint: only skip when there exists another
non-repetitive candidate that can achieve **the same kill count**; otherwise prefer repetition over trading a real kill for variety.

> Reference test (single alive enemy point, directly ahead at same height, no obstacles):
> `chosen=bend2:B1:+1.5` / `baseline=line:B1` / `skipped=['line:B1']`
> — the most trivial straight line was skipped, switched to a curve with different shape.

### 2.4 Fallback

Any exception (input unreadable, search throws error, budget exhausted) falls back to `f ≡ y_emit`:
it necessarily passes through Emitter (residual always 0), C^∞, convexity 0, finite everywhere.
**This implementation has no code path for "outputting illegal DSL" or "exiting empty-handed".**

---

## 3. Differences from Old Demo Algorithm

| | Old demo | v2 |
|---|---|---|
| Target filtering | Aims at nearest enemy, not filtered by `alive` | **Only aims at `alive: true`**, dead points never selected |
| Target selection | Fixed across rounds (same target repeatedly) | **Re-simulates and re-scores each round based on current state** |
| Repeated target | No handling | Deterministic rotation slate derived from `round` + current alive set, downweighted |
| Repeated trajectory | No handling | Equivalent to most trivial (same result + same shape) directly skipped for next |
| Multi-kill shot | Not done | Newton interpolation exactly passes through 2~3 enemy points |
| Fallback | Exits directly on crash | `f ≡ y_emit`, any path can deliver legal result |
| Search budget | No explicit budget | 320 ms reserved budget, stops when exceeded and delivers best so far |

**Actual test (`--difficulty hard --points 10`, self-play, A+B combined kills)**:

| seed | Before detour candidates | After |
|---|---|---|
| 777 | 11 | 14 |
| 424242 | 8 | 16 |
| 20250911 | 8 | 9 |

All three games **still end in `STALEMATE`** — the goal of "no more repetition" **was not achieved**.
Details and reproducibility clues see §4 item 7.

---

## 4. Known Limitations (Do Not Treat as Guarantees)

1. **Rotation is reconstructed, not a ledger.** True history cannot be obtained. The slate uses the **current** alive
   set to deduce "who should have been targeted in past rounds"; after point deaths n becomes smaller, the sequence shifts overall,
   reconstruction results will be misaligned with actually targeted points. It is a heuristic for "avoiding repetition", not a reliable record.
   Rule rewrites (e.g., switching to kill count as phase) will change the rotation sequence.

2. **Only penalty, no guarantee.** If all selectable targets fall in the slate, or changing targets means killing one less point,
   the algorithm will still repeat — this is a deliberate tradeoff.

3. **Scoring uses an approximate implementation of Judge.** `gb_world.py` rewrites the rules from `Judge.ts`,
   but the search phase step size (0.02) is coarser than the platform (0.005). Therefore, before finalization, it re-checks with a **finer than platform** step size
   (0.002), and if the re-check disagrees, switches to the next candidate. This may still have minimal
   boundary differences from platform judgment — it only affects "which curve to choose", a wrong choice at most misses the shot, will not produce illegal results.

4. **Does not target opponent's Emitter.** Emitter is not a battle point (specification §3/§6), targeting it has no benefit.

5. **Detour is "enumeration + scoring", not path planning.** When encountering blocking obstacles, it generates a batch of
   waypoint candidates that pin the curve to its outside (`obstacle_waypoint_candidates`), eliminated by the simulator.
   It does not do real path search, so scenarios "must consecutively bypass two or more obstacles" may still find no solution.
   The reason for adding this family: straight line / quadratic / cubic / sine have free curvature of only ±1.5 / ±2.5 y units,
   in magnitude cannot reach targets behind obstacles — once the straight line is blocked, all candidates have kill count 0.

6. **Emitter anchor point is read from input, not hardcoded.** This implementation only relies on `public["emitters"][team]`,
   so it works whether the platform uses a "fixed constant throughout" or "locked at game start then unchanged throughout" model;
   only when input is completely unreadable does it fall back to the final fallback constant.

7. **Deadlock not fully resolved.** After adding detour candidates, the game went from "can't hit any shot" to
   "both sides can hit 7~8 points", but **all three test seeds still end in `STALEMATE`**:
   the stalemate segment is a period-2 limit cycle, both sides alternating between two shots that miss.
   This is a **strategy** problem, not a reproducibility problem — reproducibility has been nailed down by `tests/demo-repro`
   (direct call and official sandbox each 10 times, byte-for-byte identical)
   `tests/demo-repro.ts` 

---

## 5. Local Self-Check and Testing

```bash
# Platform self-check (must PASS)
npx ts-node src/operator/validate-submission.ts demo/reference-solver-v2

# Real match (slots point to temporary directory, does not touch repo's algorithms/)
npx ts-node src/operator/cli.ts --a demo/reference-solver-v2 --b starter \
  --slots /tmp/gb-demo-slots --artifacts /tmp/gb-demo-artifacts \
  --seed 555 --points 6 --difficulty easy --auto
```

stderr prints a machine-readable decision summary line (stdout is not the result channel):

```text
GB_REF2 {"alive": 8, "baseline": "line:B5(kills=1)", "candidates": 81,
         "chosen": "interp2:B4+B7(kills=2,stale=0.00,trivial=0)", "ms": 70.3, ...}
```

`candidates` is the number of candidates actually simulated this round, `skipped` lists candidates skipped by anti-repetition rules,
`ms` is search time (reserved budget 320 ms, far below platform 500 ms limit).
