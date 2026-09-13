/**
 * 全部 Web 面向用户文案（V1.3）。
 *
 * **中文表是唯一事实来源**：`TranslationKey` 由它推导，英文表是
 * `Record<TranslationKey, string>` —— 少写一个键就编译不过。
 * 因此「加了一条中文忘了加英文」不可能悄悄溜过去。
 *
 * 三条纪律：
 *
 *   1. **机器标识不翻译**：`Team A/B`、`Emitter`、`Preflight`、`DSL`、`JSON`、
 *      `SHA-256`、`solver.py`、`manifest.json`、命令、路径、JSON 键、错误码
 *      （`NOT_THROUGH_SHOOTER` 之类）一律原样保留。翻译的是**解释**，不是标识。
 *   2. **不做手工拼接**。语序会变的地方一律用 `{param}` 占位，由 `translate()`
 *      插值 —— 中文「第 {n} 轮」与英文「Round {n}」的语序本来就不同。
 *   3. **复数不靠 `(s)`**。凡是带计数的句子，中文照常写，英文改用
 *      「标签：数值」的写法（`Files: 3`）—— 对任意 n 都成立，也不需要复数引擎。
 */

import { FALLBACK_LOCALE } from './types';
import type { Locale, Params } from './types';
// 只用到**类型**：`import type` 会被完全擦除，因此这个模块在运行时
// 依然零依赖 —— zip.ts 那个 Node 单测正是靠这一点才能直接 import 它。
import type { WireDifficulty, WireEndReason, WirePhase } from '../../../src/server/protocol';

