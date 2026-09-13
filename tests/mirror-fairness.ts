/**
 * mirror-fairness —— 平台镜像公平性（纯函数层，不起沙箱；V1.4 任务书 §6/§7）
 *
 * 问题：Geometry Battle 对 Team A / Team B 是否镜像公平？
 * 方法：对合法世界 S 构造镜像 M(S)（x' = −x，A ↔ B，见 mirror-helpers），逐层比较
 * 引擎在 S 与 M(S) 上给出的**语义**结果（哈希字节不要求相等）。
 *
 *   Level 1  几何原语：距离 / 穿透深度在 M 下逐位不变
 *   Level 2  Validator：valid(f) ⇔ valid(M f)，且错误码一致（含定向的网格锚点探针：
 *            凸性 100/101 跨界、tan/div 极点贴边、|f|≈1e6 尖峰、曲率噪声地板）
 *   Level 3  轨迹：traceTrajectory 的采样点、终止原因、阻挡障碍物下标逐位镜像
 *   Level 4  命中：judgeShot 的 hits / hitDetails 顺序 / ε 边界 / 多杀镜像
 *   Level 5  单回合：resolveOrderedShots 在镜像 core 上的击杀集合镜像；
 *            以及「顺序无关性」—— Locked Attack Right 下先手顺序不改变击杀集合
 *
 * 随机性全部来自本文件内的确定性 RNG（固定种子），失败可逐字复现。
 */

import { CanonicalNode, evaluateNode } from '../src/core/Ast';
import { judgeShot, penetration, traceTrajectory } from '../src/core/Judge';
import { PointState, resolveOrderedShots } from '../src/core/Match';
import { FIELD, HIT_EPSILON, firingDomain } from '../src/core/Rules';
import { RoundStateCore } from '../src/core/RoundState';
import { FunctionValidation, validateAttackFunction } from '../src/core/Validator';
import { Point } from '../src/field/Field';
import { GeneratedMap, generateMapOrNull } from '../src/map/MapGenerator';
import { Obstacle, distanceBetweenObstacles, distanceToObstacle } from '../src/obstacle/Obstacle';
import { assert, assertEqual, runAll, test } from './harness';
import * as M from './mirror-helpers';

// ============================================================================
// 确定性随机源 + 世界池
// ============================================================================

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uniform = (rng: () => number, lo: number, hi: number) => lo + (hi - lo) * rng();
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

const MAP_COUNT = 210;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** ≥200 张地图，三种难度轮转，点数 6–10 */
function buildMapPool(): GeneratedMap[] {
  const maps: GeneratedMap[] = [];
  for (let i = 0; i < MAP_COUNT; i++) {
    const map = generateMapOrNull({
      seed: 424_000 + i * 7919,
      pointCount: 6 + (i % 5),
      difficulty: DIFFICULTIES[i % 3],
    });
    assert(map !== null, `地图池：seed 起点 ${424_000 + i * 7919} 无法生成地图`);
    maps.push(map);
  }
  return maps;
}
const MAPS = buildMapPool();

// ============================================================================
// AST 家族（全部经过 Emitter (xe, ye)；u = x − xe 写成 sub(x, xe)，与 A 队的探针同形）
// ============================================================================

const num = (v: number): CanonicalNode => ({ type: 'number', value: v });
const X: CanonicalNode = { type: 'variable' };
const op = (type: CanonicalNode['type'], ...args: CanonicalNode[]): CanonicalNode => ({ type, args });
const add = (a: CanonicalNode, b: CanonicalNode) => op('add', a, b);
const sub = (a: CanonicalNode, b: CanonicalNode) => op('sub', a, b);
const mul = (a: CanonicalNode, b: CanonicalNode) => op('mul', a, b);
const U = (xe: number) => sub(X, num(xe));

type Family =
  | 'line' | 'parabola' | 'cubic' | 'sin-modulated' | 'exp'
  | 'sqrt-of-positive' | 'div-with-pole-outside' | 'tan-with-pole-outside';
const FAMILIES: readonly Family[] = [
  'line', 'parabola', 'cubic', 'sin-modulated', 'exp',
  'sqrt-of-positive', 'div-with-pole-outside', 'tan-with-pole-outside',
];

/** 以 A 队形态生成一个随机 AST；span = 20 − xe 是 A 的射击区间长度 */
function randomAst(rng: () => number, family: Family, xe: number, ye: number): CanonicalNode {
  const u = U(xe);
  const m = uniform(rng, -3, 3);
  const span = FIELD.xMax - xe;
  switch (family) {
    case 'line':
      return add(num(ye), mul(num(m), u));
    case 'parabola':
      return add(num(ye), add(mul(num(m), u), mul(num(uniform(rng, -0.5, 0.5)), op('pow', u, num(2)))));
    case 'cubic':
      return add(
        num(ye),
        add(mul(num(m), u), add(mul(num(uniform(rng, -0.3, 0.3)), op('pow', u, num(2))), mul(num(uniform(rng, -0.05, 0.05)), op('pow', u, num(3)))))
      );
    case 'sin-modulated': {
      // ω 一直抽到 8.6：凸性变号数 ≈ ω·span/π 会自然地落在 100 阈值两侧，逼近临界
      const w = uniform(rng, 0.2, 8.6);
      return add(num(ye), add(mul(num(m), u), mul(num(uniform(rng, 0.1, 3)), op('sin', mul(num(w), u)))));
    }
    case 'exp': {
      const b = uniform(rng, -0.3, 0.3);
      return add(num(ye), mul(num(uniform(rng, -2, 2)), sub(op('exp', mul(num(b), u)), num(1))));
    }
    case 'sqrt-of-positive': {
      const c = uniform(rng, 1, 5);
      return add(num(ye), mul(num(uniform(rng, -3, 3)), sub(op('sqrt', add(u, num(c))), num(Math.sqrt(c)))));
    }
    case 'div-with-pole-outside': {
      const c = uniform(rng, 0.5, 3);
      const a = uniform(rng, -5, 5);
      return add(num(ye), sub(op('div', num(a), add(u, num(c))), num(a / c)));
    }
    case 'tan-with-pole-outside': {
      // 极点在 s·span = π/2 处；s 取到 0.95 倍以内，让极点落在场外但离边界不远
      const s = (Math.PI / 2 - 0.05) / span * uniform(rng, 0.3, 0.95);
      return add(num(ye), mul(num(uniform(rng, -1, 1)), op('tan', mul(num(s), u))));
    }
  }
}

