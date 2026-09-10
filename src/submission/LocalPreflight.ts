/**
 * Local Preflight —— 参赛者本地自检内核（V1.1 Competitor Kit §11/§12）
 *
 * 设计约束（§12）：
 *   **本地自检不得重新实现 Judge。**
 *   这里调用的每一段判定都是平台生产路径上的**同一个实现**：
 *
 *     inspectPackage()          ← src/submission/Package.ts（官方 Preflight 用的包校验）
 *     buildPublicState()        ← src/core/InputProtocol.ts（官方输入序列化）
 *     buildRevealState()        ← 同上
 *     prepareSandbox()/spawnRunner() ← src/runner/SandboxRunner.ts（官方沙箱与启动壳）
 *     parseResultFile()         ← 同上（result.json 的 schema 与键白名单）
 *     parseCanonicalDSL()       ← src/core/Ast.ts（DSL 结构校验）
 *     validateAttackFunction()  ← src/core/Validator.ts（函数合法性）
 *     firingDomain()            ← src/core/Rules.ts（有效攻击范围）
 *
 *   因此「本地自检规则 == 官方 Preflight 规则」不是承诺，而是**同一份代码**。
 *   本文件只负责：搭一个 decoy 世界、跑一遍沙箱、把上述函数的结果整理成分节报告。
 *
 * 与官方 Preflight 的**唯一**差异是 decoy 世界的地图种子（本地固定种子），
 * 这不影响任何判定规则 —— 判定只依赖「函数 + 该方 Shooter」。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNode, parseCanonicalDSL } from '../core/Ast';
import { buildPublicState, buildRevealState } from '../core/InputProtocol';
import { COMPUTE_TIMEOUT_MS, MEMORY_LIMIT_MB, firingDomain } from '../core/Rules';
import { validateAttackFunction } from '../core/Validator';
import { generateMapOrNull } from '../map/MapGenerator';
import {
  cleanupSandbox,
  defaultSandboxRoot,
  parseResultFile,
  prepareSandbox,
  sandboxExecAvailable,
  spawnRunner,
} from '../runner';
import { ENTRY_FILENAME } from './Manifest';
import { PackageInspection, inspectPackage } from './Package';

/** 分节名与 `ALGORITHM_REQUIREMENTS.md` §12 的报告格式一一对应 */
export const CHECK_SECTIONS = [
  'Entrypoint',
  'Package',
  'CLI / startup',
  'Runtime',
  'Input',
  'Result JSON',
  'DSL',
  'Function legality',
  'Timeout',
] as const;
export type CheckSection = (typeof CHECK_SECTIONS)[number];

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface LocalCheck {
  section: CheckSection;
  status: CheckStatus;
  /** 一行人类可读结论（成功时说明「检查了什么」） */
  detail: string;
  errors: string[];
}

export interface TeamReport {
  team: 'A' | 'B';
  checks: LocalCheck[];
}

export interface LocalPreflightReport {
  ok: boolean;
  dir: string;
  /** 用于自检的 decoy 世界（与任何正式比赛无关） */
  world: { seed: number; mapSeed: number; obstacles: number; points: number };
  teams: TeamReport[];
  inspection: PackageInspection;
}

export interface LocalPreflightOptions {
  teams?: Array<'A' | 'B'>;
  timeoutMs?: number;
  memoryLimitMb?: number;
  sandboxRoot?: string;
  /** 额外禁止读取的路径（默认禁止整个平台仓库，与官方 Preflight 同口径） */
  denyReadPaths?: string[];
}

/**
 * 本地自检专用 decoy 种子。
 *
 * 刻意是一个**常量**：自检必须可复现（同样的包 → 同样的世界 → 同样的结论）。
 * 它不与任何 `matchId` 派生，因此不可能与正式比赛的 decoy/比赛世界相同。
 */
export const LOCAL_PREFLIGHT_SEED = 20250111;
const LOCAL_POINT_COUNT = 8;
const LOCAL_DIFFICULTY = 'medium' as const;

