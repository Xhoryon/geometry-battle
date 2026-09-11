/**
 * Algorithm Slot —— 固定算法槽位（V1.1 §2/§3/§31/§32/§33）
 *
 * 项目永久保留两个槽位：
 *
 *     algorithms/team-a/   → Team A Algorithm Slot
 *     algorithms/team-b/   → Team B Algorithm Slot
 *
 * 槽位目录本身就是**一个标准算法包**：根目录必须有 `solver.py`（规范 §3），
 * 与 `inspectPackage()` 的校验口径完全一致。槽位的元数据（安装时间、
 * preflight 结论）**不放进槽位目录**，而是写在 `<slotRoot>/.slots/<team>.json`：
 * 任何进入槽位的文件都会成为算法包的一部分并参与包哈希，元数据文件
 * 既会污染哈希，也会被原样复制进沙箱交给参赛代码。
 *
 * 替换槽位必须**非破坏性**（规范 §32）：坏包绝不能毁掉当前可用的算法。
 *
 *     staging → validate → preflight → hash → seal → replace
 *
 * 本模块只负责文件系统层的 staging / commit / discard 与槽位状态读取；
 * 「preflight」这一步需要跑沙箱，由 MatchEngine 编排（见 installAlgorithm）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { ENTRY_FILENAME, Manifest } from './Manifest';
import { PackageInspection, copyPackageDir, inspectPackage } from './Package';

export type TeamSlot = 'A' | 'B';

/** 槽位目录名（规范 §2）：两边结构必须完全一致 */
export const SLOT_DIRS: Record<TeamSlot, string> = { A: 'team-a', B: 'team-b' };
/** 槽位元数据目录（不参与算法包） */
export const SLOT_META_DIR = '.slots';
/** 上传暂存目录（不参与算法包） */
export const SLOT_STAGING_DIR = '.staging';
/** 出厂槽位目录名（规范 §2/§41 的文件结构） */
export const DEFAULT_SLOT_ROOT = 'algorithms';

/** 平台根目录（本文件位于 `src/submission/`） */
const PLATFORM_ROOT = path.resolve(__dirname, '..', '..');

/**
 * **canonical 槽位根** —— 仓库自带的出厂 fixture。
 *
 * 它是**只读的默认数据**，不是投递点：内容受 git 跟踪，用来让「零输入主流程」
 * 出厂即可用（两个槽位都 READY）。它**不参与**正式比赛的算法投放，
 * 改它也不会影响任何已经在跑的比赛（见 `seedRuntimeSlots`）。
 */
export const CANONICAL_SLOT_ROOT = path.join(PLATFORM_ROOT, DEFAULT_SLOT_ROOT);

/**
 * **运行期槽位根** —— 正式比赛**唯一**的算法投递点。
 *
 * 为什么不是 `CANONICAL_SLOT_ROOT`：安装流水线用 rename **整体替换** `team-a` /
 * `team-b`（见 `commitSlot`），若直接对着受跟踪目录操作，一场正规比赛就会改写
 * 仓库文件（Final Audit P2-6）。`runs/` 已被 `.gitignore` 忽略。
 *
 * 所有入口（Web `npm run app`、终端 `npm run judge` / `npm run operator`）
 * 都用它，**不再有第二个默认值** —— 两个入口指向不同槽位根会让裁判拿到
 * 一份算法、比赛跑另一份（Final Re-Gate P1）。
 */
export const RUNTIME_SLOT_ROOT = path.join(PLATFORM_ROOT, 'runs', 'slots');

/**
 * 首次启动时把 canonical 槽位复制进运行期槽位根。
 *
 * **只在目标不存在时复制** —— 这一条是硬要求，不是优化：
 *   - 已存在的运行期槽位可能装着选手算法，绝不能被仓库里的 canonical 数据覆盖回去
 *     （那会把一场比赛的投递静默抹掉）；
 *   - 反过来，canonical 之后的改动**也不会**自动同步过来。也就是说
 *     「改 `algorithms/`」永远不会被误当成「更新了比赛用的算法」。
 *     要让比赛换算法，必须**投递进运行期槽位根**（Web 的 Advanced 安装，
 *     或 `--slots` 指向它）。裁判台会把实际生效的目录、算法名与哈希显示出来。
 */
