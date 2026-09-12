/**
 * 语言上下文（V1.3）。
 *
 * 解析优先级（规格指定）：
 *
 *   1. 用户此前的手动选择（localStorage）
 *   2. 浏览器语言（`zh-*` → zh-CN，其余 → en-US）
 *   3. 兜底（en-US）
 *
 * 手动选择**覆盖**自动检测，并且跨刷新、跨路由保持 —— provider 挂在应用根部，
 * 路由切换不会重建它。
 *
 * 语言是**纯展示**的：它不进入 MatchEngine、比赛状态、public/reveal、
 * WebSocket 载荷、回放产物、任何哈希、也不进入参赛算法的输入。
 * 这一层只影响「浏览器怎么显示」，因此本文件除了 `document.documentElement.lang`
 * 之外不碰任何外部状态。
 */

import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { FALLBACK_LOCALE, isLocale, LOCALE_STORAGE_KEY, localeFromLanguageTag } from './types';
import type { Locale, Params } from './types';
import { setActiveLocale, translate, translateDynamic } from './translations';
import type { TranslationKey } from './translations';

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** 编译期已知的键 */
  t: (key: TranslationKey, params?: Params) => string;
  /** 服务端下发的键（认不出时回退到 fallback） */
  td: (key: string, params?: Params, fallback?: string) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);

/** 读 localStorage —— 私密模式/被禁用时会抛，一律当作「没存过」 */
function readStored(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStored(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 存不下也不影响本次会话的语言 */
  }
}

/** 规格的解析顺序：已保存 → 浏览器语言 → 兜底 */
export function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return FALLBACK_LOCALE;
  const stored = readStored();
  if (stored) return stored;
  const nav = window.navigator;
  const tag = nav?.languages?.[0] ?? nav?.language ?? null;
  return localeFromLanguageTag(tag);
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

  useEffect(() => {
    setActiveLocale(locale);
    writeStored(locale);
    if (typeof document !== 'undefined') {
      // 无障碍：让读屏与浏览器知道这一页是什么语言
      document.documentElement.lang = locale;
      // 标签页标题跟着语言走 —— 标题只写在静态 index.html 里的话，
      // 英文会话会顶着中文标题，而页面内容已经全是英文。
      document.title = translate(locale, 'app.title');
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      td: (key, params, fallback) => translateDynamic(locale, key, params, fallback),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