/** 中文表 —— 键的唯一事实来源 */
const zh = {
  // ---------------------------------------------------------------- app / nav
  'app.notFound': '没有这个页面。',
  'app.title': '几何斗殴 — 本地比赛',
  // 品牌名是标识，两种语言里都是同一串字母
  'app.brand': 'GEOMETRY BATTLE',

  // 全局导航（AppShell，V1.4）。都是整页链接：这个应用刻意没有站内路由。
  'nav.label': '页面导航',
  'nav.home': '首页',
  'nav.judge': '裁判台',
  'nav.teamA': '参赛者 A',
  'nav.teamB': '参赛者 B',
  'nav.spectator': '观众大屏',
  'nav.replays': '回放列表',
  'nav.replay': '本场回放',

  'lang.switch': '语言',
  'lang.zh': '中文',
  'lang.en': 'EN',

  // ---------------------------------------------------------------- common
  'common.connecting': '正在连接本地比赛服务…',
  'common.readonly': '只读',
  'common.unnamed': '（未命名）',
  'common.unknown': '未知',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.none': '无',
  'common.noFiles': '（还没有文件）',

  // ---------------------------------------------------------------- conn
  // 连接状态（`useBoard().status`，V1.4）。七种状态**必须分开**：现场看到的
  // 「未连接」背后可能是服务没起、令牌不对、或只是 board 还没到 —— 处置完全不同。
  'conn.label': '连接状态',
  'conn.connecting': '连接中…',
  'conn.waiting': '已连接 · 等待比赛状态',
  'conn.waitingBody': '已连接，正在等待服务端下发比赛状态…',
  'conn.live': '实时',
  'conn.reconnecting': '重连中 · 第 {n} 次',
  'conn.disconnected': '已断开 · 仍在重试（{n}）',
  'conn.unauthorized': '无访问权',
  'conn.unreachable': '服务不可达',

  // ---------------------------------------------------------------- status
  // 状态徽章没给文字时的默认词（七种状态，对应 styles.css 的 --status-* token）
  'status.neutral': '未设置',
  'status.waiting': '等待中',
  'status.ready': '就绪',
  'status.active': '进行中',
  'status.warning': '注意',
  'status.error': '错误',
  'status.terminal': '已结束',

  // Preflight 结论（安装记录三态：从未跑过 / 通过 / 未通过）—— 裁判队卡与参赛者页共用
  'preflight.never': '未运行',
  'preflight.ok': '通过',
  'preflight.fail': '未通过',

  // ---------------------------------------------------------------- notice
  // 分层错误提示的「谁受影响」眉标（ErrorNotice 的 data-scope）
  'notice.scope.participant': '参赛者端',
  'notice.scope.package': '算法包',
  'notice.scope.preflight': 'Preflight',
  'notice.scope.round': '本轮结算',
  'notice.scope.judge': '裁判动作',
  'notice.scope.connection': '连接',
  'notice.scope.server': '服务端',
  'notice.retry': '重试',

  // ---------------------------------------------------------------- team label / primary
  'teamLabel.A': 'Team A',
  'teamLabel.B': 'Team B',
  'primary.shortcut': '快捷键 {keys}',

  // ---------------------------------------------------------------- verdict
  // 判决文案只有这一处：三块板与回放都用 `winnerLabel()`，不再各自拼 `TEAM ` + 胜者。
  'verdict.win': 'TEAM {team} 获胜',
  'verdict.draw': '平局 DRAW',

  // ---------------------------------------------------------------- phase
  // 三块板（参赛者 / 裁判 / 观众）共用同一套阶段说法
  'phase.SETUP': '等待载入算法',
  'phase.UPLOAD_A': '已载入 Team A',
  'phase.UPLOAD_B': '已载入 Team B',
  'phase.PREFLIGHT': '校验中',
  'phase.EMITTER_SELECT': '选择发射锚点',
  'phase.READY': '就绪',
  'phase.PUBLIC': '本轮已冻结 — 等待揭晓',
  'phase.REVEAL': '已揭晓 — 等待 START',
  'phase.COUNTDOWN': 'START 已下达',
  'phase.COMPUTING': '双方算法计算中',
  'phase.ROUND_RESULT': '本轮结算',
  'phase.MATCH_END': '比赛结束',

  // ---------------------------------------------------------------- compute
  'compute.idle': '未运行',
  'compute.running': '计算中…',
  'compute.done': '已完成',
  'compute.error': '异常',

  // ---------------------------------------------------------------- access
  'access.missing.title': '这一页缺少访问令牌',
  'access.missing.body':
    '请用裁判台「参赛者入口」里给的那条链接打开本页 —— 地址末尾的 #t=… 就是本场令牌，不要手工删掉它。',
  'access.unauthorized.title': '本场令牌已失效',
  'access.unauthorized.body':
    '每一场都会重新签发令牌，所以旧链接在下一场就无效了。请向裁判索取本场的新链接（裁判台「参赛者入口」里可以一键复制）。',
  'access.unreachable.title': '连不上本地服务',
  'access.unreachable.body': '比赛服务可能已经退出，或端口变了。请确认服务仍在运行。',

  // ---------------------------------------------------------------- team
  'team.title': '参赛者 {team}',
  'team.phase': '阶段：{label}',
  'team.devMode': '开发模式（锦标赛校验已关闭）',

  'team.steps.upload': '上传算法包',
  'team.steps.verify': '赛前校验',
  'team.steps.select': '选择锚点',
  'team.steps.lock': '锁定',

  'team.package.title': '算法包',
  'team.package.ready': '已就绪',
  'team.package.notReady': '未就绪',
  'team.upload.folder': '选择文件夹',
  'team.upload.folderHint': '整个算法目录（包根目录里要有 solver.py）',
  'team.upload.files': '选择文件 / ZIP',
  'team.upload.filesHint': '单个 solver.py、多个文件，或一个 .zip',
  'team.upload.accepts': '接受三种形式：单个 solver.py、整个算法目录、或一个 .zip。',
  'team.upload.pipeline':
    '上传走的是与正式比赛同一套校验（staging → validate → sandbox preflight → seal → replace），浏览器绕不过去。',
  'team.files.title': '文件清单',
  'team.files.count': '{n} 个',
  'team.files.empty': '（还没有文件）',
  'team.source.binary': '二进制文件 —— 不提供预览',
  'team.source.truncated': '内容已截断（仅显示开头部分）',

  'team.emitter.title': '本场固定 Emitter',
  'team.emitter.locked': '已锁定',
  'team.emitter.selected': '已选择（未锁定）',
  'team.emitter.none': '未选择',
  'team.emitter.desc':
    '从自己的初始点里选一个作为本场的发射点（Emitter）。它整场不可更换、不可击杀、也不是战斗点；其余的点才是 Combat Points。双方都锁定之后，两个锚点才会公开。',
  'team.emitter.pickCaption': '从下面这些点里挑一个作为本场锚点',
  'team.emitter.lockCaption': '选定之后锁定 —— 锁定后整场不可更换',
  'team.emitter.lockButton': '锁定 Emitter',
  'team.emitter.waiting': '比赛开始之后才能选择 —— 裁判在「筹备」一步生成地图，随后进入本阶段。',
  'team.emitter.revealedTitle': '双方锚点',
  'team.emitter.public': '已公开',
  'team.emitter.hidden': '未公开',
  'team.emitter.hiddenBody': '双方都锁定之后才会公开。对方现在{state}。',
  'team.emitter.opponentLocked': '已锁定',
  'team.emitter.opponentUnlocked': '尚未锁定',

  'team.candidate.selectedMark': '已选择',
  'team.candidate.alive': '存活',
  'team.candidate.dead': '阵亡',

  'team.arena.hint': '点击场上的点即可选为 Emitter（也可以在上面列表里点）。',

  'team.note.selected': '已选择 {id}',
  'team.note.locked': 'Emitter 已锁定',
  'team.note.installed': '已安装 {n} 个文件',
  'team.note.installedWithHash': '已安装 {n} 个文件，包哈希 {hash}…',

  'team.err.commandFailed': '命令失败',
  'team.err.uploadFailed': '上传失败',
  'team.err.readFailed': '读取失败',

  // ---- V1.4 参赛者页：四个区块（算法包 / 源码 / Emitter / 状态）、六步进度、「下一步」提示 ----
  // 区块名与步骤名是文案；Emitter / Preflight / solver.py 是产品术语与机器标识，原样。
  'team.section.source': '源码',
  'team.section.status': '状态',
  'team.steps.preflight': 'Preflight',
  'team.steps.wait': '等待开赛',
  // 步骤状态的可读词：不只靠颜色与字形
  'team.step.done': '已完成',
  'team.step.now': '进行中',
  'team.step.todo': '未开始',
  'team.step.error': '未通过',
  'team.status.round': '回合',
  'team.status.opponent': '对方',
  'team.status.opponentLocked': '已锁定',
  'team.status.opponentUnlocked': '尚未锁定',
  // 「下一步」：按服务端事实取第一条成立的（见 pages/teamSteps.ts）
  'team.next.title': '下一步',
  'team.next.upload': '在「算法包」区块上传本队的算法包：一个 .zip、整个目录，或单个 solver.py。',
  'team.next.invalid': '算法包未通过结构校验 —— 按上传控件下方列出的错误修正后重新上传。',
  'team.next.bundled': '锦标赛模式：槽位里是平台自带的模板算法，不算就绪 —— 请上传本队真实的算法包。',
  'team.next.preflightFailed': 'Preflight 未通过 —— 修正算法后重新上传。',
  'team.next.preflightPending': '这份包没有安装记录，Preflight 尚未运行 —— 裁判「筹备」时会在沙箱里真跑一次。',
  'team.next.waitJudge': '算法已就绪。等待裁判筹备比赛并生成地图，随后在这里选择 Emitter。',
  'team.next.select': '从「本场 Fixed Emitter」的候选点里选一个（也可以直接点场上的点）。',
  'team.next.lock': '已选择 {id}。确认后锁定 —— 锁定后整场不可更换。',
  'team.next.waitOpponent': 'Emitter 已锁定。等待对方锁定；双方都锁定后锚点公开。',
  'team.next.waitStart': '双方锚点已公开。等待裁判开始比赛（揭晓 → START）。',
  'team.next.running': '比赛进行中 —— 第 {round} 轮。本页无需操作，可在观众大屏观看。',
  'team.next.ended': '比赛已结束。',
  // 算法包区块：包的身份行与校验结果
  'team.package.hash': '包哈希',
  'team.package.validation': '结构校验',
  'team.package.entry': '入口',
  'team.package.files': '文件',
  'team.package.invalidTitle': '算法包未通过校验',
  'team.package.invalidNext': '修正后重新上传。上传不会改动槽位里已装好的包，除非新包通过全部校验。',
  'team.upload.title': '上传算法包',
  'team.upload.replaceTitle': '替换算法包',
  'team.upload.replaceImpact':
    '新包会重新走完整校验并跑一次 Preflight；被拒的上传不会改动槽位里现有的包。比赛筹备开始后，服务端会拒绝替换。',
  'team.upload.busy': '正在安装并校验…（含一次沙箱 Preflight，可能需要几十秒）',
  'team.source.pickHint': '点击文件名查看内容（只读）。',
  // 锁定后的不可变提示：LOCKED 是任务书钉下的字面量，两种语言都出现
  'team.emitter.lockedBadge': 'LOCKED · 已锁定',
  'team.emitter.immutable': '本场比赛中不可更改。',
  'team.emitter.yours': '本队锚点',
  'team.arena.title': '场面',
  'team.arena.note': '只画本队的点；障碍物在揭晓前不公开',
  // 服务端后台推进失败（`TeamBoard.lastError`）：参赛者只需知道比赛停了、在等裁判
  'team.serverError.title': '比赛服务报告了一次失败 —— 比赛停在当前阶段，等待裁判处理。',

  // ---------------------------------------------------------------- judge
  'judge.title': '裁判台',
  'judge.teamCard.unnamed': '（未命名）',
  'judge.teamCard.nameTitle': '算法包自报的名字',
  'judge.teamCard.ready': '算法就绪',
  'judge.teamCard.notReady': '未就绪',
  'judge.teamCard.emitterLocked': '锚点 {id}',
  'judge.teamCard.emitterLockedNoId': '已锁定',
  'judge.teamCard.emitterUnlocked': '锚点未锁定',

  'judge.links.title': '参赛者入口',
  'judge.links.subtitle': '本场链接 · 换场即更新',
  'judge.links.desc':
    '把对应的那条发给各队。链接里带着本场的访问令牌：不要投到大屏上，也不要发给另一队 —— 拿着某队的令牌就能替那一队操作。',

  'judge.wizard.title': '裁判向导',
  'judge.wizard.waitingBody': '本步由双方选手在各自的参赛者页完成，裁判没有对应动作。',
  'judge.wizard.busy': '执行中…（命令是串行的，忙时按钮一律不可点）',
  'judge.wizard.busyShort': '执行中…',
  'judge.wizard.whyEnabled': '服务端判据：可用 —— {hint}',
  'judge.wizard.whyDisabled': '服务端判据：不可用 —— {hint}',

  'judge.step.SETUP':
    '把双方的算法密封进本场比赛。选手先在各自的参赛者页上传算法包；两边都就绪时，下面这一步一次做完「封装 → 校验 → 建赛」。',
  'judge.step.UPLOAD_A': 'Team A 已密封。Team B 的算法就绪后，同样一步就能完成筹备。',
  'judge.step.UPLOAD_B':
    '双方算法都在槽位里了：一次完成「封装双方算法 → 沙箱 Preflight → 建赛」，随后进入 Emitter 选择。',
  'judge.step.PREFLIGHT': '沙箱里正在真跑一次双方算法（Preflight），确认能产出合法函数。',
  'judge.step.EMITTER_SELECT':
    '地图已生成。双方各自在选手端选定并锁定本场的发射锚点 —— 这一步由选手完成，裁判在此等待；双方都锁定后锚点自动公开。',
  'judge.step.READY': '双方 Emitter 已锁定，锚点已公开，可以开始本轮。',
  'judge.step.PUBLIC': '本轮 public_state 已冻结。揭晓障碍物 —— 此刻参赛代码一行都还没跑。',
  'judge.step.REVEAL': '障碍物已公开，参赛代码仍然没有运行。下达 START 才是唯一允许它运行的开关。',
  'judge.step.COUNTDOWN': 'START 已下达，倒计时归零后双方算法开始计算。',
  'judge.step.COMPUTING': '双方算法在各自沙箱里计算，本轮正在结算。',
  'judge.step.ROUND_RESULT': '本轮已结算，可以进入下一轮。',
  'judge.step.MATCH_END': '比赛已终止。打开回放；要开新的一场，在 Advanced 里执行「重置比赛」（需确认）。',

  'judge.emitter.title': '双方 Emitter',
  'judge.emitter.revealed': '双方已锁定 · 锚点公开',
  'judge.emitter.hidden': '未公开',
  'judge.emitter.none': '未选择',
  'judge.emitter.unknown': '状态未知',
  'judge.emitter.locked': '已锁定',
  'judge.emitter.unlocked': '未锁定',
  'judge.emitter.notSent': '服务端尚未下发双方的选择 —— 这里不猜锁定状态。',

  // 头部状态条的字段标签。`MATCH` 与阶段枚举是机器标识（一个是 id 前缀，
  // 一个被 e2e 钉死为引擎原始阶段名），**不翻译**；ROUND / seed 是文案，跟着语言走。
  'judge.header.round': '回合',
  'judge.header.seed': '种子',

  'judge.slot.empty': '槽位为空',
  // 键名沿用 V1.3（tests/i18n.ts 以它作占位符检查的锚点）；V1.4 用在「比赛状态」的地图一行
  'judge.slot.settings': '{points} 点 · {difficulty}',

  'judge.adv.summary': 'Advanced Controls · 底层动作与比赛设置',
  'judge.adv.desc':
    '向导只突出「现在该做的那一个」；这里是服务端下发的全部动作（含向导未用到的底层步骤）。可用性同样只读服务端的判据 —— 灰掉的按钮把鼠标悬上去就是原因。',
  'judge.adv.installDesc':
    '正式比赛请用向导里的「封装双方算法 → 校验 → 建赛」—— 算法由选手在参赛者页上传。这里只在需要临时换算法时使用，输入的是服务端上的目录绝对路径；替换前会再确认一次。',
  'judge.adv.teamDir': 'Team {team} 算法目录',
  'judge.adv.pathPlaceholder': '/绝对/路径/到/算法包',
  'judge.adv.install': '安装 Team {team} 算法',
  // 目录安装按钮灰掉 / 可点的原因 —— 印在按钮下面，不只藏在 title 里
  'judge.adv.installWhy': '填入服务端上的目录绝对路径后才能安装',
  'judge.adv.installReady': '点击后会先确认影响，再替换槽位里的包',
  'judge.adv.settingsDesc': '比赛设置 —— 在下一次「重置 / 下一场」时生效。',
  'judge.adv.seed': '种子（留空 = 随机）',
  'judge.adv.points': '战斗点数（留空 = 沿用）',
  'judge.adv.difficulty': '难度（留空 = 沿用）',
  'judge.adv.keepDifficulty': '沿用 {value}',

  'judge.audit.events': '{n} 事件',
  'judge.audit.runtimeOk': '✓ 与冻结清单一致',
  'judge.audit.runtimeMismatch': '✕ 与冻结清单不符',

  'judge.lastRound.attacks': '本轮攻击',
  'judge.lastRound.kills': '击杀',
  'judge.lastRound.alive': '存活',
  'judge.lastRound.verdict': '终局',
  'judge.lastRound.notConnected': '界面尚未接入该动作：{key}',
  'judge.lastRound.headline': '第 {round} 轮 · 先手 {first}',

  // ---------------------------------------------------------------- judge V1.4 IA
  // 裁判台的区块名与队卡字段。区块名是文案；`Preflight` / `Emitter` 是产品术语，原样。
  'judge.section.matchStatus': '比赛状态',
  'judge.section.audit': '审计 · 源码核对',
  'judge.status.map': '地图',
  'judge.teamCard.hashSealed': '密封哈希',
  'judge.teamCard.hashSlot': '包哈希',
  'judge.teamCard.source': '来源',
  'judge.teamCard.compute': '计算',
  'judge.teamCard.originInstalled': '本平台安装',
  'judge.teamCard.originUnrecorded': '无安装记录',
  // 后台推进（连续跑完余下回合）失败：比赛停在原地，说清楚怎么继续
  'judge.lastError.title': '后台推进失败 —— 比赛停在当前阶段',
  'judge.lastError.retryHint':
    '排除原因后，在主动作处重新执行「连续跑完余下回合」即可继续；不需要换场，双方 Emitter 锁定不受影响。',
  // 裁判动作被服务端拒绝：贴在按钮旁边，说明状态没变、可以再点
  'judge.action.failed': '「{action}」未执行',
  'judge.action.next': '服务端已拒绝，比赛状态未变。修正原因后可直接再点一次。',
  // 危险动作的两步确认：第一次点只亮出影响，第二次才执行
  'judge.danger.title': '需要确认',
  'judge.danger.resetImpact':
    '将清除双方 Emitter 锁定、生成新的 matchId 与参赛者链接；Advanced 里的比赛设置在此时生效。旧的参赛者链接立即失效。',
  'judge.danger.installImpact':
    '将替换 Team {team} 槽位里的算法包，新包需要重新 Preflight；比赛开始后服务端会拒绝替换。',
  'judge.danger.confirm': '确认：{label}',
  'judge.danger.cancel': '取消',
  'judge.round.errorsTitle': '本轮有算法异常（已按规则结算）',
  'judge.audit.runtime': '运行时',
  'judge.audit.recent': '最近事件',
  'judge.audit.files': '{n} 文件 · {bytes} B',
  // 槽位状态是协议枚举（EMPTY / READY / INVALID）：枚举原样留在 data-slot-status 里，这里只翻给人看的词
  'slotStatus.EMPTY': '空',
  'slotStatus.READY': '就绪',
  'slotStatus.INVALID': '无效',

  // ---------------------------------------------------------------- action
  // 服务端下发 labelKey / hintKey（见 boards.ts）。这里是它们的译文。
  'action.useSlot.label': '使用槽位算法（Team {team}）',
  'action.useSlot.hint.factory': '锦标赛模式：槽位里是出厂模板算法，必须上传并安装真实算法包',
  'action.useSlot.hint.notReady': '槽位 {team} 尚不可用（{status}）',
  'action.useSlot.hint.phase': '当前阶段 {phase} 不允许载入 Team {team}',
  'action.useSlot.hint.ok': '把槽位里的算法密封进本场比赛',

  'action.prepare.label': '开始比赛筹备（封装双方算法 → 校验 → 建赛）',
  'action.prepare.hint.notReady': '需要双方算法都已就绪',
  'action.prepare.hint.notReadyTournament': '需要双方算法都已就绪（锦标赛模式：必须上传真实算法包）',
  'action.prepare.hint.phase': '当前阶段 {phase} 不能筹备',
  'action.prepare.hint.ok': '封装密封副本 → 沙箱 Preflight → 生成地图（随后进入 Emitter 选择）',

  'action.preflight.label': '校验双方算法（Preflight）',
  'action.preflight.hint': '在沙箱里真跑一次，确认算法能产出合法函数',

  'action.start.label': '开始比赛（进入第一轮）',
  'action.start.hint.ready': '生成地图并进入第一轮',
  'action.start.hint.needPreflight': '需先通过 Preflight',

  'action.reveal.label': '揭晓本轮（REVEAL）',
  'action.reveal.hint': '公开本轮障碍物 —— 此刻参赛代码仍未运行',

  'action.startRound.label': 'START（此刻之前参赛代码一行都没跑）',
  'action.startRound.hint': '唯一允许参赛代码运行的开关',

  'action.compute.label': '结算本轮（播放轨迹动画）',
  'action.compute.hint': '运行双方算法并结算本轮',

  'action.runToEnd.label': '连续跑完余下回合',
  'action.runToEnd.hint': '后台推进到比赛终止，期间可继续观看',

  'action.reset.label': '重置比赛',
  'action.reset.labelWithMatch': '结束本场并重置',
  'action.reset.hint': '回到初始状态，准备下一场',

  'action.selectEmitter.label': '选择本场 Emitter',
  'action.selectEmitter.hint.locked': '已锁定，整场不可更换',
  'action.selectEmitter.hint.phase': '当前阶段 {phase} 不能选择 Emitter',
  'action.selectEmitter.hint.ok': '从自己的初始点里选一个作为本场的发射锚点',

  'action.lockEmitter.label': '锁定 Emitter',
  'action.lockEmitter.hint.locked': '已锁定',
  'action.lockEmitter.hint.needSelect': '请先选择 Emitter',
  'action.lockEmitter.hint.ok': '锁定后整场不可更换；双方都锁定后锚点公开',

  // ---------------------------------------------------------------- spectator
  'spectator.round': '回合',
  'spectator.alive': 'Team {team} 存活',
  'spectator.firstSolver': '先手',
  // 头部两侧各自的「发射锚点」一行；双方都锁定之前引擎不下发坐标，此时写「未公开」
  'spectator.emitter': '发射锚点',
  'spectator.emitterPending': '未公开',
  'spectator.readyNextRound': '本轮已结算 · 等待下一轮',
  'spectator.note.attacks': '本轮攻击 {attacks}   击杀 {kills}',
  'spectator.note.noAttacks': '未执行',
  // 终局带上判决后面的回合数
  'spectator.verdictRound': '第 {n} 轮',

  // ---------------------------------------------------------------- replay
  'replay.title': '回放',
  'replay.loading': '正在读取回放…',
  'replay.rounds': '逐轮',
  'replay.roundsCount': '{n} 回合',
  'replay.others': '其他场次',
  'replay.play': '播放',
  'replay.pause': '暂停',
  'replay.prev': '上一轮',
  'replay.next': '下一轮',
  'replay.slider': '回合',
  // 播放器（V1.4）
  'replay.counter': '第 {n} / {total} 轮',
  'replay.speed': '播放速度',
  'replay.speedOption': '{x}× 速度',
  'replay.player': '回放播放器 —— ← → 切换回合，空格 播放 / 暂停，Home / End 首末轮',
  'replay.first': '先手',
  'replay.attacks': '攻击',
  'replay.kills': '击杀',
  'replay.time': '用时',
  'replay.frameEnd': '比赛在本轮终结 · {reason}',
  'replay.loadTitle': '这场回放打不开',
  'replay.backToList': '返回回放列表',
  'replay.meta': '{points} 点 · {difficulty} · seed {seed}',
  'replay.frameSummary': '先手 {first} · 攻击 {attacks} · 击杀 {kills}',
  // 回放里的回合标号。中文用「第 n 轮」，英文保持紧凑的 R+n —— 这两种写法
  // 各自是本语言的惯例，硬套同一个形状在任何一边都别扭。
  'replay.roundShort': '第 {n} 轮',
  'replay.roundsBadge': '{n} 回合',
  'replay.loadFailed': '读取失败（HTTP {status}）',
  // 回放打不开时的原因。服务端给键（`classifyMatch` 的 `reasonKey`），
  // 这里取译文；认不出键时客户端回退到服务端原文。
  'replay.reason.notFound': '没有这场比赛',
  'replay.reason.incomplete': '这场比赛的产物不完整',
  'replay.reason.broken': '产物缺失或无法解析',
  'replay.reason.unfinished': '这场比赛没有正常终结，不能作为回放',
  'replay.reason.legacyNoEnd': '这场比赛的产物来自旧版本（没有终局原因字段），结果不可信',
  'replay.reason.legacyContradiction':
    '终局原因 {endReason} 与胜者 {winner} 自相矛盾（旧版本产物），结果不可信',

  // ---------------------------------------------------------------- errors
  // Web 层自己产生的错误（服务端下发的原文不在这里，见 README「已知边界」）
  'err.httpFailed': '请求失败（HTTP {status}）',
  'err.unreachable': '无法连接到本地服务：{message}',
  'err.noFilesPicked': '没有选择任何文件',
  'err.unzipFailed': '{name} 解压失败：{message}',

  // ---------------------------------------------------------------- zip
  // 浏览器端解包器的报错（`api/zip.ts`）；它们会原样出现在参赛者页上
  'zip.bomb': '解压后体积超过上限 {bytes} 字节 —— 疑似 ZIP 炸弹',
  'zip.notZip': '不是合法的 ZIP 文件',
  'zip.tooManyEntries': 'ZIP 内条目过多（{n}）',
  'zip.centralCorrupt': 'ZIP 中央目录损坏',
  'zip.localCorrupt': 'ZIP 局部头损坏：{name}',
  'zip.declaredTooBig': 'ZIP 内文件声明体积过大：{name}',
  'zip.unsupportedMethod': '不支持的 ZIP 压缩方式 {method}（仅支持 stored / deflate）',
  'zip.totalTooBig': 'ZIP 解压后总体积超过上限 {bytes} 字节',
  'zip.crcMismatch': 'ZIP 校验和不匹配：{name}（文件已损坏）',
  'zip.empty': 'ZIP 里没有任何文件',

  // ---------------------------------------------------------------- difficulty
  // 难度是**协议枚举**（`WireDifficulty`）—— `value` 一律保持 easy/medium/hard，
  // 翻译的只是**给人看的那个词**。
  'difficulty.easy': '简单',
  'difficulty.medium': '中等',
  'difficulty.hard': '困难',

  // ---------------------------------------------------------------- end reason
  // 终局原因是**协议枚举**（`WireEndReason`）：枚举原样留在 `data-end-reason` 里，
  // 这里只翻给人看的那个词。
  'endReason.ELIMINATION': '歼灭',
  'endReason.MUTUAL_ELIMINATION': '同归于尽',
  'endReason.STALEMATE': '僵局',
  'endReason.HARD_ROUND_LIMIT': '达到回合上限',
  'endReason.NONE': '未结束',

  // ---------------------------------------------------------------- first solver
  // `firstSolver` 的四个取值。`tie` / `none` 此前被直接拼成 “TEAM TIE” —— 这里给它们译文。
  'firstSolver.A': 'TEAM A',
  'firstSolver.B': 'TEAM B',
  'firstSolver.tie': '同时',
  'firstSolver.none': '无',

  // ---------------------------------------------------------------- home
  'home.eyebrow': '本地比赛系统',
  'home.title': '选择身份',
  'home.lead':
    '裁判、参赛者、观众各有一个入口。裁判台与参赛者页需要本场的访问链接（地址末尾的 #t=…），观众大屏与回放不需要。',
  'home.role.judge.title': '裁判',
  'home.role.judge.desc': '建赛、校验双方算法、揭晓、下达 START、连续跑完余下回合。一台机器只有一个裁判台。',
  'home.role.team.desc': '上传算法包、通过校验、选择并锁定本场 Emitter。锁定后整场不可更换。',
  'home.role.spectator.title': '观众大屏',
  'home.role.spectator.desc': '只读的满幅竞技场：回合、存活、先手与判决。不需要令牌，也没有任何操作按钮。',
  'home.role.enter': '进入',
  'home.role.enterWithoutToken': '不带令牌打开（页面会提示缺少令牌）',
  'home.access.required': '需要访问链接',
  'home.access.teamNote':
    '本页由裁判台「参赛者入口」发放的链接打开：地址末尾的 #t=… 就是本场令牌。它只留在地址栏里，不会被保存。',
  'home.access.judgeNote': '裁判台链接印在启动服务的终端里（/judge#t=…）。令牌只留在地址栏里，不会被保存。',
  'home.access.pasteLabel': '粘贴访问链接或令牌',
  'home.access.pastePlaceholder': 'http://…#t=… 或令牌本身',
  'home.access.go': '打开',
  'home.access.invalid':
    '识别不出这是一条访问链接或令牌。链接必须是本站地址且带 #t=…；令牌是一串字母、数字、- 与 _。',
  'home.replays.title': '最近比赛',
  'home.replays.all': '全部回放 →',

  // ---------------------------------------------------------------- replays
  'replays.title': '回放列表',
  'replays.count': '{n} 场',
  'replays.loading': '正在读取比赛列表…',
  'replays.loadFailed': '读不到比赛列表',
  'replays.empty': '还没有可回放的比赛 —— 第一场结束后会出现在这里。',
  'replays.col.ended': '结束时间',
  'replays.col.match': '场次',
  'replays.col.teams': '双方',
  'replays.col.result': '结果',
  'replays.col.reason': '终局原因',
  'replays.col.rounds': '回合',
  'replays.vs': '{a} 对 {b}',
  'replays.open': '打开回放',

  // ---------------------------------------------------------------- judge stage
  // 裁判向导那七格步骤条的显示文案。
  //
  // 这几格**不是** `WirePhase` —— 它们是向导自己的展示模型（一格可以覆盖好几个
  // 阶段，例如 ALGORITHM READY 同时对应 UPLOAD_A/B 与 PREFLIGHT）。
  // `data-stage` 仍写原始标识符，因此「高亮到哪一格」对测试与语言都无关。
  // V1.4 的七个阶段名：Match Setup / Algorithm Ready / Emitter Lock / Ready / Reveal /
  // Running / Match End。机器标识（`WIZARD_STAGES`，也就是 `data-stage`）保持不变。
  'judge.stage.setup': '比赛筹备',
  'judge.stage.algorithmReady': '算法就绪',
  'judge.stage.emitterLock': '锚点锁定',
  'judge.stage.ready': '就绪',
  'judge.stage.startMatch': '揭晓',
  'judge.stage.round': '进行中',
  'judge.stage.matchEnd': '终局',

  // ---------------------------------------------------------------- round errors
  // 服务端下发的本轮错误（`RoundSummaryView.errorKeys`）。
  //
  // 键由服务端给、译文由客户端取 —— 与 `action.*` 同一套做法：错误码到结论的
  // 映射（`explainError`）是引擎侧的规则，浏览器不得自己再推一套。
  // 错误码本身（TIMEOUT / INVALID / CRASH）是机器标识，两种语言里都原样保留。
  'round.error.noAttack': 'Team {team}：本轮没有执行攻击',
  'round.error.TIMEOUT': 'Team {team}：TIMEOUT —— 未在计算预算内交出 result.json',
  'round.error.CRASH': 'Team {team}：CRASH —— 算法进程异常退出',
  'round.error.INVALID': 'Team {team}：INVALID —— 输出不是合法函数',
  'round.error.OUTPUT_TOO_LARGE': 'Team {team}：INVALID —— 输出超过体积上限',
  'round.error.MEMORY_LIMIT': 'Team {team}：CRASH —— 超出内存上限',
  'round.error.READY_TIMEOUT': 'Team {team}：CRASH —— 未能在启动阶段完成握手',
  'round.error.SPAWN_ERROR': 'Team {team}：CRASH —— 无法启动沙箱进程',
  'round.error.CANCELLED': 'Team {team}：RUNNER CANCELLED（历史字段）—— 运行器被宿主中止',
  'round.error.RUNNER_ABORT': 'Team {team}：对手未能完成 READY 握手，本轮中止（本队无过错）',
  'round.error.unknown': 'Team {team}：异常 {code}',

  // ---------------------------------------------------------------- arena
  'arena.label': '竞技场',
  'arena.labelInteractive': '竞技场（可点击选择）',
} as const;

