/**
 * 观众大屏的展示模型（V1.4 F4）—— 纯函数。
 *
 * 大屏**不判定任何东西**：这里只回答「这一格该用哪个译文键 / 哪个色 token」，
 * 判据全部是服务端 board 里已经给出的字段。放在纯模块里是为了不开浏览器就能回归。
 */

import { PHASE_KEYS } from '../i18n/translations';
import type { TranslationKey } from '../i18n/translations';
import type { ArenaView, WirePhase } from '../../../src/server/protocol';

/**
 * 头部中央那一句话。
 *
 * 阶段名来自引擎，这里只把它翻成**观众看得懂**的说法 —— 引擎的 `READY`
 * 在开赛前是「就绪」、在第一轮之后是「等待下一轮」，直接印「就绪」对一个
 * 刚走进场馆的人毫无信息量。判据只用引擎已经给的字段，不另算。
 */
export function bannerKey(phase: WirePhase, round: number): TranslationKey {
  if (phase === 'READY' && round > 0) return 'spectator.readyNextRound';
  return PHASE_KEYS[phase];
}

export type FirstSolver = 'A' | 'B' | 'tie' | 'none';

/** 先手的强调色 token：A / B 用队色，同时 / 无用中性 —— 文字本身已经说明了归属 */
export const FIRST_TONE: Record<FirstSolver, 'a' | 'b' | 'neutral'> = {
  A: 'a',
  B: 'b',
  tie: 'neutral',
  none: 'neutral',
};

export function firstTone(first: string | undefined): 'a' | 'b' | 'neutral' {
  return Object.prototype.hasOwnProperty.call(FIRST_TONE, first ?? '')
    ? FIRST_TONE[first as FirstSolver]
    : 'neutral';
}

/**
 * 竞技场内容键。
 *
 * board 每 100ms 一条、每条的 `arena` 都是新对象，但一轮之内它几乎不变。
 * 键相等即内容相等，页面据此给画布一个**稳定的引用**（memo），
 * 让 ArenaCanvas 不必每条 board 都整张重画。arena 很小（几十个点、几个障碍物），
 * 序列化成本远低于一次重画。
 */
export function arenaKey(arena: ArenaView): string {
  return JSON.stringify(arena);
}

/** 坐标的显示文本：一位小数，够看、不抖 */
export function coordText(p: { x: number; y: number }): string {
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
}
