/**
 * 回放 —— 用**已落盘**的 MatchLog / Replay 重放真实比赛。
 *
 * 回放期间**不运行任何算法**：这一页消费的是 `replay.json` 里引擎记下的
 * 轨迹与结果，服务端连沙箱都不会起。所以它可以在比赛结束后很久、
 * 甚至在另一台机器上，如实地重放当时发生了什么。
 *
 * 播放器（V1.4）：上一轮 / 播放·暂停 / 下一轮 / 「第 N / 共 T 轮」/ 时间线 / 0.5× 1× 2×。
 * 速度只缩放**动画时长与换帧间隔**（见 `replayPlayer.ts`），不改任何一帧的内容。
 * 键盘：播放器获得焦点时 ← → 切帧、空格 播放/暂停、Home/End 首末帧 ——
 * 是附加路径，可见的按钮永远在。
 *
 * 胜者 / 终局原因 / 先手 / 难度都经 `winnerLabel` / `endReasonLabel` / `firstSolverLabel` /
 * `difficultyLabel` 翻成人话；枚举原文留在 `data-*` 属性里，不再直接印到屏上。
 */

import { useEffect, useMemo, useState } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { AppShell } from '../components/AppShell';
import { ErrorNotice } from '../components/ErrorNotice';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { StatusLine } from '../components/StatusLine';
import { TeamLabel } from '../components/TeamLabel';
import { useReplayList } from '../api/client';
import { difficultyLabel, endReasonLabel, firstSolverLabel, winnerLabel } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import {
  SPEEDS,
  advance,
  applyCommand,
  autoplayDelayMs,
  clampIndex,
  frameDurationMs,
  keyToCommand,
  secondsText,
  speedText,
} from './replayPlayer';
import type { PlayerState, Speed } from './replayPlayer';
import type { ArenaView, TrajectoryPayload, WirePoint } from '../../../src/server/protocol';
import type { JSX, KeyboardEvent } from 'react';

/** `replay.json` 里一帧的**结构镜像**（只列这一页会读的字段；其余原样忽略） */
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
  /** 本帧终结比赛时的原因；比赛仍继续时为 'NONE'。旧产物可能缺，读时兜底 */
  endReason?: string;
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

/** 回放打不开时服务端给的原因（键 + 参数 + 原文），按**当前语言**在渲染时翻译 */
interface LoadFailure {
  status: number;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
  raw: string | null;
}

const FIELD = { xMin: -20, xMax: 20, yMin: -12, yMax: 12 };
const NO_KILLED: readonly string[] = [];

/**
 * 侧栏队名：产物里的 `teamAName` 目前就是 “Team A”（服务端写的是队别，不是算法名），
 * 与前面的 TeamLabel 重复 —— 只在它真的带来信息（不等于队别）时才显示。
 */
function distinctTeamName(name: string | undefined, team: 'A' | 'B'): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === `team ${team}`.toLowerCase()) return null;
  return trimmed;
}