/** 全部翻译键 —— 由中文表推导，因此不可能出现「英文有、中文没有的键」 */
export type TranslationKey = keyof typeof zh;

/**
 * 英文表。
 *
 * `Record<TranslationKey, string>` 是刻意的：**少一个键就编译不过**。
 * 这就是「加了中文忘了加英文」这道防线的全部实现。
 */
const en: Record<TranslationKey, string> = {
  'app.notFound': 'No such page.',
  'app.title': 'Geometry Battle — local match',
  'app.brand': 'GEOMETRY BATTLE',

  'nav.label': 'Site navigation',
  'nav.home': 'Home',
  'nav.judge': 'Judge',
  'nav.teamA': 'Team A',
  'nav.teamB': 'Team B',
  'nav.spectator': 'Spectator',
  'nav.replays': 'Replays',
  'nav.replay': 'This match’s replay',

  'lang.switch': 'Language',
  'lang.zh': '中文',
  'lang.en': 'EN',

  'common.connecting': 'Connecting to the local match service…',
  'common.readonly': 'read-only',
  'common.unnamed': '(unnamed)',
  'common.unknown': 'unknown',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.none': 'none',
  'common.noFiles': '(no files yet)',

  'conn.label': 'Connection',
  'conn.connecting': 'connecting…',
  'conn.waiting': 'connected · waiting for match state',
  'conn.waitingBody': 'Connected, waiting for match state…',
  'conn.live': 'live',
  'conn.reconnecting': 'reconnecting · attempt {n}',
  'conn.disconnected': 'disconnected · still retrying ({n})',
  'conn.unauthorized': 'no access',
  'conn.unreachable': 'service unreachable',

  'status.neutral': 'not set',
  'status.waiting': 'waiting',
  'status.ready': 'ready',
  'status.active': 'active',
  'status.warning': 'attention',
  'status.error': 'error',
  'status.terminal': 'ended',

  'preflight.never': 'not run',
  'preflight.ok': 'passed',
  'preflight.fail': 'failed',

  'notice.scope.participant': 'Participant',
  'notice.scope.package': 'Package',
  'notice.scope.preflight': 'Preflight',
  'notice.scope.round': 'Round',
  'notice.scope.judge': 'Judge action',
  'notice.scope.connection': 'Connection',
  'notice.scope.server': 'Server',
  'notice.retry': 'Retry',

  'teamLabel.A': 'Team A',
  'teamLabel.B': 'Team B',
  'primary.shortcut': 'Shortcut {keys}',

  'verdict.win': 'TEAM {team} WINS',
  'verdict.draw': 'DRAW',

  'phase.SETUP': 'Waiting for algorithms',
  'phase.UPLOAD_A': 'Team A loaded',
  'phase.UPLOAD_B': 'Team B loaded',
  'phase.PREFLIGHT': 'Validating',
  'phase.EMITTER_SELECT': 'Choosing emitters',
  'phase.READY': 'Ready',
  'phase.PUBLIC': 'Round frozen — awaiting reveal',
  'phase.REVEAL': 'Revealed — awaiting START',
  'phase.COUNTDOWN': 'START issued',
  'phase.COMPUTING': 'Both algorithms computing',
  'phase.ROUND_RESULT': 'Round settled',
  'phase.MATCH_END': 'Match finished',

  'compute.idle': 'not run',
  'compute.running': 'computing…',
  'compute.done': 'done',
  'compute.error': 'error',

  'access.missing.title': 'This page is missing its access token',
  'access.missing.body':
    'Open this page from the link in the judge console’s “Participant entry” panel — the #t=… at the end of the address is this match’s token. Do not delete it by hand.',
  'access.unauthorized.title': 'This match’s token is no longer valid',
  'access.unauthorized.body':
    'A new token is issued for every match, so a link from a previous match stops working. Ask the judge for this match’s link (they can copy it from “Participant entry”).',
  'access.unreachable.title': 'Cannot reach the local service',
  'access.unreachable.body':
    'The match service may have exited, or the port changed. Check that it is still running.',

  'team.title': 'Team {team}',
  'team.phase': 'Phase: {label}',
  'team.devMode': 'Development mode (tournament checks disabled)',

  'team.steps.upload': 'Upload package',
  'team.steps.verify': 'Validation',
  'team.steps.select': 'Pick emitter',
  'team.steps.lock': 'Lock',

  'team.package.title': 'Algorithm package',
  'team.package.ready': 'Ready',
  'team.package.notReady': 'Not ready',
  'team.upload.folder': 'Choose folder',
  'team.upload.folderHint': 'A whole algorithm directory (must contain solver.py at its root)',
  'team.upload.files': 'Choose files / ZIP',
  'team.upload.filesHint': 'A single solver.py, several files, or one .zip',
  'team.upload.accepts':
    'Three accepted forms: a single solver.py, a whole algorithm directory, or one .zip.',
  'team.upload.pipeline':
    'Uploads go through the same pipeline as a real match (staging → validate → sandbox preflight → seal → replace). The browser cannot bypass it.',
  'team.files.title': 'Files',
  'team.files.count': '{n}',
  'team.files.empty': '(no files yet)',
  'team.source.binary': 'Binary file — preview unavailable',
  'team.source.truncated': 'Content truncated (showing the beginning only)',

  'team.emitter.title': 'Fixed Emitter for this match',
  'team.emitter.locked': 'Locked',
  'team.emitter.selected': 'Picked (not locked)',
  'team.emitter.none': 'Not picked',
  'team.emitter.desc':
    'Pick one of your own starting points as this match’s emitter. It is fixed for the whole match, cannot be killed, and is not a combat point — the other points are the Combat Points. Both anchors become public only after both teams have locked.',
  'team.emitter.pickCaption': 'Pick one of these points as this match’s anchor',
  'team.emitter.lockCaption': 'Lock it once picked — it cannot be changed afterwards',
  'team.emitter.lockButton': 'Lock Emitter',
  'team.emitter.waiting':
    'Choosing opens once the match starts — the judge generates the map in the “Prepare” step and this phase follows.',
  'team.emitter.revealedTitle': 'Emitters',
  'team.emitter.public': 'public',
  'team.emitter.hidden': 'hidden',
  'team.emitter.hiddenBody': 'Public once both teams have locked. Your opponent {state}.',
  'team.emitter.opponentLocked': 'has locked',
  'team.emitter.opponentUnlocked': 'has not locked yet',

  'team.candidate.selectedMark': 'selected',
  'team.candidate.alive': 'alive',
  'team.candidate.dead': 'dead',

  'team.arena.hint': 'Click a point in the arena to pick it as the emitter (or use the list above).',

  'team.note.selected': 'Picked {id}',
  'team.note.locked': 'Emitter locked',
  'team.note.installed': 'Installed files: {n}',
  'team.note.installedWithHash': 'Installed files: {n}, package hash {hash}…',

  'team.err.commandFailed': 'Command failed',
  'team.err.uploadFailed': 'Upload failed',
  'team.err.readFailed': 'Could not read the file',

  'team.section.source': 'Source',
  'team.section.status': 'Status',
  'team.steps.preflight': 'Preflight',
  'team.steps.wait': 'Wait for start',
  'team.step.done': 'done',
  'team.step.now': 'current',
  'team.step.todo': 'pending',
  'team.step.error': 'failed',
  'team.status.round': 'Round',
  'team.status.opponent': 'Opponent',
  'team.status.opponentLocked': 'locked',
  'team.status.opponentUnlocked': 'not locked yet',
  'team.next.title': 'Next step',
  'team.next.upload':
    'Upload your team’s package under “Algorithm package”: one .zip, a whole directory, or a single solver.py.',
  'team.next.invalid':
    'The package failed structural validation — fix the errors listed under the upload controls and upload again.',
  'team.next.bundled':
    'Tournament mode: the slot holds a bundled template algorithm, which does not count as ready — upload your team’s real package.',
  'team.next.preflightFailed': 'Preflight failed — fix the algorithm and upload it again.',
  'team.next.preflightPending':
    'This package has no install record and Preflight has not run — the judge’s “Prepare” step runs it once in the sandbox.',
  'team.next.waitJudge':
    'Algorithm ready. Waiting for the judge to prepare the match and generate the map; then pick your Emitter here.',
  'team.next.select':
    'Pick one of the candidate points under “Fixed Emitter for this match” (or click a point in the arena).',
  'team.next.lock': 'Picked {id}. Lock it when you are sure — it cannot be changed for the rest of the match.',
  'team.next.waitOpponent':
    'Emitter locked. Waiting for the opponent to lock; both anchors go public once both sides have locked.',
  'team.next.waitStart': 'Both anchors are public. Waiting for the judge to start the match (Reveal → START).',
  'team.next.running': 'Match in progress — round {round}. Nothing to do on this page; watch the spectator screen.',
  'team.next.ended': 'The match has ended.',
  'team.package.hash': 'Package hash',
  'team.package.validation': 'Validation',
  'team.package.entry': 'Entry',
  'team.package.files': 'Files',
  'team.package.invalidTitle': 'The package failed validation',
  'team.package.invalidNext':
    'Fix it and upload again. An upload never touches the package already in the slot unless the new one passes every check.',
  'team.upload.title': 'Upload the package',
  'team.upload.replaceTitle': 'Replace the package',
  'team.upload.replaceImpact':
    'A new package goes through full validation and one Preflight run again; a rejected upload leaves the current package untouched. Once match preparation has begun, the server refuses replacements.',
  'team.upload.busy': 'Installing and validating… (includes one sandbox Preflight; may take tens of seconds)',
  'team.source.pickHint': 'Click a file name to view it (read-only).',
  'team.emitter.lockedBadge': 'LOCKED',
  'team.emitter.immutable': 'Cannot be changed for this match.',
  'team.emitter.yours': 'Your emitter',
  'team.arena.title': 'Arena',
  'team.arena.note': 'Your points only; obstacles stay hidden until Reveal',
  'team.serverError.title':
    'The match service reported a failure — the match is paused at its current phase until the judge resolves it.',

  'judge.title': 'Judge',
  'judge.teamCard.unnamed': '(unnamed)',
  'judge.teamCard.nameTitle': 'Name reported by the package itself',
  'judge.teamCard.ready': 'Algorithm ready',
  'judge.teamCard.notReady': 'Not ready',
  'judge.teamCard.emitterLocked': 'Anchor {id}',
  'judge.teamCard.emitterLockedNoId': 'locked',
  'judge.teamCard.emitterUnlocked': 'Anchor not locked',

  'judge.links.title': 'Participant entry',
  'judge.links.subtitle': 'This match only · rotates every match',
  'judge.links.desc':
    'Send each team its own link. The link carries this match’s access token: do not put it on the big screen and do not send it to the other team — whoever holds a token can act as that team.',

  'judge.wizard.title': 'Judge wizard',
  'judge.wizard.waitingBody':
    'Both players complete this step on their own participant page; the judge has no action here.',
  'judge.wizard.busy': 'Running… (commands are serial; buttons stay disabled while busy)',
  'judge.wizard.busyShort': 'Running…',
  'judge.wizard.whyEnabled': 'Server verdict: available — {hint}',
  'judge.wizard.whyDisabled': 'Server verdict: unavailable — {hint}',

  'judge.step.SETUP':
    'Seal both teams’ algorithms into this match. Players upload their packages on their own participant pages first; once both are ready, the next step does “seal → validate → create” in one go.',
  'judge.step.UPLOAD_A': 'Team A is sealed. Once Team B’s algorithm is ready, a single step finishes preparation.',
  'judge.step.UPLOAD_B':
    'Both algorithms are in their slots: one step does “seal both → sandbox Preflight → create match”, then emitter selection begins.',
  'judge.step.PREFLIGHT':
    'Both algorithms really run once in the sandbox (Preflight) to confirm they produce a legal function.',
  'judge.step.EMITTER_SELECT':
    'The map is generated. Each side picks and locks its emitter on its own participant page — the players do this and the judge waits here. Both anchors go public once both sides lock.',
  'judge.step.READY': 'Both emitters are locked and the anchors are public. The round can begin.',
  'judge.step.PUBLIC':
    'This round’s public_state is frozen. Reveal the obstacles — contestant code still has not run a line.',
  'judge.step.REVEAL':
    'Obstacles are public and contestant code still has not run. START is the only switch that lets it run.',
  'judge.step.COUNTDOWN':
    'START has been issued; both algorithms begin once the countdown reaches zero.',
  'judge.step.COMPUTING':
    'Both algorithms are computing in their own sandboxes; this round is being settled.',
  'judge.step.ROUND_RESULT': 'This round is settled; you can move to the next one.',
  'judge.step.MATCH_END': 'The match has ended. Open the replay; to start a new match, run Reset under Advanced (confirmation required).',

  'judge.emitter.title': 'Emitters',
  'judge.emitter.revealed': 'Both locked · anchors public',
  'judge.emitter.hidden': 'Not revealed',
  'judge.emitter.none': 'not picked',
  'judge.emitter.unknown': 'unknown',
  'judge.emitter.locked': 'locked',
  'judge.emitter.unlocked': 'not locked',
  'judge.emitter.notSent': 'The server has not sent either side’s choice — this page does not guess.',

  'judge.header.round': 'Round',
  'judge.header.seed': 'seed',

  'judge.slot.empty': 'Slot is empty',
  'judge.slot.settings': 'Points: {points} · {difficulty}',

  'judge.adv.summary': 'Advanced Controls · low-level actions & match settings',
  'judge.adv.desc':
    'The wizard highlights the one thing to do now; this is every action the server offers, including the low-level steps the wizard does not use. Availability is still read from the server — hover a greyed-out button to see why.',
  'judge.adv.installDesc':
    'For a real match use the wizard’s “seal both → validate → create match” — players upload their packages on the participant pages. Use this only to swap in an algorithm temporarily; it takes an absolute directory path on the server and asks for confirmation before replacing.',
  'judge.adv.teamDir': 'Team {team} algorithm directory',
  'judge.adv.pathPlaceholder': '/absolute/path/to/package',
  'judge.adv.install': 'Install Team {team} algorithm',
  'judge.adv.installWhy': 'Enter the absolute directory path on the server before installing',
  'judge.adv.installReady': 'Clicking shows the impact first, then replaces the package in the slot',
  'judge.adv.settingsDesc': 'Match settings — applied on the next reset / new match.',
  'judge.adv.seed': 'Seed (blank = random)',
  'judge.adv.points': 'Combat points (blank = keep)',
  'judge.adv.difficulty': 'Difficulty (blank = keep)',
  'judge.adv.keepDifficulty': 'keep {value}',

  'judge.audit.events': 'Events: {n}',
  'judge.audit.runtimeOk': '✓ matches the frozen manifest',
  'judge.audit.runtimeMismatch': '✕ differs from the frozen manifest',

  'judge.lastRound.attacks': 'Attacks',
  'judge.lastRound.kills': 'Kills',
  'judge.lastRound.alive': 'Alive',
  'judge.lastRound.verdict': 'Result',
  'judge.lastRound.notConnected': 'This action is not wired into the UI yet: {key}',
  'judge.lastRound.headline': 'R{round} · first {first}',

  'judge.section.matchStatus': 'Match status',
  'judge.section.audit': 'Audit · Source review',
  'judge.status.map': 'Map',
  'judge.teamCard.hashSealed': 'Sealed hash',
  'judge.teamCard.hashSlot': 'Package hash',
  'judge.teamCard.source': 'Source',
  'judge.teamCard.compute': 'Compute',
  'judge.teamCard.originInstalled': 'installed by this platform',
  'judge.teamCard.originUnrecorded': 'no install record',
  'judge.lastError.title': 'Background run failed — the match stays in its current phase',
  'judge.lastError.retryHint':
    'Once the cause is fixed, run “Run the remaining rounds back-to-back” again from the primary action; no new match is needed and both Emitter locks stay as they are.',
  'judge.action.failed': '“{action}” was not executed',
  'judge.action.next': 'The server refused; the match state is unchanged. Fix the cause and press again.',
  'judge.danger.title': 'Confirmation required',
  'judge.danger.resetImpact':
    'Clears both Emitter locks and issues a new matchId and participant links; the match settings under Advanced apply now. The old participant links stop working immediately.',
  'judge.danger.installImpact':
    'Replaces the package in Team {team}’s slot; the new package needs a fresh Preflight. The server refuses replacements once the match has started.',
  'judge.danger.confirm': 'Confirm: {label}',
  'judge.danger.cancel': 'Cancel',
  'judge.round.errorsTitle': 'Algorithm errors this round (settled per the rules)',
  'judge.audit.runtime': 'Runtime',
  'judge.audit.recent': 'Recent events',
  'judge.audit.files': 'Files: {n} · {bytes} B',
  'slotStatus.EMPTY': 'empty',
  'slotStatus.READY': 'ready',
  'slotStatus.INVALID': 'invalid',

  'action.useSlot.label': 'Use the algorithm in the slot (Team {team})',
  'action.useSlot.hint.factory':
    'Tournament mode: the slot holds the factory starter — upload and install a real package',
  'action.useSlot.hint.notReady': 'Slot {team} is not usable yet ({status})',
  'action.useSlot.hint.phase': 'Phase {phase} does not allow loading Team {team}',
  'action.useSlot.hint.ok': 'Seal the algorithm in the slot into this match',

  'action.prepare.label': 'Prepare the match (seal both → validate → create)',
  'action.prepare.hint.notReady': 'Both algorithms must be ready first',
  'action.prepare.hint.notReadyTournament':
    'Both algorithms must be ready first (tournament mode: a real uploaded package is required)',
  'action.prepare.hint.phase': 'Phase {phase} cannot prepare',
  'action.prepare.hint.ok':
    'Seal the copies → sandbox Preflight → generate the map (then emitter selection)',

  'action.preflight.label': 'Validate both algorithms (Preflight)',
  'action.preflight.hint': 'Really run them once in the sandbox to confirm they produce a legal function',

  'action.start.label': 'Start the match (enter round 1)',
  'action.start.hint.ready': 'Generate the map and enter round 1',
  'action.start.hint.needPreflight': 'Preflight must pass first',

  'action.reveal.label': 'Reveal this round (REVEAL)',
  'action.reveal.hint': 'Publish this round’s obstacles — contestant code still has not run',

  'action.startRound.label': 'START (contestant code has not run a line before this)',
  'action.startRound.hint': 'The only switch that lets contestant code run',

  'action.compute.label': 'Settle this round (play the trajectory)',
  'action.compute.hint': 'Run both algorithms and settle the round',

  'action.runToEnd.label': 'Run the remaining rounds back-to-back',
  'action.runToEnd.hint': 'Advance in the background until the match ends; you can keep watching',

  'action.reset.label': 'Reset the match',
  'action.reset.labelWithMatch': 'End this match and reset',
  'action.reset.hint': 'Back to the initial state, ready for the next match',

  'action.selectEmitter.label': 'Pick this match’s Emitter',
  'action.selectEmitter.hint.locked': 'Locked — fixed for the whole match',
  'action.selectEmitter.hint.phase': 'Phase {phase} does not allow picking an Emitter',
  'action.selectEmitter.hint.ok': 'Pick one of your own starting points as this match’s emitter',

  'action.lockEmitter.label': 'Lock Emitter',
  'action.lockEmitter.hint.locked': 'Locked',
  'action.lockEmitter.hint.needSelect': 'Pick an Emitter first',
  'action.lockEmitter.hint.ok': 'Fixed for the whole match once locked; both anchors go public when both sides lock',

  'spectator.round': 'Round',
  'spectator.alive': 'Team {team} alive',
  'spectator.firstSolver': 'First solver',
  'spectator.emitter': 'Emitter',
  'spectator.emitterPending': 'not public yet',
  'spectator.readyNextRound': 'Round settled · awaiting the next round',
  'spectator.note.attacks': 'Attacks {attacks}   Kills {kills}',
  'spectator.note.noAttacks': 'none',
  'spectator.verdictRound': 'ROUND {n}',

  'replay.title': 'Replay',
  'replay.loading': 'Loading replay…',
  'replay.rounds': 'Rounds',
  'replay.roundsCount': 'Rounds: {n}',
  'replay.others': 'Other matches',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.prev': 'Previous round',
  'replay.next': 'Next round',
  'replay.slider': 'Round',
  'replay.counter': 'Round {n} / {total}',
  'replay.speed': 'Playback speed',
  'replay.speedOption': '{x}× speed',
  'replay.player': 'Replay player — ← → change round, Space play / pause, Home / End first / last round',
  'replay.first': 'First solver',
  'replay.attacks': 'Attacks',
  'replay.kills': 'Kills',
  'replay.time': 'Compute time',
  'replay.frameEnd': 'Match ended this round · {reason}',
  'replay.loadTitle': 'This replay cannot be opened',
  'replay.backToList': 'Back to the replay list',
  'replay.meta': 'Points: {points} · {difficulty} · seed {seed}',
  'replay.frameSummary': 'first {first} · attacks {attacks} · kills {kills}',
  'replay.roundShort': 'R{n}',
  'replay.roundsBadge': '{n}R',
  'replay.loadFailed': 'Could not load (HTTP {status})',
  'replay.reason.notFound': 'No such match',
  'replay.reason.incomplete': 'This match’s artifacts are incomplete',
  'replay.reason.broken': 'Artifacts are missing or cannot be parsed',
  'replay.reason.unfinished': 'This match did not finish normally, so it cannot be replayed',
  'replay.reason.legacyNoEnd':
    'This artifact comes from an older version (no end-reason field); its result cannot be trusted',
  'replay.reason.legacyContradiction':
    'End reason {endReason} contradicts winner {winner} (older artifact); the result cannot be trusted',

  'err.httpFailed': 'Request failed (HTTP {status})',
  'err.unreachable': 'Cannot reach the local service: {message}',
  'err.noFilesPicked': 'No files selected',
  'err.unzipFailed': 'Could not extract {name}: {message}',

  'zip.bomb': 'Extracted size exceeds the {bytes}-byte limit — looks like a ZIP bomb',
  'zip.notZip': 'Not a valid ZIP file',
  'zip.tooManyEntries': 'ZIP has too many entries ({n})',
  'zip.centralCorrupt': 'ZIP central directory is corrupt',
  'zip.localCorrupt': 'ZIP local header is corrupt: {name}',
  'zip.declaredTooBig': 'ZIP entry declares an oversized file: {name}',
  'zip.unsupportedMethod': 'Unsupported ZIP compression method {method} (only stored / deflate)',
  'zip.totalTooBig': 'ZIP entries total more than the {bytes}-byte limit',
  'zip.crcMismatch': 'ZIP checksum mismatch: {name} (file is corrupt)',
  'zip.empty': 'ZIP contains no files',

  'difficulty.easy': 'Easy',
  'difficulty.medium': 'Medium',
  'difficulty.hard': 'Hard',

  'endReason.ELIMINATION': 'Elimination',
  'endReason.MUTUAL_ELIMINATION': 'Mutual elimination',
  'endReason.STALEMATE': 'Stalemate',
  'endReason.HARD_ROUND_LIMIT': 'Hard round limit',
  'endReason.NONE': 'Not ended',

  'firstSolver.A': 'TEAM A',
  'firstSolver.B': 'TEAM B',
  'firstSolver.tie': 'simultaneous',
  'firstSolver.none': 'none',

  'home.eyebrow': 'Local match system',
  'home.title': 'Choose your role',
  'home.lead':
    'Judge, teams and spectators each have their own entry. The Judge and Team pages need this match’s access link (the #t=… at the end of the address); the Spectator view and replays do not.',
  'home.role.judge.title': 'Judge',
  'home.role.judge.desc':
    'Create the match, validate both algorithms, reveal, issue START, run the remaining rounds. One machine has exactly one judge console.',
  'home.role.team.desc':
    'Upload the algorithm package, pass validation, pick and lock this match’s Emitter. Once locked it cannot be changed.',
  'home.role.spectator.title': 'Spectator',
  'home.role.spectator.desc':
    'A read-only, full-width arena: round, alive counts, first solver and the verdict. No token needed and no controls.',
  'home.role.enter': 'Open',
  'home.role.enterWithoutToken': 'Open without a token (the page will say the token is missing)',
  'home.access.required': 'Access link required',
  'home.access.teamNote':
    'Open this page from the link handed out in the judge console’s “Participant entry” panel: the #t=… at the end of the address is this match’s token. It stays in the address bar and is never stored.',
  'home.access.judgeNote':
    'The judge link is printed in the terminal that started the service (/judge#t=…). The token stays in the address bar and is never stored.',
  'home.access.pasteLabel': 'Paste an access link or token',
  'home.access.pastePlaceholder': 'http://…#t=… or the token itself',
  'home.access.go': 'Open',
  'home.access.invalid':
    'This does not look like an access link or token. A link must be on this site and carry #t=…; a token is letters, digits, - and _.',
  'home.replays.title': 'Recent matches',
  'home.replays.all': 'All replays →',

  'replays.title': 'Replays',
  'replays.count': 'Matches: {n}',
  'replays.loading': 'Loading the match list…',
  'replays.loadFailed': 'Could not load the match list',
  'replays.empty': 'No replayable match yet — the first finished match will appear here.',
  'replays.col.ended': 'Ended',
  'replays.col.match': 'Match',
  'replays.col.teams': 'Teams',
  'replays.col.result': 'Result',
  'replays.col.reason': 'End reason',
  'replays.col.rounds': 'Rounds',
  'replays.vs': '{a} vs {b}',
  'replays.open': 'Open replay',

  'judge.stage.setup': 'Match Setup',
  'judge.stage.algorithmReady': 'Algorithm Ready',
  'judge.stage.emitterLock': 'Emitter Lock',
  'judge.stage.ready': 'Ready',
  'judge.stage.startMatch': 'Reveal',
  'judge.stage.round': 'Running',
  'judge.stage.matchEnd': 'Match End',

  'round.error.noAttack': 'Team {team}: no attack executed this round',
  'round.error.TIMEOUT': 'Team {team}: TIMEOUT — no result.json within the compute budget',
  'round.error.CRASH': 'Team {team}: CRASH — the algorithm process exited abnormally',
  'round.error.INVALID': 'Team {team}: INVALID — the output is not a legal function',
  'round.error.OUTPUT_TOO_LARGE': 'Team {team}: INVALID — the output exceeds the size limit',
  'round.error.MEMORY_LIMIT': 'Team {team}: CRASH — memory limit exceeded',
  'round.error.READY_TIMEOUT': 'Team {team}: CRASH — the READY handshake did not complete',
  'round.error.SPAWN_ERROR': 'Team {team}: CRASH — the sandbox process could not be started',
  'round.error.CANCELLED':
    'Team {team}: RUNNER CANCELLED (legacy field) — the runner was aborted by the host',
  'round.error.RUNNER_ABORT':
    'Team {team}: the opponent did not complete the READY handshake; this round was aborted (no fault of this team)',
  'round.error.unknown': 'Team {team}: unexpected error {code}',

  'arena.label': 'Arena',
  'arena.labelInteractive': 'Arena (click a point to pick it)',
};

