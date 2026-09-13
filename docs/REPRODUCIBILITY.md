<!-- bilingual-doc: zh-CN + en-US -->

# 证据范围与复现方法

本文件说明 `playtest/results/` 这份**公开证据包**包含什么、省略了什么，
以及第三方如何独立复现其中的主要结论。

---

## 0. 占位符

公开副本**不含任何生成机器上的绝对路径**。若在报告或命令块中见到：

| 占位符 | 含义 |
|---|---|
| `<repo>` | 本仓库根目录 |
| `<workspace>` | 任意可写临时目录，例如 `/tmp/work` 下的一个子目录 |

`/Users/`、`/var/folders/`、`/private/tmp` 这类**系统级前缀**出现在平台源码与回归测试里
（`src/runner/SandboxRunner.ts` 的 `SYSTEM_DENIES`、`tests/web-server.ts` 的
「响应不得回绝对路径」断言等），是平台行为的真实描述与安全测试的匹配串，
**不含机器信息**，因此原样保留。

---

## 1. 为什么要精简

完整的内部 playtest 归档是 **4092 个文件 / 约 624 MB**，其中绝大部分是逐场
`replay.json` 与 `console.log`：体积大、内容高度重复。

公开副本因此改为**可复现的精简证据包**：结论、指标与交叉核对数据**全部保留**；
逐场原始产物按「**每场留最小记录 + 每对阵留代表性完整样本**」的方式保留。

| | 文件数 | 体积 |
|---|---|---|
| 内部完整归档 | 4092 | ~624 MB |
| 本公开副本 | 2153 | ~100 MB |

---

## 2. 完整保留（未删减）

| 路径 | 内容 |
|---|---|
| `DUAL_ALGORITHM_PLAYTEST_REPORT.md` | Round-1 双算法基线报告 |
| `round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md` | Round-2 三方平衡报告 |
| `shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md` | 取消规则修订后的再平衡报告 |
| `<round>/metrics-*.json` | 逐场 records + 汇总指标 |
| `<round>/*-summary.json` | 各轮汇总（含分位与 CF 汇总） |
| `round-2/matrix-*.json` | 离线鲁棒性矩阵 |
| `bench/` | 分阶段基准 |
| `<round>/cf/verify-*.json` | **门禁产物**（逐项计数与失配明细） |
| `<round>/cf/rounds-*.json`、`cf/fn-*.json`、`cf/sim-*/` | 反事实与回合级取消归因 |
| `round-2/platform-contaminated/` | **全部 8 个污染案例**的完整原始证据 |
| `<round>/cap60-probe/` | 吸收态检验（cap 30 vs 60） |
| `revision-3-timeout-bench/BENCHMARK.json` | 超时基准的聚合结论 |
| `../harness/`、`../competitors/` | 全部 harness 脚本、conditions 与三个参考算法 |

`cf/sim-*/` 是完整的（两种模式 × 全条件），未抽样。

---

## 3. 抽样保留

`<round>/raw/<pair>/` 下的逐场目录分两档：

| 归档内容 | 保留策略 |
|---|---|
| **每场** | `match.json` + `summary.json` |
| **代表性 seed**（每对阵 2 个 seed × 2 个先后手 = 4 场） | 完整产物：`match.json` / `summary.json` / `replay.json` / `audit.json` / `console.log` |

保留 `match.json` 的**全部**场次是关键：只读复现脚本与逐场对账都只依赖它。
只有 `gb_check.py` 需要 `replay.json`，而它对缺失该文件的对局**显式跳过**
（`worlds_from_raw()` 里的 `if not os.path.isfile(p): continue`），因此抽样不会让它报错。

| 轮次 | `match.json` | 完整产物样本 |
|---|---|---|
| Round-1（`raw/`） | 60 场 | 4 场 |
| Round-2（`round-2/raw/`） | 180 场 | 12 场 |
| Shooter rule revision | 180 场 | 12 场 |
| Revision 3 | 180 场 | 12 场 |

