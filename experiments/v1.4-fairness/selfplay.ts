/**
 * selfplay —— 同包自战 campaign（V1.4 任务书 §8 / §9）
 *
 * 直接驱动 MatchEngine（不经 CLI、不经服务端的锦标赛名单检查），**逐场串行**：并行跑两场会让
 * 两个 500 ms 预算的沙箱互抢 CPU，firstSolver / TIMEOUT 数据就全被污染。每场用独立的临时
 * slotRoot / artifactRoot / sandboxRoot，跑完把 match.json / replay.json / audit.json 落到
 * --raw 目录（仓库外），临时目录清掉。
 *
 * --mirror：每个 seed 再跑一场 M(map(seed))。做法与 tests/mirror-match.ts 相同 —— Match.ts 以
 * CommonJS 属性访问 `generateMapOrNull`，替换导出对象上的属性，preflight 的 decoy 世界与正赛地图
 * 就都是镜像图；替换是否生效由 records 里的 mapHash（必然与 orig 不同）与逐回合镜像检查证明。
 *
 * 用法：
 *   npx ts-node experiments/v1.4-fairness/selfplay.ts --pkg <dir> --seeds <n> [--start 500000] [--stride 101]
 *       [--difficulty easy|medium|hard|all] [--points 6|8|10|all] [--mirror] --campaign <name>
 *       --raw <dir> --out <summary.json>
 *   `all` 按 seed 序号轮转（difficulty = i % 3，points = ⌊i/3⌋ % 3），9 个单元均匀覆盖。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { persistArtifacts } from '../../src/core/Logs';
import { MatchEngine } from '../../src/core/Match';
import { MapConfig, generateMapOrNull } from '../../src/map/MapGenerator';
import { inspectPackage } from '../../src/submission/Package';
import * as M from '../../tests/mirror-helpers';
import { CampaignSummary, MatchRec, RoundRec, describe, summarize } from './summary';

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const POINTS: readonly number[] = [6, 8, 10];

interface Args {
  pkg: string;
  seeds: number;
  start: number;
  stride: number;
  difficulty: Difficulty | 'all';
  points: number | 'all';
  mirror: boolean;
  campaign: string;
  raw: string;
  out: string;
  name: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    pkg: '',
    seeds: 0,
    start: 500_000,
    stride: 101,
    difficulty: 'all',
    points: 'all',
    mirror: false,
    campaign: '',
    raw: path.join(os.tmpdir(), 'gb-fairness-raw'),
    out: '',
    name: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--pkg': a.pkg = path.resolve(v); i++; break;
      case '--seeds': a.seeds = Number(v); i++; break;
      case '--start': a.start = Number(v); i++; break;
      case '--stride': a.stride = Number(v); i++; break;
      case '--difficulty':
        if (v !== 'all' && !DIFFICULTIES.includes(v as Difficulty)) throw new Error(`--difficulty 非法: ${v}`);
        a.difficulty = v as Difficulty | 'all'; i++; break;
      case '--points':
        if (v !== 'all' && !POINTS.includes(Number(v))) throw new Error(`--points 非法: ${v}`);
        a.points = v === 'all' ? 'all' : Number(v); i++; break;
      case '--mirror': a.mirror = true; break;
      case '--campaign': a.campaign = v; i++; break;
      case '--raw': a.raw = path.resolve(v); i++; break;
      case '--out': a.out = path.resolve(v); i++; break;
      case '--name': a.name = v; i++; break;
      default: throw new Error(`未知参数 ${k}`);
    }
  }
  if (!a.pkg || !a.seeds || !a.campaign) throw new Error('必须给 --pkg --seeds --campaign');
  if (!a.out) a.out = path.join(__dirname, 'results', `selfplay-${a.campaign}.json`);
  return a;
}

// ---- 镜像生成器（与 tests/mirror-match.ts 同一技术）----
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MG = require('../../src/map/MapGenerator') as { generateMapOrNull: typeof generateMapOrNull };
const ORIGINAL_GENERATE = MG.generateMapOrNull;

async function withMirroredGenerator<T>(fn: () => Promise<T>): Promise<T> {
  MG.generateMapOrNull = (cfg: MapConfig) => {
    const map = ORIGINAL_GENERATE(cfg);
    return map ? M.mirrorMap(map) : null;
  };
  try {
    return await fn();
  } finally {
    MG.generateMapOrNull = ORIGINAL_GENERATE;
  }
}

/** 密封副本被 chmod 成只读，rmSync 会在目录上 EACCES —— 先把权限翻回来再删；失败只警告不中断 */
function removeTree(dir: string): void {
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) { fs.chmodSync(p, 0o755); walk(p); } else fs.chmodSync(p, 0o644);
      } catch { /* 尽力而为 */ }
    }
  };
  try {
    walk(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`  (清理 ${dir} 失败: ${(e as Error).message})`);
  }
}

