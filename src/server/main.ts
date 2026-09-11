/**
 * 本地比赛服务入口。
 *
 *   npm run app       → 构建前端 → 起服务 → 开浏览器
 *   npm run app:dev   → 起服务 + 派生 vite dev server（HMR）
 *
 * 只绑定 `127.0.0.1`。端口默认 17800，被占用时自动换一个空闲端口并把实际
 * URL 打印出来（**不静默换端口** —— 用户必须知道该开哪个地址）。
 *
 * 测试与演练通过 `--slots` / `--artifacts` / `--port 0` / `--no-open` 驱动它；
 * 与终端裁判台一样，**传了临时目录就绝不会碰仓库里的 `algorithms/`**。
 */

import * as http from 'http';
import * as path from 'path';
import { spawn } from 'child_process';
import { MatchSession } from './session';
import { createRequestHandler } from './http';
import { attachWebSocket } from './ws';
import { openBrowser } from './open';
import {
  CANONICAL_SLOT_ROOT,
  RUNTIME_SLOT_ROOT,
  prepareRuntimeSlots,
  seedRuntimeSlots,
} from '../submission/Slot';
import { DEFAULT_PORT, WireDifficulty } from './protocol';

// 槽位语义（canonical fixture vs 运行期投递点）统一收口在 `src/submission/Slot.ts`，
// 三个入口（Web / 终端 judge / operator）共用同一套定义 —— 两个入口指向不同
// 槽位根会让裁判投递一份算法、比赛却跑另一份（Final Re-Gate P1）。
export { CANONICAL_SLOT_ROOT, RUNTIME_SLOT_ROOT, prepareRuntimeSlots, seedRuntimeSlots };

const PLATFORM_ROOT = path.resolve(__dirname, '..', '..');

export interface StartOptions {
  port?: number;
  slotRoot?: string;
  artifactRoot?: string;
  sandboxRoot?: string;
  distDir?: string;
  seed?: number;
  pointCount?: number;
  difficulty?: WireDifficulty;
}

export interface RunningServer {
  port: number;
  url: string;
  session: MatchSession;
  close(): Promise<void>;
}

/** 启动服务；端口占用时回落到一个空闲端口 */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const slotRoot = opts.slotRoot ?? RUNTIME_SLOT_ROOT;
  const artifactRoot = opts.artifactRoot ?? path.join(process.cwd(), 'artifacts');
  const distDir = opts.distDir ?? path.join(PLATFORM_ROOT, 'web', 'dist');

  // 只在用**默认**槽位根时播种：显式传了 --slots 的调用方（测试、演练）
  // 自己负责准备目录，不该被仓库里的 canonical 数据干扰。
  if (!opts.slotRoot) prepareRuntimeSlots(slotRoot);

  const session = new MatchSession({
    slotRoot,
    artifactRoot,
    ...(opts.sandboxRoot ? { sandboxRoot: opts.sandboxRoot } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.pointCount !== undefined ? { pointCount: opts.pointCount } : {}),
    ...(opts.difficulty !== undefined ? { difficulty: opts.difficulty } : {}),
  });

  const handler = createRequestHandler({ session, artifactRoot, distDir });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  const hub = attachWebSocket(server, session);

  const listen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        reject(e);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });

  let actualPort: number;
  try {
    actualPort = await listen(opts.port ?? DEFAULT_PORT);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EADDRINUSE' || opts.port === 0) throw e;
    actualPort = await listen(0);
  }

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    session,
    close: async () => {
      session.close();
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ============================================================================
// CLI
// ============================================================================

interface CliOptions extends StartOptions {
  open: boolean;
  dev: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = { open: true, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => argv[++i];
    switch (arg) {
      case '--port': o.port = Number(next()); break;
      case '--slots': o.slotRoot = path.resolve(next()); break;
      case '--artifacts': o.artifactRoot = path.resolve(next()); break;
      case '--sandbox': o.sandboxRoot = path.resolve(next()); break;
      case '--dist': o.distDir = path.resolve(next()); break;
      case '--seed': o.seed = Number(next()); break;
      case '--points': o.pointCount = Number(next()); break;
      case '--difficulty': o.difficulty = next() as WireDifficulty; break;
      case '--no-open': o.open = false; break;
      case '--dev': o.dev = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知选项: ${arg}`);
    }
  }
  return o;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const running = await startServer(opts);

  console.log('\n几何斗殴 —— 本地比赛服务');
  console.log(`  裁判台   ${running.url}/judge`);
  console.log(`  观众大屏 ${running.url}/spectator`);
  console.log(`  回放     ${running.url}/replay/<matchId>`);
  console.log(`  算法槽位 ${opts.slotRoot ?? RUNTIME_SLOT_ROOT}`);
  console.log(`           （canonical 只读副本：${CANONICAL_SLOT_ROOT}）`);
  console.log(`  产物目录 ${opts.artifactRoot ?? path.join(process.cwd(), 'artifacts')}`);
  console.log(`  终端裁判台仍可用：npm run judge\n`);

  if (opts.dev) {
    // 开发模式：派生 vite dev server（HMR），由它把 /api 与 /ws 代理回本服务
    const vite = spawn('npx', ['vite', '--config', path.join(PLATFORM_ROOT, 'web', 'vite.config.ts')], {
      cwd: PLATFORM_ROOT,
      stdio: 'inherit',
      env: { ...process.env, GB_SERVER_PORT: String(running.port) },
    });
    vite.on('exit', () => void shutdown());
    console.log('  开发模式：前端由 vite 提供（见上方 vite 输出的地址）\n');
  } else if (opts.open) {
    openBrowser(`${running.url}/judge`);
  }

  let closing = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (closing) return;
    closing = true;
    // 兜底：close() 自身若卡住也必须让进程退出 —— 产物已逐轮落盘，不会丢
    const force = setTimeout(() => process.exit(code), 3000);
    force.unref?.();
    await running.close();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  // 最后一道闸：**只记录并安全退出**，绝不吞掉异常继续跑。
  //
  // 「继续运行」听起来更顽强，实际更危险：比赛系统在未知状态下推进，会产出
  // 不可信的判定与产物。逐轮落盘保证了已打完的回合不丢，重启即可继续。
  // 注意这不替代 HTTP/WS 侧的局部兜底 —— 单个坏请求不该走到这里。
  const fatal = (kind: string) => (e: unknown): void => {
    console.error(`\n[${kind}] 未捕获的异常，服务即将退出：`);
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    void shutdown(1);
  };
  process.on('unhandledRejection', fatal('unhandledRejection'));
  process.on('uncaughtException', fatal('uncaughtException'));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`启动失败: ${(e as Error).message}`);
    process.exit(1);
  });
}
