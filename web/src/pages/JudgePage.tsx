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

/** 阶段中文名（与观众大屏 / 参赛者页同一套说法；`EMITTER_SELECT` 是 V1.2 新增） */
const PHASE_LABEL: Record<string, string> = {
  SETUP: '等待载入算法',
  UPLOAD_A: '已载入 Team A',
  UPLOAD_B: '已载入 Team B',
  PREFLIGHT: '校验中',
  EMITTER_SELECT: '选择发射锚点',
  READY: '就绪',
  PUBLIC: '本轮已冻结 — 等待揭晓',
  REVEAL: '已揭晓 — 等待 START',
  COUNTDOWN: 'START 已下达',
  COMPUTING: '双方算法计算中',
  ROUND_RESULT: '本轮结算',
  MATCH_END: '比赛结束',
};

/** 主流程的步骤条（与任务书的 SETUP → … → MATCH END 一一对应） */
const STAGES = ['SETUP', 'ALGORITHM READY', 'EMITTER LOCK', 'READY', 'START MATCH', 'ROUND', 'MATCH END'] as const;

interface WizardStep {
  /** 步骤条里高亮哪一格 */
  stage: (typeof STAGES)[number];
  /** 这一步在做什么（静态说明 —— 不是可用性判据） */
  what: string;
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
    what: '把双方的算法密封进本场比赛。选手要先把算法投进运行期槽位（见下方「投递点」）；两边都就绪时，下面这一步一次做完「封装 → 校验 → 建赛」。',
    // `prepare` 排在前面：它一次做完封装双方 → Preflight → 建赛。
    // 只有在它不可用（例如另一边还没就绪）时，才顺延到单队的「使用槽位算法」。
    // 反过来排会把 `prepare` 挤进 Advanced 折叠区 —— 那正好是本步的主按钮。
    candidates: ['prepare', 'use-slot-a'],
  },
  UPLOAD_A: {
    stage: 'ALGORITHM READY',
    what: 'Team A 已密封。Team B 的算法就绪后，同样一步就能完成筹备。',
    candidates: ['prepare', 'use-slot-b'],
  },
  UPLOAD_B: {
    stage: 'ALGORITHM READY',
    what: '双方算法都在槽位里了：一次完成「封装双方算法 → 沙箱 Preflight → 建赛」，随后进入 Emitter 选择。',
    candidates: ['prepare', 'preflight', 'start'],
  },
  PREFLIGHT: {
    stage: 'ALGORITHM READY',
    what: '沙箱里正在真跑一次双方算法（Preflight），确认能产出合法函数。',
    candidates: ['prepare', 'start'],
  },
  EMITTER_SELECT: {
    stage: 'EMITTER LOCK',
    what: '地图已生成。双方各自在选手端选定并锁定本场的发射锚点 —— 这一步由选手完成，裁判在此等待；双方都锁定后锚点自动公开。',
    candidates: [],
    waiting: true,
  },
  READY: {
    stage: 'READY',
    what: '双方 Emitter 已锁定，锚点已公开，可以开始本轮。',
    candidates: ['reveal', 'run-to-end'],
  },
  PUBLIC: {
    stage: 'START MATCH',
    what: '本轮 public_state 已冻结。揭晓障碍物 —— 此刻参赛代码一行都还没跑。',
    candidates: ['reveal', 'start-round', 'run-to-end'],
  },
  REVEAL: {
    stage: 'START MATCH',
    what: '障碍物已公开，参赛代码仍然没有运行。下达 START 才是唯一允许它运行的开关。',
    candidates: ['start-round', 'reveal', 'run-to-end'],
  },
  COUNTDOWN: {
    stage: 'ROUND',
    what: 'START 已下达，倒计时归零后双方算法开始计算。',
    candidates: ['compute'],
  },
  COMPUTING: {
    stage: 'ROUND',
    what: '双方算法在各自沙箱里计算，本轮正在结算。',
    candidates: ['compute'],
  },
  ROUND_RESULT: {
    stage: 'ROUND',
    what: '本轮已结算，可以进入下一轮。',
    candidates: ['reveal', 'run-to-end'],
  },
  MATCH_END: {
    stage: 'MATCH END',
    what: '比赛已终止。可以看回放，或开新的一场。',
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

  if (!board) {
    return (
      <div className="judge">
        <div className="judge__bar">
          <span className="eyebrow">裁判台</span>
        </div>
        <div className="empty">正在连接本地比赛服务…</div>
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
      setErrors([`界面尚未接入该动作：${key}`]);
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
      setPreviewErrors(r.errors.length ? r.errors : ['读取失败']);
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
  const phaseLabel = PHASE_LABEL[board.phase] ?? board.phase;
  const match = board.settings;

  return (
    <div className="judge">
      <header className="judge__bar">
        <span className="eyebrow">裁判台</span>
        <span className="num muted" data-testid="match-id">MATCH {board.matchId}</span>
        <span className="num">
          ROUND <strong>{String(board.round).padStart(2, '0')}</strong>
        </span>
        {/* E2E 依赖：这里必须是引擎的**原始阶段名** */}
        <span className="eyebrow" data-testid="phase">{board.phase}</span>
        <span className="num muted">seed {match.seed}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <a className="link" href="/spectator" target="_blank" rel="noreferrer">
            打开观众大屏 ↗
          </a>
          <a className="link" href={`/replay/${encodeURIComponent(board.matchId)}`}>
            回放
          </a>
          <span className={`tag ${connected ? 'tag--live' : 'tag--down'}`}>
            {connected ? '● 实时' : '○ 未连接'}
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
        {(['A', 'B'] as const).map((t) => {
          const s = board.slots[t];
          const lock = emitterSelectionOf(board)?.[t] ?? null;
          const ready = s.status === 'READY';
          const pre = s.preflightOk === null ? '未经本平台安装' : s.preflightOk ? 'Preflight ✓' : 'Preflight ✕';
          return (
            <div className="teamcard" key={t} data-team={t} data-testid={`judge-team-${t}`}>
              <span className={`team-dot team-dot--${t.toLowerCase()}`} />
              <span className="teamcard__name" title="算法包自报的名字">
                {s.name ?? '（未命名）'}
              </span>
              <span className={`tag ${ready ? 'tag--live' : 'tag--down'}`} title={pre}>
                {ready ? '算法就绪' : '未就绪'}
              </span>
              <span
                className={`tag ${lock?.locked ? 'tag--live' : ''}`}
                data-testid={`judge-team-${t}-emitter`}
              >
                {lock?.locked ? `锚点 ${lock.selected?.id ?? '已锁定'}` : '锚点未锁定'}
              </span>
              <span className="num dim">
                {board.packages[t] ? `本场密封 ${board.packages[t]!.hash.slice(0, 10)}…` : '本场未密封'}
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
            <h2>参赛者入口</h2>
            <span className="num dim">本场链接 · 换场即更新</span>
          </div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
            把对应的那条发给各队。链接里带着**本场**的访问令牌：不要投到大屏上，
            也不要发给另一队 —— 拿着某队的令牌就能替那一队操作。
          </p>
          {(['A', 'B'] as const).map((t) => {
            const url = `${location.origin}/team/${t.toLowerCase()}#t=${board.teamTokens[t]}`;
            return (
              <div
                key={t}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
              >
                <span className={`team-dot team-dot--${t.toLowerCase()}`} />
                <span className="slot__name">Team {t}</span>
                <code
                  className="num"
                  data-testid={`team-link-${t}`}
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
                  data-testid={`team-link-${t}-copy`}
                  onClick={() => copyLink(t, url)}
                >
                  {copied === t ? '已复制' : '复制'}
                </button>
              </div>
            );
          })}
        </section>

        {/* ---- 向导 ---- */}
        <section className="panel" data-testid="wizard" data-phase={board.phase}>
          <div className="panel__title">
            <h2>裁判向导</h2>
            <span className="num dim" data-testid="phase-label">
              {step.stage} · {phaseLabel}
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
                  {i + 1} {s}
                </li>
              );
            })}
          </ol>

          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }} data-testid="wizard-what">
            {step.what}
          </p>

          {primary ? (
            <>
              <button
                type="button"
                className="act"
                data-action={primary.key}
                data-testid="primary-action"
                disabled={!primary.enabled || busy}
                title={primary.hint}
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
                  <span className="act__label">{primary.label}</span>
                  {/* 服务端给的 hint —— 不可点时它就是「为什么不能点」的答案 */}
                  <span className="act__hint">{primary.hint}</span>
                </span>
              </button>
              <p className="num dim" style={{ margin: '8px 0 0', fontSize: 11 }} data-testid="primary-why">
                {busy
                  ? '执行中…（命令是串行的，忙时按钮一律不可点）'
                  : primary.enabled
                    ? `服务端判据：可用 —— ${primary.hint}`
                    : `服务端判据：不可用 —— ${primary.hint}`}
              </p>
            </>
          ) : (
            <p className="num dim" style={{ margin: 0, fontSize: 11 }} data-testid="primary-why">
              {busy ? '执行中…' : '本步由双方选手在各自的参赛者页完成，裁判没有对应动作。'}
            </p>
          )}

          {/* EMITTER LOCK：裁判板是权威视角，双方的选择与锁定状态都看得到 */}
          {showEmitters ? (
            <div
              data-testid="emitter-status"
              style={{ border: '1px solid var(--rule)', padding: '8px 10px', marginTop: 12 }}
            >
              <div className="panel__title" style={{ marginBottom: 6 }}>
                <h2>双方 Emitter</h2>
                <span className="num dim">
                  {emitterSelectionOf(board)?.revealed ? '双方已锁定 · 锚点公开' : '未公开'}
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
                      {r.selected ?? '未选择'}
                    </span>
                    <span className={`tag ${r.locked ? 'tag--live' : ''}`} data-testid={`emitter-${r.team}-lock`}>
                      {r.locked === null ? '状态未知' : r.locked ? '已锁定' : '未锁定'}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                  服务端尚未下发双方的选择 —— 这里不猜锁定状态。
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel__title">
            <h2>算法槽位</h2>
            <span className="dim num">{board.settings.pointCount} 点 · {board.settings.difficulty}</span>
          </div>
          <div className="slot">
            <span className="slot__detail">
              投递点 <code>{board.slotRoot}</code>
            </span>
            {/*
              这里曾有一行「仓库里的 algorithms/ 只是出厂 fixture —— 改它**不会**改变
              比赛用的算法」。两个问题：Markdown 的星号被当成普通文本原样渲染出来，
              而且它是**文档**，不是操作信息 —— 上面那行投递点路径已经把「跑的是哪份」
              说清楚了，这句解释留在 README 里更合适。
            */}
          </div>
          {(['A', 'B'] as const).map((t) => {
            const s = board.slots[t];
            return (
              <div className="slot" key={t}>
                <span className="slot__name">
                  <span className={`team-dot team-dot--${t.toLowerCase()}`} />
                  Team {t}
                  {/* 算法名是防「静默跑错算法」最直接的信号：投的是谁，板上就写谁 */}
                  {s.name ? <b> · {s.name}</b> : null}
                </span>
                <span className={`slot__status ${s.status === 'READY' ? 'slot__status--ready' : 'slot__status--bad'}`}>
                  {s.status}
                </span>
                <span className="slot__detail">
                  {s.status === 'READY'
                    ? `${s.files} 文件 · ${s.totalBytes} B · preflight ${s.preflightOk === null ? '未经本平台安装' : s.preflightOk ? '✓' : '✕'}`
                    : s.errors[0] ?? '槽位为空'}
                </span>
                <span className="slot__detail">
                  {s.origin === 'installed' ? `已安装 · 来源 ${s.source ?? '未知'}` : '无安装记录（出厂播种 / 手工放置）'}
                </span>
                <span className="slot__detail">
                  <code>{s.dir}</code>
                </span>
                {s.hash ? <span className="slot__detail dim">包哈希 {s.hash.slice(0, 24)}…</span> : null}
                <span className="slot__detail">
                  本场已密封 {board.packages[t] ? `${board.packages[t]!.hash.slice(0, 16)}…` : '—'}
                </span>

                {/*
                  包内文件清单 + 只读浏览（V1.2 §一）。
                  哈希对不了人眼，源码可以 —— 这是「投的是不是选手那份」最直接的核对手段。
                  内容按需取，不随 board 推送。
                */}
                {s.fileList.length > 0 ? (
                  <ul className="audit-list" data-testid={`judge-files-${t}`}>
                    {s.fileList.map((f) => (
                      <li key={f.path}>
                        <span className="num dim">{f.bytes}</span>
                        <button
                          className="link"
                          data-testid={`judge-file-${t}`}
                          data-path={f.path}
                          onClick={() => void openSource(t, f.path)}
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
                <span className="muted">只读</span>
              </div>
              {preview.binary ? (
                <p className="muted" data-testid="judge-source-binary">
                  二进制文件 —— 不提供预览
                </p>
              ) : (
                <>
                  <pre className="source-view" data-testid="judge-source-text">
                    {preview.text}
                  </pre>
                  {preview.truncated ? (
                    <p className="muted" data-testid="judge-source-truncated">
                      内容已截断（仅显示开头部分）
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>

        <details className="adv">
          <summary>Advanced Controls · 底层动作与比赛设置</summary>
          <div className="adv__body">
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              向导只突出「现在该做的那一个」；这里是服务端下发的**全部**动作（含向导未用到的底层步骤）。
              可用性同样只读服务端的判据 —— 灰掉的按钮把鼠标悬上去就是原因。
            </p>
            <div className="actions">
              {advancedActions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="act"
                  data-action={a.key}
                  disabled={!a.enabled || busy}
                  title={a.hint}
                  onClick={() => void runAction(a.key)}
                >
                  <span className="act__key">{a.key.replace(/^use-slot-/, 'slot-').slice(0, 8)}</span>
                  <span className="act__body">
                    <span className="act__label">{a.label}</span>
                    <span className="act__hint">{a.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '14px 0 12px' }} />
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              正式比赛请用向导里的「封装双方算法 → 校验 → 建赛」—— 算法要投进**运行期槽位**
              （见上方「投递点」）。这里只在需要临时换算法时使用，输入的是**服务端**上的目录绝对路径。
            </p>
            {(['A', 'B'] as const).map((t) => {
              const value = t === 'A' ? pathA : pathB;
              const setValue = t === 'A' ? setPathA : setPathB;
              return (
                <div key={t}>
                  <label className="field">
                    <span>Team {t} 算法目录</span>
                    <input
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="/绝对/路径/到/算法包"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || value.trim() === ''}
                    style={{ marginBottom: 14 }}
                    onClick={() => void run(COMMAND_PATHS.install, { team: t, sourceDir: value.trim() })}
                  >
                    安装 Team {t} 算法
                  </button>
                </div>
              );
            })}

            <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '4px 0 12px' }} />
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              比赛设置 —— 在下一次「重置 / 下一场」时生效。
            </p>
            <label className="field">
              <span>种子（留空 = 随机）</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={String(match.seed)} inputMode="numeric" />
            </label>
            <label className="field">
              <span>战斗点数（留空 = 沿用）</span>
              <input
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder={String(match.pointCount)}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>难度（留空 = 沿用）</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">沿用 {match.difficulty}</option>
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
            </label>
          </div>
        </details>

        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel__title">
            <h2>审计</h2>
            <span className="num dim">{board.audit.events} 事件</span>
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
            {board.artifactDir ? `产物：${board.artifactDir}` : '尚未产生产物'} · runtime{' '}
            {board.runtime.ok ? '✓ 与冻结清单一致' : '✕ 与冻结清单不符'}
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
              board.lastRound ? `R${board.lastRound.round} first: ${board.lastRound.firstSolver.toUpperCase()}` : undefined
            }
          />
          <span className="lastround__item">
            <span className="lastround__label">本轮攻击</span>
            <span className="lastround__value">
              {board.lastRound?.attacksExecuted.length ? board.lastRound.attacksExecuted.join(' → ') : '—'}
            </span>
          </span>
          <span className="lastround__item">
            <span className="lastround__label">击杀</span>
            <span className="lastround__value">{board.lastRound?.killed.join(',') || '无'}</span>
          </span>
          <span className="lastround__item">
            <span className="lastround__label">存活</span>
            <span className="lastround__value">
              A {board.alive.A} / B {board.alive.B}
            </span>
          </span>
          {board.verdict ? (
            <span className="lastround__item" data-testid="verdict">
              <span className="lastround__label">终局</span>
              <span
                className="lastround__value"
                style={{ color: board.verdict.winner === 'draw' ? 'var(--muted)' : board.verdict.winner === 'A' ? 'var(--a)' : 'var(--b)' }}
              >
                {board.verdict.winner === 'draw' ? '平局' : `TEAM ${board.verdict.winner} 获胜`} · {board.verdict.endReason}
              </span>
            </span>
          ) : null}
          {board.lastRound?.errors.length ? (
            <span className="lastround__item" style={{ color: 'var(--danger)' }}>
              {board.lastRound.errors.join('   ')}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}
