<div align="right">

**English** | <a href="./DUAL_ALGORITHM_PLAYTEST_REPORT.zh-CN.md">简体中文</a>

</div>

# Dual Algorithm Playtest Report

Geometry Battle V1.1 — First Algorithm Head-to-Head Playtest
Two competing algorithms: `solver-fast` (Fast Tactical Solver) and `solver-optimizer` (Optimization Solver)

- Protocol version: 1.1 (`competitor-kit/` public interface)
- Test date: 2026-09-10
- Test Harness: `playtest/harness/gb_playtest.py`, `gb_check.py` (playtest-only, no platform modifications)

> This report relies exclusively on the `competitor-kit/` public interface and black-box CLI behavior. Judging code, SandboxRunner, Judge, and Match engine internals were not read. All "actual hits / kills / timing / cancellations" are taken from the platform's own `match.json` / `replay.json` artifacts.

---

## 0. Executive Summary

| Question | Conclusion |
|---|---|
| Does Fast overwhelm Optimizer due to speed advantage? | **Yes, decisively**: 50 wins / 0 losses / 10 draws |
| Can Optimizer's multi-kill / obstacle handling compensate for speed deficit? | **No**: 52% of rounds cancelled by first-strike assassination, actual kills/valid = 0.27 |
| Do results change significantly after Team A/B swap? | **No**: 21/21 decided conditions, outcome independent of slot |
| Does Shooter assassination occur frequently? | **Yes**: Fast hits opponent Shooter at 52% rate, causing Optimizer's 52% round cancellation |
| Do long no-kill stalemates occur frequently? | Partially: longest streak 28 consecutive zero-kill rounds; 10/60 matches deadlocked to external round limit |
| Do the two algorithms truly exhibit different strategies? | **Yes**: Fast ~64 candidates / 12.8ms / 15 nodes; Optimizer ~957 candidates / 142ms / 16-49 nodes, including trigonometric/composite function families |

Key rule discovery: **Trajectories also terminate when leaving field boundaries `y ∈ [-12, 12]`**, but `competitor-kit/` only documents "first obstacle contact" as a termination condition (see §5 Finding 1).

---

## 1. Fast Solver

Directory: `playtest/competitors/solver-fast/`

### strategy

A **small, bounded, value-sorted closed-form candidate pool** with no global search:

1. **Priority assassination**: shooter → opponent Shooter line (first-strike hit on opponent Shooter cancels their entire round);
2. Lines through each surviving enemy point;
3. Quadratic curves through "opponent Shooter + another point";
4. **Single-parameter bend family** `f = y_s + a·u + b·u^k` (`k ∈ {2,3,4}`, `a,b` closed-form solved to pass exactly through shooter + one target) — different `k` provides different curvature, zero-cost obstacle avoidance tool;
5. Cubic curves (shooter + two/three points);
6. Small set of exact sinusoids (shooter + one target).

Every candidate is **constructively exact** (identically passes through targets) and scored with **conservative** trajectory scanning (Lipschitz tunnel + bisection; when uncertain, always judge blocked). Candidate pool is lazily traversed with early stopping on hit:

- Hit opponent Shooter **and** hit another point → stop immediately;
- Triple kill → stop immediately;
- Already holding Shooter kill and exceeded soft time limit → stop;
- Otherwise proceed to hard cap.

Always retain one guaranteed-legal fallback line (shooter → opponent Shooter). Legal weak shot beats TIMEOUT / INVALID.

### implementation structure

```
solver.py       Entry, time budget, early-stop policy, atomic write, GB_DIAG diagnostics
gb_world.py     (public, reveal, team) → board (shooter/enemy points/obstacles/field boundaries)
gb_dsl.py       DSL construction + structure validation + custom AST evaluator
gb_geom.py      Obstacle geometry + conservative trajectory scanning + field boundary scanning
gb_cand.py      Candidate closed-forms + scoring (including field boundary termination)
gb_screen.py    Legality scanning (cheap + dense, launch gating)
gb_pool.py      Sorted candidate pool
```

