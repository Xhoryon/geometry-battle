/**
 * 裁判台 —— phase-driven wizard（V1.2 §三）。
 *
 * 三条硬规矩：
 *
 *   1. **可用性只来自服务端。** 每个按钮的 `disabled` 只能由服务端下发的
 *      `action.enabled` 决定（再与 `busy` 求与 —— 这是唯一允许的前端注入）。
 *      本文件里**没有** `phase === 'READY'` 这类影子规则：阶段名只用来决定
 *      **展示哪一步**，绝不用来决定「能不能点」。V1.1 的裁判台正是拿阶段名
 *      去猜可用性，结果校验通过了反而开不了赛。
 *   2. **一个阶段只突出一个合法主动作。** 主按钮从 `board.actions` 里挑
 *      （见 `STEPS`），其余动作全部收进 Advanced Controls。同一个动作 key
 *      在页面上**只会出现一次**：做了主按钮就不再出现在 Advanced 里，
 *      否则选择器会撞到两个同名按钮。
 *   3. **正式主流程是「使用槽位算法」**（零输入：选手已经把算法投进槽位）。
 *      目录路径安装收在 Advanced，是临时换算法的备用手段。
 *
 * 命令执行失败不弹窗、不吞掉：错误原文贴在向导上方，且是引擎说的人话。
 */

import { useState } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { ComputeStatus } from '../components/ComputeStatus';
import { AccessNotice } from '../components/AccessNotice';
import { command, fetchJudgeSource, useBoard, useTrajectory } from '../api/client';
import { LanguageSwitch } from '../components/LanguageSwitch';
import {
  PHASE_KEYS,
  WIZARD_STAGES,
  WIZARD_STAGE_KEYS,
  difficultyLabel,
  localizeRoundErrors,
} from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey, WizardStage } from '../i18n/translations';
import { COMMAND_PATHS } from '../../../src/server/protocol';
import type { ActionView, JudgeBoard, WirePhase } from '../../../src/server/protocol';
import type { JSX } from 'react';

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

// ============================================================================
// 向导的「展示」模型 —— 只与阶段名有关，与可用性无关
// ============================================================================

/**
 * 主流程的步骤条（与任务书的 SETUP → … → MATCH END 一一对应）。
 *
 * 这些格子的**标识符**是机器标识，不随语言变；显示文案由
 * `WIZARD_STAGE_KEYS` 按当前语言取（见下方渲染处）。
 */
const STAGES: readonly WizardStage[] = WIZARD_STAGES;

interface WizardStep {
  /** 步骤条里高亮哪一格 */
  stage: WizardStage;
  /** 这一步在做什么（静态说明 —— 不是可用性判据）。存**键**，渲染时再取文案 */
  whatKey: TranslationKey;
  /**
   * 本步的**候选主动作**（按优先级）。
   *
   * 这张表只回答「这一步该做哪件事」；「能不能做」永远只读服务端的
   * `action.enabled`。首选动作若被服务端判为不可用，就顺延到本步下一个
   * **服务端说可用**的动作（例：READY 下 `reveal` 与 `run-to-end` 的分工）。
   * 一个候选都不可用时，仍然展示首选动作并把它**不可点的原因**（服务端 hint）亮出来。
   */
  candidates: readonly string[];
  /** 这一步由选手完成、裁判没有动作（EMITTER_SELECT）—— 不摆主按钮，只报状态 */
  waiting?: boolean;
}