/** 随机取一个「A 队视角」的 Emitter：A 方的真实点位，或 B 方点位的镜像（这样两侧的真实位置都覆盖到） */
function randomEmitter(rng: () => number, map: GeneratedMap): Point {
  return rng() < 0.5 ? pick(rng, map.teamA) : M.mirrorPoint(pick(rng, map.teamB));
}

// ============================================================================
// 比较工具
// ============================================================================

const codesOf = (v: FunctionValidation) => v.issues.map((i) => i.code).sort().join(',') || '(none)';

/**
 * 独立于 mirror-helpers 的 id 重标判据。断言若只拿 helpers 自己当 oracle，helpers 忘记重标时
 * 两边会一起错、互相印证成假绿（定向变异实测如此）；这里另写一份，让两者互相盯着。
 */
const relabel = (id: string) => (id[0] === 'A' ? `B${id.slice(1)}` : id[0] === 'B' ? `A${id.slice(1)}` : id);

function mirroredX(actual: number, expected: number, what: string): void {
  // 期望逐位相等（IEEE 取负精确）；这里断言 1e-12，逐位统计另行汇报
  assert(Math.abs(actual + expected) <= 1e-12, `${what}: x 应为镜像 (${actual} vs ${expected})`);
}

// ============================================================================
// Level 1 —— 几何原语
// ============================================================================

test('L1: mirror-helpers 自检（M∘M = id，id/队别/Emitter 重标）', () => {
  M.selfCheck();
  for (const map of MAPS.slice(0, 50)) {
    assertEqual(M.mirrorMap(M.mirrorMap(map)), map, `mirrorMap 对合 seed=${map.seed}`);
    const mm = M.mirrorMap(map);
    assert(mm.stateHash !== map.stateHash, '镜像地图的哈希应不同（它是另一个世界）');
    assertEqual(mm.teamA.length, map.teamB.length, '队伍点数互换');
    assertEqual(mm.obstacles.length, map.obstacles.length, '障碍物数量不变');
    for (let i = 0; i < map.obstacles.length; i++) {
      assertEqual(mm.obstacles[i].type, map.obstacles[i].type, '障碍物顺序必须保持');
    }
  }
});