function fail(section: CheckSection, detail: string, errors: string[]): LocalCheck {
  return { section, status: 'FAIL', detail, errors };
}
function pass(section: CheckSection, detail: string): LocalCheck {
  return { section, status: 'PASS', detail, errors: [] };
}
function skip(section: CheckSection, detail: string): LocalCheck {
  return { section, status: 'SKIP', detail, errors: [] };
}

/**
 * 跑一次参赛算法（单队、真实沙箱），返回分节检查结果。
 *
 * 单队运行而非 `runDuel`：本地自检没有对手，也不需要先手/取消语义。
 * 沙箱准备、启动壳、GO 门控、结果解析全部走生产函数。
 */
async function checkOneTeam(
  team: 'A' | 'B',
  dir: string,
  inspection: PackageInspection,
  input: { publicJson: string; revealJson: string },
  world: { teamA: { x: number; y: number }[]; teamB: { x: number; y: number }[] },
  opts: Required<Pick<LocalPreflightOptions, 'timeoutMs' | 'memoryLimitMb'>> & {
    sandboxRoot: string;
    denyReadPaths: string[];
  }
): Promise<LocalCheck[]> {
  const checks: LocalCheck[] = [];
  const shooter = team === 'A' ? world.teamA[0] : world.teamB[0];

  const sandbox = prepareSandbox({
    sandboxRoot: opts.sandboxRoot,
    matchId: `local-preflight-${process.pid}`,
    roundNumber: 0,
    team,
    packageDir: dir,
    entry: ENTRY_FILENAME,
    input,
    memoryLimitMb: opts.memoryLimitMb,
    denyReadPaths: opts.denyReadPaths,
  });

  try {
    const runner = spawnRunner({
      team,
      sandbox,
      timeoutMs: opts.timeoutMs,
      memoryLimitMb: opts.memoryLimitMb,
    });

    // ---- CLI / startup：READY 握手 ----
    let readyOk = true;
    let readyError = '';
    try {
      await runner.ready;
    } catch (e) {
      readyOk = false;
      readyError = (e as Error).message;
    }

    if (!readyOk) {
      runner.cancel();
      const outcome = await runner.done;
      // READY 之前退出 = 启动契约不成立：后续分节全部 SKIP（无从判定）
      checks.push(
        fail(
          'CLI / startup',
          '算法进程未完成 READY 握手（启动失败 / 输入绑定校验失败 / 未按四个参数启动）',
          [readyError || outcome.error || 'READY 握手失败']
        )
      );
      for (const s of ['Input', 'Result JSON', 'DSL', 'Function legality', 'Timeout'] as const) {
        checks.push(skip(s, '启动失败，未执行该检查'));
      }
      return checks;
    }

    const released = runner.release();
    const outcome = await runner.done;
    checks.push(
      pass('CLI / startup', `READY 握手成功，GO 已释放（release_ns=${released.toString()}）`)
    );

    // ---- Input：两份输入文件已按官方协议写入并绑定 ----
    // bootstrap 在 READY 之前**独立**复核过 sha256 绑定，因此 READY 成功
    // 本身就是「输入合法且配对」的证据。
    checks.push(
      pass(
        'Input',
        `public_state.json (${Buffer.byteLength(input.publicJson)} B) + reveal_state.json ` +
          `(${Buffer.byteLength(input.revealJson)} B)，sha256 绑定已由启动壳复核`
      )
    );

    // ---- Result JSON：schema + 键白名单 ----
    if (!outcome.success || outcome.resultJson === null) {
      checks.push(
        fail('Result JSON', `算法未产出合法的 output/result.json（errorCode=${outcome.errorCode}）`, [
          outcome.error ?? '未知错误',
        ])
      );
      for (const s of ['DSL', 'Function legality', 'Timeout'] as const) {
        checks.push(skip(s, '未产出合法结果，未执行该检查'));
      }
      return checks;
    }
    const parsed = parseResultFile(outcome.resultJson);
    if (!parsed.ok) {
      checks.push(fail('Result JSON', 'output/result.json 结构不合法', [parsed.error]));
      for (const s of ['DSL', 'Function legality', 'Timeout'] as const) {
        checks.push(skip(s, '结果结构不合法，未执行该检查'));
      }
      return checks;
    }
    checks.push(pass('Result JSON', `schema_version="1.1"，键集合恰好为 {schema_version, dsl}`));

    // ---- DSL：结构校验 ----
    const dsl = parseCanonicalDSL(parsed.dslText);
    if (!dsl.ok || !dsl.ast) {
      checks.push(
        fail(
          'DSL',
          'dsl 未通过结构校验',
          dsl.issues.map((i) => `${i.code}: ${i.message}`)
        )
      );
      checks.push(skip('Function legality', 'DSL 结构不合法，未执行该检查'));
    } else {
      const ast: CanonicalNode = dsl.ast;
      const shape = describeAst(ast);
      checks.push(pass('DSL', `结构合法（${shape}）`));

      // ---- Function legality：数值校验（与官方 Preflight 同一函数）----
      const domain = firingDomain(shooter.x, team);
      const legality = validateAttackFunction(ast, domain, shooter);
      if (legality.valid) {
        checks.push(
          pass(
            'Function legality',
            `f(${fmt(shooter.x)}) = ${fmt(shooter.y)}（Shooter 残差 ${legality.metrics.shooterResidual.toExponential(2)}），` +
              `凸性变号 ${legality.metrics.convexityChanges}，采样 ${legality.metrics.sampleCount} 点`
          )
        );
      } else {
        checks.push(
          fail(
            'Function legality',
            `函数在攻击范围 [${fmt(domain[0])}, ${fmt(domain[1])}] 上不合法`,
            legality.issues.map((i) => `${i.code}: ${i.message}`)
          )
        );
      }
    }

    // ---- Timeout：真实耗时 ----
    if (outcome.errorCode === 'TIMEOUT') {
      checks.push(fail('Timeout', `超过 ${opts.timeoutMs} ms`, [outcome.error ?? 'TIMEOUT']));
    } else if (outcome.computeTimeMs > opts.timeoutMs) {
      checks.push(
        fail('Timeout', `耗时 ${outcome.computeTimeMs.toFixed(1)} ms 超过上限 ${opts.timeoutMs} ms`, [])
      );
    } else {
      checks.push(
        pass('Timeout', `耗时 ${outcome.computeTimeMs.toFixed(1)} ms（上限 ${opts.timeoutMs} ms）`)
      );
    }

    return checks;
  } finally {
    cleanupSandbox(sandbox.dir);
  }
}