---

## 4. 未公开及其原因

| 未公开 | 原因 |
|---|---|
| 逐场 `replay.json` / `audit.json` / `console.log` 的其余场次（约 3300 个文件 / ~540 MB） | 体积大且高度重复；`match.json` 已含复核所需的全部判定数据 |
| `playtest/slots/` | 槽位安装记录，含生成机器绝对路径；可由 `gb_playtest.py --install` 重新生成 |
| `revision-3-timeout-bench/t{250,500,750}/` 逐场产物 | `BENCHMARK.json` 已是自足的聚合结论 |

**这些数据并未丢失。** 按下一节重跑 harness 即可完整重建，且重建结果可与本目录下
已公开的 `metrics-*.json` / `*-summary.json` / `cf/verify-*.json` 逐条比对。

> **历史报告中的内部引用。** 三份 playtest 报告写于内部研发期，其中若干处引用
> `Plans/Input/…`、`Plans/Output/…` 下的内部规范与审计文档作为**来源标注**。
> 这些文档**不随本仓库发布**。引用保留原样是刻意的 —— 它们记录的是当时的工作区状态，
> 改写会让历史证据失真。凡涉具体数字的结论，其数据依据都在本目录内可查。

---

## 5. 如何复现

### 5.1 只读复核（不需要重跑平台）

Round-1 基线可以**仅凭本仓库已入库的证据**重新推导：

```bash
python3 playtest/harness/reproduce_round1.py
```

它解析 `playtest/results/raw/*/match.json`，与 `run-summary.json`、`metrics.json`、
`crosscheck.json` 逐条对账，并与 `DUAL_ALGORITHM_PLAYTEST_REPORT.md` 中声称的数字比较。
全部一致时打印 `ROUND-1 BASELINE REPRODUCED` 并以 `0` 退出；任一不一致则非零退出。

### 5.2 重跑平台

前置：Node.js + `npm install`（平台），Python 3.9+（harness）。

```bash
# 1. 安装参考算法到 playtest 槽位（被 .gitignore 忽略，不会污染工作区）
python3 playtest/harness/gb_playtest.py install \
    --fast playtest/competitors/solver-fast \
    --optimizer playtest/competitors/solver-optimizer

# 2. Round-1 双算法基线
python3 playtest/harness/gb_playtest.py run \
    --conditions playtest/harness/conditions.json \
    --out playtest/results/raw --max-rounds 30
python3 playtest/harness/gb_playtest.py analyze \
    --raw playtest/results/raw --out playtest/results

# 3. Round-2 三方平衡
bash playtest/harness/run_round2_experiments.sh
python3 playtest/harness/analyze_round2.py
```

Round-2 与 Shooter rule revision 的**完整**分步命令（含反事实、门禁、吸收态检验）
见两份报告各自的「复现」小节。

```bash
# 例：重建门禁产物后，与已公开的 verify-*.json 比对
for p in fast-vs-optimizer optimizer-vs-hybrid fast-vs-hybrid; do
  python3 playtest/harness/gb_counterfactual.py verify \
      --raw playtest/results/round-2/raw/$p \
      --out playtest/results/round-2/cf/verify-$p.json
done
```

> **注意（Shooter rule revision）**：不要复用 Round-2 的 `--out` 或 `--cache` ——
> 那些归档属于**旧规则**。`gb_round2.py run` 对已归档的对局是幂等的（会跳过），
> 复用到旧目录会得到 0 场新结果。

---

## 6. 可信度边界

- 本目录汇总数字来自**当时那台机器**；`metrics-*.json` 中的计算耗时反映该机器。
- 平台自身的公平性保障（各自 GO 时刻起算、mtime 计时、沙箱隔离等）见根
  [README](../README.md) 的「隔离与公平性」一节与 `tests/timing-fairness.ts`。
- 精简只影响**证据体积**，不影响已公开结论的**可复核性**：所有结论所依赖的
  `match.json`、汇总与交叉核对产物都在。

---
---

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
