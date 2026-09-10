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
 *   双方进程先完成启动握手（READY），再由宿主**先后**写入 GO 释放；
 *   每方的计时与超时预算都从**它自己的 GO 写入时刻**起算，
 *   因此释放顺序不再产生方向固定的偏置（P1-B）。
 *
 * V1.1 输入协议（Plans/Input/V1.1 — Algorithm Input Protocol.md）：
 *   沙箱是三区布局 —— input/（只读输入）· app/（只读算法包）· work/（唯一可写）。
 *   输入不再走 stdin，而是两份**对 A/B 字节级完全相同**的文件：
 *     input/public_state.json   · input/reveal_state.json
 *   队别只经 Runner Context（`--team A|B`）传递，绝不写进 JSON（规范 §11/§12）。
 *   bootstrap 在收到 GO 之前**绝不执行参赛代码**（规范 §14/§15）。
 *
 * V1.1 输出协议（Plans/Input/V1.1 — Algorithm Slot, Startup & JSON IPC Protocol.md）：
 *   沙箱改为四区 —— app/（只读）· input/（只读）· output/（只写 result.json）· work/（可写临时区）。
 *   stdout **不作为结果通道**（规范 §24）：算法只写 `/output/result.json`，
 *   内容严格为 `{"schema_version":"1.1","dsl":…}`，多一个键都拒（规范 §25/§26）。
 *   Judge 只监听该文件出现（规范 §27），计时以「合法结果到达」为终点（规范 §22）。
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
import { PROTOCOL_VERSION } from '../core/InputProtocol';
import { THREAD_ENV } from '../submission/Runtime';

/** 结果文件在 `output/` 内的固定文件名（规范 §11/§25） */
export const RESULT_FILENAME = 'result.json';

/**
 * 结果文件出现后，允许进程自然退出的宽限（ms）。
 *
 * 计时终点是**结果文件可读的时刻**，与这个宽限无关；宽限只用来把 stderr 里
 * 尚未送达宿主的诊断行排空（规范 §30 允许有限 debug log），
 * 排空后仍不退出就强杀 —— 「ONE OUTPUT ONLY」，写完就该结束。
 */
const RESULT_DRAIN_GRACE_MS = 50;

/**
 * 墙钟 / 单调钟锚点（进程启动时取一次，双方共用）。
 *
 * 计时终点取自结果文件的 **mtime**（纳秒），即算法自己写完内容的时刻，
 * 而不是宿主轮询「发现」它的时刻。
 *
 * 为什么不能用「宿主发现的时刻」：两个 Runner 的轮询回调跑在同一个事件循环里，
 * A 的回调先执行、且要读文件并解析 JSON，于是 B 的读数被系统性推迟约 0.1ms。
 * 同算法对局下这表现为「A 恒快」—— `timing-fairness` 的 aFasterRate 一度达到 0.907
 * （V1.0 用 stdout 'data' 事件打点，没有这个串行偏置）。
 *
 * 为什么不用 ctime（rename 时刻）：`os.replace()` 之后的 ctime 会被文件系统的
 * fsync/事务屏障**同步**——双方几乎在同一时刻完成，于是 release 顺序差（约 27µs）
 * 不再被抵消，反而整个算进先释放的一方的耗时里，aFasterRate 掉到 0.253。
 * mtime 是写入时刻，不受该屏障影响，双方对称。
 *
 * mtime 可被 `os.utime()` 伪造，因此沙箱的写权限按操作细分，
 * 只放行 file-write-data / create / unlink，`file-write-times` 默认拒绝
 * （见 buildProfile 注释）——算法改不动自己产出文件的时间戳。
 *
 * 锚点用 `performance.timeOrigin + performance.now()`（亚微秒精度）而不是 `Date.now()`
 * （毫秒精度），把单调时钟换算到墙钟域与 mtime 相减。
 */
const WALL_ANCHOR = (() => {
  const hrtime = process.hrtime.bigint();
  const wallNs = BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6));
  return { hrtime, wallNs };
})();

/** 单调时钟 ns → 墙钟 ns（基于进程级锚点） */
function monotonicToWallNs(monoNs: bigint): bigint {
  return WALL_ANCHOR.wallNs + (monoNs - WALL_ANCHOR.hrtime);
}

