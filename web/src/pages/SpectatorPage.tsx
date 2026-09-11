/**
 * 观众大屏 —— 只读。
 *
 * 这一屏**没有**任何命令按钮，也不显示任何开发者诊断：
 * 没有哈希、没有文件路径、没有 JSON、没有审计、没有控制台。
 *
 * 这条保证不是靠这一页「记得别渲染」——它靠的是服务端根本不发那些字段
 * （观众板是白名单投影）。这一页能画的，就是它能收到的。
 */

import { ArenaCanvas } from '../arena/ArenaCanvas';
import { ComputeStatus } from '../components/ComputeStatus';
import { useBoard, useTrajectory } from '../api/client';
import type { SpectatorBoard } from '../../../src/server/protocol';
import type { JSX } from 'react';

const PHASE_LABEL: Record<string, string> = {
  SETUP: '等待载入算法',
  UPLOAD_A: '已载入 Team A',
  UPLOAD_B: '已载入 Team B',
  PREFLIGHT: '校验中',
  // V1.2 §一：START 之后、双方锁定之前。漏掉这一格，大屏会直接把原始枚举
  // （`EMITTER_SELECT`）印在现场，观众看到的是一个英文常量。
  EMITTER_SELECT: '双方选择发射锚点',
  READY: '就绪',
  PUBLIC: '本轮已冻结 — 等待揭晓',
  REVEAL: '已揭晓 — 等待 START',
  COUNTDOWN: 'START 已下达',
  COMPUTING: '双方算法计算中',
  ROUND_RESULT: '本轮结算',
  MATCH_END: '比赛结束',
};

export function SpectatorPage(): JSX.Element {
  const { board, connected } = useBoard<SpectatorBoard>('spectator');
  const trajectory = useTrajectory(board?.trajectoryHandle ?? null);

  if (!board) {
    return (
      <div className="screen">
        <div className="empty">正在连接本地比赛服务…</div>
      </div>
    );
  }

  const first = board.lastRound?.firstSolver;

  /**
   * 大屏横幅上的一句话。
   *
   * 阶段名来自引擎，这里只把它翻成**观众看得懂**的说法 —— 引擎的 `READY`
   * 在开赛前是「等待开赛」、在第一轮之后是「等待下一轮」，直接印「就绪」
   * 对一个刚走进场馆的人毫无信息量。判据只用引擎已经给的字段，不另算。
   */
  const statusText =
    board.phase === 'READY' && board.round > 0
      ? '本轮已结算 · 等待下一轮'
      : (PHASE_LABEL[board.phase] ?? board.phase);
  const note = ((): string => {
    if (board.verdict) {
      return board.verdict.winner === 'draw'
        ? `平局 · ${board.verdict.endReason}`
        : `TEAM ${board.verdict.winner} 获胜 · ${board.verdict.endReason}`;
    }
    if (board.lastRound?.errors.length) return board.lastRound.errors.join('   ');
    if (board.lastRound) {
      const atk = board.lastRound.attacksExecuted;
      const killed = board.lastRound.killed;
      return `本轮攻击 ${atk.length ? `[${atk.join(' → ')}]` : '未执行'}   击杀 ${killed.length ? killed.join(',') : '无'}`;
    }
    return PHASE_LABEL[board.phase] ?? board.phase;
  })();

  return (
    <div className="screen" data-testid="spectator">
      <header className="screen__rail">
        <div className="round-mark">
          <span className="round-mark__label">Round</span>
          <span className="round-mark__value">{String(board.round).padStart(2, '0')}</span>
        </div>

        <div className="alive alive--a">
          <span className="team-dot team-dot--a" />
          <span className="alive__count">{board.alive.A}</span>
          <span className="alive__label">Team A 存活</span>
        </div>

        <div className="alive alive--b">
          <span className="team-dot team-dot--b" />
          <span className="alive__count">{board.alive.B}</span>
          <span className="alive__label">Team B 存活</span>
        </div>

        {first && first !== 'none' ? (
          <div className="round-mark">
            <span className="round-mark__label">First solver</span>
            <span className="round-mark__value" style={{ color: first === 'A' ? 'var(--a)' : first === 'B' ? 'var(--b)' : 'var(--muted)' }}>
              {first === 'tie' ? '同时' : `TEAM ${first}`}
            </span>
          </div>
        ) : null}

        {/*
          本场双方的开火点（V1.2 §一）。
          「双方都锁定」之前，引擎根本不下发这两个坐标（`emitters: null`），
          所以这里不是「前端记得别显示」——是收不到。
        */}
        {board.arena.emitters ? (
          <div className="round-mark" data-testid="spectator-emitters">
            <span className="round-mark__label">本场发射锚点</span>
            <span className="round-mark__value num">
              <span className="team-dot team-dot--a" /> {board.arena.emitters.A.id}
              {'　'}
              <span className="team-dot team-dot--b" /> {board.arena.emitters.B.id}
            </span>
          </div>
        ) : null}

        <span style={{ marginLeft: 'auto' }}>
          <span className={`tag ${connected ? 'tag--live' : 'tag--down'}`}>
            {connected ? '● 实时' : '○ 未连接'}
          </span>
        </span>
      </header>

      <main className="screen__stage">
        {/*
          阶段横幅 —— 大屏的第一职责：**走进来的人一眼就知道现在是什么状态**。
          此前阶段只出现在 rail 的小字里，现场隔几米根本看不清。
          这里显示的仍然是引擎的原始阶段（经同一张中文表翻译），不是前端猜的。
        */}
        <div className="screen__banner" data-testid="spectator-status">
          <span className="screen__phase">{statusText}</span>
        </div>

        <ArenaCanvas arena={board.arena} trajectory={trajectory} killed={board.lastRound?.killed ?? []} />
        {board.verdict ? (
          <div className="verdict" data-testid="spectator-verdict">
            <span
              className={`verdict__winner ${board.verdict.winner === 'draw' ? '' : `verdict__winner--${board.verdict.winner.toLowerCase()}`}`}
              style={board.verdict.winner === 'draw' ? { color: 'var(--muted)' } : undefined}
            >
              {board.verdict.winner === 'draw' ? '平局 DRAW' : `TEAM ${board.verdict.winner} 获胜`}
            </span>
            <span className="verdict__reason">{board.verdict.endReason}</span>
          </div>
        ) : null}
      </main>

      <footer className="screen__rail screen__rail--bottom">
        <ComputeStatus computes={board.computes} budgetMs={board.computeBudgetMs} />
        <span className="screen__note">{note}</span>
      </footer>
    </div>
  );
}
