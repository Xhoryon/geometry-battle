/**
 * 状态徽章（V1.4 状态设计系统）。
 *
 * 七种状态对应 `styles.css` 里的一套 `--status-*` token（全部取自已有语义色，
 * 没有新色相）。**绝不只靠颜色**：徽章总有文字，机器可读的状态放在
 * `data-status` 里 —— 演练与读屏都读它，不读颜色。
 *
 * 类名是 `badge`，不是 `tag`：演练对参赛者页两个面板各断言「恰好一个 .tag」，
 * 新徽章不得撞上那条选择器。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX, ReactNode } from 'react';

export type Status = 'neutral' | 'waiting' | 'ready' | 'active' | 'warning' | 'error' | 'terminal';

/** 没给文字时的默认词 —— 文案在 i18n 表里，这里只存键 */
const STATUS_KEY: Record<Status, TranslationKey> = {
  neutral: 'status.neutral',
  waiting: 'status.waiting',
  ready: 'status.ready',
  active: 'status.active',
  warning: 'status.warning',
  error: 'status.error',
  terminal: 'status.terminal',
};

export function StatusBadge({
  status,
  children,
  icon,
  className = '',
  title,
  testId,
}: {
  status: Status;
  children?: ReactNode;
  /** 可选的字形（✓ / ✕ / ●）—— 只是视觉补充，读屏跳过 */
  icon?: ReactNode;
  className?: string;
  title?: string;
  testId?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`badge badge--status ${className}`.trim()}
      data-status={status}
      title={title}
      data-testid={testId}
    >
      {icon !== undefined ? (
        <span className="badge__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children ?? t(STATUS_KEY[status])}
    </span>
  );
}