/** 墙钟 ns → 单调时钟 ns（基于进程级锚点） */
function wallToMonotonicNs(wallNs: bigint): bigint {
  return WALL_ANCHOR.hrtime + (wallNs - WALL_ANCHOR.wallNs);
}

/**
 * 有界截断：保留**头 + 尾**，切掉中间（V1.1 Competitor Kit §13）。
 *
 * 为什么不能用 `slice(0, N)`：Python traceback 的**最后一行**才是异常类型与消息
 * （`ModuleNotFoundError` / `SyntaxError` / …）。只留头部时参赛者看到的是一串
 * `File "…", line …` 调用帧，根因被切掉，错误信息不可行动。
 *
 * 上限语义：返回串长度 ≤ limit（省略标记计入预算），因此不会突破调用方的预算。
 */
function boundedHeadTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = `\n… [已省略 ${text.length - limit} 字符] …\n`;
  const budget = Math.max(0, limit - marker.length);
  const head = Math.ceil(budget * 0.4);
  const tail = budget - head;
  return text.slice(0, head) + marker + text.slice(text.length - tail);
}

/**
 * 结果内容写完的墙钟时刻（ns）；文件不存在或不可 stat 时返回 null。
 *
 * 取 mtime 而不是 ctime —— 理由见 WALL_ANCHOR。mtime 由算法自己写入，
 * 且沙箱拒绝 `file-write-times`，因此不可伪造。
 */
function resultWrittenWallNs(resultPath: string): bigint | null {
  try {
    return fs.statSync(resultPath, { bigint: true }).mtimeNs;
  } catch {
    return null;
  }
}

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
  /** GO 之后算法写入的标准输出（已限长，**不参与判定**，仅留档诊断；规范 §30） */
  stdout: string;
  /** 有限 debug 日志（已限长；同样不参与判定；规范 §30） */
  stderr: string;
  error: string | null;
  errorCode: RunnerErrorCode | null;
  /** 相对**本队自己的** GO 写入时刻的耗时（ms） */
  computeTimeMs: number;
  sandboxDir: string;
  isolation: IsolationReport;
  /** 是否因 shooter 被击杀而取消 */
  cancelled: boolean;
  /** `output/result.json` 的确切字节（未通过 schema 校验时为 null） */
  resultJson: string | null;
  /** 从 result.json 解出的 DSL 文本（AST 对象会被重新序列化） */
  dslText: string | null;
}

/**
 * 一轮的算法输入字节（V1.1）。
 *
 * 提升到 `DuelOptions` 顶层而非放在 teamA/teamB 里，是**结构性保证**：
 * 双方拿到的是同一份字节，队别不可能从输入里分化出去（规范 §11/§12）。
 */
export interface RunnerInput {
  /** public_state.json 的确切字节 */
  publicJson: string;
  /** reveal_state.json 的确切字节（内含 public_state_sha256 绑定） */
  revealJson: string;
}

export interface DuelOptions {
  matchId: string;
  roundNumber: number;
  sandboxRoot: string;
  /** 双方完全相同的输入字节 */
  input: RunnerInput;
  teamA: { packageDir: string; entry: string };
  teamB: { packageDir: string; entry: string };
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
  /**
   * A 队的 GO 写入时刻（单调时钟，ns）—— A 的计时基准（规范 §22/§23）。
   * 审计字段 `releaseA_ns`。
   */
  releaseANs: bigint;
  /** B 队的 GO 写入时刻（单调时钟，ns）—— B 的计时基准。审计字段 `releaseB_ns`。 */
  releaseBNs: bigint;
  /**
   * `|releaseA − releaseB|`（ns），审计字段 `startSkew_ns`（规范 §23）。
   *
   * 两次 GO 必然来自同一个 GO 事件、同一条启动路径（规范 §19），
   * 但写入顺序有约 20µs 的交付延迟；**计时不依赖它**（P1-B）。
   */
  startSkewNs: bigint;
  readySkewMs: number;
  isolation: IsolationReport;
}

