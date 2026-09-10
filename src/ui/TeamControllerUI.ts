/**
 * Team Panel / Judge Console —— 绑定 Canonical Match Pipeline
 *
 * 修复的 Finding：
 *   P0-1  Shooter 选择写入硬编码空 DSL
 *   P0-10 需要正式入口
 *   P0-12 未锁定即可开局
 *   P2-19 死点仍可被选择
 *
 * 所有动作都是 MatchEngine 的薄封装，不复制任何规则。
 *
 * ---------------------------------------------------------------------------
 * Rule Revision 3 §5/§26：每轮的 Shooter Selection 已从正式流程删除。
 *
 * 因此队伍端**不再需要**每轮的点位控制器（选点 / 锁定 / 改选）。
 * `TeamControllerUI` 从「操作面板」降级为**只读队伍面板**：
 *
 *     算法已安装 → 队伍就绪 → 比赛状态
 *
 * 旧的 `getAliveShooters` / `selectShooter` / `lockShooter` / `renderSelectionUI`
 * 已删除 —— 保留它们会让「每轮选一个点当 Shooter」这个废止的语义在 UI 层
 * 继续存在，而规范 §5 要求它在正式比赛流程里彻底消失。
 * ---------------------------------------------------------------------------
 */

import { MatchEngine } from '../core/Match';
import { Point } from '../field/Field';

/** 队伍端的只读状态（§26：算法安装情况 + 就绪 + 比赛状态） */
export interface TeamPanelState {
  team: 'A' | 'B';
  /** 固定 Emitter（整场不变的发射锚点） */
  emitter: { id: string; position: Point } | null;
  /** 算法是否已安装并上传密封 */
  algorithmInstalled: boolean;
  algorithmHash: string | null;
  /** 是否已通过 Preflight（就绪的判定标准） */
  ready: boolean;
  phase: string;
  round: number;
  /** 本队剩余战斗点（不含 Emitter —— 它不是战斗点） */
  alivePoints: number;
}

export class TeamControllerUI {
  constructor(private engine: MatchEngine, private team: 'A' | 'B') {}

  getState(): TeamPanelState {
    const snap = this.engine.getSnapshot();
    const pkg = this.team === 'A' ? snap.packages.A : snap.packages.B;
    const em = snap.emitters;
    return {
      team: this.team,
      emitter: em ? em[this.team] : null,
      algorithmInstalled: Boolean(pkg),
      algorithmHash: pkg?.hash ?? null,
      ready: this.engine.isPreflightPassed(),
      phase: snap.phase,
      round: snap.round,
      alivePoints: this.team === 'A' ? snap.alive.A : snap.alive.B,
    };
  }

  /**
   * 队伍面板。
   *
   * **不显示任何文件系统路径、哈希以外的诊断或原始 JSON** —— 这是给参赛队伍
   * 自己看的板子（规范 §53：UI 不得参与判定，也不得泄漏平台内部结构）。
   */
  renderTeamPanel(): string {
    const s = this.getState();
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│                  TEAM ${s.team} — STATUS                          │`);
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  Algorithm   ${s.algorithmInstalled ? 'INSTALLED' : 'NOT INSTALLED'}`.padEnd(62) + '│');
    if (s.algorithmHash) {
      lines.push(`│  Package     ${s.algorithmHash.slice(0, 16)}… verified`.padEnd(62) + '│');
    }
    lines.push(`│  Ready       ${s.ready ? '✓ PREFLIGHT PASS' : '— pending'}`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    if (s.emitter) {
      lines.push(
        `│  Emitter     ${s.emitter.id} at (${s.emitter.position.x.toFixed(1)}, ${s.emitter.position.y.toFixed(1)}) — FIXED FOR THE MATCH`.padEnd(
          62
        ) + '│'
      );
    }
    lines.push(`│  Combat pts  ${s.alivePoints} alive`.padEnd(62) + '│');
    lines.push(`│  Match       ${s.phase}  round ${s.round}`.padEnd(62) + '│');
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}

export class JudgeControllerUI {
  constructor(private engine: MatchEngine) {}

  /** 裁判显式 START ROUND —— 双方 READY 不会自动触发 */
  startRound(): { success: boolean; error: string | null } {
    const r = this.engine.judgeStartRound();
    return { success: r.ok, error: r.error };
  }

  /**
   * WAITING FOR JUDGE 面板（规范 §18）—— 揭盲完成、算法未运行。
   *
   * 这是 V1.1 与 V1.0 最直观的差别：START 是一个真实的门禁，
   * 裁判在这里按下的不是「确认」而是「开火」。
   *
   * Rule Revision 3 §5 之后这里不再显示「A/B LOCKED」——没有锁定这个动作了；
   * 显示的是双方**固定 Emitter**，它是整场不变的结构。
   */
  renderWaitingForStart(): string {
    const snap = this.engine.getSnapshot();
    const em = snap.emitters;
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push(`│  ROUND ${String(snap.round + 1).padEnd(3)} — WAITING FOR JUDGE`.padEnd(62) + '│');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  PUBLIC STATE  ✓   REVEAL STATE ✓`.padEnd(62) + '│');
    lines.push(
      `│  A EMITTER: ${(em?.A.id ?? '-').padEnd(4)} at ${fmtPoint(em?.A.position)}`.padEnd(62) + '│'
    );
    lines.push(
      `│  B EMITTER: ${(em?.B.id ?? '-').padEnd(4)} at ${fmtPoint(em?.B.position)}`.padEnd(62) + '│'
    );
    lines.push('│                                                             │');
    lines.push('│  A ALGORITHM: NOT STARTED                                   │');
    lines.push('│  B ALGORITHM: NOT STARTED                                   │');
    lines.push('│  READY TO COMPUTE                          [ START ]        │');
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  renderJudgeUI(): string {
    const snap = this.engine.getSnapshot();
    const em = snap.emitters;
    const lines: string[] = [];
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│                     JUDGE CONSOLE                           │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│  Phase:   ${snap.phase}`);
    lines.push(`│  Round:   ${snap.round}`);
    lines.push(`│  A:       emitter ${em?.A.id ?? '-'} ${fmtPoint(em?.A.position)}`);
    lines.push(`│  B:       emitter ${em?.B.id ?? '-'} ${fmtPoint(em?.B.position)}`);
    lines.push(`│  Alive:   A=${snap.alive.A}  B=${snap.alive.B}  (combat points only)`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }
}

function fmtPoint(p: Point | undefined): string {
  return p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})` : '(-)';
}
