/**
 * 自动打开浏览器（任务书：`npm run app` → 启动本地服务 → 自动打开浏览器）。
 *
 * 只做一件事，且**失败不影响服务** —— 用户总能自己把打印出来的 URL 粘进浏览器。
 */

import { spawn } from 'child_process';

export function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* 打不开浏览器不是错误 —— URL 已经打印在终端上 */
  }
}
