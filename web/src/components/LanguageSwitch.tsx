/**
 * 语言开关（V1.3）。
 *
 * **只有一个组件**，所有路由的头部（AppShell）都放它 —— 不是每页各写一个选择器。
 * 语言本身由根部的 `I18nProvider` 持有，所以这里切换等于全局切换，
 * 并且跨刷新、跨路由保持。
 *
 * 两个选项都写**本名**（`中文` / `EN`）：语言开关的惯例是让不懂当前语言的人
 * 也能找到自己那一项。无障碍名字另有 `aria-label`，说的是当前语言的措辞。
 * 每个 locale 的本名 / testid / 文案键都写成**映射表**，组件里不做语言三元。
 */

import { LOCALES } from '../i18n/types';
import type { Locale } from '../i18n/types';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import type { JSX } from 'react';

/** 本名 —— 给不懂当前界面语言的人看的，因此**不**随界面语言翻译 */
const NATIVE_NAME: Record<Locale, string> = { 'zh-CN': '中文', 'en-US': 'English' };
/** 演练用的选择器（`lang-zh` / `lang-en`，e2e 钉死） */
const TEST_ID: Record<Locale, string> = { 'zh-CN': 'lang-zh', 'en-US': 'lang-en' };
const LABEL_KEY: Record<Locale, TranslationKey> = { 'zh-CN': 'lang.zh', 'en-US': 'lang.en' };

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
            data-testid={TEST_ID[l]}
            data-locale={l}
            aria-pressed={on}
            title={NATIVE_NAME[l]}
            onClick={() => setLocale(l)}
          >
            {t(LABEL_KEY[l])}
          </button>
        );
      })}
    </span>
  );
}
