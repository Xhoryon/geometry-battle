# Geometry Battle V1.1 — Competitor Kit

<div align="right">

**English** | <a href="./README.zh-CN.md">简体中文</a>

</div>

---

This is **everything** you need to write your algorithm. Read this page and you're ready to start.

```text
What you deliver: a directory with solver.py at its root
Each round it receives: public_state.json + reveal_state.json
Each round it outputs: a mathematical function f(x) (written to output/result.json)
```

---

## 1. Five-Minute Quickstart

```bash
# 1) Copy the official starter as your algorithm directory
cp -r competitor-kit/starter ./my-algorithm

# 2) Self-check (must pass all checks before submission)
python3 competitor-kit/tools/validate_submission.py ./my-algorithm

# 2b) Optional: Mirror self-check — whether the same code behaves identically as Team A / Team B (development diagnostic)
python3 competitor-kit/tools/check_mirror.py ./my-algorithm

# 3) Edit solver.py, repeat step 2
```

Self-check output looks like this (values will vary with package content):

```text
── Team A ──
  Entrypoint         PASS solver.py exists at package root
  Package            PASS 2 files / 6964 bytes / hash=0be87671344d…
  Runtime            PASS sandbox-exec available, algorithm will run in the same sandbox as official matches
  CLI / startup      PASS READY handshake successful, GO released (release_ns=…)
  Input              PASS public_state.json (1389 B) + reveal_state.json (681 B), sha256 binding verified by startup shell
  Result JSON        PASS schema_version="1.1", key set exactly {schema_version, dsl}
  DSL                PASS structure legal (7 nodes)
  Function legality  PASS f(-12.7337) = -9.1846 (Emitter residual 0.00e+0), convexity sign changes 0, sampled 3274 points
  Timeout            PASS elapsed 17.4 ms (limit 500 ms)
── Team B ──
  …(same as above, but different anchor coordinates)
PRE-FLIGHT PASS — 2 teams × 9 sections all passed
```

> Note that the `f(…)` in the `Function legality` line uses the anchor coordinates from the **sample world** —
> it varies from match to match and is **not** `(-18, 0)`. Your algorithm must read the anchor from `public_state.emitters`;
> hardcoding coordinates will fail right here with `NOT_THROUGH_SHOOTER`.

`PRE-FLIGHT PASS` means both interface and function legality are fine. The validation code is **the same** as the official Preflight,
differing only in the decoy world used (different seed, different anchor coordinates) —
so **do not hardcode specific values from the sample world**: hardcoding the anchor will fail locally,
while hardcoding other values (e.g., a point position) will cause you to fail when the match changes.

---

## 2. File Index

| File | Content | When to read |
|---|---|---|
| [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) | **Main document**: submission format, startup contract, input/output, MUST/SHOULD/MAY | Read this first |
| [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) | What Python is in the sandbox, which modules are available (**third-party packages: NONE**) | Before writing imports |
| [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md) | All DSL nodes, limits, error codes, legal/illegal examples | Before constructing functions |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | Field structure + JSON Schema for the three JSON files | Before writing parsing code |
| [starter/solver.py](starter/solver.py) | Official starter (correct interface, runs out of the box) | At the beginning |
| [examples/](examples/) | Real engine-produced input/output samples | When cross-referencing formats |
| [tools/validate_submission.py](tools/validate_submission.py) | Local self-check tool | Before every submission |
| [tools/check_mirror.py](tools/check_mirror.py) | Mirror self-check (development diagnostic): whether the same code behaves identically as A / B | Before submission, and after every change to direction / target selection logic |

---

## 3. Six Things You Need to Remember

1. **Fixed entry point**: `solver.py` at the package root, four parameters `--team / --public / --reveal / --output`.
   **The same formal submission MUST run correctly as Team A and as Team B**: A moves forward towards increasing x,
   B towards decreasing x, and the order of `points` is not geometric order (A group first, then B, each in
   generation order, identical every round, dead points kept in place, Emitter points removed without
   renumbering) — see ALGORITHM_REQUIREMENTS.md §6.2.
2. **Input only via files**: two JSON files, paths provided by parameters; stdin is not an input channel.
3. **Result only via file**: `{"schema_version":"1.1","dsl":<AST>}` written to `--output`; top level has exactly these two keys, stdout is not a result channel.
4. **Function must pass through your own fixed Emitter**: `|f(x_e) − y_e| ≤ 1e-6`. **Emitter coordinates vary by match** — each team selects and locks one from their own points before the match starts, so you must read from `public_state.emitters[team]`, **do not hardcode `-18` / `18`**. Use an incremental form like `f(x) = y_e + g(x − x_e)` for stability (no code changes when the anchor changes).

   > **Both local self-check and official Preflight will verify this for you.** Their sample worlds (decoy)
   > use anchors that are **points on the sample map**, not platform constants — hardcoded coordinates
   > will fail immediately in the `Function legality` section (`NOT_THROUGH_SHOOTER`), caught on the spot.
5. **No third-party packages**: `numpy` / `scipy` are **not available** in the sandbox, use standard library only.
6. **Produce result within 500 ms**, sandbox is rebuilt each round, no state persists across rounds.

---

## 4. Submission Format

```text
my-algorithm/          ← Submit this directory
├── solver.py          ← Required
├── manifest.json      ← Optional
└── Your other modules/data
```

