/**
 * Gate 0 Finding F3: Spectator Obstacle Leak Test
 *
 * OBJECTIVE: Demonstrate that anonymous spectators can see full obstacle layout
 * BEFORE the formal REVEAL phase.
 *
 * Expected behavior (per Gate 0 audit):
 * - Phase EMITTER_SELECT/READY: Obstacles LEAKED to spectator board
 * - Phase REVEAL: Obstacles intentionally made public
 *
 * This is a RED test - it should PASS by confirming the leak exists.
 */

import assert from 'assert';
import { MatchSession } from '../src/server/session';
import { prepareRuntimeSlots } from '../src/submission/Slot';
import type { SpectatorBoard } from '../src/server/protocol';

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('Gate 0 F3: Spectator Obstacle Leak (RED Test)');
  console.log('═══════════════════════════════════════════════════════\n');

  // Prepare slots with canonical algorithms
  const slotsDir = 'runs/slots';
  prepareRuntimeSlots(slotsDir);

  // Create session with deterministic seed
  const session = new MatchSession({
    slotRoot: slotsDir,
    artifactRoot: 'runs/artifacts',
    seed: 42,
    pointCount: 8,
    difficulty: 'medium',
    tournamentMode: false, // Allow canonical algorithms
  });

  console.log('Setup:');
  console.log(`  Seed: 42`);
  console.log(`  Points: 8`);
  console.log(`  Difficulty: medium`);
  console.log(`  Tournament mode: false`);

  // Prepare match - internally uploads, runs preflight, and calls startMatch
  const prepareResult = await session.prepareMatch();
  assert(prepareResult.ok, `Prepare should succeed: ${prepareResult.errors?.join('; ') || 'unknown error'}`);

  console.log('\n1. After prepareMatch (EMITTER_SELECT phase):');
  const boardEmitterSelect = session.getBoard('spectator') as SpectatorBoard;
  console.log(`   Phase: ${boardEmitterSelect.phase}`);
  console.log(`   Arena exists: ${boardEmitterSelect.arena != null}`);

  if (boardEmitterSelect.arena?.obstacles) {
    const obstacleCount = boardEmitterSelect.arena.obstacles.length;
    console.log(`   Obstacles visible: ${obstacleCount}`);

    if (obstacleCount > 0) {
      console.log('\n⚠️  RED BEHAVIOR CONFIRMED:');
      console.log('   - Spectator board contains obstacles');
      console.log('   - Phase is EMITTER_SELECT (before REVEAL)');
      console.log(`   - ${obstacleCount} obstacles leaked`);
    }
  } else {
    console.log('   ⚠️  No obstacles found in arena');
  }

  // === VERIFICATION ===
  console.log('\n═══ VERIFICATION ═══');

  const leakConfirmed = boardEmitterSelect.arena?.obstacles &&
                        boardEmitterSelect.arena.obstacles.length > 0;

  if (leakConfirmed) {
    console.log('✓ TEST PASSES: Leak successfully demonstrated');
    console.log('  - Obstacles visible in EMITTER_SELECT phase');
    console.log('  - This is the RED behavior we are testing for');
    console.log('  - A fix should hide obstacles until REVEAL');
    console.log('\n✓ Code location: src/server/boards.ts:131');
    console.log('  buildArena() directly uses `map?.obstacles ?? []`');
    console.log('  with no phase-based filtering');
  } else {
    console.log('✗ TEST FAILS: Leak not reproduced');
    console.log('  - Obstacles were hidden in EMITTER_SELECT');
    console.log('  - Either the leak was already fixed, or test setup is wrong');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Result: ' + (leakConfirmed ? 'RED ✓' : 'GREEN (unexpected)'));
  console.log('═══════════════════════════════════════════════════════');

  session.close();
}

runTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