const STEPS: Record<WirePhase, WizardStep> = {
  SETUP: {
    stage: 'SETUP',
    whatKey: 'judge.step.SETUP',
    // `prepare` 排在前面：它一次做完封装双方 → Preflight → 建赛。
    // 只有在它不可用（例如另一边还没就绪）时，才顺延到单队的「使用槽位算法」。
    // 反过来排会把 `prepare` 挤进 Advanced 折叠区 —— 那正好是本步的主按钮。
    candidates: ['prepare', 'use-slot-a'],
  },
  UPLOAD_A: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.UPLOAD_A',
    candidates: ['prepare', 'use-slot-b'],
  },
  UPLOAD_B: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.UPLOAD_B',
    candidates: ['prepare', 'preflight', 'start'],
  },
  PREFLIGHT: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.PREFLIGHT',
    candidates: ['prepare', 'start'],
  },
  EMITTER_SELECT: {
    stage: 'EMITTER LOCK',
    whatKey: 'judge.step.EMITTER_SELECT',
    candidates: [],
    waiting: true,
  },
  READY: {
    stage: 'READY',
    whatKey: 'judge.step.READY',
    candidates: ['reveal', 'run-to-end'],
  },
  PUBLIC: {
    stage: 'START MATCH',
    whatKey: 'judge.step.PUBLIC',
    candidates: ['reveal', 'start-round', 'run-to-end'],
  },
  REVEAL: {
    stage: 'START MATCH',
    whatKey: 'judge.step.REVEAL',
    candidates: ['start-round', 'reveal', 'run-to-end'],
  },
  COUNTDOWN: {
    stage: 'ROUND',
    whatKey: 'judge.step.COUNTDOWN',
    candidates: ['compute'],
  },
  COMPUTING: {
    stage: 'ROUND',
    whatKey: 'judge.step.COMPUTING',
    candidates: ['compute'],
  },
  ROUND_RESULT: {
    stage: 'ROUND',
    whatKey: 'judge.step.ROUND_RESULT',
    candidates: ['reveal', 'run-to-end'],
  },
  MATCH_END: {
    stage: 'MATCH END',
    whatKey: 'judge.step.MATCH_END',
    candidates: ['reset'],
  },
};

/**
 * 从服务端的动作清单里挑出本步的主按钮。
 *
 * **只用 `enabled` 做「本步候选之间」的选择，不用它之外的东西判断可用性。**
 * 一个候选都没启用时返回首选候选（按钮仍然是 disabled，原因由它的 hint 给出）。
 */
function pickPrimary(actions: ActionView[], step: WizardStep): ActionView | null {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  for (const key of step.candidates) {
    const a = byKey.get(key);
    if (a?.enabled) return a;
  }
  const first = step.candidates[0];
  return first ? byKey.get(first) ?? null : null;
}

// ============================================================================
// Emitter 状态（裁判是权威视角）
// ============================================================================

interface EmitterSideView {
  locked: boolean;
  selected: { id: string } | null;
}

interface EmitterSelectionView {
  A: EmitterSideView;
  B: EmitterSideView;
  revealed: boolean;
}

interface EmitterRow {
  team: 'A' | 'B';
  selected: string | null;
  /** null = 服务端没给这一位（未知），不去猜 */
  locked: boolean | null;
}

/**
 * 双方 Emitter 的选择与锁定状态。
 *
 * 读的是服务端下发的 `board.emitterSelection`（引擎快照的直通投影）——
 * 页面不推断「谁选了没有」，也不拿阶段名反推锁定状态。协议里暂时没有这个
 * 字段时退化为「未公开」，一个字都不猜。
 */
function emitterSelectionOf(board: JudgeBoard): EmitterSelectionView | null {
  const v = (board as JudgeBoard & { emitterSelection?: EmitterSelectionView | null }).emitterSelection;
  return v ?? null;
}

function emitterRows(board: JudgeBoard): EmitterRow[] | null {
  const sel = emitterSelectionOf(board);
  if (sel) {
    return (['A', 'B'] as const).map((t) => ({
      team: t,
      // 逐层可选：这份载荷来自网络，缺字段时退化为「未知」，不抛异常也不猜
      selected: sel[t]?.selected?.id ?? null,
      locked: sel[t]?.locked ?? null,
    }));
  }
  // 服务端还没带 emitterSelection：只使用「双方锁定后公开的锚点」这**一条事实**，
  // 不去推断单方的锁定状态。
  const emitters = board.arena.emitters;
  if (emitters) {
    return (['A', 'B'] as const).map((t) => ({ team: t, selected: emitters[t].id, locked: true }));
  }
  return null;
}

// ============================================================================
// 页面
// ============================================================================

