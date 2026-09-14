<div align="right">

**English** | <a href="./README.zh-CN.md">简体中文</a>

</div>

# Hybrid Tactical-First Anytime Optimizer

Geometry Battle V1.1 competition algorithm (Round 2). The third algorithm, designed to answer:

> Does Fast Tactical Solver's dominance come from a sound algorithmic meta,
> or has First Solver + Shooter Cancellation collapsed the strategy space?

## Positioning

Not a copy of Fast, nor Optimizer with an `if shooter: ...` tacked on.
This is a **true anytime search**:

> Stop at any earlier moment and it already holds an executable legal candidate;
> as computation continues, function quality improves incrementally.

Literally implemented: the first thing constructed is a guaranteed-legal fallback,
`best` updates immediately whenever any candidate beats it, and every stage boundary is a "safe to stop now" checkpoint.

## Three Stages

| Stage | Content | Budget |
|---|---|---|
| Stage 1 Tactical | Assassination lines, lines to each enemy point, quadratics through (opponent Shooter + any enemy point), single-parameter bend family sweep | ~3 ms (soft cap 60 ms) |
| Stage 2 Multi-target | Exact rational interpolation of up to 3 points, trigonometric families, composite families | ≤ 320 ms |
| Stage 3 Deep search | Larger target combinations under DoF sweep, local refinement | ≤ 250 ms, and only enabled when Stage 1/2 produce no decisive solution |

**Early Return**: Stage 1 already covers all cheap tactical answers (it's not a sample, but the entire family),
so when Stage 1 completes with a shooter kill or ≥2 kills, fire immediately without entering subsequent stages.
This is not optimization but direct consequence of rule economics — the platform times from GO to result commit, every extra millisecond spent
is "not yet fired", and the opponent's attack can cancel this entire round during that window.

## Geometry & Legality

All curves are written in incremental form with own Shooter as origin:

```
V = (x - x_s) / L,  f(x) = y_s + g(V),  g(0) = 0
```

`f(x_s) = y_s` is therefore an identity, never drifting to the 1e-6 Shooter tolerance edge;
`L` normalizes the attack interval to `|V| ≤ 1`, coefficients naturally stay within `|const| ≤ 1000`.

Polynomial interpolation uses `fractions.Fraction` for exact solving, converting to float only at the last step.
When target points cluster in V, Vandermonde becomes ill-conditioned and coefficients can spike to 1e4 magnitude —
such combinations are explicitly skipped rather than paying to solve an equation destined to fail.

Trajectory scanning is **conservative**: if clearance cannot be proven, mark as blocked.
False-blocking loses one kill, false-clearance loses the entire round.

## Modules

```
solver.py       Entry point, time budget, atomic write, GB_DIAG per-stage diagnostics
gbhy/world.py   (public, reveal, team) → board in Shooter coordinate system
gbhy/dsl.py     AST construction, measurement, public legality screening
gbhy/geom.py    Trajectory scan (obstacles / field boundary / hits) and scoring
gbhy/fit.py     Exact rational interpolation
gbhy/cand.py    Per-stage candidate families
gbhy/search.py  Anytime orchestrator
```

## Rule Sources

Uses only frozen Playtest Rules and public `competitor-kit/`.
No internal implementation of Judge / Validator / SandboxRunner was read.

Field boundary termination comes from Playtest Rules §34 verbatim, and was confirmed
by independent black-box cross-check in Round 1 (866/866 agreement); this algorithm uses no undisclosed constants.

## Measured Performance (1170 real worlds × 2 teams)

| Metric | Hybrid | Fast (Round 1) | Optimizer (Round 1) |
|---|---|---|---|
| Illegal / crashed | **0** | 0 | 0 |
| Wall time median | 30.9 ms | 27.2 ms | 189.7 ms |
| Wall time p95 | 87.0 ms | 53.5 ms | 332.6 ms |
| Self-reported time median | 8.7 ms | — | — |
| Predicted hit opponent Shooter | 48.3% | 53.6% | 55.0% |
| Stage 1 early return rate | 46.1% | — | — |

Local Validator / Official Preflight: **PASS** (2 teams × 9 sections).
