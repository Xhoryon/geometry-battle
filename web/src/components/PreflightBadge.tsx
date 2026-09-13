/**
 * Preflight 结论徽章 —— 裁判队卡与参赛者页共用。
 *
 * `SlotView.preflightOk` 三态：null = 没有安装记录（从未跑过）、true = 通过、false = 未通过。
 * 机器可读的三态由调用方放进 `data-preflight`（`preflightState()`），徽章只负责
 * 颜色 token + 译文 + 字形；文字永远在，颜色只是补充。
 */

import { StatusBadge } from './StatusBadge';
import { useI18n } from '../i18n/useI18n';
import type { Status } from './StatusBadge';
import type { TranslationKey } from '../i18n/translations';
import type { JSX } from 'react';

export type PreflightState = 'never' | 'ok' | 'fail';

export function preflightState(ok: boolean | null): PreflightState {
  return ok === null ? 'never' : ok ? 'ok' : 'fail';
}

const VIEW: Record<PreflightState, { status: Status; key: TranslationKey; icon: string }> = {
  never: { status: 'neutral', key: 'preflight.never', icon: '·' },
  ok: { status: 'ready', key: 'preflight.ok', icon: '✓' },
  fail: { status: 'error', key: 'preflight.fail', icon: '✕' },
};

export function PreflightBadge({ ok, testId }: { ok: boolean | null; testId?: string }): JSX.Element {
  const { t } = useI18n();
  const v = VIEW[preflightState(ok)];
  return (
    <StatusBadge status={v.status} icon={v.icon} testId={testId}>
      {t(v.key)}
    </StatusBadge>
  );
}
