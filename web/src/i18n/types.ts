/**
 * i18n 的基础类型与常量（V1.3）。
 *
 * 只支持两个 locale，刻意不做「可插拔语言包」那套 —— 两条语言、一份源码，
 * 让「加一条文案要改的地方只有一处」这件事本身保持简单。
 *
 * 本文件**不得** import React 或任何 DOM/node 模块：`translations.ts` 会被
 * 单测直接引用，保持纯粹最省事。
 *
 * 键的联合类型（`TranslationKey`）在 `translations.ts` 里由**中文表**
 * 推导得到 —— 那张表是唯一事实来源，英文表必须键齐全，缺一个就编译不过。
 */

/** 支持的语言。顺序即 UI 上语言开关的顺序 */
export const LOCALES = ['zh-CN', 'en-US'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * 兜底语言。
 *
 * 规格要求：浏览器语言是 `zh-*` → `zh-CN`，**其余一律 `en-US`**。
 * 也就是说英文是默认面 —— 现场之外的观众/评委更可能读英文。
 */
export const FALLBACK_LOCALE: Locale = 'en-US';

/** 用户手动选择的持久化键（规格指定，不要改） */
export const LOCALE_STORAGE_KEY = 'geometry-battle.locale';

/** 插值参数。文案里写 `{name}`，调用处传 `{ name: 'A' }` */
export type Params = Record<string, string | number>;

/**
 * 宽容版翻译函数。
 *
 * 用于**服务端下发的 key**（`ActionView.labelKey` / `hintKey`）——
 * 那些 key 不经过 TS 检查，认不出来时必须**回退到服务端给的原文**，
 * 而不是把 key 本身当文案渲染出去（那正是「裸 key」事故）。
 */
export type TranslateDynamic = (key: string, params?: Params, fallback?: string) => string;

/** 浏览器语言 → 本平台 locale（规格：`zh-*` → zh-CN，其余 → en-US） */
export function localeFromLanguageTag(tag: string | null | undefined): Locale {
  if (typeof tag === 'string' && /^zh\b/i.test(tag)) return 'zh-CN';
  return FALLBACK_LOCALE;
}

/** 这个字符串是不是受支持的 locale */
export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
