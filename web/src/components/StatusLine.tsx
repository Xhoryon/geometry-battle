/**
 * 「标签 : 数值」一行 —— 裁判台底栏、大屏导轨、回放头部都有这一形状。
 * 数值一律等宽 + 表格数字（`.num`），标签小号大写。
 */

import type { JSX, ReactNode } from 'react';

export function StatusLine({
  label,
  value,
  className = '',
  testId,
  valueStyle,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  testId?: string;
  /** 数值的强调色（A / B / 判决）—— 只是补充，文字本身已经说明了归属 */
  valueStyle?: React.CSSProperties;
}): JSX.Element {
  return (
    <span className={`statline ${className}`.trim()} data-testid={testId}>
      <span className="statline__label">{label}</span>
      <span className="statline__value num" style={valueStyle}>
        {value}
      </span>
    </span>
  );
}
