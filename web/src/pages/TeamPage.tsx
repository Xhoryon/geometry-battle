/**
 * 参赛者页（V1.4）—— `/team/a` 与 `/team/b`
 *
 * 四个区块：**算法包** / **源码** / **Emitter** / **状态**。
 * 六步：上传 → 校验 → Preflight → 选择 → 锁定 → 等待开赛
 *（每一步的完成判据全部来自服务端事实，见 `teamSteps.ts`；页面不另算一套进度）。
 *
 * 两条纪律（自 V1.2 起不变）：
 *   - **可用性只来自服务端**：每个按钮的 `disabled` 读 `board.actions[].enabled`（再与 busy 求与），
 *     页面里不按阶段名判断可点性 —— 阶段名只决定**展示哪一段**。
 *   - **看不到对手的东西**：`TeamBoard` 是服务端按队别裁剪过的白名单投影，
 *     对方的槽位、源码、锁定前的 Emitter 选择都不在载荷里。
 *
 * 错误分层（V1.4）：算法包的错误（浏览器解包 / 上传被拒 / 槽位无效）贴在上传控件下面；
 * 锚点命令的失败贴在锁定按钮旁边；源码读取失败贴在文件清单下面；令牌 / 连接问题由
 * `AccessNotice` / `ConnectionTag` 说；服务端后台推进失败放在状态区块。成功提示走同一个
 * 组件的 success 层级 —— 此前成功也借红色的 `.errors`。
 *
 * 本页**不渲染**任何服务端绝对路径（`SlotView.dir` / `source` 不读）。
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
import type { ActionView, ArenaView, TeamBoard } from '../../../src/server/protocol';
import { AccessNotice } from '../components/AccessNotice';
import { AppShell } from '../components/AppShell';
import { ConnectionTag, pendingBodyKey } from '../components/ConnectionTag';
import { ErrorNotice } from '../components/ErrorNotice';
import type { NoticeScope, NoticeSeverity } from '../components/ErrorNotice';
import { PreflightBadge, preflightState } from '../components/PreflightBadge';
import { PrimaryAction } from '../components/PrimaryAction';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import type { Status } from '../components/StatusBadge';
import { StatusLine } from '../components/StatusLine';
import { TeamLabel } from '../components/TeamLabel';
import { PHASE_KEYS, slotStatusLabel } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import {
  STEP_STATE_GLYPH,
  STEP_STATE_KEYS,
  TEAM_STEPS,
  TEAM_STEP_KEYS,
  factsOf,
  nextHint,
  stepStates,
} from './teamSteps';

function actionOf(board: TeamBoard | null, key: string): ActionView | null {
  return board?.actions.find((a) => a.key === key) ?? null;
}

/** 哈希只给人眼对前 12 位 —— 全量哈希对不了人眼，源码预览才是核对手段 */
const SHORT_HASH = 12;
const shortHash = (h: string): string => `${h.slice(0, SHORT_HASH)}…`;

/** 坐标一律一位小数、等宽（`.num` 由外层给） */
const xy = (x: number, y: number): string => `(${x.toFixed(1)}, ${y.toFixed(1)})`;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 参赛者板不带场地尺寸（它只给本队的候选点），画布用冻结规则里的场地：
 * x ∈ [−20, 20]、y ∈ [−12, 12]。障碍物在揭晓前不公开，这里恒为空。
 */
const FIELD: ArenaView['field'] = { xMin: -20, xMax: 20, yMin: -12, yMax: 12 };
const NO_OBSTACLES: ArenaView['obstacles'] = [];
const NO_LOCKED: readonly string[] = [];

/**
 * 一次本地操作的结果提示。**同一时刻只有一条**，并且渲染在它所属的区块里 ——
 * 算法包的贴在上传控件下，锚点命令的贴在锁定按钮旁，源码读取的贴在文件清单下。
 * 演练读的是 `team-errors` / `team-notes` 这两个 testid，因此按层级而不是按区块命名。
 */
