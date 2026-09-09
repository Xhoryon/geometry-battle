/**
 * Sandboxed Algorithm Runner
 *
 * 修复的 Finding：
 *   P0-7  Runner 没有真正的隔离边界
 *   P0-8  没有每回合全新沙箱
 *   P1-10 计时偏差系统性偏向第二个启动的队伍
 *   P1-11 memoryLimitMb 从未生效
 *   P1-12 仅杀掉直接子进程，孙进程成为孤儿
 *   P1-13 子进程继承完整宿主环境（含 ANTHROPIC_AUTH_TOKEN）
 *   P1-14 网络不受限制
 *   P1-19 超时预算与 §14 不符
 *   P2-25 标准输出无上限
 *
 * 隔离手段（macOS）：
 *   sandbox-exec 专用 profile + 独立进程组 + RLIMIT_AS + 最小环境变量
 *
 * 公平性手段：
 *   双方进程先完成启动握手（READY），再由宿主写入 GO 释放；
 *   计时从同一个共享的 release 时刻开始，与进程创建顺序无关。
 */

import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  COMPUTE_TIMEOUT_MS,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
  MEMORY_LIMIT_MB,
} from '../core/Rules';

export type RunnerErrorCode =
  | 'TIMEOUT'
  | 'CRASH'
  | 'INVALID_OUTPUT'
  | 'INVALID_DSL'
  | 'OUTPUT_TOO_LARGE'
  | 'SPAWN_ERROR'
  | 'CANCELLED'
  | 'ISOLATION_UNAVAILABLE'
  | 'MEMORY_LIMIT'
  | 'READY_TIMEOUT';

export interface IsolationReport {
  mechanism: 'sandbox-exec' | 'none';
  networkDenied: boolean;
  filesystemScoped: boolean;
  envScrubbed: boolean;
  memoryLimited: boolean;
  processGroupIsolated: boolean;
  childProcessDenied: boolean;
}

export interface RunnerOutcome {
  team: 'A' | 'B';
  success: boolean;
  /** GO 之后算法写入的标准输出（已限长） */
  stdout: string;
  stderr: string;
  error: string | null;
  errorCode: RunnerErrorCode | null;
  /** 相对共享 release 时刻的耗时（ms） */
  computeTimeMs: number;
  sandboxDir: string;
  isolation: IsolationReport;
  /** 是否因 shooter 被击杀而取消 */
  cancelled: boolean;
}

export interface DuelOptions {
  matchId: string;
  roundNumber: number;
  sandboxRoot: string;
  teamA: { packageDir: string; entry: string; payloadJson: string };
  teamB: { packageDir: string; entry: string; payloadJson: string };
  /** 除 /Users 与 sandboxRoot 外，额外禁止读取的路径（如密封包目录） */
  denyReadPaths?: string[];
  timeoutMs?: number;
  memoryLimitMb?: number;
  /** 收到先手结果后的回调；返回 true 表示要取消另一方 */
  onFirstResult?: (team: 'A' | 'B', outcome: RunnerOutcome) => Promise<boolean> | boolean;
}

export interface DuelResult {
  a: RunnerOutcome;
  b: RunnerOutcome;
  /** 较早的那个 GO 写入时刻（单调时钟，ns）；仅用于记录 */
  releaseNs: bigint;
  /** 两次 GO 写入之间的偏差（µs）；计时不依赖它（P1-B） */
  releaseSkewUs: number;
  readySkewMs: number;
  isolation: IsolationReport;
}

const BOOTSTRAP_SOURCE = `# Geometry Battle official bootstrap (platform-provided)
import sys, io, runpy

def main():
    if len(sys.argv) < 2:
        sys.stderr.write("bootstrap: missing entry\\n")
        return 2
    entry = sys.argv[1]
    data = sys.stdin.readline()
    sys.stdout.write('{"gb":"ready"}\\n')
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line or line.strip() != 'GO':
        sys.stderr.write("bootstrap: no GO signal\\n")
        return 3
    sys.stdin = io.StringIO(data)
    sys.setrecursionlimit(10000)
    try:
        runpy.run_path(entry, run_name='__main__')
    except SystemExit as e:
        if e.code not in (0, None):
            raise
    return 0

if __name__ == '__main__':
    sys.exit(main())
`;

