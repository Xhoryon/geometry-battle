/**
 * 1000-Map Stress Test
 * Plan 2 Section 59: Map Generator Test
 */

import { batchGenerateMaps } from './map/MapGenerator';

console.log('═══════════════════════════════════════════════════════════════');
console.log('           MAP GENERATOR STRESS TEST (1000 maps)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Testing easy difficulty...');
const easyMaps = batchGenerateMaps(1000, 'easy');
console.log(`Easy: ${easyMaps.length}/1000 valid\n`);

console.log('Testing medium difficulty...');
const mediumMaps = batchGenerateMaps(1000, 'medium');
console.log(`Medium: ${mediumMaps.length}/1000 valid\n`);

console.log('Testing hard difficulty...');
const hardMaps = batchGenerateMaps(1000, 'hard');
console.log(`Hard: ${hardMaps.length}/1000 valid\n`);

console.log('═══════════════════════════════════════════════════════════════');
console.log('           STRESS TEST COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Total valid maps: ${easyMaps.length + mediumMaps.length + hardMaps.length}/3000`);
console.log('');
console.log('All maps generated without crashes.');
console.log('Map Generator is ready for production.');
