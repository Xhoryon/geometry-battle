/**
 * 回放列表表格 —— 首页「最近比赛」与 `/replays` 共用。
 *
 * 数据是 `GET /api/replays`（匿名端点）原样的字段，这里不加工任何结论：
 * 胜者 / 终局原因经 `winnerLabel` / `endReasonLabel` 翻成人话，枚举原文留在
 * `data-winner` / `data-end-reason` 里。日期用 `Intl.DateTimeFormat(locale)`。
 */

import { useMemo } from 'react';
import { endReasonLabel, winnerLabel } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import { ErrorNotice } from './ErrorNotice';
import type { ReplayIndexEntry, ReplayListFeed } from '../api/client';
import type { JSX } from 'react';

/** 场次 id 的短形式（表格里放全名太宽；全名在 title 与链接里） */
function shortId(id: string): string {
  return id.length > 10 ? `…${id.slice(-8)}` : id;
}

export function ReplayTable({
  feed,
  limit,
  testId = 'replay-table',
}: {
  feed: ReplayListFeed;
  /** 首页只放最近几场；不传 = 全部 */
  limit?: number;
  testId?: string;
}): JSX.Element {
  const { t, locale } = useI18n();
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale]
  );
  const when = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : fmt.format(d);
  };

  if (feed.error) {
    return (
      <ErrorNotice
        scope="server"
        title={t('replays.loadFailed')}
        body={feed.error}
        retry={feed.reload}
        testId={`${testId}-error`}
      />
    );
  }
  if (feed.loading && feed.replays.length === 0) {
    return (
      <p className="muted" data-testid={`${testId}-loading`}>
        {t('replays.loading')}
      </p>
    );
  }
  const rows: ReplayIndexEntry[] = limit === undefined ? feed.replays : feed.replays.slice(0, limit);
  if (rows.length === 0) {
    return (
      <p className="empty empty--inline" data-testid={`${testId}-empty`}>
        {t('replays.empty')}
      </p>
    );
  }
  return (
    <table className="replays" data-testid={testId}>
      <thead>
        <tr>
          <th>{t('replays.col.ended')}</th>
          <th>{t('replays.col.match')}</th>
          <th>{t('replays.col.teams')}</th>
          <th>{t('replays.col.result')}</th>
          <th>{t('replays.col.reason')}</th>
          <th className="replays__num">{t('replays.col.rounds')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const href = `/replay/${encodeURIComponent(r.matchId)}`;
          return (
            <tr key={r.matchId} data-testid="replay-row" data-match-id={r.matchId}>
              <td className="num">{when(r.endedAt)}</td>
              <td>
                <a className="link num" href={href} title={r.matchId} aria-label={`${t('replays.open')} ${r.matchId}`}>
                  {shortId(r.matchId)}
                </a>
              </td>
              <td>{t('replays.vs', { a: r.teamAName, b: r.teamBName })}</td>
              <td className="replays__winner" data-winner={r.winner}>
                {winnerLabel(locale, r.winner)}
              </td>
              <td data-end-reason={r.endReason}>{endReasonLabel(locale, r.endReason)}</td>
              <td className="num replays__num">{r.rounds}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
