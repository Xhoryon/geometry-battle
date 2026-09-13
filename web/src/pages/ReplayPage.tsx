/**
 * 回放 —— 用**已落盘**的 MatchLog / Replay 重放真实比赛。
 *
 * 回放期间**不运行任何算法**：这一页消费的是 `replay.json` 里引擎记下的
 * 轨迹与结果，服务端连沙箱都不会起。所以它可以在比赛结束后很久、
 * 甚至在另一台机器上，如实地重放当时发生了什么。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { useReplayList } from '../api/client';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { difficultyLabel } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import type { ArenaView, TrajectoryPayload, WirePoint } from '../../../src/server/protocol';
import type { JSX } from 'react';

interface ReplayFrameDto {
  round: number;
  obstacles: ArenaView['obstacles'];
  aliveAfter: { id: string; team: 'A' | 'B'; position: WirePoint }[];
  emitters: ArenaView['emitters'];
  trajectoryA: WirePoint[];
  trajectoryB: WirePoint[];
  killed: string[];
  firstSolver: string;
  attacksExecuted: string[];
  endReason: string;
  functionMathA: string | null;
  functionMathB: string | null;
  timerA: number | null;
  timerB: number | null;
}

interface ReplayDto {
  matchId: string;
  winner: 'A' | 'B' | 'draw';
  endReason: string;
  teamAName: string;
  teamBName: string;
  frames: ReplayFrameDto[];
}

interface MatchDto {
  matchId: string;
  seed: number;
  pointCount: number;
  difficulty: string;
  rounds: { round: number }[];
  finalAlive: { A: number; B: number };
}

const FIELD = { xMin: -20, xMax: 20, yMin: -12, yMax: 12 };
const FRAME_MS = 1100;

export function ReplayPage({ matchId }: { matchId: string }): JSX.Element {
  const { t, td, locale } = useI18n();
  const [replay, setReplay] = useState<ReplayDto | null>(null);
  const [match, setMatch] = useState<MatchDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const { replays } = useReplayList();

  useEffect(() => {
    let alive = true;
    setReplay(null);
    setMatch(null);
    setError(null);
    fetch(`/api/replays/${encodeURIComponent(matchId)}`)
      .then(async (r) => {
        const j = (await r.json()) as {
          replay?: ReplayDto;
          match?: MatchDto;
          errors?: string[];
          reasonKey?: string;
          reasonParams?: Record<string, string | number>;
        };
        if (!alive) return;
        if (!r.ok || !j.replay || !j.match) {
          // 服务端给的是**原因键**（见 `classifyMatch`），这里按当前语言取译文；
          // 认不出键时回退到它给的原文，最后才退回本地那句 HTTP 兜底。
          setError(
            td(
              j.reasonKey ?? '',
              j.reasonParams,
              j.errors?.[0] ?? t('replay.loadFailed', { status: r.status })
            )
          );
          return;
        }
        setReplay(j.replay);
        setMatch(j.match);
        setIndex(0);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [matchId, t]);

  const frame = replay?.frames[index] ?? null;

  /** 回放帧 → 与实时视图同一种轨迹载荷（画布因此完全复用） */
  const trajectory = useMemo<TrajectoryPayload | null>(() => {
    if (!replay || !frame) return null;
    return {
      id: `${replay.matchId}:${frame.round}:replay`,
      round: frame.round,
      A: frame.trajectoryA,
      B: frame.trajectoryB,
      killed: frame.killed,
      durationMs: FRAME_MS,
    };
  }, [replay, frame]);

  const arena = useMemo<ArenaView | null>(() => {
    if (!frame) return null;
    return {
      field: FIELD,
      obstacles: frame.obstacles,
      emitters: frame.emitters,
      // 回放帧记录的是「本轮之后」的存活点 —— 那正是这一帧该画的局面
      points: frame.aliveAfter.map((p) => ({ id: p.id, team: p.team, position: p.position, alive: true })),
    };
  }, [frame]);

  // 自动播放：每帧停够动画时长再走下一帧
  useEffect(() => {
    if (!playing || !replay) return;
    timer.current = window.setTimeout(() => {
      setIndex((i) => {
        if (i + 1 >= replay.frames.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, FRAME_MS + 350);
    return () => window.clearTimeout(timer.current);
  }, [playing, index, replay]);

  if (error) {
    return (
      <div className="replay">
        <div className="replay__bar">
          <span className="eyebrow">{t('replay.title')}</span>
          <span className="num muted">{matchId}</span>
          <LanguageSwitch />
        </div>
        <div className="empty">
          {error}
          <div style={{ marginTop: 16 }}>
            <a className="link" href="/judge">
              {t('nav.backToJudge')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!replay || !match || !arena) {
    return (
      <div className="replay">
        <div className="replay__bar">
          <span className="eyebrow">{t('replay.title')}</span>
          <LanguageSwitch />
        </div>
        <div className="empty">{t('replay.loading')}</div>
      </div>
    );
  }

  return (
    <div className="replay">
      <header className="replay__bar">
        <span className="eyebrow">{t('replay.title')}</span>
        <span className="num muted">{replay.matchId}</span>
        <span className="eyebrow">
          {t('replay.meta', {
            points: match.pointCount,
            // 难度是协议枚举 —— 值不变，只翻给人看的那个词
            difficulty: difficultyLabel(locale, match.difficulty),
            seed: match.seed,
          })}
        </span>
        <span
          className="num"
          style={{
            color: replay.winner === 'draw' ? 'var(--muted)' : replay.winner === 'A' ? 'var(--a)' : 'var(--b)',
            fontWeight: 600,
          }}
        >
          {replay.winner === 'draw'
            ? t('replay.draw')
            : t('replay.winner', { team: replay.winner })}
        </span>
        <span className="eyebrow">{replay.endReason}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <a className="link" href="/judge">
            {t('nav.judge')}
          </a>
          <a className="link" href="/spectator">
            {t('nav.spectator')}
          </a>
          <LanguageSwitch />
        </span>
      </header>

      <aside className="replay__side">
        <div className="panel__title">
          <h2>{t('replay.rounds')}</h2>
          <span className="num dim">{t('replay.roundsCount', { n: replay.frames.length })}</span>
        </div>
        {replay.frames.map((f, i) => (
          <button
            key={f.round}
            type="button"
            className="frame-btn"
            aria-current={i === index}
            onClick={() => {
              setPlaying(false);
              setIndex(i);
            }}
          >
            <span className="dim">
              {t('replay.roundShort', { n: String(f.round).padStart(2, '0') })}
            </span>
            <span>
              {t('replay.frameSummary', {
                first: f.firstSolver,
                attacks: f.attacksExecuted.length ? f.attacksExecuted.join('→') : t('common.none'),
                kills: f.killed.length ? f.killed.join(',') : t('common.none'),
              })}
            </span>
          </button>
        ))}

        <div className="panel__title" style={{ marginTop: 20 }}>
          <h2>{t('replay.others')}</h2>
        </div>
        {replays
          .filter((r) => r.matchId !== replay.matchId)
          .slice(0, 8)
          .map((r) => (
            <button
              key={r.matchId}
              type="button"
              className="frame-btn"
              onClick={() => {
                window.location.href = `/replay/${encodeURIComponent(r.matchId)}`;
              }}
            >
              <span className="dim">{t('replay.roundsBadge', { n: r.rounds })}</span>
              <span>
                {r.winner === 'draw' ? t('replay.draw') : `TEAM ${r.winner}`} ·{' '}
                {r.matchId.slice(-8)}
              </span>
            </button>
          ))}
      </aside>

      <main className="replay__main">
        <div className="replay__stage">
          <ArenaCanvas arena={arena} trajectory={trajectory} killed={frame?.killed ?? []} />
        </div>

        <div className="replay__controls">
          <button type="button" className="btn btn--a" onClick={() => setPlaying((p) => !p)}>
            {playing ? t('replay.pause') : t('replay.play')}
          </button>
          <button type="button" className="btn" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            {t('replay.prev')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setIndex((i) => Math.min(replay.frames.length - 1, i + 1))}
          >
            {t('replay.next')}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, replay.frames.length - 1)}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            aria-label={t('replay.slider')}
          />
          <span className="num muted">
            {t('replay.roundShort', { n: String(frame?.round ?? 0).padStart(2, '0') })} /{' '}
            {replay.frames.length}
          </span>
          <span className="num dim">
            {t('replay.frameSummary', {
              first: String(frame?.firstSolver ?? ''),
              attacks: frame?.attacksExecuted.join('→') || '—',
              kills: frame?.killed.length ? frame.killed.join(',') : t('common.none'),
            })}
          </span>
        </div>
      </main>
    </div>
  );
}