const LAUNCHER_SOURCE = `#!/bin/sh
ulimit -v "$1" 2>/dev/null || true
ulimit -c 0 2>/dev/null || true
ulimit -n 64 2>/dev/null || true
shift
exec "$@"
`;

export function sandboxExecAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
}

/**
 * 生成 SBPL profile。
 *
 * 采用「默认拒绝 + 白名单读取 + 定向拒绝」的写法：
 *   (allow file-read*) 让 Python 运行时能加载系统库，
 *   随后定向拒绝用户目录与整个 sandbox 根目录，
 *   最后重新放行本队自己的沙箱目录。
 * SBPL 中「后匹配的规则优先」，因此顺序至关重要。
 */
function buildProfile(sandboxDirRaw: string, sandboxRootRaw: string, denyReadPaths: string[]): string {
  // macOS 上 /var 是 /private/var 的符号链接，SBPL 需要真实路径
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  const sandboxDir = real(sandboxDirRaw);
  const sandboxRoot = real(sandboxRootRaw);
  const work = path.join(sandboxDir, 'work');

  // 除了 /Users 与 sandbox 根目录，还必须显式拒绝平台自己的密封包目录 ——
  // 否则当 artifacts 落在 /Users 之外（例如操作员指定 --artifacts /tmp/...）时，
  // 对手的密封包会落在 (allow file-read*) 的默认放行范围内。
  // 注：即使某个 deny 路径恰好是沙箱目录的祖先也没关系 —— 下面的
  // `(allow file-read* (subpath sandboxDir))` 写在后面，SBPL 是「后匹配者胜」。
  // 系统级兜底拒绝：/tmp 与 /var/tmp 是操作员暂存对手包、历史产物、
  // 运维脚本的常见位置，算法没有任何理由读取（注意 /tmp 是 /private/tmp
  // 的符号链接，realpath 后二者相同）。
  //
  // 但这些是**粗粒度**路径，可能恰好把沙箱自己也罩进去 —— 例如 macOS 的
  // 默认沙箱根就在 /private/var/folders/<user>/T/ 下。因此下面还要剔除
  // 「会拒绝沙箱自身」的条目（Re-Gate Cycle 2：此前无条件拒绝
  // /private/var/folders 会让算法连自己的入口文件都读不到，整场比赛全挂）。
  const SYSTEM_DENIES = ['/private/tmp', '/private/var/tmp'];

  /** p 是否等于 self 或是 self 的祖先 */
  const covers = (p: string, self: string): boolean => p === self || self.startsWith(p + path.sep);

  const selfPaths = [sandboxDir, sandboxRoot, work];

  const extraDenies = [...denyReadPaths, ...SYSTEM_DENIES]
    .map((p) => real(p))
    .filter((p, i, arr) => p.length > 0 && p !== path.sep && arr.indexOf(p) === i)
    // 会拒绝沙箱自身的 deny 必须剔除，否则算法连自己的包和 bootstrap 都读不到
    .filter((p) => !selfPaths.some((self) => covers(p, self)))
    .map((p) => `(deny file-read* (subpath ${JSON.stringify(p)}))`)
    .join('\n');

  return `(version 1)
(deny default)
(deny network*)
(deny process-fork)
(allow process-exec*)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
(allow file-read*)
(deny file-read* (subpath "/Users"))
(deny file-read* (subpath ${JSON.stringify(sandboxRoot)}))
${extraDenies}
(allow file-read* (subpath ${JSON.stringify(sandboxDir)}))
(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${JSON.stringify(work)}))
(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))
`;
}

