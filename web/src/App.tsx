/**
 * 路由。V1.2 的正式路线：
 *
 *   /team/a  /team/b   参赛者（V1.2 §一）
 *   /judge             裁判台（phase-driven wizard，V1.2 §三）
 *   /spectator         只读大屏
 *   /replay/:matchId   回放
 *
 * 用一个几十行的 history 路由，而不是引 react-router：
 * 只有这几条静态路线加一个参数段，装一个路由库不划算。
 *
 * 页面之间**没有**站内跳转：每条路线都由整页加载进入。
 * 这是有意的 —— 页面切换本来就要换掉那一页的组件与它持有的 WebSocket，
 * 用 `pushState` 省下的那次加载并不换来任何东西，反而多一条容易走偏的代码路径。
 */

import { useEffect, useState } from 'react';
import { JudgePage } from './pages/JudgePage';
import { SpectatorPage } from './pages/SpectatorPage';
import { ReplayPage } from './pages/ReplayPage';
import { TeamPage } from './pages/TeamPage';
import { LanguageSwitch } from './components/LanguageSwitch';
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
    <div className="empty" style={{ paddingTop: '18vh' }}>
      <p className="num muted">{path}</p>
      <p>{t('app.notFound')}</p>
      <p style={{ marginTop: 18 }}>
        <a className="link" href="/judge">
          {t('nav.judge')}
        </a>
        {'　'}
        <a className="link" href="/team/a">
          {t('nav.teamA')}
        </a>
        {'　'}
        <a className="link" href="/team/b">
          {t('nav.teamB')}
        </a>
        {'　'}
        <a className="link" href="/spectator">
          {t('nav.spectator')}
        </a>
      </p>
      <p style={{ marginTop: 18 }}>
        <LanguageSwitch />
      </p>
    </div>
  );
}

export function App(): JSX.Element {
  const path = usePathname();
  const isRoot = path === '/' || path === '';

  // 把 `/` 规范成 `/judge`（`npm run app` 之后人第一件要做的事）。
  // 放在 effect 里而不是 render 里：改 history 是副作用，
  // 在渲染期间调用会让「渲染纯不纯」这件事说不清。
  useEffect(() => {
    if (isRoot) window.history.replaceState(null, '', '/judge');
  }, [isRoot]);

  if (isRoot) return <JudgePage />;
  if (path === '/judge') return <JudgePage />;
  if (path === '/team/a') return <TeamPage team="A" />;
  if (path === '/team/b') return <TeamPage team="B" />;
  if (path === '/spectator') return <SpectatorPage />;
  if (path.startsWith('/replay/')) {
    const id = decodeURIComponent(path.slice('/replay/'.length));
    return <ReplayPage matchId={id} />;
  }
  return <NotFound path={path} />;
}
