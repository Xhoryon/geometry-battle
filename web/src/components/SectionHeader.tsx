/**
 * 面板标题（h2）+ 右侧 meta —— 沿用 `.panel__title` 的样式，五个页面十几处
 * 此前各自手写这三行。`meta` 里放的是数值 / 副标题 / 徽章，由调用方决定。
 */

import type { JSX, ReactNode } from 'react';

export function SectionHeader({
  title,
  meta,
  className = '',
  testId,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
  testId?: string;
}): JSX.Element {
  return (
    <div className={`panel__title ${className}`.trim()} data-testid={testId}>
      <h2>{title}</h2>
      {meta !== undefined && meta !== null ? <span className="panel__meta num dim">{meta}</span> : null}
    </div>
  );
}
