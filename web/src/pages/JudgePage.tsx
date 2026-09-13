/**
 * 裁判台 —— phase-driven wizard（V1.2 §三；V1.4 重排信息架构）。
 *
 * 三条硬规矩：
 *
 *   1. **可用性只来自服务端。** 每个按钮的 `disabled` 只能由服务端下发的
 *      `action.enabled` 决定（再与 `busy` 求与 —— 这是唯一允许的前端注入）。
 *      本文件里**没有** `phase === 'READY'` 这类影子规则：阶段名只用来决定
 *      **展示哪一步 / 显示哪一块**，绝不用来决定「能不能点」。V1.1 的裁判台
 *      正是拿阶段名去猜可用性，结果校验通过了反而开不了赛。
 *   2. **一个阶段只突出一个合法主动作。** 主按钮从 `board.actions` 里挑
 *      （`judgeWizard.ts` 的 `STEPS` / `pickPrimary`），其余动作全部收进 Advanced。
 *      同一个动作 key 在页面上**只会出现一次**：做了主按钮就不再出现在 Advanced 里，
 *      否则选择器会撞到两个同名按钮。
 *   3. **危险动作两步确认。** `reset`（= 换场）会清掉双方 Emitter 锁定、换 matchId 与
 *      参赛者链接；目录路径安装会替换槽位里的包。第一次点只把**影响**亮出来，
 *      第二次（`reset-confirm`）才执行。Reveal / START / 连续跑完**不**确认 —— 那是主流程。
 *
 * 七个区块（V1.4 IA）：比赛状态 · Team A · Team B · 竞技场 · 主动作 · Advanced · 审计/源码核对。
 * 错误分层贴在它发生的地方：裁判动作错误挨着按钮；后台推进失败在「比赛状态」里；
 * 本轮算法异常在竞技场下方；连接 / 令牌问题由 ConnectionTag / AccessNotice 说。
 *
 * 绝不渲染服务端的绝对路径：`SlotView.dir` / `source` / `slotRoot` / `artifactDir`
 * 一个都不上屏 —— 裁判核对「跑的是不是选手那份」靠算法名、哈希与源码预览。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { AppShell } from '../components/AppShell';
import { ComputeStatus } from '../components/ComputeStatus';
import { ConnectionTag, pendingBodyKey } from '../components/ConnectionTag';
import { AccessNotice } from '../components/AccessNotice';
import { ErrorNotice } from '../components/ErrorNotice';
import { PrimaryAction } from '../components/PrimaryAction';
import { SectionHeader } from '../components/SectionHeader';
import { PreflightBadge, preflightState } from '../components/PreflightBadge';
import { StatusBadge } from '../components/StatusBadge';
import { StatusLine } from '../components/StatusLine';
import { TeamLabel } from '../components/TeamLabel';
import { command, fetchJudgeSource, useBoard, useTrajectory } from '../api/client';
import {
  PHASE_KEYS,
  WIZARD_STAGE_KEYS,
  difficultyLabel,
  endReasonLabel,
  firstSolverLabel,
  localizeRoundErrors,
  slotStatusLabel,
  winnerLabel,
} from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import { STAGE_ORDER, STEPS, pickPrimary, stageIndexOf } from './judgeWizard';
import { COMMAND_PATHS } from '../../../src/server/protocol';
import type {
  ActionView,
  ComputeCell,
  JudgeBoard,
  SlotView,
  WireTeam,
} from '../../../src/server/protocol';
import type { Status } from '../components/StatusBadge';
import type { TranslationKey } from '../i18n/translations';
import type { JSX, ReactNode } from 'react';

/** 动作 key → 命令接口。表驱动，避免在 JSX 里堆 switch。 */
const ACTION_PATHS: Record<string, string> = {
  prepare: COMMAND_PATHS.prepare,
  'use-slot-a': COMMAND_PATHS.useSlot,
  'use-slot-b': COMMAND_PATHS.useSlot,
  preflight: COMMAND_PATHS.preflight,
  start: COMMAND_PATHS.start,
  reveal: COMMAND_PATHS.reveal,
  'start-round': COMMAND_PATHS.startRound,
  compute: COMMAND_PATHS.compute,
  'run-to-end': COMMAND_PATHS.runToEnd,
  reset: COMMAND_PATHS.reset,
};

function actionBody(key: string): Record<string, unknown> {
  if (key === 'use-slot-a') return { team: 'A' };
  if (key === 'use-slot-b') return { team: 'B' };
  return {};
}

/**
 * 需要两步确认的服务端动作。
 *
 * 只有 `reset`：它就是「换场」（服务端 `reset` 与 `new-match` 是同一条路径），
 * 会作废双方已锁定的 Emitter。其余动作都是主流程里的正向推进，不设门槛。
 */
const DANGER_ACTIONS: ReadonlySet<string> = new Set(['reset']);

