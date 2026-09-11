/**
 * JudgeConsole —— 裁判台的纯渲染层（Rule Revision 3 §24）
 *
 * 只做一件事：把引擎的真实状态渲染成裁判看得懂的板子。
 * 它**不持有状态、不驱动流程、不做任何判定** —— 动作由 `operator/judge.ts`
 * 通过 `MatchEngine` 执行，本文件只负责「让裁判知道现在能做什么、刚才发生了什么」。
 *
 * 设计原则：
 *   - 裁判**不需要**读 JSON、不需要看哈希、不需要知道文件路径；
 *   - 每一个可用动作都在板上明确列出（§24 的动作清单）；
 *   - 错误必须说人话（§27）：`TIMEOUT` / `INVALID` / `CRASH` 各自给一句解释。
 */

import { MatchEngine, MatchSnapshot } from '../core/Match';
import { AuditLog, MatchLog, Replay } from '../core/Logs';
import { arenaLegend, renderArena } from './ArenaView';
import { HARD_ROUND_LIMIT, STALEMATE_NO_PROGRESS_LIMIT } from '../core/Rules';

const WIDTH = 62;

function row(text: string): string {
  const t = text.length > WIDTH - 2 ? text.slice(0, WIDTH - 3) + '…' : text;
  return '│ ' + t.padEnd(WIDTH - 2) + '│';
}

function top(label = ''): string {
  return '┌─ ' + label.padEnd(WIDTH - 4, '─') + '┐';
}

const bottom = '└' + '─'.repeat(WIDTH) + '┘';
const divider = '├' + '─'.repeat(WIDTH) + '┤';

/** 算法槽位的就绪状态（裁判最关心的一行） */
export interface SlotReadiness {
  team: 'A' | 'B';
  installed: boolean;
  hash: string | null;
  preflightPassed: boolean;
}

export interface ConsoleInput {
  snap: MatchSnapshot;
  slots: { A: SlotReadiness; B: SlotReadiness };
  /** 上一轮的结果摘要（没有则为 null） */
  lastRound: {
    round: number;
    firstSolver: string;
    attacksExecuted: ('A' | 'B')[];
    killed: string[];
    aliveAfter: { A: number; B: number };
    errors: string[];
  } | null;
  /** 可用的动作（由入口提供，控制台只负责展示） */
  actions: { key: string; label: string }[];
}

/**
 * 主控制台板。
 *
 * 场景一屏：比赛状态 + 双方算法就绪 + 竞技场 + 上一轮结果 + 可用动作。
 */
export function renderJudgeConsole(o: ConsoleInput): string {
  const s = o.snap;
  const lines: string[] = [];
  lines.push(top('JUDGE CONSOLE'));
  lines.push(row(`Match ${s.matchId}   seed ${s.seed}   round ${s.round}`));
  lines.push(row(`Phase: ${s.phase}`));
  lines.push(divider);
  for (const team of ['A', 'B'] as const) {
    const r = o.slots[team];
    const state = !r.installed ? 'NOT LOADED' : r.preflightPassed ? 'READY (preflight ✓)' : 'LOADED (preflight ✗)';
    lines.push(row(`Team ${team}: ${state}`));
    if (r.hash) lines.push(row(`         package ${r.hash.slice(0, 16)}…`));
  }
  lines.push(row(`Alive combat points: A=${s.alive.A}  B=${s.alive.B}`));
  lines.push(divider);
  if (s.map) {
    for (const line of renderArena(
      {
        obstacles: s.map.obstacles,
        emitters: s.emitters,
        points: s.points.map((p) => ({ id: p.id, team: p.team, position: p.position, alive: p.alive })),
      },
      56,
      13
    ).split('\n')) {
      lines.push('│ ' + line + ' │');
    }
    lines.push(row('  Ⓐ/Ⓑ emitter  a/b combat point  × dead  ▓ obstacle  . A-trajectory  , B-trajectory'));
  } else {
    lines.push(row('（比赛尚未开始 —— 没有地图）'));
  }
  lines.push(divider);
  if (o.lastRound) {
    const l = o.lastRound;
    lines.push(row(`Last round ${l.round}: first solver ${l.firstSolver}`));
    lines.push(row(`  attacked: [${l.attacksExecuted.join(', ') || 'none'}]   killed: [${l.killed.join(',') || 'none'}]`));
    lines.push(row(`  alive after: A=${l.aliveAfter.A}  B=${l.aliveAfter.B}`));
    for (const e of l.errors) lines.push(row(`  ⚠ ${e}`));
  } else {
    lines.push(row('Last round: (none yet)'));
  }
  lines.push(divider);
  lines.push(row('Actions:'));
  for (const a of o.actions) lines.push(row(`  [${a.key}] ${a.label}`));
  lines.push(bottom);
  return lines.join('\n');
}

