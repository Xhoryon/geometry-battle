/**
 * 路由。V1.4 的正式路线：
 *
 *   /                  首页：选择身份 + 最近比赛（不需要任何权限）
 *   /team/a  /team/b   参赛者（V1.2 §一）
 *   /judge             裁判台（phase-driven wizard，V1.2 §三）
 *   /spectator         只读大屏
 *   /replays           回放列表
 *   /replay/:matchId   回放
 *
 * 用一个几十行的 history 路由，而不是引 react-router：
 * 只有这几条静态路线加一个参数段，装一个路由库不划算。
 *
 * 页面之间**没有**站内跳转：每条路线都由整页加载进入。
 * 这是有意的 —— 页面切换本来就要换掉那一页的组件与它持有的 WebSocket，
 * 用 `pushState` 省下的那次加载并不换来任何东西，反而多一条容易走偏的代码路径。
 *
 * `/` **不再**重定向到 `/judge`：那次 `replaceState` 会把地址里的 `#t=` 丢掉，
 * 而且让没带令牌的人对着「正在连接」永远转圈。
 */

import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { JudgePage } from './pages/JudgePage';
import { ReplaysPage } from './pages/ReplaysPage';
import { SpectatorPage } from './pages/SpectatorPage';
import { ReplayPage } from './pages/ReplayPage';
import { TeamPage } from './pages/TeamPage';
import { AppShell } from './components/AppShell';
import { useI18n } from './i18n/useI18n';
import type { JSX } from 'react';

function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function NotFound({ path }: { path: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <AppShell role="home" eyebrow={t('app.notFound')} testId="not-found">
      <div className="empty" style={{ paddingTop: '18vh' }}>
        <p className="num muted">{path}</p>
        <p>{t('app.notFound')}</p>
        <p style={{ marginTop: 18 }}>
          <a className="link" href="/">
            {t('nav.home')}
          </a>
        </p>
      </div>
    </AppShell>
  );
}

export function App(): JSX.Element {
  const path = usePathname();

  if (path === '/' || path === '') return <HomePage />;
  if (path === '/judge') return <JudgePage />;
  if (path === '/team/a') return <TeamPage team="A" />;
  if (path === '/team/b') return <TeamPage team="B" />;
  if (path === '/spectator') return <SpectatorPage />;
  if (path === '/replays') return <ReplaysPage />;
  if (path.startsWith('/replay/')) {
    const id = decodeURIComponent(path.slice('/replay/'.length));
    return <ReplayPage matchId={id} />;
  }
  return <NotFound path={path} />;
}
