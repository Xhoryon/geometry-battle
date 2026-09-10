#!/usr/bin/env node
/**
 * 本地自检 CLI（V1.1 Competitor Kit §11）
 *
 *     npx ts-node src/operator/validate-submission.ts ./my-algorithm
 *     npx ts-node src/operator/validate-submission.ts ./my-algorithm --team A
 *
 * 参赛者的正式入口是 `competitor-kit/tools/validate_submission.py`（同一条路径的
 * Python 前端）。本文件只负责把 `validateSubmission()` 的分节报告打到终端。
 *
 * 退出码：0 = 全部 PASS/SKIP；1 = 至少一项 FAIL；2 = 用法错误。
 *
 * ⚠️ 判定规则**不在这里** —— 全部来自生产模块（见 `LocalPreflight.ts` 顶部注释）。
 * 这里只做排版，禁止在本文件里添加任何判定逻辑。
 */

import * as path from 'path';
import { CHECK_SECTIONS, assertDirectory, summarize, validateSubmission } from '../submission/LocalPreflight';

function usage(): never {
  process.stderr.write(
    [
      '用法: npx ts-node src/operator/validate-submission.ts <算法目录> [选项]',
      '',
      '选项:',
      '  --team A|B|both   只自检某一队（默认 both：A、B 各跑一次）',
      '  --timeout <ms>    单轮超时（默认 2000，与正式比赛一致）',
      '  --json            以 JSON 输出完整报告',
      '',
    ].join('\n')
  );
  process.exit(2);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) usage();

  let teams: Array<'A' | 'B'> = ['A', 'B'];
  let timeoutMs: number | undefined;
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--team') {
      const v = (argv[++i] ?? '').toUpperCase();
      if (v === 'A') teams = ['A'];
      else if (v === 'B') teams = ['B'];
      else if (v === 'BOTH') teams = ['A', 'B'];
      else usage();
    } else if (a === '--timeout') {
      timeoutMs = Number(argv[++i]);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) usage();
    } else if (a === '--json') {
      asJson = true;
    } else if (a.startsWith('--')) {
      usage();
    }
  }

  try {
    assertDirectory(target);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  const report = await validateSubmission(target, { teams, timeoutMs });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  const abs = path.resolve(target);
  process.stdout.write(`\nGeometry Battle V1.1 — 本地自检\n`);
  process.stdout.write(`算法目录: ${abs}\n`);
  process.stdout.write(
    `decoy 世界: seed=${report.world.seed}（地图种子 ${report.world.mapSeed}，` +
      `${report.world.points} 点 / ${report.world.obstacles} 障碍物）\n`
  );
  process.stdout.write(`包哈希: ${report.inspection.hash ?? '(不可用)'}\n\n`);
  process.stdout.write(`${summarize(report)}\n`);

  const failed = report.teams.flatMap((t) =>
    t.checks.filter((c) => c.status === 'FAIL').map((c) => `${t.team}/${c.section}`)
  );
  if (report.ok) {
    process.stdout.write(
      `\nPRE-FLIGHT PASS — ${report.teams.length} 个队别 × ${CHECK_SECTIONS.length} 个分节全部通过\n`
    );
    return 0;
  }
  process.stdout.write(`\nPRE-FLIGHT FAIL — 失败分节: ${failed.join(', ')}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`自检异常: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(2);
  });