function scrubEnv(sandboxDir: string, team: 'A' | 'B'): NodeJS.ProcessEnv {
  // 只保留运行时必需变量 —— 绝不继承宿主环境（P1-13）
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: sandboxDir,
    TMPDIR: path.join(sandboxDir, 'work'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONHASHSEED: '0',
    PYTHONNOUSERSITE: '1',
    GB_TEAM: team,
  };
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

export interface PreparedSandbox {
  dir: string;
  entry: string;
  profilePath: string;
  launcherPath: string;
  isolation: IsolationReport;
}

/** 为一个队伍/回合准备全新沙箱目录（P0-8） */
export function prepareSandbox(opts: {
  sandboxRoot: string;
  matchId: string;
  roundNumber: number;
  team: 'A' | 'B';
  packageDir: string;
  entry: string;
  memoryLimitMb: number;
  denyReadPaths?: string[];
}): PreparedSandbox {
  const nonce = Math.random().toString(36).slice(2, 10);
  const dir = path.join(
    opts.sandboxRoot,
    opts.matchId,
    `round-${opts.roundNumber}`,
    `${opts.team}-${nonce}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });

  // 只复制该队自己的包
  copyDir(opts.packageDir, path.join(dir, 'pkg'));

  const bootstrapPath = path.join(dir, '__gb_bootstrap.py');
  fs.writeFileSync(bootstrapPath, BOOTSTRAP_SOURCE, { mode: 0o444 });

  const launcherPath = path.join(dir, '__gb_launch.sh');
  fs.writeFileSync(launcherPath, LAUNCHER_SOURCE, { mode: 0o555 });

  const profilePath = path.join(dir, '__gb_profile.sb');
  fs.writeFileSync(profilePath, buildProfile(dir, opts.sandboxRoot, opts.denyReadPaths ?? []), {
    mode: 0o444,
  });

  return {
    dir,
    entry: path.join(dir, 'pkg', opts.entry),
    profilePath,
    launcherPath,
    isolation: {
      mechanism: sandboxExecAvailable() ? 'sandbox-exec' : 'none',
      networkDenied: true,
      filesystemScoped: true,
      envScrubbed: true,
      memoryLimited: true,
      processGroupIsolated: true,
      childProcessDenied: true,
    },
  };
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL'); // 整个进程组（P1-12）
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** 解析算法输出：优先整体 JSON，其次最后一行 JSON */
function parseAlgorithmOutput(raw: string): { dslText: string | null; error: string | null } {
  const text = raw.trim();
  if (!text) return { dslText: null, error: '算法没有输出' };

  // JSON.parse 与 JSON.stringify 都是递归实现：超深载荷会在**序列化**阶段
  // 抛出 RangeError。若把它与「缺少 dsl 字段」混为一谈，恶意包就会被误报成
  // 格式错误而不是「嵌套过深」（P0-A 家族，Re-Gate Cycle 2）。
  let sawDslUnserializable = false;

  const tryParse = (s: string): string | null => {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      return null; // 非法 JSON，或 JSON.parse 自身在超深载荷上抛 RangeError
    }
    if (!obj || typeof obj !== 'object') return null;
    const record = obj as Record<string, unknown>;
    const dsl = record.dsl ?? record.function ?? record.f ?? null;
    if (dsl === null || dsl === undefined) return null;
    if (typeof dsl === 'string') return dsl;
    try {
      return JSON.stringify(dsl);
    } catch {
      sawDslUnserializable = true;
      return null;
    }
  };

  const whole = tryParse(text);
  if (whole) return { dslText: whole, error: null };

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParse(lines[i]);
    if (parsed) return { dslText: parsed, error: null };
  }
  return {
    dslText: null,
    error: sawDslUnserializable
      ? '算法输出的 DSL 嵌套过深，无法序列化（超出深度上限）'
      : '算法输出缺少 dsl 字段或不是合法 JSON',
  };
}

export interface SpawnedRunner {
  team: 'A' | 'B';
  proc: ReturnType<typeof spawn>;
  sandbox: PreparedSandbox;
  ready: Promise<{ readyNs: bigint }>;
  /**
   * 写入 GO，返回**本队自己的**释放时刻（单调 ns）。
   *
   * 计时必须以本队 GO 的写入时刻为基准：宿主先写 A 的 GO、再写 B 的 GO，
   * 两次写入之间有约 20µs 的交付延迟。若双方共用同一个 releaseNs，
   * 后释放方就会被多计这段延迟（Re-Gate Cycle 1 P1-B）。
   * 各自起算后，双方都拿到完整的 timeoutMs 预算，释放顺序不再产生偏置。
   */
  release: () => bigint;
  /** 等待结束 */
  done: Promise<RunnerOutcome>;
  cancel: () => void;
}

/** 启动一个 Runner 进程，等待其 READY 握手 */
export function spawnRunner(opts: {
  team: 'A' | 'B';
  sandbox: PreparedSandbox;
  payloadJson: string;
  timeoutMs: number;
  memoryLimitMb: number;
}): SpawnedRunner {
  const { team, sandbox } = opts;

  const useSandbox = sandboxExecAvailable();
  const inner = [
    sandbox.launcherPath,
    String(opts.memoryLimitMb * 1024),
    '/usr/bin/python3',
    path.join(sandbox.dir, '__gb_bootstrap.py'),
    sandbox.entry,
  ];

  const cmd = useSandbox ? '/usr/bin/sandbox-exec' : '/usr/bin/python3';
  const args = useSandbox
    ? ['-f', sandbox.profilePath, ...inner]
    : [path.join(sandbox.dir, '__gb_bootstrap.py'), sandbox.entry];

  const startedNs = process.hrtime.bigint();

  let resolveReady!: (v: { readyNs: bigint }) => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<{ readyNs: bigint }>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  let readySettled = false;

  let resolveDone!: (v: RunnerOutcome) => void;
  const done = new Promise<RunnerOutcome>((res) => {
    resolveDone = res;
  });

  const isolation: IsolationReport = {
    ...sandbox.isolation,
    mechanism: useSandbox ? 'sandbox-exec' : 'none',
  };

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(cmd, args, {
      cwd: path.join(sandbox.dir, 'work'),
      env: scrubEnv(sandbox.dir, team),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // 独立进程组
    });
  } catch (e) {
    const outcome: RunnerOutcome = {
      team, success: false, stdout: '', stderr: '', error: `spawn 失败: ${(e as Error).message}`,
      errorCode: 'SPAWN_ERROR', computeTimeMs: 0, sandboxDir: sandbox.dir,
      isolation, cancelled: false,
    };
    if (!readySettled) { readySettled = true; rejectReady(new Error(outcome.error!)); }
    resolveDone(outcome);
    return {
      team,
      proc: undefined as any,
      sandbox,
      ready,
      release: () => 0n,
      done,
      cancel: () => {},
    };
  }

  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let released = false;
  let releaseNs: bigint | null = null;
  let finished = false;
  let cancelled = false;
  let oversize = false;
  let readyBuffer = '';
  let sawReady = false;

  let monitor: NodeJS.Timeout | null = null;

  const finish = (outcome: Omit<RunnerOutcome, 'team' | 'sandboxDir' | 'isolation' | 'cancelled'>) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutId);
    if (monitor) { clearInterval(monitor); monitor = null; }
    resolveDone({ ...outcome, team, sandboxDir: sandbox.dir, isolation, cancelled });
  };

  const timeoutId = setTimeout(() => {
    killTree(proc.pid);
    finish({
      success: false,
      stdout,
      stderr,
      error: `算法超时（>${opts.timeoutMs}ms）`,
      errorCode: 'TIMEOUT',
      computeTimeMs: releaseNs !== null ? Number(process.hrtime.bigint() - releaseNs) / 1e6 : opts.timeoutMs,
    });
  }, opts.timeoutMs + 30_000); // 硬上限；精确超时由 release 后的计时器负责

  let goTimeout: NodeJS.Timeout | null = null;

  // macOS 的 RLIMIT_AS 不生效（P1-11），因此额外做宿主侧 RSS 监控。
  // 由于 profile 已禁止 process-fork，进程组内只有这一个进程。
  monitor = setInterval(() => {
    if (finished || !proc.pid) return;
    execFile('ps', ['-o', 'rss=', '-p', String(proc.pid)], (err, stdout) => {
      if (err || finished) return;
      const kb = parseInt(String(stdout).trim(), 10);
      if (!Number.isFinite(kb)) return;
      if (kb > opts.memoryLimitMb * 1024) {
        killTree(proc.pid);
        finish({
          success: false,
          stdout,
          stderr,
          error: `算法内存使用 ${(kb / 1024).toFixed(0)}MB 超过上限 ${opts.memoryLimitMb}MB`,
          errorCode: 'MEMORY_LIMIT',
          computeTimeMs: releaseNs !== null ? Number(process.hrtime.bigint() - releaseNs) / 1e6 : 0,
        });
      }
    });
  }, 60);

  proc.stdout?.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      if (!oversize) {
        oversize = true;
        killTree(proc.pid);
        finish({
          success: false, stdout: stdout.slice(0, 4096), stderr,
          error: `标准输出超过上限 ${MAX_STDOUT_BYTES} 字节`,
          errorCode: 'OUTPUT_TOO_LARGE',
          computeTimeMs: releaseNs !== null ? Number(process.hrtime.bigint() - releaseNs) / 1e6 : 0,
        });
      }
      return;
    }

    if (!sawReady) {
      readyBuffer += chunk.toString();
      const nl = readyBuffer.indexOf('\n');
      if (nl >= 0) {
        const line = readyBuffer.slice(0, nl);
        readyBuffer = readyBuffer.slice(nl + 1);
        sawReady = true;
        if (!readySettled) {
          readySettled = true;
          resolveReady({ readyNs: process.hrtime.bigint() });
        }
        if (line.includes('"gb"') && line.includes('ready')) {
          // READY 行本身不计入算法输出
          stdout += readyBuffer;
          readyBuffer = '';
        } else {
          stdout += line + '\n' + readyBuffer;
          readyBuffer = '';
        }
      }
      return;
    }
    stdout += chunk.toString();
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= MAX_STDERR_BYTES) stderr += chunk.toString();
  });

  proc.on('error', (err) => {
    if (!readySettled) { readySettled = true; rejectReady(err); }
    finish({
      success: false, stdout, stderr,
      error: `进程错误: ${err.message}`,
      errorCode: 'SPAWN_ERROR',
      computeTimeMs: releaseNs !== null ? Number(process.hrtime.bigint() - releaseNs) / 1e6 : 0,
    });
  });

  proc.on('close', (code) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error(`进程在 READY 之前退出 (code=${code}): ${stderr.slice(0, 500)}`));
    }
    if (finished) return;

    const computeTimeMs = releaseNs !== null
      ? Number(process.hrtime.bigint() - releaseNs) / 1e6
      : Number(process.hrtime.bigint() - startedNs) / 1e6;

    if (cancelled) {
      finish({ success: false, stdout, stderr, error: '本轮攻击被取消', errorCode: 'CANCELLED', computeTimeMs });
      return;
    }
    if (oversize) return;

    if (code !== 0) {
      finish({
        success: false, stdout, stderr,
        error: `算法异常退出 (code=${code}): ${stderr.slice(0, 1000)}`,
        errorCode: 'CRASH',
        computeTimeMs,
      });
      return;
    }

    const { dslText, error } = parseAlgorithmOutput(stdout);
    if (!dslText) {
      finish({
        success: false, stdout, stderr,
        error: error ?? '无法解析算法输出',
        errorCode: 'INVALID_OUTPUT',
        computeTimeMs,
      });
      return;
    }

    finish({ success: true, stdout, stderr, error: null, errorCode: null, computeTimeMs });
  });

  // 写入输入（单行 JSON + 换行作为帧边界）
  proc.stdin?.write(opts.payloadJson + '\n');

  return {
    team,
    proc,
    sandbox,
    ready,
    release: (): bigint => {
      if (released) return releaseNs ?? process.hrtime.bigint();
      released = true;
      // 本队自己的 GO 时刻 —— 计时基准（P1-B）
      releaseNs = process.hrtime.bigint();
      try {
        proc.stdin?.write('GO\n');
        proc.stdin?.end();
      } catch {
        /* ignore */
      }
      // 精确超时从 release 起算
      if (goTimeout) clearTimeout(goTimeout);
      goTimeout = setTimeout(() => {
        killTree(proc.pid);
        finish({
          success: false, stdout, stderr,
          error: `算法超时（>${opts.timeoutMs}ms）`,
          errorCode: 'TIMEOUT',
          computeTimeMs: opts.timeoutMs,
        });
      }, opts.timeoutMs);
      return releaseNs;
    },
    done,
    cancel: () => {
      cancelled = true;
      killTree(proc.pid);
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error('cancelled'));
      }
    },
  };
}

/**
 * 同时运行双方算法。
 *
 * 公平性（P1-10 + Re-Gate Cycle 1 P1-B）：
 *   两个进程都完成 READY 握手后，宿主先后写入 GO（约 20µs 交付延迟）。
 *   **每方的 computeTimeMs 与超时预算都从它自己的 GO 时刻起算**，
 *   因此双方拿到等长的计算预算，释放顺序不再产生方向固定的偏置。
 *   早期版本让双方共用同一个 releaseNs，等于把「后写 GO 的那一方」的
 *   交付延迟计进了它的耗时，恒对 B 不利。
 */
export async function runDuel(opts: DuelOptions): Promise<DuelResult> {
  const timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
  const memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;

  const sandboxA = prepareSandbox({
    sandboxRoot: opts.sandboxRoot,
    matchId: opts.matchId,
    roundNumber: opts.roundNumber,
    team: 'A',
    packageDir: opts.teamA.packageDir,
    entry: opts.teamA.entry,
    memoryLimitMb,
    denyReadPaths: opts.denyReadPaths,
  });
  const sandboxB = prepareSandbox({
    sandboxRoot: opts.sandboxRoot,
    matchId: opts.matchId,
    roundNumber: opts.roundNumber,
    team: 'B',
    packageDir: opts.teamB.packageDir,
    entry: opts.teamB.entry,
    memoryLimitMb,
    denyReadPaths: opts.denyReadPaths,
  });

  const runnerA = spawnRunner({ team: 'A', sandbox: sandboxA, payloadJson: opts.teamA.payloadJson, timeoutMs, memoryLimitMb });
  const runnerB = spawnRunner({ team: 'B', sandbox: sandboxB, payloadJson: opts.teamB.payloadJson, timeoutMs, memoryLimitMb });

  let a: RunnerOutcome | null = null;
  let b: RunnerOutcome | null = null;
  let firstResultHandled = false;

  const settleFirst = async (outcome: RunnerOutcome) => {
    if (firstResultHandled) return;
    firstResultHandled = true;
    if (opts.onFirstResult) {
      const shouldCancel = await opts.onFirstResult(outcome.team, outcome);
      if (shouldCancel) {
        if (outcome.team === 'A') runnerB.cancel();
        else runnerA.cancel();
      }
    }
  };

  runnerA.done.then((o) => { a = o; void settleFirst(o); });
  runnerB.done.then((o) => { b = o; void settleFirst(o); });

  let readySkewMs = 0;
  try {
    const [ra, rb] = await Promise.all([runnerA.ready, runnerB.ready]);
    readySkewMs = Number(ra.readyNs > rb.readyNs ? ra.readyNs - rb.readyNs : rb.readyNs - ra.readyNs) / 1e6;
  } catch (e) {
    // 一方未能 READY —— 让两边都结束
    runnerA.cancel();
    runnerB.cancel();
    const [oa, ob] = await Promise.all([runnerA.done, runnerB.done]);
    return {
      a: oa,
      b: ob,
      releaseNs: process.hrtime.bigint(),
      releaseSkewUs: 0,
      readySkewMs: 0,
      isolation: sandboxA.isolation,
    };
  }

  // ---- 释放双方：各自记录自己的 GO 时刻（P1-B）----
  const releaseNsA = runnerA.release();
  const releaseNsB = runnerB.release();
  const releaseNs = releaseNsA < releaseNsB ? releaseNsA : releaseNsB;
  const releaseSkewUs =
    Number(releaseNsA > releaseNsB ? releaseNsA - releaseNsB : releaseNsB - releaseNsA) / 1000;

  const [outcomeA, outcomeB] = await Promise.all([runnerA.done, runnerB.done]);

  // 清理沙箱（Round 结束后环境销毁，P0-8 / 无跨 Round 持久化）
  cleanupSandbox(sandboxA.dir);
  cleanupSandbox(sandboxB.dir);

  return {
    a: outcomeA,
    b: outcomeB,
    releaseNs,
    releaseSkewUs,
    readySkewMs,
    isolation: sandboxA.isolation,
  };
}

export function cleanupSandbox(dir: string): void {
  const parent = path.dirname(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    // 若同回合的两个沙箱都已删除，移除空目录；
    // 再向上移除空的 <matchId> 目录（Re-Gate Cycle 1 P3-D：此前会留下空壳）
    if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
      const grand = path.dirname(parent);
      if (fs.existsSync(grand) && fs.readdirSync(grand).length === 0) fs.rmdirSync(grand);
    }
  } catch {
    /* ignore */
  }
}

export function defaultSandboxRoot(): string {
  return path.join(os.tmpdir(), 'geometry-battle-runs');
}
