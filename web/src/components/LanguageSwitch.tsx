/**
 * 语言开关（V1.3）。
 *
 * **只有一个组件**，五条路由的头部都放它 —— 不是每页各写一个选择器。
 * 语言本身由根部的 `I18nProvider` 持有，所以这里切换等于全局切换，
 * 并且跨刷新、跨路由保持。
 *
 * 两个选项都写**本名**（`中文` / `EN`）：语言开关的惯例是让不懂当前语言的人
 * 也能找到自己那一项。无障碍名字另有 `aria-label`，说的是当前语言的措辞。
 */

import { LOCALES } from '../i18n/types';
import { useI18n } from '../i18n/useI18n';
import type { JSX } from 'react';

export function LanguageSwitch({ className = '' }: { className?: string }): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  return (
    <span
      className={`lang ${className}`.trim()}
      role="group"
      aria-label={t('lang.switch')}
      data-testid="lang-switch"
    >
      {LOCALES.map((l) => {
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            className={`lang__opt${on ? ' lang__opt--on' : ''}`}
            data-testid={l === 'zh-CN' ? 'lang-zh' : 'lang-en'}
            data-locale={l}
            aria-pressed={on}
            title={l === 'zh-CN' ? '中文' : 'English'}
            onClick={() => setLocale(l)}
          >
            {l === 'zh-CN' ? t('lang.zh') : t('lang.en')}
          </button>
        );
      })}
    </span>
  );
}