/** locale → 键表 */
export const translations: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zh,
  'en-US': en,
};

/**
 * 把 `{name}` 占位替换成参数值。
 *
 * 缺参**不删占位**，原样留着 —— 那一眼就能看出来是漏传了，
 * 比悄悄渲染出一个空字符串好排查。
 */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  );
}

/** 按 locale 取一条文案并插值 */
export function translate(locale: Locale, key: TranslationKey, params?: Params): string {
  return interpolate(translations[locale][key], params);
}

/**
 * 宽容版：key 来自服务端（`ActionView.labelKey` / `hintKey`），不经过 TS 检查。
 *
 * 认不出来时回退到 `fallback`（服务端给的原文），**绝不把 key 当文案渲染出去**。
 * 全量校验由 `tests/i18n.ts` 盯着 —— 它会把服务端所有动作的 key 都翻一遍，
 * 少一条就变红。
 */
export function translateDynamic(
  locale: Locale,
  key: string,
  params?: Params,
  fallback?: string
): string {
  const table = translations[locale] as Record<string, string | undefined>;
  const hit = table[key];
  if (typeof hit !== 'string') return fallback ?? key;
  return interpolate(hit, params);
}

// ============================================================================
// 当前语言镜像 —— 给**没有 hook 的模块**用
//
// 为什么放在这个文件而不是 I18nContext.tsx：`api/zip.ts` 被 Node 单测直接
// import，而根 tsconfig **没有 `jsx`** —— 一旦 zip.ts 间接依赖到 .tsx，
// 那个单测就编译不过。因此镜像与这两个函数必须待在**纯模块**里。
// ============================================================================