/** 目录路径安装的确认 key（不是服务端动作 key，因此不带 `data-action`） */
const installKey = (team: WireTeam): string => `install-${team}`;

/** 计算状态 → 徽章状态 / 译文键（文案在 i18n 表里，这里只存键） */
const COMPUTE_TONE: Record<ComputeCell['state'], Status> = {
  idle: 'neutral',
  running: 'active',
  done: 'ready',
  error: 'error',
};
const COMPUTE_KEY: Record<ComputeCell['state'], TranslationKey> = {
  idle: 'compute.idle',
  running: 'compute.running',
  done: 'compute.done',
  error: 'compute.error',
};

/** 哈希只给人眼对前 12 位 —— 全量哈希对不了人眼，源码预览才是核对手段 */
const SHORT_HASH = 12;
const shortHash = (h: string): string => `${h.slice(0, SHORT_HASH)}…`;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 稳定的空数组：没有本轮结果时给画布的 `killed`，避免每次渲染新建一个引用 */
const NO_KILLED: readonly string[] = [];

// ============================================================================
// Emitter 状态（裁判是权威视角）
// ============================================================================

interface EmitterRow {
  team: WireTeam;
  selected: string | null;
  /** null = 服务端没给这一位（未知），不去猜 */
  locked: boolean | null;
}

/**
 * 双方 Emitter 的选择与锁定状态。
 *
 * 读的是服务端下发的 `board.emitterSelection`（引擎快照的直通投影）——
 * 页面不推断「谁选了没有」，也不拿阶段名反推锁定状态。协议里暂时没有这个
 * 字段时，只使用「双方锁定后公开的锚点」这**一条事实**，不去推断单方的锁定状态。
 */
function emitterRows(
  sel: JudgeBoard['emitterSelection'] | undefined,
  emitters: JudgeBoard['arena']['emitters'] | undefined
): EmitterRow[] | null {
  if (sel) {
    return (['A', 'B'] as const).map((t) => ({
      team: t,
      // 逐层可选：这份载荷来自网络，缺字段时退化为「未知」，不抛异常也不猜
      selected: sel[t]?.selected?.id ?? null,
      locked: sel[t]?.locked ?? null,
    }));
  }
  if (emitters) {
    return (['A', 'B'] as const).map((t) => ({ team: t, selected: emitters[t].id, locked: true }));
  }
  return null;
}

// ============================================================================
// 队卡 —— 「跑的是谁、就绪没、锚点锁没锁、算得怎样」
// ============================================================================

