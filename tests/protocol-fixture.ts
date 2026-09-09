/**
 * 测试用 V1.1 输入构造器
 *
 * 生产路径是 `MatchEngine.buildRunnerInput()`（从引擎状态构造）；本文件服务于
 * 那些**直接驱动 `runDuel` / `spawnRunner`** 的套件（隔离、超时、进程清理、
 * 公平性等），它们手里只有一个手工搭的 `RoundStateCore`。
 *
 * 语义与生产严格一致：
 *   - 同一份字节交给双方（规范 §11）；
 *   - 队别不经 JSON 传递（规范 §12）；
 *   - `buildPublicState` / `buildRevealState` 都是生产模块本身，测试不另写一套序列化。
 *
 * `RoundStateCore.points` 只含存活点，因此这里全部 `alive: true`。
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PublicStatePoint, buildPublicState, buildRevealState } from '../src/core/InputProtocol';
import { RoundStateCore } from '../src/core/RoundState';
import { RunnerInput } from '../src/runner/SandboxRunner';
import { tmpDir } from './harness';

export function runnerInputFromCore(core: RoundStateCore, matchId = 'M-TEST'): RunnerInput {
  const points: PublicStatePoint[] = core.points.map((p) => ({
    id: p.id,
    team: p.team,
    x: p.position.x,
    y: p.position.y,
    alive: true,
  }));

  const publicState = buildPublicState({ matchId, round: core.round, points });
  const revealState = buildRevealState({
    matchId,
    round: core.round,
    publicStateSha256: publicState.sha256,
    shooters: { A: core.shooters.A.id, B: core.shooters.B.id },
    obstacles: core.obstacles,
  });

  return { publicJson: publicState.json, revealJson: revealState.json };
}

/**
 * 以 V1.1 契约**直接**跑一个算法入口（不经沙箱、不经 bootstrap）。
 *
 * 用于契约类断言（starter / DSL 契约）：这些用例关心的是「算法读到什么、
 * 写出什么」，而不是隔离。沙箱路径由 runner-isolation 等套件覆盖。
 */
export function runSolver(
  entry: string,
  team: 'A' | 'B',
  input: RunnerInput,
  workDir?: string
): string {
  const dir = workDir ?? tmpDir('solver');
  const publicPath = path.join(dir, 'public_state.json');
  const revealPath = path.join(dir, 'reveal_state.json');
  fs.writeFileSync(publicPath, input.publicJson);
  fs.writeFileSync(revealPath, input.revealJson);
  return execFileSync(
    'python3',
    [entry, '--team', team, '--public', publicPath, '--reveal', revealPath],
    { encoding: 'utf8' }
  );
}