interface LocalNotice {
  where: 'package' | 'emitter' | 'source';
  severity: Extract<NoticeSeverity, 'error' | 'success'>;
  lines: string[];
}
const NOTICE_SCOPE: Record<LocalNotice['where'], NoticeScope> = {
  package: 'package',
  emitter: 'participant',
  source: 'participant',
};

interface Preview {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
}

export function TeamPage({ team }: { team: 'A' | 'B' }): JSX.Element {
  const { t, td, locale } = useI18n();
  const topic = team === 'A' ? 'team-a' : 'team-b';
  const { board, access, status, retries } = useBoard<TeamBoard>(topic);

  // 服务端给稳定键、客户端翻译（与 JudgePage 的 actionHint 同一套）。
  // `a.hint` 是服务端的**中文原文**，只在认不出键时兜底 —— 直接渲染它
  // 会让英文界面里冒出一整句中文，正是 i18n 回归里点名的「混合语言」事故。
  const actionHint = useCallback(
    (a: ActionView | null): string => (a ? td(a.hintKey, a.hintParams, a.hint) : ''),
    [td]
  );
  const actionLabel = useCallback(
    (a: ActionView): string => td(a.labelKey, a.labelParams, a.label),
    [td]
  );

  // ---- 本地交互状态（服务端没有的：正在跑的请求、上传中、提示、源码预览）----
  const [busyLocal, setBusyLocal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<LocalNotice | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = busyLocal || Boolean(board?.busy);

  /** 统一的命令入口：本地防连点 → 发命令 → 把服务端的原话显示在锚点区块里 */
  const run = useCallback(
    async (path: string, body: Record<string, unknown>, okNote: string) => {
      setBusyLocal(true);
      setNotice(null);
      const r = await command(path, body);
      if (!r.ok) {
        setNotice({
          where: 'emitter',
          severity: 'error',
          lines: r.errors.length ? r.errors : [t('team.err.commandFailed')],
        });
      } else {
        setNotice({ where: 'emitter', severity: 'success', lines: [okNote] });
      }
      setBusyLocal(false);
    },
    [t]
  );

  const onUpload = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      setBusyLocal(true);
      setUploading(true);
      setNotice(null);
      try {
        const { files, errors: packErrors } = await filesToUploadPayload(list);
        if (packErrors.length > 0) {
          // 浏览器侧就失败了（解包 / 读文件）：一个字节都没发出去，槽位不受影响
          setNotice({ where: 'package', severity: 'error', lines: packErrors });
          return;
        }
        const r = await command(TEAM_PATHS.upload, { team, files });
        if (!r.ok) {
          setNotice({
            where: 'package',
            severity: 'error',
            lines: r.errors.length ? r.errors : [t('team.err.uploadFailed')],
          });
          return;
        }
        const hash = typeof r.detail?.hash === 'string' ? String(r.detail.hash).slice(0, SHORT_HASH) : null;
        setNotice({
          where: 'package',
          severity: 'success',
          lines: [
            hash
              ? t('team.note.installedWithHash', { n: files.length, hash })
              : t('team.note.installed', { n: files.length }),
          ],
        });
        // 换了包，上一份的源码预览就过期了
        setPreview(null);
      } finally {
        setBusyLocal(false);
        setUploading(false);
        // 清掉原生 input 的选择，否则再选同一批文件不会触发 change
        if (dirInputRef.current) dirInputRef.current.value = '';
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [team, t]
  );

  const onOpenSource = useCallback(
    async (relPath: string) => {
      const r = await fetchTeamSource(team, relPath);
      if (!r.ok) {
        setNotice({
          where: 'source',
          severity: 'error',
          lines: r.errors.length ? r.errors : [t('team.err.readFailed')],
        });
        return;
      }
      setPreview({
        path: relPath,
        text: r.text ?? '',
        truncated: Boolean(r.truncated),
        binary: Boolean(r.binary),
      });
    },
    [team, t]
  );

  const selectAction = actionOf(board, 'select-emitter');
  const lockAction = actionOf(board, 'lock-emitter');
  const canSelect = Boolean(selectAction?.enabled) && !busy;

  const selectedId = board?.own.selected ?? null;
  const locked = board?.own.locked ?? false;

  const onPick = useCallback(
    (id: string) => {
      // 画布点击与列表按钮走同一条命令；可用性仍由服务端的 enabled 说了算
      if (!canSelect) return;
      void run(TEAM_PATHS.selectEmitter, { team, pointId: id }, t('team.note.selected', { id }));
    },
    [canSelect, run, team, t]
  );
  const onLock = useCallback(() => {
    void run(TEAM_PATHS.lockEmitter, { team }, t('team.note.locked'));
  }, [run, team, t]);

  // ---- 展示模型：六步 + 「下一步」，全部由服务端事实推出（teamSteps.ts） ----
  const facts = useMemo(() => (board ? factsOf(board) : null), [board]);
  const steps = useMemo(() => (facts ? stepStates(facts) : null), [facts]);
  const hint = useMemo(() => (facts ? nextHint(facts) : null), [facts]);

  /*
    竞技场的 `arena` 对象按**内容**记忆，而不是按 board 引用：board 每 100ms 一条、
    每条都是新对象，但候选点与锚点在一个阶段里几乎不变。键是把有关字段拼成的字符串，
    相等即内容相等 —— 画布因此拿到稳定的 prop 引用。
  */
  const candidates = board?.candidates;
  const emitters = board?.emitters ?? null;
  const candKey = candidates ? candidates.map((c) => `${c.id}:${c.x}:${c.y}:${c.alive ? 1 : 0}`).join('|') : '';
  const emKey = emitters
    ? `${emitters.A.id}:${emitters.A.x}:${emitters.A.y}|${emitters.B.id}:${emitters.B.x}:${emitters.B.y}`
    : '';
  const arena = useMemo<ArenaView>(
    () => ({
      field: FIELD,
      obstacles: NO_OBSTACLES,
      emitters: emitters
        ? {
            A: { id: emitters.A.id, position: { x: emitters.A.x, y: emitters.A.y } },
            B: { id: emitters.B.id, position: { x: emitters.B.x, y: emitters.B.y } },
          }
        : null,
      points: (candidates ?? []).map((c) => ({
        id: c.id,
        team,
        position: { x: c.x, y: c.y },
        alive: c.alive,
      })),
    }),
    // 依赖是内容键；candidates / emitters 本身在键相等时内容也相等
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candKey, emKey, team]
  );
  const lockedIds = useMemo<readonly string[]>(
    () => (locked && selectedId ? [selectedId] : NO_LOCKED),
    [locked, selectedId]
  );
  /**
   * 本队锚点的坐标：锁定期间它还在候选表里；开赛后 Emitter 会从战斗点表移除，
   * 这时只能从双方公开的锚点（`board.emitters`）里取 —— 两处都是服务端给的坐标。
   */
  const ownEmitter = useMemo(
    () => {
      const c = candidates?.find((x) => x.id === selectedId);
      if (c) return { x: c.x, y: c.y };
      const e = emitters?.[team];
      return e && e.id === selectedId ? { x: e.x, y: e.y } : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candKey, emKey, selectedId, team]
  );

  useEffect(() => {
    // 板子换代（换比赛）时清掉上一场的提示，避免旧红字粘着不放
    setNotice(null);
  }, [board?.matchId]);

  const connection = <ConnectionTag status={status} retries={retries} testId="conn" />;
  const eyebrow = t('team.title', { team });

  /*
    `data-board` 是**权威 board 是否已到达**的机器可读标记（演练等它变 ready 再读文案）。
    `connected` 只说明 WS 在线；首帧 board 是随后一条消息 —— 这中间有一段窗口，
    页面此时不渲染兜底值，只说「已连接，等待比赛状态」（措辞由连接状态决定）。
  */
  if (!board || !facts || !steps || !hint) {
    return (
      <AppShell role="team" eyebrow={eyebrow} nav="team" connection={connection}>
        <div className="gate" data-testid="team" data-board="pending" data-team={team}>
          <p className="empty">{t(pendingBodyKey(status))}</p>
          <AccessNotice access={access} testId="team-access" />
        </div>
      </AppShell>
    );
  }

  const roleClass = team === 'A' ? 'panel--a' : 'panel--b';
  const slot = board.slot;
  const hasPackage = slot.status !== 'EMPTY';
  const slotTone: Status = slot.status === 'READY' ? 'ready' : slot.status === 'INVALID' ? 'error' : 'neutral';
  const emitterState = locked ? 'locked' : selectedId ? 'selected' : board.candidates.length > 0 ? 'pick' : 'waiting';

  const renderNotice = (n: LocalNotice | null, where: LocalNotice['where']): JSX.Element | null =>
    n && n.where === where ? (
      <ErrorNotice
        scope={NOTICE_SCOPE[n.where]}
        severity={n.severity}
        title={n.lines[0]}
        body={n.lines.length > 1 ? n.lines.slice(1) : undefined}
        testId={n.severity === 'error' ? 'team-errors' : 'team-notes'}
      />
    ) : null;

  return (
    <AppShell
      role="team"
      eyebrow={eyebrow}
      // 参赛者页不出现裁判台入口：参赛者不该被引向裁判特权面
      nav="team"
      meta={
        <>
          <span className="num muted" data-testid="team-match-id">MATCH {board.matchId}</span>
          {/* 引擎的原始阶段名是机器标识，不翻译；翻译后的说法在状态区块 */}
          <span className="eyebrow" data-testid="team-phase-raw">{board.phase}</span>
        </>
      }
      connection={connection}
    >
      <div
        className="team"
        data-testid="team"
        data-board="ready"
        data-team={team}
        data-phase={board.phase}
        data-locked={locked ? 'true' : 'false'}
      >
        {/* ================= 状态 ================= */}
        <aside className="team__side" data-testid="team-status">
          {/* 令牌问题**先于**其它内容显示：它是「这一页根本不该由你打开」，不是某次操作失败 */}
          <AccessNotice access={access} testId="team-access" />

          <section className="panel">
            <SectionHeader
              title={t('team.section.status')}
              meta={
                <span data-testid="team-phase">
                  {t('team.phase', { label: t(PHASE_KEYS[board.phase]) })}
                </span>
              }
            />

            {/* 六步进度：状态用 data-state + 字形 + 文字三重表达，不只靠颜色 */}
            <ol className="tsteps" data-testid="team-steps">
              {TEAM_STEPS.map((s, i) => {
                const st = steps[s];
                return (
                  <li
                    key={s}
                    data-step={s}
                    data-state={st}
                    aria-current={st === 'now' || st === 'error' ? 'step' : undefined}
                  >
                    <span className="steps__no">{i + 1}</span>
                    <span className="tsteps__label">{t(TEAM_STEP_KEYS[s])}</span>
                    <span className="tsteps__state">
                      <span aria-hidden="true">{STEP_STATE_GLYPH[st]}</span> {t(STEP_STATE_KEYS[st])}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="statgrid">
              <StatusLine label={t('team.status.round')} value={pad2(board.round)} />
              <StatusLine
                label={t('team.status.opponent')}
                value={
                  <StatusBadge status={board.opponent.locked ? 'ready' : 'waiting'} testId="team-opponent">
                    {board.opponent.locked ? t('team.status.opponentLocked') : t('team.status.opponentUnlocked')}
                  </StatusBadge>
                }
              />
            </div>

            {/* 下一步：一句话说清「该做什么 / 在等谁」；`data-next` 是它的机器标识 */}
            <div className="subpanel" data-testid="team-next" data-next={hint.key.slice('team.next.'.length)}>
              <SectionHeader title={t('team.next.title')} />
              <p className="subpanel__text">{t(hint.key, hint.params)}</p>
              {hint.replay ? (
                <p className="subpanel__text">
                  <a className="link" href={`/replay/${encodeURIComponent(board.matchId)}`}>
                    {t('nav.replay')}
                  </a>
                </p>
              ) : null}
            </div>

            {/* 连接不在实时态时，把标签上那一句在这里也说一遍 —— 板上的值此刻可能是旧的 */}
            {status !== 'live' ? (
              <p className="dim" data-testid="team-conn-body">
                {t(pendingBodyKey(status))}
              </p>
            ) : null}
            {board.tournamentMode === false ? <p className="dim">{t('team.devMode')}</p> : null}

            {board.lastError ? (
              <ErrorNotice
                scope="server"
                severity="warning"
                title={t('team.serverError.title')}
                body={board.lastError}
                testId="team-server-error"
              />
            ) : null}
          </section>
        </aside>

        <main className="team__main">
          {/* 左列：算法包 → 源码（上传、再看源码是一条顺序）；右列：Emitter */}
          <div className="team__col">
          {/* ================= 算法包 ================= */}
          <section
            className={`panel team__block team__block--algo ${roleClass}`}
            data-testid="team-package"
            data-state={board.packageReady ? 'ready' : 'pending'}
            data-slot-status={slot.status}
            data-preflight={preflightState(slot.preflightOk)}
          >
            <SectionHeader
              title={t('team.package.title')}
              meta={
                // 演练对这个区块断言「恰好一个 .tag」并读它的全文 —— 区块内其它状态都用 .badge
                <span className={`tag${board.packageReady ? ' tag--live' : ''}`} data-state={board.packageReady ? 'ready' : 'pending'}>
                  {board.packageReady ? t('team.package.ready') : t('team.package.notReady')}
                </span>
              }
            />

            {/* 包的身份行：名字 / 哈希 / 结构校验 / Preflight / 文件数 / 入口。没有目录路径。 */}
            {hasPackage ? (
              <div className="pkg" data-testid="team-package-identity">
                <span className="slot__name" title={t('judge.teamCard.nameTitle')}>
                  {slot.name ?? t('common.unnamed')}
                </span>
                <dl className="teamcard__stats">
                  <div>
                    <dt>{t('team.package.hash')}</dt>
                    <dd className="num">{slot.hash ? shortHash(slot.hash) : '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('team.package.validation')}</dt>
                    <dd>
                      <StatusBadge status={slotTone}>{slotStatusLabel(locale, slot.status)}</StatusBadge>
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
                    <dt>{t('team.package.files')}</dt>
                    <dd className="num">{slot.files}</dd>
                  </div>
                  {slot.entry ? (
                    <div>
                      <dt>{t('team.package.entry')}</dt>
                      <dd className="num">{slot.entry}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}

            {/* 槽位无效：服务端的校验结论，贴在身份行下面；下一步就是重新上传（控件就在下方） */}
            {slot.errors.length > 0 ? (
              <ErrorNotice
                scope="package"
                severity="error"
                title={t('team.package.invalidTitle')}
                body={slot.errors.slice(0, 4)}
                testId="team-slot-errors"
              >
                <p className="notice__body">{t('team.package.invalidNext')}</p>
              </ErrorNotice>
            ) : null}

            <p className="step-caption">
              <span className="steps__no">1</span>{' '}
              {hasPackage ? t('team.upload.replaceTitle') : t('team.upload.title')}
            </p>
            {hasPackage ? <p className="panel__lead">{t('team.upload.replaceImpact')}</p> : null}

            {/*
              两种来源各给一个入口（目录 / 文件与 ZIP）。原生 `<input type=file>` 的按钮部件在
              Chrome 里几乎无法彻底换皮，所以用**包裹 label + 视觉隐藏的原生 input**：
              真正接到浏览器文件选择器（以及自动化的 setInputFiles）的仍是那个 input。
              目录入口用 `webkitdirectory`，浏览器会带上 `webkitRelativePath`，
              `filesToUploadPayload` 会剥掉公共的最外层目录名；单个 `.zip` 在浏览器里展开。
              三条路最终都只是「路径 + 字节」，走服务端同一条安装流水线。
            */}
            <div className="uploadrow">
              <label className={`upload${busy ? ' upload--busy' : ''}`}>
                <input
                  ref={dirInputRef}
                  type="file"
                  multiple
                  data-testid="team-upload-dir"
                  disabled={busy}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...({ webkitdirectory: '' } as any)}
                  onChange={(e) => void onUpload(e.target.files)}
                />
                <span className="upload__btn">{t('team.upload.folder')}</span>
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
                <span className="upload__btn">{t('team.upload.files')}</span>
                <span className="upload__hint">{t('team.upload.filesHint')}</span>
              </label>
            </div>

            {uploading ? (
              <p className="uploadbusy" role="status" data-testid="team-upload-busy">
                <StatusBadge status="active">{t('team.upload.busy')}</StatusBadge>
              </p>
            ) : null}

            {/* 上传的结果贴在控件正下方：解包失败 / 被拒 → error；已安装 → success（不再借红色） */}
            {renderNotice(notice, 'package')}

            <p className="dim fineprint">
              {t('team.upload.accepts')} {t('team.upload.pipeline')}
            </p>
          </section>

          {/* ================= 源码 ================= */}
          <section className={`panel team__block team__block--source ${roleClass}`} data-testid="team-source-block">
            <SectionHeader
              title={t('team.section.source')}
              meta={
                <span>
                  {t('team.files.title')} {t('team.files.count', { n: board.files.length })} · {t('common.readonly')}
                </span>
              }
            />
            {board.files.length > 0 ? (
              <>
                <p className="panel__lead">{t('team.source.pickHint')}</p>
                <ul className="audit-list filelist">
                  {board.files.map((f) => (
                    <li key={f.path}>
                      <span className="num">{f.bytes}</span>
                      {/* 演练读这个按钮的全文当作路径 —— 里面只放路径 */}
                      <button
                        type="button"
                        className="link"
                        data-testid="team-file"
                        aria-pressed={preview?.path === f.path}
                        onClick={() => void onOpenSource(f.path)}
                      >
                        {f.path}
                      </button>
                      <span />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">{t('team.files.empty')}</p>
            )}

            {renderNotice(notice, 'source')}

            {preview ? (
              <div className="preview" data-testid="team-source">
                <SectionHeader
                  className="subhead"
                  title={<span className="num">{preview.path}</span>}
                  meta={t('common.readonly')}
                />
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
            ) : null}
          </section>
          </div>

          {/* ================= Emitter ================= */}
          <section
            className={`panel team__block team__block--emitter ${roleClass}`}
            data-testid="team-emitter"
            data-locked={locked ? 'true' : 'false'}
            data-state={emitterState}
          >
            <SectionHeader
              title={t('team.emitter.title')}
              meta={
                // 同上：这个区块也只有这一个 .tag，演练读它的全文
                <span className={`tag${locked ? ' tag--live' : ''}`} data-state={emitterState}>
                  {locked
                    ? t('team.emitter.locked')
                    : selectedId
                      ? t('team.emitter.selected')
                      : t('team.emitter.none')}
                </span>
              }
            />

            {locked ? (
              /* 锁定后：LOCKED 徽章 + 本队锚点 + 「本场不可更改」—— 不可变要一眼看出来 */
              <div className="lockbox" data-testid="team-locked">
                <StatusBadge status="terminal" testId="team-locked-badge">
                  {t('team.emitter.lockedBadge')}
                </StatusBadge>
                <span className="lockbox__id num" data-testid="team-locked-id">
                  {t('team.emitter.yours')} {selectedId}
                  {ownEmitter ? ` ${xy(ownEmitter.x, ownEmitter.y)}` : ''}
                </span>
                <span className="lockbox__note">{t('team.emitter.immutable')}</span>
              </div>
            ) : (
              <p className="panel__lead">{t('team.emitter.desc')}</p>
            )}

            {board.candidates.length > 0 ? (
              <>
                {/* 先选、后锁 —— 顺序就是操作顺序 */}
                <p className="step-caption" data-testid="team-select-caption">
                  <span className="steps__no">4</span> {t('team.emitter.pickCaption')}
                </p>
                <ul className="cands" data-testid="team-candidates">
                  {board.candidates.map((c) => {
                    const isSel = selectedId === c.id;
                    const cls = `cand${isSel ? ' cand--selected' : ''}${locked && isSel ? ' cand--locked' : ''}`;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={cls}
                          data-testid="team-candidate"
                          data-candidate={c.id}
                          data-selected={isSel ? 'true' : 'false'}
                          aria-pressed={isSel}
                          disabled={!canSelect}
                          title={actionHint(selectAction)}
                          onClick={() => onPick(c.id)}
                        >
                          <span className="cand__id num">{c.id}</span>
                          <span className="cand__xy num">{xy(c.x, c.y)}</span>
                          <span className="cand__state">
                            {isSel
                              ? t('team.candidate.selectedMark')
                              : c.alive
                                ? t('team.candidate.alive')
                                : t('team.candidate.dead')}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* 点不动时把服务端的原因印出来（不只藏在 title 里）；锁定后原因已由上面的 LOCKED 块说了 */}
                {!locked && !selectAction?.enabled ? (
                  <p className="dim" data-testid="team-select-why">
                    {actionHint(selectAction)}
                  </p>
                ) : null}

                <p className="step-caption">
                  <span className="steps__no">5</span> {t('team.emitter.lockCaption')}
                </p>
                {/*
                  本页此刻唯一该做的事。可用性只读服务端 `enabled`；不可点的原因印在按钮下面
                  （`team-lock-hint`）。**不开快捷键**：锁定不可撤销，不该被一次误触完成。
                */}
                <PrimaryAction
                  actionKey="lock-emitter"
                  label={lockAction ? actionLabel(lockAction) : t('team.emitter.lockButton')}
                  enabled={Boolean(lockAction?.enabled)}
                  busy={busy}
                  why={actionHint(lockAction)}
                  onClick={onLock}
                  testId="team-lock"
                  whyTestId="team-lock-hint"
                />
                {renderNotice(notice, 'emitter')}

                {/*
                  场面：点直接点选（§五）。画布只是**展示**——真正的选择走 select-emitter 命令，
                  可用性仍由服务端判定。这里不画障碍物（那是 REVEAL 阶段才公开的隐藏信息）。
                */}
                <SectionHeader
                  className="subhead"
                  title={t('team.arena.title')}
                  meta={t('team.arena.note')}
                />
                <div className="team__arena">
                  <ArenaCanvas
                    arena={arena}
                    trajectory={null}
                    ticks
                    interactive={canSelect}
                    selectedId={selectedId}
                    lockedIds={lockedIds}
                    onSelectPoint={onPick}
                  />
                </div>
                {canSelect ? <p className="dim fineprint">{t('team.arena.hint')}</p> : null}
              </>
            ) : (
              <p className="muted waitline" data-testid="team-emitter-waiting">
                <StatusBadge status="waiting" /> {t('team.emitter.waiting')}
              </p>
            )}

            <SectionHeader
              className="subhead"
              title={t('team.emitter.revealedTitle')}
              meta={board.revealed ? t('team.emitter.public') : t('team.emitter.hidden')}
            />
            {board.revealed && board.emitters ? (
              <div className="statgrid" data-testid="team-emitters">
                <StatusLine label={<TeamLabel team="A" />} value={`${board.emitters.A.id} ${xy(board.emitters.A.x, board.emitters.A.y)}`} />
                <StatusLine label={<TeamLabel team="B" />} value={`${board.emitters.B.id} ${xy(board.emitters.B.x, board.emitters.B.y)}`} />
              </div>
            ) : (
              <p className="muted" data-testid="team-emitters-hidden">
                {t('team.emitter.hiddenBody', {
                  state: board.opponent.locked
                    ? t('team.emitter.opponentLocked')
                    : t('team.emitter.opponentUnlocked'),
                })}
              </p>
            )}
          </section>
        </main>
      </div>
    </AppShell>
  );
}
