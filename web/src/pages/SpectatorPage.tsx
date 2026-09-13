/**
 * 观众大屏 —— 只读。
 *
 * 这一屏**没有**任何命令按钮，也不显示任何开发者诊断：
 * 没有哈希、没有文件路径、没有 JSON、没有审计、没有控制台。
 *
 * 这条保证不是靠这一页「记得别渲染」——它靠的是服务端根本不发那些字段
 * （观众板是白名单投影，恰好十个顶层键）。这一页能画的，就是它能收到的。
 *
 * 版面（V1.4）—— 一块记分牌：
 *
 *   头部    Team A 存活 · 锚点 | 回合 · 阶段 | Team B 存活 · 锚点
 *   终局带  TEAM X WINS · 原因 · ROUND N        —— 只在终局出现，是**独立的一条横带**，
 *                                                  不压在竞技场上：最后一帧必须完整可见
 *   舞台    竞技场（引擎轨迹）
 *   底部    A 计算 | 先手 | B 计算，其下一行本轮说明（攻击 / 击杀，或本轮算法异常）
 *
 * 外壳用 `nav="none"`：除语言开关外不得有任何按钮，导航也一并省掉（演练钉死：
 * 命令控件为零、除语言开关外的按钮为零）。
 *
 * 性能：board 每 100ms 一条，但一轮之内竞技场几乎不变 —— 画布拿到的是按**内容键**
 * memo 过的稳定引用，只有内容真的变了才重画。
 */

import { memo, useMemo } from 'react';
import { ArenaCanvas } from '../arena/ArenaCanvas';
import { AppShell } from '../components/AppShell';
import { ComputeStatus } from '../components/ComputeStatus';
import { ConnectionTag, pendingBodyKey } from '../components/ConnectionTag';
import { useBoard, useTrajectory } from '../api/client';
import { endReasonLabel, firstSolverLabel, localizeRoundErrors, winnerLabel } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
import { arenaKey, bannerKey, coordText, firstTone } from './spectatorView';
import type { ArenaView, SpectatorBoard, TrajectoryPayload } from '../../../src/server/protocol';
import type { JSX } from 'react';

const NO_KILLED: readonly string[] = [];

/** 舞台：只在 arena / trajectory / killed 的**引用**变化时重渲染（三者都已按内容 memo） */
const Stage = memo(function Stage({
  arena,
  trajectory,
  killed,
}: {
  arena: ArenaView;
  trajectory: TrajectoryPayload | null;
  killed: readonly string[];
}): JSX.Element {
  return <ArenaCanvas arena={arena} trajectory={trajectory} killed={killed} />;
});

/** 头部两侧：色点 + 「Team X 存活」+ 大数 + 本场锚点 */
function TeamSide({
  team,
  alive,
  emitter,
}: {
  team: 'A' | 'B';
  alive: number;
  emitter: { id: string; position: { x: number; y: number } } | null;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="screen__team" data-team={team} data-testid={`spectator-team-${team}`}>
      <div className="screen__alive">
        <span className="screen__count num" data-testid={`spectator-alive-${team}`}>
          {alive}
        </span>
        <span className="screen__caption">
          <span className={`team-dot team-dot--${team.toLowerCase()}`} aria-hidden="true" />
          {t('spectator.alive', { team })}
        </span>
      </div>
      {/*
        本场的开火点（V1.2 §一）。「双方都锁定」之前引擎根本不下发这两个坐标
        （`emitters: null`），所以这里不是「前端记得别显示」—— 是收不到。
      */}
      <div
        className="screen__emitter"
        data-testid={`spectator-emitter-${team}`}
        data-emitter={emitter ? emitter.id : ''}
      >
        <span className="screen__caption">{t('spectator.emitter')}</span>
        <span className="num">
          {emitter ? `${emitter.id} ${coordText(emitter.position)}` : t('spectator.emitterPending')}
        </span>
      </div>
    </div>
  );
}

