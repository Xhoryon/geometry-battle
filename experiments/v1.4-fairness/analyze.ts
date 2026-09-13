/**
 * analyze —— 离线复算一个或多个 campaign 的 records.json（selfplay.ts 写在 --raw/<campaign>/ 下）
 *
 * 用法：npx ts-node experiments/v1.4-fairness/analyze.ts <records.json> [<records.json> ...]
 * 多个文件时额外给出**合并**后的先手统计（不同 solver 的槽位胜率不能合并，先手分布可以按回合合并）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MatchRec, describe, firstSolverStats, summarize } from './summary';

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('给出至少一个 records.json');
  const all: MatchRec[] = [];
  for (const f of files) {
    const records = JSON.parse(fs.readFileSync(f, 'utf-8')) as MatchRec[];
    all.push(...records);
    const s = summarize(records, {
      campaign: records[0]?.campaign ?? path.basename(path.dirname(f)),
      pkg: '(records)',
      packageName: null,
      packageHash: null,
      args: {},
      loadBefore: [],
      loadAfter: [],
      durationSec: records.reduce((t, r) => t + r.durationSec, 0),
    });
    console.log(describe(s));
    console.log('');
  }
  if (files.length > 1) {
    const f = firstSolverStats(all);
    console.log(
      `POOLED firstSolver（${files.length} 个 campaign，${all.length} 场）: COMPLETE 回合 ${f.completeRounds}  A ${f.A} / B ${f.B} / tie ${f.tie}  P(A先|非tie)=${f.aFirstOfDecided.rate.toFixed(4)} CI95 [${f.aFirstOfDecided.ci95.map((v) => v.toFixed(4)).join(', ')}] p=${f.aFirstOfDecided.pVsHalf.toExponential(2)}  a−b med ${f.times.diffMedian.toFixed(3)} ms  A更快 ${f.times.aFasterFraction.toFixed(4)}`
    );
  }
}

main();
