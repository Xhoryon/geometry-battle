#!/usr/bin/env node
/**
 * competitor-kit/examples 生成器（V1.1 Competitor Kit §10）
 *
 *     npx ts-node src/operator/generate-kit-examples.ts
 *
 * 产物（三份，全部由**真实引擎**产出）：
 *
 *     competitor-kit/examples/public_state.json
 *     competitor-kit/examples/reveal_state.json
 *     competitor-kit/examples/result.json
 *
 * 为什么需要这个脚本
 * ------------------
 * 例子必须是「真货」：字段名、数值格式、单行紧凑 JSON、`alive` 死点语义……
 * 任何手写的示例都会随实现漂移。这里的做法是**先真跑一轮**，再证明产物与
 * 引擎实际下发的字节一致：
 *
 *   1. 用 `MatchEngine` 打完一轮（双方都用平台官方 starter）；
 *   2. 用公开的 `buildPublicState()` / `buildRevealState()` 重算这一轮的输入；
 *   3. **断言重算出的 sha256 与 `RoundLog.publicStateHash` / `revealStateHash` 相等** ——
 *      这是「重算 == 引擎实际下发」的硬证据，而不是自我声明；
 *   4. 把这三份字节写进 competitor-kit/examples/。
 *
 * `result.json` 由官方 starter 在**真实沙箱**里对这份输入跑出来。
 * `tests/competitor-kit.ts` 会重新生成并逐字节比对，防止漂移。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCanonicalDSL } from '../core/Ast';
import { buildPublicState, buildRevealState } from '../core/InputProtocol';
import { MatchEngine, PLATFORM_ROOT } from '../core/Match';
import { firingDomain } from '../core/Rules';
import { validateAttackFunction } from '../core/Validator';
import { ENTRY_FILENAME } from '../submission/Manifest';
import { inspectPackage } from '../submission/Package';
import { parseResultFile, prepareSandbox, spawnRunner, cleanupSandbox, defaultSandboxRoot } from '../runner';

/** 例子世界：固定种子 → 可复现 → 可做防漂移比对 */
export const KIT_EXAMPLE_SEED = 424242;
export const KIT_EXAMPLE_MATCH_ID = 'KIT-EXAMPLES';
export const KIT_EXAMPLE_POINT_COUNT = 8;
export const KIT_EXAMPLE_DIFFICULTY = 'medium' as const;

export interface KitExamples {
  publicJson: string;
  revealJson: string;
  resultJson: string;
  /** 引擎实际记录的哈希（用于自证） */
  publicStateHash: string;
  revealStateHash: string;
}

export function kitExamplesDir(): string {
  return path.join(PLATFORM_ROOT, 'competitor-kit', 'examples');
}

/**
 * 生成三份例子字节。可被 CLI 与测试同时调用（同一份代码 → 不会各写一套）。
 */
