<div align="right">

**English** | <a href="./RELEASE_NOTES.zh-CN.md">简体中文</a>

</div>

# Release Notes

## V1.4.3 (2026-09-14) — Documentation Cleanup & Pair Integrity

V1.4.3 is a documentation-only cleanup and documentation regression-testing patch.

This release:
- Removes duplicated and misplaced sections left by the V1.4.2 language split.
- Restores the canonical README title and current-release statement.
- Removes opposite-language prose residue across all documentation pairs.
- Repairs language-switch and internal documentation links and anchors.
- Strengthens paired-document regression checks (`bilingual-docs.ts`).
- Adds structural-order, language-purity, and exact-switch checks.
- Re-runs privacy, path, and credential scans.

It does not change competition rules, Validator behavior, MatchEngine behavior, runtime behavior, protocol semantics, authorization, replay authority, or Web runtime behavior.

## V1.4.2 (2026-09-14) — Language-Switchable Documentation

V1.4.2 split all documentation into switchable language pairs (`.md` and `.zh-CN.md`).

## V1.4.1 (2026-09-13) — Complete Bilingual Documentation

V1.4.1 delivered complete bilingual coverage across repository documentation.

## V1.4.0 (2026-09-13) — Platform Fairness & Tournament UX

V1.4 addresses platform fairness (Team A/B mirror symmetry), expands tournament participant
orientation, and delivers a comprehensive UX overhaul across all web roles.

Prepared from independently audited internal snapshot `7f6e39d0d4faaa34ca48981aaee44f0213a52337`.

### Highlights

#### Platform Fairness

- **Fixed Team A/B Mirror Asymmetry in Validator**: Corrected numerical sampling bias in
  coordinate validation that broke mirror invariance between Team A and Team B slots.

- **Permanent Mirror Fairness Regression Testing**: Added automated mirror-paired test suite
  to detect future platform slot bias.

- **Full-Match Symmetry Testing**: Validates that swapping teams produces swapped outcomes
  under controlled conditions.

- **Participant Mirror Self-Check Tooling**: Competitor-kit includes `check_mirror.py` and
  server-side `check-mirror.ts` for independent verification.

**Fairness Statement**: No platform slot bias was detected under tested mirror-paired
conditions (30 map seeds, same-solver pairs, n=60 matches). The old Validator bug is fixed,
and regression tests now guard the mirror invariant. See `docs/V1.4_FAIRNESS_REPORT.md` for
methodology and limitations.

#### Competition Protocol Hardening

- **Clarified Team Orientation Requirements**: Team A faces +x (right), Team B faces -x (left).
  Input coordinate ordering must respect team orientation to avoid breaking mirror symmetry.

- **Expanded Competitor-Kit Orientation Guidance**: Algorithm requirements document now
  explicitly states coordinate-ordering expectations and provides mirror diagnostic tools.

- **Host Operator Sleep-Timing Guidance**: Added documentation warning against system sleep
  during matches due to process-timer skew risks.

#### Frontend & UX Overhaul

- **Role-Based Home Page** (`/`): Entry point with Judge / Team A / Team B / Spectator /
  Replays navigation cards.

- **Redesigned Judge Workflow** (`/judge`): Improved phase-driven wizard with clearer
  step-by-step progression, better status visibility, and streamlined controls.

- **Improved Team Submission Flow** (`/team/a`, `/team/b`): Enhanced upload experience,
  preflight progress feedback, emitter selection workflow, and lock confirmation.

- **Redesigned Spectator Experience** (`/spectator`): Clean read-only tournament view with
  better match state presentation and localized phase descriptions.

- **Authoritative Replay Player** (`/replay/:matchId`): New timeline-based replay controls
  with round scrubbing, play/pause, and synchronized state visualization.

- **Expanded Bilingual UI**: Comprehensive Chinese/English localization across all new
  components and workflows.

- **Accessibility Improvements**: Enhanced keyboard navigation, ARIA labels, focus management,
  and screen-reader support across web application.

---

## V1.3.0 (2026-09-12) — Bilingual Tournament Experience

V1.3 brings a comprehensive bilingual (Chinese / English) localized user experience,
cross-phase run-to-end execution fixes, and robust end-to-end test synchronization.

Prepared from independently audited internal snapshot `febf1c69fb6cb78624811513149f477c4e30fac6`.

### Highlights

