/**
 * roundstate-equality —— 双方输入必须完全一致（V1.1 两阶段协议）
 *
 * 覆盖 Finding: P0-2（Runner 收到的状态与 Judge 使用的不一致）、
 *              P2-2（A/B 输入不一致）、P2-20（无 state hash）
 *
 * V1.0 的单份载荷里，A/B 的唯一差异是 `team_id` 字段，于是「输入是否一致」
 * 只能靠「剥掉字段再比字节」来间接证明。V1.1 把这个字段从输入里**删掉**：
 * 队别只经 Runner Context（`--team A|B`）传递（规范 §11/§12），
 * 因此两份输入无需任何后处理就是同一份字节。
 *
 * 哈希语义也随之更新（规范 §20）：
 *   roundStateHash = SHA256(publicStateHash + revealStateHash)
 */

import { buildPublicState, buildRevealState, roundStateHash } from '../src/core/InputProtocol';
import { generateMap } from '../src/map/MapGenerator';
import { Obstacle } from '../src/obstacle/Obstacle';
import { PublicStatePoint } from '../src/core/InputProtocol';
import { assert, assertEqual, runAll, test } from './harness';

const MATCH_ID = 'ROUNDSTATE-TEST';

function roster(): PublicStatePoint[] {
  const map = generateMap({ seed: 90210, pointCount: 8, difficulty: 'medium' });
  return [
    ...map.teamA.map((p, i) => ({ id: `A${i + 1}`, team: 'A' as const, x: p.x, y: p.y, alive: true })),
    ...map.teamB.map((p, i) => ({ id: `B${i + 1}`, team: 'B' as const, x: p.x, y: p.y, alive: true })),
  ];
}

function obstacles(): Obstacle[] {
  return generateMap({ seed: 90210, pointCount: 8, difficulty: 'medium' }).obstacles;
}

function build(round = 1, points = roster()) {
  const pub = buildPublicState({ matchId: MATCH_ID, round, points });
  const rev = buildRevealState({
    matchId: MATCH_ID,
    round,
    publicStateSha256: pub.sha256,
    shooters: { A: 'A1', B: 'B1' },
    obstacles: obstacles(),
  });
  return { pub, rev };
}

test('roundstate-equality: 两份输入不含队别字段，双方拿到的是同一份字节', () => {
  const { pub, rev } = build();
  const p = JSON.parse(pub.json);
  const r = JSON.parse(rev.json);

  // 队别字段必须彻底消失 —— 不是「剥掉后相同」，而是「根本不存在」
  assert(p.team_id === undefined, 'public_state 不得含 team_id（规范 §12）');
  assert(r.team_id === undefined, 'reveal_state 不得含 team_id（规范 §12）');
  assert(p.team === undefined, 'public_state 顶层不得含 team（规范 §12）');

  // 两份文件都是**双方共用**的，所以 reveal 必须同时列出 A/B 的 Shooter，
  // public 必须同时列出双方的点 —— 否则就意味着某一份是「为某一队定制」的。
  assertEqual(Object.keys(r.shooters).sort(), ['A', 'B'], 'reveal 必须同时给出双方 Shooter');
  assert(p.points.some((x: PublicStatePoint) => x.team === 'A'), 'public 必须含 A 队点');
  assert(p.points.some((x: PublicStatePoint) => x.team === 'B'), 'public 必须含 B 队点');

  // 确定性：同样的状态必然得到同样的字节（双方不可能收到不同的输入）
  const again = build();
  assertEqual(again.pub.json, pub.json, 'public_state 必须确定性');
  assertEqual(again.rev.json, rev.json, 'reveal_state 必须确定性');
  assertEqual(again.pub.sha256, pub.sha256, 'public hash 必须确定性');
});

test('roundstate-equality: roundStateHash 稳定且对任何改动敏感（规范 §20）', () => {
  const { pub, rev } = build();
  const h = roundStateHash(pub.sha256, rev.sha256);
  assertEqual(h.length, 64, 'roundStateHash 应为 sha256 十六进制');
  assertEqual(roundStateHash(pub.sha256, rev.sha256), h, '同一对输入必须得到同一 hash');

  // public 任一字节变化（这里用 1e-9 位移）都必须改变 roundStateHash
  const nudged = roster();
  nudged[0] = { ...nudged[0], x: nudged[0].x + 1e-9 };
  const moved = build(1, nudged);
  assert(moved.pub.sha256 !== pub.sha256, '点位移必须改变 public hash');
  assert(roundStateHash(moved.pub.sha256, rev.sha256) !== h, '点位移必须改变 roundStateHash');

  // reveal 侧变化（Shooter 换成另一个点）同样必须改变 roundStateHash
  const otherShooter = buildRevealState({
    matchId: MATCH_ID,
    round: 1,
    publicStateSha256: pub.sha256,
    shooters: { A: 'A2', B: 'B1' },
    obstacles: obstacles(),
  });
  assert(otherShooter.sha256 !== rev.sha256, 'Shooter 变化必须改变 reveal hash');
  assert(roundStateHash(pub.sha256, otherShooter.sha256) !== h, 'Shooter 变化必须改变 roundStateHash');

  // round 变化必须改变两个 hash（防止跨轮复用输入）
  const nextRound = build(2);
  assert(nextRound.pub.sha256 !== pub.sha256, 'round 变化必须改变 public hash');
  assert(roundStateHash(nextRound.pub.sha256, nextRound.rev.sha256) !== h, 'round 变化必须改变 roundStateHash');
});

test('roundstate-equality: 点序计入哈希 —— 引擎必须传自然序（A1..An, B1..Bm）', () => {
  // V1.1 不像 canonicalCoreJson 那样对 points 排序：协议把「顺序」当作状态的一部分，
  // 引擎按自然序构造，双方拿到同一份字节即可。这里固定住该语义，
  // 防止有人误加一次隐式排序、悄悄改变日志里的 hash。
  const points = roster();
  const forward = build(1, points);
  const reversed = build(1, [...points].reverse());
  assert(reversed.pub.sha256 !== forward.pub.sha256, '点序变化必须改变 public hash');

  // 自然序本身是确定性的：重新生成同一张地图得到同样的点序
  assertEqual(
    roster().map((p) => p.id).join(','),
    points.map((p) => p.id).join(','),
    '自然序必须确定（A1..An 再 B1..Bm）'
  );
});

test('roundstate-equality: 输入不泄漏宿主信息', () => {
  const { pub, rev } = build();
  const both = pub.json + '\n' + rev.json;
  for (const leak of [
    '/Users', '/private', '/tmp', 'packageDir', 'sealed', 'manifest', 'solver.py',
    'map_seed', 'mapSeed', 'map_hash', 'mapHash', 'state_hash',
  ]) {
    assert(!both.includes(leak), `输入不得包含宿主信息或内部字段 "${leak}"`);
  }

  // 正向对照：该有的必须有，否则上面的断言可能只是「提取器失效」
  const p = JSON.parse(pub.json);
  assert(p.map && typeof p.map.xmin === 'number', 'public 应包含场地范围');
  assert(Array.isArray(p.points) && p.points.length > 0, 'public 应包含点表');
  const r = JSON.parse(rev.json);
  assert(Array.isArray(r.obstacles), 'reveal 应包含障碍物');
  assert(typeof r.shooters.A === 'string' && typeof r.shooters.B === 'string', 'reveal 应包含双方 Shooter id');
});

void runAll('roundstate-equality');