export function seedRuntimeSlots(canonicalRoot: string, runtimeRoot: string): void {
  for (const team of ['team-a', 'team-b'] as const) {
    const src = path.join(canonicalRoot, team);
    const dest = path.join(runtimeRoot, team);
    // 存在性判定必须**按目录内容**做：一个被中断的播种会留下只有 manifest 的
    // 半成品目录，那种半成品既不该被当成「已播种」，也不该被永远跳过。
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(path.join(dest, ENTRY_FILENAME))) continue;
    try {
      fs.rmSync(dest, { recursive: true, force: true });
      copyPackageDir(src, dest);
    } catch {
      /* 单个槽位播种失败不阻断启动：它会是 EMPTY/INVALID，裁判台会如实显示 */
    }
  }
}

/**
 * 启动时准备运行期槽位（Web 与终端入口共用）。
 *
 * 播种失败**不阻断启动** —— 槽位会如实显示为 EMPTY/INVALID，
 * 而不是让整个服务起不来。
 */
export function prepareRuntimeSlots(runtimeRoot: string = RUNTIME_SLOT_ROOT): void {
  try {
    seedRuntimeSlots(CANONICAL_SLOT_ROOT, runtimeRoot);
  } catch {
    /* 见上 */
  }
}

export type SlotStatus = 'EMPTY' | 'READY' | 'INVALID';

/** 一次 preflight 的结论（规范 §33 的「Preflight: PASS」） */
export interface SlotPreflightRecord {
  ok: boolean;
  at: string;
  matchId: string;
  error: string | null;
}

/** 槽位安装记录（`<slotRoot>/.slots/<team>.json`） */
export interface SlotRecord {
  schema_version: '1.1';
  team: TeamSlot;
  hash: string;
  entry: string;
  installed_at: string;
  /** 上传来源目录（审计用；不进算法包） */
  source: string;
  preflight: SlotPreflightRecord;
}

export interface SlotState {
  team: TeamSlot;
  /** 槽位绝对路径 */
  dir: string;
  status: SlotStatus;
  /** 槽位内 `solver.py` 是否存在（规范 §3） */
  entry: string | null;
  hash: string | null;
  files: number;
  totalBytes: number;
  manifest: Manifest | null;
  /** 安装记录；从未通过本平台安装过则为 null */
  record: SlotRecord | null;
  errors: string[];
}

export function slotDir(slotRoot: string, team: TeamSlot): string {
  return path.join(slotRoot, SLOT_DIRS[team]);
}

function recordPath(slotRoot: string, team: TeamSlot): string {
  return path.join(slotRoot, SLOT_META_DIR, `${SLOT_DIRS[team]}.json`);
}

export function readSlotRecord(slotRoot: string, team: TeamSlot): SlotRecord | null {
  const file = recordPath(slotRoot, team);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.hash !== 'string') return null;
    return parsed as SlotRecord;
  } catch {
    return null;
  }
}

