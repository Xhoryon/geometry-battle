/**
 * 计算状态 —— 两条细条，把「谁在算 / 算了多久 / 离超时还有多远」压成一行。
 *
 * 条的刻度是**计算预算**（冻结规则的 500ms），不是两者中的较大值：
 * 这个比赛比的就是计算速度，看到 0.47s 时你会想知道它离超时只剩 6%，
 * 而不是「它比对手慢 0.1s」。
 */

import type { ComputeCell } from '../../../src/server/protocol';
import type { JSX } from 'react';

export interface ComputeStatusProps {
  computes: { A: ComputeCell; B: ComputeCell };
  budgetMs: number;
  headline?: string;
}

const STATE_LABEL: Record<ComputeCell['state'], string> = {
  idle: '未运行',
  running: '计算中…',
  done: '已完成',
  error: '异常',
};

function Side({
  team,
  cell,
  budgetMs,
}: {
  team: 'A' | 'B';
  cell: ComputeCell;
  budgetMs: number;
}): JSX.Element {
  const running = cell.state === 'running';
  const ratio = cell.timeMs !== null && budgetMs > 0 ? Math.min(1, cell.timeMs / budgetMs) : 0;
  const overBudget = cell.timeMs !== null && cell.timeMs >= budgetMs;

  return (
    <div className={`compute__side compute__side--${team.toLowerCase()}`}>
      <span className="compute__name">
        <span className={`team-dot team-dot--${team.toLowerCase()}`} /> {team}
      </span>
      <span className="compute__bar">
        <i
          className={running ? 'is-running' : undefined}
          style={{ right: running ? '0%' : `${(1 - ratio) * 100}%` }}
        />
      </span>
      <span className="compute__time">
        {cell.timeMs === null ? '—' : `${(cell.timeMs / 1000).toFixed(3)}s`}
        {cell.timeMs === null ? '' : ` / ${(budgetMs / 1000).toFixed(2)}s`}
      </span>
      <span className="compute__state" style={overBudget || cell.state === 'error' ? { color: 'var(--danger)' } : undefined}>
        {STATE_LABEL[cell.state]}
      </span>
    </div>
  );
}

export function ComputeStatus({ computes, budgetMs, headline }: ComputeStatusProps): JSX.Element {
  return (
    <div className="compute">
      <Side team="A" cell={computes.A} budgetMs={budgetMs} />
      <Side team="B" cell={computes.B} budgetMs={budgetMs} />
      {headline ? <span className="compute__headline">{headline}</span> : null}
    </div>
  );
}
