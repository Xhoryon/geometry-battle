/**
 * Algorithm Runner - Isolated Sandbox Runner
 * Plan 2 Phase A: Isolated execution, timeout, crash handling
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { ASTNode, parseDSL } from '../function/DSL';

export interface RoundStateForRunner {
  round: number;
  teamId: 'A' | 'B';
  shooters: {
    id: string;
    position: { x: number; y: number };
  }[];
  enemies: {
    id: string;
    position: { x: number; y: number };
  }[];
  obstacles: {
    type: string;
    [key: string]: any;
  }[];
  teamAXRange: [number, number];
  teamBXRange: [number, number];
}

export interface RunnerResult {
  success: boolean;
  dsl: string | null;
  computeTimeMs: number;
  error: string | null;
  errorCode: 'TIMEOUT' | 'CRASH' | 'INVALID_OUTPUT' | 'INVALID_DSL' | null;
}

export interface RunnerConfig {
  timeoutMs: number;
  memoryLimitMb: number;
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  timeoutMs: 2000,
  memoryLimitMb: 512,
};

/**
 * 运行 Algorithm 并返回 DSL 输出
 */
export async function runAlgorithm(
  packagePath: string,
  entry: string,
  roundState: RoundStateForRunner,
  config: RunnerConfig = DEFAULT_RUNNER_CONFIG
): Promise<RunnerResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // 构建输入 JSON
    const inputJson = JSON.stringify({
      round: roundState.round,
      team_id: roundState.teamId,
      shooters: roundState.shooters,
      enemies: roundState.enemies,
      obstacles: roundState.obstacles,
      team_a_x_range: roundState.teamAXRange,
      team_b_x_range: roundState.teamBXRange,
    });

    // 启动 Python 进程
    const pyEnv = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
    };

    const proc: ChildProcess = spawn('python3', [path.join(packagePath, entry)], {
      cwd: packagePath,
      env: pyEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // 设置超时
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      resolve({
        success: false,
        dsl: null,
        computeTimeMs: config.timeoutMs,
        error: `Algorithm timeout after ${config.timeoutMs}ms`,
        errorCode: 'TIMEOUT',
      });
    }, config.timeoutMs);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeoutId);
      const computeTimeMs = Date.now() - startTime;

      if (killed) return;

      if (code !== 0) {
        resolve({
          success: false,
          dsl: null,
          computeTimeMs,
          error: `Algorithm crashed with code ${code}: ${stderr}`,
          errorCode: 'CRASH',
        });
        return;
      }

      // 解析输出
      try {
        const output = JSON.parse(stdout.trim());

        // 提取 DSL
        const dsl = output.dsl || output.function || output.f || null;

        if (!dsl) {
          resolve({
            success: false,
            dsl: null,
            computeTimeMs,
            error: 'Algorithm output missing DSL field',
            errorCode: 'INVALID_OUTPUT',
          });
          return;
        }

        // 验证 DSL
        const validation = parseDSL(dsl);
        if (!validation.valid) {
          resolve({
            success: false,
            dsl,
            computeTimeMs,
            error: `Invalid DSL: ${validation.errors.join(', ')}`,
            errorCode: 'INVALID_DSL',
          });
          return;
        }

        resolve({
          success: true,
          dsl,
          computeTimeMs,
          error: null,
          errorCode: null,
        });
      } catch (e) {
        resolve({
          success: false,
          dsl: stdout.trim() || null,
          computeTimeMs,
          error: `Failed to parse algorithm output: ${e}`,
          errorCode: 'INVALID_OUTPUT',
        });
      }
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        dsl: null,
        computeTimeMs: Date.now() - startTime,
        error: `Failed to spawn process: ${err.message}`,
        errorCode: 'CRASH',
      });
    });

    // 发送输入
    proc.stdin?.write(inputJson);
    proc.stdin?.end();
  });
}

/**
 * 销毁 Runner（清理资源）
 */
export function destroyRunner(proc: ChildProcess): void {
  if (!proc.killed) {
    proc.kill('SIGKILL');
  }
}