/** 比赛结束板：结果 + 终止原因 + 逐轮摘要 */
export function renderMatchSummary(log: MatchLog): string {
  const lines: string[] = [];
  lines.push(top('MATCH RESULT'));
  const verdict =
    log.endReason === 'ELIMINATION' ? `TEAM ${log.winner} WINS` : 'MATCH DRAW';
  lines.push(row(verdict));
  lines.push(row(`End reason: ${log.endReason}`));
  lines.push(row(`Rounds: ${log.rounds.length}    Final alive: A=${log.finalAlive.A}  B=${log.finalAlive.B}`));
  // V1.2 §一：锚点不再是平台常量，因此结果板必须回答「这一场双方从哪个点开火」。
  // 未锁定（异常终局）时为 null —— 如实写「未锁定」，不编一个坐标出来。
  lines.push(
    row(
      log.emitters
        ? `Emitters: A=${log.emitters.A.id}(${log.emitters.A.position.x},${log.emitters.A.position.y})` +
            `  B=${log.emitters.B.id}(${log.emitters.B.position.x},${log.emitters.B.position.y})`
        : 'Emitters: 未锁定'
    )
  );
  lines.push(divider);
  lines.push(row('Per-round:'));
  for (const r of log.rounds) {
    lines.push(
      row(
        `  R${String(r.round).padStart(2)}  first=${r.firstSolver.padEnd(4)} ` +
          `kills ${r.aKills}/${r.bKills}  alive ${r.aliveAAfter}/${r.aliveBAfter}` +
          (r.mutualElimination ? '  [MUTUAL]' : '')
      )
    );
  }
  if (log.endReason === 'STALEMATE') {
    lines.push(divider);
    lines.push(row(`Stalemate: ${STALEMATE_NO_PROGRESS_LIMIT} 个连续零击杀回合（Rule Revision 3 §16）`));
  }
  if (log.endReason === 'HARD_ROUND_LIMIT') {
    lines.push(divider);
    lines.push(row(`Hard round limit: ${HARD_ROUND_LIMIT}（Rule Revision 3 §17）`));
  }
  lines.push(bottom);
  return lines.join('\n');
}

/** 审计摘要：只给裁判看「该发生的都发生了」，不给原始 JSON */
export function renderAuditSummary(audit: AuditLog): string {
  const counts = new Map<string, number>();
  for (const e of audit.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const lines: string[] = [];
  lines.push(top('AUDIT'));
  lines.push(row(`Match ${audit.matchId}   events ${audit.events.length}`));
  lines.push(divider);
  for (const [type, n] of [...counts.entries()].sort()) {
    lines.push(row(`  ${type.padEnd(26)} ×${n}`));
  }
  const first = audit.events[0];
  const last = audit.events[audit.events.length - 1];
  if (first && last) {
    lines.push(divider);
    lines.push(row(`  first: #${first.seq} ${first.type}`));
    lines.push(row(`  last:  #${last.seq} ${last.type}`));
  }
  lines.push(bottom);
  return lines.join('\n');
}

/** 回放索引：逐轮一行，裁判可以据此决定看哪一轮 */
export function renderReplayIndex(replay: Replay): string {
  const lines: string[] = [];
  lines.push(top('REPLAY'));
  lines.push(row(`Match ${replay.matchId}   winner ${replay.winner.toUpperCase()}   ${replay.endReason}`));
  // V1.2 §一：锚点不是常量，回放索引顶部先把本场双方的开火点写清楚
  lines.push(
    row(
      replay.emitters
        ? `Emitters: A=${replay.emitters.A.id}(${replay.emitters.A.position.x},${replay.emitters.A.position.y})` +
            `  B=${replay.emitters.B.id}(${replay.emitters.B.position.x},${replay.emitters.B.position.y})`
        : 'Emitters: 未锁定'
    )
  );
  lines.push(divider);
  for (let i = 0; i < replay.frames.length; i++) {
    const f = replay.frames[i];
    lines.push(
      row(
        `  [${String(i + 1).padStart(2)}] R${String(f.round).padStart(2)}  first=${String(f.firstSolver).padEnd(4)} ` +
          `attacked [${f.attacksExecuted.join(',')}]  killed [${f.killed.join(',') || '-'}]`
      )
    );
  }
  lines.push(bottom);
  return lines.join('\n');
}

/**
 * 把引擎的运行器错误码翻译成一句人话（§27 Error UX）。
 *
 * 返回 `null` 表示这一侧没有需要报告的问题。
 */
export function explainError(code: string | null, ran: boolean): string | null {
  if (!code && ran) return null;
  if (!code) return '本轮没有执行攻击';
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT —— 未在计算预算内交出 result.json';
    case 'CRASH':
      return 'CRASH —— 算法进程异常退出';
    case 'INVALID_DSL':
    case 'INVALID_OUTPUT':
      return 'INVALID —— 输出不是合法函数';
    case 'OUTPUT_TOO_LARGE':
      return 'INVALID —— 输出超过体积上限';
    case 'MEMORY_LIMIT':
      return 'CRASH —— 超出内存上限';
    case 'READY_TIMEOUT':
      return 'CRASH —— 未能在启动阶段完成握手';
    case 'SPAWN_ERROR':
      return 'CRASH —— 无法启动沙箱进程';
    case 'CANCELLED':
      return 'RUNNER CANCELLED（历史字段）—— 运行器被宿主中止';
    case 'RUNNER_ABORT':
      return '对手未能完成 READY 握手，本轮中止（本队无过错）';
    default:
      return `异常：${code}`;
  }
}

/** 从引擎快照与槽位状态构造控制台输入（省得入口重复拼装） */
export function consoleInputFrom(
  engine: MatchEngine,
  slots: { A: SlotReadiness; B: SlotReadiness },
  actions: { key: string; label: string }[]
): ConsoleInput {
  const rounds = engine.getMatchLog().rounds;
  const last = rounds[rounds.length - 1] ?? null;
  const errors: string[] = [];
  if (last) {
    for (const team of ['A', 'B'] as const) {
      const code = team === 'A' ? last.aErrorCode : last.bErrorCode;
      const ran = last.attacksExecuted.includes(team);
      const msg = explainError(code, ran);
      if (msg) errors.push(`Team ${team}: ${msg}`);
    }
  }
  return {
    snap: engine.getSnapshot(),
    slots,
    lastRound: last
      ? {
          round: last.round,
          firstSolver: last.firstSolver,
          attacksExecuted: last.attacksExecuted,
          killed: [...last.aHits, ...last.bHits],
          aliveAfter: { A: last.aliveAAfter, B: last.aliveBAfter },
          errors,
        }
      : null,
    actions,
  };
}