let activeLocale: Locale = FALLBACK_LOCALE;

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** provider 每次切语言都会同步它；单测也可以直接调，不必挂载 React */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** 非组件代码用：按当前语言翻译（键编译期已知） */
export function t(key: TranslationKey, params?: Params): string {
  return translate(getActiveLocale(), key, params);
}

/** 非组件代码用：翻译服务端下发的键，认不出时回退到 fallback */
export function td(key: string, params?: Params, fallback?: string): string {
  return translateDynamic(getActiveLocale(), key, params, fallback);
}

/**
 * 阶段 → 翻译键。
 *
 * 写成 `Record<WirePhase, …>` 是刻意的：引擎**新增一个阶段**而这里没跟上，
 * 编译立刻报错。此前三个页面各抄一份阶段中文表，正是这种地方最容易漂移。
 */
export const PHASE_KEYS: Record<WirePhase, TranslationKey> = {
  SETUP: 'phase.SETUP',
  UPLOAD_A: 'phase.UPLOAD_A',
  UPLOAD_B: 'phase.UPLOAD_B',
  PREFLIGHT: 'phase.PREFLIGHT',
  EMITTER_SELECT: 'phase.EMITTER_SELECT',
  READY: 'phase.READY',
  PUBLIC: 'phase.PUBLIC',
  REVEAL: 'phase.REVEAL',
  COUNTDOWN: 'phase.COUNTDOWN',
  COMPUTING: 'phase.COMPUTING',
  ROUND_RESULT: 'phase.ROUND_RESULT',
  MATCH_END: 'phase.MATCH_END',
};