const classify = (code: string | null): 'timeout' | 'invalid' | 'crash' | null => {
  if (code === null) return null;
  if (code === 'TIMEOUT') return 'timeout';
  if (code === 'INVALID_OUTPUT' || code === 'INVALID_DSL') return 'invalid';
  return 'crash'; // CRASH / SPAWN_ERROR / OUTPUT_TOO_LARGE / CANCELLED / RUNNER_ABORT …
};

async function playMatch(args: Args, seed: number, difficulty: Difficulty, points: number, variant: 'orig' | 'mirror', teamName: string): Promise<MatchRec> {
  const t0 = Date.now();
  const loadBefore = os.loadavg();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-selfplay-'));
  const matchId = `SP-${args.campaign}-${seed}-${variant === 'orig' ? 'O' : 'M'}`;
  const rec: MatchRec = {
    campaign: args.campaign,
    matchId,
    seed,
    mapSeed: null,
    mapHash: null,
    difficulty,
    points,
    variant,
    winner: null,
    endReason: null,
    rounds: 0,
    finalAlive: null,
    kills: { A: 0, B: 0 },
    multiKillRounds: { A: 0, B: 0 },
    obstacleTerminations: { A: 0, B: 0 },
    errorCodes: { A: {}, B: {} },
    timeouts: { A: 0, B: 0 },
    invalids: { A: 0, B: 0 },
    crashes: { A: 0, B: 0 },
    completeRounds: 0,
    firstSolver: { A: 0, B: 0, tie: 0, none: 0 },
    emitters: null,
    durationSec: 0,
    loadBefore,
    loadAfter: loadBefore,
    preflightOk: false,
    failure: null,
    roundsDetail: [],
  };
  try {
    const engine = new MatchEngine({
      matchId,
      seed,
      pointCount: points,
      difficulty,
      teamAName: teamName,
      teamBName: teamName,
      artifactRoot: path.join(root, 'artifacts'),
      sandboxRoot: path.join(root, 'sandboxes'),
      slotRoot: path.join(root, 'slots'),
    });
    for (const team of ['A', 'B'] as const) {
      const up = engine.upload(team, args.pkg);
      if (!up.ok) throw new Error(`上传 ${team} 失败: ${up.errors.join('; ')}`);
    }
    const pre = await engine.preflight();
    rec.preflightOk = pre.ok;
    if (!pre.ok) throw new Error(`preflight 失败: ${pre.errors.join('; ')}`);
    const started = engine.startMatch();
    if (!started.ok) throw new Error(`startMatch 失败: ${started.errors.join('; ')}`);
    engine.autoSelectEmitters();
    const snap = engine.getSnapshot();
    rec.mapSeed = snap.map?.seed ?? null;
    rec.mapHash = snap.map?.stateHash ?? null;
    const em = engine.getEmitters();
    rec.emitters = { A: em.A.id, B: em.B.id };

    let guard = 0;
    while (engine.getWinner() === null && engine.endReason() === 'NONE') {
      const r = await engine.runRound();
      const l = r.log;
      const row: RoundRec = {
        round: l.round,
        firstSolver: l.firstSolver,
        aTimeMs: l.aTimeMs,
        bTimeMs: l.bTimeMs,
        aKills: l.aKills,
        bKills: l.bKills,
        aBlocked: l.aBlocked,
        bBlocked: l.bBlocked,
        result: l.result,
        aErrorCode: l.aErrorCode,
        bErrorCode: l.bErrorCode,
        attacksExecuted: l.attacksExecuted.join(''),
      };
      rec.roundsDetail.push(row);
      rec.kills.A += l.aKills;
      rec.kills.B += l.bKills;
      if (l.aKills >= 2) rec.multiKillRounds.A++;
      if (l.bKills >= 2) rec.multiKillRounds.B++;
      if (l.aBlocked) rec.obstacleTerminations.A++;
      if (l.bBlocked) rec.obstacleTerminations.B++;
      if (l.result === 'COMPLETE') rec.completeRounds++;
      rec.firstSolver[l.firstSolver]++;
      for (const [team, code] of [['A', l.aErrorCode], ['B', l.bErrorCode]] as const) {
        if (code === null) continue;
        rec.errorCodes[team][code] = (rec.errorCodes[team][code] ?? 0) + 1;
        const c = classify(code)!;
        if (c === 'timeout') rec.timeouts[team]++;
        else if (c === 'invalid') rec.invalids[team]++;
        else rec.crashes[team]++;
      }
      if (++guard > 70) throw new Error('回合数 > 70：HARD_ROUND_LIMIT 应已终止比赛');
    }
    const log = engine.getMatchLog();
    rec.winner = log.winner;
    rec.endReason = log.endReason;
    rec.rounds = log.rounds.length;
    rec.finalAlive = log.finalAlive;
    persistArtifacts(path.join(args.raw, args.campaign, matchId), engine.getArtifacts());
  } catch (e) {
    rec.failure = (e as Error).message;
  } finally {
    removeTree(root);
  }
  rec.durationSec = (Date.now() - t0) / 1000;
  rec.loadAfter = os.loadavg();
  return rec;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inspection = inspectPackage(args.pkg);
  if (!inspection.valid) throw new Error(`包不合法: ${inspection.errors.join('; ')}`);
  const teamName = args.name ?? inspection.manifest?.name ?? path.basename(args.pkg);
  const rawDir = path.join(args.raw, args.campaign);
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });

  const loadBefore = os.loadavg();
  const t0 = Date.now();
  console.log(`campaign=${args.campaign} pkg=${args.pkg} name=${teamName} hash=${inspection.hash} seeds=${args.seeds} start=${args.start} stride=${args.stride} difficulty=${args.difficulty} points=${args.points} mirror=${args.mirror}`);
  console.log(`load(before)=${loadBefore.map((v) => v.toFixed(2)).join('/')}  raw=${rawDir}  out=${args.out}`);

  const records: MatchRec[] = [];
  const flush = (): CampaignSummary => {
    fs.writeFileSync(path.join(rawDir, 'records.json'), JSON.stringify(records, null, 1));
    const s = summarize(records, {
      campaign: args.campaign,
      pkg: args.pkg,
      packageName: inspection.manifest?.name ?? null,
      packageHash: inspection.hash,
      args: { ...args },
      loadBefore,
      loadAfter: os.loadavg(),
      durationSec: (Date.now() - t0) / 1000,
    });
    fs.writeFileSync(args.out, JSON.stringify(s, null, 2));
    return s;
  };

  for (let i = 0; i < args.seeds; i++) {
    const seed = args.start + i * args.stride;
    const difficulty = args.difficulty === 'all' ? DIFFICULTIES[i % 3] : args.difficulty;
    const points = args.points === 'all' ? POINTS[Math.floor(i / 3) % 3] : args.points;
    const variants: ('orig' | 'mirror')[] = args.mirror ? ['orig', 'mirror'] : ['orig'];
    for (const variant of variants) {
      const rec =
        variant === 'orig'
          ? await playMatch(args, seed, difficulty, points, variant, teamName)
          : await withMirroredGenerator(() => playMatch(args, seed, difficulty, points, variant, teamName));
      if (MG.generateMapOrNull !== ORIGINAL_GENERATE) throw new Error('生成器替换未还原');
      records.push(rec);
      const fs_ = rec.roundsDetail.map((r) => (r.firstSolver === 'tie' ? '=' : r.firstSolver === 'none' ? '.' : r.firstSolver)).join('');
      const errs = Object.keys(rec.errorCodes.A).length + Object.keys(rec.errorCodes.B).length ? ` errors=${JSON.stringify(rec.errorCodes)}` : '';
      console.log(
        `[${String(records.length).padStart(3)}] seed=${seed}${rec.mapSeed !== null && rec.mapSeed !== seed ? `(→${rec.mapSeed})` : ''} ${difficulty} ${points}p ${variant.padEnd(6)} ` +
          (rec.failure ? `FAILED: ${rec.failure}` : `winner=${rec.winner} ${rec.endReason} rounds=${rec.rounds} kills=${rec.kills.A}/${rec.kills.B} first=${fs_}${errs}`) +
          ` (${rec.durationSec.toFixed(1)}s, load ${rec.loadAfter[0].toFixed(2)})`
      );
      flush();
    }
  }
  const s = flush();
  console.log('\n' + describe(s));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
