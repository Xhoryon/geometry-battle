/**
 * 参赛者页的展示模型（V1.4）：六步进度 + 「下一步」提示。
 *
 * 这是一个**纯模块**（不 import React、不碰 DOM），`tests/web-wizard.ts` 直接 import 它做回归。
 *
 * 两条纪律：
 *   1. 每一步的完成判据**只读服务端事实**：槽位装没装、结构校验过没过、Preflight 过没过、
 *      自己选没选、锁没锁、比赛开没开。页面不另算一套进度 —— 那是影子规则。
 *   2. 这里算出来的东西**只决定展示**（哪一格亮、说哪句话），**从不决定按钮能不能点**。
 *      可点性只来自 `board.actions[].enabled`（见 TeamPage）。
 *
 * 唯一用到阶段名的地方是 `ended`（`phase === 'MATCH_END'`）—— 它只用来说「比赛已结束」，
 * 不参与任何可用性判断。
 */

import type { TeamBoard } from '../../../src/server/protocol';
import type { TranslationKey } from '../i18n/translations';
import type { Params } from '../i18n/types';

/** 六步的机器标识（`data-step`），显示名在 i18n 表里 */
export const TEAM_STEPS = ['submit', 'validate', 'preflight', 'select', 'lock', 'wait'] as const;
export type TeamStep = (typeof TEAM_STEPS)[number];

export type StepState = 'done' | 'now' | 'todo' | 'error';

export const TEAM_STEP_KEYS: Record<TeamStep, TranslationKey> = {
  submit: 'team.steps.upload',
  validate: 'team.steps.verify',
  preflight: 'team.steps.preflight',
  select: 'team.steps.select',
  lock: 'team.steps.lock',
  wait: 'team.steps.wait',
};

/** 每种步骤状态的可读词（不只靠颜色）与字形 */
export const STEP_STATE_KEYS: Record<StepState, TranslationKey> = {
  done: 'team.step.done',
  now: 'team.step.now',
  todo: 'team.step.todo',
  error: 'team.step.error',
};
export const STEP_STATE_GLYPH: Record<StepState, string> = {
  done: '✓',
  now: '●',
  todo: '○',
  error: '✕',
};

/**
 * 参赛者板里与进度有关的那几个事实。
 *
 * 单独抽成一个窄类型，是为了让单测能用十来个字面量构造一个局面，
 * 而不必伪造整份 `TeamBoard`（它带着一堆与进度无关的字段）。
 */
export interface TeamFacts {
  installed: boolean;
  /** 槽位状态枚举原文（EMPTY / READY / INVALID） */
  slotStatus: string;
  /** 服务端判定：上传 + 校验通过（锦标赛模式下还要求不是平台自带算法） */
  packageReady: boolean;
  /** 安装记录里的 Preflight 结论；没有安装记录时为 null */
  preflightOk: boolean | null;
  /** 地图已生成（裁判已筹备），本队有候选点可选 */
  hasCandidates: boolean;
  selected: string | null;
  locked: boolean;
  opponentLocked: boolean;
  /** 双方都已锁定，锚点公开 */
  revealed: boolean;
  round: number;
  /** 比赛已终止 —— 唯一来自阶段名的事实，只用于展示 */
  ended: boolean;
}

export function factsOf(board: TeamBoard): TeamFacts {
  return {
    // `slot.installed` 只在 READY 时为真；这里问的是「槽位里有没有东西」，INVALID 也算有
    installed: board.slot.installed || board.slot.status !== 'EMPTY',
    slotStatus: board.slot.status,
    packageReady: board.packageReady,
    preflightOk: board.slot.preflightOk,
    hasCandidates: board.candidates.length > 0,
    selected: board.own.selected,
    locked: board.own.locked,
    opponentLocked: board.opponent.locked,
    revealed: board.revealed,
    round: board.round,
    ended: board.phase === 'MATCH_END',
  };
}

/**
 * 比赛已经建起来了（地图存在 / 已经打过回合 / 已终局）。
 *
 * 建赛的前提就是双方的包都通过了封装与 Preflight，所以此时前三步一律视为完成 ——
 * 即便槽位的安装记录里没有 Preflight 结论（例如手工放置的包在裁判筹备时才跑的那一次）。
 */
function inMatch(f: TeamFacts): boolean {
  return f.hasCandidates || f.round > 0 || f.ended;
}

/** 六步各自的状态。`now` 是第一步没完成的；它若是失败态则标 `error`。 */
export function stepStates(f: TeamFacts): Record<TeamStep, StepState> {
  const started = inMatch(f);
  const validated = f.slotStatus === 'READY' && f.packageReady;
  const done: Record<TeamStep, boolean> = {
    submit: f.installed || started,
    validate: validated || started,
    // Preflight 是校验的下一步：包不算就绪（例如锦标赛模式下的平台自带模板）时，
    // 安装记录里的 Preflight 结论再好也不算这一步完成 —— 进度条不该出现「2 未完成、3 已完成」
    preflight: (validated && f.preflightOk === true) || started,
    select: f.selected !== null,
    lock: f.locked,
    wait: f.round > 0 || f.ended,
  };
  const failed: Partial<Record<TeamStep, boolean>> = {
    validate: !started && f.installed && f.slotStatus === 'INVALID',
    preflight: !started && f.preflightOk === false,
  };
  const out = {} as Record<TeamStep, StepState>;
  let nowTaken = false;
  for (const s of TEAM_STEPS) {
    if (done[s]) out[s] = 'done';
    else if (!nowTaken) {
      out[s] = failed[s] ? 'error' : 'now';
      nowTaken = true;
    } else out[s] = 'todo';
  }
  return out;
}

export interface NextHint {
  key: TranslationKey;
  params?: Params;
  /** 终局：附一条回放链接 */
  replay?: boolean;
}

/**
 * 「下一步该做什么 / 在等谁」—— 一句话，按优先级取第一条成立的。
 *
 * 顺序就是现场的排查顺序：先看比赛是否已在进行（那时包的状态已无关紧要），
 * 再看包（装了没、结构对不对、是不是平台自带的模板、Preflight 过没过），
 * 再看锚点（选了没、锁了没、对方锁了没）。
 */
export function nextHint(f: TeamFacts): NextHint {
  if (f.ended) return { key: 'team.next.ended', replay: true };
  if (f.round > 0) return { key: 'team.next.running', params: { round: f.round } };
  if (!f.hasCandidates) {
    if (!f.installed) return { key: 'team.next.upload' };
    if (f.slotStatus === 'INVALID') return { key: 'team.next.invalid' };
    if (!f.packageReady) return { key: 'team.next.bundled' };
    if (f.preflightOk === false) return { key: 'team.next.preflightFailed' };
    if (f.preflightOk === null) return { key: 'team.next.preflightPending' };
    return { key: 'team.next.waitJudge' };
  }
  if (f.selected === null) return { key: 'team.next.select' };
  if (!f.locked) return { key: 'team.next.lock', params: { id: f.selected } };
  if (!f.opponentLocked || !f.revealed) return { key: 'team.next.waitOpponent' };
  return { key: 'team.next.waitStart' };
}
