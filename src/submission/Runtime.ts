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
 * 探测失败**不会**让比赛无法进行，但会让核对结果变成 MISMATCH ——
 * 这正是需要人工介入的信号。
 *
 * 注意探测范围：`detectRuntime()` 看到的是**宿主**，而参赛代码运行在**沙箱**内。
 * 两者在第三方包上并不等价（见 `FROZEN_RUNTIME.packages` 的注释），
 * 因此包级事实以 `competitor-kit/RUNTIME_MANIFEST.md` + `tests/runtime-manifest.ts` 为准。
 *
 * 双方环境相同由三件事共同保证：
 *   1. 同一个解释器（`/usr/bin/python3`，沙箱 argv 固定，规范 §6）；
 *   2. 同一份 scrubbed 环境变量（`SandboxRunner.scrubEnv`）；
 *   3. BLAS/OpenMP 库的线程数被钉死为 1（`OMP_NUM_THREADS` 等），避免多线程
 *      数值计算库把「谁的机器核多」变成计时优势。
 *
 * F6: cpuQuota / threadLimit 的真实语义（Gate 0.5 修正）
 * - cpuQuota=1: 单一参赛进程 + BLAS/OpenMP 并行度限制为 1，**非** OS 级单核绑定
 * - threadLimit=1: BLAS/OpenMP 库被环境变量约束为 1 线程，**非**禁止所有线程创建
 * - Python threading.Thread 可以创建，但无计时优势（500ms wall-time deadline）
 * - 无 OS-level CPU affinity / cgroup quota / 物理单核 pinning
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

/**
 * 正式冻结的 Runtime（规范 §5）—— 修改此常量即为修改比赛规则
 *
 * ⚠️ `packages` 为**空**：正式沙箱内没有任何第三方包（V1.1 Competitor Kit §4）。
 * 早期版本在这里写了 `numpy 2.0.2` / `scipy 1.13.1`，那是**宿主**上探测到的版本，
 * 不是沙箱内的事实 —— 沙箱 `scrubEnv` 设置 `PYTHONNOUSERSITE=1` 且拒绝读取
 * `/Users`，因此用户级 site-packages 里的 numpy/scipy 在沙箱内**不可 import**。
 * 把宿主观测写进冻结清单，会让参赛者据此写出必然 `ModuleNotFoundError` 的算法。
 *
 * 沙箱内可用模块的**唯一权威清单**是 `competitor-kit/RUNTIME_MANIFEST.md`，
 * 由 `tests/runtime-manifest.ts` 在真实沙箱里逐条验证。
 *
 * F6 修正（Gate 0.5）：
 * - cpuQuota: 单一进程 + BLAS/OpenMP=1，非 OS 级单核
 * - threadLimit: BLAS/OpenMP 约束，非禁止所有线程
 */
export const FROZEN_RUNTIME: FrozenRuntime = {
  implementation: 'CPython',
  python: '3.9.6',
  platform: 'darwin',
  /** Third-party packages: NONE（stdlib only） */
  packages: [],
  /** Single contestant process + BLAS/OpenMP parallelism=1 (not OS-level core pinning) */
  cpuQuota: 1,
  memoryLimitMb: MEMORY_LIMIT_MB,
  /** BLAS/OpenMP constrained to 1 thread (Python threading available but no advantage) */
  threadLimit: 1,
  timeoutMs: COMPUTE_TIMEOUT_MS,
  stdoutCapBytes: 256 * 1024,
  stderrCapBytes: 64 * 1024,
};

/**
 * BLAS/OpenMP 线程数被钉为 1 的环境变量（scrubEnv 注入）
 *
 * F6 说明：这些变量约束 BLAS 库（OpenBLAS/MKL/Accelerate）和 OpenMP 的
 * 并行度，防止多线程数值计算成为竞争优势。它们**不**阻止 Python threading.Thread
 * 的创建，但由于 500ms wall-time deadline，多线程无计时优势。
 */
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
  const pkgs = frozen.packages.length === 0
    ? '第三方包: NONE'
    : frozen.packages
        .map((p) => `${p.name}${p.version === null ? '=禁用' : `==${p.version}`}`)
        .join(' ');
  return (
    `${frozen.implementation} ${frozen.python} (${frozen.platform}) | ${pkgs} | ` +
    `cpu=${frozen.cpuQuota}核 mem=${frozen.memoryLimitMb}MB threads=${frozen.threadLimit} ` +
    `timeout=${frozen.timeoutMs}ms`
  );
}
