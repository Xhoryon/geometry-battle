/**
 * input-protocol —— V1.1 两阶段输入协议（规范 §4-§12、§20、§22）
 *
 * 覆盖的规则：
 *   §6  public_state 不得包含隐藏信息（障碍物 / seed / Shooter）
 *   §7  Shooter 不出现在 public_state
 *   §9  reveal_state 是 Delta，不复制 points / map
 *   §10 public_state_sha256 绑定
 *   §11 两份文件对 A / B 字节级完全相同
 *   §12 队别不经 JSON 传递（本模块的构造函数根本不接受 team）
 *   §20 roundStateHash = SHA256(publicHash + revealHash)
 *
 * 每条负向断言都配一条**正向对照** —— 否则「没找到 obstacles」可能只是因为
 * 提取器本身失效（同 runner-isolation 的假阳性防护写法）。
 */

import * as crypto from 'crypto';
import { generateMap } from '../src/map/MapGenerator';
import { Obstacle } from '../src/obstacle/Obstacle';
import { FIELD } from '../src/core/Rules';
import {
  PROTOCOL_VERSION,
  PublicStatePoint,
  buildPublicState,
  buildRevealState,
  derivePreflightSeed,
  roundStateHash,
  sha256Hex,
  verifyPublicState,
  verifyRevealBinding,
} from '../src/core/InputProtocol';
import { assert, assertEqual, runAll, test } from './harness';

const MATCH_ID = 'MATCH-001';

function roster(): PublicStatePoint[] {
  return [
    { id: 'A1', team: 'A', x: -14, y: 6, alive: true },
    { id: 'A2', team: 'A', x: -10, y: -3, alive: false }, // 死点必须仍在名单里（§5）
    { id: 'B1', team: 'B', x: 9, y: 5, alive: true },
    { id: 'B2', team: 'B', x: 16, y: -1, alive: true },
  ];
}

function obstacles(): Obstacle[] {
  return [
    { type: 'rectangle', xmin: -1, xmax: 2, ymin: -5, ymax: 1 },
    { type: 'circle', center: [4, 3], radius: 2 },
  ];
}

function build(): { pub: ReturnType<typeof buildPublicState>; rev: ReturnType<typeof buildRevealState> } {
  const pub = buildPublicState({ matchId: MATCH_ID, round: 4, points: roster() });
  const rev = buildRevealState({
    matchId: MATCH_ID,
    round: 4,
    publicStateSha256: pub.sha256,
    obstacles: obstacles(),
  });
  return { pub, rev };
}

test('input-protocol: 两份文件的字段集合是封闭白名单', () => {
  const { pub, rev } = build();
  const p = JSON.parse(pub.json);
  const r = JSON.parse(rev.json);

  // Rule Revision 3 §6：`emitters` **新增在 public**（固定 Emitter 是公开结构），
  // 并从 reveal 中移除 `shooters`（§5：不再有每轮 Shooter Selection）。
  assertEqual(
    Object.keys(p).sort(),
    ['emitters', 'map', 'match_id', 'points', 'round', 'schema_version'],
    'public 顶层字段'
  );
  assertEqual(Object.keys(p.map).sort(), ['xmax', 'xmin', 'ymax', 'ymin'], 'public.map 字段');
  assertEqual(Object.keys(p.points[0]).sort(), ['alive', 'id', 'team', 'x', 'y'], 'public.points[] 字段');
  assertEqual(Object.keys(p.emitters).sort(), ['A', 'B'], 'public.emitters 字段');
  assertEqual(Object.keys(p.emitters.A).sort(), ['x', 'y'], 'public.emitters.A 字段');

  assertEqual(
    Object.keys(r).sort(),
    ['match_id', 'obstacles', 'public_state_sha256', 'round', 'schema_version'],
    'reveal 顶层字段（不再有 shooters）'
  );

  assertEqual(p.schema_version, PROTOCOL_VERSION, 'schema_version 必须与协议版本一致');
  assertEqual(r.schema_version, PROTOCOL_VERSION, 'reveal 的 schema_version 必须一致');
  assertEqual(p.map.xmin, FIELD.xMin, 'map 边界必须来自 Rules.FIELD（唯一数值来源）');
  assertEqual(p.map.ymax, FIELD.yMax, 'map 边界必须来自 Rules.FIELD');
});

