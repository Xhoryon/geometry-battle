# GEOMETRY BATTLE V1.5 GATE 0.5 CANDIDATE FREEZE

**Date**: 2025-01-28
**Status**: IMPLEMENTATION COMPLETE — AWAITING INDEPENDENT AUDIT

---

## Candidate Information

**Branch**: `fix/v1.5-gate0.5-baseline-integrity`

**Baseline Commit**: `f6b2a4677e67b8797c6e52a9947b5ddeecab9be3`
- Tag: V1.4.3
- Description: Last stable release before Gate 0.5

**Candidate HEAD**: `7470eb8deb7aa63a4c28e8e3d15e8de2f71a1eab`
- Description: Gate 0.5 final verification complete
- Date: 2025-01-28

**Implementation Commits**:
```
7470eb8 - docs: Gate 0.5 final integrated verification complete
0355fac - docs: Gate 0.5 implementation complete handoff
411e361 - F6: CPU/Thread Runtime Contract - correct overclaim
0d0bd83 - F5: Emitter Semantic Drift - unified selection contract
674e439 - F4: Geometry Obstruction - analytic intersection
02dcce5 - F3: Hard 500ms deadline enforcement
0180140 - F1/F2/F7: Wave 1 complete
```

---

## Findings Summary

| # | Finding | Authority | Fix | Regression | Result |
|---|---------|-----------|-----|------------|--------|
| F1 | Cross-Team Isolation | Sandbox must prevent cross-team reads | Raw upload cleaned + sandbox blocks cross-paths | gate0-f1 | ✅ GREEN |
| F2 | Sandbox Fail-Closed | Tournament = formal isolation only | Tournament mode rejects bare fallback | gate0-f2 | ✅ GREEN |
| F3 | Hard 500ms Deadline | Wall-time enforcement | Real-time (monotonic) check | gate0-f3 | ✅ GREEN |
| F4 | Geometry Obstruction | All obstacles must block | Analytic intersection (~320 lines) | gate0-f4 | ✅ GREEN |
| F5 | Emitter Semantic | Match.ts contract: autoSelect for unattended only | Conditional on --auto flag | gate0-f5 | ✅ GREEN |
| F6 | Runtime Contract | Documentation = actual enforcement | Corrected CPU/thread claims | gate0-f6 | ✅ GREEN |
| F7 | Spectator Secrecy | Pre-REVEAL obstacles hidden | Server-side phase filtering | gate0-f7 | ✅ GREEN |

**Total**: 7/7 CLOSED

---

## Individual Finding Details

### F1: Cross-Team Isolation

**Previously**: Raw upload副本未及时清理

**Authoritative Contract**: 沙箱必须阻止跨队文件读取

**Fix**:
- Defense Layer 1: `prepareUploadedPackage()` cleans raw upload immediately after install
- Defense Layer 2: Sandbox profile blocks `/private/var/folders` access

**Regression**: `tests/gate0-f1-cross-team-isolation.ts`
- Synthetic cross-team read attempt → blocked
- Status: GREEN ✓

---

### F2: Formal Sandbox Fail-Closed

**Previously**: Tournament mode allowed bare-Python fallback when sandbox-exec unavailable

**Authoritative Contract**: 正式赛事必须使用形式化沙箱，不得降级

**Fix**:
- Added `tournamentMode` parameter to `DuelOptions` / `MatchOptions`
- Tournament + sandbox unavailable → `ISOLATION_UNAVAILABLE` error
- Non-tournament preserves legacy bare-Python fallback

**Regression**: `tests/gate0-f2-sandbox-fail-closed.ts`
- Scenario 1: Tournament + available → SUCCESS
- Scenario 2: Tournament + unavailable → REJECTION
- Scenario 3: Non-tournament + unavailable → FALLBACK
- Status: GREEN ✓

---

### F3: Hard 500ms Deadline

**Previously**: mtime-based timing susceptible to host suspension (SIGSTOP)

**Authoritative Contract**: 500ms wall-time deadline 必须真实 enforce，不受主机暂停影响

**Fix**:
- Added real-time enforcement using `process.hrtime.bigint()`
- Results exceeding real elapsed time rejected even if mtime valid
- Dual enforcement: mtime baseline + real-time upper bound

**Regression**: `tests/gate0-f3-hard-deadline.ts`
- Busy work >500ms → correctly rejected
- Status: GREEN ✓

---

### F4: Geometry Obstruction Correctness

**Previously**: 128-step discrete sampling missed narrow obstacles

**Gate 0 Probe**: Trajectory `y = x + sqrt(2) - 1e-6` passed through unit circle center (should block)

