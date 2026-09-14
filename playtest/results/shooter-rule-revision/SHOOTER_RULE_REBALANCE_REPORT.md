<div align="right">

**English** | <a href="./SHOOTER_RULE_zh.md">简体中文</a>

</div>


# Shooter Rule Revision & Rebalance — Report

**Geometry Battle V1.1 · Three-Algorithm Tournament · Post-Rule-Revision Rerun**


---

## Document Metadata

### English

- Protocol version: 1.1 (`competitor-kit/` public interface)
- Test date: 2026-09-10
- Nature of this round: **Playtest / Balance Research + One Human-Authorized Rule Revision**, not a free platform development task
- Rule version: **V1.1 Playtest Rules — Revision 2** (per task specification §28, not called V1.2)



---

## Git baseline

### English

**Addressable anchor for all evidence in this round**

| Item | Value |
|---|---|
| Branch | `feature/v1.1-ui-protocol` |
| **RULE_BASELINE_SHA** (pre-revision rules & production implementation) | `877f142` |
| HEAD at result generation | `95f2a5f` |
| `v1.0.0-competition` | `26d7970fbcba7b50f04e0743130ca4ffdd3bd904` (**unchanged** this round) |

Commits from this round:

```text
90647f3  docs(rules): amend shooter elimination semantics
2e825a1  feat(v1.1): preserve locked attack after shooter elimination
95f2a5f  refactor(v1.1): drop stale cancellation comments and runner-cancel wording
```

**Working tree at result generation**: 180 matches ran after `2e825a1`; `95f2a5f` only changed comments and one error message, **no behavior change**. Harness/results commits followed afterward. For strict reproduction, use the tree at `95f2a5f` or later.

Canonical rule path (sole authoritative rule input for this round, **revised this round**):

```text
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```





```text
90647f3  docs(rules): amend shooter elimination semantics
2e825a1  feat(v1.1): preserve locked attack after shooter elimination
95f2a5f  refactor(v1.1): drop stale cancellation comments and runner-cancel wording
```



```text
Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md
```

---

## 1. Old Rule

### English

```text
First Solver kills opponent Shooter
→ opponent shot cancelled
```

That is: once the first-mover kills the opponent's Shooter, the opponent's attack **already computed or being computed** is no longer executed, and their sandbox process is immediately terminated. Round result code: `CANCELLED_A` / `CANCELLED_B`.

Round-2 report (`playtest/results/round-2/`) concluded:

> **Under this ruleset, speed affects outcome through exactly one channel: Shot Cancellation.**


```text
```




---

## 2. New Rule

### English

```text
After START, both sides gain independent and irrevocable attack rights for this round.
```

- Shooter is the **mathematical firing anchor** for this round's attack function, not a "gunner who must stay alive until firing moment". Even if Shooter is killed before firing, the function must still satisfy `f(x_shooter) = y_shooter`, using the Shooter coordinates from the START snapshot.
- **No replacement, no recomputation**: do not randomly pick another alive point, do not rerun the algorithm, input snapshot is frozen.
- **Process unaffected**: Shooter death is no longer a Runner termination signal; the second-mover algorithm still has its full official computation deadline.
- The **only** reasons an attack is not executed: `TIMEOUT` / `INVALID` / `CRASH`.
- New endgame: after one round both sides reach zero simultaneously → **MATCH DRAW**, `endReason = MUTUAL_ELIMINATION`. **MUST NOT** declare the First Solver as winner.

Rule text: see `Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md` §38.x / §39.


```text
```



---

## 3. Reason for Change

### English

Not a product of balance derivation, but a **human decision** (task specification §2: `Rule amended by human decision`).

Consequences caused by the revised rule in Round-2 testing:

| Observation | Value |
|---|---|
| Fast vs Optimizer official record | **Fast 50 / Optimizer 0 / Draw 10** |
| Optimizer total actual kills across all matches | 76 |
| Kills swallowed by old rule (fast-vs-optimizer) | **787**, of which **84.8%** of targets were still alive at match end |
| Of which counterattacks against Fast Shooter | 253 times (43% of all rounds) |
| Optimizer's effective output erased | Approximately **91%** of curves that could have produced kills |
| Optimizer's per-round "no-hit rate" | **0.9148** |

That is: the cancellation rule nearly zeroed the slow side's function quality, making speed the only channel to victory.






---

## 4. Implementation Diff Scope

### English

Production change scope **limited to cancellation semantics only**; DSL whitelist, hit detection, obstacle collision, first-mover rule, timing endpoint and timeout budget, sandbox policy all untouched.

