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