**Authoritative Contract**: 所有障碍物必须正确阻挡，无采样盲区

**Fix**:
- New file: `src/geometry/AnalyticIntersection.ts` (~320 lines)
- Analytic intersection for all geometries:
  - `lineCircleIntersection`: quadratic solution
  - `lineRectangleIntersection`: boundary detection
  - `lineSegmentIntersection`: distance formula
  - `polygonIntersection`: edge-by-edge checking
- Sampling preserved as fallback
- `Judge.ts` integrates analytic methods

**Regression**: `tests/gate0-f4-geometry-obstruction.ts`
- Original Gate 0 probe: BLOCKED ✓ (was passthrough)
- Tangent trajectories: BLOCKED ✓
- Near-tangent with clearance: NOT BLOCKED ✓
- All geometries and directions covered
- Status: GREEN ✓

**PERMANENT RED REGRESSION**: Narrow crossing now blocked

---

### F5: Emitter Semantic Convergence

**Authoritative Contract** (Match.ts:702-707):
```
/**
 * 仅供无人值守演练与测试
 * 正式赛事必须由双方各自 selectEmitter / lockEmitter
 */
autoSelectEmitters(): { A: string; B: string }
```

**Previously**:
- `judge.ts:360`: Unconditionally called `autoSelectEmitters()` in interactive mode
- `cli.ts:265`: Unconditionally called `autoSelectEmitters()` regardless of `--auto`

**Semantic Drift**: CLI正式比赛路径自动选择，Web要求手动选择

**Fix**:
- `judge.ts`: Removed line 360 unconditional auto-select
- `cli.ts`: Conditioned line 265 on `opts.auto === true`
- Interactive mode now prompts for manual selection or --auto flag
- Web session unchanged (already compliant)

**Regression**: `tests/gate0-f5-emitter-semantic.ts`
- Code inspection verification
- Web: never calls autoSelectEmitters() ✓
- CLI: only in --auto mode ✓
- Judge: only in --auto mode ✓
- Status: GREEN ✓

---

### F6: CPU/Thread Runtime Contract Truthfulness

**Previously Claimed** (docs/competitor-kit):
- "CPU: 1 核"
- "线程: 1（线程环境变量被钉为 1）"
- **Implied**: Hard single-core pinning + no threads possible

**Actually Enforced**:
- `THREAD_ENV` sets `OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS` / `NUMEXPR_NUM_THREADS` / `VECLIB_MAXIMUM_THREADS` to `"1"`
- These constrain BLAS/OpenMP library parallelism only
- Python `threading.Thread` CAN be created
- No OS-level CPU affinity/quota/cgroup enforcement
- No physical single-core pinning
- 500ms wall-time deadline enforced independently (F3)

**The Overclaim**: Documentation claimed universal thread prevention and hard core pinning; reality is BLAS constraint + timeout enforcement.

**Corrected Contract**:
- cpuQuota: Single contestant process + BLAS/OpenMP=1 (not OS-level core pinning)
- threadLimit: BLAS/OpenMP libs constrained (not universal thread blocking)
- Documentation: Accurate enforcement boundaries

**Changes**:
- `src/submission/Runtime.ts`: Updated comments and inline docs
- `competitor-kit/ALGORITHM_REQUIREMENTS.md`: Replaced "CPU: 1 核" / "线程: 1" rows
- `competitor-kit/RUNTIME_MANIFEST.md`: Corrected resource descriptions

**Regression**: `tests/gate0-f6-runtime-contract.ts`
- THREAD_ENV scope verified (BLAS only)
- cpuQuota/threadLimit interpretation corrected
- Enforcement boundaries enumerated
- Status: GREEN ✓

---

### F7: Spectator Pre-Reveal Obstacle Secrecy

**Previously**: Spectator board received full arena including obstacles before REVEAL phase

**Authoritative Contract**: 观众在 REVEAL 前不得看到障碍物

**Fix**:
- Server-side projection with phase-based filtering
- `buildArena()` accepts `forSpectator: boolean` parameter
- Obstacles hidden in EMITTER_SELECT/READY phases
- Obstacles visible in REVEAL+ phases
- Judge board unchanged (full visibility always)

**Changes**:
- `src/server/boards.ts`

**Regression**: `tests/gate0-f7-spectator-obstacle-reveal.ts`
- EMITTER_SELECT phase: obstacles hidden ✓
- READY phase: obstacles hidden ✓
- REVEAL phase: obstacles visible ✓
- Judge board: full visibility ✓
- Status: GREEN ✓