export function SpectatorPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { board, status, retries } = useBoard<SpectatorBoard>('spectator');
  const trajectory = useTrajectory(board?.trajectoryHandle ?? null);

  // 内容键 memo：board 每条都是新对象，但一轮之内 arena / killed 几乎不变
  const key = board ? arenaKey(board.arena) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const arena = useMemo<ArenaView | null>(() => board?.arena ?? null, [key]);
  const killedKey = board?.lastRound?.killed.join(',') ?? '';
  const killed = useMemo<readonly string[]>(
    () => (killedKey ? killedKey.split(',') : NO_KILLED),
    [killedKey]
  );

  const shellProps = {
    role: 'spectator' as const,
    eyebrow: t('nav.spectator'),
    nav: 'none' as const,
    connection: <ConnectionTag status={status} retries={retries} />,
  };

  if (!board || !arena) {
    // 没拿到 board 之前不渲染任何兜底数值 —— 只说清楚现在是「连接中 / 已连接等状态 / 服务不可达」
    return (
      <AppShell {...shellProps}>
        <div className="gate" data-testid="spectator-pending" data-board="pending" data-connection={status}>
          <p className="empty">{t(pendingBodyKey(status))}</p>
        </div>
      </AppShell>
    );
  }

  const first = board.lastRound?.firstSolver;
  const roundErrors = board.lastRound?.errors ?? [];

  /**
   * 底部那一行说明：本轮算法异常（TIMEOUT / CRASH…）优先 —— 它解释了为什么这一轮
   * 少了一条轨迹；否则是本轮攻击 / 击杀；还没打过就复述阶段。
   * 错误由服务端给**键**，这里按当前语言取译文（V1.3）；认不出键时回退到它给的原文，
   * 绝不把键本身渲染到大屏上。
   */
  const note = ((): string => {
    if (roundErrors.length) {
      return localizeRoundErrors(
        locale,
        roundErrors,
        board.lastRound?.errorKeys,
        board.lastRound?.errorParams
      ).join('   ');
    }
    if (board.lastRound) {
      const atk = board.lastRound.attacksExecuted;
      return t('spectator.note.attacks', {
        attacks: atk.length ? `[${atk.join(' → ')}]` : t('spectator.note.noAttacks'),
        kills: killed.length ? killed.join(',') : t('common.none'),
      });
    }
    return t(bannerKey(board.phase, board.round));
  })();

  return (
    <AppShell {...shellProps} meta={<span className="num muted">{board.matchId}</span>}>
      <div
        className="screen"
        data-testid="spectator"
        data-board="ready"
        data-phase={board.phase}
        data-round={board.round}
        data-terminal={board.verdict ? 'true' : 'false'}
      >
        <header className="screen__head">
          <TeamSide team="A" alive={board.alive.A} emitter={board.arena.emitters?.A ?? null} />

          {/* 中央：回合大数 + 阶段一句话 —— 走进来的人一眼就知道现在是什么状态 */}
          <div className="screen__center" data-testid="spectator-round" data-round={board.round}>
            <span className="screen__caption">{t('spectator.round')}</span>
            <span className="screen__count screen__count--round num">{String(board.round).padStart(2, '0')}</span>
            <span className="screen__phase" data-testid="spectator-status" data-phase={board.phase}>
              {t(bannerKey(board.phase, board.round))}
            </span>
          </div>

          <TeamSide team="B" alive={board.alive.B} emitter={board.arena.emitters?.B ?? null} />
        </header>

        {/*
          终局带：独立的一行，不是压在竞技场上的遮罩 —— 判决出来之后最后一帧
          （谁打中了谁）仍然整张可见。颜色只是补充：文字、`data-winner`、
          `data-end-reason` 都在。
        */}
        {board.verdict ? (
          <div
            className="screen__verdict"
            role="status"
            data-testid="spectator-verdict"
            data-winner={board.verdict.winner}
            data-end-reason={board.verdict.endReason}
            data-round={board.round}
          >
            <span className="screen__winner">{winnerLabel(locale, board.verdict.winner)}</span>
            {/* 分隔点是真实文本：读屏与 innerText 读到的是一句话，不是三个词粘在一起 */}
            <span className="screen__reason" aria-hidden="true">
              ·
            </span>
            <span className="screen__reason">{endReasonLabel(locale, board.verdict.endReason)}</span>
            <span className="screen__reason" aria-hidden="true">
              ·
            </span>
            <span className="screen__reason num">{t('spectator.verdictRound', { n: board.round })}</span>
          </div>
        ) : null}

        <main className="screen__stage">
          <Stage arena={arena} trajectory={trajectory} killed={killed} />
        </main>

        <footer className="screen__foot">
          <ComputeStatus
            computes={board.computes}
            budgetMs={board.computeBudgetMs}
            center={
              <div
                className="screen__first"
                data-testid="spectator-first"
                data-first-solver={first ?? 'none'}
                data-tone={firstTone(first)}
              >
                <span className="screen__caption">{t('spectator.firstSolver')}</span>
                <span className="screen__firstvalue num">{first ? firstSolverLabel(locale, first) : '—'}</span>
              </div>
            }
          />
          <p
            className="screen__note"
            data-testid="spectator-note"
            data-severity={roundErrors.length ? 'warning' : 'info'}
          >
            {note}
          </p>
        </footer>
      </div>
    </AppShell>
  );
}
