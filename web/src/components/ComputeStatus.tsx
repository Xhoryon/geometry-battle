/**
 * 计算状态 —— 两条细条，把「谁在算 / 算了多久 / 离超时还有多远」压成一行。
 *
 * 条的刻度是**计算预算**（冻结规则的 500ms），不是两者中的较大值：
 * 这个比赛比的就是计算速度，看到 0.47s 时你会想知道它离超时只剩 6%，
 * 而不是「它比对手慢 0.1s」。
 *
 * `center` 槽（V1.4）：大屏底栏要的是「A 计算 | 先手 | B 计算」——
 * 先手夹在两条之间才读得出「谁先解出、谁后解出」。不传就与此前一字不差。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { ComputeCell } from '../../../src/server/protocol';
import type { JSX, ReactNode } from 'react';

export interface ComputeStatusProps {
  computes: { A: ComputeCell; B: ComputeCell };
  budgetMs: number;
  headline?: string;
  /** 夹在 A / B 两条之间的内容（大屏放先手） */
  center?: ReactNode;
}

/**
 * 状态 → 翻译键。
 *
 * 这里存的是**键**而不是句子：文案在 `i18n/translations.ts` 里，
 * 否则「加一种语言要改的地方」就会散到各个组件里。
 */
const STATE_KEY: Record<ComputeCell['state'], TranslationKey> = {
  idle: 'compute.idle',
  running: 'compute.running',
  done: 'compute.done',
  error: 'compute.error',
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
  const { t } = useI18n();
  const running = cell.state === 'running';
  const ratio = cell.timeMs !== null && budgetMs > 0 ? Math.min(1, cell.timeMs / budgetMs) : 0;
  const overBudget = cell.timeMs !== null && cell.timeMs >= budgetMs;

  return (
    <div
      className={`compute__side compute__side--${team.toLowerCase()}`}
      data-team={team}
      data-state={cell.state}
      data-testid={`compute-${team}`}
    >
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
        {t(STATE_KEY[cell.state])}
      </span>
    </div>
  );
}

export function ComputeStatus({ computes, budgetMs, headline, center }: ComputeStatusProps): JSX.Element {
  return (
    <div className="compute">
      <Side team="A" cell={computes.A} budgetMs={budgetMs} />
      {center !== undefined && center !== null ? <div className="compute__center">{center}</div> : null}
      <Side team="B" cell={computes.B} budgetMs={budgetMs} />
      {headline ? <span className="compute__headline">{headline}</span> : null}
    </div>
  );
}