test('input-protocol: public 不包含任何隐藏信息（§6/§7）', () => {
  const { pub } = build();
  // 注意：点的 id（A1/B2）与 `emitters` **本来就该出现** —— Emitter 是整场公开的
  // 固定结构（Rule Revision 3 §6）；被禁止的是障碍物 / seed 的痕迹。
  for (const forbidden of [
    'obstacles', 'obstacle', 'rectangle', 'circle', '"type"', '"id":"O',
    'radius', '"cx"', '"cy"',
    'seed', 'map_seed', 'mapHash', 'map_hash', 'state_hash',
    'shooters', 'public_state_sha256',
  ]) {
    assert(!pub.json.includes(forbidden), `public_state 不得包含 "${forbidden}"`);
  }
  assert(!pub.json.includes('"O1"'), 'public_state 不得包含障碍物 id');
});

test('input-protocol: 正向对照 —— reveal 确实包含隐藏信息（否则上面的断言是空转）', () => {
  const { rev } = build();
  for (const expected of ['obstacles', 'public_state_sha256', '"O1"', '"O2"', 'radius', '"cx"']) {
    assert(rev.json.includes(expected), `reveal_state 必须包含 "${expected}"`);
  }
  // 反向对照：reveal 不得再夹带任何 Shooter 概念（§5）
  assert(!rev.json.includes('shooters'), 'reveal_state 不得再包含 shooters');
  assert(!rev.json.includes('emitter'), 'reveal_state 不得包含 emitters（那是 public 的内容）');
});

test('input-protocol: reveal 是 Delta —— 不复制 points / map / alive（§9）', () => {
  const { rev } = build();
  const r = JSON.parse(rev.json);
  assert(r.points === undefined, 'reveal 不得重复 points');
  assert(r.map === undefined, 'reveal 不得重复 map');
  assert(r.alive === undefined, 'reveal 不得重复 alive 状态');
});

test('input-protocol: 两份文件对 A/B 字节级相同（§11/§12）', () => {
  // 构造函数不接受 team —— 队别在类型层面就无法进入字节。
  const a = buildPublicState({ matchId: MATCH_ID, round: 4, points: roster() });
  const b = buildPublicState({ matchId: MATCH_ID, round: 4, points: roster() });
  assertEqual(a.json, b.json, 'public_state 必须逐字节相同');
  assertEqual(a.sha256, b.sha256, 'public_state 的 hash 必须相同');

  const ra = buildRevealState({
    matchId: MATCH_ID, round: 4, publicStateSha256: a.sha256, obstacles: obstacles(),
  });
  const rb = buildRevealState({
    matchId: MATCH_ID, round: 4, publicStateSha256: b.sha256, obstacles: obstacles(),
  });
  assertEqual(ra.json, rb.json, 'reveal_state 必须逐字节相同');
  assertEqual(ra.sha256, rb.sha256, 'reveal_state 的 hash 必须相同');
});

test('input-protocol: sha256 就是对文件字节的哈希（可用 shasum 复核）', () => {
  const { pub, rev } = build();
  assertEqual(pub.sha256, crypto.createHash('sha256').update(pub.json, 'utf8').digest('hex'), 'public hash 必须等于独立重算值');
  assertEqual(rev.sha256, crypto.createHash('sha256').update(rev.json, 'utf8').digest('hex'), 'reveal hash 必须等于独立重算值');
  assertEqual(pub.sha256.length, 64, 'sha256 应为 64 位十六进制');
  assert(verifyPublicState(pub.json, pub.sha256), 'verifyPublicState 对自身必须通过');
  assert(!verifyPublicState(pub.json + ' ', pub.sha256), 'verifyPublicState 对改动的字节必须失败');
});