/**
 * 裁判向导步骤条的七格。
 *
 * 与 `WirePhase` 的区别是**故意的**：这几格是向导自己的展示模型，
 * 一格可以覆盖多个阶段（`ALGORITHM READY` 同时对应 UPLOAD_A / UPLOAD_B / PREFLIGHT）。
 * 把它们写成 `WirePhase` 的别名会让「阶段改了、向导没跟上」编译不过 ——
 * 而它们本来就不该一一对应。
 */
export const WIZARD_STAGES = [
  'SETUP',
  'ALGORITHM READY',
  'EMITTER LOCK',
  'READY',
  'START MATCH',
  'ROUND',
  'MATCH END',
] as const;

export type WizardStage = (typeof WIZARD_STAGES)[number];

export const WIZARD_STAGE_KEYS: Record<WizardStage, TranslationKey> = {
  SETUP: 'judge.stage.setup',
  'ALGORITHM READY': 'judge.stage.algorithmReady',
  'EMITTER LOCK': 'judge.stage.emitterLock',
  READY: 'judge.stage.ready',
  'START MATCH': 'judge.stage.startMatch',
  ROUND: 'judge.stage.round',
  'MATCH END': 'judge.stage.matchEnd',
};

/**
 * 槽位状态枚举 → 译文键。
 *
 * `SlotView.status` 在协议里是 `string`（`src/submission/Slot.ts` 的 `SlotStatus` 依赖 node，
 * 浏览器 import 不了），所以这里写它的**结构镜像**；`tests/web-wizard.ts` 扫 Slot.ts 源码对照，
 * 引擎多一种状态而这里没跟上就变红。枚举原文由调用方放进 `data-slot-status`，不进文案。
 */