export async function generateKitExamples(workRoot: string): Promise<KitExamples> {
  const starterDir = path.join(PLATFORM_ROOT, 'starter');
  const starter = inspectPackage(starterDir);
  if (!starter.valid) throw new Error(`平台 starter 不可用: ${starter.errors.join('; ')}`);

  const engine = new MatchEngine({
    matchId: KIT_EXAMPLE_MATCH_ID,
    seed: KIT_EXAMPLE_SEED,
    pointCount: KIT_EXAMPLE_POINT_COUNT,
    difficulty: KIT_EXAMPLE_DIFFICULTY,
    artifactRoot: path.join(workRoot, 'artifacts'),
    sandboxRoot: path.join(workRoot, 'sandboxes'),
  });

  for (const team of ['A', 'B'] as const) {
    const up = engine.upload(team, starterDir);
    if (!up.ok) throw new Error(`上传 ${team} 失败: ${up.errors.join('; ')}`);
  }
  const pre = await engine.preflight();
  if (!pre.ok) throw new Error(`Preflight 失败: ${pre.errors.join('; ')}`);
  const started = engine.startMatch();
  if (!started.ok) throw new Error(`开始比赛失败: ${started.errors.join('; ')}`);

  // 人工选点：双方各选自己的第一个存活点（与操作台行为一致）
  const snap0 = engine.getSnapshot();
  for (const team of ['A', 'B'] as const) {
    const pick = snap0.points.find((p) => p.team === team && p.alive);
    if (!pick) throw new Error(`${team} 没有可用点`);
    const sel = engine.selectShooter(team, pick.id);
    if (!sel.ok) throw new Error(`选择 Shooter 失败: ${sel.error}`);
    const lock = engine.lockShooter(team);
    if (!lock.ok) throw new Error(`锁定失败: ${lock.error}`);
  }

  // 锁定之后、START 之前的快照 = 本轮输入的真实来源
  const snap = engine.getSnapshot();
  const judge = engine.judgeStartRound();
  if (!judge.ok) throw new Error(`START ROUND 失败: ${judge.error}`);
  const round = await engine.runRound();

  // ---- 用公开协议重算本轮输入 ----
  const points = snap.points.map((p) => ({
    id: p.id,
    team: p.team,
    x: p.position.x,
    y: p.position.y,
    alive: p.alive,
  }));
  const publicState = buildPublicState({ matchId: KIT_EXAMPLE_MATCH_ID, round: 1, points });
  const revealState = buildRevealState({
    matchId: KIT_EXAMPLE_MATCH_ID,
    round: 1,
    publicStateSha256: publicState.sha256,
    shooters: { A: snap.shooters.A!.id, B: snap.shooters.B!.id },
    obstacles: snap.map!.obstacles,
  });

  // ---- 硬证据：重算的哈希必须等于引擎实际记录 ----
  if (publicState.sha256 !== round.log.publicStateHash) {
    throw new Error(
      `public_state 重算与引擎不一致: ${publicState.sha256} != ${round.log.publicStateHash}`
    );
  }
  if (revealState.sha256 !== round.log.revealStateHash) {
    throw new Error(
      `reveal_state 重算与引擎不一致: ${revealState.sha256} != ${round.log.revealStateHash}`
    );
  }

  // ---- result.json：官方 starter 在真实沙箱里对这份输入跑出来 ----
  const team: 'A' | 'B' = 'A';
  const sandbox = prepareSandbox({
    sandboxRoot: path.join(workRoot, 'sandboxes'),
    matchId: `${KIT_EXAMPLE_MATCH_ID}-examples`,
    roundNumber: 1,
    team,
    packageDir: starterDir,
    entry: ENTRY_FILENAME,
    input: { publicJson: publicState.json, revealJson: revealState.json },
    memoryLimitMb: 512,
    denyReadPaths: [PLATFORM_ROOT],
  });
  let resultJson: string;
  try {
    const runner = spawnRunner({ team, sandbox, timeoutMs: 2000, memoryLimitMb: 512 });
    await runner.ready;
    runner.release();
    const outcome = await runner.done;
    if (!outcome.success || !outcome.resultJson) {
      throw new Error(`官方 starter 未能产出结果: ${outcome.error ?? outcome.errorCode}`);
    }
    resultJson = outcome.resultJson;

    // 例子必须能通过**当前** Validator（§10）
    const parsed = parseResultFile(resultJson);
    if (!parsed.ok) throw new Error(`例子 result.json 不合法: ${parsed.error}`);
    const dsl = parseCanonicalDSL(parsed.dslText);
    if (!dsl.ok || !dsl.ast) {
      throw new Error(`例子 DSL 不合法: ${dsl.issues.map((i) => i.code).join(',')}`);
    }
    const shooter = points.find((p) => p.id === snap.shooters[team]!.id)!;
    const legality = validateAttackFunction(
      dsl.ast,
      firingDomain(shooter.x, team),
      { x: shooter.x, y: shooter.y }
    );
    if (!legality.valid) {
      throw new Error(`例子函数不合法: ${legality.issues.map((i) => i.code).join(',')}`);
    }
  } finally {
    cleanupSandbox(sandbox.dir);
  }

  return {
    publicJson: publicState.json,
    revealJson: revealState.json,
    resultJson,
    publicStateHash: publicState.sha256,
    revealStateHash: revealState.sha256,
  };
}

export function writeKitExamples(dir: string, ex: KitExamples): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ['public_state.json', ex.publicJson],
    ['reveal_state.json', ex.revealJson],
    ['result.json', ex.resultJson],
  ];
  for (const [name, content] of files) {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
  return files.map(([name]) => path.join(dir, name));
}

async function main(): Promise<number> {
  const workRoot = fs.mkdtempSync(path.join(defaultSandboxRoot(), 'kit-examples-'));
  const ex = await generateKitExamples(workRoot);
  const dir = kitExamplesDir();
  const written = writeKitExamples(dir, ex);
  process.stdout.write(`已生成 ${written.length} 个文件:\n`);
  for (const f of written) {
    process.stdout.write(`  ${path.relative(PLATFORM_ROOT, f)}  (${Buffer.byteLength(fs.readFileSync(f))} B)\n`);
  }
  process.stdout.write(
    `public_state sha256 = ${ex.publicStateHash}\nreveal_state sha256 = ${ex.revealStateHash}\n`
  );
  fs.rmSync(workRoot, { recursive: true, force: true });
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`生成失败: ${(e as Error).stack ?? String(e)}\n`);
      process.exit(1);
    });
}
