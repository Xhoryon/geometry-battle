/**
 * 回放播放器的展示模型（V1.4 F4）—— 纯函数，不碰 DOM、不碰 React。
 *
 * 播放器唯一能改的是**看哪一帧**与**看多快**：帧的内容（轨迹 / 击杀 / 存活 / 终局）
 * 全部来自落盘的 `replay.json`，这里没有任何一行会重新求值函数、重判命中或重算胜负。
 * 速度只缩放两个数：合成轨迹载荷的 `durationMs`（ArenaCanvas 的揭示动画时长）
 * 与自动播放的换帧间隔 —— 两者同一倍率，所以 2× 看到的就是 1× 的两倍快，不多不少。
 *
 * 放在纯模块里是为了能在 `tests/web-wizard.ts` 里不开浏览器就回归。
 */

export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

/** 1× 下一帧轨迹的揭示时长（ms），与 V1.1 回放一致 */
export const BASE_FRAME_MS = 1100;
/** 1× 下自动播放在两帧之间的停顿（ms）—— 给命中闪留出衰减的时间 */
export const BASE_GAP_MS = 350;

export function isSpeed(v: unknown): v is Speed {
  return (SPEEDS as readonly number[]).includes(v as number);
}

/** 本帧轨迹的动画时长：速度越快越短 */
export function frameDurationMs(speed: Speed): number {
  return Math.round(BASE_FRAME_MS / speed);
}

/** 自动播放的换帧间隔 = 动画时长 + 停顿，两段同一倍率一起缩放 */
export function autoplayDelayMs(speed: Speed): number {
  return frameDurationMs(speed) + Math.round(BASE_GAP_MS / speed);
}

/** 帧号夹取到 `[0, total-1]`；没有帧时恒为 0 */
export function clampIndex(i: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(i)));
}

export type PlayerCommand = 'prev' | 'next' | 'toggle' | 'first' | 'last';

/** 键盘 → 播放器命令。用 `hasOwnProperty`：按键名来自浏览器，`'constructor'` 之类不许命中原型链 */
const KEY_COMMANDS: Record<string, PlayerCommand> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  ' ': 'toggle',
  Spacebar: 'toggle',
  Home: 'first',
  End: 'last',
};

export function keyToCommand(key: string): PlayerCommand | null {
  return Object.prototype.hasOwnProperty.call(KEY_COMMANDS, key) ? KEY_COMMANDS[key] : null;
}

export interface PlayerState {
  /** 当前帧在 `frames[]` 里的下标（不是回合号 —— 回合号印在帧上） */
  index: number;
  playing: boolean;
}

/**
 * 执行一条命令后的播放器状态。
 *
 * 手动换帧一律**暂停**：观众按了「上一轮」就是想停下来看那一轮，
 * 自动播放继续往前走会把刚选的帧立刻带走。
 */
export function applyCommand(state: PlayerState, cmd: PlayerCommand, total: number): PlayerState {
  switch (cmd) {
    case 'prev':
      return { index: clampIndex(state.index - 1, total), playing: false };
    case 'next':
      return { index: clampIndex(state.index + 1, total), playing: false };
    case 'first':
      return { index: 0, playing: false };
    case 'last':
      return { index: clampIndex(total - 1, total), playing: false };
    case 'toggle':
      // 停在最后一帧时按「播放」= 从头再看一遍，而不是一个什么都不发生的按钮
      if (!state.playing && total > 0 && state.index >= total - 1) return { index: 0, playing: true };
      return { index: state.index, playing: !state.playing };
  }
}

/** 自动播放走到下一帧；已是最后一帧就停下（`playing=false`），不循环 */
export function advance(state: PlayerState, total: number): PlayerState {
  if (state.index + 1 >= total) return { index: state.index, playing: false };
  return { index: state.index + 1, playing: true };
}

/** 速度的显示文本 —— 数字 + 乘号，两种语言相同：它是数，不是词 */
export function speedText(speed: Speed): string {
  return `${speed}×`;
}

/** 毫秒 → 秒（三位小数）；`null` = 没有记录（该方没算或没交），画一个短横 */
export function secondsText(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(3)} s` : '—';
}