export const SLOT_STATUS_KEYS: Record<'EMPTY' | 'READY' | 'INVALID', TranslationKey> = {
  EMPTY: 'slotStatus.EMPTY',
  READY: 'slotStatus.READY',
  INVALID: 'slotStatus.INVALID',
};

/** 槽位状态 → 当前语言的显示文本；认不出就原样显示（同 `endReasonLabel` 的纪律） */
export function slotStatusLabel(locale: Locale, value: string): string {
  const key = ownKey(SLOT_STATUS_KEYS, value);
  return key ? translate(locale, key) : value;
}

/** 难度枚举 → 译文键。`value` 仍是 `easy/medium/hard`，只有显示被翻译。 */
export const DIFFICULTY_KEYS: Record<WireDifficulty, TranslationKey> = {
  easy: 'difficulty.easy',
  medium: 'difficulty.medium',
  hard: 'difficulty.hard',
};

/**
 * 在「枚举 → 译文键」的映射里查一个**运行期字符串**。
 *
 * 必须用 `hasOwnProperty`：这些值来自网络或历史产物，`'constructor'` / `'toString'`
 * 这种名字用普通下标会命中 `Object.prototype` 上的函数 —— 它是 truthy 的，
 * 于是 `translate()` 拿到一个不存在的键、渲染出字面量 “undefined”。
 * 认不出来的值一律返回 null，由调用方决定原样显示。
 */