function describeAst(ast: CanonicalNode): string {
  const count = (n: CanonicalNode): number => 1 + (n.args ?? []).reduce((s, c) => s + count(c), 0);
  return `${count(ast)} 个节点`;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

/**
 * 对**一个算法目录**执行完整的本地自检（§11 的九个分节）。
 *
 * 默认 A、B 各跑一次：同一份代码在两个队别下必须都能正确定位自己的 Shooter。
 */
export async function validateSubmission(
  dir: string,
  opts: LocalPreflightOptions = {}
): Promise<LocalPreflightReport> {
  const target = path.resolve(dir);
  const timeoutMs = opts.timeoutMs ?? COMPUTE_TIMEOUT_MS;
  const memoryLimitMb = opts.memoryLimitMb ?? MEMORY_LIMIT_MB;
  const sandboxRoot = opts.sandboxRoot ?? defaultSandboxRoot();
  const teams = opts.teams ?? (['A', 'B'] as const);

  const inspection = inspectPackage(target);

  // ---- decoy 世界：与官方 Preflight 同构，只是种子固定 ----
  const map = generateMapOrNull({
    seed: LOCAL_PREFLIGHT_SEED,
    pointCount: LOCAL_POINT_COUNT,
    difficulty: LOCAL_DIFFICULTY,
  });
  const repoRoot = path.resolve(__dirname, '..', '..');
  const denyReadPaths = opts.denyReadPaths ?? [repoRoot, target];

  const world = map
    ? { seed: LOCAL_PREFLIGHT_SEED, mapSeed: map.seed, obstacles: map.obstacles.length, points: map.teamA.length + map.teamB.length }
    : { seed: LOCAL_PREFLIGHT_SEED, mapSeed: -1, obstacles: 0, points: 0 };

  const staticChecks: LocalCheck[] = [];
  staticChecks.push(
    inspection.files.some((f) => f.relPath === ENTRY_FILENAME)
      ? pass('Entrypoint', `包根目录存在 ${ENTRY_FILENAME}`)
      : fail('Entrypoint', `包根目录缺少 ${ENTRY_FILENAME}`, [
          `V1.1 §3：入口文件名固定为 ${ENTRY_FILENAME}，且必须位于包根目录`,
        ])
  );
  staticChecks.push(
    inspection.valid
      ? pass('Package', `${inspection.files.length} 个文件 / ${inspection.totalBytes} 字节 / hash=${(inspection.hash ?? '').slice(0, 12)}…`)
      : fail('Package', '包结构校验失败', inspection.errors)
  );
  staticChecks.push(
    sandboxExecAvailable()
      ? pass('Runtime', 'sandbox-exec 可用，算法将在与官方比赛相同的沙箱内运行')
      : fail('Runtime', '当前机器无法启用 sandbox-exec，自检结论不可信', [
          '请在与比赛相同的 macOS 环境运行；官方 Preflight 同样依赖 sandbox-exec',
        ])
  );

  const teamsReport: TeamReport[] = [];
  for (const team of teams) {
    const checks: LocalCheck[] = [...staticChecks];

    if (!inspection.valid || !map) {
      for (const s of ['CLI / startup', 'Input', 'Result JSON', 'DSL', 'Function legality', 'Timeout'] as const) {
        checks.push(skip(s, inspection.valid ? '无法生成 decoy 世界' : '包结构不合法，未执行该检查'));
      }
      teamsReport.push({ team, checks });
      continue;
    }

    const points = [
      ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, x: p.x, y: p.y, alive: true })),
      ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, x: p.x, y: p.y, alive: true })),
    ];
    const publicState = buildPublicState({
      matchId: `local-preflight-${process.pid}`,
      round: 0,
      points,
    });
    const revealState = buildRevealState({
      matchId: `local-preflight-${process.pid}`,
      round: 0,
      publicStateSha256: publicState.sha256,
      shooters: { A: 'A1', B: 'B1' },
      obstacles: map.obstacles,
    });

    const runChecks = await checkOneTeam(
      team,
      target,
      inspection,
      { publicJson: publicState.json, revealJson: revealState.json },
      { teamA: map.teamA, teamB: map.teamB },
      { timeoutMs, memoryLimitMb, sandboxRoot, denyReadPaths }
    );
    checks.push(...runChecks);
    teamsReport.push({ team, checks });
  }

  const ok = teamsReport.every((t) => t.checks.every((c) => c.status !== 'FAIL'));
  return { ok, dir: target, world, teams: teamsReport, inspection };
}

/** 报告的一行式摘要（CLI / 测试共用） */
export function summarize(report: LocalPreflightReport): string {
  const lines: string[] = [];
  for (const t of report.teams) {
    lines.push(`── Team ${t.team} ──`);
    for (const c of t.checks) {
      lines.push(`  ${c.section.padEnd(18)} ${c.status.padEnd(4)} ${c.detail}`);
      for (const e of c.errors) lines.push(`      ↳ ${e}`);
    }
  }
  return lines.join('\n');
}

/** 目录是否存在（CLI 的前置检查，避免把「路径打错」报成算法问题） */
export function assertDirectory(dir: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`目录不存在: ${dir}`);
  }
}
