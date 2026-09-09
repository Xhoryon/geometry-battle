/**
 * Full UI Demo - Complete Match Flow Demonstration
 * Plan 2 Phase E/F: Complete UI Flow
 */

import { MatchSetupUI } from './ui/MatchSetupUI';
import { TeamControllerUI, JudgeControllerUI } from './ui/TeamControllerUI';
import { AudienceScreenUI } from './ui/AudienceScreenUI';
import { MatchController } from './competition/MatchController';
import { MatchLogger } from './replay/ReplayLogger';
import { generateMap } from './map/MapGenerator';

console.log('═══════════════════════════════════════════════════════════════');
console.log('           V1 MATCH SETUP & UI DEMONSTRATION');
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Match Setup
console.log('[STEP 1] Match Setup');
const setup = new MatchSetupUI('Alpha Algorithm', 'Beta Bot');

// Simulate algorithm upload (in real system, this would be actual file paths)
console.log('  Team A uploaded: Alpha Algorithm');
console.log('  Team B uploaded: Beta Bot');

// Generate map
const mapResult = setup.generateMap(8, 'medium');
console.log(`  Map generated: ${mapResult.map?.teamA.length} vs ${mapResult.map?.teamB.length}`);
console.log(`  Seed: ${mapResult.map?.seed}`);

console.log('\n' + setup.renderStatusTable());

// 2. Shooter Selection
console.log('\n[STEP 2] Shooter Selection');
const match = setup.getMatchController();
const teamAUi = new TeamControllerUI(match, 'A');
const teamBUi = new TeamControllerUI(match, 'B');

console.log(teamAUi.renderSelectionUI());
console.log(teamBUi.renderSelectionUI());

// Select shooters
console.log('\n  A selects A3');
teamAUi.selectShooter('A3');
console.log('  B selects B5');
teamBUi.selectShooter('B5');

// 3. Judge Controls
console.log('\n[STEP 3] Judge Controls');
const judge = new JudgeControllerUI(match);
console.log(judge.renderControlPanel());

// 4. Audience Screen
console.log('\n[STEP 4] Audience Screen');
match.judgeStart();  // Start round

const logger = new MatchLogger(
  match.getState().config.matchId,
  match.getState().config.seed,
  match.getState().config.teamAHash || '',
  match.getState().config.teamBHash || ''
);

const audience = new AudienceScreenUI(match, logger);
console.log(audience.render());

// 5. Match End Screen
console.log('\n[STEP 5] Match End Screen');
console.log(audience.renderMatchEnd());

// 6. Match Log
console.log('\n[STEP 6] Match Log Structure');
const matchLog = match.getMatchLog();
if (matchLog) {
  console.log(`  Match ID: ${matchLog.matchId}`);
  console.log(`  Seed: ${matchLog.seed}`);
  console.log(`  Team A Hash: ${matchLog.teamAHash}`);
  console.log(`  Team B Hash: ${matchLog.teamBHash}`);
  console.log(`  Rounds: ${matchLog.rounds.length}`);
  console.log(`  Winner: ${matchLog.winner}`);
}

// 7. Audit Log
console.log('\n[STEP 7] Audit Log');
console.log(match.getAuditLog());

// 8. Map Generator Stress Test
console.log('\n[STEP 8] Map Generator Stress Test (100 maps)');
const { batchGenerateMaps } = require('./map/MapGenerator');
const maps = batchGenerateMaps(100, 'medium');
console.log(`  Valid maps: ${maps.length}/100`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('           UI DEMONSTRATION COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');
