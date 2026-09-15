/**
 * Gate 0 Finding F2: Formal Sandbox Fail-Closed Test
 *
 * OBJECTIVE: Verify that tournament mode REJECTS execution when sandbox is unavailable.
 *
 * Expected behavior:
 * - Tournament mode + sandbox unavailable = ISOLATION_UNAVAILABLE error
 * - Non-tournament mode + sandbox unavailable = bare-Python fallback (old behavior)
 * - Tournament mode + sandbox available = normal execution
 *
 * This test uses a testable seam (setSandboxAvailabilityOverride) to simulate
 * sandbox unavailability without requiring a non-macOS platform.
 */

import assert from 'assert';
import { MatchEngine, setSandboxAvailabilityOverride } from '../src';
import { prepareRuntimeSlots } from '../src/submission/Slot';

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('Gate 0 F2: Sandbox Fail-Closed (Fix Verification)');
  console.log('═══════════════════════════════════════════════════════\n');

  const slotsDir = 'runs/slots';
  prepareRuntimeSlots(slotsDir);

  console.log('Test 1: Tournament mode + sandbox AVAILABLE');
  console.log('───────────────────────────────────────────────────────');

  try {
    setSandboxAvailabilityOverride(true); // Simulate sandbox available

    // Use algorithm from slots
    const slotADir = `${slotsDir}/team-a`;
    const slotBDir = `${slotsDir}/team-b`;

    const engine1 = new MatchEngine({
      slotRoot: slotsDir,
      artifactRoot: 'runs/artifacts',
      seed: 42,
      pointCount: 6,
      difficulty: 'easy',
      tournamentMode: true,
    });

    const upload1A = engine1.upload('A', slotADir);
    const upload1B = engine1.upload('B', slotBDir);

    assert(upload1A.ok, `Upload A should succeed: ${upload1A.errors.join('; ')}`);
    assert(upload1B.ok, `Upload B should succeed: ${upload1B.errors.join('; ')}`);

    const preflight1 = await engine1.preflight();

    if (!preflight1.ok) {
      console.log(`   Preflight failed: ${preflight1.errors.join('; ')}`);
      console.log(`   Detail: ${JSON.stringify(preflight1.detail, null, 2)}`);
    }

    assert(preflight1.ok, `Preflight should succeed with sandbox available`);
    console.log('   ✓ Passed: Tournament mode works with sandbox available\n');
  } finally {
    setSandboxAvailabilityOverride(null); // Reset
  }

  console.log('Test 2: Tournament mode + sandbox UNAVAILABLE');
  console.log('───────────────────────────────────────────────────────');

  try {
    setSandboxAvailabilityOverride(false); // Simulate sandbox unavailable

    const slotADir = `${slotsDir}/team-a`;
    const slotBDir = `${slotsDir}/team-b`;

    const engine2 = new MatchEngine({
      slotRoot: slotsDir,
      artifactRoot: 'runs/artifacts',
      seed: 43,
      pointCount: 6,
      difficulty: 'easy',
      tournamentMode: true,
    });

    const upload2A = engine2.upload('A', slotADir);
    const upload2B = engine2.upload('B', slotBDir);

    assert(upload2A.ok, `Upload A should succeed`);
    assert(upload2B.ok, `Upload B should succeed`);

    const preflight2 = await engine2.preflight();

    // Should FAIL in tournament mode
    assert(!preflight2.ok, 'Preflight should FAIL when sandbox is unavailable in tournament mode');

    // Check for ISOLATION_UNAVAILABLE error
    const hasIsolationError = preflight2.errors.some(e =>
      e.includes('ISOLATION_UNAVAILABLE') || e.includes('requires formal sandbox')
    );
    assert(hasIsolationError, `Should have ISOLATION_UNAVAILABLE error. Got: ${preflight2.errors.join('; ')}`);

    console.log('   ✓ Passed: Tournament mode correctly rejects execution');
    console.log(`   Error: ${preflight2.errors[0]}\n`);
  } finally {
    setSandboxAvailabilityOverride(null); // Reset
  }

  console.log('Test 3: Non-tournament mode + sandbox UNAVAILABLE');
  console.log('───────────────────────────────────────────────────────');

  try {
    setSandboxAvailabilityOverride(false); // Simulate sandbox unavailable

    const slotADir = `${slotsDir}/team-a`;
    const slotBDir = `${slotsDir}/team-b`;

    const engine3 = new MatchEngine({
      slotRoot: slotsDir,
      artifactRoot: 'runs/artifacts',
      seed: 44,
      pointCount: 6,
      difficulty: 'easy',
      tournamentMode: false, // Old behavior
    });

    const upload3A = engine3.upload('A', slotADir);
    const upload3B = engine3.upload('B', slotBDir);

    assert(upload3A.ok, `Upload A should succeed`);
    assert(upload3B.ok, `Upload B should succeed`);

    const preflight3 = await engine3.preflight();

    // Should SUCCEED with bare-Python fallback
    if (!preflight3.ok) {
      console.log(`   Unexpected failure: ${preflight3.errors.join('; ')}`);
      console.log(`   Detail: ${JSON.stringify(preflight3.detail, null, 2)}`);
    }

    assert(preflight3.ok, 'Non-tournament mode should allow bare-Python fallback');
    console.log('   ✓ Passed: Non-tournament mode allows fallback\n');
  } finally {
    setSandboxAvailabilityOverride(null); // Reset
  }

  console.log('═══ VERIFICATION ═══');
  console.log('✓ Test 1: Tournament + sandbox available → SUCCESS');
  console.log('✓ Test 2: Tournament + sandbox unavailable → REJECTION');
  console.log('✓ Test 3: Non-tournament + sandbox unavailable → FALLBACK');
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Result: GREEN ✓ (Fix verified)');
  console.log('═══════════════════════════════════════════════════════');
}

runTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