function TeamCard({
  side,
  slot,
  pkg,
  lock,
  compute,
}: {
  side: WireTeam;
  slot: SlotView;
  pkg: { hash: string; name: string } | null;
  lock: { locked: boolean; selected: { id: string } | null } | null;
  compute: ComputeCell;
}): JSX.Element {
  const { t, locale } = useI18n();
  const ready = slot.status === 'READY';
  // 密封副本是**本场真正在跑的那份**：有它就以它为准，没有才看槽位
  const name = pkg?.name ?? slot.name;
  const hash = pkg?.hash ?? slot.hash;
  const sourceTone: Status = ready ? 'ready' : slot.status === 'INVALID' ? 'error' : 'neutral';

  return (
    <div
      className="teamcard"
      data-team={side}
      data-testid={`judge-team-${side}`}
      data-slot-status={slot.status}
      data-preflight={preflightState(slot.preflightOk)}
    >
      <div className="teamcard__head">
        <TeamLabel team={side} />
        <span className="teamcard__name" title={t('judge.teamCard.nameTitle')}>
          {name ?? t('judge.teamCard.unnamed')}
        </span>
        <StatusBadge status={ready ? 'ready' : 'neutral'}>
          {ready ? t('judge.teamCard.ready') : t('judge.teamCard.notReady')}
        </StatusBadge>
      </div>
      <dl className="teamcard__stats">
        <div>
          <dt>{pkg ? t('judge.teamCard.hashSealed') : t('judge.teamCard.hashSlot')}</dt>
          <dd className="num">{hash ? shortHash(hash) : '—'}</dd>
        </div>
        <div>
          <dt>{t('judge.teamCard.source')}</dt>
          <dd>
            <StatusBadge status={sourceTone}>{slotStatusLabel(locale, slot.status)}</StatusBadge>
            {slot.installed ? (
              <span className="dim">
                {slot.origin === 'installed'
                  ? t('judge.teamCard.originInstalled')
                  : t('judge.teamCard.originUnrecorded')}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          {/* Preflight 是产品术语，两种语言都原样 */}
          <dt>Preflight</dt>
          <dd>
            <PreflightBadge ok={slot.preflightOk} />
          </dd>
        </div>
        <div>
          <dt>Emitter</dt>
          <dd>
            {/* 演练读这一格的全文（READY 与终局必须一字不差），所以不带字形 */}
            <StatusBadge
              status={lock?.locked ? 'ready' : 'waiting'}
              testId={`judge-team-${side}-emitter`}
            >
              {lock?.locked
                ? t('judge.teamCard.emitterLocked', {
                    id: lock.selected?.id ?? t('judge.teamCard.emitterLockedNoId'),
                  })
                : t('judge.teamCard.emitterUnlocked')}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>{t('judge.teamCard.compute')}</dt>
          <dd>
            <StatusBadge status={COMPUTE_TONE[compute.state]}>{t(COMPUTE_KEY[compute.state])}</StatusBadge>
            {compute.timeMs !== null ? (
              <span className="num dim">{(compute.timeMs / 1000).toFixed(3)}s</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ============================================================================
// 危险动作的两步确认
// ============================================================================

function DangerConfirm({
  impact,
  label,
  busy,
  actionKey,
  testId,
  onConfirm,
  onCancel,
}: {
  impact: string;
  label: string;
  busy: boolean;
  /** 服务端动作 key（给 `data-action="<key>-confirm"`）；目录安装没有，则不带 */
  actionKey?: string;
  testId: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <ErrorNotice
      scope="judge"
      severity="warning"
      title={t('judge.danger.title')}
      body={impact}
      testId={testId}
      className="confirm"
    >
      <div className="confirm__actions">
        <button
          type="button"
          className="btn btn--danger"
          data-action={actionKey ? `${actionKey}-confirm` : undefined}
          data-testid={`${testId}-go`}
          disabled={busy}
          onClick={onConfirm}
        >
          {t('judge.danger.confirm', { label })}
        </button>
        {/*
          焦点接到**取消**上，不是执行上：第一下已经是刻意的，第二下必须再瞄准一次 ——
          否则「点一下 + 顺手回车」两键就换场、作废双方的 Emitter 锁定。键盘用户仍不必找按钮：
          焦点就在这一块里，Tab 一次到执行。
        */}
        <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onCancel} autoFocus>
          {t('judge.danger.cancel')}
        </button>
      </div>
    </ErrorNotice>
  );
}

// ============================================================================
// 页面
// ============================================================================

interface ActionFailure {
  /** 失败的动作 key（服务端 key 或 `install-A/B`）—— 决定错误贴在哪一块 */
  key: string;
  label: string;
  errors: string[];
}

export function JudgePage(): JSX.Element {
  const { t, td, locale } = useI18n();
  const { board, access, status, retries } = useBoard<JudgeBoard>('judge');
  const trajectory = useTrajectory(board?.trajectoryHandle ?? null);

  // ---- 本地状态（服务端没有的：正在跑的请求、待确认的危险动作、复制反馈、表单、预览）----
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [busyLocal, setBusyLocal] = useState(false);
  /** 刚刚复制了哪一队的链接（按钮上的反馈） */
  const [copied, setCopied] = useState<WireTeam | null>(null);
  /** 正在等第二次确认的危险动作（`reset` / `install-A` / `install-B`） */
  const [confirming, setConfirming] = useState<string | null>(null);

  // ---- Match Setup（下一场生效）----
  const [seed, setSeed] = useState('');
  const [points, setPoints] = useState('');
  const [difficulty, setDifficulty] = useState('');

  // ---- Advanced：目录路径安装 ----
  const [pathA, setPathA] = useState('');
  const [pathB, setPathB] = useState('');

  // ---- 源码浏览（V1.2 §一：主办方核对选手交上来的到底是什么）----
  // 内容不随 board 推送 —— 点开哪个文件才去取哪个，取到的原文留在本地。
  const [preview, setPreview] = useState<{
    team: WireTeam;
    path: string;
    text: string;
    truncated: boolean;
    binary: boolean;
  } | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);

  /** 「已复制」1.5s 后消失；卸载时清掉计时器，别让它在没了的组件上 setState */
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const matchId = board?.matchId;
  const phase = board?.phase;

  // 换场或阶段推进后，未确认的危险动作作废 —— 它的「影响」说明已经不对了
  useEffect(() => {
    setConfirming(null);
  }, [matchId, phase]);

  // 换场：上一场的动作错误与源码预览都不该粘到新一场上
  useEffect(() => {
    setFailure(null);
    setPreview(null);
    setPreviewErrors([]);
  }, [matchId]);

  const busy = busyLocal || Boolean(board?.busy);

  /**
   * 动作文案：服务端给的是**稳定 key**，语言由客户端决定。
   * 认不出 key（比如服务端先加了新动作）就回退到服务端原文 —— 绝不把 key 本身渲染出去。
   */
  const actionLabel = useCallback((a: ActionView): string => td(a.labelKey, a.labelParams, a.label), [td]);
  const actionHint = useCallback((a: ActionView): string => td(a.hintKey, a.hintParams, a.hint), [td]);

  // ---- 派生对象：只在 board 的对应字段变了才重算（board 每 100ms 一条）----
  const actions = board?.actions;
  const actionsByKey = useMemo(() => new Map((actions ?? []).map((a) => [a.key, a])), [actions]);
  const step = phase ? STEPS[phase] : null;
  // 向导：阶段只决定「显示哪一步」；主按钮在候选之间只按服务端的 enabled 挑
  const primary = useMemo(
    () => (step && actions && !step.waiting ? pickPrimary(actions, step) : null),
    [step, actions]
  );
  // 主按钮已经占了那个 key，Advanced 里就不再重复（同 key 两个按钮会撞选择器）
  const advancedActions = useMemo(
    () => (actions ?? []).filter((a) => a.key !== primary?.key),
    [actions, primary]
  );
  const emitterSel = board?.emitterSelection;
  const arenaEmitters = board?.arena.emitters;
  const emitterStatus = useMemo(() => emitterRows(emitterSel, arenaEmitters), [emitterSel, arenaEmitters]);
  const auditRecent = board?.audit.recent;
  const recentAudit = useMemo(() => (auditRecent ? [...auditRecent].reverse() : []), [auditRecent]);
  const lastRound = board?.lastRound ?? null;
  const killed = useMemo(() => lastRound?.killed ?? NO_KILLED, [lastRound]);
  // 服务端给键、这里取译文；认不出键时回退到它给的原文
  const roundErrors = useMemo(
    () =>
      lastRound && lastRound.errors.length
        ? localizeRoundErrors(locale, lastRound.errors, lastRound.errorKeys, lastRound.errorParams)
        : [],
    [lastRound, locale]
  );
  const stageAt = phase ? stageIndexOf(phase) : -1;

  /** 统一的命令入口：本地防连点 → 发命令 → 把服务端的原话贴到动作旁边 */
  const run = useCallback(
    async (key: string, label: string, path: string, body: Record<string, unknown>): Promise<void> => {
      setBusyLocal(true);
      const r = await command(path, body);
      setBusyLocal(false);
      setFailure(r.ok ? null : { key, label, errors: r.errors });
    },
    []
  );

  /** Match Setup 只在开新场时生效 —— 让「设置」和「它什么时候起作用」绑在一起 */
  const settingsBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (seed.trim() !== '') body.seed = Number(seed);
    if (points.trim() !== '') body.pointCount = Number(points);
    if (difficulty !== '') body.difficulty = difficulty;
    return body;
  }, [seed, points, difficulty]);

  /** 真正执行一个服务端动作（危险动作已经过了确认那一步） */
  const execute = useCallback(
    (key: string): Promise<void> => {
      const a = actionsByKey.get(key);
      const label = a ? actionLabel(a) : key;
      const path = ACTION_PATHS[key];
      if (!path) {
        // 服务端多了一个动作而界面还没接：说清楚，不静默吞掉
        setFailure({ key, label, errors: [t('judge.lastRound.notConnected', { key })] });
        return Promise.resolve();
      }
      const body = actionBody(key);
      if (key === 'reset') Object.assign(body, settingsBody());
      setConfirming(null);
      return run(key, label, path, body);
    },
    [actionsByKey, actionLabel, run, settingsBody, t]
  );

  /** 点一个动作：危险动作先亮出影响、等第二次确认；其余直接执行 */
  const runAction = useCallback(
    (key: string): void => {
      if (DANGER_ACTIONS.has(key)) {
        setConfirming(key);
        return;
      }
      void execute(key);
    },
    [execute]
  );

  /**
   * 主按钮的 onClick 要是**稳定引用**：PrimaryAction 的快捷键 effect 以它为依赖，
   * 内联 lambda 会让 window 上的 keydown 监听随每条 board（约 10 次/秒）拆了重挂。
   * 只在主动作的 key 变了才换一个函数。
   */
  const primaryKey = primary?.key ?? null;
  const onPrimary = useCallback((): void => {
    if (primaryKey) runAction(primaryKey);
  }, [primaryKey, runAction]);

  const confirmInstall = useCallback(
    (team: WireTeam, sourceDir: string): void => {
      setConfirming(null);
      void run(installKey(team), t('judge.adv.install', { team }), COMMAND_PATHS.install, {
        team,
        sourceDir,
      });
    },
    [run, t]
  );

  const copyLink = useCallback((team: WireTeam, url: string): void => {
    setCopied(team);
    // 剪贴板可能被浏览器策略拒绝（非安全上下文 / 无权限）—— 拒绝不影响链接本身已经
    // 显示在页面上、可以手工选中复制，所以这里只是尽力而为，不把它变成一条错误。
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  }, []);

  /** 点开某个队的某个源文件 —— 只读，服务端做路径校验 */
  const openSource = useCallback(
    async (team: WireTeam, relPath: string): Promise<void> => {
      setPreviewErrors([]);
      const r = await fetchJudgeSource(team, relPath);
      if (!r.ok) {
        setPreviewErrors(r.errors.length ? r.errors : [t('team.err.readFailed')]);
        setPreview(null);
        return;
      }
      setPreview({
        team,
        path: relPath,
        text: r.text ?? '',
        truncated: Boolean(r.truncated),
        binary: Boolean(r.binary),
      });
    },
    [t]
  );

  const connection = <ConnectionTag status={status} retries={retries} />;

  if (!board || !step) {
    return (
      <AppShell role="judge" eyebrow={t('judge.title')} connection={connection}>
        <div className="gate" data-testid="judge" data-board="pending">
          {/* 令牌问题要在这一屏就说清楚：没带令牌打开裁判台的人不该对着「正在连接」永远转圈 */}
          <AccessNotice access={access} testId="judge-access" />
          {access === 'ok' ? <p className="empty">{t(pendingBodyKey(status))}</p> : null}
        </div>
      </AppShell>
    );
  }

  const phaseLabel = t(PHASE_KEYS[board.phase]);
  const replayHref = `/replay/${encodeURIComponent(board.matchId)}`;
  const showEmitters = board.phase === 'EMITTER_SELECT' || board.phase === 'READY';
  const primaryHint = primary ? actionHint(primary) : '';
  // 失败贴在它发生的那一块：主按钮旁，或 Advanced 里
  const failureInAdvanced =
    failure !== null &&
    (failure.key.startsWith('install-') || advancedActions.some((a) => a.key === failure.key));

  const failureNotice = (testId: string): ReactNode =>
    failure ? (
      <ErrorNotice
        scope="judge"
        title={t('judge.action.failed', { action: failure.label })}
        body={[...failure.errors, t('judge.action.next')]}
        testId={testId}
      />
    ) : null;

  const resetConfirm = (
    <DangerConfirm
      impact={t('judge.danger.resetImpact')}
      label={actionsByKey.has('reset') ? actionLabel(actionsByKey.get('reset')!) : 'reset'}
      busy={busy}
      actionKey="reset"
      testId="judge-confirm-reset"
      onConfirm={() => void execute('reset')}
      onCancel={() => setConfirming(null)}
    />
  );

  return (
    <AppShell
      role="judge"
      eyebrow={t('judge.title')}
      meta={
        <>
          <span className="num muted" data-testid="match-id">MATCH {board.matchId}</span>
          <span className="num">
            {t('judge.header.round')} <strong>{pad2(board.round)}</strong>
          </span>
          {/* E2E 依赖：这里必须是引擎的**原始阶段名** */}
          <span className="eyebrow" data-testid="phase">{board.phase}</span>
        </>
      }
      right={
        <a className="link" href={replayHref}>
          {t('nav.replay')}
        </a>
      }
      connection={connection}
    >
      <div className="judge" data-testid="judge" data-board="ready" data-phase={board.phase}>
        {/*
          ---- Team A | Team B ----
          常驻整宽的记分牌：「跑的是谁、就绪没、Preflight 过没、锚点锁没锁、算得怎样」。
          这些是开赛前必须确认、比赛中要盯着的东西，不能埋在侧栏里等人滚动。
          所有字段都是服务端投影的直通拷贝，页面不推断任何状态。
        */}
        <div className="judge__teams" data-testid="judge-teams">
          {(['A', 'B'] as const).map((side) => (
            <TeamCard
              key={side}
              side={side}
              slot={board.slots[side]}
              pkg={board.packages[side]}
              lock={emitterSel?.[side] ?? null}
              compute={board.computes[side]}
            />
          ))}
        </div>

        <aside className="judge__side">
          <AccessNotice access={access} testId="judge-access" />

          {/* ---- 比赛状态 ---- */}
          <section className="panel" data-testid="match-status" data-phase={board.phase}>
            <SectionHeader
              title={t('judge.section.matchStatus')}
              meta={<span data-testid="phase-label">{phaseLabel}</span>}
            />
            {/* 步骤条：只反映「现在走到主流程的哪一格」；三态各有字形与颜色，并带 data-state */}
            <ol className="wizard-steps" data-testid="wizard-steps">
              {STAGE_ORDER.map((s, i) => {
                const state = i < stageAt ? 'done' : i === stageAt ? 'now' : 'todo';
                return (
                  <li key={s} data-stage={s} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                    <span className="wizard-steps__no" aria-hidden="true">
                      {state === 'done' ? '✓' : state === 'now' ? '▸' : i + 1}
                    </span>
                    {t(WIZARD_STAGE_KEYS[s])}
                  </li>
                );
              })}
            </ol>
            <div className="statgrid">
              <StatusLine label={t('judge.header.round')} value={pad2(board.round)} />
              <StatusLine label={t('judge.lastRound.alive')} value={`A ${board.alive.A} / B ${board.alive.B}`} />
              <StatusLine label={t('judge.header.seed')} value={board.settings.seed} />
              <StatusLine
                label={t('judge.status.map')}
                // 难度是协议枚举（`easy/medium/hard`）—— 值留在 data-difficulty 里，只翻给人看的那个词
                value={
                  <span data-difficulty={board.settings.difficulty}>
                    {t('judge.slot.settings', {
                      points: board.settings.pointCount,
                      difficulty: difficultyLabel(locale, board.settings.difficulty),
                    })}
                  </span>
                }
              />
            </div>
            {/* 后台任务（连续跑完余下回合）失败会把比赛**停在原地**。
                单独一个 testid：演练必须能精确断言「没有留下它」。 */}
            {board.lastError ? (
              <ErrorNotice
                scope="judge"
                title={t('judge.lastError.title')}
                body={[board.lastError, t('judge.lastError.retryHint')]}
                testId="judge-last-error"
              />
            ) : null}
          </section>

          {/* ---- 主动作（向导）---- */}
          <section className="panel" data-testid="wizard" data-phase={board.phase}>
            <SectionHeader title={t('judge.wizard.title')} meta={t(WIZARD_STAGE_KEYS[step.stage])} />
            <p className="panel__lead" data-testid="wizard-what">
              {t(step.whatKey)}
            </p>

            {/*
              终局：主位置是「打开回放」（向导表 `primaryLink`）。服务端此时给的唯一动作是
              「换场」—— 危险动作，退到 Advanced 并保持两步确认；这里不再摆它，也不给它快捷键。
            */}
            {step.primaryLink === 'replay' ? (
              <a
                className="btn btn--primary judge__replay"
                href={replayHref}
                data-testid="judge-open-replay"
                data-primary="link"
              >
                {t('nav.replay')} →
              </a>
            ) : null}

            {primary ? (
              <PrimaryAction
                actionKey={primary.key}
                label={actionLabel(primary)}
                // 服务端给的 hint —— 不可点时它就是「为什么不能点」的答案
                hint={primaryHint}
                enabled={primary.enabled}
                busy={busy}
                why={
                  busy
                    ? t('judge.wizard.busy')
                    : primary.enabled
                      ? t('judge.wizard.whyEnabled', { hint: primaryHint })
                      : t('judge.wizard.whyDisabled', { hint: primaryHint })
                }
                onClick={onPrimary}
                // 危险动作永远不接快捷键：⌘/Ctrl+Enter 只用于主流程的正向推进
                shortcut={!DANGER_ACTIONS.has(primary.key)}
              />
            ) : step.primaryLink ? null : (
              <p className="primary__why num dim" data-testid="primary-why">
                {busy ? t('judge.wizard.busyShort') : t('judge.wizard.waitingBody')}
              </p>
            )}
            {confirming === 'reset' && primary?.key === 'reset' ? resetConfirm : null}
            {!failureInAdvanced ? failureNotice('judge-action-error') : null}

            {/* EMITTER LOCK：裁判板是权威视角，双方的选择与锁定状态都看得到 */}
            {showEmitters ? (
              <div className="subpanel" data-testid="emitter-status">
                <SectionHeader
                  title={t('judge.emitter.title')}
                  meta={emitterSel?.revealed ? t('judge.emitter.revealed') : t('judge.emitter.hidden')}
                />
                {emitterStatus ? (
                  emitterStatus.map((r) => (
                    <div key={r.team} className="subpanel__row">
                      <TeamLabel team={r.team} />
                      <span className="num" data-testid={`emitter-${r.team}`}>
                        {r.selected ?? t('judge.emitter.none')}
                      </span>
                      {/* 演练比对这一格的全文 —— 只放文字，不放字形 */}
                      <StatusBadge
                        status={r.locked === null ? 'neutral' : r.locked ? 'ready' : 'waiting'}
                        testId={`emitter-${r.team}-lock`}
                      >
                        {r.locked === null
                          ? t('judge.emitter.unknown')
                          : r.locked
                            ? t('judge.emitter.locked')
                            : t('judge.emitter.unlocked')}
                      </StatusBadge>
                    </div>
                  ))
                ) : (
                  <p className="panel__lead">{t('judge.emitter.notSent')}</p>
                )}
              </div>
            ) : null}
          </section>

          {/*
            ---- 参赛者入口（V1.2 Final RC Audit 的 P1 修复）----

            队伍面的**唯一**入口。每队令牌由服务端按**当前场次**派生，所以换一场
            这两条链接就更新 —— 旧链接立即失效，这是刻意的（上一场的人不该继续持有）。

            `key` 绑 matchId：换场时组件重建，避免任何残留的「已复制」状态让人误以为
            复制到的是新链接。
          */}
          <section className="panel" data-testid="team-links" key={board.matchId}>
            <SectionHeader title={t('judge.links.title')} meta={t('judge.links.subtitle')} />
            <p className="panel__lead">{t('judge.links.desc')}</p>
            {(['A', 'B'] as const).map((side) => {
              const url = `${location.origin}/team/${side.toLowerCase()}#t=${board.teamTokens[side]}`;
              return (
                <div key={side} className="linkrow">
                  <TeamLabel team={side} />
                  <code className="num linkrow__url" data-testid={`team-link-${side}`} title={url}>
                    {url}
                  </code>
                  <button
                    type="button"
                    className="btn"
                    data-testid={`team-link-${side}-copy`}
                    onClick={() => copyLink(side, url)}
                  >
                    {copied === side ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
              );
            })}
          </section>

          {/* ---- Advanced：其余动作 · 目录路径安装 · 下一场的设置 ---- */}
          <details className="adv">
            <summary>{t('judge.adv.summary')}</summary>
            <div className="adv__body">
              <p className="panel__lead">{t('judge.adv.desc')}</p>
              {failureInAdvanced ? failureNotice('judge-adv-error') : null}
              <div className="actions">
                {advancedActions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className="act"
                    data-action={a.key}
                    disabled={!a.enabled || busy}
                    title={actionHint(a)}
                    onClick={() => runAction(a.key)}
                  >
                    <span className="act__key">{a.key.replace(/^use-slot-/, 'slot-').slice(0, 8)}</span>
                    <span className="act__body">
                      <span className="act__label">{actionLabel(a)}</span>
                      <span className="act__hint">{actionHint(a)}</span>
                    </span>
                  </button>
                ))}
              </div>
              {confirming === 'reset' && primary?.key !== 'reset' ? resetConfirm : null}

              <hr className="adv__rule" />
              <p className="panel__lead">{t('judge.adv.installDesc')}</p>
              {(['A', 'B'] as const).map((side) => {
                const value = side === 'A' ? pathA : pathB;
                const setValue = side === 'A' ? setPathA : setPathB;
                const label = t('judge.adv.install', { team: side });
                return (
                  <div key={side} className="adv__install">
                    <label className="field">
                      <span>{t('judge.adv.teamDir', { team: side })}</span>
                      <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={t('judge.adv.pathPlaceholder')}
                        spellCheck={false}
                        data-testid={`judge-install-path-${side}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`judge-install-${side}`}
                      disabled={busy || value.trim() === ''}
                      // 灰掉的原因可见（不只在 title 里）：下面那行 `judge-install-why-*` 说的就是它
                      title={value.trim() === '' ? t('judge.adv.installWhy') : busy ? t('judge.wizard.busyShort') : undefined}
                      aria-describedby={`judge-install-why-${side}`}
                      onClick={() => setConfirming(installKey(side))}
                    >
                      {label}
                    </button>
                    <p id={`judge-install-why-${side}`} className="dim adv__why" data-testid={`judge-install-why-${side}`}>
                      {busy ? t('judge.wizard.busyShort') : value.trim() === '' ? t('judge.adv.installWhy') : t('judge.adv.installReady')}
                    </p>
                    {confirming === installKey(side) ? (
                      <DangerConfirm
                        impact={t('judge.danger.installImpact', { team: side })}
                        label={label}
                        busy={busy}
                        testId={`judge-confirm-install-${side}`}
                        onConfirm={() => confirmInstall(side, value.trim())}
                        onCancel={() => setConfirming(null)}
                      />
                    ) : null}
                  </div>
                );
              })}

              <hr className="adv__rule" />
              <p className="panel__lead">{t('judge.adv.settingsDesc')}</p>
              <label className="field">
                <span>{t('judge.adv.seed')}</span>
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder={String(board.settings.seed)}
                  inputMode="numeric"
                />
              </label>
              <label className="field">
                <span>{t('judge.adv.points')}</span>
                <input
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder={String(board.settings.pointCount)}
                  inputMode="numeric"
                />
              </label>
              <label className="field">
                <span>{t('judge.adv.difficulty')}</span>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  {/* `value` 是**协议枚举**（提交给服务端的机器值），必须原样；只有给人看的那个词跟着语言走 */}
                  <option value="">
                    {t('judge.adv.keepDifficulty', {
                      value: difficultyLabel(locale, board.settings.difficulty),
                    })}
                  </option>
                  <option value="easy">{t('difficulty.easy')}</option>
                  <option value="medium">{t('difficulty.medium')}</option>
                  <option value="hard">{t('difficulty.hard')}</option>
                </select>
              </label>
            </div>
          </details>

          {/* ---- 审计 · 源码核对 ---- */}
          <section className="panel" data-testid="judge-audit">
            <SectionHeader title={t('judge.section.audit')} meta={t('judge.audit.events', { n: board.audit.events })} />
            {(['A', 'B'] as const).map((side) => {
              const s = board.slots[side];
              return (
                <div className="review" key={side} data-team={side}>
                  <div className="review__head">
                    <TeamLabel team={side}>
                      {/* 算法名是防「静默跑错算法」最直接的信号：投的是谁，板上就写谁 */}
                      {s.name ? <b className="review__name">{s.name}</b> : null}
                    </TeamLabel>
                    <span className="num dim">
                      {s.hash ? shortHash(s.hash) : '—'} · {t('judge.audit.files', { n: s.files, bytes: s.totalBytes })}
                    </span>
                  </div>
                  {/*
                    包内文件清单 + 只读浏览（V1.2 §一）。
                    哈希对不了人眼，源码可以 —— 这是「投的是不是选手那份」最直接的核对手段。
                    内容按需取，不随 board 推送。
                  */}
                  {s.fileList.length > 0 ? (
                    <ul className="audit-list" data-testid={`judge-files-${side}`}>
                      {s.fileList.map((f) => (
                        <li key={f.path}>
                          <span className="num dim">{f.bytes}</span>
                          <button
                            type="button"
                            className="link"
                            data-testid={`judge-file-${side}`}
                            data-path={f.path}
                            onClick={() => void openSource(side, f.path)}
                          >
                            {f.path}
                          </button>
                          <span />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dim review__empty">{s.errors[0] ?? t('judge.slot.empty')}</p>
                  )}
                </div>
              );
            })}

            {previewErrors.length > 0 ? (
              <ErrorNotice
                scope="package"
                title={previewErrors[0]}
                body={previewErrors.length > 1 ? previewErrors.slice(1) : undefined}
                testId="judge-source-error"
              />
            ) : null}

            {preview ? (
              <div data-testid="judge-source" className="review__source">
                <SectionHeader
                  title={
                    <>
                      <span className={`team-dot team-dot--${preview.team.toLowerCase()}`} aria-hidden="true" />{' '}
                      {preview.path}
                    </>
                  }
                  meta={t('common.readonly')}
                />
                {preview.binary ? (
                  <p className="muted" data-testid="judge-source-binary">
                    {t('team.source.binary')}
                  </p>
                ) : (
                  <>
                    <pre className="source-view" data-testid="judge-source-text">
                      {preview.text}
                    </pre>
                    {preview.truncated ? (
                      <p className="muted" data-testid="judge-source-truncated">
                        {t('team.source.truncated')}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            <div className="review__runtime" data-runtime-ok={board.runtime.ok ? 'true' : 'false'}>
              <StatusLine
                label={t('judge.audit.runtime')}
                value={
                  <StatusBadge status={board.runtime.ok ? 'ready' : 'error'}>
                    {board.runtime.ok ? t('judge.audit.runtimeOk') : t('judge.audit.runtimeMismatch')}
                  </StatusBadge>
                }
              />
            </div>
            <p className="eyebrow review__recent">{t('judge.audit.recent')}</p>
            <ul className="audit-list" data-testid="judge-audit-recent">
              {recentAudit.map((e) => (
                <li key={e.seq}>
                  <span className="dim">#{e.seq}</span>
                  {/* 审计事件类型是机器标识，原样 */}
                  <span>{e.type}</span>
                  <span className="dim">{e.team ?? ''}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* ---- 竞技场（主角）+ 本轮结果 ---- */}
        <main className="judge__main">
          <div className="stage-head">
            <span className="eyebrow">{t('arena.label')}</span>
            <span className="num dim">
              {lastRound
                ? t('judge.lastRound.headline', {
                    round: lastRound.round,
                    first: firstSolverLabel(locale, lastRound.firstSolver),
                  })
                : phaseLabel}
            </span>
          </div>
          <div className="stage-wrap">
            <ArenaCanvas arena={board.arena} trajectory={trajectory} killed={killed} />
          </div>

          <footer className="judge__foot">
            <div className="lastround">
              <ComputeStatus computes={board.computes} budgetMs={board.computeBudgetMs} />
              <StatusLine
                label={t('judge.lastRound.attacks')}
                value={lastRound?.attacksExecuted.length ? lastRound.attacksExecuted.join(' → ') : '—'}
              />
              <StatusLine
                label={t('judge.lastRound.kills')}
                value={lastRound?.killed.length ? lastRound.killed.join(',') : t('common.none')}
              />
              {board.verdict ? (
                <span
                  className="lastround__verdict"
                  data-testid="verdict"
                  data-winner={board.verdict.winner}
                  data-end-reason={board.verdict.endReason}
                >
                  <StatusLine
                    label={t('judge.lastRound.verdict')}
                    value={
                      <StatusBadge status="terminal">
                        {winnerLabel(locale, board.verdict.winner)} · {endReasonLabel(locale, board.verdict.endReason)}
                      </StatusBadge>
                    }
                  />
                </span>
              ) : null}
            </div>
            {/* 本轮算法异常（TIMEOUT / CRASH / INVALID）：是结算结果的一部分，不是界面故障 —— 用 warning 层级 */}
            {roundErrors.length > 0 ? (
              <ErrorNotice
                scope="round"
                severity="warning"
                title={t('judge.round.errorsTitle')}
                body={roundErrors}
                testId="judge-round-errors"
                className="judge__foot-notice"
              />
            ) : null}
          </footer>
        </main>
      </div>
    </AppShell>
  );
}