function ownKey<K extends string>(map: Record<K, TranslationKey>, value: string): TranslationKey | null {
  return Object.prototype.hasOwnProperty.call(map, value)
    ? (map as Record<string, TranslationKey>)[value]
    : null;
}

/**
 * 难度值 → 当前语言的显示文本。
 *
 * 收 `string` 而不是 `WireDifficulty` 是刻意的：**回放读的是历史 match.json**，
 * 那可能是旧版本写下的、或是将来才加的难度。认不出就原样显示 ——
 * 既不崩，也不假装它被翻译过。
 */
export function difficultyLabel(locale: Locale, value: string): string {
  const key = ownKey(DIFFICULTY_KEYS, value);
  return key ? translate(locale, key) : value;
}

/**
 * 终局原因 → 译文键。`Record<WireEndReason, …>`：引擎新增一种终局原因而这里没跟上，
 * 编译立刻报错。枚举原文由调用方放进 `data-end-reason`，不进文案。
 */
export const END_REASON_KEYS: Record<WireEndReason, TranslationKey> = {
  ELIMINATION: 'endReason.ELIMINATION',
  MUTUAL_ELIMINATION: 'endReason.MUTUAL_ELIMINATION',
  STALEMATE: 'endReason.STALEMATE',
  HARD_ROUND_LIMIT: 'endReason.HARD_ROUND_LIMIT',
  NONE: 'endReason.NONE',
};

/** 终局原因 → 当前语言的显示文本；认不出（历史产物）就原样显示 */
export function endReasonLabel(locale: Locale, value: string): string {
  const key = ownKey(END_REASON_KEYS, value);
  return key ? translate(locale, key) : value;
}

/** `RoundSummaryView.firstSolver` 的四个取值 → 译文键 */
export const FIRST_SOLVER_KEYS: Record<'A' | 'B' | 'tie' | 'none', TranslationKey> = {
  A: 'firstSolver.A',
  B: 'firstSolver.B',
  tie: 'firstSolver.tie',
  none: 'firstSolver.none',
};

/** 先手 → 当前语言的显示文本；此前 `tie` / `none` 被拼成 “TEAM TIE” */
export function firstSolverLabel(locale: Locale, value: string): string {
  const key = ownKey(FIRST_SOLVER_KEYS, value);
  return key ? translate(locale, key) : value;
}

/**
 * 胜者 → 判决文案（`TEAM A 获胜` / `DRAW`）。
 *
 * 三块板与回放此前各自写 `TEAM ${winner}` —— 语序与措辞散在四处。
 * 认不出的值（历史产物）原样返回。
 */
export function winnerLabel(locale: Locale, winner: string): string {
  if (winner === 'A' || winner === 'B') return translate(locale, 'verdict.win', { team: winner });
  if (winner === 'draw') return translate(locale, 'verdict.draw');
  return winner;
}

/**
 * 本轮错误的译文键 → 由服务端 `RoundSummaryView.errorKeys` 给出。
 *
 * 写成普通字符串而不是 `TranslationKey` 是刻意的：这些键随 board 走，
 * 不经过 TS 检查，认不出时必须回退到服务端原文（`errors[i]`）。
 */
export function localizeRoundErrors(
  locale: Locale,
  errors: readonly string[],
  keys?: readonly string[],
  params?: readonly (Record<string, string | number> | undefined)[]
): string[] {
  return errors.map((raw, i) => translateDynamic(locale, keys?.[i] ?? '', params?.[i], raw));
}
