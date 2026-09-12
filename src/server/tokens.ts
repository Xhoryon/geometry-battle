/**
 * 访问令牌（capability token）。
 *
 * 背景（Final RC Audit 的 P1）：`/api/team/*` 与 `ws?topic=team-*` 此前**完全没有**
 * 调用方身份校验 —— 队别由 `body.team` / `?team=` / `?topic=` 决定，于是任何能访问
 * 127.0.0.1 的调用方都能读到对方 reveal 前的 Emitter 选择、代对方改选/锁定锚点、
 * 覆盖对方已提交的算法包、读对方源码。投影层一直是**对的**（`boards.ts` 的 `teamBoard`
 * 按队裁剪），缺的是「谁有资格请求哪一队」这一层。
 *
 * 同一个洞也在裁判面上：`boards.ts` 的裁判板「Emitter 选择在这里给全」，
 * 而 `/api/judge/state` 与 `ws?topic=judge` 同样没有身份校验 —— 只给参赛者加令牌
 * 并不能关掉这个 P1，因为打开 `/judge` 就能看到对方的选择。
 *
 * ## 三档能力位（刻意不做矩阵）
 *
 *   | 面                                                      | 凭证             |
 *   |---------------------------------------------------------|------------------|
 *   | `/api/judge/*`、`ws?topic=judge`                         | `judge` 令牌     |
 *   | `/api/team/*`、`ws?topic=team-a\|team-b`                 | **该队**的令牌   |
 *   | spectator / replay / trajectory / health / 静态资源      | 不需要           |
 *
 * `judge` 令牌**只**授予裁判面，不授予队伍面 —— 队伍面的唯一入口是裁判台
 * 「参赛者入口」给出的那条链接。规则越少，越容易审计。
 *
 * ## 队伍令牌是无状态的
 *
 *   `teamToken(matchId, team) = HMAC-SHA256(judgeToken, `${matchId}:${team}`)`
 *
 * `newMatch()` 会整体替换引擎 ⇒ `matchId` 必变 ⇒ 上一场的队伍令牌**自动**失效。
 * 于是「每场轮换」不需要任何可变状态：不存在「忘了清旧令牌」，也不存在
 * 「轮换与在途请求竞争」—— 失效由构造保证，而不是由某处记得去做。
 *
 * `matchId` 本身是公开的（`/api/health` 与裁判页都印），这没有关系：
 * HMAC 的不可伪造性只依赖 `judgeToken` 保密。
 *
 * 本文件**只属于服务端**。`protocol.ts` 会被 Vite 打进浏览器，那里禁止 import
 * node 内置模块，所以令牌逻辑不能放在那边。
 */

import * as crypto from 'crypto';
import type { TeamSlot } from '../submission/Slot';

/** 32 字节随机 → 43 字符 URL-safe 串（fragment 与 query 里都不必转义） */
export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * 定长比较。
 *
 * **必须先比长度**：`crypto.timingSafeEqual` 在两个 Buffer 长度不等时抛 `RangeError`。
 * 那个异常会冒到 `route()` 的 catch —— 它只认 message 含 `JSON` 或 `过大` 两种，
 * 于是变成 **500**：既是一条未捕获路径，也把「长度对不对」这个信号送给了探测者。
 * 长度本身不是秘密，所以先比长度不泄漏任何东西。
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 队伍令牌从 judge 令牌派生（见文件头：轮换因此不需要任何状态） */
export function deriveTeamToken(judgeToken: string, matchId: string, team: TeamSlot): string {
  return crypto.createHmac('sha256', judgeToken).update(`${matchId}:${team}`).digest('base64url');
}

/**
 * 令牌签发与核验。
 *
 * `judge` 令牌在**进程生命周期**内固定：如果它也跟着每场轮换，裁判按一次
 * new-match 就会把自己那个开着的裁判页锁死。
 */
export class TokenAuthority {
  readonly judge: string;

  constructor(judgeToken: string = newToken()) {
    this.judge = judgeToken;
  }

  teamToken(matchId: string, team: TeamSlot): string {
    return deriveTeamToken(this.judge, matchId, team);
  }

  teamTokens(matchId: string): Record<TeamSlot, string> {
    return { A: this.teamToken(matchId, 'A'), B: this.teamToken(matchId, 'B') };
  }

  isJudge(presented: string | null | undefined): boolean {
    return typeof presented === 'string' && safeEqual(presented, this.judge);
  }

  /** 令牌解析出的队伍；不是任何一队的令牌就返回 null */
  teamOf(matchId: string, presented: string | null | undefined): TeamSlot | null {
    if (typeof presented !== 'string' || presented.length === 0) return null;
    for (const team of ['A', 'B'] as const) {
      if (safeEqual(presented, this.teamToken(matchId, team))) return team;
    }
    return null;
  }
}
