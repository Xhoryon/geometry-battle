/**
 * 访问令牌的状态提示（V1.2 Final RC Audit 的 P1 修复）。
 *
 * 为什么不能只显示一句「未连接」：三种失败在现场的**下一步动作完全不同** ——
 *
 *   - 链接里就没带令牌   → 打开的是错的链接，去裁判台复制正确的那条；
 *   - 令牌无效 / 已过期 → 裁判开了新的一场，索取本场新链接；
 *   - 服务连不上         → 服务可能退出了，去看进程。
 *
 * 判据由 `useBoard` 的 REST 探测 + WS 关闭码 4401 给出（服务端权威），
 * 不是前端猜的。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX } from 'react';
import type { AccessState } from '../api/client';

/** 三种失败各自的标题/正文翻译键（文案在 i18n 表里，不在这里） */
const TEXT_KEY: Record<
  Exclude<AccessState, 'ok'>,
  { title: TranslationKey; body: TranslationKey }
> = {
  missing: { title: 'access.missing.title', body: 'access.missing.body' },
  unauthorized: { title: 'access.unauthorized.title', body: 'access.unauthorized.body' },
  unreachable: { title: 'access.unreachable.title', body: 'access.unreachable.body' },
};

export function AccessNotice({
  access,
  testId = 'access-notice',
}: {
  access: AccessState;
  testId?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  if (access === 'ok') return null;
  const key = TEXT_KEY[access];
  return (
    <div className="errors" data-testid={testId} data-access={access}>
      <p>⚠ {t(key.title)}</p>
      <p>{t(key.body)}</p>
    </div>
  );
}
