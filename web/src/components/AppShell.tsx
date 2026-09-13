/**
 * 应用外壳（V1.4）：顶栏 + 角色带 + 全局导航 + 语言开关 + 连接状态槽。
 *
 * 五个页面此前各写一条头部导轨（`.judge__bar` / `.replay__bar` / `.team__rail` /
 * `.screen__rail`），右侧那组「链接 + 语言开关 + 在线标记」用内联样式抄了三遍。
 * 现在头部只有这一个组件；页面把自己的数据（match id、阶段…）放进 `meta` 槽，
 * 演练依赖的 testid 因此**仍留在页面代码里**。
 *
 * 导航全部是 `<a>` 整页链接 —— 这个应用刻意没有站内路由（见 App.tsx）。
 * 导航**可见不等于有权限**：裁判台 / 参赛者页没带令牌打开时，由那一页自己解释。
 *   - `nav="full"`  首页 / 裁判台 / 回放
 *   - `nav="team"`  参赛者页：不出现裁判台入口（参赛者不该被引向裁判特权面）
 *   - `nav="none"`  观众大屏：除语言开关外**不得有任何按钮**，导航也一并省掉
 */

import { memo } from 'react';
import { LanguageSwitch } from './LanguageSwitch';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX, ReactNode } from 'react';

export type ShellRole = 'home' | 'judge' | 'team' | 'spectator' | 'replay';
export type NavMode = 'full' | 'team' | 'none';

interface NavItem {
  id: string;
  href: string;
  key: TranslationKey;
  /** 参赛者页隐藏 */
  judgeOnly?: boolean;
}

const NAV: readonly NavItem[] = [
  { id: 'home', href: '/', key: 'nav.home' },
  { id: 'judge', href: '/judge', key: 'nav.judge', judgeOnly: true },
  { id: 'team-a', href: '/team/a', key: 'nav.teamA' },
  { id: 'team-b', href: '/team/b', key: 'nav.teamB' },
  { id: 'spectator', href: '/spectator', key: 'nav.spectator' },
  { id: 'replays', href: '/replays', key: 'nav.replays' },
];

/** 当前路径命中哪一项（回放详情页归到「回放列表」） */
function currentNavId(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.startsWith('/replay')) return 'replays';
  const hit = NAV.find((n) => n.href === pathname);
  return hit ? hit.id : '';
}

/** 导航是静态的：board 每 100ms 一条也不该让它重渲染 */
const ShellNav = memo(function ShellNav({ mode }: { mode: Exclude<NavMode, 'none'> }): JSX.Element {
  const { t } = useI18n();
  const current = currentNavId(typeof location !== 'undefined' ? location.pathname : '');
  return (
    <nav className="shell__nav" aria-label={t('nav.label')} data-testid="shell-nav">
      {NAV.filter((n) => !(mode === 'team' && n.judgeOnly)).map((n) => (
        <a
          key={n.id}
          href={n.href}
          data-nav={n.id}
          aria-current={current === n.id ? 'page' : undefined}
        >
          {t(n.key)}
        </a>
      ))}
    </nav>
  );
});

export function AppShell({
  role,
  eyebrow,
  meta,
  nav = 'full',
  connection,
  right,
  children,
  testId,
}: {
  role: ShellRole;
  /** 页签名（已翻译）：裁判台 / 参赛者 A / … */
  eyebrow: string;
  /** 页面自己的头部数据（match id、回合、阶段…）；testid 由页面保留 */
  meta?: ReactNode;
  nav?: NavMode;
  /** `ConnectionTag` 槽 */
  connection?: ReactNode;
  /** 右侧额外链接（例如「本场回放」） */
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="shell" data-role={role} data-testid={testId}>
      <header className="shell__bar">
        <a className="shell__brand" href="/" aria-label={t('nav.home')}>
          {t('app.brand')}
        </a>
        <span className="shell__eyebrow">{eyebrow}</span>
        {meta !== undefined && meta !== null ? <div className="shell__meta">{meta}</div> : null}
        <div className="shell__right">
          {nav !== 'none' ? <ShellNav mode={nav} /> : null}
          {right}
          <LanguageSwitch />
          {connection}
        </div>
      </header>
      <div className="shell__body">{children}</div>
    </div>
  );
}