/**
 * 平台注入的启动壳（V1.1）。
 *
 * 关键性质：**在收到 GO 之前绝不执行参赛代码**（规范 §14/§15）。
 * 它只做三件平台自己的事 —— 校验输入绑定、完成 READY 握手、等待 GO ——
 * 然后才 `runpy` 参赛入口。
 *
 * 输入绑定由**平台独立复核**（不依赖宿主已经查过）：
 * `sha256(public_state.json 的字节) == reveal_state.json 的 public_state_sha256`。
 * 不匹配即退出码 4，进程在 READY 之前退出 → 宿主侧 ready 被 reject → 本轮双方取消。
 */
const BOOTSTRAP_SOURCE = `# Geometry Battle official bootstrap (platform-provided)
import sys, runpy, json, hashlib

def check_binding(argv):
    try:
        pub_path = argv[argv.index('--public') + 1]
        rev_path = argv[argv.index('--reveal') + 1]
        with open(pub_path, 'rb') as f:
            pub_bytes = f.read()
        with open(rev_path, 'rb') as f:
            rev = json.loads(f.read().decode('utf-8'))
        expected = rev.get('public_state_sha256')
        actual = hashlib.sha256(pub_bytes).hexdigest()
        if not expected or expected != actual:
            sys.stderr.write('bootstrap: public_state_sha256 mismatch\\n')
            return False
    except Exception as e:
        sys.stderr.write('bootstrap: input binding check failed: %s\\n' % e)
        return False
    return True

def main():
    if len(sys.argv) < 2:
        sys.stderr.write("bootstrap: missing entry\\n")
        return 2
    entry = sys.argv[1]
    solver_argv = sys.argv[2:]
    if not check_binding(solver_argv):
        return 4
    sys.stdout.write('{"gb":"ready"}\\n')
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line or line.strip() != 'GO':
        sys.stderr.write("bootstrap: no GO signal\\n")
        return 3
    sys.argv = [entry] + solver_argv
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
  const output = path.join(sandboxDir, 'output');

  // 除了 /Users 与 sandbox 根目录，还必须显式拒绝平台自己的密封包目录 ——
  // 否则当 artifacts 落在 /Users 之外（例如操作员指定 --artifacts /tmp/...）时，
  // 对手的密封包会落在 (allow file-read*) 的默认放行范围内。
  // 注：即使某个 deny 路径恰好是沙箱目录的祖先也没关系 —— 下面的
  // `(allow file-read* (subpath sandboxDir))` 写在后面，SBPL 是「后匹配者胜」。
  // 系统级兜底拒绝：/tmp 与 /var/tmp 是操作员暂存对手包、历史产物、
  // 运维脚本的常见位置，算法没有任何理由读取（注意 /tmp 是 /private/tmp
  // 的符号链接，realpath 后二者相同）。
  //
  // 这些兜底条目**永不参与自保护过滤**（Re-Gate Cycle 2 审计 D-1）。
  // 早期把 sandboxRoot 也放进 selfPaths：当 sandboxRoot 位于 /tmp 之下时
  // `covers('/private/tmp', sandboxRoot)` 为真，整条兜底 deny 被静默丢弃，
  // 算法即可读取任意未被显式 deny 的 /tmp 文件（包括**其他场次的密封包**）。
  // 保留它们不会伤到沙箱自身 —— 末尾的 `(allow file-read* (subpath sandboxDir))`
  // 按 SBPL「后匹配者胜」重新放行；模板里无条件存在的
  // `(deny file-read* (subpath sandboxRoot))` 与它同理，且一直工作正常。
  const SYSTEM_DENIES = ['/private/tmp', '/private/var/tmp'];

  /** p 是否等于 self 或是 self 的祖先 */
  const covers = (p: string, self: string): boolean => p === self || self.startsWith(p + path.sep);

  // 自保护剔除：只针对**调用方传入**的 deny，且只允许丢弃会阻断
  // sandboxDir / work 自身入口的条目（否则算法连自己的包和 bootstrap 都读不到）。
  // sandboxRoot 不在判定对象内 —— 它被模板无条件 deny，并由末尾 allow 放行。
  const selfPaths = [sandboxDir, work, output];

  const extraDenies = [...denyReadPaths, ...SYSTEM_DENIES]
    .map((p) => real(p))
    .filter((p, i, arr) => p.length > 0 && p !== path.sep && arr.indexOf(p) === i)
    .filter((p) => {
      if (SYSTEM_DENIES.includes(p)) return true; // 系统兜底永不被剔除
      return !selfPaths.some((self) => covers(p, self));
    })
    .map((p) => `(deny file-read* (subpath ${JSON.stringify(p)}))`)
    .join('\n');

  // 写权限**按操作细分**，不用 `file-write*`：
  // `file-write*` 还包含 `file-write-times`，即算法可以 `os.utime()` 改写
  // 自己产出的 result.json 的 mtime —— 而 mtime 正是计时终点（见 WALL_ANCHOR）。
  // 一条 `os.utime(out, (0, 0))` 就能把耗时压到 0，从而伪造「先手」。
  // 只放行 data / create / unlink 已覆盖 tmp + 原子 rename + 子目录 + 本地模块导入，
  // 同时让时间戳不可伪造（已在受限 profile 下逐项实测）。
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
(allow file-write-data (subpath ${JSON.stringify(work)}))
(allow file-write-create (subpath ${JSON.stringify(work)}))
(allow file-write-unlink (subpath ${JSON.stringify(work)}))
(allow file-write-data (subpath ${JSON.stringify(output)}))
(allow file-write-create (subpath ${JSON.stringify(output)}))
(allow file-write-unlink (subpath ${JSON.stringify(output)}))
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
    // 规范 §5：线程上限冻结为 1。双方必须是同一个数值，否则
    // 「谁的机器核多」会变成计时优势（BLAS/OpenMP 默认吃满所有核）。
    ...THREAD_ENV,
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
  /** 只读算法包目录（规范 §9 的 `/app`） */
  appDir: string;
  /** 只读输入目录（规范 §10 的 `/input`） */
  inputDir: string;
  /** 只写结果目录（规范 §11 的 `/output`，每回合开始必为空） */
  outputDir: string;
  /** 可写临时目录（规范 §12 的 `/work`，回合结束即销毁） */
  workDir: string;
  entry: string;
  publicPath: string;
  revealPath: string;
  /** `<outputDir>/result.json` —— 唯一的正式结果通道（规范 §11/§25） */
  resultPath: string;
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
  /** 双方字节级相同的两份输入文件（V1.1） */
  input: RunnerInput;
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

  const appDir = path.join(dir, 'app');
  const inputDir = path.join(dir, 'input');
  const outputDir = path.join(dir, 'output');
  const workDir = path.join(dir, 'work');
  fs.mkdirSync(inputDir, { recursive: true });
  // output/ 每回合从**空目录**开始（规范 §11）：沙箱目录本身是新建的，
  // 这里再显式建一次并确保为空，防止未来有人复用沙箱路径。
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 只复制该队自己的包
  copyDir(opts.packageDir, appDir);

  // 输入文件在**进程创建之前**就写好（规范 §15 允许 JSON 提前存在；
  // 不可提前的只有「执行参赛代码」这一件事，由 bootstrap 的 GO 门控保证）。
  // 0444 只是纵深防御 —— SBPL 的写权限本来就只放开 work/。
  const publicPath = path.join(inputDir, 'public_state.json');
  const revealPath = path.join(inputDir, 'reveal_state.json');
  fs.writeFileSync(publicPath, opts.input.publicJson, { mode: 0o444 });
  fs.writeFileSync(revealPath, opts.input.revealJson, { mode: 0o444 });

  const resultPath = path.join(outputDir, RESULT_FILENAME);

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
    appDir,
    inputDir,
    outputDir,
    workDir,
    entry: path.join(appDir, opts.entry),
    publicPath,
    revealPath,
    resultPath,
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

/** `result.json` 的严格校验结果（规范 §25/§26/§29） */
export type ResultParse =
  | { ok: true; dslText: string }
  | { ok: false; error: string };

/** 结果文件**只允许**这两个键（规范 §26：hits/targets/kills/winner/… 一律拒收） */
const RESULT_ALLOWED_KEYS = ['schema_version', 'dsl'];

/**
 * 严格解析 `output/result.json`（规范 §25/§26）。
 *
 * 与 V1.0 的 stdout 解析相比，这里**不做任何宽容**：
 *   - 顶层必须是 JSON 对象；
 *   - 键集合必须恰好是 `{schema_version, dsl}` 的子集，多一个键即非法；
 *   - `schema_version` 必须等于 `"1.1"`；
 *   - `dsl` 必须存在，可以是 AST 对象，也可以是 AST 的 JSON 字符串。
 *
 * JSON.parse 与 JSON.stringify 都是递归实现：超深载荷会在**序列化**阶段
 * 抛出 RangeError。这类载荷必须报「嵌套过深」而不是被误读成「缺少 dsl」
 * （P0-A 家族，Re-Gate Cycle 2）。
 */
export function parseResultFile(raw: string): ResultParse {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    // 非法 JSON，或 JSON.parse 自身在超深载荷上抛 RangeError
    return { ok: false, error: 'result.json 不是合法 JSON' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'result.json 顶层必须是 JSON 对象' };
  }
  const record = obj as Record<string, unknown>;

  const extra = Object.keys(record).filter((k) => !RESULT_ALLOWED_KEYS.includes(k));
  if (extra.length > 0) {
    return {
      ok: false,
      error: `result.json 含不允许的字段：${extra.join(', ')}（规范 §26 只允许 schema_version 与 dsl）`,
    };
  }
  if (record.schema_version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `result.json 的 schema_version 必须是 "${PROTOCOL_VERSION}"，实际为 ${JSON.stringify(
        record.schema_version
      )}`,
    };
  }
  const dsl = record.dsl;
  if (dsl === undefined || dsl === null) {
    return { ok: false, error: 'result.json 缺少 dsl 字段' };
  }
  if (typeof dsl === 'string') return { ok: true, dslText: dsl };
  try {
    return { ok: true, dslText: JSON.stringify(dsl) };
  } catch {
    return { ok: false, error: 'result.json 的 dsl 嵌套过深，无法序列化（超出深度上限）' };
  }
}

export interface SpawnedRunner {
  team: 'A' | 'B';
  proc: ReturnType<typeof spawn>;
  sandbox: PreparedSandbox;
  ready: Promise<{ readyNs: bigint }>;
  /**
   * 预置结果轮询与超时预算 —— 由 `runDuel` 在释放**任何一方之前**对双方各调一次。
   *
   * 存在的唯一理由是公平：两次 GO 写入必须背靠背，中间不能夹宿主侧开销，
   * 否则先写 GO 的一方的计时基准会比后写的一方早出这段开销（见 `release` 注释）。
   * 单独调用 `release()` 的路径会自动补做，因此 `prepare()` 是可选的。
   */
  prepare: () => void;
  /**
   * 写入 GO，返回**本队自己的**释放时刻（单调 ns）。
   *
   * 计时必须以本队 GO 的写入时刻为基准：宿主先写 A 的 GO、再写 B 的 GO，
   * 两次写入之间有约 20µs 的交付延迟。若双方共用同一个 releaseNs，
   * 后释放方就会被多计这段延迟（Re-Gate Cycle 1 P1-B）。
   * 各自起算后，双方都拿到完整的 timeoutMs 预算，释放顺序不再产生偏置。
   *
   * 这段交付延迟本身也是偏置来源：它对**先写的一方不利**（基准更早，耗时被多算），
   * 且方向固定，会系统性地把胜率推向「后释放的一方」。因此释放前的一切准备工作
   * 都由 `prepare()` 提前做完，本函数只剩「打点 + 写 GO」两步。
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
  timeoutMs: number;
  memoryLimitMb: number;
}): SpawnedRunner {
  const { team, sandbox } = opts;

  // 参赛入口的 argv：队别只经 Runner Context 传递（规范 §12），输入只经文件（规范 §13），
  // 结果只经文件（规范 §24）—— 四个参数固定，双方唯一差异是 --team 的取值（规范 §6）。
  const solverArgv = [
    '--team', team,
    '--public', sandbox.publicPath,
    '--reveal', sandbox.revealPath,
    '--output', sandbox.resultPath,
  ];
  const bootstrapPath = path.join(sandbox.dir, '__gb_bootstrap.py');

  const useSandbox = sandboxExecAvailable();
  const inner = [
    sandbox.launcherPath,
    String(opts.memoryLimitMb * 1024),
    '/usr/bin/python3',
    bootstrapPath,
    sandbox.entry,
    ...solverArgv,
  ];

  const cmd = useSandbox ? '/usr/bin/sandbox-exec' : '/usr/bin/python3';
  const args = useSandbox
    ? ['-f', sandbox.profilePath, ...inner]
    : [bootstrapPath, sandbox.entry, ...solverArgv];

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
      isolation, cancelled: false, resultJson: null, dslText: null,
    };
    if (!readySettled) { readySettled = true; rejectReady(new Error(outcome.error!)); }
    resolveDone(outcome);
    return {
      team,
      proc: undefined as any,
      sandbox,
      ready,
      prepare: () => {},
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
  let prepared = false;
  let releaseNs: bigint | null = null;
  let finished = false;
  let cancelled = false;
  let oversize = false;
  let readyBuffer = '';
  let sawReady = false;

  let monitor: NodeJS.Timeout | null = null;

  /** 已通过 schema 校验的结果（含它出现的单调时刻 —— 计时终点，规范 §22） */
  let pendingResult: { resultJson: string; dslText: string; resultNs: bigint } | null = null;
  /** 结果文件出现过但没通过校验时的原因（最后一次） */
  let resultError: string | null = null;
  /** 结果文件是否出现过（用于区分「没写」与「写了但不合法」） */
  let sawResultFile = false;
  let poller: NodeJS.Timeout | null = null;
  let drainTimer: NodeJS.Timeout | null = null;

  const finish = (
    outcome: Omit<RunnerOutcome, 'team' | 'sandboxDir' | 'isolation' | 'cancelled' | 'resultJson' | 'dslText'> & {
      resultJson?: string | null;
      dslText?: string | null;
    }
  ) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutId);
    if (monitor) { clearInterval(monitor); monitor = null; }
    if (poller) { clearInterval(poller); poller = null; }
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    resolveDone({
      resultJson: null,
      dslText: null,
      ...outcome,
      team,
      sandboxDir: sandbox.dir,
      isolation,
      cancelled,
    });
  };

  /**
   * 收到合法结果后收尾：停止轮询、撤销超时预算、按**结果到达时刻**结算耗时。
   *
   * 计时终点是 result.json 可读的时刻（规范 §22/§28），不是进程退出时刻 ——
   * 因此这里用 `pendingResult.resultNs` 而不是 `process.hrtime.bigint()`。
   */
  const finishWithResult = () => {
    if (!pendingResult) return;
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    if (goTimeout) { clearTimeout(goTimeout); goTimeout = null; }
    const { resultJson, dslText, resultNs } = pendingResult;
    finish({
      success: true,
      stdout,
      stderr,
      error: null,
      errorCode: null,
      computeTimeMs: releaseNs !== null ? Number(resultNs - releaseNs) / 1e6 : 0,
      resultJson,
      dslText,
    });
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
      rejectReady(new Error(`进程在 READY 之前退出 (code=${code}): ${boundedHeadTail(stderr, 500)}`));
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

    // 进程可能刚写完就退出，1ms 的轮询还没轮到它 —— 退出前同步补一次检查，
    // 否则合规算法（tmp + 原子 rename 后立即结束）会被误判为 INVALID_OUTPUT。
    if (!pendingResult) pollForResult();

    // 结果已经拿到（规范 §27：Judge 只监听 result.json 出现）——
    // 进程之后以什么码退出都不影响判定，计时也已按结果到达时刻结算。
    if (pendingResult) {
      finishWithResult();
      return;
    }

    if (code !== 0) {
      finish({
        success: false, stdout, stderr,
        error: `算法异常退出 (code=${code}): ${boundedHeadTail(stderr, 1000)}`,
        errorCode: 'CRASH',
        computeTimeMs,
      });
      return;
    }

    finish({
      success: false,
      stdout,
      stderr,
      error:
        resultError ??
        (sawResultFile
          ? 'output/result.json 未在 deadline 前形成完整合法文件'
          : '算法未生成 output/result.json'),
      errorCode: 'INVALID_OUTPUT',
      computeTimeMs,
    });
  });

  /**
   * 轮询 `output/result.json`（规范 §27：Judge 只监听它出现）。
   *
   * 1ms 的粒度相对 2000ms 预算可忽略；双方各自轮询、相位独立，
   * 不产生方向固定的偏置。计时终点是**文件可读的那一刻**（规范 §22/§28），
   * 而不是进程退出时刻 —— 后者会把解释器退出开销算进算法耗时。
   */
  const pollForResult = () => {
    if (finished || !released || pendingResult) return;
    if (!fs.existsSync(sandbox.resultPath)) return;
    let text: string;
    try {
      text = fs.readFileSync(sandbox.resultPath, 'utf8');
    } catch {
      return; // 与删除/替换竞争，下一拍再看
    }
    sawResultFile = true;
    const parsed = parseResultFile(text);
    if (!parsed.ok) {
      // 可能只写了一半（未用 tmp+rename 的算法），继续等到 deadline（规范 §27/§28）
      resultError = parsed.error;
      return;
    }
    // 计时终点取**结果文件的 mtime**（算法自己写完内容的时刻），
    // 而不是本轮询回调的执行时刻 —— 宿主侧的串行开销会系统性地推迟后一方的读数
    // （见 WALL_ANCHOR 注释）。时间戳不可得或换算结果不合理时退回轮询时刻。
    let resultNs = process.hrtime.bigint();
    const writtenWallNs = resultWrittenWallNs(sandbox.resultPath);
    if (writtenWallNs !== null && releaseNs !== null) {
      const candidate = wallToMonotonicNs(writtenWallNs);
      const candidateMs = Number(candidate - releaseNs) / 1e6;
      if (candidateMs >= 0 && candidateMs <= opts.timeoutMs) resultNs = candidate;
    }
    pendingResult = { resultJson: text, dslText: parsed.dslText, resultNs };
    if (poller) { clearInterval(poller); poller = null; }
    // 给进程一点时间自然退出，把 stderr 里的 debug log 排空（规范 §30）；
    // 超时仍未退出就强杀 —— ONE OUTPUT ONLY，写完就该结束（规范 §29）。
    drainTimer = setTimeout(() => {
      killTree(proc.pid);
      finishWithResult();
    }, RESULT_DRAIN_GRACE_MS);
  };

  /**
   * 预置结果轮询与超时预算（见 `SpawnedRunner.prepare`）。
   *
   * `pollForResult` 在 `released` 之前直接返回，提前挂上轮询器没有副作用；
   * 超时预算提前 δ（两次 GO 写入之间的宿主开销，量级 10µs）起算，
   * 相对 2000ms 的预算可忽略。
   */
  const prepare = () => {
    if (prepared || finished) return;
    prepared = true;
    // 预热 stdin 的写入路径：本轮的**第一次** write() 比后续写贵约 35µs
    // （JS 侧惰性初始化，探针实测 39.5µs → 5.4µs），而 GO 正是本轮第一次写。
    // 写 0 字节即可把它吸收掉 —— 子进程读不到任何内容，bootstrap 仍在等它的 GO 行。
    try {
      proc.stdin?.write('');
    } catch {
      /* ignore */
    }
    // 结果通道：只监听 output/result.json 出现（规范 §27）
    if (poller) clearInterval(poller);
    poller = setInterval(pollForResult, 1);
    // 精确超时从 release 起算；到点仍无合法结果 → TIMEOUT（规范 §28）
    if (goTimeout) clearTimeout(goTimeout);
    goTimeout = setTimeout(() => {
      killTree(proc.pid);
      finish({
        success: false, stdout, stderr,
        error: `算法超时（>${opts.timeoutMs}ms 内未生成合法的 output/result.json）`,
        errorCode: 'TIMEOUT',
        computeTimeMs: opts.timeoutMs,
      });
    }, opts.timeoutMs);
  };

  // 输入不再走 stdin —— 两份 JSON 已由 prepareSandbox 写入 input/，
  // 参赛入口从 argv 拿到路径自己读（规范 §10/§13）。stdin 现在只承载 GO 信号。

  return {
    team,
    proc,
    sandbox,
    ready,
    prepare,
    release: (): bigint => {
      if (released) return releaseNs ?? process.hrtime.bigint();
      released = true;
      prepare(); // 单方调用路径就地补做；runDuel 已在双方释放前调过（此时为空操作）
      // 本队自己的 GO 时刻 —— 计时基准（P1-B）。打点与写 GO 之间不得再夹任何宿主开销。
      releaseNs = process.hrtime.bigint();
      try {
        proc.stdin?.write('GO\n');
      } catch {
        /* ignore */
      }
      // EOF 只是给子进程一个「stdin 结束了」的信号，不参与计时：同步 end() 会给
      // **后写 GO 的一方**多加约 16µs 的宿主开销（交错配对实测），于是先写方显得更慢。
      // 推迟到下一拍，两次 GO 写入之间就只剩一个 write 调用。
      setImmediate(() => {
        const stdin = proc.stdin;
        if (!stdin || stdin.destroyed || stdin.writableEnded) return;
        try {
          stdin.end();
        } catch {
          /* ignore */
        }
      });
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
 * 公平性（P1-10 + Re-Gate Cycle 1 P1-B + 规范 §19/§22/§23）：
 *   两个进程都完成 READY 握手后，宿主先后写入 GO（约 20µs 交付延迟）。
 *   两次 GO 由**同一个 GO 事件**触发、走**同一条启动路径**，这就是赛事意义上的
 *   「同时启动」（规范 §19）。
 *   **每方的 computeTimeMs 与超时预算都从它自己的 GO 时刻起算**，
 *   因此双方拿到等长的计算预算，释放顺序不再产生方向固定的偏置。
 *   早期版本让双方共用同一个 releaseNs，等于把「后写 GO 的那一方」的
 *   交付延迟计进了它的耗时，恒对 B 不利。
 *   `releaseA_ns` / `releaseB_ns` / `startSkew_ns` 三者写入审计，供事后复核。
 */
export async function runDuel(opts: DuelOptions): Promise<DuelResult> {
  const timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
  const memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;

  // 同一份字节写进两个沙箱 —— 队别只能经 argv 分化（规范 §11/§12）。
  const sandboxA = prepareSandbox({
    sandboxRoot: opts.sandboxRoot,
    matchId: opts.matchId,
    roundNumber: opts.roundNumber,
    team: 'A',
    packageDir: opts.teamA.packageDir,
    entry: opts.teamA.entry,
    input: opts.input,
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
    input: opts.input,
    memoryLimitMb,
    denyReadPaths: opts.denyReadPaths,
  });

  const runnerA = spawnRunner({ team: 'A', sandbox: sandboxA, timeoutMs, memoryLimitMb });
  const runnerB = spawnRunner({ team: 'B', sandbox: sandboxB, timeoutMs, memoryLimitMb });

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
    const neverReleased = process.hrtime.bigint();
    return {
      a: oa,
      b: ob,
      releaseANs: neverReleased,
      releaseBNs: neverReleased,
      startSkewNs: 0n,
      readySkewMs: 0,
      isolation: sandboxA.isolation,
    };
  }

  // ---- 释放双方：各自记录自己的 GO 时刻（P1-B / 规范 §22/§23）----
  // 先把双方的轮询器与超时预算都挂好，让下面两次 release() 只剩「打点 + 写 GO」，
  // 否则夹在中间的宿主开销会整体计入先释放方的耗时（方向固定的偏置）。
  runnerA.prepare();
  runnerB.prepare();
  const releaseANs = runnerA.release();
  const releaseBNs = runnerB.release();
  const startSkewNs =
    releaseANs > releaseBNs ? releaseANs - releaseBNs : releaseBNs - releaseANs;

  const [outcomeA, outcomeB] = await Promise.all([runnerA.done, runnerB.done]);

  // 清理沙箱（Round 结束后环境销毁，P0-8 / 无跨 Round 持久化）
  cleanupSandbox(sandboxA.dir);
  cleanupSandbox(sandboxB.dir);

  return {
    a: outcomeA,
    b: outcomeB,
    releaseANs,
    releaseBNs,
    startSkewNs,
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
