/**
 * official-starter —— 官方 Starter Algorithm 契约（P0-3）
 *
 * 覆盖 Finding: P0-3（starter 的 add 传了 3 个参数、函数不经过 Shooter，
 *                    生成的 DSL 必然非法，任何新参赛者照抄都会直接失败）
 *
 * 契约：官方 starter 必须在任意合法地图 / 任意 Shooter 上输出
 *       通过 Canonical Validator 的 DSL，且严格经过自己的 Shooter。
 */

import * as path from 'path';
import { parseCanonicalDSL } from '../src/core/Ast';
import { firingDomain, EMITTERS } from '../src/core/Rules';
import { validateAttackFunction } from '../src/core/Validator';
import { RoundStateCore } from '../src/core/RoundState';
import { generateMapOrNull } from '../src/map/MapGenerator';
import { inspectPackage } from '../src/submission/Package';
import { assert, assertClose, assertEqual, runAll, test } from './harness';
import { runSolver, runnerInputFromCore } from './protocol-fixture';

const STARTER_DIR = path.join(__dirname, '..', 'starter');
const STARTER_ENTRY = path.join(STARTER_DIR, 'solver.py');

function coreFor(seed: number, pointCount: number, difficulty: 'easy' | 'medium' | 'hard'): RoundStateCore {
  const map = generateMapOrNull({ seed, pointCount, difficulty });
  assert(map, `种子 ${seed} 应能生成地图`);
  return {
    round: 1,
    mapSeed: map!.seed,
    mapHash: map!.stateHash,
    obstacles: map!.obstacles,
    points: [
      ...map!.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, position: p })),
      ...map!.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, position: p })),
    ],
    // Rule Revision 3 §3/§4：发射锚点是固定 Emitter，不是从点表里挑出来的点。
    emitters: {
      A: { id: 'A0', position: EMITTERS.A },
      B: { id: 'B0', position: EMITTERS.B },
    },
    teamAXRange: [-20, -4],
    teamBXRange: [4, 20],
  };
}

/** 以 V1.1 契约跑一次 starter（两份 JSON 文件 + --team） */
function runStarter(core: RoundStateCore, team: 'A' | 'B'): string {
  return runSolver(STARTER_ENTRY, team, runnerInputFromCore(core, 'STARTER-TEST'));
}

test('official-starter: 包结构与 manifest 合法', () => {
  const pkg = inspectPackage(STARTER_DIR);
  assert(pkg.valid, `starter 包必须合法: ${pkg.errors.join('; ')}`);
  assertEqual(pkg.manifest?.entry, 'solver.py', 'starter 的 entry 应为 solver.py');
  assert(pkg.hash, 'starter 包必须有稳定哈希');
});

test('official-starter: 在所有难度 / 多个种子上输出合法且经过 Shooter 的 DSL', () => {
  const difficulties: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
  let checked = 0;
  for (const difficulty of difficulties) {
    for (let seed = 1; seed <= 12; seed++) {
      const core = coreFor(seed * 977 + 13, 8, difficulty);
      for (const team of ['A', 'B'] as const) {
        const out = runStarter(core, team);
        const parsed = JSON.parse(out);
        assert(parsed && parsed.dsl, `${team} 输出必须含 dsl 字段`);

        const ast = parseCanonicalDSL(parsed.dsl);
        assert(ast.ok && ast.ast, `${team} 的 DSL 必须可解析: ${ast.issues.map((i) => i.code).join(',')}`);

        const shooter = core.emitters[team].position;
        const domain = firingDomain(shooter.x, team);
        const validation = validateAttackFunction(ast.ast!, domain, shooter);
        assert(
          validation.valid,
          `${team} @ ${difficulty} seed=${core.mapSeed} 的 DSL 必须通过 Canonical Validator: ` +
            validation.issues.map((i) => `${i.code}:${i.message}`).join('; ')
        );
        // 硬性条件：函数严格经过自己的 Shooter
        assertClose(
          validation.metrics.shooterResidual,
          0,
          1e-6,
          'starter 的函数必须经过自己的 Shooter（P0-3）'
        );
        checked++;
      }
    }
  }
  assert(checked === 72, `应检查 72 个组合，实际 ${checked}`);
});

test('official-starter: 对手全灭时仍然输出合法 DSL（退化路径）', () => {
  const core = coreFor(4242, 6, 'easy');
  const solo: RoundStateCore = { ...core, points: core.points.filter((p) => p.team === 'A') };
  const out = runStarter(solo, 'A');
  const ast = parseCanonicalDSL(JSON.parse(out).dsl);
  assert(ast.ok && ast.ast, '无敌人时也必须输出合法 DSL');
  const shooter = core.emitters.A.position;
  const v = validateAttackFunction(ast.ast!, firingDomain(shooter.x, 'A'), shooter);
  assert(v.valid, `退化路径必须合法: ${v.issues.map((i) => i.code).join(',')}`);
});

test('official-starter: 相同输入产生字节级一致的输出（可复现）', () => {
  const core = coreFor(20260909, 8, 'medium');
  const a = runStarter(core, 'A');
  const b = runStarter(core, 'A');
  assertEqual(a, b, 'starter 必须是确定性的');
});

void runAll('official-starter');
