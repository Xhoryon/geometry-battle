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

import type { JSX } from 'react';
import type { AccessState } from '../api/client';

const TEXT: Record<Exclude<AccessState, 'ok'>, { title: string; body: string }> = {
  missing: {
    title: '这一页缺少访问令牌',
    body:
      '请用裁判台「参赛者入口」里给的那条链接打开本页 —— 地址末尾的 #t=… 就是本场令牌，' +
      '不要手工删掉它。',
  },
  unauthorized: {
    title: '本场令牌已失效',
    body:
      '每一场都会重新签发令牌，所以旧链接在下一场就无效了。' +
      '请向裁判索取本场的新链接（裁判台「参赛者入口」里可以一键复制）。',
  },
  unreachable: {
    title: '连不上本地服务',
    body: '比赛服务可能已经退出，或端口变了。请确认服务仍在运行。',
  },
};

export function AccessNotice({
  access,
  testId = 'access-notice',
}: {
  access: AccessState;
  testId?: string;
}): JSX.Element | null {
  if (access === 'ok') return null;
  const t = TEXT[access];
  return (
    <div className="errors" data-testid={testId} data-access={access}>
      <p>⚠ {t.title}</p>
      <p>{t.body}</p>
    </div>
  );
}