export function ReplayPage({ matchId }: { matchId: string }): JSX.Element {
  const { t, td, locale } = useI18n();
  const [data, setData] = useState<{ replay: ReplayDto; match: MatchDto } | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  /** 重试计数：读取失败时「重试」按钮把它 +1，effect 重新拉一次 */
  const [attempt, setAttempt] = useState(0);
  const [player, setPlayer] = useState<PlayerState>({ index: 0, playing: false });
  const [speed, setSpeed] = useState<Speed>(1);
  const { replays } = useReplayList();

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailure(null);
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
          // 服务端给的是**原因键**（见 `classifyMatch`）；这里只存下来，渲染时按当前语言取译文
          setFailure({
            status: r.status,
            reasonKey: j.reasonKey ?? '',
            reasonParams: j.reasonParams,
            raw: j.errors?.[0] ?? null,
          });
          return;
        }
        setData({ replay: j.replay, match: j.match });
        setPlayer({ index: 0, playing: false });
      })
      .catch((e: Error) => {
        if (alive) setFailure({ status: 0, reasonKey: '', raw: e.message });
      });
    return () => {
      alive = false;
    };
  }, [matchId, attempt]);

  const replay = data?.replay ?? null;
  const match = data?.match ?? null;
  const total = replay?.frames.length ?? 0;
  const index = clampIndex(player.index, total);
  const frame = replay?.frames[index] ?? null;

  /**
   * 回放帧 → 与实时视图同一种轨迹载荷（画布因此完全复用）。
   * 轨迹点就是引擎当时判定、截断、降采样后落盘的那些点 —— 这里不求值任何函数。
   * `durationMs` 是唯一随速度变的量；id 不含速度：切速度不重放当前帧的动画，
   * 新时长从下一帧起生效。
   */
  const trajectory = useMemo<TrajectoryPayload | null>(() => {
    if (!replay || !frame) return null;
    return {
      id: `${replay.matchId}:${frame.round}:replay`,
      round: frame.round,
      A: frame.trajectoryA,
      B: frame.trajectoryB,
      killed: frame.killed,
      durationMs: frameDurationMs(speed),
    };
  }, [replay, frame, speed]);

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

  // 自动播放：每帧停够「动画时长 + 停顿」再走下一帧；最后一帧后停下
  useEffect(() => {
    if (!player.playing || total === 0) return;
    const timer = window.setTimeout(() => setPlayer((p) => advance(p, total)), autoplayDelayMs(speed));
    return () => window.clearTimeout(timer);
  }, [player.playing, player.index, total, speed]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const cmd = keyToCommand(e.key);
    if (!cmd) return;
    const target = e.target as HTMLElement;
    // 原生控件自己处理：滑块的方向键、按钮的空格 —— 不抢，免得一次按键触发两次
    if (target.tagName === 'INPUT') return;
    if (cmd === 'toggle' && target !== e.currentTarget) return;
    e.preventDefault();
    setPlayer((p) => applyCommand(p, cmd, total));
  };

  const eyebrow = t('replay.title');
  const idMeta = <span className="num muted">{matchId}</span>;

  if (failure) {
    // 认不出键（服务端换了新原因、界面还没跟上）时回退到它给的原文，最后才是本地那句 HTTP 兜底
    const reason = td(
      failure.reasonKey,
      failure.reasonParams,
      failure.raw ?? t('replay.loadFailed', { status: failure.status })
    );
    return (
      <AppShell role="replay" eyebrow={eyebrow} meta={idMeta}>
        <div className="gate" data-testid="replay-error" data-status={failure.status}>
          <ErrorNotice
            scope="server"
            title={t('replay.loadTitle')}
            body={reason}
            retry={() => setAttempt((n) => n + 1)}
            testId="replay-error-notice"
          >
            <p className="notice__body">
              <a className="link" href="/replays" data-testid="replay-back">
                {t('replay.backToList')}
              </a>
            </p>
          </ErrorNotice>
        </div>
      </AppShell>
    );
  }

  if (!replay || !match || !arena || !frame) {
    return (
      <AppShell role="replay" eyebrow={eyebrow} meta={idMeta}>
        <div className="gate" data-testid="replay-loading">
          <p className="empty">{t('replay.loading')}</p>
        </div>
      </AppShell>
    );
  }

  const frameSummary = (f: ReplayFrameDto): string =>
    t('replay.frameSummary', {
      first: firstSolverLabel(locale, f.firstSolver),
      attacks: f.attacksExecuted.length ? f.attacksExecuted.join('→') : t('common.none'),
      kills: f.killed.length ? f.killed.join(',') : t('common.none'),
    });
  const frameEnd = typeof frame.endReason === 'string' ? frame.endReason : 'NONE';
  const counter = t('replay.counter', { n: frame.round, total });
  const others = replays.filter((r) => r.matchId !== replay.matchId).slice(0, 8);

  return (
    <AppShell
      role="replay"
      eyebrow={eyebrow}
      meta={
        <>
          <span className="num muted" data-testid="replay-match-id">
            {replay.matchId}
          </span>
          <span className="eyebrow" data-testid="replay-meta">
            {t('replay.meta', {
              points: match.pointCount,
              // 难度是协议枚举 —— 值不变，只翻给人看的那个词；认不出的历史值原样显示
              difficulty: difficultyLabel(locale, match.difficulty),
              seed: match.seed,
            })}
          </span>
          <span
            className="replay__verdict"
            data-testid="replay-verdict"
            data-winner={replay.winner}
            data-end-reason={replay.endReason}
          >
            <StatusBadge status="terminal">
              <span data-testid="replay-winner" data-winner={replay.winner}>
                {winnerLabel(locale, replay.winner)}
              </span>
              <span aria-hidden="true"> · </span>
              <span data-testid="replay-end-reason" data-end-reason={replay.endReason}>
                {endReasonLabel(locale, replay.endReason)}
              </span>
            </StatusBadge>
          </span>
        </>
      }
    >
      <div className="replay" data-testid="replay" data-match-id={replay.matchId}>
        <aside className="replay__side">
          <div className="replay__teams" data-testid="replay-teams">
            {(['A', 'B'] as const).map((side) => {
              const name = distinctTeamName(side === 'A' ? replay.teamAName : replay.teamBName, side);
              return (
                <TeamLabel key={side} team={side}>
                  {name ? <span className="replay__teamname muted">{name}</span> : null}
                </TeamLabel>
              );
            })}
          </div>

          <SectionHeader title={t('replay.rounds')} meta={t('replay.roundsCount', { n: total })} />
          <ol className="framelist" data-testid="replay-frame-list">
            {replay.frames.map((f, i) => (
              <li key={f.round}>
                <button
                  type="button"
                  className="frame-btn"
                  data-testid="replay-frame"
                  data-round={f.round}
                  data-index={i}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setPlayer({ index: i, playing: false })}
                >
                  <span className="dim">{t('replay.roundShort', { n: String(f.round).padStart(2, '0') })}</span>
                  <span>{frameSummary(f)}</span>
                </button>
              </li>
            ))}
          </ol>

          {others.length > 0 ? (
            <>
              <SectionHeader title={t('replay.others')} className="replay__others-title" />
              <div data-testid="replay-others">
                {others.map((r) => (
                  <a
                    key={r.matchId}
                    className="frame-link"
                    data-testid="replay-other"
                    href={`/replay/${encodeURIComponent(r.matchId)}`}
                    title={r.matchId}
                    data-winner={r.winner}
                  >
                    <span className="dim">{t('replay.roundsBadge', { n: r.rounds })}</span>
                    <span>
                      {winnerLabel(locale, r.winner)} · <span className="num">{r.matchId.slice(-8)}</span>
                    </span>
                  </a>
                ))}
              </div>
            </>
          ) : null}
        </aside>

        <main className="replay__main">
          <div className="replay__stage">
            <ArenaCanvas arena={arena} trajectory={trajectory} killed={frame.killed ?? NO_KILLED} />
          </div>

          {/* 本帧的事实：先手 / 攻击 / 击杀 / 用时，以及「比赛在这一帧终结」 */}
          <div
            className="replay__info"
            data-testid="replay-frame-info"
            data-round={frame.round}
            data-first-solver={frame.firstSolver}
            data-frame-end-reason={frameEnd}
          >
            <StatusLine label={t('replay.first')} value={firstSolverLabel(locale, frame.firstSolver)} testId="replay-frame-first" />
            <StatusLine
              label={t('replay.attacks')}
              value={frame.attacksExecuted.length ? frame.attacksExecuted.join(' → ') : '—'}
            />
            <StatusLine
              label={t('replay.kills')}
              value={frame.killed.length ? frame.killed.join(',') : t('common.none')}
              testId="replay-frame-kills"
            />
            <StatusLine
              label={t('replay.time')}
              value={`A ${secondsText(frame.timerA)} · B ${secondsText(frame.timerB)}`}
            />
            {frameEnd !== 'NONE' ? (
              <StatusBadge status="terminal" testId="replay-frame-end">
                {t('replay.frameEnd', { reason: endReasonLabel(locale, frameEnd) })}
              </StatusBadge>
            ) : null}
          </div>

          {/*
            播放器。容器可聚焦（tabIndex=0）以承接键盘；aria-label 说明快捷键。
            按钮的禁用只表达「已在首 / 末帧」—— 这是播放器自己的状态，不是比赛判定。
          */}
          <div
            className="player"
            data-testid="replay-player"
            tabIndex={0}
            role="group"
            aria-label={t('replay.player')}
            onKeyDown={onKeyDown}
            data-playing={player.playing ? 'true' : 'false'}
            data-speed={speed}
            data-index={index}
            data-total={total}
          >
            <div className="player__row" data-testid="replay-controls">
              <div className="player__transport">
                <button
                  type="button"
                  className="btn"
                  data-testid="replay-prev"
                  disabled={index === 0}
                  title={t('replay.prev')}
                  onClick={() => setPlayer((p) => applyCommand(p, 'prev', total))}
                >
                  ‹ {t('replay.prev')}
                </button>
                <button
                  type="button"
                  className="btn btn--a player__play"
                  data-testid="replay-play"
                  aria-pressed={player.playing}
                  onClick={() => setPlayer((p) => applyCommand(p, 'toggle', total))}
                >
                  {player.playing ? t('replay.pause') : t('replay.play')}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="replay-next"
                  disabled={index >= total - 1}
                  title={t('replay.next')}
                  onClick={() => setPlayer((p) => applyCommand(p, 'next', total))}
                >
                  {t('replay.next')} ›
                </button>
              </div>

              <span className="player__counter num" data-testid="replay-counter" data-index={index} data-total={total}>
                {counter}
              </span>

              <input
                type="range"
                className="player__timeline"
                data-testid="replay-timeline"
                min={0}
                max={Math.max(0, total - 1)}
                step={1}
                value={index}
                aria-label={t('replay.slider')}
                aria-valuetext={counter}
                onChange={(e) => setPlayer({ index: clampIndex(Number(e.target.value), total), playing: false })}
              />

              <div className="player__speed" role="group" aria-label={t('replay.speed')} data-testid="replay-speed">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`player__speedopt num${s === speed ? ' is-on' : ''}`}
                    data-testid={`replay-speed-${s}`}
                    data-speed={s}
                    aria-pressed={s === speed}
                    aria-label={t('replay.speedOption', { x: s })}
                    onClick={() => setSpeed(s)}
                  >
                    {speedText(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
