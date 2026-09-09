/**
 * 地图生成器压力验证 —— 正式验收脚本
 *
 * 要求（Gate §Map Generator）：
 *   - 最低 300,000 张地图
 *   - 正式 generator 输出 0 张非法地图
 *   - 单次生成失败时 regenerate / 干净失败，绝不强制产生非法点
 *
 * 用法: npx ts-node src/map-stress-test.ts [总数]
 */

import { generateMapOrNull, tryGenerateMap, validateMap } from './map/MapGenerator';

const TOTAL = Number(process.argv[2] ?? 300_000);
const DIFFICULTIES: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
const POINT_COUNTS = [6, 7, 8, 9, 10];

interface Stats {
  generated: number;
  invalid: number;
  seedRetries: number;
  failures: number;
  invalidSamples: string[];
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`           MAP GENERATOR STRESS TEST (${TOTAL.toLocaleString()} maps)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stats: Stats = { generated: 0, invalid: 0, seedRetries: 0, failures: 0, invalidSamples: [] };
  const started = Date.now();

  for (let i = 0; i < TOTAL; i++) {
    const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
    const pointCount = POINT_COUNTS[i % POINT_COUNTS.length];
    const baseSeed = 1 + i * 104_729;

    // 先用单种子尝试，记录重试次数
    let attempts = 0;
    let map = null as ReturnType<typeof tryGenerateMap>;
    for (; attempts < 8; attempts++) {
      map = tryGenerateMap({ seed: baseSeed + attempts, pointCount, difficulty });
      if (map) break;
    }
    stats.seedRetries += attempts;

    if (!map) {
      // 单种子重试不足 —— 用正式 generator（最多 512 次）
      map = generateMapOrNull({ seed: baseSeed, pointCount, difficulty });
    }
    if (!map) {
      stats.failures++;
      continue;
    }

    stats.generated++;
    const validation = validateMap(map);
    if (!validation.valid) {
      stats.invalid++;
      if (stats.invalidSamples.length < 5) {
        stats.invalidSamples.push(
          `seed=${map.seed} difficulty=${difficulty} points=${pointCount}: ${validation.errors.join('; ')}`
        );
      }
    }

    if ((i + 1) % 50_000 === 0) {
      console.log(
        `  ... ${(i + 1).toLocaleString()} maps | generated=${stats.generated} invalid=${stats.invalid} failures=${stats.failures}`
      );
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('           STRESS TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Requested:        ${TOTAL.toLocaleString()}`);
  console.log(`Generated:        ${stats.generated.toLocaleString()}`);
  console.log(`Invalid maps:     ${stats.invalid}   <-- 必须为 0`);
  console.log(`Clean failures:   ${stats.failures}`);
  console.log(`Seed retries:     ${stats.seedRetries}`);
  console.log(`Elapsed:          ${elapsed}s`);
  if (stats.invalidSamples.length) {
    console.log('\nInvalid samples:');
    for (const s of stats.invalidSamples) console.log(`  - ${s}`);
  }
  console.log(
    stats.invalid === 0
      ? '\nRESULT: PASS — generator 输出 0 张非法地图'
      : '\nRESULT: FAIL — 存在非法地图'
  );

  process.exit(stats.invalid === 0 ? 0 : 1);
}

main();
