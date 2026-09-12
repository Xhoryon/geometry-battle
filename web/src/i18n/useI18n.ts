/**
 * 取翻译函数（V1.3）。
 *
 *   · 组件里用 **`useI18n()`**（下面这个 hook）；
 *   · `api/client.ts`、`api/zip.ts` 这类**没有 hook 的模块**用 `t()` / `td()` ——
 *     它们在 `./translations` 里，是纯函数，读的是 provider 同步过来的语言镜像。
 *
 * 两者译的是同一张表、同一套插值，不存在「组件里一套、模块里另一套」。
 */

import { useContext } from 'react';
import { I18nContext } from './I18nContext';
import type { I18nValue } from './I18nContext';

export { getActiveLocale, setActiveLocale, t, td } from './translations';

/**
 * 组件用的翻译上下文。
 *
 * 没有 provider 时**直接抛**，而不是悄悄退回某种默认语言 ——
 * 那会让「忘了包 provider」表现成「文案莫名其妙变成了英文」，
 * 而不是一眼可见的崩溃。
 */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return ctx;
}