| File | Change |
|---|---|
| `src/core/Match.ts` | `resolveOrderedShots` **removed** "Shooter dead → skip that side's shot" guard and `cancelled` / `onCancelled` output params; added `shooterAliveAtAttack`. `computeRound` removed `onFirstResult` cancellation hook; added `mutualElimination`, `MatchLog.endReason`, `MatchEngine.endReason()` |
| `src/runner/SandboxRunner.ts` | Removed `DuelOptions.onFirstResult` and its `runner.cancel()` branch (§10). Cancellation path error message changed to "runner cancelled by host (process terminated)" (error code unchanged) |
| `src/core/Logs.ts` | `RoundLog` / `ReplayFrame` added `attacksExecuted` / `shooterAliveAtAttack` / `shooterA|BAliveAfterRound` / `mutualElimination` / `endReason`; `CANCELLED_A/B` and `cancelled*` annotated as **historical/compatible** |
| `src/ui/AudienceScreenUI.ts`, `src/operator/cli.ts` | Replay and settlement screens no longer print "cancelled", changed to show actual firing order and "Shooter dead at firing (attack right locked, not cancelled)" |
| `Plans/Input/…Playtest Specification.md` | §38 rewritten as Locked Attack Right (38.1–38.6); §39 downgraded CANCELLED and preserved historical evidence |
| `competitor-kit/ALGORITHM_REQUIREMENTS.md`, `README.md` | Public documentation synchronized |
| `tests/` | Old `shooter-cancel` suite reclassified per §18 as `locked-attack-right` (R1–R8) |

**Design choice note**: Cancellation semantics is a **structural deletion** rather than leaving a switch that's always false — guards and output params no longer exist, old rule cannot be silently reintroduced (task specification §30 requires re-gate auditor to verify "whether old cancellation path remains", this is a positive response to that check).

