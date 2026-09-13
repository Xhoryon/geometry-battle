/**
 * 分层的错误 / 提示块（V1.4）。
 *
 * 错误不再挤进一条全局横幅：每一块都标明**范围**（`data-scope`：参赛者 / 算法包 /
 * Preflight / 本轮 / 裁判动作 / 连接 / 服务端），放在它发生的操作旁边，回答
 * 「出了什么、影响谁、能否重试、下一步」。成功提示（`severity="success"`）
 * 用同一个组件但不同的 token —— 此前参赛者页把成功也套在红色的 `.errors` 上。
 *
 * `role`：error / warning 是 `alert`（读屏立即播报）；success / info 是 `status`
 * （不打断）。机器可读的层级在 `data-severity` 里。
 */

import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX, ReactNode } from 'react';

export type NoticeScope =
  | 'participant'
  | 'package'
  | 'preflight'
  | 'round'
  | 'judge'
  | 'connection'
  | 'server';
export type NoticeSeverity = 'error' | 'warning' | 'info' | 'success';

const SCOPE_KEY: Record<NoticeScope, TranslationKey> = {
  participant: 'notice.scope.participant',
  package: 'notice.scope.package',
  preflight: 'notice.scope.preflight',
  round: 'notice.scope.round',
  judge: 'notice.scope.judge',
  connection: 'notice.scope.connection',
  server: 'notice.scope.server',
};

export function ErrorNotice({
  scope,
  severity = 'error',
  title,
  body,
  retry,
  retryLabel,
  children,
  testId,
  className = '',
}: {
  scope: NoticeScope;
  severity?: NoticeSeverity;
  /** 一句话：出了什么 */
  title: ReactNode;
  /** 详情：一段或多条（多条时逐行列出） */
  body?: ReactNode | readonly string[];
  /** 给了就渲染一个「重试」按钮 —— 可恢复的错误必须留一个动作 */
  retry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
  testId?: string;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const alert = severity === 'error' || severity === 'warning';
  return (
    <div
      className={`notice ${className}`.trim()}
      role={alert ? 'alert' : 'status'}
      data-scope={scope}
      data-severity={severity}
      data-testid={testId}
    >
      <p className="notice__title">
        <span className="notice__scope">{t(SCOPE_KEY[scope])}</span>
        <span>{title}</span>
      </p>
      {Array.isArray(body) ? (
        <ul className="notice__list">
          {(body as readonly string[]).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : body !== undefined && body !== null ? (
        <p className="notice__body">{body as ReactNode}</p>
      ) : null}
      {children}
      {retry ? (
        <button type="button" className="btn notice__retry" onClick={retry}>
          {retryLabel ?? t('notice.retry')}
        </button>
      ) : null}
    </div>
  );
}
