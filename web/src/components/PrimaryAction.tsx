/**
 * 主动作按钮 —— 一屏只有一个。
 *
 * 三条纪律：
 *   1. `enabled` **只能**来自服务端 `ActionView.enabled`（再与 busy 求与）；
 *      本组件不知道任何比赛规则，也不该知道。
 *   2. 不可点时**原因可见**：`why` 印在按钮下面（不是只藏在 title 里），
 *      `aria-describedby` 把它接给读屏。
 *   3. 快捷键（Cmd/Ctrl + Enter）是**附加**的：可见的按钮永远在，快捷键只是
 *      让现场裁判少一次瞄准。macOS 用 ⌘，其余平台用 Ctrl。
 */

import { useEffect, useId } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { JSX } from 'react';

/**
 * 平台 → 修饰键。读一次就够；不是比赛状态，不进任何载荷。
 * 优先读 `userAgentData.platform`（`navigator.platform` 已被标为过时，且在部分浏览器里被冻结），
 * 读不到再退回 `navigator.platform`。
 */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /Mac|iPhone|iPad/i.test(uaPlatform || navigator.platform || '');
}
const IS_MAC = detectMac();
const SHORTCUT_TEXT = IS_MAC ? '⌘ Enter' : 'Ctrl Enter';

export function PrimaryAction({
  actionKey,
  label,
  hint,
  enabled,
  busy = false,
  why,
  onClick,
  shortcut = false,
  testId = 'primary-action',
  whyTestId = 'primary-why',
}: {
  /** 服务端动作 key（`data-action`，演练与向导都用它） */
  actionKey: string;
  label: string;
  /** 服务端给的 hint：不可点时它就是原因 */
  hint?: string;
  enabled: boolean;
  busy?: boolean;
  /** 按钮下方的可见说明（服务端判据 / 忙） */
  why?: string;
  onClick: () => void;
  /** 打开 Cmd/Ctrl+Enter */
  shortcut?: boolean;
  testId?: string;
  whyTestId?: string;
}): JSX.Element {
  const { t } = useI18n();
  const whyId = useId();
  const clickable = enabled && !busy;

  useEffect(() => {
    if (!shortcut || !clickable) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return;
      if (IS_MAC ? !e.metaKey : !e.ctrlKey) return;
      // 多行输入里的 Cmd+Enter 通常是「提交这段文字」，不抢
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut, clickable, onClick]);

  return (
    <div className="primary" data-enabled={enabled ? 'true' : 'false'} data-busy={busy ? 'true' : 'false'}>
      <button
        type="button"
        className="act act--primary"
        data-action={actionKey}
        data-testid={testId}
        disabled={!clickable}
        title={hint}
        aria-describedby={why ? whyId : undefined}
        onClick={onClick}
      >
        <span className="act__key">{actionKey}</span>
        <span className="act__body">
          <span className="act__label">{label}</span>
          {hint ? <span className="act__hint">{hint}</span> : null}
        </span>
        {shortcut ? (
          <kbd className="act__kbd" title={t('primary.shortcut', { keys: SHORTCUT_TEXT })}>
            {SHORTCUT_TEXT}
          </kbd>
        ) : null}
      </button>
      {why ? (
        <p id={whyId} className="primary__why num dim" data-testid={whyTestId}>
          {why}
        </p>
      ) : null}
    </div>
  );
}
