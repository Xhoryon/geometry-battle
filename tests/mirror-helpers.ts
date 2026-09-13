/**
 * mirror-helpers —— 镜像变换 M（V1.4 平台公平性审计的共用纯函数）
 *
 *   x' = −x，Team A ↔ Team B，进攻方向随之互换；
 *   id 前缀 A ↔ B 重标；障碍物逐个镜像且**保持数组顺序**；Emitter 互换并镜像。
 *
 * 只做数据变换，不含任何判定。被 `mirror-fairness`（纯函数层）与
 * `mirror-match`（真沙箱整场）共用，两套测试因此比较的是同一个 M。
 *
 * 为什么 id 也要换：引擎按 id 前缀计 kill（`Match.ts` 里 `startsWith('B')`），
 * 镜像世界里原来的 B3 就是 A3。地图哈希 / 输入字节**不会**相等 —— 那是另一个世界；
 * 我们检查的是语义镜像关系，不是字节。
 *
 * 为什么障碍物顺序不能动：`traceTrajectory` 在多个障碍物接触点相同（±1e-12）时
 * 取**下标最小**者（Judge.ts `isBefore` 严格比较），换序会改变 `blocked.obstacleIndex`。
 */

import { CanonicalNode } from '../src/core/Ast';
import { Point } from '../src/field/Field';
import { Obstacle } from '../src/obstacle/Obstacle';
import { AlivePoint, RoundStateCore } from '../src/core/RoundState';
import { GeneratedMap, computeMapHash } from '../src/map/MapGenerator';

export type Team = 'A' | 'B';

/** −0 归一化为 0：协议 `num()` 与 JSON 都把 −0 写成 0，避免 Object.is 层面的假差异 */
export function mirrorX(x: number): number {
  return x === 0 ? 0 : -x;
}

export function mirrorPoint(p: Point): Point {
  return { x: mirrorX(p.x), y: p.y };
}

export function swapTeam(t: Team): Team {
  return t === 'A' ? 'B' : 'A';
}

/** `A3` ↔ `B3`；不带队别前缀的 id（测试自造的 `OFF` 之类）原样返回 */
export function mirrorId(id: string): string {
  if (id.startsWith('A')) return `B${id.slice(1)}`;
  if (id.startsWith('B')) return `A${id.slice(1)}`;
  return id;
}

export function mirrorObstacle(o: Obstacle): Obstacle {
  switch (o.type) {
    case 'rectangle':
      // xmin/xmax 互换：镜像后原来的右边界成了左边界
      return { type: 'rectangle', xmin: mirrorX(o.xmax), xmax: mirrorX(o.xmin), ymin: o.ymin, ymax: o.ymax };
    case 'circle':
      return { type: 'circle', center: [mirrorX(o.center[0]), o.center[1]], radius: o.radius };
    case 'segment':
      return { type: 'segment', x1: mirrorX(o.x1), y1: o.y1, x2: mirrorX(o.x2), y2: o.y2 };
    case 'polygon':
      return { type: 'polygon', vertices: o.vertices.map(([x, y]) => [mirrorX(x), y] as [number, number]) };
  }
}

/** 保持数组顺序（见文件头） */
export function mirrorObstacles(list: readonly Obstacle[]): Obstacle[] {
  return list.map(mirrorObstacle);
}

/**
 * 镜像整张地图：teamA' = M(teamB)，teamB' = M(teamA)，Emitter 互换并镜像。
 * `stateHash` 用生产模块 `computeMapHash` 重算 —— 它必然与原图不同。
 */
export function mirrorMap(map: GeneratedMap): GeneratedMap {
  const base = {
    seed: map.seed,
    teamA: map.teamB.map(mirrorPoint),
    teamB: map.teamA.map(mirrorPoint),
    emitterA: mirrorPoint(map.emitterB),
    emitterB: mirrorPoint(map.emitterA),
    obstacles: mirrorObstacles(map.obstacles),
  };
  return { ...base, stateHash: computeMapHash(base) };
}

export function mirrorAlivePoint(p: AlivePoint): AlivePoint {
  return { id: mirrorId(p.id), team: swapTeam(p.team), position: mirrorPoint(p.position) };
}

export function mirrorCore(core: RoundStateCore): RoundStateCore {
  return {
    round: core.round,
    mapSeed: core.mapSeed,
    // 字符串标签，不承载几何；镜像世界的哈希本来就不同，这里原样携带
    mapHash: core.mapHash,
    obstacles: mirrorObstacles(core.obstacles),
    points: core.points.map(mirrorAlivePoint),
    emitters: {
      A: { id: mirrorId(core.emitters.B.id), position: mirrorPoint(core.emitters.B.position) },
      B: { id: mirrorId(core.emitters.A.id), position: mirrorPoint(core.emitters.A.position) },
    },
    // 两个区间已经互为镜像（Rules.ts），不需要动
    teamAXRange: core.teamAXRange,
    teamBXRange: core.teamBXRange,
  };
}

