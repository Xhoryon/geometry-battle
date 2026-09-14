<div align="right">

**English** | <a href="./ROUND_2_BALANCE_PLAYTEST_REPORT.zh-CN.md">简体中文</a>

</div>


# Round 2 — Algorithm Balance Playtest Report



Geometry Battle V1.1 · Three-Algorithm Competition · Official Rules Experiment + Counterfactual Experiments

- Protocol version: 1.1 (`competitor-kit/` public interface)
- Protocol version: 1.1 (`competitor-kit/` public interface)
- Test date: 2026-09-10
- Round nature: **Playtest / Balance study, not a platform development task**
- Report version: **rev 2** (Some conclusions from rev 1 were overturned after adversarial review; see §25 for revisions)

---

## Git baseline (Addressable anchor for all evidence in this round)

| Item | Value |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| HEAD (at result write time) | `f920f37384d07402b2376c36fde7b86765ba7901` |
| **RULE_BASELINE_SHA** | `8f7dc11029e99395ebcf977b85dc93780017ffb1` |
| **ROUND1_BASELINE_SHA** | `6f987bfbd0ebbf9978cf1546817aa097e844e641` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904` (**unchanged** this round) |
| Working tree (at result write time) | **clean** (`git status` no output) |


**Canonical rule path** (Sole authoritative rule input for this round, unmodified, unrenamed):

```
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```


> The `Plans/Input/Geometry Battle V1.1 Playtest Rules.md` referenced in task specification §0 **does not exist** in this repository.
> Per user ruling, all references to that name are uniformly interpreted as the canonical path above.
> This is a **DOCUMENTATION FINDING**; see §17.

---

## 1. Executive Summary



The core question from Round 1 was: Does the 50-0-10 dominance of Fast Tactical Solver come from a legitimate algorithm meta, or did First Solver + Shooter Cancellation flatten the strategy space?


This round provides a **clear answer: the latter**, and it is quantitative.

| Conclusion | Answer |
|---|---|
| A. Did Hybrid materially close the gap to Fast? | **NO (but significantly narrowed)** — Under official rules Fast 26 / Hybrid 8 / Draw 26; after adjudicating draws by kills: **Fast 38 / Hybrid 17**. Fast still wins 69% of decided matches |
| B. Is Shooter Cancellation a major contributor to Fast dominance? | **YES** — Removing cancellation **completely reverses** outcomes: 50-0-10 → **2-38-20** |

| C. Does first-solver speed excessively suppress function quality? | **YES** — In fast-vs-optimizer alone, cancellation consumed **787 kills**, of which **84.8% landed on points that survived to the end**; Optimizer only achieved 76 kills total |
| D. Should the official rules change before proceeding toward tournament freeze? | **Recommended YES (recommendation only, not implemented)** |
| E. Is there enough evidence to define a Stalemate Rule? | **NO** — Observed "stalemates" are **absorbing fixed points**, and the distribution is right-censored by test limits; threshold is **not identifiable** (§14) |


The two most critical structural findings:

> **1. Under this ruleset, speed affects outcomes through only one channel: Shot Cancellation itself.**
> Because §40/§41 freeze the round snapshot, first-solver order **produces no mathematical difference in results**—this is derived directly from the specification, not experimentally discovered (§10 explains why the original phrasing was incorrect).
>
> **2. "Stalemates" are not slow convergence, but absorbing fixed points.** In matches that hit the 30-round cap, both sides emit **the same function** every round, Shooters remain constant, hits remain 0; raising the cap to 60 rounds **still hits the cap** (§13).

---

## 2. Baseline Reproduction



### 2.1 Independent reproduction of Round 1 from committed evidence


Without trusting Round 1 report conclusions, recalculate using only the content at `ROUND1_BASELINE_SHA`:

```
git archive 6f987bf | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results
```


**exit 0, all reconciliations passed**. The sole source of truth is `raw/*/match.json` (artifacts persisted by the platform itself):

| Item | Reproduced value | Report claimed |
|---|---|---|
| matches / conditions / distinct map hashes | 60 / 30 / 30 | 60 / 30 / 30 |
| rounds / algorithm invocations | 585 / 1170 | 585 / 1170 |
| fast / optimizer / draw | 50 / 0 / 10 | 50 / 0 / 10 |
| INVALID / TIMEOUT | 0 / 0 | 0 / 0 |
| optimizer cancelled | 304 | 304 |
| fast blocked / kills / shooter kills / multi | 147 / 464 / 304 / 128 | same |
| optimizer blocked / kills / shooter kills / multi | 244 / 76 / 28 / 34 | same |
| kills per valid shot | 0.793 / 0.270 | same |
| first-shot rate | 1.000 / 0.000 | same |
| cross-validation | 866/866 match, 0 mismatch | same |
| swap consistency | 21/21 | 21/21 |
| max-rounds stalemate | 10 | 10 |
| median compute time | 12.8 / 142.1 ms | same |

**BASELINE REPRODUCTION PASSED.**


### 2.2 Platform reproducibility — to what level of precision


Round 2 completely re-ran `fast-vs-optimizer` with the same 30 conditions (60 matches) and performed field-by-field comparison.


**Judgment level: completely identical.**

| Item | Result |
|---|---|
| winner / rounds | 60 / 60 identical |
| per-round aHits / bHits / aKills / bKills | all identical |
| aBlocked / bBlocked / cancelledA / cancelledB / aErrorCode / bErrorCode | all identical |
| aliveAAfter / aliveBAfter / result / firstSolver | all identical |

| aFunction / bFunction and their hashes | all identical |
| mapSeed / mapHash / pointCount / difficulty / seed | all 585 rounds identical |
| installed package hash (slot content) | all 60 matches identical |


**Timing level: not reproducible.**

- Of 866 pairwise non-empty single-side timings, **0 were identical**; mean difference +0.71 ms, standard deviation 4.13 ms, extremes −39.6 ms / +43.9 ms; 33% differ >1 ms, 7% differ >5 ms.
- All 60 matches have different `wallSeconds`.


**State hashes: all different, but combat-independent.** `publicStateHash` / `revealStateHash` / `roundStateHash` differ in all 585 rounds, `matchId` has zero overlap across 60 matches. Root cause: `buildPublicState` / `buildRevealState` embed the randomly generated `match_id` into state JSON, so these hash differences **carry no information about combat randomness**.


> **Correcting rev 1's over-assertion**: rev 1 stated "the platform is completely deterministic for fixed algorithm pairs + fixed seeds."
> Strictly speaking, **only judgment is deterministic and reproducible; timing is wall-clock time, explicitly not reproducible**.
> Anywhere this report subsequently uses `aTimeMs` / `bTimeMs`, it is only as **distributional statistics**, not as reproducible quantitative facts.

---

## 3. Hybrid Design

`playtest/competitors/solver-hybrid/` — **Hybrid Tactical-First Anytime Optimizer**



Design contract (task specification §9):


> If stopped at any earlier time, already possesses an executable legal candidate; as computation continues, function quality gradually improves.


Literal implementation: the first thing constructed is a guaranteed-legal fallback; `best` is immediately updated whenever any candidate beats it; every stage boundary is a "can submit even if stopped now" point.

| Stage | Content | Measured (1170 worlds) |
|---|---|---|
| **Stage 1 Tactical** | Assassination lines, lines to each enemy point, quadratics passing exactly through (opponent Shooter + any enemy point), single-parameter bend family | median **3.26 ms**, candidate median 18 |
| **Stage 2 Multi-target** | ≤3-point exact rational interpolation, trigonometric family, composite family | only 631/1170 entered, median 5.99 ms |
| **Stage 3 Deep search** | Larger combinations under degree-of-freedom sweep, local refinement | only 598/1170 entered, median 0.01 ms |


**EARLY RETURN (§6)**: Stage 1 covers the **entire cheap tactical family** (not sampling). Therefore, when Stage 1 completes, if already holding a shooter kill or ≥2 kills, **fire immediately, do not enter subsequent stages**.

| Stop reason | Proportion |
|---|---|
| `stage1: shooter + another kill` | 30.2% |
| `stage1: decisive tactical shot` | 15.9% |
| `stage2: shooter + another kill` / `triple kill` | 1.5% / 1.4% |
| `stage3: shooter + another kill` | 0.1% |
| budget exhausted (no decisive solution) | 51.0% |


**46.1% of rounds fire directly in Stage 1** — this is precisely why Hybrid can match Fast's speed tier.


### 3.1 Geometry and legality

```
V = (x − x_s) / L,   f(x) = y_s + g(V),   g(0) = 0
```

- `f(x_s) = y_s` is an **identity**, will not drift to the 1e-6 tolerance edge (kit §9 recommendation).
- `L` normalizes to `|V| ≤ 1`, polynomial coefficients naturally fall within `|const| ≤ 1000`.
- Polynomials are solved **exactly** using `fractions.Fraction`; target combinations clustered on V make Vandermonde ill-conditioned (coefficients surge to 3×10⁴), such combinations are **explicitly skipped**.
- Trajectory scanning is **conservative**: if clearance cannot be proven, judged as blocked.


### 3.2 Rule sources (compliance statement)


Hybrid's design inputs are **only** the frozen Playtest Rules and public `competitor-kit/`. Arena boundary termination is taken from §34 plaintext, and was confirmed in Round 1 by independent black-box cross-check (866/866).


> **Process disclosure (voluntary)**: When drafting competitor-kit reference documentation, a sub-agent read `src/core/Judge.ts`. Internal details obtained there (sampling step `min(0.005, π/(8ω))`, `maxPoints`, `OBSTACLE_CONTACT_EPS`, `penetration` convention) **are explicitly excluded from Hybrid design inputs**. The y-boundary termination rule itself belongs to §34 public content and does not constitute leaked usage.

---

## 4. Hybrid Benchmark


### 4.1 Local Validator / Official Preflight


```
PRE-FLIGHT PASS — 2 teams × 9 sections all passed
Package hash: a11dbf0a47622305ac123b2efeec07d8d4d653c955cc69f6f00b1f8dd44942b
Team A / Team B time: 14.7 / 14.9 ms (limit: 2000 ms)
```


The same hash is recorded consistently in both experimental slot installation reports (`install-report.json`), can be cross-verified.


### 4.2 Offline robustness matrix (§10)


The public operator CLI **cannot produce maps with 0 or 1 obstacles** (independently verified this round: `--obstacles 0` / `--obstacles 1` both rejected as unknown options; `--difficulty` only maps easy=2 / medium=4 / hard=6). Therefore, **platform-level competitions** with 0/1 obstacles cannot be produced without reading MapGenerator—recorded as TEST LIMITATION.


Algorithm-side matrix completed offline (`gb_matrix.py`: synthetic worlds + public legality screening + black-box hit model):

| Package | runs | illegal | TIMEOUT | no result |
|---|---|---|---|---|
| **solver-hybrid** | 600 | **0** | **0** | **0** |
| solver-fast | 600 | 0 | 0 | 0 |
| solver-optimizer | 600 | 0 | 0 | 0 |


Shape: obstacles {0,1,2,4,6} × team size {6,8,10} × team {A,B} × 20 seeds. Hybrid achieves average predicted kills of 2.00 with 0 obstacles, 1.60–1.88 with 6 obstacles.


### 4.3 Comparison with the other two algorithms

| Metric | Hybrid | Fast (Round-1 bench) | Optimizer (Round-1 bench) |
|---|---|---|---|
| illegal / crash (1170 invocations) | **0** | 0 | 0 |
| wall time median | 29.4 ms | 27.2 ms | 189.7 ms |
| wall time p95 / max | 85.8 / 493.9 ms | 53.5 / 75.8 ms | 332.6 / 14741 ms |
| self-reported time median | 8.6 ms | — | — |
| predicted hit on opponent Shooter | 48.3% | 53.6% | 55.0% |
| predicted kills mean | 0.93 | 0.97 | 1.43 |

**ALGORITHM FINDING**: Hybrid and Fast belong to the same speed tier.


**ALGORITHM FINDING (Marginal value of Stage 3)**: Across 1170 real worlds, Stage 3 produced candidates (up to 235) but only changed the final selection **1 time**. Under the current ruleset, **once tactical solutions exist, deeper curve fitting produces almost no value**—this is a direct within-algorithm answer to "does first-solver speed excessively suppress function quality."

---

## 5. Current-rule Results



Scale (§13): Each pair consists of **30 conditions × slot swap = 60 matches**.

- Condition set is **completely identical** to Round 1 (same seeds / team sizes / difficulties), directly comparable to Round 1.
- Maps: 6v6 / 8v8 / 10v10 × easy / medium / hard, 30 distinct map hashes.
- External round cap `--max-rounds 30` (**test guardrail only, not competition rule**—this has decisive consequences in §14).
- Three groups total **180 matches**, approximately 1900 seconds wall time.

| pair | Winner A | Winner B | Draw |
|---|---|---|---|
| **fast-vs-hybrid** | Fast **26** | Hybrid **8** | **26** |
| **optimizer-vs-hybrid** | Hybrid **39** | Optimizer **4** | **17** |
| **fast-vs-optimizer** | Fast **50** | Optimizer **0** | **10** |


**0 INVALID · 0 TIMEOUT · 0 CRASH** (180 matches / 2316 rounds / 3774 actually executed shots).

---

## 6. Fast vs Hybrid (Core question of §15)

| | Fast | Hybrid |
|---|---|---|
| wins | **26** | **8** |
| draw | 26 | 26 |
| first-shot rate | **0.768** | 0.232 |
| cancelled rounds | 117 (11.8%) | 187 (18.9%) |
| kills | **378** | 260 |
| shooter kills | **193** | 118 |
| kills per valid shot | **0.433** | 0.324 |
| multi-kill rate | 0.146 | 0.097 |
| no-hit rate | 0.766 | 0.842 |
| compute time median / p95 | 16.1 / 36.7 ms | 23.6 / 168.0 ms |


### 6.1 Draws are not equilibrium, but clock expiration


**All 26 draws have `exhausted=True` (hit the 30-round cap).** Among them:

- **12 / 26 have survival difference ≥ 2**, 5 / 26 have difference ≥ 4.
- Extreme case `s1111-p10-medium__fast-A`: Fast survives 10 points / 8 kills, Hybrid survives 2 points / 0 kills — recorded as **draw**.
- Aggregate kill difference across 26 draws: Fast +12, Hybrid −9, 0 tied.


**After adjudicating draws by kill difference (or survival difference, same result): Fast 38 / Hybrid 17 / 5 completely tied.**


### 6.2 Correcting rev 1's over-assertion


rev 1 stated "net win difference compressed from +50 to +18" and concluded Hybrid materially closed the gap. This comparison **does not hold**:

- In Round 1's 50-0-10, **50/50 matches were decided**; this round's fast-vs-hybrid has only **34/60 decided**.
- Directly comparing net values across different "decided match counts" is comparing apples to oranges.
- By adjudication caliber, Fast's win rate dropped from 100% (50/50) to **69% (38/55)**—indeed significantly down, but **still a clear lead** (binomial test P(Fast ≥ 26/34 | fair) ≈ 0.0015).


**Honest statement**:


> Hybrid **significantly narrowed** the gap with Fast (Fast's decided win rate 100% → 69%, and won 8 matches while Optimizer won 0), but **did not close** it; moreover, about 43% of matches reached no decision, these stalemates "absorbed" the gap into draws.


Comparing to `optimizer-vs-hybrid` (Hybrid 39 / Optimizer 4) shows: Hybrid's leap over **Optimizer** is decisive; relative to **Fast** it's only narrowing.

---

## 7. Optimizer vs Hybrid

| | Hybrid | Optimizer |
|---|---|---|
| wins | **39** | **4** |
| draw | 17 | 17 |
| first-shot rate | **0.9987** | 0.0000 |
| cancelled rounds | **0** | 250 (33.7%) |
| kills | **434** | 144 |
| shooter kills | **250** | 47 |


Hybrid's dominance pattern over Optimizer is **completely isomorphic** to Fast over Optimizer: faster → first every round → 33.7% of rounds directly cancel opponent's entire round.


**RULE-DESIGN FINDING**: Under the same ruleset, two independent fast algorithms crushed the same slow algorithm using the same mechanism. The transmission path of speed advantage was independently reproduced twice.

---

## 8. Slot Swap (§12)



Each map condition was run in both `X = Team A` and `Y = Team A` arrangements, using **the same seed** (seeing the same map).


**Correcting rev 1's reporting caliber**: rev 1 only printed `swapConsistent / swapFlipped` without denominators, reading as if covering all 30 conditions. In reality, this metric **only counts conditions where both legs decided**, others (involving draws) are silently excluded. Full breakdown:

| pair | Both legs same | Both legs opposite | One leg draw | Both legs draw | Classifiable proportion |
|---|---|---|---|---|---|
| fast-vs-hybrid | 6 | **6** | 10 | 8 | **12 / 30 (40%)** |
| optimizer-vs-hybrid | 14 | 3 | 9 | 4 | **17 / 30 (57%)** |
| fast-vs-optimizer | 21 | 0 | 8 | 1 | **21 / 30 (70%)** |


6 **completely reversed** conditions in fast-vs-hybrid (same map, winner swaps after slot swap):

| condition | fast-A leg winner | hybrid-A leg winner |
|---|---|---|
| s909-p8-medium | hybrid | fast |
| s1414-p10-medium | hybrid | fast |
| s1616-p6-easy | hybrid | fast |
| s2222-p6-easy | hybrid | fast |
| s2424-p8-easy | fast | hybrid |
| s2626-p10-easy | fast | hybrid |


### 8.1 Algorithm effect vs slot effect (§12 requires distinction)

- **Slot effect: not found.** Both arrangements are **item-by-item perfectly symmetric** (fast-vs-hybrid's fast-A and hybrid-A both 13 / 4 / 13); full A/B slot timing median both **21.2 ms**; first-solver proportion A=0.5099 / B=0.4896.
- **Algorithm effect: exists.** fast-vs-optimizer has Fast overwhelmingly ahead in both arrangements (26 vs 24 wins), this is pure algorithm difference.
- **But fast-vs-hybrid's algorithm effect cannot be cleanly separated**: only 40% of conditions have both legs decided, half of which reversed. **This indicates that between two same-tier fast algorithms, match outcomes on the same map are highly sensitive to tiny timing jitter**—this itself is a conclusion, not noise.


### 8.2 §24's start skew — not observable


Task specification §24 requires recording `start skew`. **This quantity does not exist in platform public artifacts**: each round in `match.json` only has `aTimeMs` / `bTimeMs` (each side's GO-anchored compute time) and `firstSolver`, `console.log` also has no `release_ns` or any start offset field (grep-confirmed this round).


Therefore:


> **`start skew` is an unobservable quantity for this harness.** The §8.1 conclusion "slot bias not found" is based on **compute time distribution + first-solver proportion**, not on measured start offset. If the platform needs to support §24's full requirements, it must expose both sides' GO delivery moments in artifacts.

---

## 9. Counterfactual No-Cancel（§16 / §19）



Mode definition (specification §39/§55 only gives name and purpose, **does not define precise semantics**; below is this harness's definition):


> **CF-NO-CANCEL**: Retains §36 First Solver and frozen snapshot, only removes §38. First-solver shot resolves normally; second solver **even if its Shooter just died, as long as it produced a legal function, its attack still executes**.


### Result: outcomes completely reversed

| fast-vs-optimizer | Fast | Optimizer | Draw |
|---|---|---|---|
| Official rules | **50** | **0** | 10 |
| CF-NO-CANCEL | **2** | **38** | 20 |

| optimizer-vs-hybrid | Hybrid | Optimizer | Draw |
|---|---|---|---|
| Official rules | **39** | **4** | 17 |
| CF-NO-CANCEL | **3** | **37** | 20 |

| fast-vs-hybrid | Fast | Hybrid | Draw |
|---|---|---|---|
| Official rules | **26** | **8** | 26 |
| CF-NO-CANCEL | **13** | **10** | **37** |


Interpretation:

- First two groups **completely reversed**: Optimizer changed from "almost impossible to win" to "overwhelming majority wins". Cancellation rule is not Fast's bonus, but Optimizer's **veto**.
- Third group barely moved (net difference +18 → +3, change mainly draws 26→37). **The gap between Hybrid and Fast is not caused by cancellation**, but real quality/speed difference—two independent lines of evidence point to the same conclusion.

---

## 10. Counterfactual Simultaneous（§17 / §20）



> **CF-SIMULTANEOUS**: Both §36 and §38 removed. No first solver; both sides' legal functions resolve against START snapshot.


### Result: **round-by-round completely identical** to CF-NO-CANCEL in 180/180 comparisons


Comparison granularity is **per-round kill list**, not just winner.

| pair | Official | CF-NO-CANCEL | CF-SIMULTANEOUS | Match |
|---|---|---|---|---|
| fast-vs-optimizer | 50-0-10 | 2-38-20 | 2-38-20 | 60 / 60 |
| optimizer-vs-hybrid | 39-4-17 | 3-37-20 | 3-37-20 | 60 / 60 |
| fast-vs-hybrid | 26-8-26 | 13-10-37 | 13-10-37 | 60 / 60 |


### 【Important】Correcting rev 1's methodological assertion


rev 1 claimed "two modes are independent code paths, therefore 'whether equivalent' is a **measurement result**". **This is wrong.** They are **equivalent by construction**, due to the specification itself, not experimental discovery:


> §40/§41 stipulate that round snapshot freezes at START, second solver does not recompute. Since both sides' curves resolve against **the same snapshot**, "who attacks first" has **no channel to affect results** except triggering §38. Therefore "removing order" and "only removing cancellation" are mathematically the same operation.


So 180/180 consistency **is validation that the implementation faithfully encoded this model**, not independent evidence supporting equivalence. rev 2 has rewritten code comments and report statements accordingly.


**RULE-DESIGN FINDING (this round's most important structural conclusion)**:


> **Under this ruleset, the only channel through which speed affects outcomes is Shot Cancellation.**


This also answers §20: when speed no longer affects execution order, the relative strength among the three **does indeed change significantly**, but the change **comes entirely from the disappearance of cancellation**, not from order itself.

---

## 11. Cancellation Effect（§19）



### 11.1 Round-level cancellation cost


Method: For each cancelled round, offline re-run the cancelled side's algorithm on **that round's official world** to obtain its real function, then re-solve with "cancellation removed".


> rev 1's implementation advanced the world using CF-propagated survival sets, **systematically underestimating** results. rev 2 has corrected to use official per-round worlds (`aliveBefore`), numbers changed significantly (see below).

| pair | Algorithm | Rounds | Cancelled | Could have hit | **Lost kills** | **On final survivors** | Lost Shooter counter-kills |
|---|---|---|---|---|---|---|---|
| fast-vs-optimizer | optimizer | 585 | 304 (52.0%) | 303 | **787** | **667 (84.8%)** | **253** |
| optimizer-vs-hybrid | optimizer | 741 | 250 (33.7%) | 250 | **663** | 514 (77.5%) | 213 |
| fast-vs-hybrid | hybrid | 990 | 187 (18.9%) | 178 | 316 | 160 (50.6%) | 164 |
| fast-vs-hybrid | fast | 990 | 117 (11.8%) | 117 | 119 | 57 (47.9%) | 115 |


**The "on final survivors" column is the critical falsification test**: it rules out the alternative explanation "these kills would have landed on points already killed by others, so not real losses". In fast-vs-optimizer, **84.8% of lost kills targeted points that survived to the official match end**—these are truly interrupted kills.


Other numbers:

- 
- **787 kills** compared to Optimizer's actual **76 kills** across all matches—cancellation erased approximately **91%** of the kills its curves could have produced.
- 
- **253** cancelled shots were themselves counter-kills on Fast's Shooter (43% of all rounds). If allowed to execute, Optimizer could have reversed and cancelled Fast's entire round in nearly half of all rounds.


### 11.2 Robustness of this conclusion (independent verification)


Adversarial review used an **independently written simulator from scratch** (different code, different parsing loop) to reproduce CF-NO-CANCEL's 38-2-20, **0/60 divergence**; and re-ran from fresh cache (1360 offline solves, zero reuse) obtaining byte-identical results per match. Simultaneously ruled out alternative explanations:

- 
- Offline re-run solvers **byte-for-byte reproduced platform-recorded functions** on official worlds (217/217).
- 
- All CF re-run functions **222/222 passed public legality screening**, no illegal curves were overestimated.
- 
- No timeouts across all matches (max recorded time 356 ms, limit 2000 ms).

---

## 12. Speed Effect（§20）


| Algorithm | Valid shots | first-shot rate | Cancellation rate | kills / valid shot |
|---|---|---|---|---|
| fast | 1458 | **0.854** | 0.074 | **0.578** |
| hybrid | 1544 | 0.560 | 0.108 | 0.449 |
| optimizer | 772 | **0.000** | **0.418** | 0.285 |



Speed ladder Fast > Hybrid > Optimizer is monotonic across three dimensions: first-shot rate, cancellation rate, kills-per-shot.


Answer to §20:


> When speed no longer affects execution order, relative strength **changes significantly**—Optimizer changed from complete defeat in both matchups to overwhelming majority wins. And since §10 has proven "order" itself has no effect, this change is **entirely attributable to the disappearance of Shot Cancellation**.

---

## 13. No-progress Distribution（§21）



No-progress definition adopts specification §46 candidate definition: if both sides have 0 kills in a round, streak +1; if either side produces kills, reset to zero.

| Percentile | Consecutive zero-kill rounds (n = 180 matches) |
|---|---|
| P50 | 0 |
| P75 | 21 |
| P90 | 25 |
| P95 | 26 |
| P99 | 28 |
| MAX | 29 |


### 13.1 【Important】This set of percentiles is not a streak distribution


Adversarial review pointed out and independently confirmed this round: **these numbers cannot serve as threshold basis**, for three reasons.


**(a) The distribution is bimodal.** Among 180 matches, **127 matches have streak exactly 0** (kills every round); the remaining **53 matches are exactly the 53 matches that hit the 30-round cap**. No "mid-game ending medium-length streaks" exist. Verified all 53 matches individually: **observed streak ≡ 30 − last kill round**.


**(b) These tails are absorbing fixed points, not slow convergence.** Inspected all 53 matches item-by-item:


- Shooters constant (automatically select "lowest id among survivors", state unchanged means selection unchanged);

- **Both sides' emitted function hashes constant every round** (world unchanged + deterministic solver ⇒ same function);

- Tail rounds have 0 hits per round (40/53 both sides blocked, remaining 13/53 only one side blocked);

- Obstacles constant.


That is: state enters a fixed point where **both sides miss and forever repeat the same shot**, thereafter **never changes**.


**(c) Raising the cap cannot resolve it — directly verified experimentally.**


Re-ran 3 cap-hitting matches with `--max-rounds 60`:

| condition | arrangement | cap 30 | cap 60 |
|---|---|---|---|
| s101-p6-medium | fast-A | draw, 30 rounds, exhausted | **draw, 60 rounds, exhausted** |
| s1010-p8-medium | fast-A | draw, 30 rounds, exhausted | **draw, 60 rounds, exhausted** |
| s1010-p8-medium | hybrid-A | draw, 30 rounds, exhausted | **draw, 60 rounds, exhausted** |


After doubling the cap, **all still hit the cap**. Artifacts in `playtest/results/round-2/cap60-probe/`.


**Conclusion**: Percentiles scale 1:1 with cap (cap=20/30/50/100 → P75 = 11/21/41/91), **any "no-progress threshold" read from these numbers is merely re-encoding of arbitrary harness configuration**, not a property of the game being tested.

---

## 14. Match Length Distribution（§21 / §22）


| Percentile | Match rounds (n = 180) |
|---|---|
| P50 | 6 |
| P75 | 30 |
| P90 | 30 |
| P95 | 30 |
| MAX | 30 |
| mean | 12.87 |


Proportion hitting cap (judged `UNDECIDED`):

| pair | Stalemate / Total | Proportion |
|---|---|---|
| **fast-vs-hybrid** | 26 / 60 | **43.3%** |
| optimizer-vs-hybrid | 17 / 60 | 28.3% |
| fast-vs-optimizer | 10 / 60 | 16.7% |
| **Total** | **53 / 180** | **29.4%** |


**RULE-DESIGN FINDING**: Stalemate rate strongly correlates with "whether both sides' speed tiers are close". Round 1 had only one fast algorithm (16.7%); this round's fastest pair (Fast vs Hybrid) pushed stalemate rate to **43.3%**.


### Stalemate evidence sufficiency (§22)


**Answer: NO — insufficient to provide a threshold.**


- **Can support**: These stalemates are **real absorbing loops** (53/53 never self-resolve, still don't resolve at 60 rounds), therefore "ruleset lacks termination condition" **is established**, and confirmed on larger sample than Round 1 (10/60).

- **Cannot support**: **threshold value**. Distribution is right-censored by test cap, all 53 tail observations equal "cap − last kill round", no natural resolution observed. **hard round limit of 30 is merely harness default parameter** (`gb_round2.py` / `gb_playtest.py` / `gb_counterfactual.py` three places default=30), not derived from data.

- Additionally, stalemates concentrate in fast-vs-hybrid and medium/hard high-obstacle maps, sample is only 30 reused maps, **insufficient to support a universal threshold**.


> **rev 1 recommended `MAX_NO_PROGRESS_ROUNDS = 20` / `HARD_ROUND_LIMIT = 30`. rev 2 withdraws both recommendations.** They were read from censored percentiles, constituting circular reasoning.


**To make threshold recommendations, experiments needed first**: Measure natural stalemate distribution under **no cap** (or cap far higher than any candidate threshold, e.g., 1000 rounds), or apply explicit rule-level treatment for absorbing states (e.g., prohibit both sides from repeatedly emitting the same function in the same state). This round **did not implement any formal Stalemate Rule** (§22 explicitly forbids), nor did it implement the above experiments.

---

## 15. Platform Findings



### 15.1 Timing anomaly batches (§23) — identified, isolated, re-run


Inspection found **8 matches** with rounds showing single-side compute time > 300 ms (normal values 13–40 ms in same period). Among them **2 were substantive contamination**:

| Match | Anomalous rounds | Max time |
|---|---|---|
| `fast-vs-hybrid / s303-p6-medium__fast-A` | 22 / 60 | **935.7 ms** |
| `fast-vs-hybrid / s1111-p10-medium__fast-A` | 28 / 60 | 357.3 ms |


Characteristics: **both sides simultaneously** slowed, `aErrorCode` / `bErrorCode` both `null`, no cancellation — host-level pause, **not algorithm failure**.


Handling:

1. 
1. Original artifacts fully preserved in `playtest/results/round-2/platform-contaminated/`, including `CONTAMINATION.json` (matchId / seed / per-round anomalous times / winner / rounds).
2. 
2. All 8 matches re-run.
3. 
3. **After re-run, outcomes and rounds 100% consistent, no result changes**; `s303` max time dropped from 935.7 ms to 74.7 ms.


**Honest attribution**: `s1111-p10-medium__fast-A` (completed 13:00:19) window overlapped with a `validate-submission` heavy-load check executed by this round's author; `s303` consistent with known cross-round sandbox pause characteristics. Both are **PLATFORM-CONTAMINATED / environmental noise**, not counted as algorithm results.


**Limitation**: §23 requires saving `process state` / `sandbox state`. These two items **cannot be retroactively collected**—contamination was discovered during experiment progress, processes and sandboxes already destroyed. What was saved: platform's own persisted `match.json` / `replay.json` / `console.log` and per-round timing profiles. This is an **unmet item** for §23 in this round.


### 15.2 Team / slot bias not found (§24)


Both arrangements item-by-item symmetric; A/B slot timing median identical (21.2 ms); first-solver proportion 0.5099 / 0.4896. `start skew` **not observable** (§8.2).


### 15.3 Trajectory termination reason distribution

| Algorithm | Obstacle termination | **Arena boundary termination** | Normal domain end | No function/cancelled |
|---|---|---|---|---|
| fast | 11.9% | **55.3%** | 25.3% | 7.4% |
| hybrid | 64.8% | 6.4% | 18.0% | 10.8% |
| optimizer | 50.2% | 1.7% | 6.3% | 41.8% |


Round 1 report §5 Finding 1's observation "arena boundary termination not documented in competitor-kit" is quantified this round: **Fast has 55.3% of rounds terminated by arena boundary**, far higher than obstacle termination.


### 15.4 Platform judgment fully reproducible


See §2.2: judgment artifacts for 60 matches / 585 rounds field-by-field identical.

---


## 16. §4 Consistency confirmation (frozen algorithms vs public Arena Boundary rules)



Task specification §4 requires confirming `solver-fast` / `solver-optimizer` / harness all work according to public "first arena boundary exit → attack terminates permanently" rule.


**This round provided direct consistency evidence** (not just narrative): §18's OFFICIAL MODE validation compared shot-by-shot **platform-recorded trajectory endpoints** with termination points derived from public rule model, **0 mismatches across 3774 executed shots** (fast-vs-optimizer 866/866, optimizer-vs-hybrid 1232/1232, fast-vs-hybrid 1676/1676, tolerance 5e-3).


This directly proves: all three algorithms (including two Round 1 frozen algorithms) and harness produce trajectory termination behavior consistent with the platform under **public rules**, no residual differences depending on hidden Judge behavior.

---

## 17. Documentation Findings


1. 
1. **Task specification references non-existent filename**: §0 requires reading `Plans/Input/Geometry Battle V1.1 Playtest Rules.md`, this repository never had this file.
2. 
2. **Arena boundary termination condition still not documented in competitor-kit**, yet it affects 55.3% of Fast's rounds.
3. 
3. **Specification does not define CF-NO-CANCEL / CF-SIMULTANEOUS semantics** (§39/§55 only give name and purpose). This harness's definitions are written in `gb_counterfactual.py` module docstring.
4. 
4. **`aBlocked` field's precise predicate not public**. OFFICIAL MODE validation found: in rounds where trajectory terminates at **arena boundary**, platform `blocked` value is `True` 106 times / `False` 209 times (fast-vs-optimizer), model cannot reproduce this predicate from public rules. This field **does not participate in counterfactual computation**, does not affect any conclusions this round, but third parties cannot fully verify platform's blocked statistics—recommend publishing its definition.
5. 
5. **Platform does not expose `start skew`**, making §24 impossible to fully satisfy (§8.2).

---

## 18. Harness Integrity (§18 gate)


Gate requirement: Under OFFICIAL MODE, `harness result == official platform result`, otherwise counterfactual statistics must not be run.


Artifacts (persisted, independently verifiable):

```
playtest/results/round-2/cf/verify-fast-vs-optimizer.json
playtest/results/round-2/cf/verify-optimizer-vs-hybrid.json
playtest/results/round-2/cf/verify-fast-vs-hybrid.json
```

| Check item | fast-vs-opt | opt-vs-hybrid | fast-vs-hybrid | Total mismatches |
|---|---|---|---|---|
| Hit list (per shot) | 866 | 1232 | 1676 | **0** |
| **Trajectory termination point x (vs platform-recorded trajectory endpoint)** | 866 | 1232 | 1676 | **0** |
| Cancellation predicate | 585 | 740 | 990 | **0** |
| aliveAfter survival set | 585 | 741 | 990 | **0** |
| Match winner | 60 | 60 | 60 | **0** |


### 18.1 Explicit statement about gate scope (not concealing)


This round's gate judgment is **PASS**, but scope is clearly defined, declared item-by-item:

- **Passed portion**: **Every item** consumed by counterfactual computation (hits, termination points, cancellation predicate, survival, winner) has 0 mismatches across three pairs, 3774 shots total.
- **Excluded portion**: Platform's `aBlocked` / `bBlocked` fields. They have 106 / 298 inconsistencies with model in fast-vs-optimizer / fast-vs-hybrid respectively (field value splits in rounds terminated by arena boundary). This field **does not participate in any counterfactual computation**, its predicate is not public (§17.4).
- **rev 1's phrasing issue**: rev 1 directly claimed "100% consistency", did not place this exclusion item alongside §18's original requirements in the same paragraph. rev 2 clarifies: **§18's literal requirement (harness result exactly equals platform result) not achieved for `blocked` field; achieved for all fields counterfactuals depend on.** Whether to accept this scope belongs to subsequent review's judgment, not self-determined by this report.

---

## 19. Rule Health Verdict (§25)



### Verdict: `CANCELLATION-DOMINATED`


The five categories listed in specification §57 are **test conclusion categories to be determined, not pre-assumed conclusions**, and do not provide thresholds. This report's judgment criteria and data basis are as follows.


**Why not `HEALTHY`**

- Removing one balance rule reverses 50-0-10 to 2-38-20.
- 29.4% of matches end at guardrail cap, and these stalemates are **absorbing states** (raising cap does not resolve).


**Why not `SPEED-DOMINATED`**


This requires special explanation. On the surface "whoever is faster wins", but CF-SIMULTANEOUS proves: **speed itself (first-solver order) has no effect on results**—because frozen snapshots make order have no channel of effect. Speed determines outcomes **entirely because it triggers the cancellation rule**. Therefore the accurate classification is cancellation-rule-dominated, not speed-itself-dominated.


**Why not `STRUCTURALLY COLLAPSED`**

- 
- §58's collapse criterion is "all optimization approaches must degrade to fastest Shooter kill to compete".
- 
- Hybrid proves algorithms **can adapt to this meta**: using tactical-first + 46% early return, it achieved 8 wins, a decisive leap over Optimizer (0 wins), and compressed Fast's decided win rate from 100% to 69%. Therefore strategy space is **narrowed**, not collapsed.


**Why `CANCELLATION-DOMINATED`**

- 
- CF-NO-CANCEL and CF-SIMULTANEOUS equivalent (180/180), proving all speed influence goes through cancellation rule.
- 
- Once cancellation removed, two matchups' outcomes completely reverse, while the only "same-speed contest" barely moves.
- 
- Round-level attribution: cancellation consumed 787 kills in fast-vs-optimizer (84.8% of targets survived to end), including 253 counter-kills on first-solver.


**Superimposed second structural issue (`STRUCTURALLY AT RISK`)**


Ruleset **lacks termination condition**, and 29.4% of matches enter **never-resolving absorbing loops**. This showed signs in Round 1 (10/60), confirmed as structural defect on larger sample this round. This round **cannot provide threshold** (§14), therefore this item remains `OPEN FOR PLAYTEST EVIDENCE`.

---

## 20. Limitations


1. 
1. **0 / 1 obstacle maps unreachable via public CLI** (independently verified this round). These two shapes in §10 only verified in **algorithm-side** offline matrix, no platform-level matches.
2. 
2. **§18 gate's `blocked` field did not achieve literal consistency** (§18.1).
3. 
3. **Stalemate distribution right-censored**, threshold not identifiable (§14). **This is rev 2's most important correction relative to rev 1.**
4. 
4. **`start skew` not observable** (§8.2), §24 therefore incomplete.
5. 
5. **§23's `process state` / `sandbox state` not collected** (cannot be retroactively collected, §15.1).
6. 
6. **CF semantics defined by this harness** (specification does not define); different definition might yield different counterfactual values.
7. 
7. **CF simulation reuses official map sequence** (per-round obstacles + fixed positions), only survival set evolves. Obstacles cannot be regenerated offline; positions don't move, so this part is exact not approximate.
8. 
8. **CF re-run solvers execute in offline environment** (no sandbox's 1 core / 512 MB / threads=1 limit). Verified all three algorithms deterministic, and byte-for-byte reproduced platform-recorded functions on official worlds (217/217), but strictly speaking offline budget ≠ sandbox budget.
9. 
9. **`fast-vs-hybrid` algorithm effect cannot be cleanly separated**: only 40% conditions have both legs decided, half of which reversed (§8.1).
10. 
10. **Timing uncontrolled and not reproducible** (§2.2). Host had concurrent load during this round's experiments (§15.1).
11. 
11. **Sample size**: 60 matches / 30 independent maps per pair. Limited statistical power for close scores like 26-8-26.
12. 
12. **Only three algorithms**, and Hybrid designed by this round's author; its design choices (e.g., `SHOOTER_WEIGHT=1.5`) not sensitivity-scanned.

---

## 21. Recommendations



**All are recommendations. Per §27 and this round's constraints, no rule modifications implemented, nor production modified.**

| # | Recommendation | Basis |
|---|---|---|
| R1 | **Submit §38 Shot Cancellation to human decision review.** Candidate: change to "cancellation only applies when second solver **did not produce legal function**", i.e., rulification of CF-NO-CANCEL | §9 / §11: outcomes reverse after removal |
| R2 | **Prioritize fixing competitor-kit's arena boundary termination documentation gap** | §15.3 / §17.2 |
| R3 | **First supplement "no cap" experiments, then discuss Stalemate threshold.** This round **withdraws** rev 1's 20/30 recommendations | §14: censoring + absorbing states ⇒ threshold not identifiable |
| R4 | **Publish `aBlocked` judgment predicate**, or remove this field from statistical caliber | §17.4 |
| R5 | **Correct task specification §0's rule filename reference** | §17.1 |
| R6 | **Expose both sides' GO delivery moments in artifacts**, otherwise §24's start skew cannot be measured by any harness | §8.2 |
| R7 | **Expand sample in subsequent rounds** (≥100 conditions × swap) before deciding R1's final form | §20.11 |
| R8 | **If adopting R1, must supplement full regression**: cancellation rule changes simultaneously affect Shooter assassination value, stalemate rate, and fast's relative position | §59 Rule Change Procedure |

---


## 22. Final answers (§29)

**A. Did Hybrid materially close the gap to Fast?**


> **NO (but significantly narrowed).**
>
> Under official rules Fast 26 / Hybrid 8 / Draw 26. Key point: **all 26 draws are 30-round clock expiration**, 12 with survival difference ≥2; after adjudicating by kill difference: **Fast 38 / Hybrid 17 / 5 completely tied**. That is, Fast still wins **69%** of decided matches (P ≈ 0.0015), and Hybrid **never swept both legs** across 30 conditions (Fast did 6 times).
>
> Narrowing is real: Fast's decided win rate dropped from Round 1's **100% (50/50)** to **69%**, Hybrid won 8 while Optimizer won 0; in `optimizer-vs-hybrid` Hybrid crushed 39-4. But "narrowing the gap" and "closing the gap" are different things; this round's evidence only supports the former.

**B. Is Shooter Cancellation a major contributor to Fast dominance?**

> **YES.**
>
> After removing cancellation, fast-vs-optimizer reversed from **50-0-10** to **2-38-20**; optimizer-vs-hybrid reversed from **39-4-17** to **3-37-20**. Round-level attribution: cancellation consumed **787 kills** in fast-vs-optimizer, **84.8% of targets survived to official match end** (ruling out "would have died anyway" alternative explanation), including **253** counter-kills on Fast's Shooter—43% of all rounds. This conclusion was reproduced by an **independently written simulator** (0/60 divergence), and offline re-run solvers **byte-for-byte reproduced platform-recorded functions** on official worlds (217/217), ruling out environment/timing artifacts.

**C. Does first-solver speed excessively suppress function quality?**


> **YES.**
>
> Three layers of evidence: (1) Round-level: 787 / 663 / 316 kills not executed due to cancellation across three matchups, majority of targets survived to end; (2) Forward simulation: after removing cancellation, slow algorithm wins went from 0 → 38, 4 → 37; (3) Within-algorithm evidence: Hybrid's Stage 3 (deeper curve fitting) only changed results 1 time across 1170 worlds—**even given the time, higher-quality functions produce no value**.
>
> Wording reservation: CF measures "substantially" (order of magnitude), "excessively" (whether excessive) is a value judgment to be made in rule review, not determined by this report.

**D. Should the official rules change before proceeding toward tournament freeze?**


> **YES (recommendation).**
>
> Based on §19's `CANCELLATION-DOMINATED` verdict and §21's R1 / R2 / R3.
>
> **This round did not implement any modifications, nor modified production (§27).** Only submitted candidates for human decision.

**E. Is there enough evidence to define a Stalemate Rule?**


> **NO.**
>
> Stalemates **truly exist and are structural** (53/53 never self-resolve, still don't resolve at 60 rounds), therefore "need some termination condition" is established. But **threshold value not identifiable**: observed distribution right-censored by 30-round test cap, all 53 tail observations equal "cap − last kill round", no natural resolution observed; percentiles scale 1:1 with cap. **rev 1's 20 / 30 threshold recommendations withdrawn**, they were circularly derived from censored percentiles.
>
> Need to first conduct "no cap" experiments (see §14 and R3) before providing threshold recommendations in next round.
>
> **This round did not implement formal Stalemate Rule (§22 explicitly forbids).**

---


## 23. Reproduction guide

```bash

# 0. This report's corresponding commit is the evidence anchor
git log --oneline -3


# 1. Reproduce Round 1
git archive 6f987bfb | tar -x -C /tmp/round1-verify
python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results


# 2. Hybrid self-check
npx --no-install ts-node src/operator/validate-submission.ts playtest/competitors/solver-hybrid


# 3. Official rules experiments (180 matches, ~32 minutes)
bash playtest/harness/run_round2_experiments.sh


# 4. Aggregate
python3 playtest/harness/analyze_round2.py


# 5. Offline robustness matrix (0/1 obstacle shapes)
python3 playtest/harness/gb_matrix.py --pkg playtest/competitors/solver-hybrid \
    --seeds 20 --obstacles 0,1,2,4,6 --teams 6,8,10 \
    --out playtest/results/round-2/matrix-hybrid.json


# 6. Counterfactuals (first pass §18 gate, then aggregate)
for p in fast-vs-optimizer optimizer-vs-hybrid fast-vs-hybrid; do
  python3 playtest/harness/gb_counterfactual.py verify \
      --raw playtest/results/round-2/raw/$p \
      --out playtest/results/round-2/cf/verify-$p.json
  python3 playtest/harness/gb_counterfactual.py rounds --pair $p \
      --raw playtest/results/round-2/raw/$p --cache /tmp/fn-$p.json \
      --out playtest/results/round-2/cf/rounds-$p.json
  python3 playtest/harness/gb_counterfactual.py simulate --pair $p \
      --conditions playtest/harness/conditions-round2.json \
      --out playtest/results/round-2/cf/sim-$p --cache /tmp/fn-$p.json
done


# 7. Absorbing state verification (raise cap)
python3 playtest/harness/gb_round2.py run --pair fast-vs-hybrid \
    --conditions /tmp/cond-cap60.json --out /tmp/cap60 --max-rounds 60
```


### Artifact index

| Path | Content |
|---|---|
| `playtest/results/round-2/raw/<pair>/` | 180 per-match raw artifacts (match / replay / audit / console) |
| `playtest/results/round-2/metrics-<pair>.json` | per-match records + aggregate metrics |
| `playtest/results/round-2/round-2-summary.json` | three-group aggregate + §21 percentiles + CF aggregate |
| `playtest/results/round-2/cf/verify-*.json` | **§18 gate artifacts (item-by-item counts and mismatch details)** |
| `playtest/results/round-2/cf/rounds-*.json` | round-level cancellation attribution |
| `playtest/results/round-2/cf/sim-*/` | 360 simulated matches in two modes |
| `playtest/results/round-2/platform-contaminated/` | §23 contamination batch raw evidence and explanation |
| `playtest/results/round-2/cap60-probe/` | **absorbing state verification (cap 30 vs 60)** |
| `playtest/results/round-2/matrix-*.json` | §10 offline robustness matrix (3 packages × 600 runs) |
| `playtest/results/round-2/bench-hybrid.json` | Hybrid's §9 staged benchmark (1170 runs) |

---


## 24. Complete

```
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW

