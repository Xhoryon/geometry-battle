/**
 * 首页 `/` —— 「选择身份」（V1.4）。
 *
 * 此前 `/` 直接渲染裁判台并 `replaceState` 成 `/judge`：没带令牌的人只看到一句
 * 「正在连接」永远转圈，而且 `replaceState` 会把地址里的 `#t=` 丢掉。
 * 现在 `/` 是一个不需要任何权限的入口页：四张身份卡 + 最近比赛。
 *
 * 令牌纪律：裁判 / 参赛者卡片上的「粘贴访问链接或令牌」只做一件事 ——
 * 解析出令牌后 `location.assign('/judge#t=…')`。令牌**只进 fragment**，
 * 不进查询串、不进 localStorage、不进任何请求；解析失败就地报错、不导航。
 * 导航可见 ≠ 有权限：没带令牌打开裁判台，由那一页自己解释「缺令牌」。
 */

import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ErrorNotice } from '../components/ErrorNotice';
import { ReplayTable } from '../components/ReplayTable';
import { SectionHeader } from '../components/SectionHeader';
import { TeamLabel } from '../components/TeamLabel';
import { useReplayList } from '../api/client';
import { useI18n } from '../i18n/useI18n';
import { accessHref, parseAccessInput } from './accessLink';
import type { TokenPath } from './accessLink';
import type { FormEvent, JSX, ReactNode } from 'react';

/** 首页只放最近几场；全部在 /replays */
const RECENT_LIMIT = 6;

/**
 * 「粘贴访问链接或令牌」小表单。
 *
 * 用 `<form>` 而不是裸按钮：回车提交是粘贴一串东西之后最自然的动作。
 * 输入框 `autoComplete="off"`：令牌不该进浏览器的表单历史。
 */
function AccessForm({ path, id }: { path: TokenPath; id: string }): JSX.Element {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const target = parseAccessInput(value, path, location.origin);
    if (!target) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // 整页导航：目标页会从 fragment 现读令牌（api/client.ts），这里不保存任何东西
    location.assign(accessHref(target));
  };

  return (
    <form className="access-form-wrap" onSubmit={submit} data-testid={`access-form-${id}`}>
      <label className="field" htmlFor={`access-input-${id}`}>
        <span>{t('home.access.pasteLabel')}</span>
      </label>
      <div className="access-form">
        <input
          id={`access-input-${id}`}
          data-testid={`access-input-${id}`}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder={t('home.access.pastePlaceholder')}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `access-error-${id}` : undefined}
        />
        <button type="submit" className="btn" data-testid={`access-go-${id}`}>
          {t('home.access.go')}
        </button>
      </div>
      {invalid ? (
        <ErrorNotice
          scope={path === '/judge' ? 'judge' : 'participant'}
          title={t('home.access.invalid')}
          testId={`access-error-${id}`}
          className="access-form__error"
        />
      ) : null}
    </form>
  );
}

function RoleCard({
  role,
  id,
  title,
  desc,
  href,
  tokenPath,
  note,
}: {
  role: 'judge' | 'team' | 'spectator';
  id: string;
  title: ReactNode;
  desc: string;
  href: string;
  /** 需要令牌的页面：给了就渲染「需要访问链接」说明 + 粘贴表单 */
  tokenPath?: TokenPath;
  note?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="rolecard" data-role={role} data-testid={`home-role-${id}`}>
      <h2 className="rolecard__title">{title}</h2>
      <p className="rolecard__desc">{desc}</p>
      {tokenPath ? (
        <>
          <p className="rolecard__note">
            <strong>{t('home.access.required')}</strong> — {note}
          </p>
          <AccessForm path={tokenPath} id={id} />
          <a className="link rolecard__plain" href={href} data-testid={`home-open-${id}`}>
            {t('home.role.enterWithoutToken')}
          </a>
        </>
      ) : (
        <div className="rolecard__actions">
          <a className="btn btn--primary" href={href} data-testid={`home-open-${id}`}>
            {t('home.role.enter')} →
          </a>
        </div>
      )}
    </section>
  );
}

export function HomePage(): JSX.Element {
  const { t } = useI18n();
  const feed = useReplayList();

  return (
    <AppShell role="home" eyebrow={t('home.eyebrow')} testId="home">
      <div className="home">
        <header className="home__hero">
          <h1 className="home__title">{t('home.title')}</h1>
          <p className="home__lead">{t('home.lead')}</p>
        </header>

        <div className="rolegrid">
          <RoleCard
            role="judge"
            id="judge"
            title={t('home.role.judge.title')}
            desc={t('home.role.judge.desc')}
            href="/judge"
            tokenPath="/judge"
            note={t('home.access.judgeNote')}
          />
          <RoleCard
            role="team"
            id="team-a"
            title={<TeamLabel team="A" />}
            desc={t('home.role.team.desc')}
            href="/team/a"
            tokenPath="/team/a"
            note={t('home.access.teamNote')}
          />
          <RoleCard
            role="team"
            id="team-b"
            title={<TeamLabel team="B" />}
            desc={t('home.role.team.desc')}
            href="/team/b"
            tokenPath="/team/b"
            note={t('home.access.teamNote')}
          />
          <RoleCard
            role="spectator"
            id="spectator"
            title={t('home.role.spectator.title')}
            desc={t('home.role.spectator.desc')}
            href="/spectator"
          />
        </div>

        <section className="panel" data-testid="home-replays">
          <SectionHeader
            title={t('home.replays.title')}
            meta={
              <a className="link" href="/replays" data-testid="home-replays-all">
                {t('home.replays.all')}
              </a>
            }
          />
          <ReplayTable feed={feed} limit={RECENT_LIMIT} testId="home-replay-table" />
        </section>
      </div>
    </AppShell>
  );
}