Independent of `solver-optimizer` (no cross-package import).

### Local Validator

```
PRE-FLIGHT PASS — 2 teams × 9 segments all pass
Team A time ~6.7 ms; Team B ~7 ms; AST 15 nodes, convexity sign changes 0
```

### Preflight

Official Preflight (console `--a/--b` installation flow, both slot arrangements tested):

```
Preflight ✓ PASSED  (both fast-A and opt-A arrangements pass)
```

### benchmark

Direct invocation 1170 times (585 real round worlds × both sides), all `rc=0`:

| Metric | Value |
|---|---|
| Invalid outputs | **0** |
| Timeouts | **0** |
| median / p95 / max compute time | **27.2 / 53.4 / 75.8 ms** |
| Candidates (tried) median / p95 | 64 / 190 |
| Selected AST nodes / depth (median) | 15 / 6 |
| Predicted kills (self-assessed) mean | 0.97 |
| Shooter-target frequency (self-assessed) | 53.6% |

### known weaknesses

- Conservative scanning judges "cannot prove clear" curves as blocked, may miss genuinely passable curves (intentional: misjudging blocked only costs one kill, misjudging clear means entire round 0 kills).
- 43% of rounds no-hit (many shots blocked by obstacles or field boundaries).
- Bounded candidate pool (no global search), will miss multi-kills requiring specific complex curves.

---

## 2. Optimization Solver

Directory: `playtest/competitors/solver-optimizer/`

### strategy

A **true time-budgeted search** covering multiple function families, all constructively exact:

- **Exact multi-target interpolation** `f = y_s + Σ c_k·V^k` (`V=(x−x_s)/L`), using `fractions.Fraction` for exact rational solving (Newton divided differences → monomial), then Richardson refinement on launch AST operation order; degree ladder up to K=10;
- **Subset selection**: greedy seeding (opponent Shooter priority) + local point-swap refinement + deterministic seeded (by `match_id+round+team`) random restart;
- **Spare-degree scanning**: overdetermined subsets have one free leading coefficient, scan this true 1-parameter curve family to thread gaps;
- **Trigonometric families** `a·sin(b·u)`, `a·sin(b·u)+c·(1−cos(d·u))`, `a·u+c·sin(b·u)` (1/2 point exact fitting, controlled frequency grid);
- **Composite function families** `a·u+b·(exp(c·u)−1)`, `a·u+b·(√(1+c·u)−1)` (explicit domain protection);
- **Obstacle-aware scoring**: kills before termination point + shooter bonus + gap reward + node/steepness penalty.

### implementation structure

```
solver.py       Entry, config.json budget, atomic write, diagnostics
config.json     budget_ms=1500 / slack_ms=150
gboptim/
  astlib.py     DSL construction + structural constraints
  evaluator.py  Independent AST evaluator (value + parse 1st/2nd derivatives)
  geometry.py   Obstacle signed distance + first contact (including field boundary termination)
  fit.py        Exact rational interpolation + refinement
  scoring.py    Obstacle-aware filtering and scoring
  search.py     Time-budgeted search
  world.py      (public, reveal, team) → board
```

Independent of `solver-fast` (no cross-package import).

### Local Validator

```
PRE-FLIGHT PASS — 2 teams × 9 segments all pass
Team A / B time ~286 ms / ~308 ms; AST 21-29 nodes, convexity sign changes ≤2
```

### Preflight

```
Preflight ✓ PASSED  (both fast-A and opt-A arrangements pass)
```

### benchmark

Direct invocation 1170 times, all `rc=0`:

| Metric | Value |
|---|---|
| Invalid outputs | **0** |
| Timeouts | **0** |
| median / p95 / max compute time | **189.7 / 332.2 / 554.4 ms** (max excludes one system load artifact, see §5 Test limitation) |
| Candidates median / p95 | 957 / 1144 |
| Selected AST nodes / depth (median) | 16 / 7 |
| Predicted kills (self-assessed) mean | 1.43 |
| Shooter-target frequency (self-assessed) | 55.0% |

