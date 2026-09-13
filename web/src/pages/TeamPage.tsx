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
import { AccessNotice } from '../components/AccessNotice';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { PHASE_KEYS } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';

function actionOf(board: TeamBoard | null, key: string): ActionView | null {
  return board?.actions.find((a) => a.key === key) ?? null;
}

export function TeamPage({ team }: { team: 'A' | 'B' }): JSX.Element {
  const { t, td } = useI18n();
  const topic = team === 'A' ? 'team-a' : 'team-b';
  const { board, connected, access } = useBoard<TeamBoard>(topic);

  // 服务端给稳定键、客户端翻译（与 JudgePage 的 actionHint 同一套）。
  // `a.hint` 是服务端的**中文原文**，只在认不出键时兜底 —— 直接渲染它
  // 会让英文界面里冒出一整句中文，正是 i18n 回归里点名的「混合语言」事故。
  const actionHint = (a: ActionView | null): string =>
    a ? td(a.hintKey, a.hintParams, a.hint) : '';

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
    if (!r.ok) setErrors(r.errors.length ? r.errors : [t('team.err.commandFailed')]);
    else setNotes([okNote]);
    setBusyLocal(false);
  }, [t]);

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
      if (!r.ok) setErrors(r.errors.length ? r.errors : [t('team.err.uploadFailed')]);
      else {
        const hash = typeof r.detail?.hash === 'string' ? String(r.detail.hash).slice(0, 12) : null;
        setNotes([
          hash
            ? t('team.note.installedWithHash', { n: files.length, hash })
            : t('team.note.installed', { n: files.length }),
        ]);
        setPreview(null);
      }
      setBusyLocal(false);
      if (fileRef.current) fileRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [team, t]
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

  /**
   * 「上传 → 校验 → 选锚点 → 锁定」四步。
   *
   * 每一步的**完成判据只来自服务端**：槽位装没装、能不能参赛、自己选没选、锁没锁。
   * 页面不另算一套进度 —— 那是影子规则。`phase` 只用来解释「为什么现在点不动」。
   */
  const steps: { key: string; label: TranslationKey; done: boolean }[] = [
    { key: 'upload', label: 'team.steps.upload', done: Boolean(board?.slot.installed) },
    { key: 'verify', label: 'team.steps.verify', done: Boolean(board?.packageReady) },
    { key: 'select', label: 'team.steps.select', done: selectedId !== null },
    { key: 'lock', label: 'team.steps.lock', done: locked },
  ];
  const nowStep = steps.findIndex((s) => !s.done);

  return (
    /*
      `data-board` 是**权威 board 是否已到达**的机器可读标记。

      `connected` 只说明 WS 在线；首帧 board 是随后一条消息 —— 这中间有一段窗口，
      其间 `board` 仍为 null，槽位名等字段渲染的是兜底值（`（未命名）`/`(unnamed)`）。
      浏览器演练若在这段窗口里读文本，读到的就不是权威值。

      把它做成属性而不是让测试去猜渲染出来的文案：文案本身正是被测对象，
      拿它当就绪判据会让测试与实现互相印证。
    */
    <div className="team" data-board={board ? 'ready' : 'pending'}>
      <header className="team__rail">
        <p className="eyebrow">{t('team.title', { team })}</p>
        <p className="num">
          <span className={`swatch swatch--${team.toLowerCase()}`} /> {board?.matchId ?? '——'}
        </p>
        <p data-testid="team-phase">
          {board
            ? t('team.phase', { label: t(PHASE_KEYS[board.phase]) })
            : t('common.connectingShort')}
        </p>
        <p className="muted" data-testid="conn">
          {connected ? t('common.connected') : t('common.connectingShort')}
        </p>
        {board?.tournamentMode === false && <p className="muted">{t('team.devMode')}</p>}
        <p>
          <a className="link" href="/spectator" target="_blank" rel="noreferrer">
            {t('nav.spectatorArrow')}
          </a>
        </p>
        <LanguageSwitch />

        {/* 令牌问题**先于**其它错误显示：它是「这一页根本不该由你打开」，
            而不是某一次操作失败 —— 后者在令牌不对时根本发不出去。 */}
        <AccessNotice access={access} testId="team-access" />

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
              <span className="steps__label">{t(s.label)}</span>
            </li>
          ))}
        </ol>

        {/* ---- 1. 算法包 ---- */}
        <section className={`panel ${roleClass}`} data-testid="team-package">
          <div className="panel__title">
            <h2>{t('team.package.title')}</h2>
            <span className={`tag ${board?.packageReady ? 'tag--live' : ''}`}>
              {board?.packageReady ? t('team.package.ready') : t('team.package.notReady')}
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
              {t('team.upload.folder')}
            </span>
            <span className="upload__hint">{t('team.upload.folderHint')}</span>
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
              {t('team.upload.files')}
            </span>
            <span className="upload__hint">{t('team.upload.filesHint')}</span>
          </label>
          <p className="muted">{t('team.upload.accepts')}</p>
          <p className="muted">{t('team.upload.pipeline')}</p>

          <div className="slot">
            <span className="slot__name">{board?.slot.name ?? t('common.unnamed')}</span>
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
            <h2>{t('team.files.title')}</h2>
            <span className="muted num">{t('team.files.count', { n: board?.files.length ?? 0 })}</span>
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
            <p className="muted">{t('team.files.empty')}</p>
          )}

          {preview && (
            <div data-testid="team-source">
              <div className="panel__title">
                <h2>{preview.path}</h2>
                <span className="muted">{t('common.readonly')}</span>
              </div>
              {preview.binary ? (
                <p className="muted" data-testid="team-source-binary">
                  {t('team.source.binary')}
                </p>
              ) : (
                <>
                  <pre className="source-view">{preview.text}</pre>
                  {preview.truncated ? (
                    <p className="muted" data-testid="team-source-truncated">
                      {t('team.source.truncated')}
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
            <h2>{t('team.emitter.title')}</h2>
            <span className={`tag ${locked ? 'tag--live' : ''}`}>
              {locked
                ? t('team.emitter.locked')
                : selectedId
                  ? t('team.emitter.selected')
                  : t('team.emitter.none')}
            </span>
          </div>

          <p className="muted">{t('team.emitter.desc')}</p>

          {board && board.candidates.length > 0 ? (
            <>
              {/* 先选、后锁 —— 顺序就是操作顺序。此前锁定按钮排在候选列表**上面**，
                  等于让人先看到一个还点不动的按钮。 */}
              <p className="step-caption" data-testid="team-select-caption">
                <span className="steps__no">3</span> {t('team.emitter.pickCaption')}
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
                        title={actionHint(selectAction)}
                        onClick={() =>
                          void run(
                            TEAM_PATHS.selectEmitter,
                            { team, pointId: c.id },
                            t('team.note.selected', { id: c.id })
                          )
                        }
                      >
                        ({c.x.toFixed(1)}, {c.y.toFixed(1)})
                        {isSel ? `  ${t('team.candidate.selectedMark')}` : ''}
                      </button>
                      <span className="num muted">
                        {c.alive ? t('team.candidate.alive') : t('team.candidate.dead')}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="step-caption">
                <span className="steps__no">4</span> {t('team.emitter.lockCaption')}
              </p>
              <div className="actions">
                {/* 本页此刻唯一该做的事 —— 用主操作样式，别和次要控件长一个样。
                    禁用时它会退回普通 .btn 的样子，「还不能点」一眼可见。 */}
                <button
                  className="btn btn--primary"
                  data-testid="team-lock"
                  data-action={lockAction?.key}
                  disabled={!lockAction?.enabled || busy}
                  title={actionHint(lockAction)}
                  onClick={() =>
                    void run(TEAM_PATHS.lockEmitter, { team }, t('team.note.locked'))
                  }
                >
                  {t('team.emitter.lockButton')}
                </button>
                <span className="muted" data-testid="team-lock-hint">
                  {actionHint(lockAction)}
                </span>
              </div>
            </>
          ) : (
            <p className="muted">{t('team.emitter.waiting')}</p>
          )}

          <div className="panel__title">
            <h2>{t('team.emitter.revealedTitle')}</h2>
            <span className="muted">
              {board?.revealed ? t('team.emitter.public') : t('team.emitter.hidden')}
            </span>
          </div>
          {board?.revealed && board.emitters ? (
            <p className="num" data-testid="team-emitters">
              A = {board.emitters.A.id}（{board.emitters.A.x.toFixed(1)}, {board.emitters.A.y.toFixed(1)}）
              {'　'}B = {board.emitters.B.id}（{board.emitters.B.x.toFixed(1)},{' '}
              {board.emitters.B.y.toFixed(1)}）
            </p>
          ) : (
            <p className="muted" data-testid="team-emitters-hidden">
              {t('team.emitter.hiddenBody', {
                state: board?.opponent.locked
                  ? t('team.emitter.opponentLocked')
                  : t('team.emitter.opponentUnlocked'),
              })}
            </p>
          )}
        </section>

        {/* ---- 3. 场面（只读） ---- */}
        {board && board.candidates.length > 0 && (
          <section className={`panel ${roleClass}`}>
            <div className="panel__title">
              <h2>{t('team.arena.title')}</h2>
              <span className="muted">{t('common.readonly')}</span>
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
                  void run(
                    TEAM_PATHS.selectEmitter,
                    { team, pointId: id },
                    t('team.note.selected', { id })
                  );
                }}
              />
            </div>
            <p className="muted">{t('team.arena.hint')}</p>
          </section>
        )}
      </main>
    </div>
  );
}
