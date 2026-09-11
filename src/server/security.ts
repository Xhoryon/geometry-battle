/**
 * localhost 应用的边界。
 *
 * 只绑定 `127.0.0.1` **不足以**保护一个能开比赛的 HTTP 服务：
 *
 *   - **CSRF**：你正在浏览的任意网页都能让浏览器向
 *     `http://127.0.0.1:17800/api/judge/compute` 发请求。绑定回环拦不住它 ——
 *     请求确实来自本机。
 *   - **DNS rebinding**：攻击者把自己的域名解析到 127.0.0.1，于是
 *     `http://evil.example/...` 在浏览器看来与本地服务同源。此时 `Host`
 *     是 `evil.example`，而 `Origin` 也是它 —— 这正是 Host 校验要挡的东西。
 *
 * 三道闸：Host 白名单、Origin 必须缺席或同源、POST 必须是 JSON。
 * 另外**不出 CORS 响应头** —— 跨源预检直接失败。
 */

import type { IncomingMessage } from 'http';

export type CheckResult = { ok: true } | { ok: false; status: number; message: string };

/** 允许的 Host（本机回环的两种写法；IPv6 回环一并接受） */
function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * 校验连接是否可以建立（HTTP 请求与 WS upgrade 共用）。
 *
 * `Origin` 缺席是**允许**的：非浏览器客户端（测试脚本、curl）本来就不发 Origin。
 * 缺席放行不构成风险 —— 攻击面恰恰是「浏览器会自动带上 Origin 与 Cookie」这个行为。
 */
export function checkOriginAndHost(req: IncomingMessage, port: number): CheckResult {
  const host = header(req, 'host');
  if (!host) return { ok: false, status: 403, message: '缺少 Host 头' };
  if (!allowedHosts(port).includes(host.toLowerCase())) {
    return { ok: false, status: 403, message: `Host 不被允许: ${host}（只服务本机回环）` };
  }

  const origin = header(req, 'origin');
  if (origin && !allowedOrigins(port).includes(origin.toLowerCase())) {
    return { ok: false, status: 403, message: `跨源请求被拒绝: ${origin}` };
  }
  return { ok: true };
}

/**
 * 命令请求的额外要求：**POST** 必须是 JSON 体 ——
 * 跨站 `<form>` 只能发 `application/x-www-form-urlencoded` / `multipart/form-data` /
 * `text/plain`，因此这一条把「用一个隐藏表单打到裁判接口」这条最省事的路封死。
 *
 * 只对 POST 生效：其它方法根本没有命令语义，会由路由层回 405，
 * 在这里拿 415 抢先否决只会让「未知方法」的语义变得含糊。
 */
export function checkCommandRequest(req: IncomingMessage, port: number): CheckResult {
  const base = checkOriginAndHost(req, port);
  if (!base.ok) return base;

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return { ok: true };

  const ct = (header(req, 'content-type') ?? '').toLowerCase();
  // 允许带 charset：application/json; charset=utf-8
  if (!ct.startsWith('application/json')) {
    return { ok: false, status: 415, message: '请求体必须是 application/json' };
  }
  return { ok: true };
}