**Unchanged**: `RoundMachine`'s 19 phases and transition table **not touched at all** (`CHECK_SHOOTER` phase name retained, now only means "check Shooter alive" as a progression step, no longer carries any cancellation semantics — it's part of the phase sequence, renaming would disturb the frozen state machine vocabulary). `TIE_EPS_MS`, first-mover determination, timeout budget, sandbox SBPL, DSL whitelist, hit and obstacle detection all byte-for-byte untouched, verifiable via `git diff 877f142..HEAD -- src/core/Rules.ts src/core/Judge.ts src/core/Round.ts src/runner/SandboxRunner.ts` (the latter's diff only has cancellation hook removal and one error message).






---

## 5. Regression Evidence

### English

| Item | Result |
|---|---|
| `npm run typecheck` | **0 errors** |
| `npx ts-node tests/locked-attack-right.ts` | **10/10 passed** (R1–R8 + 2 existing coverage) |
| Full regression | **25/26** — only failure `algorithm-slot`, **not introduced this round**, see §15 |
| `shotCancellationRate` (180 match measured) | **0.0** (by design, evidence required by §23) |
| `INVALID / TIMEOUT / CRASH` | **0 / 0 / 0** (total 4496 "team×round" samples) |
| Rerun consistency | Offline model predictions for all three pairings match official results **field-for-field identical** (§9) |

Final full regression (`npx ts-node tests/run-all.ts`, on commit `95f2a5f` + this round's harness/results):

```text
  ✓ dsl-contract            ✓ preflight-decoy          ✓ process-tree-cleanup
  ✓ convexity-aliasing      ✓ result-ipc               ✓ hostile-input
  ✓ official-starter        ✓ algorithm-slot  ✗        ✓ timing-fairness
  ✓ map-fairness            ✓ full-match-e2e           ✓ replay
  ✓ obstacle-block          ✓ runner-isolation         ✓ runtime-manifest
  ✓ dual-shooter-selection  ✓ cross-round-cheat        ✓ competitor-kit
  ✓ locked-attack-right     ✓ package-tamper
  ✓ alive-kill              ✓ timeout-boundary
  ✓ roundstate-equality
  ✓ input-protocol
  ✓ stage-gating
  ✓ pre-start-execution

25/26 suites passed
Failed suite: algorithm-slot
```

`algorithm-slot` failure **not introduced this round** (§15 P-1 has stash isolation and bisect evidence).




```text
  ✓ dsl-contract            ✓ preflight-decoy          ✓ process-tree-cleanup
  ✓ convexity-aliasing      ✓ result-ipc               ✓ hostile-input
  ✓ official-starter        ✓ algorithm-slot  ✗        ✓ timing-fairness
  ✓ map-fairness            ✓ full-match-e2e           ✓ replay
  ✓ obstacle-block          ✓ runner-isolation         ✓ runtime-manifest
  ✓ dual-shooter-selection  ✓ cross-round-cheat        ✓ competitor-kit
  ✓ locked-attack-right     ✓ package-tamper
  ✓ alive-kill              ✓ timeout-boundary
  ✓ roundstate-equality
  ✓ input-protocol
  ✓ stage-gating
  ✓ pre-start-execution

25/26 suites passed
Failing suite: algorithm-slot
```


---


### English

| ID | Scenario | Result |
|---|---|---|
| R1 | First-mover kills opponent Shooter, second-mover already has valid solution → second-mover still fires | ✓ Structural assertion: `shooterAliveAtAttack.B === false` and `shots.B !== null` |
| R2 | First-mover kills opponent Shooter, second-mover returns valid solution later → still fires (end-to-end, sniper vs slow-sniper) | ✓ `attacksExecuted === ['A','B']`, `hits.B.length > 0` |
| R3 | First-mover kills opponent Shooter, second-mover times out → no attack, reason is `TIMEOUT` | ✓ `result === 'TIMEOUT_B'`, `cancelled.B === false`, `result !== 'CANCELLED_B'` |
| R4 | First-mover kills opponent Shooter, second-mover output invalid → no attack | ✓ `result === 'INVALID_B'`, `cancelled.B === false` |
| R5 | Both Shooters kill each other → both attacks resolve | ✓ One structural and one end-to-end |
| R6 | Both sides reach zero in same round → `MUTUAL_ELIMINATION` / `DRAW` | ✓ Six-round scripted match, `winner === 'draw'`, `endReason() === 'MUTUAL_ELIMINATION'`, persisted logs consistent |
| R7 | Dead Shooter cannot be selected next round | ✓ |
| R8 | No Shooter Replacement within same round | ✓ Shooter id unchanged, no second computation, input hash unchanged |

**Regression validity counter-proof**: After temporarily adding back the old guard (`if (!shooter.alive) continue;`) to `resolveOrderedShots`, suite immediately dropped from 10/10 to 6/10, with R1 / R2 / R5 / R6 all turning red, then restored and confirmed no remnants. That is, this regression batch **does catch** old cancellation rule resurrection.




---

### 5.2 Old Test Reclassification

### English

| Assertion | Classification | Handling |
|---|---|---|
| "First-mover kills opponent Shooter → opponent attack cancelled" and 5 others | **obsolete due to authorized rule change** | Suite entirely rewritten as `locked-attack-right` |
| "Dead Shooter cannot continue attacking" (originally same-round semantics) | **obsolete** | Rewritten as new semantics: dead Shooter cannot be selected next round (R7) |
| "After first-mover kill, second-mover's shot guard reachable (P2-B)" | **obsolete** | Guard deleted, changed to assert opposite (R1) |
| "On tied first-mover, both sides fire simultaneously based on same snapshot" | **still valid** | Retained as-is |
| "Backward-facing attack does not hit enemies behind self" | **still valid** | Retained as-is |
| `tests/replay.ts:119-122` "Last frame winner has alive points, loser eliminated" | **obsolete** (implies "only one side can be eliminated") | Rewritten: draws only possible from mutual elimination, non-draws still winner alive + loser eliminated |

**Unchanged**: Any assertions for timing fairness, DSL, hit, obstacle, boundary, START, sandbox.




---

## 6. Fast vs Optimizer / 6. Fast vs Optimizer

### English

| | Round-2 (old rule) | Revision 2 |
|---|---|---|
| Record | Fast **50** · Optimizer **0** · Draw 10 | Fast **2** · Optimizer **38** · Draw 20 |
| Fast first-mover rate | 0.854 (merged across pairings) | **1.000** |
| Optimizer first-mover rate | 0.000 | **0.000** |
| Fast kills per effective shot | 0.5775 | 0.541 |
| Optimizer kills per effective shot | 0.285 | **0.662** |
| Fast no-hit rate | 0.6406 | 0.651 |
| Optimizer no-hit rate | **0.9148** | **0.665** |

Fast **is first-mover every single round** (1.000 vs 0.000), yet lost 2-38. First-mover rate changed from "decisive" to "no conversion".




---

## 7. Fast vs Hybrid / 7. Fast vs Hybrid

### English

| | Round-2 (old rule) | Revision 2 |
|---|---|---|
| Record | Fast **26** · Hybrid 8 · Draw 26 | Fast **13** · Hybrid **10** · Draw **37** |
| Fast first-mover rate | — | 0.841 |
| Hybrid first-mover rate | — | 0.155 |
| Swap consistency | — | `swapConsistent=1` / `swapFlipped=6` |

This is the only "near-tie" pairing (13-10), but **after swapping order, 6 out of 7 comparable conditions flipped outcome**, suggesting this difference is closer to timing noise rather than stable strategic advantage. Mutual elimination most concentrated in this pairing: **15/60 = 25.0%**.


| | Round-2 (old rule) | Revision 2 |
|---|---|---|
| Record | Fast **26** · Hybrid 8 · Draw 26 | Fast **13** · Hybrid **10** · Draw **37** |
| Fast First-mover rate | — | 0.841 |
| Hybrid First-mover rate | — | 0.155 |
| Swap consistency | — | `swapConsistent=1` / `swapFlipped=6` |


---

## 8. Hybrid vs Optimizer / 8. Hybrid vs Optimizer

### English

| | Round-2 (old rule) | Revision 2 |
|---|---|---|
| Record | Hybrid **39** · Optimizer 4 · Draw 17 | Hybrid **3** · Optimizer **37** · Draw 20 |
| Hybrid first-mover rate | 0.5604 (across pairings) | 0.889 |
| Optimizer first-mover rate | 0.000 | 0.111 |
| Hybrid kills per effective shot | 0.4495 | 0.487 |
| Optimizer kills per effective shot | 0.285 | **0.604** |
| Swap consistency | — | `swapConsistent=14` / `swapFlipped=1` |

**Direction completely reversed**: Round-2 had Hybrid crushing Optimizer 39-4, Revision 2 has it crushed 3-37. Round-2's Hybrid advantage was a gift from the cancellation rule, not a function quality advantage. Swap consistency 14/1 shows this reversal is stable, not noise.


| | Round-2 (old rule) | Revision 2 |
|---|---|---|
| Record | Hybrid **39** · Optimizer 4 · Draw 17 | Hybrid **3** · Optimizer **37** · Draw 20 |
| Hybrid First-mover rate | 0.5604(cross-pairing) | 0.889 |
| Optimizer First-mover rate | 0.000 | 0.111 |
| Hybrid Kills per valid shot | 0.4495 | 0.487 |
| Optimizer Kills per valid shot | 0.285 | **0.604** |
| Swap consistency | — | `swapConsistent=14` / `swapFlipped=1` |


---

## 9. Counterfactual: Offline Model Field-for-Field Matches Official Results

### English

This round archives the old `CF-NO-CANCEL` as **historical counterfactual** (§21), adds sole new counterfactual **`CF-LEGACY-CANCEL`** (§22, re-adding abolished cancellation branch). Simultaneously retains `locked-attack` mode as **model fidelity check** (it's now production rule, no longer counterfactual).

Round-2 used offline model to predict "if cancellation removed" under old rule; this round places that prediction alongside **actual official results**:

| Pairing | Round-2 `CF-NO-CANCEL` prediction | Revision 2 official | Consistent? |
|---|---|---|
| fast-vs-hybrid | Fast 13 · Hybrid 10 · Draw 37 | Fast **13** · Hybrid **10** · Draw **37** | **Field-for-field identical** |
| optimizer-vs-hybrid | Optimizer 37 · Hybrid 3 · Draw 20 | Optimizer **37** · Hybrid **3** · Draw **20** | **Field-for-field identical** |
| fast-vs-optimizer | Optimizer 38 · Fast 2 · Draw 20 | Optimizer **38** · Fast **2** · Draw **20** | **Field-for-field identical** |

**This is one of the two strongest pieces of evidence this round**:

1. Revision was **faithfully implemented** — an independent offline model (Python reimplementation, `gb_counterfactual.py`) reproduced 180/180 outcomes on the production implementation.
2. Post-revision balance results are **deterministic consequences of the rule**, not artifacts of implementation details, timing jitter, or environment — otherwise the offline model couldn't match field-for-field.

This round's `locked-attack` mode simulation results also match official results field-for-field (table above shows its output).




| Pairing | Round-2 `CF-NO-CANCEL` Prediction | Revision 2 Official test | Consistent? |
|---|---|---|
| fast-vs-hybrid | Fast 13 · Hybrid 10 · Draw 37 | Fast **13** · Hybrid **10** · Draw **37** | **Field-by-field identical** |
| optimizer-vs-hybrid | Optimizer 37 · Hybrid 3 · Draw 20 | Optimizer **37** · Hybrid **3** · Draw **20** | **Field-by-field identical** |
| fast-vs-optimizer | Optimizer 38 · Fast 2 · Draw 20 | Optimizer **38** · Fast **2** · Draw **20** | **Field-by-field identical** |




---


### English

Replay each round on the official (new rule) world, use "whether first-mover's actual hits contain opponent Shooter" to infer what old rule would cancel (no longer read platform flag — platform no longer records cancellation):

| Algorithm | Rounds | Would be cancelled by old rule | Kills swallowed | Includes counterattack on opponent Shooter |
|---|---|---|---|---|
| fast | 1521 | 59 (**3.9%**) | 60 | 57 |
| hybrid | 1568 | 170 (**10.8%**) | 264 | 147 |
| optimizer | 1407 | 375 (**26.7%**) | **762** | **310** |

Old rule's penalty **monotonically correlated with algorithm speed**: slower, more rounds cancelled. Optimizer has one out of every four rounds erased.

> Metric reminder: `Swallowed kills where "target still alive at endgame" = 0%` (Round-2 same metric was 84.8%). This is a consequence of **metric definition**, not "old rule doesn't hurt": this metric uses this round's new rule endgame alive set, and new rule endgame has almost everyone dead, so denominator naturally approaches 0. Use raw counts (762 / 264 / 60) as primary.






---

### 9.2 `CF-LEGACY-CANCEL` Forward Simulation

### English

| Pairing | Mode | Wins | Suppressed shots | Fired after death |
|---|---|---|---|---|
| fast-vs-hybrid | `cf-legacy-cancel` | Fast 24 · Hybrid 10 · Draw 26 | 303 | 0 |
| fast-vs-hybrid | `locked-attack` | Fast **13** · Hybrid 10 · Draw **37** | 0 | **228** |
| optimizer-vs-hybrid | `cf-legacy-cancel` | Hybrid 38 · Optimizer 4 · Draw 18 | 250 | 0 |
| optimizer-vs-hybrid | `locked-attack` | Optimizer **37** · Hybrid 3 · Draw 20 | 0 | **173** |
| fast-vs-optimizer | `cf-legacy-cancel` | Fast 50 · Optimizer 0 · Draw 10 | 304 | 0 |
| fast-vs-optimizer | `locked-attack` | Optimizer **38** · Fast 2 · Draw 20 | 0 | **200** |

Compared to Round-2 official test (50-0-10, 39-4-17, 26-8-26): `cf-legacy-cancel` **exactly reproduces** 50-0-10 on fast-vs-optimizer, other two pairings differ by 1–2 matches (24-10-26 vs 26-8-26; 38-4-18 vs 39-4-17). Differences expected: simulation runs on **this round's** map sequence and auto-selection, not bit-for-bit replicating Round-2's manual selection records.


| Pairing | Mode | Wins | Suppressed shots | Fired after death |
|---|---|---|---|---|
| fast-vs-hybrid | `cf-legacy-cancel` | Fast 24 · Hybrid 10 · Draw 26 | 303 | 0 |
| fast-vs-hybrid | `locked-attack` | Fast **13** · Hybrid 10 · Draw **37** | 0 | **228** |
| optimizer-vs-hybrid | `cf-legacy-cancel` | Hybrid 38 · Optimizer 4 · Draw 18 | 250 | 0 |
| optimizer-vs-hybrid | `locked-attack` | Optimizer **37** · Hybrid 3 · Draw 20 | 0 | **173** |
| fast-vs-optimizer | `cf-legacy-cancel` | Fast 50 · Optimizer 0 · Draw 10 | 304 | 0 |
| fast-vs-optimizer | `locked-attack` | Optimizer **38** · Fast 2 · Draw 20 | 0 | **200** |


---

## 10. Mutual Elimination

### English

| Pairing | Mutual eliminations | Proportion |
|---|---|---|
| fast-vs-hybrid | **15 / 60** | **25.0%** |
| optimizer-vs-hybrid | 1 / 60 | 1.7% |
| fast-vs-optimizer | 3 / 60 | 5.0% |
| **Total** | **19 / 180** | **10.6%** |

This is an endgame state that was **impossible under old rule** (under old rule, once first-mover zeroes opponent, second-mover has no chance to zero first-mover). Per §8, all judged as **DRAW**, not a single match awarded to A because "A is First Solver".

**All 77 draws from 180 matches fully decomposed**: 58 matches hit 30-round cap (`endReason = NONE`) + 19 mutual eliminations (`MUTUAL_ELIMINATION`) = 77. **No third type of draw exists.**

Distribution clearly uneven: Fast↔Hybrid has one mutual elimination every four matches, while pairings involving Optimizer have few. Two "tactical priority + early return" style algorithms are more likely to shoot each other into mutual elimination.


| Pairing | Mutual Elimination | Percentage |
|---|---|---|
| fast-vs-hybrid | **15 / 60** | **25.0%** |
| optimizer-vs-hybrid | 1 / 60 | 1.7% |
| fast-vs-optimizer | 3 / 60 | 5.0% |
| **Total** | **19 / 180** | **10.6%** |




---

## 11. Timing

### English

Timing rules **unchanged** (first-mover = side with shorter elapsed time from respective GO timestamp; endpoint = `result.json` mtime).

| Algorithm | Median elapsed (merged) | p95 | Max | First-mover rate |
|---|---|---|---|---|
| fast | 16.3 ms | 34.5 ms | 114.4 ms | **0.912** |
| hybrid | 24.2 ms | 169.3 ms | 596.4 ms | 0.495 |
| optimizer | **119.4 ms** | 311.6 ms | 902.2 ms | 0.058 |

Compared to Round-2 (fast 14.6 / hybrid 22.0 / optimizer 144.9 ms): all three elapsed distributions basically unchanged, Optimizer's median elapsed even slightly decreased (144.9 → 119.4 ms), because it no longer needs to reserve margin for "will be cancelled anyway"… **This is inference, not measurement**: this round did not run a "same algorithm under new vs old rule elapsed comparison" experiment, cannot attribute elapsed changes to the rule. Recording observations only.

**Speed's formal value still exists, conversion ability basically gone**: Fast gets first-mover 100% in fast-vs-optimizer, yet lost 2-38; Optimizer's "fired after death rate" is 0.238 / 0.297, meaning a considerable portion of its shots already land after its Shooter has been counter-killed — precisely the portion old rule would delete, new rule allows.



| Algorithm | Median Elapsed (pooled) | p95 | Max | First-mover rate |
|---|---|---|---|---|
| fast | 16.3 ms | 34.5 ms | 114.4 ms | **0.912** |
| hybrid | 24.2 ms | 169.3 ms | 596.4 ms | 0.495 |
| optimizer | **119.4 ms** | 311.6 ms | 902.2 ms | 0.058 |



---

## 12. Match Length

### English

| | Round-2 | Revision 2 |
|---|---|---|
| Mean | 12.87 rounds | **12.49 rounds** |
| Median | 6 | **5** |
| p75 / p90 / p95 | 30 / 30 / 30 | 30 / 30 / 30 |
| Hit 30-round cap | 53 / 180 (29.4%) | **58 / 180 (32.2%)** |

Almost unchanged, matches hitting cap slightly increased.




---

## 13. No-progress

### English

Consecutive zero-kill rounds (`longestNoKillStreak`, per-match maximum):

| | Round-2 | Revision 2 |
|---|---|---|
| Mean | 7.03 | **8.26** |
| Median | 0 | 0 |
| p75 | 21 | **25** |
| p90 | 25 | **26** |
| p95 | 26 | **27** |
| Max | 29 | 29 |

**Stalemate distribution worsened**: p75 rose from 21 to 25, matches hitting cap 53 → 58. Reason: new rule deleted the "first-mover zeroes opponent → round immediately ends" fast termination channel.



| | Round-2 | Revision 2 |
|---|---|---|
| Mean | 7.03 | **8.26** |
| Median | 0 | 0 |
| p75 | 21 | **25** |
| p90 | 25 | **26** |
| p95 | 26 | **27** |
| Max | 29 | 29 |


---

### 13.1 Absorbing State Test (cap 60)

### English

From 180 matches, extract **16 conditions** where "at least one side hit 30 rounds", rerun **fast-vs-hybrid** (this round's pairing most concentrated in draws and mutual eliminations, consistent with Round-2 same-test baseline) with `--max-rounds 60` for 16 × 2 positions = **32 matches**:

| | Matches | Proportion |
|---|---|---|
| Resolved within 60 rounds | 10 | 31.3% |
| **Still unresolved at 60 rounds** | **22** | **68.8%** |

**Conclusion: Most of these stalemates are absorbing fixed points, not slow convergence.** Raising cap from 30 to 60 only resolved less than one-third; remaining 22 matches frozen even with double the rounds. This confirms Round-2's judgment (its spot-check of 3 matches, all stopped at 60 rounds), with sample size an order of magnitude larger.

**Simultaneously confirms Round-2's reservation**: 30/60 are both only **test framework's cap settings**, not game nature; stalemate distribution is right-censored by cap, therefore **any stalemate threshold is non-identifiable**. This round likewise does not recommend defining a threshold.

> Coverage note (as-recorded): Constrained by this round's time budget, cap-60 only ran fast-vs-hybrid pairing (32/96 matches). `optimizer-vs-hybrid` and `fast-vs-optimizer` same-test **not completed**, whether their respective stalemates are likewise absorbing states **not measured**. Do not extrapolate this 68.8% to the other two pairings. Single 60-round match cost far exceeds 30-round (two sandboxes per round), running all three pairings would require approximately 2+ hours.







---


### English

| Health item | Judgment |
|---|---|
| Rule **faithfully implemented** | **YES** — Independent offline model matches 180/180 field-for-field |
| Any cancellation path remains | **NO** — Guards and output params structurally deleted; `shotCancellationRate` measured 0.0; §18 gate 0 mismatch |
| `TIMEOUT` / `INVALID` / `CRASH` misrecorded as cancellation | **NO** — R3 / R4 dedicated regression + 180 matches 0/0/0 |
| Mutual elimination misjudged | **NO** — 19 matches all judged DRAW, not one awarded for first-mover |
| Snapshot polluted by second-mover recomputation | **NO** — Input hash unchanged within this round (R8 + `stage-gating` existing regression) |
| Public documentation consistent with production | **YES** — kit §6.1 and §38 share same source; README synchronized |
| **Balance achieved** | **NO** — See §16 |



---

## 15. Platform Findings

### English

Per task specification §19: Failures unrelated to this rule revision **not silently fixed**, classify first.

#### P-1 `algorithm-slot` existing failure (not introduced this round) · Classified MINOR (test vs artifact inconsistency)

```text
✗ algorithm-slot: Repository's bundled two slots have identical structure (§2/§3/§41)
    Assertion failed: Slot root directory should only have fixed entry, actual manifest.json,solver.py
```

- **Judged as existing based on**: After `git stash` of all this round's changes and single-run of same suite on original HEAD, **same 7/8 failure, same assertion**. Can bisect to introducing commit: `d9f470c docs(v1.1): sync fixed algorithm slots with canonical starter` — that commit added `manifest.json` to `algorithms/team-a|team-b` (reasoning "canonical starter has manifest"), but did not synchronize `tests/algorithm-slot.ts:87` and `algorithms/README.md` (both state slot root directory **only has** `solver.py`).
- `d9f470c` **is not** an ancestor of Cycle-2 audit baseline `5f56261`, so it entered `main` history after that, during Round-2 playtest period. This explains why Cycle 2 full regression was 26/26.
- **Not fixed this round**: Task specification only authorizes rule revision; fix method (change test or change artifact) requires first adjudicating "should factory slots be a legal algorithm package", which exceeds authorization scope.
- **Hand to re-gate auditor**: Please determine whether artifact is wrong (should delete `manifest.json`) or assertion is outdated (should relax).

#### P-2 `cross-round-cheat` occasional sandbox teardown hang · Classified OBSERVATION (existing)

Already recorded and evidenced in Cycle-2 (`Plans/Output/V1.1 Timing Anchor & sys.path Remediation Handoff.md` §5.3): Failed assertion different each time, single-suite elapsed 120s–1031s, timeout budget ineffective, rerun turns green. Not reproduced this round (this round's full regression had that suite 5/5 pass). No traceable causation with this round's changes.

#### P-3 No new platform defects found this round

In 180 matches, `INVALID` / `TIMEOUT` / `CRASH` all **0**, artifacts complete, `endReason` and per-round new fields all readable, replays fully loadable.




```text
✗ algorithm-slot: Repository has two bundled slots with identical structure (§2/§3/§41)
    Assertion failed: Slot root should only have fixed entry points, actual: manifest.json,solver.py
```






---


### 16.1 Did removing shot cancellation solve the observed strategy collapse?

### English

```text
NO
```

**Did not solve, only changed the winner.** The named collapse (Fast 50-0) did disappear (50-0-10 → 2-38-20), but replaced by Optimizer 38-2 and 37-3 — still **single strategy dominance**, just dominator changed from "fastest" to "highest function quality".

Need to distinguish two things, otherwise will misread:

- **Correctly fixed**: Speed dominating outcome through "cancellation" as **artificial channel**. This channel is indeed closed, offline model 180/180 match also proves closure is clean.
- **Not fixed**: After removing that channel, this ruleset **has no remaining mechanism to offset function quality gap**. Round-2's conclusion "speed affects outcome solely through Shot Cancellation" holds; removing that channel naturally made "function quality" the sole channel.


```text
NO
```




---

### 16.2 Does computation speed still have substantial competitive value?

### English

```text
NO (formal value retained, substantial benefit not supported by evidence)
```

- Formal value **clearly exists**: Fast has first-mover rate **1.000** in fast-vs-optimizer (Optimizer 0.000).
- But almost no conversion to wins: same 60 matches, Fast 2-38. Against Hybrid 13-10, seemingly has advantage, but after swapping order **7 comparable conditions, 6 flipped outcome**, closer to timing noise than stable advantage.
- Counter-proof: Optimizer has **23.8% / 29.7%** of shots landing after its own Shooter has been counter-killed — the slow side relies on "my shot won't be deleted anyway".


```text
NO (formal value retained, substantive benefit unsupported by evidence)
```


---

### 16.3 Has function quality optimization become overly dominant?

### English

```text
YES
```

Optimizer won 75/180 matches (41.7%), two head-to-head pairings respectively **38-2** and **37-3**. Kills per effective shot 0.604–0.662, significantly higher than Fast's 0.478–0.541 and Hybrid's 0.473–0.487; "no-hit rate" dropped from 0.915 under old rule to 0.665 — its function quality truly landed for the first time.

**Per §25, this round does not modify algorithms.** This round's purpose is to measure `RULE EFFECT` not `ADAPTED META`; three competitor algorithms **frozen unchanged** throughout.


```text
YES
```



---

### 16.4 Is the revised Shooter rule suitable as V1.1 playtest baseline?

### English

```text
YES
```

As a **rule**: It is internally coherent, implementation faithful (offline model 180/180 match), eliminates an artificial dominance channel, restores Shooter's semantics as "mathematical firing anchor", and makes "whether to assassinate opponent Shooter" a real strategic tradeoff rather than a one-shot-kill switch.

But must give the full picture: **It is not a solution to balance**. Choosing YES is because "this rule is correct", not "this ruleset is already balanced". Balance issues (§16.1/§16.3) remain as-is for next round.


```text
YES
```



---

### 16.5 Should Stalemate measurement become the next rule task?

### English

```text
YES
```

Three reasons:

1. Stalemate distribution **worsened** this round: p75 consecutive zero-kill rounds 21 → 25, matches hitting 30-round cap 53 → 58.
2. Added **mutual elimination** as endgame structure (19/180, Fast↔Hybrid as high as 25%), impossible under old rule, a new absorbing structure requiring separate measurement and definition.
3. Round-2 already withdrew "20/30 threshold" recommendation, reasoning distribution right-censored by 30-round cap, threshold non-identifiable. This round's cap-60 probe (§13.1) provides harder evidence: **68.8% of stalemates still absorbing fixed points at 60 rounds** (22/32), only resolved less than one-third. That is, stalemate is not "insufficient rounds", but situation itself already frozen — precisely the kind of situation requiring a formal Stalemate rule to terminate.

Per §26, this round **did not implement Stalemate rule** (maintains `DEFER`), only collected two measurements.


```text
YES
```




---

## 17. Remaining Open Questions

### English

1. **Is function quality dominance a structural problem of this ruleset?** After removing cancellation channel, no mechanism remains in rules to compensate slow side's function quality advantage. Movable levers (**all not implemented this round**): lower time budget, give first-mover a quantifiable advantage, or link shot cost to elapsed time.
2. **Should mutual elimination be a draw?** This round judges DRAW per §8. 19/180 and concentrated in Fast↔Hybrid (25%), whether this proportion is acceptable, whether there should be alternative handling (e.g., by remaining points, by kill count), undefined.
3. **Is Fast↔Hybrid outcome just noise?** 13-10 and swap 6/7 flipped, sample insufficient to support "Fast superior to Hybrid". Needs more conditions or repeated runs of same condition to conclude.
4. **Is stalemate threshold identifiable?** Depends on §13.2's cap-60 results.
5. **P-1 (Should factory slots contain `manifest.json`)?** Needs adjudication before full regression can return to all-green.
6. **Should three competitor algorithms be re-tuned for Revision 2?** Per §16/§25, this round **explicitly does not**; this should be next round's independently-authorized `ADAPTED META` experiment, and must be reported separately from this round's `RULE EFFECT`.



---

## 18. Reproduction Guide

### English

```bash
# 0. Commit where rule and production implementation reside (tree at result generation)
git log --oneline -3          # 90647f3 / 2e825a1 / 95f2a5f

# 1. Regression (permanent evidence of rule revision)
npx ts-node tests/locked-attack-right.ts        # R1–R8, 10/10
npm run typecheck
npx ts-node tests/run-all.ts                    # Expected 25/26 (P-1 is existing failure)

# 2. Three-algorithm balance experiment (180 matches, approximately 45 minutes on this machine)
bash playtest/harness/run_shooter_rule_revision.sh

# 3. Summary only
python3 playtest/harness/analyze_round2.py --root playtest/results/shooter-rule-revision

# 4. Counterfactual (new naming: locked-attack is production, cf-legacy-cancel is counterfactual)
python3 playtest/harness/gb_counterfactual.py verify \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --out playtest/results/shooter-rule-revision/cf/verify-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py rounds \
    --pair fast-vs-optimizer \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --out playtest/results/shooter-rule-revision/cf/rounds-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py simulate \
    --pair fast-vs-optimizer --conditions playtest/harness/conditions-round2.json \
    --out playtest/results/shooter-rule-revision/cf/sim-fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --ref-root playtest/results/shooter-rule-revision/raw \
    --modes locked-attack cf-legacy-cancel

# 5. Absorbing state test (cap 60) — condition subset exported from archive by §13.1's method
for p in fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer; do
  python3 playtest/harness/gb_round2.py run --pair $p \
      --conditions /tmp/cond-cap60.json --out /tmp/cap60-srr/$p --max-rounds 60
done
```

**Note**: Do not reuse Round-2's `--out` or `--cache` — those archives are evidence under **old rule**. `gb_round2.py run` skips already-archived matches (idempotent), reusing to old directory will get 0 new results.


```bash
# 0. Rules and production implementation at commit (tree at result generation)
git log --oneline -3          # 90647f3 / 2e825a1 / 95f2a5f

# 1. Regression (permanent evidence of rule revision)
npx ts-node tests/locked-attack-right.ts        # R1–R8, 10/10
npm run typecheck
npx ts-node tests/run-all.ts                    # Expected 25/26 (P-1 is pre-existing failure)

# 2. Three-algorithm balance experiment (180 matches, ~45 minutes locally)
bash playtest/harness/run_shooter_rule_revision.sh

# 3. Summary only
python3 playtest/harness/analyze_round2.py --root playtest/results/shooter-rule-revision

# 4. Counterfactual (new name: locked-attack is production, cf-legacy-cancel is counterfactual)
python3 playtest/harness/gb_counterfactual.py verify \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --out playtest/results/shooter-rule-revision/cf/verify-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py rounds \
    --pair fast-vs-optimizer \
    --raw playtest/results/shooter-rule-revision/raw/fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --out playtest/results/shooter-rule-revision/cf/rounds-fast-vs-optimizer.json
python3 playtest/harness/gb_counterfactual.py simulate \
    --pair fast-vs-optimizer --conditions playtest/harness/conditions-round2.json \
    --out playtest/results/shooter-rule-revision/cf/sim-fast-vs-optimizer \
    --cache playtest/results/shooter-rule-revision/cf/fn-fast-vs-optimizer.json \
    --ref-root playtest/results/shooter-rule-revision/raw \
    --modes locked-attack cf-legacy-cancel

# 5. Absorbing state verification (cap 60) — condition subset exported from archive using §13.1 method
for p in fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer; do
  python3 playtest/harness/gb_round2.py run --pair $p \
      --conditions /tmp/cond-cap60.json --out /tmp/cap60-srr/$p --max-rounds 60
done
```


---

## 19. Completion Status

### English

```text
SHOOTER RULE REVISION & REBALANCE COMPLETE
READY FOR INDEPENDENT RULE RE-GATE
```

This development side **does not declare** `TOURNAMENT READY`. Per task specification §30, hand to Fresh READ-ONLY Auditor to verify item-by-item:

```text
Rule document   == Competitor Kit == production Judge == tests == Replay
Whether old cancellation path remains
```

Verifiable anchors:

| Claim | How to verify |
|---|---|
| Rule text revised | `git show 90647f3 -- "Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md"` |
| Production implementation revised | `git show 2e825a1 -- src/` |
| No cancellation path remains | `grep -rn "shooter.alive\|ShotCancelled" src/` should only leave historical comments; `shotCancellationRate` measured 0.0 |
| Regression catches old rule | Add `if (!shooter.alive) continue;` back to `resolveOrderedShots` → `locked-attack-right` must turn red (self-proved: 10/10 → 6/10) |
| Results are deterministic consequences of rule | Round-2's CF prediction and Revision 2 official results field-for-field identical (§9) |
| Algorithms frozen unchanged | `git diff 877f142..95f2a5f --stat -- playtest/competitors/` should be empty |
| V1.0 untouched | `git rev-parse v1.0.0-competition^{commit}` → `26d7970` |


```text
SHOOTER RULE REVISION & REBALANCE COMPLETE
READY FOR INDEPENDENT RULE RE-GATE
```


```text
Rule document   == Competitor Kit == production Judge == tests == Replay
Whether old cancellation path remains
```



---

## Document Sanitization Checklist

### English

- **Internal paths**: ✓ All paths are relative to repository root or use canonical placeholders (`/tmp/`)
- **Agent state**: ✓ No agent execution logs, internal reasoning, or workflow state included
- **Personal information**: ✓ No personal paths, usernames, or machine-specific details
- **Secrets**: ✓ No credentials, tokens, or sensitive configuration values
- **Machine tokens preserved**: ✓ All technical identifiers (Team A, Team B, JSON keys, CLI flags, DSL operators, commit SHAs, numeric values) kept exact



---

**Document ends**