### known weaknesses

- **Fundamental speed disadvantage**: median 190ms vs Fast 27ms, always second strike (first-shot rate = 0).
- **First-strike assassinated**: 52% of rounds its Shooter is killed by Fast's first strike, entire round cancelled, premium functions never fire.
- Search **exhausts** its candidate pool within ~190-550ms (not using full 1500ms budget), search breadth limited by candidate pool not timeout.
- Time-budgeted search results vary slightly with runtime environment (same world confirmed deterministic, but candidate pool size limits coverage).

---

## 3. Head-to-Head

- Match count: **60 matches** (30 map conditions × 2 slot arrangements A/B swap)
- Maps: 6v6 / 8v8 / 10v10 × easy / medium / hard, 30 **mutually distinct** map hashes; each condition's two matches use **same seed** (swap sees same map)
- External round cap: `--max-rounds 30` (test harness guardrail only, not competition rule)

### wins

| | fast | optimizer | draw |
|---|---|---|---|
| Total | **50** | **0** | 10 |
| fast-A arrangement (fast=Team A) | 26 | 0 | 4 |
| opt-A arrangement (fast=Team B) | 24 | 0 | 6 |

**Swap consistency**: Of 30 conditions, 21 had both sides reach decision, **21/21 all fast wins** (regardless of fast in A or B slot). Outcome independent of slot.

### match length

- median **6 rounds**, p95 **30 rounds**, max 30 (external cap); 10/60 matches deadlocked to cap judged `draw`.

### Per-algorithm summary (585 rounds)

| Metric | fast | optimizer |
|---|---|---|
| Valid shots | 585 | 281 |
| Invalid outputs | 0 | 0 |
| Timeouts | 0 | 0 |
| Cancelled rounds | 0 | **304 (52%)** |
| Blocked (trajectory blocked) | 147 | 244 |
| Kills | 464 | 76 |
| Shooter kills | 304 | 28 |
| Multi-kill (≥2 kills per round) | 128 | 34 |
| kills per valid shot | **0.793** | **0.270** |
| first-shot rate | **1.000** | **0.000** |
| Shooter-kill rate | 0.520 | 0.048 |
| multi-kill rate | 0.219 | 0.058 |
| no-hit rate | 0.429 | 0.933 |

### timing

| | fast | optimizer |
|---|---|---|
| median / p95 / max compute time | 12.8 / 37.6 / 61.2 ms | 142.1 / 236.1 / 314.7 ms |

### no-progress behavior

- Longest consecutive zero-kill streak: **28 rounds** (occurred in one 10v10 medium map match).
- 10 `draw` matches (deadlocked to 30-round cap) all correspond to "mutual no-progress" situations, platform reports `UNDECIDED`, consistent with V1.1's absence of Stalemate Rule.

---

## 4. Key Question Answers

1. **Does Fast significantly overwhelm Optimizer due to speed advantage?** Yes. 50-0-10, and after swap still 21/21 one-sided. Speed difference (27ms vs 190ms) makes Fast **first strike every round**, first shot is assassination line.
2. **Can Optimizer's multi-kill / obstacle handling compensate for speed deficit?** No. In isolation Optimizer does produce superior functions (self-assessed 1.43 kills/round vs Fast 0.97), but 52% rounds cancelled by first-strike assassination, actual kills/valid only 0.27, far below Fast's 0.793.
3. **Do results change significantly after Team A/B swap?** No. 21/21 consistent, no slot bias.
4. **Does Shooter assassination occur frequently?** Yes. Fast hits opponent Shooter at 52% rate, directly causing Optimizer's 52% round cancellation.
5. **Do long no-kill stalemates occur frequently?** Occurs locally. Longest 28-round zero-kill, 10/60 matches deadlocked, concentrated in obstacle-dense (hard/medium) maps where both Shooters mutually blocked.
6. **Do the two algorithms truly exhibit different strategies?** Yes. Candidate scale (64 vs 957), AST form (lines/quadratics/cubics vs polynomials/trigonometric/composite), time budget (~13ms early-stop vs ~190ms search) all significantly different, and no cross-package import.

