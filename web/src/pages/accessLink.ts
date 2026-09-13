/**
 * 首页「粘贴访问链接或令牌」的解析 —— 纯函数，可单测。
 *
 * 安全边界（与 `api/client.ts` 一致）：
 *   - 令牌只允许出现在 **fragment**（`#t=`）里；`?t=` 一律不认 —— 查询串会进
 *     request-line 与 Referer，不该由界面替用户把令牌搬过去；
 *   - 只接受**本站**链接：别站的 URL 不该被当成本站入口；
 *   - 这里**不保存**任何东西：结果只用来做一次 `location.assign()`。
 */

/** 令牌的字符集：base64url（服务端 `tokens.ts` 的输出）。下限 16 只是为了别把随手打的词当令牌 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,}$/;

/** 带令牌的三条路线；粘进来的链接若指向其中一条，就按链接自己的路线走 */
export const TOKEN_PATHS = ['/judge', '/team/a', '/team/b'] as const;
export type TokenPath = (typeof TOKEN_PATHS)[number];

export interface AccessTarget {
  path: TokenPath;
  token: string;
}

/**
 * 把用户粘贴的内容解析成「去哪一页 + 用哪个令牌」。
 *
 * @param raw          用户输入（链接或裸令牌）
 * @param fallbackPath 粘的是裸令牌时去哪一页（由卡片决定）
 * @param origin       本站 origin（传进来而不是读 `location`，纯函数好测）
 * @returns 认不出来时返回 null，由界面就地报错，不导航
 */
export function parseAccessInput(raw: string, fallbackPath: TokenPath, origin: string): AccessTarget | null {
  const s = raw.trim();
  if (!s) return null;
  if (TOKEN_RE.test(s)) return { path: fallbackPath, token: s };

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;

  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const token = new URLSearchParams(hash).get('t');
  if (!token || !TOKEN_RE.test(token)) return null;

  const path = (TOKEN_PATHS as readonly string[]).includes(url.pathname)
    ? (url.pathname as TokenPath)
    : fallbackPath;
  return { path, token };
}

/** 目标 → 要 `location.assign()` 的相对地址（令牌只在 fragment 里） */
export function accessHref(target: AccessTarget): string {
  return `${target.path}#t=${encodeURIComponent(target.token)}`;
}