test('input-protocol: roundStateHash = SHA256(publicHash + revealHash)（§20）', () => {
  const { pub, rev } = build();
  const h = roundStateHash(pub.sha256, rev.sha256);
  assertEqual(h, sha256Hex(pub.sha256 + rev.sha256), 'roundStateHash 定义');
  assertEqual(h.length, 64, 'roundStateHash 应为 sha256 十六进制');
  assert(roundStateHash(rev.sha256, pub.sha256) !== h, '顺序不同的两个 hash 必须得到不同结果');
});

test('input-protocol: hash 对任何输入改动敏感', () => {
  const base = buildPublicState({ matchId: MATCH_ID, round: 4, points: roster() });

  const aliveFlipped = roster();
  aliveFlipped[0] = { ...aliveFlipped[0], alive: false };
  assert(buildPublicState({ matchId: MATCH_ID, round: 4, points: aliveFlipped }).sha256 !== base.sha256, 'alive 变化必须改变 hash');

  const nudged = roster();
  nudged[0] = { ...nudged[0], x: nudged[0].x + 1e-9 };
  assert(buildPublicState({ matchId: MATCH_ID, round: 4, points: nudged }).sha256 !== base.sha256, '1e-9 位移必须改变 hash');

  assert(buildPublicState({ matchId: MATCH_ID, round: 5, points: roster() }).sha256 !== base.sha256, 'round 变化必须改变 hash');
  assert(buildPublicState({ matchId: 'MATCH-002', round: 4, points: roster() }).sha256 !== base.sha256, 'match_id 变化必须改变 hash');

  assertEqual(buildPublicState({ matchId: MATCH_ID, round: 4, points: roster() }).sha256, base.sha256, '同输入必须得到同 hash');
});

test('input-protocol: 死点仍然出现在 points 中且 alive=false（§5）', () => {
  const { pub } = build();
  const p = JSON.parse(pub.json);
  const dead = p.points.find((x: PublicStatePoint) => x.id === 'A2');
  assert(dead, '死点 A2 必须仍然出现在 public_state.points 中');
  assertEqual(dead.alive, false, '死点的 alive 必须为 false');
  assertEqual(p.points.length, roster().length, 'points 必须是完整名单（含死点）');
});

test('input-protocol: reveal 绑定到唯一的 public（§10）', () => {
  const { pub, rev } = build();
  assert(verifyRevealBinding(pub.json, rev.json), '正确配对必须通过');

  const other = buildPublicState({ matchId: MATCH_ID, round: 5, points: roster() });
  assert(!verifyRevealBinding(other.json, rev.json), 'Round 5 的 public 配 Round 4 的 reveal 必须被拒绝');

  const tampered = JSON.parse(rev.json);
  tampered.public_state_sha256 = other.sha256;
  assert(!verifyRevealBinding(pub.json, JSON.stringify(tampered)), '被改写绑定的 reveal 必须被拒绝');

  assert(!verifyRevealBinding(pub.json, '{}'), '缺少 public_state_sha256 必须被拒绝');
  assert(!verifyRevealBinding(pub.json, 'not json'), '非法 JSON 必须被拒绝');
});