Limits: ≤ 8 MB, ≤ 256 files, no symbolic links, extensions limited to
`.py .json .txt .md .csv .yaml .yml`.

---

## 5. What the Self-Check Tool Does (and What It Isn't)

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
python3 competitor-kit/tools/validate_submission.py ./my-algorithm --team A
python3 competitor-kit/tools/validate_submission.py ./my-algorithm --json
```

It places your algorithm in a **real sandbox** (`sandbox-exec`, the same as official matches), runs it once with a
**decoy world unrelated to the match**, then checks nine sections item by item.

The validation logic is **not** reimplemented in the tool (that would inevitably drift from the platform) —
it calls the platform's production code itself:

```text
inspectPackage / buildPublicState / buildRevealState
prepareSandbox / spawnRunner / parseResultFile
parseCanonicalDSL / validateAttackFunction
```

So: **local self-check rules == official Preflight rules**, same code, not two separate rule tables requiring manual sync.

It **does not check** strategy strength: passing self-check only means interface and function legality are fine, not that you'll win.

Requires Node.js (bundled with the competition repository); the Python frontend just calls it.

### 5.1 Mirror Self-Check `check_mirror.py` (Development Diagnostic)

```bash
python3 competitor-kit/tools/check_mirror.py ./my-algorithm
python3 competitor-kit/tools/check_mirror.py ./my-algorithm --json
python3 competitor-kit/tools/check_mirror.py ./my-algorithm --timeout 500
```

It runs the same code in the decoy world and in its **mirror** (x → −x, teams swapped, ids swapped, obstacles mirrored in order) — A on the original vs B on the mirror, and the reverse pair — then compares **normalised geometry** (`f_A(x)` against `f_B(−x)`) and the Judge outcome, not AST bytes. Legality and settlement still call production modules (`parseCanonicalDSL` / `validateAttackFunction` / `judgeShot`), the Python frontend just calls `src/operator/check-mirror.ts`.

Conclusion: `PASS` = consistent; `WARN` = both sides legal but the geometry differs (legal — your solver is not mirror-symmetric; make sure it is intentional); `FAIL` = one side legal while its mirror crashes / times out / is illegal (the classic Team-A-only bug); both sides failing is also `FAIL` (not a mirror issue — run `validate_submission.py` first). Exit codes: 0 = PASS / WARN, 1 = FAIL, 2 = usage / environment.

结论：`PASS` = 一致；`WARN` = 两侧都合法但几何不同（合法——你的求解器不是镜像对称的；确认这是刻意设计）；`FAIL` = 一侧合法而其镜像崩溃/超时/非法（典型的"只在 Team A 调试"bug）；两侧都失败同样记 `FAIL`（不是镜像问题——先跑 `validate_submission.py`）。退出码：0 = PASS / WARN，1 = FAIL，2 = 用法/环境。

**Note:** a `WARN` whose two pairs both report a different judge outcome (hits / blocked / end reason) is the non-crashing form of the same Team-A-only bug (the B side emitted a degenerate but legal function) — the exit code is 0, but treat it as seriously as `FAIL`; the tool prints an extra hint in that case. Relative paths (the package directory, `--sandbox-root`) resolve against the **repository root**, as with `validate_submission.py`.

**注意：**如果 `WARN` 的两对结果报告了不同的裁判结果（命中/被阻挡/终止原因），则是同一个"只在 Team A 调试"bug 的不崩溃形式（B 侧输出了退化但合法的函数）——退出码为 0，但应像 `FAIL` 一样严肃对待；工具会在这种情况下打印额外提示。相对路径（包目录、`--sandbox-root`）相对于**仓库根目录**解析，与 `validate_submission.py` 一样。

**It is a development diagnostic, not an official rejection rule — the official Preflight does not run it.** Formal interface and function legality are still determined by `validate_submission.py` (== official Preflight).

---

## 6. Relationship Between Official Preflight and Local Self-Check

| | Local Self-Check | Official Preflight |
|---|---|---|
| Validation code | Same | Same |
| Sandbox | Real sandbox | Real sandbox |
| World | Fixed decoy seed (reproducible) | `matchId`-derived decoy world |
| Team | Run once as A, once as B | Run once per your slot |
| Conclusion | `PRE-FLIGHT PASS` / `FAIL` | `Preflight: PASS` / `FAIL` |
| Mirror self-check | `check_mirror.py` (development diagnostic, optional) | **Not run** |

Neither will leak match information: decoy worlds are unrelated to actual match seeds.

---

## 7. Version and Freeze

```text
Protocol version  1.1
Runtime           CPython 3.9.6, third-party packages NONE
DSL               14 whitelisted nodes, nodes ≤128 / depth ≤12 / constants ≤1000
Result channel    output/result.json (only)
Timing            Each from their own GO, 500 ms
Match termination ELIMINATION / MUTUAL_ELIMINATION / STALEMATE (20 consecutive rounds with zero kills) / HARD_ROUND_LIMIT (round 60)
```

Every file in `competitor-kit/` is continuously verified by platform tests:

- `tests/competitor-kit.ts` — Documentation examples, reference integrity, examples drift prevention, CRASH readability, starter first run,
  §6.2 direction / array order / dual-side compatibility wording drift prevention, `tools/check_mirror.py` PASS / WARN / FAIL paths
- `tests/runtime-manifest.ts` — Modules the Manifest claims are importable must actually be importable in a real sandbox

In other words: **what's written on this page has tests watching it, preventing staleness.**