- **Bilingual Interface (i18n)**: Full Chinese (zh-CN) and English (en-US) support across
  the web application (Judge console, Team pages `/team/a` & `/team/b`, Spectator screen,
  Replay viewer).

- **Persistent Language Selection**: Language preference switches seamlessly with instant
  locale state persistence in `localStorage`.

- **Bilingual Documentation**: Comprehensive bilingual README with mirrored rulebooks,
  protocol specifications, and route maps.

- **Run-to-End Correctness Fix**: Resolved execution stall when advancing multiple rounds
  from non-initial phases (`REVEAL` / `PUBLIC`), ensuring seamless multi-round autoplay.

- **Protocol & Server Hardening**: Localized API error keys and message propagation; client
  transparently passes localized reasons.

---

## V1.2 — Interactive Tournament Platform

> License: **PolyForm Noncommercial License 1.0.0** (see root [`LICENSE`](../LICENSE)).
> *Source-available for noncommercial use* — **NOT** an OSI-approved open-source license.
> Commercial use requires separate authorization. See [README License](../README.md#license).

### Rule Differences from V1.1 (Only One)

**Fixed Emitter is no longer platform-fixed; each team selects from their own points before match start and locks it.**

In V1.1, A/B team emitters were fixed at `(-18, 0)` / `(18, 0)`; in V1.2, each side selects
one from **their own initial points**, submits and locks it, and it remains unchanged throughout
the match. The emitter is still a **mathematical firing anchor** — cannot be killed, does not
count toward survival, is not a combat point, is not in `points` (the selected point is removed
from `points`).

All other rules (`y = f(x)` attack function, 500 ms computation limit, `STALEMATE = 20`,
`HARD_ROUND_LIMIT = 60`, four termination types) **remain unchanged**.

### Participant Experience

- **Team Pages** `/team/a` `/team/b`: Upload your algorithm package (ZIP / directory / single `solver.py`)
  → **read-only browse your own source code** → select and lock your Fixed Emitter from your own points.

- **Choice remains confidential until reveal**: Both coordinates are only made public **after both sides have locked**.
  Before that, callers without that team's token receive no coordinate in **server payload** at all —
  not hidden by frontend, but not sent by server.

### Tournament Mode (Enabled by Default)

Official matches **do not allow platform-bundled algorithms**. The server guards all four entry
points; any package hash matching the "platform release tree" (`starter/`, `algorithms/team-*`,
`competitor-kit/starter`, `demo/*`, `playtest/competitors/*`) is rejected: team page upload
(**validate before install**), `install` (install by path), `use-slot`, `prepare` (wizard main button).

Actual rejection happens **at execution time**, not by graying out buttons — a direct `POST` cannot bypass.
`npm run app -- --no-tournament` disables it, **for development self-testing only**.

### Authorization & Access Control

`/judge` and `/team/*` require access tokens (capability, not account/password):

| Role | Token |
|---|---|
| Judge Console | Judge token, **process lifetime** |
| Team Pages | Team token = `HMAC(judge token, matchId + team)`, **auto-expires per match** |

Tokens travel in URL **fragment** (not sent to server, not in request line / `Referer` / logs).
`/spectator`, `/replay/:matchId`, trajectories, and health checks remain **anonymous read-only**.

The judge console legitimately displays both teams' choices simultaneously, so **do not share judge console links externally**.

### Web UI

| Route | Purpose |
|---|---|
| `/judge` | Judge Console: phase-driven wizard — load → validate → **both sides lock Emitter** → reveal → START → settlement → terminal → reset → next match; can view both teams' uploaded source |
| `/team/a` `/team/b` | Team Pages: upload / source browsing / select and lock Emitter |
| `/spectator` | Spectator Screen: read-only, no diagnostic info |
| `/replay/:matchId` | Replay: replay using persisted match/audit/replay data, **without re-running any algorithms** |

### Upload & Validation

- Supports **ZIP (`stored` and `deflate` compression modes)**, directory, single `solver.py`.

- Browser-side unpacking uses platform-bundled `DecompressionStream('deflate-raw')`,
  and **counts bytes while decompressing**, immediately aborts if over budget — avoids deflate bombs killing the tab.

- Organizers **do not** directly extract archives into slots. If any step fails (invalid structure, won't run, invalid output),
  existing slot **remains unchanged**, bad package stays only in `<slotRoot>/.staging/`.

### Platform (Inherited from V1.1)

Two-phase input protocol (`public_state.json` → `reveal_state.json`), START hard gate,
strict `output/result.json` IPC, fixed runtime (CPython 3.9.6 / no third-party packages),
`sandbox-exec` four-zone sandbox, timing anchor after `write('GO')`, timing endpoint at result file mtime.

---

## Reference Solver (Demo) Notes

`demo/reference-solver-v2/` is a **teaching / local testing** reference implementation.

- It is **not an optimal solution**, nor does it represent the platform's capability ceiling.

- Against some opponents it enters a **period-2 stalemate** (both sides alternate between two shots that miss).
  This is a **strategy quality** limitation, **not a platform correctness issue** — the engine will properly judge it a draw per `STALEMATE`.

- Reproducibility is enforced by `tests/demo-repro.ts` (direct call and official sandbox each 10 times, byte-identical).

- **Do not** treat it as a guarantee of "always converges" or "always wins".

---

## Public Tree Verification Results & One Known Test Environment Dependency

On a **fresh clone** (no local runtime remnants):

| Check | Result |
|---|---|
| `npm install` | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:web` | PASS |
| `npm test` | **38 / 39 suites** (single failure below) |
| `competitor-kit/tools/validate_submission.py starter` | PASS (`PRE-FLIGHT PASS`, 2 teams × 9 sections) |

### Single Failing Test

`tests/operator-e2e.ts`:
`judge: 只给 --auto 就能开一场正规比赛（不需要 --a/--b，不需要开发 flag）`,
assertion `Team A: READY` fails.

**Root cause (unrelated to this release's sanitization, reproduced on internal audit commit)**:
Judge console slot-ready state reads not the current Preflight result, but the on-disk install record
`<slotRoot>/.slots/<team>.json` field `preflight.ok`. This directory is `.gitignore`'d,
so **any fresh clone lacks it**. Internal dev machines have it because prior `install` runs
(that record's `installed_at` is 2026-09-10, `source` points to
`playtest/competitors/solver-fast`, see `.gitignore` comment for that directory).

**Exclusion process**: Temporarily removing the similarly-ignored `algorithms/.slots/` and
`algorithms/.staging/` from the internal audit tree, **the same test fails identically** (7/8, same assertion).
Thus this test has an **environment dependency** — it passes on dev machines via leftover runtime state, must fail on clean trees.
**This is not a product defect, and this release does not fix it** (fixing it would require modifying audited test code,
beyond "public export" scope).

### Platform Behavior Unaffected

The same `--auto` path on the public tree actually completes Preflight and runs to termination,
`match.json` / `audit.json` / `replay.json` all properly written — only the console's
`READY` **string presentation** fails, because its source is that disk record.

### About Timing Fairness Suite

`timing-fairness` uses **razor-edge statistical assertions** (`aFasterRate ∈ (0.4, 0.6)`, plus swap win-rate delta and
timing median delta). When **machine is idle** it stably passes on public tree (measured `aFasterRate = 0.447`);
if run concurrently with other heavy loads it may exceed bounds. It verifies "slot/order produces no exploitable systemic advantage",
**does not constitute an absolute fairness guarantee**.

---

## Version Source

### V1.4

This public V1.4 release was prepared from an **internally independently audited** competition source snapshot:

```text
7f6e39d0d4faaa34ca48981aaee44f0213a52337
```

That internal snapshot's final audit conclusion: `PASS — APPROVED FOR V1.4 RELEASE`.

### V1.3

This public V1.3 release was prepared from an **internally independently audited** competition source snapshot:

```text
febf1c69fb6cb78624811513149f477c4e30fac6
```

That internal snapshot's final audit conclusion: `CONDITIONAL PASS — APPROVED FOR V1.3 RELEASE`.

### V1.2

This public V1.2 release was prepared from an **internally independently audited** competition source snapshot:

```text
94a0788231c62f2e72abaa719609a70031a41433
```

That internal snapshot's final audit conclusion: `PASS — APPROVED FOR V1.2 RELEASE`.

---

This public repository uses an **independent, sanitized release history**, so **public Git commit identifiers
do not correspond to internal development repository commit identifiers**. The above SHA-1 identifiers
are provenance evidence for internal audit snapshots; public repository version tags (`v1.2.0`, `v1.3.0`, `v1.4.0`)
point to corresponding public release commits.