test('input-protocol: 序列化是确定性的，非法数值直接抛错', () => {
  const negZero = buildPublicState({
    matchId: MATCH_ID,
    round: 0,
    points: [{ id: 'A1', team: 'A', x: -0, y: 0, alive: true }],
  });
  assert(negZero.json.includes('"x":0'), `-0 必须序列化为 0，实际: ${negZero.json}`);
  // 逐字段核对：不能用 `!json.includes('-0')` —— match_id "MATCH-001" 里就有 "-0"
  assert(!Object.is(JSON.parse(negZero.json).points[0].x, -0), 'x 不得是 -0（否则字节随平台漂移）');

  for (const bad of [NaN, Infinity, -Infinity]) {
    let threw = false;
    try {
      buildPublicState({ matchId: MATCH_ID, round: 0, points: [{ id: 'A1', team: 'A', x: bad, y: 0, alive: true }] });
    } catch {
      threw = true;
    }
    assert(threw, `非有限数值 ${bad} 必须抛错（fail closed）`);
  }

  // 字段顺序固定：同内容不同对象字面量顺序也必须同字节
  const a = buildPublicState({ matchId: MATCH_ID, round: 1, points: roster() });
  const b = buildPublicState({ matchId: MATCH_ID, round: 1, points: roster().map((p) => ({ ...p })) });
  assertEqual(a.json, b.json, '字段顺序必须固定');
});

test('input-protocol: 障碍物转成规范形态（circle → cx/cy/radius，§8）', () => {
  const pub = buildPublicState({ matchId: MATCH_ID, round: 1, points: roster() });
  const rev = buildRevealState({
    matchId: MATCH_ID, round: 1, publicStateSha256: pub.sha256, obstacles: obstacles(),
  });
  const r = JSON.parse(rev.json);
  assertEqual(r.obstacles[0], { id: 'O1', type: 'rectangle', xmin: -1, xmax: 2, ymin: -5, ymax: 1 }, '矩形形态');
  assertEqual(r.obstacles[1], { id: 'O2', type: 'circle', cx: 4, cy: 3, radius: 2 }, '圆形必须转成 cx/cy/radius');
  assert(r.obstacles[1].center === undefined, '不得残留内部的 center 字段');

  let threw = false;
  try {
    buildRevealState({
      matchId: MATCH_ID, round: 1, publicStateSha256: pub.sha256,
      obstacles: [{ type: 'segment', x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
  } catch {
    threw = true;
  }
  assert(threw, '协议外障碍物类型必须抛错，而不是静默透传');
});

test('input-protocol: preflight 的 decoy seed 与比赛 seed 无关', () => {
  const seeds = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const id = `MATCH-${i}`;
    const s = derivePreflightSeed(id);
    assert(Number.isInteger(s) && s >= 0 && s < 1_000_000_000, `decoy seed 必须在合法范围内: ${s}`);
    assertEqual(derivePreflightSeed(id), s, 'decoy seed 必须确定性');
    seeds.add(s);
  }
  assert(seeds.size > 190, `decoy seed 必须随 matchId 分散（实际 ${seeds.size}/200 个不同值）`);

  // decoy 世界同样走两阶段协议，round 固定为 0（hostile-input 用 round==0 区分 preflight）
  const decoy = buildPublicState({
    matchId: 'MATCH-1-preflight',
    round: 0,
    points: [{ id: 'A1', team: 'A', x: -14, y: 6, alive: true }],
  });
  assertEqual(JSON.parse(decoy.json).round, 0, 'decoy public_state 的 round 必须为 0');
});

test('input-protocol: 真实地图也能走完整协议且不泄漏 seed', () => {
  const map = generateMap({ seed: 424242, pointCount: 8, difficulty: 'medium' });
  const points: PublicStatePoint[] = [
    ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, x: p.x, y: p.y, alive: true })),
    ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, x: p.x, y: p.y, alive: true })),
  ];
  const pub = buildPublicState({ matchId: MATCH_ID, round: 1, points });
  assert(!pub.json.includes(String(map.seed)), `public_state 不得包含 map seed ${map.seed}`);
  assert(!pub.json.includes(map.stateHash), 'public_state 不得包含 map hash');

  const rev = buildRevealState({
    matchId: MATCH_ID, round: 1, publicStateSha256: pub.sha256, obstacles: map.obstacles,
  });
  assert(verifyRevealBinding(pub.json, rev.json), '真实地图的配对必须通过');
  assertEqual(JSON.parse(rev.json).obstacles.length, map.obstacles.length, '全部障碍物都必须出现在 reveal 中');
});

void runAll('input-protocol');