test('L1: 距离 / 穿透深度 / 障碍物间距在 M 下逐位不变（四种障碍物）', () => {
  const rng = makeRng(11);
  let checks = 0;
  const randomObstacle = (): Obstacle => {
    const t = pick(rng, ['rectangle', 'circle', 'segment', 'polygon'] as const);
    const cx = uniform(rng, -17, 17);
    const cy = uniform(rng, -9, 9);
    switch (t) {
      case 'rectangle': {
        const w = uniform(rng, 0.5, 5);
        const h = uniform(rng, 0.5, 4);
        return { type: 'rectangle', xmin: cx - w, xmax: cx + w, ymin: cy - h, ymax: cy + h };
      }
      case 'circle':
        return { type: 'circle', center: [cx, cy], radius: uniform(rng, 0.5, 5) };
      case 'segment':
        return { type: 'segment', x1: cx, y1: cy, x2: cx + uniform(rng, -6, 6), y2: cy + uniform(rng, -6, 6) };
      case 'polygon': {
        const n = 3 + Math.floor(rng() * 4);
        const r = uniform(rng, 1, 4);
        const verts: [number, number][] = [];
        for (let k = 0; k < n; k++) {
          const ang = (2 * Math.PI * k) / n + uniform(rng, -0.3, 0.3);
          verts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
        return { type: 'polygon', vertices: verts };
      }
    }
  };
  for (let i = 0; i < 4000; i++) {
    const o = randomObstacle();
    const p: Point = { x: uniform(rng, -20, 20), y: uniform(rng, -12, 12) };
    const d = distanceToObstacle(p, o);
    const dm = distanceToObstacle(M.mirrorPoint(p), M.mirrorObstacle(o));
    assert(d === dm, `distanceToObstacle 不镜像不变: ${o.type} p=${JSON.stringify(p)} ${d} vs ${dm}`);
    const pen = penetration(p, o);
    const penM = penetration(M.mirrorPoint(p), M.mirrorObstacle(o));
    assert(pen === penM, `penetration 不镜像不变: ${o.type} p=${JSON.stringify(p)} ${pen} vs ${penM}`);
    checks++;
  }
  // 生成器用的障碍物间距（只实现 rect/circle）
  for (const map of MAPS) {
    for (let i = 0; i < map.obstacles.length; i++) {
      for (let j = i + 1; j < map.obstacles.length; j++) {
        const g = distanceBetweenObstacles(map.obstacles[i], map.obstacles[j]);
        const gm = distanceBetweenObstacles(M.mirrorObstacle(map.obstacles[i]), M.mirrorObstacle(map.obstacles[j]));
        assert(g === gm, `distanceBetweenObstacles 不镜像不变 seed=${map.seed} (${i},${j}): ${g} vs ${gm}`);
        checks++;
      }
    }
  }
  console.log(`      几何原语检查 ${checks} 组，全部逐位相等`);
});

test('L1: 场地 / 射击区间 / Emitter 常量互为镜像', () => {
  assertEqual([-FIELD.teamBXRange[1], -FIELD.teamBXRange[0]], [...FIELD.teamAXRange], '队伍区间互为镜像');
  assertEqual(-FIELD.xMin, FIELD.xMax, '场地 x 边界对称');
  for (const xe of [-18, -13.37, -4.5, 0.25]) {
    const dA = firingDomain(xe, 'A');
    const dB = firingDomain(-xe, 'B');
    assertEqual([-dB[1], -dB[0]], dA, `firingDomain(${xe}) 互为镜像`);
  }
});

// ============================================================================
// Level 2 —— Validator：valid(f) ⇔ valid(M f)，错误码一致
// ============================================================================

interface Divergence {
  family: string;
  xe: number;
  ye: number;
  ast: CanonicalNode;
  a: FunctionValidation;
  b: FunctionValidation;
}

/**
 * 除结论与错误码外，四个喂进判定的度量也必须逐位相同：镜像网格上 fp/fm 互换角色，
 * |f|、|f'|（|fp − fm| 与 |fm − fp| 相等）、f''（`(fp + fm) − 2·f0` 可交换）都应精确一致。
 * 只比结论会漏掉「两边都合法、但凸性计数 / max|f| 不同」的网格差异 —— 那正是阈值一挪就翻转的前兆。
 */
function sameMetrics(a: FunctionValidation, b: FunctionValidation): boolean {
  return (
    a.metrics.convexityChanges === b.metrics.convexityChanges &&
    a.metrics.maxAbsValue === b.metrics.maxAbsValue &&
    a.metrics.maxAbsSlope === b.metrics.maxAbsSlope &&
    a.metrics.maxAbsCurvature === b.metrics.maxAbsCurvature
  );
}

function compareValidation(ast: CanonicalNode, xe: number, ye: number, family: string): Divergence | null {
  const a = validateAttackFunction(ast, firingDomain(xe, 'A'), { x: xe, y: ye });
  const xb = M.mirrorX(xe);
  const b = validateAttackFunction(M.mirrorAst(ast), firingDomain(xb, 'B'), { x: xb, y: ye });
  if (a.valid !== b.valid || codesOf(a) !== codesOf(b) || !sameMetrics(a, b)) return { family, xe, ye, ast, a, b };
  return null;
}

const describeSide = (v: FunctionValidation) =>
  `valid=${v.valid} codes=${codesOf(v)} convexity=${v.metrics.convexityChanges} max|f|=${v.metrics.maxAbsValue.toExponential(6)} ` +
  `max|f'|=${v.metrics.maxAbsSlope.toExponential(6)} max|f''|=${v.metrics.maxAbsCurvature.toExponential(6)} n=${v.metrics.sampleCount} h=${v.metrics.sampleStep}`;

function describeDivergence(d: Divergence): string {
  return [
    `family=${d.family} emitter=(${d.xe}, ${d.ye})`,
    `  A: ${describeSide(d.a)}`,
    `  B: ${describeSide(d.b)}`,
    `  ast(A form)=${JSON.stringify(d.ast)}`,
  ].join('\n');
}

const AST_TOTAL = 2400;
/** Level 3/4 复用这批 (map, emitter, ast) */
const SAMPLES: { map: GeneratedMap; family: Family; emitter: Point; ast: CanonicalNode }[] = [];

test('L2: 随机 AST 家族 ×随机 Emitter —— 双方校验结论、错误码与判定度量一致（分歧必须打印复现）', () => {
  const rng = makeRng(20260913);
  const divergences: Divergence[] = [];
  let validCount = 0;
  let metricsMismatch = 0;
  for (let i = 0; i < AST_TOTAL; i++) {
    const map = MAPS[i % MAPS.length];
    const family = FAMILIES[i % FAMILIES.length];
    const emitter = randomEmitter(rng, map);
    const ast = randomAst(rng, family, emitter.x, emitter.y);
    SAMPLES.push({ map, family, emitter, ast });
    const d = compareValidation(ast, emitter.x, emitter.y, family);
    if (d) divergences.push(d);
    const a = validateAttackFunction(ast, firingDomain(emitter.x, 'A'), emitter);
    if (a.valid) validCount++;
    // 抗混叠步长来自区间算术，理论上逐位镜像不变（Ast.ts analyzeRange 的 neg 分支精确取负）
    const b = validateAttackFunction(M.mirrorAst(ast), firingDomain(M.mirrorX(emitter.x), 'B'), M.mirrorPoint(emitter));
    if (a.metrics.omega !== b.metrics.omega || a.metrics.sampleStep !== b.metrics.sampleStep || a.metrics.sampleCount !== b.metrics.sampleCount) {
      metricsMismatch++;
    }
  }
  console.log(`      ${AST_TOTAL} 个 AST（${FAMILIES.length} 族 × ${MAPS.length} 图），A 侧合法 ${validCount}，结论/错误码/度量分歧 ${divergences.length}，ω/h/n 不一致 ${metricsMismatch}`);
  assert(validCount > AST_TOTAL / 4, `合法样本过少（${validCount}），家族参数需要调整才有判别力`);
  assertEqual(metricsMismatch, 0, 'ω / 采样步长 / 采样点数必须镜像不变');
  if (divergences.length > 0) {
    console.log(`      ---- 分歧复现（前 5 条）----`);
    for (const d of divergences.slice(0, 5)) console.log(describeDivergence(d));
  }
  assertEqual(divergences.length, 0, `Validator 对镜像函数给出了 ${divergences.length} 处不同结论，第一条：\n${divergences[0] ? describeDivergence(divergences[0]) : ''}`);
});

/**
 * 定向探针：Validator 的采样网格锚点。
 *
 * 校验网格从 `domain[0]` 起步：A 的 domain[0] 是 Emitter，B 的却是场地边 −20。
 * 于是同一个镜像函数在两边被采样的 x 集合不同，阈值附近可能一边合法一边非法。
 * 构造：f = ye + sin(ω(x−xe)+φ) − sin φ，恰好 101 个拐点，其中第一个落在 Emitter 之后
 * 不到一个步长 h 处 —— 从 Emitter 起步的网格数得到它，从远端起步的网格数不到。
 */
function convexityStraddleAst(xe: number, ye: number, delta: number): { ast: CanonicalNode; w: number } {
  const span = FIELD.xMax - xe;
  // 拐点 k=0..100 必须落在 (xe, 20−0.012)，k=101 必须落在 20+0.012 之后
  const wLo = (100 * Math.PI) / (span - delta - 0.012);
  const wHi = (101 * Math.PI) / (span - delta + 0.012);
  const w = (wLo + wHi) / 2;
  const phi = -w * delta;
  const ast = add(num(ye), sub(op('sin', add(mul(num(w), U(xe)), num(phi))), num(Math.sin(phi))));
  return { ast, w };
}

/** tan 极点落在远端场地边界外 eps 处：网格是否恰好踩到 |f| > 1e6 取决于锚点 */
function tanPoleAst(xe: number, ye: number, eps: number): CanonicalNode {
  const c = FIELD.xMax + eps - Math.PI / 2;
  return add(num(ye), sub(op('tan', sub(X, num(c))), num(Math.tan(xe - c))));
}

/** 1/(x−c) 的极点落在远端边界外 eps 处：与 tan 不同，它同时逼近 NOT_FINITE / NOT_C2 / DISCONTINUOUS 三条判定 */
function divPoleAst(xe: number, ye: number, eps: number): CanonicalNode {
  const c = FIELD.xMax + eps;
  return add(num(ye), sub(op('div', num(1), sub(X, num(c))), num(1 / (xe - c))));
}

/**
 * 宽 w 的高斯尖峰，峰值 1000 × 1000.0005 ≈ 1.0000005e6 恰好跨过 |f| ≤ 1e6：
 * 网格是否踩到峰顶附近取决于锚点。幅值拆成两个 ≤ MAX_CONST_ABS 的因子，保持 DSL 可表达。
 */
function gaussianSpikeAst(xe: number, ye: number, x0: number, w: number): CanonicalNode {
  const g = op('exp', op('neg', op('pow', op('div', sub(X, num(x0)), num(w)), num(2))));
  const amp = mul(num(1000), num(1000.0005));
  return add(num(ye), sub(mul(amp, g), num(1000 * 1000.0005 * evaluateNode(g, xe))));
}

/**
 * 直线 + 微幅 sin：|f''| 落在凸性计数的噪声地板 curvEps = 1e-8·scale/h² 附近，最后一位舍入决定符号。
 * 这是对 `((fp + fm) − 2·f0)` 写法的直接检验 —— 镜像网格上 fp/fm 互换角色，加法不可交换就会在这里露出来。
 */
function curvatureFloorAst(xe: number, ye: number, amp: number, w: number): CanonicalNode {
  const u = U(xe);
  return add(num(ye), add(mul(num(0.9), u), mul(num(amp), op('sin', mul(num(w), u)))));
}

test('L2: 定向探针 —— 校验网格锚点（凸性 100/101 跨界、tan/div 极点贴边、|f|≈1e6 尖峰、曲率噪声地板）', () => {
  const divergences: Divergence[] = [];
  const perFamily = new Map<string, { probes: number; diverged: number }>();
  const probe = (family: string, ast: CanonicalNode, xe: number, ye: number, detail: string) => {
    const d = compareValidation(ast, xe, ye, `${family}(${detail})`);
    if (d) divergences.push(d);
    const t = perFamily.get(family) ?? { probes: 0, diverged: 0 };
    t.probes++;
    if (d) t.diverged++;
    perFamily.set(family, t);
  };
  // −13.37 是 div 极点在旧网格上翻转合法性的实测位置（eps=5e-6：A 合法、B NOT_C2）
  const emitters = [-18.008, -17.5034, -13.37, -12.3456, -9.001, -4.5678];
  for (const xe of emitters) {
    for (const delta of [0.002, 0.004, 0.006, 0.008]) {
      probe('convexity-straddle', convexityStraddleAst(xe, 1.5, delta).ast, xe, 1.5, `delta=${delta}`);
    }
    for (const eps of [1e-7, 3e-7, 1e-6, 3e-6]) {
      probe('tan-pole', tanPoleAst(xe, 0.25, eps), xe, 0.25, `eps=${eps}`);
    }
    for (const eps of [1e-7, 7e-7, 5e-6, 4e-5]) {
      probe('div-pole', divPoleAst(xe, 0.75, eps), xe, 0.75, `eps=${eps}`);
    }
    for (const off of [3.0037, 7.7771, 11.11119]) {
      for (const w of [0.0012, 0.0025, 0.004]) {
        probe('gaussian-spike', gaussianSpikeAst(xe, 0.75, xe + off, w), xe, 0.75, `off=${off},w=${w}`);
      }
    }
    for (const amp of [2.9e-4, 3.3e-4, 3.7e-4, 4.4e-4]) {
      for (const w of [3, 5.5, 8.6]) {
        probe('curvature-floor', curvatureFloorAst(xe, 0.75, amp, w), xe, 0.75, `amp=${amp},w=${w}`);
      }
    }
  }
  const probes = [...perFamily.values()].reduce((acc, t) => acc + t.probes, 0);
  const flips = divergences.filter((d) => d.a.valid !== d.b.valid);
  const codeOnly = divergences.filter((d) => d.a.valid === d.b.valid && codesOf(d.a) !== codesOf(d.b));
  const metricOnly = divergences.length - flips.length - codeOnly.length;
  console.log(`      探针 ${probes} 个：结论翻转 ${flips.length}，错误码不一致 ${codeOnly.length}，仅度量不同 ${metricOnly}`);
  console.log(`      按家族（探针数/分歧数）：${[...perFamily].map(([k, t]) => `${k} ${t.probes}/${t.diverged}`).join('，')}`);
  if (divergences.length > 0) {
    console.log(`      ---- 分歧复现（前 4 条）----`);
    for (const d of divergences.slice(0, 4)) console.log(describeDivergence(d));
  }
  assertEqual(
    divergences.length,
    0,
    `Validator 网格锚点与队别有关：${flips.length} 处合法/非法翻转、${codeOnly.length} 处错误码不一致、${metricOnly} 处仅度量不同。第一条：\n${divergences[0] ? describeDivergence(divergences[0]) : ''}`
  );
});

// ============================================================================
// Level 3 —— 轨迹
// ============================================================================

test('L3: traceTrajectory 在镜像世界里逐点镜像（长度 / x / y / 终止原因 / 阻挡下标 / 接触点）', () => {
  let bitExact = 0;
  let points = 0;
  const reasons = new Map<string, number>();
  for (const s of SAMPLES) {
    const tA = traceTrajectory(s.ast, s.emitter, 'A', s.map.obstacles);
    const tB = traceTrajectory(M.mirrorAst(s.ast), M.mirrorPoint(s.emitter), M.swapTeam('A'), M.mirrorObstacles(s.map.obstacles));
    const tag = `family=${s.family} seed=${s.map.seed} emitter=${JSON.stringify(s.emitter)}`;
    assertEqual(tB.endReason, tA.endReason, `${tag}: endReason`);
    assertEqual(tB.points.length, tA.points.length, `${tag}: 轨迹点数`);
    for (let i = 0; i < tA.points.length; i++) {
      mirroredX(tB.points[i].x, tA.points[i].x, `${tag} 点 ${i}`);
      assert(tB.points[i].y === tA.points[i].y, `${tag} 点 ${i}: y 应逐位相等 (${tA.points[i].y} vs ${tB.points[i].y})`);
      if (tB.points[i].x + tA.points[i].x === 0) bitExact++;
      points++;
    }
    assertEqual(tB.blocked === null, tA.blocked === null, `${tag}: 是否被阻挡`);
    if (tA.blocked && tB.blocked) {
      assertEqual(tB.blocked.obstacleIndex, tA.blocked.obstacleIndex, `${tag}: 阻挡障碍物下标`);
      mirroredX(tB.blocked.at.x, tA.blocked.at.x, `${tag} 接触点`);
      assert(tB.blocked.at.y === tA.blocked.at.y, `${tag}: 接触点 y 应逐位相等`);
    }
    reasons.set(tA.endReason, (reasons.get(tA.endReason) ?? 0) + 1);
  }
  console.log(`      ${SAMPLES.length} 条轨迹 / ${points} 个点，x 逐位镜像 ${bitExact}/${points}；终止原因分布 ${JSON.stringify([...reasons])}`);
  assert((reasons.get('OBSTACLE') ?? 0) > 20 && (reasons.get('OUT_OF_FIELD') ?? 0) > 20 && (reasons.get('FIELD_EDGE') ?? 0) > 20, '三类终止原因都应被覆盖到，否则样本没有判别力');
});

// ============================================================================
// Level 4 —— 命中
// ============================================================================

function enemiesOf(map: GeneratedMap, team: 'A' | 'B'): { id: string; position: Point }[] {
  const pts = team === 'A' ? map.teamB : map.teamA;
  const prefix = team === 'A' ? 'B' : 'A';
  return pts.map((p, i) => ({ id: `${prefix}${i + 1}`, position: p }));
}

function assertMirroredShot(
  a: ReturnType<typeof judgeShot>,
  b: ReturnType<typeof judgeShot>,
  tag: string
): void {
  assertEqual(b.hits, a.hits.map(relabel), `${tag}: hits 应重标后相等（顺序含义：沿传播方向）`);
  assertEqual(b.killed, a.killed.map(relabel), `${tag}: killed`);
  assert(a.hits.every((id) => id.startsWith('B')) && b.hits.every((id) => id.startsWith('A')), `${tag}: A 只能打到 B 点，镜像世界里 B' 只能打到 A 点`);
  assertEqual(b.endReason, a.endReason, `${tag}: endReason`);
  assertEqual(b.hitDetails.length, a.hitDetails.length, `${tag}: hitDetails 数量`);
  for (let i = 0; i < a.hitDetails.length; i++) {
    assertEqual(b.hitDetails[i].id, relabel(a.hitDetails[i].id), `${tag}: hitDetails[${i}].id`);
    mirroredX(b.hitDetails[i].at.x, a.hitDetails[i].at.x, `${tag} hitDetails[${i}]`);
    assert(b.hitDetails[i].at.y === a.hitDetails[i].at.y, `${tag}: hitDetails[${i}].at.y 应逐位相等`);
  }
  assertEqual(b.blocked === null, a.blocked === null, `${tag}: blocked`);
  if (a.blocked && b.blocked) {
    assertEqual(b.blocked.obstacleIndex, a.blocked.obstacleIndex, `${tag}: blocked.obstacleIndex`);
    mirroredX(b.blocked.at.x, a.blocked.at.x, `${tag} blocked.at`);
  }
}

test('L4: judgeShot 在随机世界里 hits / hitDetails / blocked 镜像（贴在图像上的敌人保证 hits 非空）', () => {
  const rng = makeRng(41);
  let hits = 0;
  let shotsWithHits = 0;
  const byFamily = new Map<string, number>();
  for (const s of SAMPLES) {
    const enemies = enemiesOf(s.map, 'A');
    // 随机函数几乎不会正中真实战斗点，只比较地图上的点会让 hits 退化成 [] 对 []（空比较不算检验）。
    // 因此再贴两个「在图像上」的敌人（y 取引擎自己的求值）：
    //   · 一个在 B 半场 [5, 19]：是否命中由轨迹是否走到那里决定（斜率大的多项式多半先出界）；
    //   · 一个在 A 侧轨迹实际到达的 x 范围内：几乎必然命中，保证每个家族的 hits / hitDetails 都非空。
    // 两边必须给出同样的结论 —— 包括被障碍物截断后「接触点之后不算」的那条过滤。
    const reach = traceTrajectory(s.ast, s.emitter, 'A', s.map.obstacles).points;
    const endX = reach.length > 0 ? reach[reach.length - 1].x : s.emitter.x;
    const xs = [uniform(rng, 5, 19)];
    if (endX - s.emitter.x > 0.5) xs.push(uniform(rng, s.emitter.x + 0.25, endX));
    for (const x of xs) {
      const y = evaluateNode(s.ast, x);
      if (Number.isFinite(y)) enemies.push({ id: `B${enemies.length + 1}`, position: { x, y } });
    }
    const a = judgeShot(s.ast, s.emitter, 'A', enemies, s.map.obstacles);
    const b = judgeShot(M.mirrorAst(s.ast), M.mirrorPoint(s.emitter), M.swapTeam('A'), M.mirrorEnemies(enemies), M.mirrorObstacles(s.map.obstacles));
    assertMirroredShot(a, b, `family=${s.family} seed=${s.map.seed}`);
    hits += a.hits.length;
    if (a.hits.length > 0) {
      shotsWithHits++;
      byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
    }
  }
  console.log(`      随机世界 ${SAMPLES.length} 次射击，命中总数 ${hits}，有命中的射击 ${shotsWithHits}；按家族 ${JSON.stringify([...byFamily])}（ε 边界 / 多杀顺序的构造用例见下一条）`);
  assert(shotsWithHits > SAMPLES.length / 2, `有命中的射击过少（${shotsWithHits}），hits / hitDetails 比较接近空比较，判别力不足`);
  for (const family of FAMILIES) assert((byFamily.get(family) ?? 0) > 0, `家族 ${family} 没有任何一次命中，该家族的 hits 比较是空比较`);
});

/** 经过 (xe,ye) 与目标 (xt,yt) 的抛物线（A 形态；K=0 即直线） */
function aimAst(xe: number, ye: number, xt: number, yt: number, K: number): CanonicalNode {
  const ut = xt - xe;
  const m = (yt - ye - K * ut * ut) / ut;
  const u = U(xe);
  if (K === 0) return add(num(ye), mul(num(m), u));
  return add(num(ye), add(mul(num(m), u), mul(num(K), op('pow', u, num(2)))));
}

test('L4: 构造用例 —— 多杀顺序、ε 边界、障碍物截断、身后 / 终点之后的敌人，全部镜像', () => {
  const rng = makeRng(44);
  let multiKills = 0;
  for (let trial = 0; trial < 300; trial++) {
    const map = MAPS[trial % MAPS.length];
    const xe = uniform(rng, -19, -5);
    const ye = uniform(rng, -8, 8);
    const K = pick(rng, [0, 0.02, -0.02, 0.05]);
    const xt = uniform(rng, 6, 19);
    const yt = uniform(rng, -8, 8);
    const ast = aimAst(xe, ye, xt, yt, K);
    // 三个正中曲线的敌人（y 取引擎自己的求值，保证「在图像上」），一个 ε 内、一个 ε 外、
    // 一个在身后、一个在曲线上但被障碍物/边界之后（若有）
    const xs = [xe + 4, xe + 9, xt];
    const enemies: { id: string; position: Point }[] = xs.map((x, i) => ({ id: `B${i + 1}`, position: { x, y: evaluateNode(ast, x) } }));
    enemies.push({ id: 'B4', position: { x: xe + 6, y: evaluateNode(ast, xe + 6) + HIT_EPSILON * 0.5 } });
    enemies.push({ id: 'B5', position: { x: xe + 7, y: evaluateNode(ast, xe + 7) + HIT_EPSILON * 2 } });
    enemies.push({ id: 'B6', position: { x: xe - 1, y: evaluateNode(ast, xe - 1) } });
    enemies.push({ id: 'B7', position: { x: 19.5, y: evaluateNode(ast, 19.5) } });
    const withObstacles = trial % 2 === 0 ? map.obstacles : [];
    const a = judgeShot(ast, { x: xe, y: ye }, 'A', enemies, withObstacles);
    const b = judgeShot(M.mirrorAst(ast), { x: M.mirrorX(xe), y: ye }, M.swapTeam('A'), M.mirrorEnemies(enemies), M.mirrorObstacles(withObstacles));
    assertMirroredShot(a, b, `trial=${trial}`);
    if (withObstacles.length === 0) {
      // 无障碍：ε 内命中、ε 外不命中、身后不命中；场内的正中点全部命中且按传播顺序
      assert(!a.hits.includes('B5'), 'ε 外的点不得命中');
      assert(!a.hits.includes('B6'), '身后的点不得命中');
      const inField = (y: number) => y >= FIELD.yMin && y <= FIELD.yMax;
      if (inField(evaluateNode(ast, xe + 4)) && inField(evaluateNode(ast, xe + 6)) && inField(evaluateNode(ast, xe + 9)) && a.endReason === 'FIELD_EDGE') {
        assertEqual(a.hits.slice(0, 3), ['B1', 'B4', 'B2'], `trial=${trial}: 命中顺序应沿传播方向`);
        assertEqual(b.hits.slice(0, 3), ['A1', 'A4', 'A2'], `trial=${trial}: 镜像世界里同样的三个点（重标后）按同样顺序命中`);
      }
    }
    if (a.hits.length >= 2) multiKills++;
  }
  console.log(`      300 组构造用例，多杀 ${multiKills} 组`);
  assert(multiKills > 100, '多杀用例过少，判别力不足');
});

// ============================================================================
// Level 5 —— 单回合：resolveOrderedShots
// ============================================================================

function coreOf(map: GeneratedMap): RoundStateCore {
  // 与 autoSelectEmitters 一致：A1 / B1 成为 Emitter，其余是战斗点
  return {
    round: 1,
    mapSeed: map.seed,
    mapHash: map.stateHash,
    obstacles: map.obstacles,
    points: [
      ...map.teamA.slice(1).map((p, i) => ({ id: `A${i + 2}`, team: 'A' as const, position: p })),
      ...map.teamB.slice(1).map((p, i) => ({ id: `B${i + 2}`, team: 'B' as const, position: p })),
    ],
    emitters: { A: { id: 'A1', position: map.teamA[0] }, B: { id: 'B1', position: map.teamB[0] } },
    teamAXRange: FIELD.teamAXRange,
    teamBXRange: FIELD.teamBXRange,
  };
}

const pointStates = (core: RoundStateCore, dead: ReadonlySet<string>): PointState[] =>
  core.points.map((p) => ({ id: p.id, team: p.team, position: p.position, alive: !dead.has(p.id) }));

/** 像探针那样在各自的前进坐标里瞄准最近的活敌人（B 形态写成 sub(xe, x)） */
function aimFor(core: RoundStateCore, team: 'A' | 'B', dead: ReadonlySet<string>, K: number): CanonicalNode {
  const e = core.emitters[team].position;
  const toU = (x: number) => (team === 'A' ? x - e.x : e.x - x);
  const enemies = core.points
    .filter((p) => p.team !== team && !dead.has(p.id) && toU(p.position.x) > 1e-9)
    .sort((p, q) => toU(p.position.x) - toU(q.position.x) || Math.abs(p.position.y - e.y) - Math.abs(q.position.y - e.y));
  const uExpr = team === 'A' ? sub(X, num(e.x)) : sub(num(e.x), X);
  if (enemies.length === 0) return add(num(e.y), mul(num(0), uExpr));
  const t = enemies[0];
  const ut = toU(t.position.x);
  const m = (t.position.y - e.y - K * ut * ut) / ut;
  if (K === 0) return add(num(e.y), mul(num(m), uExpr));
  return add(num(e.y), add(mul(num(m), uExpr), mul(num(K), op('pow', uExpr, num(2)))));
}

const sortedIds = (ids: readonly string[]) => [...ids].sort();

test('L5: 镜像 core 上的击杀集合镜像（串行 [A,B]↔[B,A]，以及并列同时结算）', () => {
  const rng = makeRng(55);
  let killsTotal = 0;
  let deadFiltered = 0;
  for (const map of MAPS) {
    const core = coreOf(map);
    const mirror = M.mirrorCore(core);
    // 随机预先阵亡一个点：它必须既不出现在 killed，也不出现在 hits（already-dead filtering）
    const dead = new Set<string>();
    if (rng() < 0.5) dead.add(pick(rng, core.points).id);
    const deadM = new Set([...dead].map(M.mirrorId));
    const K = pick(rng, [0, 0.03, -0.03, 0.08]);
    const astA = aimFor(core, 'A', dead, K);
    const astB = aimFor(core, 'B', dead, K);
    // 镜像世界里 B' ≙ A，A' ≙ B —— 函数取形式镜像 M f
    const astA2 = M.mirrorAst(astB);
    const astB2 = M.mirrorAst(astA);
    // 探针的 u 空间构造断言：在镜像世界里**重新瞄准**得到的函数与 M f 逐位同值
    const reAimB2 = aimFor(mirror, 'B', deadM, K);
    for (let k = 0; k <= 40; k++) {
      const x = -20 + k;
      assert(evaluateNode(reAimB2, x) === evaluateNode(astB2, x), `seed=${map.seed}: 镜像世界里重新瞄准 ≠ 形式镜像 (x=${x})`);
    }

    for (const simultaneous of [false, true]) {
      const r = resolveOrderedShots({
        order: ['A', 'B'], simultaneous, points: pointStates(core, dead),
        emitters: { A: core.emitters.A.position, B: core.emitters.B.position },
        ast: { A: astA, B: astB }, obstacles: core.obstacles,
      });
      const rM = resolveOrderedShots({
        order: ['B', 'A'], simultaneous, points: pointStates(mirror, deadM),
        emitters: { A: mirror.emitters.A.position, B: mirror.emitters.B.position },
        ast: { A: astA2, B: astB2 }, obstacles: mirror.obstacles,
      });
      const tag = `seed=${map.seed} simultaneous=${simultaneous}`;
      assertEqual(sortedIds(rM.killed), sortedIds(r.killed.map(relabel)), `${tag}: killed 集合应镜像`);
      assertEqual(sortedIds(rM.shots.B!.hits), sortedIds(r.shots.A!.hits.map(relabel)), `${tag}: A 的 hits ↔ B' 的 hits`);
      assertEqual(sortedIds(rM.shots.A!.hits), sortedIds(r.shots.B!.hits.map(relabel)), `${tag}: B 的 hits ↔ A' 的 hits`);
      assert(rM.shots.B!.hits.every((id) => id.startsWith('A')) && rM.shots.A!.hits.every((id) => id.startsWith('B')), `${tag}: 镜像世界里 B' 打 A 点、A' 打 B 点`);
      assertEqual(Boolean(rM.shots.B!.blocked), Boolean(r.shots.A!.blocked), `${tag}: aBlocked ↔ bBlocked`);
      assertEqual(Boolean(rM.shots.A!.blocked), Boolean(r.shots.B!.blocked), `${tag}: bBlocked ↔ aBlocked`);
      for (const id of dead) {
        assert(!r.killed.includes(id) && !r.shots.A!.hits.includes(id) && !r.shots.B!.hits.includes(id), `${tag}: 已阵亡的 ${id} 不得再被命中`);
        deadFiltered++;
      }
      if (!simultaneous) killsTotal += r.killed.length;
    }
  }
  console.log(`      ${MAPS.length} 个 core，串行击杀总数 ${killsTotal}，已阵亡过滤检查 ${deadFiltered} 次`);
  assert(killsTotal > MAPS.length / 4, `击杀过少（${killsTotal}），瞄准函数需要调整才有判别力`);
});

test('L5: 顺序无关性 —— Locked Attack Right 下先手顺序不改变击杀集合与各方 hits（Match.ts resolveOrderedShots 无取消分支）', () => {
  const rng = makeRng(56);
  let both = 0;
  for (const map of MAPS) {
    const core = coreOf(map);
    const K = pick(rng, [0, 0.03, -0.03, 0.08]);
    const ast = { A: aimFor(core, 'A', new Set(), K), B: aimFor(core, 'B', new Set(), K) };
    const emitters = { A: core.emitters.A.position, B: core.emitters.B.position };
    const run = (order: ('A' | 'B')[], simultaneous: boolean) =>
      resolveOrderedShots({ order, simultaneous, points: pointStates(core, new Set()), emitters, ast, obstacles: core.obstacles });
    const ab = run(['A', 'B'], false);
    const ba = run(['B', 'A'], false);
    const tie = run(['A', 'B'], true);
    const tag = `seed=${map.seed}`;
    assertEqual(sortedIds(ba.killed), sortedIds(ab.killed), `${tag}: [B,A] 与 [A,B] 的击杀集合必须相同`);
    assertEqual(sortedIds(tie.killed), sortedIds(ab.killed), `${tag}: 并列同时结算的击杀集合必须相同`);
    for (const t of ['A', 'B'] as const) {
      assertEqual(ba.shots[t]!.hits, ab.shots[t]!.hits, `${tag}: ${t} 的 hits 与先手顺序无关`);
      assertEqual(tie.shots[t]!.hits, ab.shots[t]!.hits, `${tag}: ${t} 的 hits 与是否并列无关`);
      assertEqual(ba.shots[t]!.trajectory.length, ab.shots[t]!.trajectory.length, `${tag}: ${t} 的轨迹与先手顺序无关`);
    }
    if (ab.shots.A!.hits.length > 0 && ab.shots.B!.hits.length > 0) both++;
  }
  console.log(`      ${MAPS.length} 个 core，双方同回合都有命中的 ${both} 个（这些才真正区分先后手）`);
  assert(both > 10, '双方都命中的样本过少，顺序无关性没有被充分检验');
});

void runAll('mirror-fairness');
