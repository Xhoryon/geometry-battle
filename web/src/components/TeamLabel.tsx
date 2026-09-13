/**
 * 队伍标签：色点 + `Team A` / `Team B`。
 *
 * 色点是补充，文字是主体 —— 颜色只给有语义的东西，但绝不只靠颜色区分队伍。
 * 队名（`Team A`）是稳定术语，两种语言里都一样，仍然走 i18n 表以便统一改动。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX, ReactNode } from 'react';

const TEAM_KEY: Record<'A' | 'B', TranslationKey> = { A: 'teamLabel.A', B: 'teamLabel.B' };

export function TeamLabel({
  team,
  children,
  className = '',
}: {
  team: 'A' | 'B';
  /** 队名后面的补充（例如算法包名）；不传就只有队名 */
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <span className={`teamlabel ${className}`.trim()} data-team={team}>
      <span className={`team-dot team-dot--${team.toLowerCase()}`} aria-hidden="true" />
      <span className="teamlabel__name">{t(TEAM_KEY[team])}</span>
      {children}
    </span>
  );
}
