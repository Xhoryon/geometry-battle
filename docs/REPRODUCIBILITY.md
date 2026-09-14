<div align="right">

**English** | <a href="./REPRODUCIBILITY.zh-CN.md">简体中文</a>

</div>

# Evidence Scope and Reproduction Methods

This document explains what the **public evidence package** in `playtest/results/` contains, what has been omitted, and how third parties can independently reproduce the main findings.

---

## 0. Placeholders

The public copy **contains no absolute paths from the generation machine**. If you see these in reports or command blocks:

| Placeholder | Meaning |
|---|---|
| `<repo>` | Root directory of this repository |
| `<workspace>` | Any writable temporary directory, e.g., a subdirectory under `/tmp/work` |

**System-level prefixes** like `/Users/`, `/var/folders/`, `/private/tmp` appear in the platform source code and regression tests (e.g., `SYSTEM_DENIES` in `src/runner/SandboxRunner.ts`, "response must not leak absolute paths" assertions in `tests/web-server.ts`). These are accurate descriptions of platform behavior and match patterns for security tests; they **contain no machine information** and are therefore preserved as-is.

---

## 1. Why Simplify

The full internal playtest archive consists of **4092 files / ~624 MB**, the majority being per-match `replay.json` and `console.log` files: large and highly repetitive.

The public copy is therefore a **reproducible minimal evidence package**: conclusions, metrics, and cross-check data are **fully preserved**; per-match raw artifacts are retained using a "**minimal record for every match + representative full samples per pairing**" strategy.

| | File Count | Size |
|---|---|---|
| Internal full archive | 4092 | ~624 MB |
| This public copy | 2153 | ~100 MB |

---

## 2. Fully Retained (No Reduction)

| Path | Content |
|---|---|
| `DUAL_ALGORITHM_PLAYTEST_REPORT.md` | Round-1 dual-algorithm baseline report |
| `round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md` | Round-2 three-way balance report |
| `shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md` | Rebalance report after Shooter rule revision |
| `<round>/metrics-*.json` | Per-match records + aggregate metrics |
| `<round>/*-summary.json` | Round summaries (with quantiles and CF summaries) |
| `round-2/matrix-*.json` | Offline robustness matrices |
| `bench/` | Phase-specific benchmarks |
| `<round>/cf/verify-*.json` | **Gate artifacts** (per-item counts and mismatch details) |
| `<round>/cf/rounds-*.json`, `cf/fn-*.json`, `cf/sim-*/` | Counterfactuals and round-level Shooter attribution |
| `round-2/platform-contaminated/` | **All 8 contamination cases** with complete raw evidence |
| `<round>/cap60-probe/` | Absorbing-state probe (cap 30 vs 60) |
| `revision-3-timeout-bench/BENCHMARK.json` | Aggregate conclusions from timeout benchmark |
| `../harness/`, `../competitors/` | All harness scripts, conditions, and three reference algorithms |

`cf/sim-*/` is complete (two modes × all conditions), not sampled.

---

## 3. Sampled Retention

Per-match directories under `<round>/raw/<pair>/` are retained in two tiers:

| Archive Content | Retention Policy |
|---|---|
| **Every match** | `match.json` + `summary.json` |
| **Representative seeds** (2 seeds × 2 turn orders per pairing = 4 matches) | Full artifacts: `match.json` / `summary.json` / `replay.json` / `audit.json` / `console.log` |

Retaining **all** `match.json` files is critical: read-only reproduction scripts and per-match reconciliation depend solely on them. Only `gb_check.py` requires `replay.json`, and it **explicitly skips** matches missing that file (`if not os.path.isfile(p): continue` in `worlds_from_raw()`), so sampling does not cause errors.

| Round | `match.json` | Full Artifact Samples |
|---|---|---|
| Round-1 (`raw/`) | 60 matches | 4 matches |
| Round-2 (`round-2/raw/`) | 180 matches | 12 matches |
| Shooter rule revision | 180 matches | 12 matches |
| Revision 3 | 180 matches | 12 matches |