/**
 * f'(x) = f(−x)：把每个 `variable` 叶子换成 `neg(variable)`，常数不动。
 *
 * `evaluateNode('neg')` 就是一元取负（Ast.ts），IEEE-754 取负精确，因此
 * f'(−x) 在叶子处得到的就是 x 本身，叶子以上每个节点看到的操作数逐位相同。
 * 注意它每个变量出现多一个节点、可能多一层深度：`parseCanonicalDSL` 的
 * 128/12 限制可能拒绝镜像后的树，所以进程内比较直接构造 CanonicalNode，不走解析。
 */
export function mirrorAst(node: CanonicalNode): CanonicalNode {
  if (node.type === 'variable') return { type: 'neg', args: [{ type: 'variable' }] };
  if (node.type === 'number') return { type: 'number', value: node.value };
  return { type: node.type, args: node.args!.map(mirrorAst) };
}

/** 敌人列表（judgeShot 的入参形态）的镜像 */
export function mirrorEnemies(list: readonly { id: string; position: Point }[]): { id: string; position: Point }[] {
  return list.map((e) => ({ id: mirrorId(e.id), position: mirrorPoint(e.position) }));
}

/**
 * 自检：M 是对合（M∘M = id）。由套件在 Level 1 调用，失败即抛。
 * 放在这里而不是直接 `test()` 注册，是为了不让 `mirror-match` 导入时顺带注册一堆用例。
 */
export function selfCheck(): void {
  const eq = (a: unknown, b: unknown, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`mirror-helpers 自检失败: ${what}\n  ${JSON.stringify(a)}\n  ${JSON.stringify(b)}`);
  };
  eq(mirrorX(mirrorX(3.25)), 3.25, 'mirrorX 对合');
  eq(mirrorX(0), 0, 'mirrorX(0) 不得产生 −0');
  eq(Object.is(mirrorX(-0), -0), false, 'mirrorX(−0) 归一化为 0');
  eq(mirrorPoint(mirrorPoint({ x: -7.5, y: 2 })), { x: -7.5, y: 2 }, 'mirrorPoint 对合');
  eq(swapTeam(swapTeam('A')), 'A', 'swapTeam 对合');
  eq([mirrorId('A12'), mirrorId('B1'), mirrorId('OFF')], ['B12', 'A1', 'OFF'], 'mirrorId');
  const obstacles: Obstacle[] = [
    { type: 'rectangle', xmin: -3, xmax: 2, ymin: -1, ymax: 4 },
    { type: 'circle', center: [5, -2], radius: 1.5 },
    { type: 'segment', x1: -1, y1: 0, x2: 4, y2: 3 },
    { type: 'polygon', vertices: [[0, 0], [2, 0], [1, 3]] },
  ];
  for (const o of obstacles) eq(mirrorObstacle(mirrorObstacle(o)), o, `mirrorObstacle 对合 (${o.type})`);
  eq(mirrorObstacle(obstacles[0]), { type: 'rectangle', xmin: -2, xmax: 3, ymin: -1, ymax: 4 }, '矩形 xmin/xmax 互换');
  const ast: CanonicalNode = { type: 'add', args: [{ type: 'variable' }, { type: 'number', value: 2 }] };
  eq(mirrorAst(ast), { type: 'add', args: [{ type: 'neg', args: [{ type: 'variable' }] }, { type: 'number', value: 2 }] }, 'mirrorAst');
  const core: RoundStateCore = {
    round: 1,
    mapSeed: 7,
    mapHash: 'h',
    obstacles,
    points: [
      { id: 'A2', team: 'A', position: { x: -10, y: 1 } },
      { id: 'B3', team: 'B', position: { x: 9, y: -1 } },
    ],
    emitters: { A: { id: 'A1', position: { x: -12, y: 0 } }, B: { id: 'B1', position: { x: 11, y: 2 } } },
    teamAXRange: [-20, -4],
    teamBXRange: [4, 20],
  };
  eq(mirrorCore(mirrorCore(core)), core, 'mirrorCore 对合');
  const m = mirrorCore(core);
  eq(m.points[1], { id: 'A3', team: 'A', position: { x: -9, y: -1 } }, 'mirrorCore 重标 id 与队别');
  eq(m.emitters.A, { id: 'A1', position: { x: -11, y: 2 } }, 'mirrorCore Emitter 互换并镜像');
}