export function writeSlotRecord(slotRoot: string, team: TeamSlot, record: SlotRecord): void {
  const file = recordPath(slotRoot, team);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 与算法输出同口径：tmp + 原子 rename，避免读到写了一半的记录
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * 读取槽位状态（规范 §33 的 UI 面板数据源）。
 *
 * 槽位为空是**正常状态**（EMPTY），不是错误：比赛前两个槽位都可能还没上传。
 */
export function readSlot(slotRoot: string, team: TeamSlot): SlotState {
  const dir = slotDir(slotRoot, team);
  const record = readSlotRecord(slotRoot, team);
  const base: SlotState = {
    team,
    dir,
    status: 'EMPTY',
    entry: null,
    hash: null,
    files: 0,
    totalBytes: 0,
    manifest: null,
    record,
    errors: [],
  };

  if (!fs.existsSync(dir)) return base;

  const inspection = inspectPackage(dir);
  if (!inspection.valid) {
    return { ...base, status: 'INVALID', errors: inspection.errors };
  }
  return {
    ...base,
    status: 'READY',
    entry: ENTRY_FILENAME,
    hash: inspection.hash,
    files: inspection.files.length,
    totalBytes: inspection.totalBytes,
    manifest: inspection.manifest,
  };
}

export function readSlots(slotRoot: string): { A: SlotState; B: SlotState } {
  return { A: readSlot(slotRoot, 'A'), B: readSlot(slotRoot, 'B') };
}

/** 已暂存、但尚未提交的槽位候选（§31 的 staging 阶段产物） */
export interface StagedSlot {
  team: TeamSlot;
  slotRoot: string;
  stagingDir: string;
  hash: string;
  inspection: PackageInspection;
}

export type StageResult = { ok: true; stage: StagedSlot } | { ok: false; errors: string[] };

let stagingSeq = 0;

/**
 * 第一步 + 第二步：staging + validate（规范 §31/§32）。
 *
 * 只读源包、只写暂存目录 —— 失败时**正式槽位一个字节都不会变**。
 * 暂存目录与槽位同在 `<slotRoot>` 下，保证 replace 是同文件系统 rename。
 */
export function stageSlot(o: { slotRoot: string; team: TeamSlot; sourceDir: string }): StageResult {
  const sourceDir = path.resolve(o.sourceDir);
  const stagingRoot = path.join(o.slotRoot, SLOT_STAGING_DIR);

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return { ok: false, errors: [`上传目录不存在: ${sourceDir}`] };
  }
  // 防止把暂存区自己（或其父级）当作上传源，造成自我递归复制
  const rel = path.relative(stagingRoot, sourceDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return { ok: false, errors: ['上传目录不能位于槽位暂存区内部'] };
  }

  const inspection = inspectPackage(sourceDir);
  if (!inspection.valid || !inspection.hash) {
    return { ok: false, errors: inspection.errors };
  }

  const stagingDir = path.join(stagingRoot, `${SLOT_DIRS[o.team]}-${process.pid}-${stagingSeq++}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stagingDir), { recursive: true });
  copyPackageDir(sourceDir, stagingDir);

  // 复制后重新校验：哈希必须与源包一致，否则暂存副本本身已不可信
  const stagedInspection = inspectPackage(stagingDir);
  if (!stagedInspection.valid || stagedInspection.hash !== inspection.hash) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return {
      ok: false,
      errors: ['暂存副本哈希与源包不一致', ...stagedInspection.errors],
    };
  }

  return {
    ok: true,
    stage: { team: o.team, slotRoot: o.slotRoot, stagingDir, hash: inspection.hash, inspection },
  };
}

/** 丢弃暂存副本（preflight 失败或调用方放弃时） */
export function discardSlot(stage: StagedSlot): void {
  fs.rmSync(stage.stagingDir, { recursive: true, force: true });
}

/**
 * 最后一步：seal + replace（规范 §32）。
 *
 * 顺序刻意做成「先备份旧的、再换上新的、失败就换回来」：
 * 任何一步失败都不会让槽位落在「空目录」或「半个包」的中间态。
 */
export function commitSlot(stage: StagedSlot): { ok: boolean; errors: string[] } {
  const target = slotDir(stage.slotRoot, stage.team);
  const backup = `${target}.replaced-${process.pid}-${stagingSeq++}`;
  let backedUp = false;

  try {
    if (fs.existsSync(target)) {
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(target, backup);
      backedUp = true;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(stage.stagingDir, target);
  } catch (e) {
    // 回滚：把备份放回原位，避免「替换失败 → 槽位消失」
    try {
      if (backedUp && !fs.existsSync(target)) fs.renameSync(backup, target);
    } catch {
      /* 回滚失败时保留备份目录，人工可恢复 */
    }
    return { ok: false, errors: [`替换槽位失败: ${(e as Error).message}`] };
  }

  if (backedUp) fs.rmSync(backup, { recursive: true, force: true });

  // 替换后复验：槽位现在必须是一个合法算法包，且哈希与暂存副本一致
  const after = inspectPackage(target);
  if (!after.valid || after.hash !== stage.hash) {
    return { ok: false, errors: ['替换后槽位校验失败', ...after.errors] };
  }
  return { ok: true, errors: [] };
}

/** 槽位的一行式摘要（CLI / 审计共用） */
export function describeSlot(state: SlotState): string {
  if (state.status === 'EMPTY') return `${SLOT_DIRS[state.team]}: EMPTY`;
  if (state.status === 'INVALID') {
    return `${SLOT_DIRS[state.team]}: INVALID（${state.errors[0] ?? '未知错误'}）`;
  }
  const hash = (state.hash ?? '').slice(0, 8);
  const pf = state.record?.preflight;
  const pfText = pf ? (pf.ok ? 'PASS' : 'FAIL') : 'N/A';
  return `${SLOT_DIRS[state.team]}: READY hash=${hash}… files=${state.files} preflight=${pfText}`;
}