---

## 4. Not Published and Why

| Not Published | Reason |
|---|---|
| Remaining per-match `replay.json` / `audit.json` / `console.log` files (~3300 files / ~540 MB) | Large and highly repetitive; `match.json` already contains all judgment data needed for verification |
| `playtest/slots/` | Slot installation records containing absolute paths from the generation machine; can be regenerated via `gb_playtest.py --install` |
| `revision-3-timeout-bench/t{250,500,750}/` per-match artifacts | `BENCHMARK.json` is already a self-contained aggregate conclusion |

**This data is not lost.** Re-running the harness per the next section will fully reconstruct it, and reconstruction results can be compared item-by-item against the already-published `metrics-*.json` / `*-summary.json` / `cf/verify-*.json` in this directory.

> **Internal references in historical reports.** The three playtest reports were written during internal development and contain references to internal specifications and audit documents under `Plans/Input/…` and `Plans/Output/…` as **source citations**. These documents **are not published with this repository**. References are preserved as-is deliberately — they record the workspace state at the time; rewriting would falsify historical evidence. For all conclusions involving specific numbers, the supporting data can be found within this directory.

---

## 5. How to Reproduce

### 5.1 Read-Only Verification (No Platform Re-Run Required)

The Round-1 baseline can be **re-derived solely from evidence already committed to this repository**:

```bash
python3 playtest/harness/reproduce_round1.py
```

It parses `playtest/results/raw/*/match.json`, reconciles against `run-summary.json`, `metrics.json`, and `crosscheck.json` item-by-item, and compares with numbers claimed in `DUAL_ALGORITHM_PLAYTEST_REPORT.md`. On full consistency, it prints `ROUND-1 BASELINE REPRODUCED` and exits with `0`; on any inconsistency, it exits non-zero.

### 5.2 Re-Running the Platform

Prerequisites: Node.js + `npm install` (platform), Python 3.9+ (harness).

```bash
# 1. Install reference algorithms to playtest slots (ignored by .gitignore, won't pollute working tree)
python3 playtest/harness/gb_playtest.py install \
    --fast playtest/competitors/solver-fast \
    --optimizer playtest/competitors/solver-optimizer

# 2. Round-1 dual-algorithm baseline
python3 playtest/harness/gb_playtest.py run \
    --conditions playtest/harness/conditions.json \
    --out playtest/results/raw --max-rounds 30
python3 playtest/harness/gb_playtest.py analyze \
    --raw playtest/results/raw --out playtest/results

# 3. Round-2 three-way balance
bash playtest/harness/run_round2_experiments.sh
python3 playtest/harness/analyze_round2.py
```

**Full** step-by-step commands for Round-2 and Shooter rule revision (including counterfactuals, gates, absorbing-state probes) are in the "Reproduction" sections of the respective reports.

```bash
# Example: Rebuild gate artifacts, then compare against already-published verify-*.json
for p in fast-vs-optimizer optimizer-vs-hybrid fast-vs-hybrid; do
  python3 playtest/harness/gb_counterfactual.py verify \
      --raw playtest/results/round-2/raw/$p \
      --out playtest/results/round-2/cf/verify-$p.json
done
```

> **Note (Shooter rule revision)**: Do not reuse Round-2's `--out` or `--cache` — those archives belong to the **old rules**. `gb_round2.py run` is idempotent for already-archived matches (it will skip them); reusing the old directory will yield 0 new results.

---

## 6. Trust Boundaries

- Summary numbers in this directory are from **that specific machine**; computation times in `metrics-*.json` reflect that machine.
- The platform's own fairness guarantees (timing from each GO instant, mtime-based measurement, sandbox isolation, etc.) are documented in the root [README](../README.md) "Isolation and Fairness" section and in `tests/timing-fairness.ts`.
- Simplification affects **evidence volume** only, not the **verifiability** of published conclusions: all `match.json` files, summaries, and cross-check artifacts that conclusions depend on are present.
