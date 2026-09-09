/**
 * 固定 Runtime —— 双方运行环境完全相同的可核对声明（V1.1 §5）
 *
 * 规范 §5 要求正式版本冻结：
 *
 *     Python version / allowed packages / NumPy / SciPy / SymPy /
 *     CPU quota / memory quota / thread limit
 *
 * 冻结不是「写在文档里」就算数：本模块同时提供 `detectRuntime()`，
 * 在宿主上实际探测解释器与包版本，供启动时核对并把结果写进审计日志。
 * 探测失败**不会**让比赛无法进行（选手机器上可能没有 numpy），
 * 但会让核对结果变成 MISMATCH —— 这正是需要人工介入的信号。
 *
 * 双方环境相同由三件事共同保证：
 *   1. 同一个解释器（`/usr/bin/python3`，沙箱 argv 固定，规范 §6）；
 *   2. 同一份 scrubbed 环境变量（`SandboxRunner.scrubEnv`）；
 *   3. 线程数被钉死为 1（`OMP_NUM_THREADS` 等），避免多线程 BLAS 把
 *      「谁的机器核多」变成计时优势。
 */

import { execFileSync } from 'child_process';
import { COMPUTE_TIMEOUT_MS, MEMORY_LIMIT_MB } from '../core/Rules';

/** 平台固定使用的解释器（规范 §6 的 `python3`） */
export const PYTHON_BIN = '/usr/bin/python3';

export interface FrozenPackage {
  name: string;
  /** 冻结版本；null 表示**不允许**使用该包 */
  version: string | null;
}

export interface FrozenRuntime {
  implementation: string;
  python: string;
  platform: string;
  packages: FrozenPackage[];
  /** CPU 配额（核数） */
  cpuQuota: number;
  /** 内存配额（MB，RLIMIT_AS + 宿主侧 RSS 监控） */
  memoryLimitMb: number;
  /** 线程上限（BLAS/OpenMP 全部钉死为 1） */
  threadLimit: number;
  /** 单方计算超时（ms） */
  timeoutMs: number;
  /** stdout / stderr 上限（字节） */
  stdoutCapBytes: number;
  stderrCapBytes: number;
}

/** 正式冻结的 Runtime（规范 §5）—— 修改此常量即为修改比赛规则 */
export const FROZEN_RUNTIME: FrozenRuntime = {
  implementation: 'CPython',
  python: '3.9.6',
  platform: 'darwin',
  packages: [
    { name: 'numpy', version: '2.0.2' },
    { name: 'scipy', version: '1.13.1' },
    { name: 'sympy', version: null },
  ],
  cpuQuota: 1,
  memoryLimitMb: MEMORY_LIMIT_MB,
  threadLimit: 1,
  timeoutMs: COMPUTE_TIMEOUT_MS,
  stdoutCapBytes: 256 * 1024,
  stderrCapBytes: 64 * 1024,
};

/** 线程数被钉死为 1 的环境变量（scrubEnv 注入） */
export const THREAD_ENV: Record<string, string> = {
  OMP_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
  MKL_NUM_THREADS: '1',
  NUMEXPR_NUM_THREADS: '1',
  VECLIB_MAXIMUM_THREADS: '1',
};

export interface DetectedRuntime {
  python: string | null;
  implementation: string | null;
  platform: string | null;
  packages: Record<string, string | null>;
  /** 探测本身是否成功（解释器不可用时为 false） */
  probed: boolean;
}

const PROBE_SOURCE = `import json, platform, sys
d = {
    "python": sys.version.split()[0],
    "implementation": platform.python_implementation(),
    "platform": sys.platform,
    "packages": {},
}
for name in ("numpy", "scipy", "sympy"):
    try:
        d["packages"][name] = __import__(name).__version__
    except Exception:
        d["packages"][name] = None
print(json.dumps(d))
`;

/** 探测宿主实际 Runtime（只读，不改环境） */
export function detectRuntime(pythonBin: string = PYTHON_BIN): DetectedRuntime {
  try {
    const out = execFileSync(pythonBin, ['-c', PROBE_SOURCE], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out.trim());
    return {
      python: typeof parsed.python === 'string' ? parsed.python : null,
      implementation: typeof parsed.implementation === 'string' ? parsed.implementation : null,
      platform: typeof parsed.platform === 'string' ? parsed.platform : null,
      packages: parsed.packages ?? {},
      probed: true,
    };
  } catch {
    return { python: null, implementation: null, platform: null, packages: {}, probed: false };
  }
}

export interface RuntimeCheck {
  ok: boolean;
  detected: DetectedRuntime;
  /** 与冻结清单的差异（人类可读） */
  mismatches: string[];
}

/** 把实际 Runtime 与冻结清单逐项比对 */
export function checkRuntime(
  frozen: FrozenRuntime = FROZEN_RUNTIME,
  detected: DetectedRuntime = detectRuntime()
): RuntimeCheck {
  const mismatches: string[] = [];
  if (!detected.probed) {
    mismatches.push(`无法探测 ${PYTHON_BIN}（冻结清单要求 ${frozen.implementation} ${frozen.python}）`);
    return { ok: false, detected, mismatches };
  }

  if (detected.python !== frozen.python) {
    mismatches.push(`Python 版本不符：冻结 ${frozen.python}，实际 ${detected.python ?? '未知'}`);
  }
  if (detected.implementation !== frozen.implementation) {
    mismatches.push(`解释器实现不符：冻结 ${frozen.implementation}，实际 ${detected.implementation ?? '未知'}`);
  }
  for (const pkg of frozen.packages) {
    const actual = detected.packages[pkg.name] ?? null;
    if (pkg.version === null) {
      if (actual !== null) mismatches.push(`${pkg.name} 不在冻结清单内，但实际存在版本 ${actual}`);
      continue;
    }
    if (actual !== pkg.version) {
      mismatches.push(`${pkg.name} 版本不符：冻结 ${pkg.version}，实际 ${actual ?? '未安装'}`);
    }
  }
  return { ok: mismatches.length === 0, detected, mismatches };
}

/** 一行式摘要（CLI / 审计共用） */
export function describeRuntime(frozen: FrozenRuntime = FROZEN_RUNTIME): string {
  const pkgs = frozen.packages
    .map((p) => `${p.name}${p.version === null ? '=禁用' : `==${p.version}`}`)
    .join(' ');
  return (
    `${frozen.implementation} ${frozen.python} (${frozen.platform}) | ${pkgs} | ` +
    `cpu=${frozen.cpuQuota}核 mem=${frozen.memoryLimitMb}MB threads=${frozen.threadLimit} ` +
    `timeout=${frozen.timeoutMs}ms`
  );
}