---

## Verification Results

### Permanent Regressions: ✅ ALL GREEN

All 7 regression tests pass and verify non-vacuous behavior boundaries.

### Type Checking: ✅ PASS

```
npm run typecheck       ✓
npm run typecheck:web   ✓
```

### Test Suite: ✅ 41/42 PASS

```
npm test

Total: 42 suites
Passed: 41
Failed: 1 (runner-isolation - pre-existing)
```

**Failed Suite Analysis**:
- `runner-isolation`: Pre-existing macOS sandbox-exec test issue
- Not introduced by Gate 0.5 changes
- Does not block Gate 0 verification
- Documented as environment limitation

### Diff Classification: ✅ CLEAN

- Unclassified production diff: **0**
- All changes mapped to F1-F7 or test/docs support

### Security Sanitization: ✅ CLEAN

- Real sensitive leak: **0**
- `.agent-progress` local-only (not committed)

---

## What Was NOT Changed

**No Rule Changes**:
- Core game rules unchanged
- Match engine state machine unchanged
- Tournament semantics unchanged
- Algorithm interfaces unchanged
- HIT epsilon unchanged
- Field dimensions unchanged
- Stalemate/round limits unchanged
- Emitter gameplay rules unchanged

**No Scope Creep**:
- V1.5.0 UX redesign: Not started
- TournamentLauncher: Not started
- Environment Doctor: Not started
- Rule Revision 4: Not started
- Simultaneous resolution: Not touched
- Deterministic solver seed: Not touched
- New DSL features: Not touched

---

## Known Limitations (Documented)

1. **E2E Tests**: Not run due to environment-specific browser automation setup
   - Mitigation: Core web functionality verified via `web-server` suite (28/28 PASS)
   
2. **runner-isolation Test**: Pre-existing failure
   - Cause: macOS sandbox-exec environment specifics
   - Impact: None on Gate 0.5 scope
   - Status: Documented, not a blocker

3. **CLI Interactive Emitter Selection**: UX prompt exists but selection UI not implemented
   - Current: Error message directs to --auto mode
   - Future work: Can add interactive selection menu
   - Status: Functional, UX enhancement opportunity

---

## Git Status

**Branch**: `fix/v1.5-gate0.5-baseline-integrity`

**Status**: CLEAN (no uncommitted changes)

**Actions Taken**:
- ✅ Implementation complete
- ✅ Verification complete
- ✅ Documentation updated
- ✅ All changes committed

**Actions PROHIBITED**:
- ❌ Merge to main
- ❌ Create tags
- ❌ Create releases
- ❌ Push to origin (unless for handoff)

---

## Handoff Status

### READY FOR FRESH INDEPENDENT GATE 0 RE-AUDIT

**Candidate**: `7470eb8deb7aa63a4c28e8e3d15e8de2f71a1eab`

**Requirements for PASS**:

Independent auditor must independently verify:
1. F1-F7 regressions non-vacuous ✓ (implemented)
2. No new P0 introduced ✓ (verified)
3. No new P1 introduced ✓ (verified)
4. No rule drift ✓ (verified)
5. No scope creep ✓ (verified)
6. Runtime claims accurate ✓ (F6 corrected)
7. Security report truthful ✓ (verified)

**Output Condition**:

Only output **"V1.5 GATE 0 COMPLETE — PASS — READY TO FREEZE V1.5.0 SPEC"** when independent audit confirms:
- P0 = 0
- P1 = 0
- F1–F7 CLOSED
- All above verified independently

**If Blocker Found**:

Cycle: fix → regression → verification → re-audit

**Do NOT self-sign final PASS**: Independent verification required.

---

## Implementation Agent Status

**Phase 1**: ✅ COMPLETE (F6 fixed, all F1-F7 CLOSED)
**Phase 2**: ✅ COMPLETE (Integrated verification GREEN)
**Phase 3**: ✅ COMPLETE (Candidate frozen, status documented)
**Phase 4**: ⏸️ PENDING (Awaiting independent audit capability)

**Note**: Current environment does not support automated fresh subagent spawn for independent audit. Manual independent verification required.

---

## Summary

Gate 0.5 baseline integrity fixes complete. All 7 findings CLOSED with permanent regressions. Contract corrected to match enforcement reality. No rule changes, no semantic drift, no unintended scope expansion.

**Status**: READY FOR INDEPENDENT AUDIT

**Candidate**: `fix/v1.5-gate0.5-baseline-integrity` @ `7470eb8`

---

*Implementation stopped per instructions. Awaiting independent auditor.*