export function JudgePage(): JSX.Element {
  const { t, td, locale } = useI18n();
  const { board, connected, access } = useBoard<JudgeBoard>('judge');
  const trajectory = useTrajectory(board?.trajectoryHandle ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busyLocal, setBusyLocal] = useState(false);
  /** 刚刚复制了哪一队的链接（按钮上的反馈） */
  const [copied, setCopied] = useState<'A' | 'B' | null>(null);

  const copyLink = (team: 'A' | 'B', url: string): void => {
    setCopied(team);
    window.setTimeout(() => setCopied(null), 1500);
    // 剪贴板可能被浏览器策略拒绝（非安全上下文 / 无权限）—— 拒绝不影响链接本身已经
    // 显示在页面上、可以手工选中复制，所以这里只是尽力而为，不把它变成一条错误。
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  };

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
    team: 'A' | 'B';
    path: string;
    text: string;
    truncated: boolean;
    binary: boolean;
  } | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);

  /**
   * 动作文案：服务端给的是**稳定 key**，语言由客户端决定。
   * 认不出 key（比如服务端先加了新动作）就回退到服务端原文 ——
   * 绝不把 key 本身渲染出去。
   */
  const actionLabel = (a: ActionView): string => td(a.labelKey, a.labelParams, a.label);
  const actionHint = (a: ActionView): string => td(a.hintKey, a.hintParams, a.hint);

  if (!board) {
    return (
      <div className="judge">
        <div className="judge__bar">
          <span className="eyebrow">{t('judge.title')}</span>
          <LanguageSwitch />
        </div>
        <div className="empty">{t('common.connecting')}</div>
      </div>
    );
  }

  const busy = busyLocal || board.busy;

  const run = async (path: string, body: Record<string, unknown> = {}): Promise<void> => {
    setBusyLocal(true);
    const r = await command(path, body);
    setBusyLocal(false);
    setErrors(r.ok ? [] : r.errors);
  };

  const runAction = (key: string): Promise<void> => {
    const path = ACTION_PATHS[key];
    if (!path) {
      // 服务端多了一个动作而界面还没接：说清楚，不静默吞掉
      setErrors([t('judge.lastRound.notConnected', { key })]);
      return Promise.resolve();
    }
    const body: Record<string, unknown> = actionBody(key);
    if (key === 'reset') {
      // Match Setup 只在开新场时生效 —— 让「设置」和「它什么时候起作用」绑在一起
      if (seed.trim() !== '') body.seed = Number(seed);
      if (points.trim() !== '') body.pointCount = Number(points);
      if (difficulty !== '') body.difficulty = difficulty;
    }
    return run(path, body);
  };

  /** 点开某个队的某个源文件 —— 只读，服务端做路径校验 */
  const openSource = async (team: 'A' | 'B', relPath: string): Promise<void> => {
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
  };

  // ---- 向导：阶段只决定「显示哪一步」 ----
  const step = STEPS[board.phase];
  const primary = step.waiting ? null : pickPrimary(board.actions, step);
  // 主按钮已经占了那个 key，Advanced 里就不再重复（同 key 两个按钮会撞选择器）
  const advancedActions = board.actions.filter((a) => a.key !== primary?.key);
  const emitterStatus = emitterRows(board);
  const showEmitters = board.phase === 'EMITTER_SELECT' || board.phase === 'READY';
  const phaseLabel = t(PHASE_KEYS[board.phase]);
  const match = board.settings;

  return (
    <div className="judge">
      <header className="judge__bar">
        <span className="eyebrow">{t('judge.title')}</span>
        <span className="num muted" data-testid="match-id">MATCH {board.matchId}</span>
        <span className="num">
          {t('judge.header.round')} <strong>{String(board.round).padStart(2, '0')}</strong>
        </span>
        {/* E2E 依赖：这里必须是引擎的**原始阶段名** */}
        <span className="eyebrow" data-testid="phase">{board.phase}</span>
        <span className="num muted">{t('judge.header.seed')} {match.seed}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <a className="link" href="/spectator" target="_blank" rel="noreferrer">
            {t('nav.openSpectator')}
          </a>
          <a className="link" href={`/replay/${encodeURIComponent(board.matchId)}`}>
            {t('nav.replay')}
          </a>
          <LanguageSwitch />
          <span className={`tag ${connected ? 'tag--live' : 'tag--down'}`}>
            {connected ? t('common.live') : t('common.offline')}
          </span>
        </span>
      </header>

      {/*
        双方状态条 —— 常驻整宽。
        「跑的是谁、就绪没、锚点锁没锁」这三件事此前散在侧栏的「算法槽位」面板里，
        裁判要滚动才看得到。它们恰恰是**开赛前必须确认**的东西，所以提到最上面。
        所有字段都是服务端投影的直通拷贝，页面不推断任何状态。
      */}
      <div className="judge__teams" data-testid="judge-teams">
        {(['A', 'B'] as const).map((side) => {
          const s = board.slots[side];
          const lock = emitterSelectionOf(board)?.[side] ?? null;
          const ready = s.status === 'READY';
          const pre =
            s.preflightOk === null
              ? t('judge.teamCard.preflightNever')
              : s.preflightOk
                ? t('judge.teamCard.preflightOk')
                : t('judge.teamCard.preflightFail');
          return (
            <div className="teamcard" key={side} data-team={side} data-testid={`judge-team-${side}`}>
              <span className={`team-dot team-dot--${side.toLowerCase()}`} />
              <span className="teamcard__name" title={t('judge.teamCard.nameTitle')}>
                {s.name ?? t('judge.teamCard.unnamed')}
              </span>
              <span className={`tag ${ready ? 'tag--live' : 'tag--down'}`} title={pre}>
                {ready ? t('judge.teamCard.ready') : t('judge.teamCard.notReady')}
              </span>
              <span
                className={`tag ${lock?.locked ? 'tag--live' : ''}`}
                data-testid={`judge-team-${side}-emitter`}
              >
                {lock?.locked
                  ? t('judge.teamCard.emitterLocked', {
                      id: lock.selected?.id ?? t('judge.teamCard.emitterLockedNoId'),
                    })
                  : t('judge.teamCard.emitterUnlocked')}
              </span>
              <span className="num dim">
                {board.packages[side]
                  ? t('judge.teamCard.sealed', { hash: board.packages[side]!.hash.slice(0, 10) })
                  : t('judge.teamCard.notSealed')}
              </span>
            </div>
          );
        })}
      </div>

      <aside className="judge__side">
        <AccessNotice access={access} testId="judge-access" />

        {errors.length > 0 ? (
          <ul className="errors" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}

        {board.lastError ? (
          <ul className="errors" role="alert">
            <li>{board.lastError}</li>
          </ul>
        ) : null}

        {/*
          ---- 参赛者入口（V1.2 Final RC Audit 的 P1 修复）----

          队伍面的**唯一**入口。每队令牌由服务端按**当前场次**派生，所以换一场
          这两条链接就更新 —— 旧链接立即失效，这是刻意的（上一场的人不该继续持有）。

          `key` 绑 matchId：换场时组件重建，避免任何残留的「已复制」状态让人误以为
          复制到的是新链接。
        */}
        <section className="panel" data-testid="team-links" key={board.matchId}>
          <div className="panel__title">
            <h2>{t('judge.links.title')}</h2>
            <span className="num dim">{t('judge.links.subtitle')}</span>
          </div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
            {t('judge.links.desc')}
          </p>
          {(['A', 'B'] as const).map((side) => {
            const url = `${location.origin}/team/${side.toLowerCase()}#t=${board.teamTokens[side]}`;
            return (
              <div
                key={side}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
              >
                <span className={`team-dot team-dot--${side.toLowerCase()}`} />
                <span className="slot__name">Team {side}</span>
                <code
                  className="num"
                  data-testid={`team-link-${side}`}
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={url}
                >
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

        {/* ---- 向导 ---- */}
        <section className="panel" data-testid="wizard" data-phase={board.phase}>
          <div className="panel__title">
            <h2>{t('judge.wizard.title')}</h2>
            {/*
              这里只印**引擎的阶段**。步骤条就在紧下面，而且高亮着当前那一格 ——
              再把向导自己的步骤名并排印一遍，`READY` 下就成了「就绪 · 就绪」。
              阶段名与步骤标识符重合时那种重复没有信息量，去掉。
            */}
            <span className="num dim" data-testid="phase-label">
              {phaseLabel}
            </span>
          </div>

          {/* 步骤条：只反映「现在走到主流程的哪一格」 */}
          <ol
            data-testid="wizard-steps"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', margin: '0 0 10px', padding: 0 }}
          >
            {STAGES.map((s, i) => {
              const at = STAGES.indexOf(step.stage);
              const state = i < at ? 'done' : i === at ? 'now' : 'todo';
              return (
                <li
                  key={s}
                  data-stage={s}
                  data-state={state}
                  className="num"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    padding: '2px 6px',
                    border: '1px solid var(--rule)',
                    color: state === 'now' ? 'var(--a)' : 'var(--dim)',
                    borderColor: state === 'now' ? 'color-mix(in oklab, var(--a) 55%, transparent)' : 'var(--rule)',
                  }}
                >
                  {i + 1} {t(WIZARD_STAGE_KEYS[s])}
                </li>
              );
            })}
          </ol>

          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }} data-testid="wizard-what">
            {t(step.whatKey)}
          </p>

          {primary ? (
            <>
              <button
                type="button"
                className="act"
                data-action={primary.key}
                data-testid="primary-action"
                disabled={!primary.enabled || busy}
                title={actionHint(primary)}
                onClick={() => void runAction(primary.key)}
                style={{
                  padding: '12px 13px',
                  borderColor: primary.enabled
                    ? 'color-mix(in oklab, var(--a) 55%, transparent)'
                    : 'var(--rule)',
                }}
              >
                <span className="act__key">{primary.key}</span>
                <span className="act__body">
                  <span className="act__label">{actionLabel(primary)}</span>
                  {/* 服务端给的 hint —— 不可点时它就是「为什么不能点」的答案 */}
                  <span className="act__hint">{actionHint(primary)}</span>
                </span>
              </button>
              <p className="num dim" style={{ margin: '8px 0 0', fontSize: 11 }} data-testid="primary-why">
                {busy
                  ? t('judge.wizard.busy')
                  : primary.enabled
                    ? t('judge.wizard.whyEnabled', { hint: actionHint(primary) })
                    : t('judge.wizard.whyDisabled', { hint: actionHint(primary) })}
              </p>
            </>
          ) : (
            <p className="num dim" style={{ margin: 0, fontSize: 11 }} data-testid="primary-why">
              {busy ? t('judge.wizard.busyShort') : t('judge.wizard.waitingBody')}
            </p>
          )}

          {/* EMITTER LOCK：裁判板是权威视角，双方的选择与锁定状态都看得到 */}
          {showEmitters ? (
            <div
              data-testid="emitter-status"
              style={{ border: '1px solid var(--rule)', padding: '8px 10px', marginTop: 12 }}
            >
              <div className="panel__title" style={{ marginBottom: 6 }}>
                <h2>{t('judge.emitter.title')}</h2>
                <span className="num dim">
                  {emitterSelectionOf(board)?.revealed
                    ? t('judge.emitter.revealed')
                    : t('judge.emitter.hidden')}
                </span>
              </div>
              {emitterStatus ? (
                emitterStatus.map((r) => (
                  <div
                    key={r.team}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}
                  >
                    <span className="slot__name">
                      <span className={`team-dot team-dot--${r.team.toLowerCase()}`} />
                      Team {r.team}
                    </span>
                    <span className="num" data-testid={`emitter-${r.team}`}>
                      {r.selected ?? t('judge.emitter.none')}
                    </span>
                    <span className={`tag ${r.locked ? 'tag--live' : ''}`} data-testid={`emitter-${r.team}-lock`}>
                      {r.locked === null
                        ? t('judge.emitter.unknown')
                        : r.locked
                          ? t('judge.emitter.locked')
                          : t('judge.emitter.unlocked')}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                  {t('judge.emitter.notSent')}
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel__title">
            <h2>{t('judge.slot.title')}</h2>
            <span className="dim num">
              {t('judge.slot.settings', {
                points: board.settings.pointCount,
                // 难度是协议枚举（`easy/medium/hard`）—— 值不变，只翻给人看的那个词
                difficulty: difficultyLabel(locale, board.settings.difficulty),
              })}
            </span>
          </div>
          <div className="slot">
            <span className="slot__detail">
              {t('judge.slot.deliveryPoint')} <code>{board.slotRoot}</code>
            </span>
            {/*
              这里曾有一行「仓库里的 algorithms/ 只是出厂 fixture —— 改它**不会**改变
              比赛用的算法」。两个问题：Markdown 的星号被当成普通文本原样渲染出来，
              而且它是**文档**，不是操作信息 —— 上面那行投递点路径已经把「跑的是哪份」
              说清楚了，这句解释留在 README 里更合适。
            */}
          </div>
          {(['A', 'B'] as const).map((side) => {
            const s = board.slots[side];
            return (
              <div className="slot" key={side}>
                <span className="slot__name">
                  <span className={`team-dot team-dot--${side.toLowerCase()}`} />
                  Team {side}
                  {/* 算法名是防「静默跑错算法」最直接的信号：投的是谁，板上就写谁 */}
                  {s.name ? <b> · {s.name}</b> : null}
                </span>
                <span className={`slot__status ${s.status === 'READY' ? 'slot__status--ready' : 'slot__status--bad'}`}>
                  {s.status}
                </span>
                <span className="slot__detail">
                  {s.status === 'READY'
                    ? t('judge.slot.summary', {
                        files: s.files,
                        bytes: s.totalBytes,
                        state:
                          s.preflightOk === null
                            ? t('judge.teamCard.preflightNever')
                            : s.preflightOk
                              ? '✓'
                              : '✕',
                      })
                    : (s.errors[0] ?? t('judge.slot.empty'))}
                </span>
                <span className="slot__detail">
                  {s.origin === 'installed'
                    ? t('judge.slot.installed', { source: s.source ?? t('common.unknown') })
                    : t('judge.slot.unrecorded')}
                </span>
                <span className="slot__detail">
                  <code>{s.dir}</code>
                </span>
                {s.hash ? (
                  <span className="slot__detail dim">
                    {t('judge.slot.hash', { hash: s.hash.slice(0, 24) })}
                  </span>
                ) : null}
                <span className="slot__detail">
                  {board.packages[side]
                    ? t('judge.slot.sealed', { hash: board.packages[side]!.hash.slice(0, 16) })
                    : '—'}
                </span>

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
                ) : null}
              </div>
            );
          })}

          {previewErrors.length > 0 ? (
            <ul className="errors" role="alert" data-testid="judge-source-error">
              {previewErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          {preview ? (
            <div data-testid="judge-source">
              <div className="panel__title">
                <h2>
                  <span className={`team-dot team-dot--${preview.team.toLowerCase()}`} /> {preview.path}
                </h2>
                <span className="muted">{t('judge.slot.readonly')}</span>
              </div>
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
        </section>

        <details className="adv">
          <summary>{t('judge.adv.summary')}</summary>
          <div className="adv__body">
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              {t('judge.adv.desc')}
            </p>
            <div className="actions">
              {advancedActions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="act"
                  data-action={a.key}
                  disabled={!a.enabled || busy}
                  title={actionHint(a)}
                  onClick={() => void runAction(a.key)}
                >
                  <span className="act__key">{a.key.replace(/^use-slot-/, 'slot-').slice(0, 8)}</span>
                  <span className="act__body">
                    <span className="act__label">{actionLabel(a)}</span>
                    <span className="act__hint">{actionHint(a)}</span>
                  </span>
                </button>
              ))}
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '14px 0 12px' }} />
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              {t('judge.adv.installDesc')}
            </p>
            {(['A', 'B'] as const).map((side) => {
              const value = side === 'A' ? pathA : pathB;
              const setValue = side === 'A' ? setPathA : setPathB;
              return (
                <div key={side}>
                  <label className="field">
                    <span>{t('judge.adv.teamDir', { team: side })}</span>
                    <input
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={t('judge.adv.pathPlaceholder')}
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || value.trim() === ''}
                    style={{ marginBottom: 14 }}
                    onClick={() =>
                      void run(COMMAND_PATHS.install, { team: side, sourceDir: value.trim() })
                    }
                  >
                    {t('judge.adv.install', { team: side })}
                  </button>
                </div>
              );
            })}

            <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '4px 0 12px' }} />
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              {t('judge.adv.settingsDesc')}
            </p>
            <label className="field">
              <span>{t('judge.adv.seed')}</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={String(match.seed)} inputMode="numeric" />
            </label>
            <label className="field">
              <span>{t('judge.adv.points')}</span>
              <input
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder={String(match.pointCount)}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>{t('judge.adv.difficulty')}</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {/*
                  `value` 是**协议枚举**（提交给服务端的机器值），必须原样；
                  只有给人看的那个词跟着语言走。
                */}
                <option value="">
                  {t('judge.adv.keepDifficulty', {
                    value: difficultyLabel(locale, match.difficulty),
                  })}
                </option>
                <option value="easy">{t('difficulty.easy')}</option>
                <option value="medium">{t('difficulty.medium')}</option>
                <option value="hard">{t('difficulty.hard')}</option>
              </select>
            </label>
          </div>
        </details>

        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel__title">
            <h2>{t('judge.audit.title')}</h2>
            <span className="num dim">{t('judge.audit.events', { n: board.audit.events })}</span>
          </div>
          <ul className="audit-list">
            {[...board.audit.recent].reverse().map((e) => (
              <li key={e.seq}>
                <span className="dim">#{e.seq}</span>
                <span>{e.type}</span>
                <span className="dim">{e.team ?? ''}</span>
              </li>
            ))}
          </ul>
          <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
            {board.artifactDir
              ? t('judge.audit.artifacts', { dir: board.artifactDir })
              : t('judge.audit.noArtifacts')}{' '}
            · runtime{' '}
            {board.runtime.ok ? t('judge.audit.runtimeOk') : t('judge.audit.runtimeMismatch')}
          </p>
        </section>
      </aside>

      <main className="judge__main">
        <div className="stage-wrap">
          <ArenaCanvas arena={board.arena} trajectory={trajectory} killed={board.lastRound?.killed ?? []} />
        </div>

        <div className="lastround">
          <ComputeStatus
            computes={board.computes}
            budgetMs={board.computeBudgetMs}
            headline={
              board.lastRound
                ? t('judge.lastRound.headline', {
                    round: board.lastRound.round,
                    team: board.lastRound.firstSolver.toUpperCase(),
                  })
                : undefined
            }
          />
          <span className="lastround__item">
            <span className="lastround__label">{t('judge.lastRound.attacks')}</span>
            <span className="lastround__value">
              {board.lastRound?.attacksExecuted.length ? board.lastRound.attacksExecuted.join(' → ') : '—'}
            </span>
          </span>
          <span className="lastround__item">
            <span className="lastround__label">{t('judge.lastRound.kills')}</span>
            <span className="lastround__value">
              {board.lastRound?.killed.join(',') || t('common.none')}
            </span>
          </span>
          <span className="lastround__item">
            <span className="lastround__label">{t('judge.lastRound.alive')}</span>
            <span className="lastround__value">
              A {board.alive.A} / B {board.alive.B}
            </span>
          </span>
          {board.verdict ? (
            <span className="lastround__item" data-testid="verdict">
              <span className="lastround__label">{t('judge.lastRound.verdict')}</span>
              <span
                className="lastround__value"
                style={{ color: board.verdict.winner === 'draw' ? 'var(--muted)' : board.verdict.winner === 'A' ? 'var(--a)' : 'var(--b)' }}
              >
                {board.verdict.winner === 'draw'
                  ? t('judge.lastRound.draw')
                  : t('judge.lastRound.winner', { team: board.verdict.winner })}{' '}
                · {board.verdict.endReason}
              </span>
            </span>
          ) : null}
          {board.lastRound?.errors.length ? (
            <span className="lastround__item" style={{ color: 'var(--danger)' }}>
              {/* 服务端给键、这里取译文；认不出键时回退到它给的原文 */}
              {localizeRoundErrors(
                locale,
                board.lastRound.errors,
                board.lastRound.errorKeys,
                board.lastRound.errorParams
              ).join('   ')}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}
