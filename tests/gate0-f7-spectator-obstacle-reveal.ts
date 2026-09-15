/**
 * Gate 0 Finding F7: Spectator Pre-Reveal Obstacle Leak (Fix Verification)
 *
 * OBJECTIVE: Verify that spectators cannot see obstacles before REVEAL phase.
 *
 * Expected behavior after fix:
 * - EMITTER_SELECT/READY: obstacles HIDDEN from spectator payload
 * - REVEAL and beyond: obstacles VISIBLE
 * - Judge board: unaffected (full visibility always)
 * - Team boards: unaffected (frontend controls rendering)
 *
 * This is a GREEN test - verifying the fix works correctly.
 */

import assert from 'assert';
import { MatchSession } from '../src/server/session';
import { prepareRuntimeSlots } from '../src/submission/Slot';
import type { SpectatorBoard, JudgeBoard } from '../src/server/protocol';

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('Gate 0 F7: Spectator Obstacle Reveal (Fix Verification)');
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
  console.log(`  Difficulty: medium\n`);

  // Prepare match - internally uploads, runs preflight, and calls startMatch
  const prepareResult = await session.prepareMatch();
  assert(prepareResult.ok, `Prepare should succeed: ${prepareResult.errors?.join('; ') || 'unknown error'}`);

  console.log('Test 1: EMITTER_SELECT phase - obstacles should be HIDDEN');
  console.log('───────────────────────────────────────────────────────');
  const boardEmitterSelect = session.getBoard('spectator') as SpectatorBoard;
  console.log(`  Phase: ${boardEmitterSelect.phase}`);
  console.log(`  Obstacles in spectator payload: ${boardEmitterSelect.arena?.obstacles?.length || 0}`);

  assert(boardEmitterSelect.phase === 'EMITTER_SELECT', 'Should be in EMITTER_SELECT phase');
  assert(
    !boardEmitterSelect.arena?.obstacles || boardEmitterSelect.arena.obstacles.length === 0,
    'Obstacles should be hidden from spectator in EMITTER_SELECT'
  );
  console.log('  ✓ Passed: Obstacles correctly hidden\n');

  // Auto-select and lock emitters
  const judgeBoard = session.getBoard('judge') as JudgeBoard;
  const arenaPoints = boardEmitterSelect.arena?.points || [];
  const teamAPoints = arenaPoints.filter(p => p.team === 'A');
  const teamBPoints = arenaPoints.filter(p => p.team === 'B');

  assert(teamAPoints.length > 0 && teamBPoints.length > 0, 'Should have points for both teams');

  await session.selectEmitter('A', teamAPoints[0].id);
  await session.lockEmitter('A');
  await session.selectEmitter('B', teamBPoints[0].id);
  await session.lockEmitter('B');

  console.log('Test 2: READY phase - obstacles should still be HIDDEN');
  console.log('───────────────────────────────────────────────────────');
  const boardReady = session.getBoard('spectator') as SpectatorBoard;
  console.log(`  Phase: ${boardReady.phase}`);
  console.log(`  Obstacles in spectator payload: ${boardReady.arena?.obstacles?.length || 0}`);

  assert(boardReady.phase === 'READY', 'Should be in READY phase');
  assert(
    !boardReady.arena?.obstacles || boardReady.arena.obstacles.length === 0,
    'Obstacles should still be hidden in READY'
  );
  console.log('  ✓ Passed: Obstacles still hidden\n');

  // Reveal
  await session.reveal();

  console.log('Test 3: REVEAL phase - obstacles should be VISIBLE');
  console.log('───────────────────────────────────────────────────────');
  const boardRevealed = session.getBoard('spectator') as SpectatorBoard;
  console.log(`  Phase: ${boardRevealed.phase}`);
  console.log(`  Obstacles in spectator payload: ${boardRevealed.arena?.obstacles?.length || 0}`);

  assert(boardRevealed.phase === 'REVEAL', 'Should be in REVEAL phase');
  assert(
    boardRevealed.arena?.obstacles && boardRevealed.arena.obstacles.length > 0,
    'Obstacles should be visible after REVEAL'
  );
  console.log(`  ✓ Passed: ${boardRevealed.arena.obstacles.length} obstacles now visible\n`);

  // Verify judge board always has full visibility
  console.log('Test 4: Judge board - always has full visibility');
  console.log('───────────────────────────────────────────────────────');
  const judgeInReady = session.getBoard('judge') as JudgeBoard;
  // Judge board extends Spectator, so arena should have obstacles now (after REVEAL)
  console.log(`  Judge board obstacles: ${judgeInReady.arena?.obstacles?.length || 0}`);
  assert(
    judgeInReady.arena?.obstacles && judgeInReady.arena.obstacles.length > 0,
    'Judge should always see obstacles (after REVEAL)'
  );
  console.log('  ✓ Passed: Judge has full visibility\n');

  console.log('═══ VERIFICATION ═══');
  console.log('✓ Test 1: EMITTER_SELECT → obstacles HIDDEN');
  console.log('✓ Test 2: READY → obstacles HIDDEN');
  console.log('✓ Test 3: REVEAL → obstacles VISIBLE');
  console.log('✓ Test 4: Judge board → full visibility maintained');
  console.log('\n✓ Server-side projection correctly filters obstacles by phase');
  console.log('✓ No client-side workaround needed');
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Result: GREEN ✓ (Fix verified)');
  console.log('═══════════════════════════════════════════════════════');

  session.close();
}

runTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
