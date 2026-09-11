/**
 * 裁判台 —— 正式赛事全流程。
 *
 * 设计上的两条硬规矩：
 *
 *   1. **不重复实现引擎的门禁。** 每个动作的可用性直接读服务端发来的
 *      `actions[].enabled`，那份判据本身又抄自引擎的真实条件。裁判台
 *      **不写** `phase === 'READY' && ...` 这类影子规则 —— 那正是 V1.1
 *      终端裁判台翻车的地方（校验通过反而开不了赛）。
 *   2. **正式主流程是「使用槽位算法」**（零输入：选手已经把算法投进槽位）。
 *      目录路径安装收在 Advanced 折叠区，是换算法的备用手段。
 *
 * 命令执行失败不弹窗、不吞掉：错误原文贴在动作区上方，且是引擎说的人话。
 */

import { useState } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { ComputeStatus } from '../components/ComputeStatus';
import { command, useBoard, useTrajectory } from '../api/client';
import { COMMAND_PATHS } from '../../../src/server/protocol';
import type { JudgeBoard } from '../../../src/server/protocol';
import type { JSX } from 'react';

/** 动作 key → 命令接口。表驱动，避免在 JSX 里堆 switch。 */
const ACTION_PATHS: Record<string, string> = {
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

export function JudgePage(): JSX.Element {
  const { board, connected } = useBoard<JudgeBoard>('judge');
  const trajectory = useTrajectory(board?.trajectoryHandle ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busyLocal, setBusyLocal] = useState(false);

  // ---- Match Setup（下一场生效）----
  const [seed, setSeed] = useState('');
  const [points, setPoints] = useState('');
  const [difficulty, setDifficulty] = useState('');

  // ---- Advanced：目录路径安装 ----
  const [pathA, setPathA] = useState('');
  const [pathB, setPathB] = useState('');

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
    if (!path) return Promise.resolve();
    const body: Record<string, unknown> = actionBody(key);
    if (key === 'reset') {
      // Match Setup 只在开新场时生效 —— 让「设置」和「它什么时候起作用」绑在一起
      if (seed.trim() !== '') body.seed = Number(seed);
      if (points.trim() !== '') body.pointCount = Number(points);
      if (difficulty !== '') body.difficulty = difficulty;
    }
    return run(path, body);
  };

  const match = board.settings;

  return (
    <div className="judge">
      <header className="judge__bar">
        <span className="eyebrow">裁判台</span>
        <span className="num muted" data-testid="match-id">MATCH {board.matchId}</span>
        <span className="num">
          ROUND <strong>{String(board.round).padStart(2, '0')}</strong>
        </span>
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

      <aside className="judge__side">
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

        <section className="panel">
          <div className="panel__title">
            <h2>算法槽位</h2>
            <span className="dim num">{board.settings.pointCount} 点 · {board.settings.difficulty}</span>
          </div>
          <div className="slot">
            <span className="slot__detail">
              投递点 <code>{board.slotRoot}</code>
            </span>
            <span className="slot__detail dim">
              仓库里的 <code>algorithms/</code> 只是出厂 fixture —— 改它**不会**改变比赛用的算法
            </span>
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
              </div>
            );
          })}
        </section>

        <section className="panel">
          <div className="panel__title">
            <h2>动作</h2>
            {busy ? <span className="num dim">执行中…</span> : null}
          </div>
          <div className="actions">
            {board.actions.map((a) => (
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
        </section>

        <details className="adv">
          <summary>Advanced · 替换算法与比赛设置</summary>
          <div className="adv__body">
            <p className="dim" style={{ margin: '0 0 10px', fontSize: 11 }}>
              正式比赛请用上面的「使用槽位算法」—— 算法要投进**运行期槽位**（见上方「投递点」）。
              这里只在需要临时换算法时使用，输入的是**服务端**上的目录绝对路径。
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
