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
import { RESULT_FILENAME, RunnerInput } from '../src/runner/SandboxRunner';
import { tmpDir } from './harness';

/**
 * 内联 solver 的公共前奏：四个固定参数（规范 §6）。
 *
 * 测试里的探针算法统一用它替代手写的 argparse 块，避免契约漂移 ——
 * 一旦启动契约变化，所有探针一起变，而不是逐个漏改。
 */
export const PY_ARGV_PRELUDE = `import argparse, json, os, sys
ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True)
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
ap.add_argument("--output", required=True)
args = ap.parse_args()
`;

/** 内联 solver 的正式输出片段：只写 result.json（tmp + 原子 rename，规范 §25/§27）。 */
export const PY_EMIT = `def emit(dsl):
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"schema_version": "1.1", "dsl": dsl}, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, args.output)
`;

/**
 * 探针算法把诊断报告写在 **stderr** 的一行标记里。
 *
 * 为什么不是 stdout：V1.1 起 stdout 明确不是 IPC 通道（规范 §24），
 * 而且 result.json 里多一个键就会被判非法（规范 §26）。
 * stderr 是规范 §30 允许的「有限 debug log」，正好承载探针报告。
 */
export const PROBE_REPORT_PREFIX = 'GBREPORT:';

/** 从 stderr 中取回探针报告（取最后一条标记行）。 */
export function probeReport(stderr: string): Record<string, string> {
  const lines = stderr.split('\n').filter((l) => l.startsWith(PROBE_REPORT_PREFIX));
  const last = lines[lines.length - 1];
  if (!last) return {};
  try {
    return JSON.parse(last.slice(PROBE_REPORT_PREFIX.length));
  } catch {
    return {};
  }
}

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
    obstacles: core.obstacles,
  });

  return { publicJson: publicState.json, revealJson: revealState.json };
}

/**
 * 以 V1.1 契约**直接**跑一个算法入口（不经沙箱、不经 bootstrap）。
 *
 * 用于契约类断言（starter / DSL 契约）：这些用例关心的是「算法读到什么、
 * 写出什么」，而不是隔离。沙箱路径由 runner-isolation 等套件覆盖。
 *
 * 返回值是 `output/result.json` 的**确切字节**（规范 §24：结果只经该文件传递）；
 * stdout 只是附带物，不参与判定。
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
  const outputDir = path.join(dir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const resultPath = path.join(outputDir, RESULT_FILENAME);
  fs.writeFileSync(publicPath, input.publicJson);
  fs.writeFileSync(revealPath, input.revealJson);
  execFileSync(
    'python3',
    [
      entry,
      '--team', team,
      '--public', publicPath,
      '--reveal', revealPath,
      '--output', resultPath,
    ],
    { encoding: 'utf8' }
  );
  return fs.readFileSync(resultPath, 'utf8');
}
