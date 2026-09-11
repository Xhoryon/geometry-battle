/**
 * 参赛者页（V1.2 §一）—— `/team/a` 与 `/team/b`
 *
 * 每队在这里：
 *   1. 上传自己的算法包（ZIP / 目录 / 单个 solver.py）—— 走**同一条**安装流水线，
 *      浏览器没有任何绕过校验的通道；
 *   2. 查看文件清单、只读浏览自己的源码；
 *   3. 开赛后从**自己的初始点**里点一个作为本场 Fixed Emitter，然后 Lock。
 *
 * 两条纪律：
 *   - **可用性只来自服务端**：每个按钮的 `disabled` 读 `board.actions[].enabled`，
 *     页面里不写任何 `phase === '...'` 的判断（那正是 V1.1 翻车的原因）。
 *     阶段名只用来决定**展示哪一段**，不用来决定能不能点。
 *   - **看不到对手的东西**：`TeamBoard` 是服务端按队别裁剪过的白名单投影，
 *     对方的槽位、源码、锁定前的 Emitter 选择都不在载荷里。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import {
  TEAM_PATHS,
  command,
  fetchTeamSource,
  filesToUploadPayload,
  useBoard,
} from '../api/client';
import type { ActionView, TeamBoard } from '../../../src/server/protocol';

const PHASE_LABEL: Record<string, string> = {
  SETUP: '准备',
  UPLOAD_A: '载入算法（A）',
  UPLOAD_B: '载入算法（B）',
  PREFLIGHT: '校验算法',
  EMITTER_SELECT: '选择发射锚点',
  READY: '就绪',
  PUBLIC: '公开信息',
  REVEAL: '揭晓障碍',
  COUNTDOWN: '倒计时',
  COMPUTING: '计算中',
  ROUND_RESULT: '回合结算',
  MATCH_END: '比赛结束',
};

function actionOf(board: TeamBoard | null, key: string): ActionView | null {
  return board?.actions.find((a) => a.key === key) ?? null;
}

export function TeamPage({ team }: { team: 'A' | 'B' }): JSX.Element {
  const topic = team === 'A' ? 'team-a' : 'team-b';
  const { board, connected } = useBoard<TeamBoard>(topic);

  // ---- 本地交互状态（服务端没有的：文件选择、正在跑的请求、源码预览）----
  const [busyLocal, setBusyLocal] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    path: string;
    text: string;
    truncated: boolean;
    binary: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = busyLocal || Boolean(board?.busy);

  /** 统一的命令入口：本地防连点 → 发命令 → 把服务端的原话显示出来 */
  const run = useCallback(async (path: string, body: Record<string, unknown>, okNote: string) => {
    setBusyLocal(true);
    setErrors([]);
    setNotes([]);
    const r = await command(path, body);
    if (!r.ok) setErrors(r.errors.length ? r.errors : ['命令失败']);
    else setNotes([okNote]);
    setBusyLocal(false);
  }, []);

  const onUpload = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      setBusyLocal(true);
      setErrors([]);
      setNotes([]);
      const { files, errors: packErrors } = await filesToUploadPayload(list);
      if (packErrors.length > 0) {
        setErrors(packErrors);
        setBusyLocal(false);
        return;
      }
      const r = await command(TEAM_PATHS.upload, { team, files });
      if (!r.ok) setErrors(r.errors.length ? r.errors : ['上传失败']);
      else {
        setNotes([
          `已安装 ${files.length} 个文件${
            typeof r.detail?.hash === 'string' ? `，包哈希 ${String(r.detail.hash).slice(0, 12)}…` : ''
          }`,
        ]);
        setPreview(null);
      }
      setBusyLocal(false);
      if (fileRef.current) fileRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [team]
  );

  const onOpenSource = useCallback(
    async (relPath: string) => {
      const r = await fetchTeamSource(team, relPath);
      if (!r.ok) setErrors(r.errors);
      else
        setPreview({
          path: relPath,
          text: r.text ?? '',
          truncated: Boolean(r.truncated),
          binary: Boolean(r.binary),
        });
    },
    [team]
  );

  const selectAction = actionOf(board, 'select-emitter');
  const lockAction = actionOf(board, 'lock-emitter');

  const selectedId = board?.own.selected ?? null;
  const locked = board?.own.locked ?? false;

  // 竞技场：只画场上属于本队的信息 + 双方锚点（锁定后才公开）
  const arenaEmitters = useMemo(() => {
    if (!board?.emitters) return null;
    const { A, B } = board.emitters;
    return {
      A: { id: A.id, position: { x: A.x, y: A.y } },
      B: { id: B.id, position: { x: B.x, y: B.y } },
    };
  }, [board?.emitters]);

  useEffect(() => {
    // 板子换代（换比赛）时清掉上一场的提示，避免旧红字粘着不放
    setErrors([]);
    setNotes([]);
  }, [board?.matchId]);

  const roleClass = team === 'A' ? 'panel--a' : 'panel--b';
  const label = `参赛者 ${team}`;

  /**
   * 「上传 → 校验 → 选锚点 → 锁定」四步。
   *
   * 每一步的**完成判据只来自服务端**：槽位装没装、能不能参赛、自己选没选、锁没锁。
   * 页面不另算一套进度 —— 那是影子规则。`phase` 只用来解释「为什么现在点不动」。
   */
  const steps = [
    { key: 'upload', label: '上传算法包', done: Boolean(board?.slot.installed) },
    { key: 'verify', label: '赛前校验', done: Boolean(board?.packageReady) },
    { key: 'select', label: '选择锚点', done: selectedId !== null },
    { key: 'lock', label: '锁定', done: locked },
  ];
  const nowStep = steps.findIndex((s) => !s.done);

  return (
    <div className="team">
      <header className="team__rail">
        <p className="eyebrow">{label}</p>
        <p className="num">
          <span className={`swatch swatch--${team.toLowerCase()}`} /> {board?.matchId ?? '——'}
        </p>
        <p data-testid="team-phase">
          阶段：{PHASE_LABEL[board?.phase ?? ''] ?? board?.phase ?? '连接中'}
        </p>
        <p className="muted" data-testid="conn">
          {connected ? '已连接' : '连接中…'}
        </p>
        {board?.tournamentMode === false && (
          <p className="muted">开发模式（锦标赛校验已关闭）</p>
        )}
        <p>
          <a className="link" href="/spectator" target="_blank" rel="noreferrer">
            观众大屏 ↗
          </a>
        </p>

        {errors.length > 0 && (
          <div className="errors" data-testid="team-errors">
            {errors.map((e, i) => (
              <p key={i}>⚠ {e}</p>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <div className="errors" data-testid="team-notes">
            {notes.map((n, i) => (
              <p key={i}>✓ {n}</p>
            ))}
          </div>
        )}
      </header>

      <main className="team__main">
        {/*
          四步进度条 —— 参赛者一眼看到「我走到哪、下一步做什么」。
          这一步之前只有散落在三块面板里的状态，没人知道顺序。
        */}
        <ol className="steps" data-testid="team-steps">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className="steps__item"
              data-step={s.key}
              data-state={s.done ? 'done' : i === nowStep ? 'now' : 'todo'}
            >
              <span className="steps__no">{i + 1}</span>
              <span className="steps__label">{s.label}</span>
            </li>
          ))}
        </ol>

        {/* ---- 1. 算法包 ---- */}
        <section className={`panel ${roleClass}`} data-testid="team-package">
          <div className="panel__title">
            <h2>算法包</h2>
            <span className={`tag ${board?.packageReady ? 'tag--live' : ''}`}>
              {board?.packageReady ? '已就绪' : '未就绪'}
            </span>
          </div>

          {/*
            三种来源分别给一个入口（V1.2 §一：ZIP / folder / solver.py）：
              - 目录：`webkitdirectory`，浏览器会把 `webkitRelativePath` 带过来，
                自动去掉最外层目录名，让包根目录就是用户选的那一层；
              - 文件 / ZIP：普通多选；单个 `.zip` 会在浏览器里展开（服务端零依赖，不接 zip）。
            三条路最终都只是「路径 + 字节」，走同一条安装流水线。
          */}
          {/*
            两种来源各给一个入口。原生 `<input type=file>` 的按钮部件在
            Chrome 里几乎无法彻底换皮（`::file-selector-button` 的背景常常
            被忽略），所以这里用**包裹 label + 视觉隐藏的原生 input**：
            真正接到浏览器文件选择器的仍然是那个 input，只是不参与布局。
            这样按钮的样子与文案都由页面说了算。
          */}
          <label className={`upload${busy ? ' upload--busy' : ''}`}>
            <input
              ref={fileRef}
              type="file"
              multiple
              data-testid="team-upload-dir"
              disabled={busy}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...({ webkitdirectory: '' } as any)}
              onChange={(e) => void onUpload(e.target.files)}
            />
            <span className="upload__btn" aria-hidden="true">
              选择文件夹
            </span>
            <span className="upload__hint">整个算法目录（包根目录里要有 solver.py）</span>
          </label>

          <label className={`upload${busy ? ' upload--busy' : ''}`}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              data-testid="team-upload"
              disabled={busy}
              onChange={(e) => void onUpload(e.target.files)}
            />
            <span className="upload__btn" aria-hidden="true">
              选择文件 / ZIP
            </span>
            <span className="upload__hint">单个 solver.py、多个文件，或一个 .zip</span>
          </label>
          <p className="muted">
            单个 <code>solver.py</code>、一整个算法目录、或者一个 <code>.zip</code> 都可以。
            上传走的是与正式比赛<strong>同一套校验</strong>
            （staging → validate → sandbox preflight → seal → replace），浏览器绕不过去。
          </p>

          <div className="slot">
            <span className="slot__name">{board?.slot.name ?? '（未命名）'}</span>
            {/* 类名必须与 styles.css 里的**真实**定义一致：
                此前写成 slot--ready/slot--bad（不存在），标签一直是没样式的裸文本。 */}
            <span
              className={`slot__status ${
                board?.packageReady ? 'slot__status--ready' : 'slot__status--bad'
              }`}
            >
              {board?.slot.status ?? '—'}
            </span>
          </div>
          {board?.slot.errors?.length ? (
            <div className="errors">
              {board.slot.errors.slice(0, 4).map((e, i) => (
                <p key={i}>⚠ {e}</p>
              ))}
            </div>
          ) : null}

          <div className="panel__title">
            <h2>文件清单</h2>
            <span className="muted num">{board?.files.length ?? 0} 个</span>
          </div>
          {board && board.files.length > 0 ? (
            <ul className="audit-list">
              {board.files.map((f) => (
                <li key={f.path}>
                  <span className="num">{f.bytes}</span>
                  <button
                    className="link"
                    data-testid="team-file"
                    onClick={() => void onOpenSource(f.path)}
                  >
                    {f.path}
                  </button>
                  <span />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">（还没有文件）</p>
          )}

          {preview && (
            <div data-testid="team-source">
              <div className="panel__title">
                <h2>{preview.path}</h2>
                <span className="muted">只读</span>
              </div>
              {preview.binary ? (
                <p className="muted" data-testid="team-source-binary">
                  二进制文件 —— 不提供预览
                </p>
              ) : (
                <>
                  <pre className="source-view">{preview.text}</pre>
                  {preview.truncated ? (
                    <p className="muted" data-testid="team-source-truncated">
                      内容已截断（仅显示开头部分）
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )}
        </section>

        {/* ---- 2. Emitter 选择 ---- */}
        <section className={`panel ${roleClass}`} data-testid="team-emitter">
          <div className="panel__title">
            <h2>本场 Fixed Emitter</h2>
            <span className={`tag ${locked ? 'tag--live' : ''}`}>
              {locked ? '已锁定' : selectedId ? '已选择（未锁定）' : '未选择'}
            </span>
          </div>

          <p className="muted">
            从自己的初始点里选一个作为本场的发射锚点。它整场不可更换、不可击杀、也不是战斗点；
            其余的点才是 Combat Points。双方都锁定之后，两个锚点才会公开。
          </p>

          {board && board.candidates.length > 0 ? (
            <>
              {/* 先选、后锁 —— 顺序就是操作顺序。此前锁定按钮排在候选列表**上面**，
                  等于让人先看到一个还点不动的按钮。 */}
              <p className="step-caption" data-testid="team-select-caption">
                <span className="steps__no">3</span> 从下面这些点里挑一个作为本场锚点
              </p>

              <ul className="audit-list" data-testid="team-candidates">
                {board.candidates.map((c) => {
                  const isSel = selectedId === c.id;
                  const cls = `cand${isSel ? ' cand--selected' : ''}${locked ? ' cand--locked' : ''}`;
                  return (
                    <li key={c.id}>
                      <span className="num">{c.id}</span>
                      <button
                        className={cls}
                        data-testid="team-candidate"
                        data-candidate={c.id}
                        disabled={!selectAction?.enabled || busy}
                        title={selectAction?.hint ?? ''}
                        onClick={() =>
                          void run(TEAM_PATHS.selectEmitter, { team, pointId: c.id }, `已选择 ${c.id}`)
                        }
                      >
                        ({c.x.toFixed(1)}, {c.y.toFixed(1)}){isSel ? '  ← 已选择' : ''}
                      </button>
                      <span className="num muted">{c.alive ? '存活' : '阵亡'}</span>
                    </li>
                  );
                })}
              </ul>

              <p className="step-caption">
                <span className="steps__no">4</span> 选定之后锁定 —— 锁定后整场不可更换
              </p>
              <div className="actions">
                {/* 本页此刻唯一该做的事 —— 用主操作样式，别和次要控件长一个样。
                    禁用时它会退回普通 .btn 的样子，「还不能点」一眼可见。 */}
                <button
                  className="btn btn--primary"
                  data-testid="team-lock"
                  data-action={lockAction?.key}
                  disabled={!lockAction?.enabled || busy}
                  title={lockAction?.hint ?? ''}
                  onClick={() => void run(TEAM_PATHS.lockEmitter, { team }, 'Emitter 已锁定')}
                >
                  锁定 Emitter
                </button>
                <span className="muted">{lockAction?.hint}</span>
              </div>
            </>
          ) : (
            <p className="muted">
              比赛开始之后才能选择 —— 裁判在「筹备」一步生成地图，随后进入本阶段。
            </p>
          )}

          <div className="panel__title">
            <h2>双方锚点</h2>
            <span className="muted">{board?.revealed ? '已公开' : '未公开'}</span>
          </div>
          {board?.revealed && board.emitters ? (
            <p className="num" data-testid="team-emitters">
              A = {board.emitters.A.id}（{board.emitters.A.x.toFixed(1)}, {board.emitters.A.y.toFixed(1)}）
              {'　'}B = {board.emitters.B.id}（{board.emitters.B.x.toFixed(1)},{' '}
              {board.emitters.B.y.toFixed(1)}）
            </p>
          ) : (
            <p className="muted" data-testid="team-emitters-hidden">
              双方都锁定之后才会公开。对方现在{board?.opponent.locked ? '已锁定' : '尚未锁定'}。
            </p>
          )}
        </section>

        {/* ---- 3. 场面（只读） ---- */}
        {board && board.candidates.length > 0 && (
          <section className={`panel ${roleClass}`}>
            <div className="panel__title">
              <h2>场面</h2>
              <span className="muted">只读</span>
            </div>
            {/*
              可交互：点直接点选（§五）。命中与状态都只是**展示** ——
              真正的选择走 select-emitter 命令，可用性仍由服务端判定。
              这里不画障碍物（那是 REVEAL 阶段才公开的隐藏信息）。
            */}
            <div style={{ height: 320 }}>
              <ArenaCanvas
                arena={{
                  field: { xMin: -20, xMax: 20, yMin: -12, yMax: 12 },
                  obstacles: [],
                  emitters: arenaEmitters,
                  points: board.candidates.map((c) => ({
                    id: c.id,
                    team,
                    position: { x: c.x, y: c.y },
                    alive: c.alive,
                  })),
                }}
                trajectory={null}
                ticks
                interactive={Boolean(selectAction?.enabled) && !busy}
                selectedId={selectedId}
                lockedIds={locked && selectedId ? [selectedId] : []}
                onSelectPoint={(id) => {
                  if (!selectAction?.enabled || busy) return;
                  void run(TEAM_PATHS.selectEmitter, { team, pointId: id }, `已选择 ${id}`);
                }}
              />
            </div>
            <p className="muted">点击场上的点即可选为 Emitter（也可以在上面列表里点）。</p>
          </section>
        )}
      </main>
    </div>
  );
}