```

---


## 25. rev 1 → rev 2 Revision log


rev 1 underwent a round of **adversarial review** before submission (5 independent challengers + 1 integrity reviewer, each recalculating from raw archives). The following conclusions were overturned or corrected, **retaining the reasons for overturn**, to prevent subsequent readers from repeating the same mistakes:

| Item | rev 1 | rev 2 | Overturn basis |
|---|---|---|---|
| Platform determinism | "completely deterministic" | **Only judgment deterministic; timing not reproducible** | 866 paired timings **0 identical** (±43.9 ms); 585 state hashes all different (explained by random match_id) |
| Hybrid narrowed gap | YES, net difference +50→+18 | **NO (significantly narrowed)** | All 26 draws clock expiration, 12 with difference ≥2; by kill adjudication **Fast 38 / Hybrid 17** |
| Slot consistency | "6 / 6" (no denominator) | **12/30 classifiable (6 same + 6 reversed)** | Metric only counts conditions where both legs decided, reads as if covering all 30 |
| CF two-mode equivalence | "independent code paths ⇒ measurement result" | **Equivalent by construction (from §40/§41)** | Both branches just unions; order is no-op |
| Round-level cancellation cost | 430 / 389 / 294 kills lost；60 shooter kills | **787 / 663 / 316；253 / 213 / 164** | rev 1 used CF-propagated survival set as world, **systematic underestimate** |
| Stalemate threshold | Recommend 20 / 30 | **Withdrawn; insufficient evidence** | Distribution right-censored + absorbing states; cap 30→60 all still hit cap |
| §18 gate | "100% consistent" | **100% on all fields consumed by counterfactuals; `blocked` field did not achieve literal consistency** | 106 / 298 `blocked` divergences, need to state alongside §18 original text |
| §24 start skew | Not mentioned | **Not observable** | Platform artifacts lack this field, grep-confirmed |














