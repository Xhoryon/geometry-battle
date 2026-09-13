/**
 * 回放列表 `/replays` —— `GET /api/replays` 的全部条目（匿名端点）。
 * 与首页「最近比赛」是同一张表；这里不截断。
 */

import { AppShell } from '../components/AppShell';
import { ReplayTable } from '../components/ReplayTable';
import { SectionHeader } from '../components/SectionHeader';
import { useReplayList } from '../api/client';
import { useI18n } from '../i18n/useI18n';
import type { JSX } from 'react';

export function ReplaysPage(): JSX.Element {
  const { t } = useI18n();
  const feed = useReplayList();
  return (
    <AppShell role="replay" eyebrow={t('replays.title')} testId="replays-page">
      <div className="replays-page">
        <section className="panel">
          <SectionHeader
            title={t('replays.title')}
            meta={feed.loading ? null : t('replays.count', { n: feed.replays.length })}
          />
          <ReplayTable feed={feed} testId="replays-table" />
        </section>
      </div>
    </AppShell>
  );
}
