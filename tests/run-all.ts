/**
 * 回归测试总入口
 *
 *   npx ts-node tests/run-all.ts            跑全部套件
 *   npx ts-node tests/run-all.ts dsl-contract replay   只跑指定套件
 *
 * 每个套件都是独立进程：一个套件崩溃 / 退出码非 0，不会影响其他套件。
 * 退出码非 0 表示至少有一个套件失败。
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

/** 必需套件（顺序按「规范 → 判定 → 流程 → 隔离 → 公平 → 可审计」排列） */
const SUITES = [
  'dsl-contract',
  'convexity-aliasing',
  'official-starter',
  'map-fairness',
  'obstacle-block',
  'fixed-emitter',
  'locked-attack-right',
  'termination',
  'alive-kill',
  'roundstate-equality',
  'input-protocol',
  'stage-gating',
  'pre-start-execution',
  'preflight-decoy',
  'result-ipc',
  'algorithm-slot',
  'full-match-e2e',
  'runner-isolation',
  'cross-round-cheat',
  'package-tamper',
  'timeout-boundary',
  'process-tree-cleanup',
  'hostile-input',
  'timing-fairness',
  'replay',
  'arena-view',
  'operator-e2e',
  'runtime-manifest',
  'competitor-kit',
];

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = requested.length > 0 ? requested : SUITES;

const results: { name: string; ok: boolean; seconds: number }[] = [];

for (const name of suites) {
  const file = path.join(__dirname, `${name}.ts`);
  const started = Date.now();
  const r = spawnSync('npx', ['ts-node', file], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  results.push({ name, ok: r.status === 0, seconds: (Date.now() - started) / 1000 });
}

console.log('\n══════════════ 汇总 ══════════════');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(24)} ${r.seconds.toFixed(1)}s`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 套件通过`);
if (failed.length > 0) {
  console.log(`失败套件: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
