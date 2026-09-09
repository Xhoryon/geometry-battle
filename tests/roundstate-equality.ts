/**
 * roundstate-equality —— 双方输入必须完全一致
 *
 * 覆盖 Finding: P0-2（Runner 收到的状态与 Judge 使用的不一致）、
 *              P2-2（A/B 输入不一致）、P2-20（无 state hash）
 */

import { generateMap } from '../src/map/MapGenerator';
import {
  RoundStateCore,
  canonicalCoreJson,
  computeStateHash,
  runnerPayloadJson,
  runnerPayloadWithoutTeamId,
  toRunnerPayload,
} from '../src/core/RoundState';
import { assert, assertEqual, runAll, test } from './harness';

function makeCore(): RoundStateCore {
  const map = generateMap({ seed: 90210, pointCount: 8, difficulty: 'medium' });
  return {
    round: 1,
    mapSeed: map.seed,
    mapHash: map.stateHash,
    obstacles: map.obstacles,
    points: [
      ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, position: p })),
      ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, position: p })),
    ],
    shooters: {
      A: { id: 'A1', position: map.teamA[0] },
      B: { id: 'B1', position: map.teamB[0] },
    },
    teamAXRange: [-20, -4],
    teamBXRange: [4, 20],
  };
}

test('roundstate-equality: A/B payload 逐字节一致（除 team_id）', () => {
  const core = makeCore();
  const a = runnerPayloadWithoutTeamId(core, 'A');
  const b = runnerPayloadWithoutTeamId(core, 'B');
  assertEqual(a, b, '去掉 team_id 后双方输入必须逐字节相同');

  const rawA = JSON.parse(runnerPayloadJson(core, 'A'));
  const rawB = JSON.parse(runnerPayloadJson(core, 'B'));
  assertEqual(rawA.team_id, 'A', 'A 的 team_id 应为 A');
  assertEqual(rawB.team_id, 'B', 'B 的 team_id 应为 B');
  assertEqual(rawA.state_hash, rawB.state_hash, '双方 state_hash 必须相同');
});

test('roundstate-equality: state hash 稳定且对任何改动敏感', () => {
  const core = makeCore();
  const h1 = computeStateHash(core);
  const h2 = computeStateHash(makeCore());
  assertEqual(h1, h2, '同一 core 的 hash 必须稳定（确定性序列化）');
  assertEqual(h1.length, 64, 'hash 应为 sha256 十六进制');

  const moved: RoundStateCore = {
    ...core,
    shooters: { ...core.shooters, A: { id: 'A1', position: { x: core.shooters.A.position.x + 1e-9, y: core.shooters.A.position.y } } },
  };
  assert(computeStateHash(moved) !== h1, '任何输入变化都必须改变 hash');

  const roundChanged: RoundStateCore = { ...core, round: 2 };
  assert(computeStateHash(roundChanged) !== h1, 'round 变化必须改变 hash');
});

test('roundstate-equality: points 顺序不影响 hash（规范排序）', () => {
  const core = makeCore();
  const shuffled: RoundStateCore = { ...core, points: [...core.points].reverse() };
  assertEqual(computeStateHash(shuffled), computeStateHash(core), 'points 顺序不应影响 hash');
  assertEqual(canonicalCoreJson(shuffled), canonicalCoreJson(core), '规范 JSON 应忽略输入顺序');
});

test('roundstate-equality: payload 不泄漏宿主信息', () => {
  const core = makeCore();
  const json = runnerPayloadJson(core, 'A');
  for (const leak of ['/Users', '/private', '/tmp', 'packageDir', 'sealed', 'manifest', 'solver.py']) {
    assert(!json.includes(leak), `payload 不应包含宿主信息 "${leak}"`);
  }
  const parsed = JSON.parse(json);
  assert(parsed.field, 'payload 应包含场地范围');
  assert(Array.isArray(parsed.obstacles), 'payload 应包含障碍物');
  assert(Array.isArray(parsed.points), 'payload 应包含存活点');
});

test('roundstate-equality: toRunnerPayload 携带正确的 hash', () => {
  const core = makeCore();
  const payload = toRunnerPayload(core, 'B');
  assertEqual(payload.state_hash, computeStateHash(core), 'payload.state_hash 应等于 core 的 hash');
  assertEqual(payload.team_id, 'B', 'team_id 应为 B');
});

void runAll('roundstate-equality');
