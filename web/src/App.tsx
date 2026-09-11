/**
 * 路由。三条正式路线（任务书 §「至少提供」）：
 *
 *   /judge            裁判台
 *   /spectator        只读大屏
 *   /replay/:matchId  回放
 *
 * 用一个几十行的 history 路由，而不是引 react-router：
 * 只有三条静态路线加一个参数段，装一个路由库不划算。
 */

import { useEffect, useState } from 'react';
import { JudgePage } from './pages/JudgePage';
import { SpectatorPage } from './pages/SpectatorPage';
import { ReplayPage } from './pages/ReplayPage';
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
  return (
    <div className="empty" style={{ paddingTop: '18vh' }}>
      <p className="num muted">{path}</p>
      <p>没有这个页面。</p>
      <p style={{ marginTop: 18 }}>
        <a className="link" href="/judge">
          裁判台
        </a>
        {'　'}
        <a className="link" href="/spectator">
          观众大屏
        </a>
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
  if (path === '/spectator') return <SpectatorPage />;
  if (path.startsWith('/replay/')) {
    const id = decodeURIComponent(path.slice('/replay/'.length));
    return <ReplayPage matchId={id} />;
  }
  return <NotFound path={path} />;
}
