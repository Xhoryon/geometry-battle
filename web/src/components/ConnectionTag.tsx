/**
 * 连接状态标签 —— 三块板此前各自写 `● live / ○ offline`，而且只有两态。
 *
 * 状态词来自 `useBoard().status`（七态，见 api/client.ts）。`data-status` 是那个
 * 状态原文；`data-tone` 是它落到状态设计系统的哪个 token（只管颜色）。
 * 文字永远在：颜色只是补充。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { ConnectionStatus } from '../api/client';
import type { Status } from './StatusBadge';
import type { JSX } from 'react';

const TEXT_KEY: Record<ConnectionStatus, TranslationKey> = {
  connecting: 'conn.connecting',
  waiting: 'conn.waiting',
  live: 'conn.live',
  reconnecting: 'conn.reconnecting',
  disconnected: 'conn.disconnected',
  unauthorized: 'conn.unauthorized',
  unreachable: 'conn.unreachable',
};

const TONE: Record<ConnectionStatus, Status> = {
  connecting: 'waiting',
  waiting: 'waiting',
  live: 'ready',
  reconnecting: 'warning',
  disconnected: 'error',
  unauthorized: 'error',
  unreachable: 'error',
};

/**
 * 还没拿到 board 时，页面主体该说的那一句 —— 与标签同源，三块板共用。
 * `waiting` 才说「已连接，等待比赛状态」；令牌 / 服务问题各说各的，不再一律「正在连接」。
 */
const BODY_KEY: Record<ConnectionStatus, TranslationKey> = {
  connecting: 'common.connecting',
  waiting: 'conn.waitingBody',
  live: 'conn.waitingBody',
  reconnecting: 'common.connecting',
  disconnected: 'common.connecting',
  unauthorized: 'conn.unauthorized',
  unreachable: 'conn.unreachable',
};

export function pendingBodyKey(status: ConnectionStatus): TranslationKey {
  return BODY_KEY[status];
}

export function ConnectionTag({
  status,
  retries = 0,
  testId = 'connection',
}: {
  status: ConnectionStatus;
  retries?: number;
  testId?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className="conn"
      role="status"
      data-status={status}
      data-tone={TONE[status]}
      data-testid={testId}
      title={t('conn.label')}
    >
      <i className="conn__dot" aria-hidden="true" />
      {t(TEXT_KEY[status], { n: retries })}
    </span>
  );
}