---

## 5. Findings

### Algorithm finding

1. **First-strike assassination is decisive**. Fast's "first strike + assassinate opponent Shooter" combination causes Optimizer's 52% round cancellation, Optimizer's premium functions never fire. This is speed advantage's multiplier effect, not Optimizer's function quality being insufficient.
2. **Optimizer's obstacle handling ineffective in real matches**. It self-assesses gap-threading, multi-kill capability, but `kills/valid = 0.27` (vs Fast 0.793) shows: even when firing, its chosen curves hit less than Fast's assassination lines.
3. **Optimizer search does not use full budget**. Candidate pool exhausted within ~190-550ms (budget 1500ms), search breadth limited. For "optimization" route to truly perform, needs larger candidate pool / more random restarts / more function families.

### Platform finding

4. **Platform adds algorithm directory to `sys.path` before match start** (`competitor-kit/README.md` §1 already declared) — Fast relies on this behavior for `import gb_cand` etc., Optimizer does its own `sys.path.insert`. Both pass sandbox validation, behavior consistent. (Not an issue, only recording confirmation.)

### Rule-design finding

5. **【IMPORTANT】Trajectory termination conditions incomplete in public documentation**. `competitor-kit/ALGORITHM_REQUIREMENTS.md` §6 and `DSL_SPECIFICATION.md` §7 only document "first obstacle contact" termination; but actual testing (866 rounds cross-validation 100% consistent) shows platform also **immediately terminates trajectory when function graph leaves field boundary `y ∈ [-12, 12]`**. This means: if curve exceeds `y > 12` or `y < -12` before reaching target point, target becomes unreachable, entire round 0 kills. Lines through two in-field points always stay in-field (convexity), so starter/lines unaffected; but quadratic/cubic/trigonometric functions easily "bulge out" of field between two points. This is this round's most important **rule documentation gap**, recommend supplementing explanation in competitor-kit.
6. **Absence of Stalemate Rule repeatedly triggered**. 10/60 matches deadlocked to external cap, platform reports `UNDECIDED`; longest 28-round zero-kill. Recommend (as rule design suggestion, not implemented in this task): introduce `MAX_NO_PROGRESS_ROUNDS` type termination condition.

### Test limitation

7. **0 obstacle / 1 obstacle maps unreachable through public CLI**. `--difficulty easy` produces 2 obstacles, `medium` 4, `hard` 6; cannot construct 0/1 obstacle conditions. Task specification §6 requires coverage of "0 obstacles / 1 obstacle", these two items marked **unavailable** (not reading MapGenerator private implementation to fill gap).
8. **Benchmark wall-clock can include system load**. In 1170 direct invocations, 1 recorded 14.7s (internal diagnostics only 462ms, 5 retests all 250ms), artifact of test machine CPU contention, already excluded from max.
9. **Optimizer's per-round stderr diagnostics (candidate count / predicted kills) do not appear in match console** (sandbox stderr not forwarded to CLI output), so these metrics collected through direct replay (benchmark), not read from match artifacts.

---

## 6. Platform / Rule Integrity

No platform items modified: `timeout`, `TIE_EPS_MS`, DSL rules, AST constraints, convexity constraints, Shooter rules, Judge, hit logic, obstacle logic, START gate, Sandbox all untouched. `algorithms/team-a`, `algorithms/team-b` not touched. Test slots installed in `playtest/slots/` (playtest-only).

---

## 7. Completion Conclusion

```
DUAL ALGORITHM PLAYTEST DEVELOPMENT COMPLETE
READY FOR PLAYTEST REVIEW
```

(Note: fast winning in this round does not mean it is the "optimal algorithm" — it merely dominates under this "first-strike assassination" rule set and these 30 maps. Optimizer's function quality in isolation is indeed higher, but suppressed by first-strike mechanism.)
