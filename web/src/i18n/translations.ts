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
import type { WirePhase } from '../../../src/server/protocol';

/** 中文表 —— 键的唯一事实来源 */
const zh = {
  // ---------------------------------------------------------------- app / nav
  'app.notFound': '没有这个页面。',
  'app.title': '几何斗殴 — 本地比赛',

  'nav.judge': '裁判台',
  'nav.teamA': '参赛者 A',
  'nav.teamB': '参赛者 B',
  'nav.spectator': '观众大屏',
  'nav.openSpectator': '打开观众大屏 ↗',
  'nav.spectatorArrow': '观众大屏 ↗',
  'nav.replay': '回放',
  'nav.backToJudge': '回到裁判台',

  'lang.switch': '语言',
  'lang.zh': '中文',
  'lang.en': 'EN',

  // ---------------------------------------------------------------- common
  'common.connecting': '正在连接本地比赛服务…',
  'common.connected': '已连接',
  'common.connectingShort': '连接中…',
  'common.live': '● 实时',
  'common.offline': '○ 未连接',
  'common.readonly': '只读',
  'common.unnamed': '（未命名）',
  'common.unknown': '未知',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.none': '无',
  'common.noFiles': '（还没有文件）',

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

  'team.emitter.title': '本场 Fixed Emitter',
  'team.emitter.locked': '已锁定',
  'team.emitter.selected': '已选择（未锁定）',
  'team.emitter.none': '未选择',
  'team.emitter.desc':
    '从自己的初始点里选一个作为本场的发射点（Emitter）。它整场不可更换、不可击杀、也不是战斗点；其余的点才是 Combat Points。双方都锁定之后，两个锚点才会公开。',
  'team.emitter.pickCaption': '从下面这些点里挑一个作为本场锚点',
  'team.emitter.lockCaption': '选定之后锁定 —— 锁定后整场不可更换',
  'team.emitter.lockButton': '锁定 Emitter',
  'team.emitter.waiting': '比赛开始之后才能选择 —— 裁判在「筹备」一步生成地图，随后进入本阶段。',
  'team.emitter.candidatesEmpty': '裁判尚未生成地图。',
  'team.emitter.revealedTitle': '双方锚点',
  'team.emitter.public': '已公开',
  'team.emitter.hidden': '未公开',
  'team.emitter.hiddenBody': '双方都锁定之后才会公开。对方现在{state}。',
  'team.emitter.opponentLocked': '已锁定',
  'team.emitter.opponentUnlocked': '尚未锁定',

  'team.candidate.selectedMark': '← 已选择',
  'team.candidate.alive': '存活',
  'team.candidate.dead': '阵亡',

  'team.arena.title': '场面',
  'team.arena.hint': '点击场上的点即可选为 Emitter（也可以在上面列表里点）。',

  'team.note.selected': '已选择 {id}',
  'team.note.locked': 'Emitter 已锁定',
  'team.note.installed': '已安装 {n} 个文件',
  'team.note.installedWithHash': '已安装 {n} 个文件，包哈希 {hash}…',

  'team.err.commandFailed': '命令失败',
  'team.err.uploadFailed': '上传失败',
  'team.err.readFailed': '读取失败',

  // ---------------------------------------------------------------- judge
  'judge.title': '裁判台',
  'judge.teamCard.unnamed': '（未命名）',
  'judge.teamCard.nameTitle': '算法包自报的名字',
  'judge.teamCard.ready': '算法就绪',
  'judge.teamCard.notReady': '未就绪',
  'judge.teamCard.emitterLocked': '锚点 {id}',
  'judge.teamCard.emitterLockedNoId': '已锁定',
  'judge.teamCard.emitterUnlocked': '锚点未锁定',
  'judge.teamCard.sealed': '本场密封 {hash}…',
  'judge.teamCard.notSealed': '本场未密封',
  'judge.teamCard.preflightNever': '未经本平台安装',
  'judge.teamCard.preflightOk': 'Preflight ✓',
  'judge.teamCard.preflightFail': 'Preflight ✕',

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
    '把双方的算法密封进本场比赛。选手要先把算法投进运行期槽位（见下方「投递点」）；两边都就绪时，下面这一步一次做完「封装 → 校验 → 建赛」。',
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
  'judge.step.MATCH_END': '比赛已终止。可以看回放，或开新的一场。',

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

  'judge.slot.title': '算法槽位',
  'judge.slot.settings': '{points} 点 · {difficulty}',
  'judge.slot.deliveryPoint': '投递点',
  'judge.slot.summary': '{files} 文件 · {bytes} B · preflight {state}',
  'judge.slot.empty': '槽位为空',
  'judge.slot.installed': '已安装 · 来源 {source}',
  'judge.slot.unrecorded': '无安装记录（出厂播种 / 手工放置）',
  'judge.slot.hash': '包哈希 {hash}…',
  'judge.slot.sealed': '本场已密封 {hash}',
  'judge.slot.readonly': '只读',

  'judge.adv.summary': 'Advanced Controls · 底层动作与比赛设置',
  'judge.adv.desc':
    '向导只突出「现在该做的那一个」；这里是服务端下发的全部动作（含向导未用到的底层步骤）。可用性同样只读服务端的判据 —— 灰掉的按钮把鼠标悬上去就是原因。',
  'judge.adv.installDesc':
    '正式比赛请用向导里的「封装双方算法 → 校验 → 建赛」—— 算法要投进运行期槽位（见上方「投递点」）。这里只在需要临时换算法时使用，输入的是服务端上的目录绝对路径。',
  'judge.adv.teamDir': 'Team {team} 算法目录',
  'judge.adv.pathPlaceholder': '/绝对/路径/到/算法包',
  'judge.adv.install': '安装 Team {team} 算法',
  'judge.adv.settingsDesc': '比赛设置 —— 在下一次「重置 / 下一场」时生效。',
  'judge.adv.seed': '种子（留空 = 随机）',
  'judge.adv.points': '战斗点数（留空 = 沿用）',
  'judge.adv.difficulty': '难度（留空 = 沿用）',
  'judge.adv.keepDifficulty': '沿用 {value}',

  'judge.audit.title': '审计',
  'judge.audit.events': '{n} 事件',
  'judge.audit.artifacts': '产物：{dir}',
  'judge.audit.noArtifacts': '尚未产生产物',
  'judge.audit.runtimeOk': '✓ 与冻结清单一致',
  'judge.audit.runtimeMismatch': '✕ 与冻结清单不符',

  'judge.lastRound.attacks': '本轮攻击',
  'judge.lastRound.kills': '击杀',
  'judge.lastRound.alive': '存活',
  'judge.lastRound.verdict': '终局',
  'judge.lastRound.draw': '平局',
  'judge.lastRound.winner': 'TEAM {team} 获胜',
  'judge.lastRound.notConnected': '界面尚未接入该动作：{key}',
  'judge.lastRound.headline': '第 {round} 轮 · TEAM {team} 先手',

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
  'spectator.tie': '同时',
  'spectator.emitters': '本场发射锚点',
  'spectator.readyNextRound': '本轮已结算 · 等待下一轮',
  'spectator.note.attacks': '本轮攻击 {attacks}   击杀 {kills}',
  'spectator.note.noAttacks': '未执行',
  'spectator.verdict.draw': '平局 DRAW',

  // ---------------------------------------------------------------- replay
  'replay.title': '回放',
  'replay.loading': '正在读取回放…',
  'replay.rounds': '逐轮',
  'replay.roundsCount': '{n} 回合',
  'replay.others': '其他场次',
  'replay.frameKills': '击杀 {kills}',
  'replay.play': '播放',
  'replay.pause': '暂停',
  'replay.prev': '上一轮',
  'replay.next': '下一轮',
  'replay.slider': '回合',
  'replay.meta': '{points} 点 · {difficulty} · seed {seed}',
  'replay.frameSummary': 'first {first} · 攻击 {attacks} · 击杀 {kills}',
  'replay.draw': '平局',
  'replay.winner': 'TEAM {team} 获胜',
  'replay.loadFailed': '读取失败（HTTP {status}）',

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

  'nav.judge': 'Judge',
  'nav.teamA': 'Team A',
  'nav.teamB': 'Team B',
  'nav.spectator': 'Spectator',
  'nav.openSpectator': 'Open spectator view ↗',
  'nav.spectatorArrow': 'Spectator ↗',
  'nav.replay': 'Replay',
  'nav.backToJudge': 'Back to judge',

  'lang.switch': 'Language',
  'lang.zh': '中文',
  'lang.en': 'EN',

  'common.connecting': 'Connecting to the local match service…',
  'common.connected': 'connected',
  'common.connectingShort': 'connecting…',
  'common.live': '● live',
  'common.offline': '○ offline',
  'common.readonly': 'read-only',
  'common.unnamed': '(unnamed)',
  'common.unknown': 'unknown',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.none': 'none',
  'common.noFiles': '(no files yet)',

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
  'team.emitter.candidatesEmpty': 'The judge has not generated the map yet.',
  'team.emitter.revealedTitle': 'Emitters',
  'team.emitter.public': 'public',
  'team.emitter.hidden': 'hidden',
  'team.emitter.hiddenBody': 'Public once both teams have locked. Your opponent {state}.',
  'team.emitter.opponentLocked': 'has locked',
  'team.emitter.opponentUnlocked': 'has not locked yet',

  'team.candidate.selectedMark': '← selected',
  'team.candidate.alive': 'alive',
  'team.candidate.dead': 'dead',

  'team.arena.title': 'Arena',
  'team.arena.hint': 'Click a point in the arena to pick it as the emitter (or use the list above).',

  'team.note.selected': 'Picked {id}',
  'team.note.locked': 'Emitter locked',
  'team.note.installed': 'Installed files: {n}',
  'team.note.installedWithHash': 'Installed files: {n}, package hash {hash}…',

  'team.err.commandFailed': 'Command failed',
  'team.err.uploadFailed': 'Upload failed',
  'team.err.readFailed': 'Could not read the file',

  'judge.title': 'Judge',
  'judge.teamCard.unnamed': '(unnamed)',
  'judge.teamCard.nameTitle': 'Name reported by the package itself',
  'judge.teamCard.ready': 'Algorithm ready',
  'judge.teamCard.notReady': 'Not ready',
  'judge.teamCard.emitterLocked': 'Anchor {id}',
  'judge.teamCard.emitterLockedNoId': 'locked',
  'judge.teamCard.emitterUnlocked': 'Anchor not locked',
  'judge.teamCard.sealed': 'Sealed {hash}…',
  'judge.teamCard.notSealed': 'Not sealed',
  'judge.teamCard.preflightNever': 'not installed by this platform',
  'judge.teamCard.preflightOk': 'Preflight ✓',
  'judge.teamCard.preflightFail': 'Preflight ✕',

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
    'Seal both teams’ algorithms into this match. Players put their algorithms into the runtime slots first (see “Delivery point” below); once both are ready, the next step does “seal → validate → create” in one go.',
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
  'judge.step.MATCH_END': 'The match has ended. Watch the replay, or start a new match.',

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

  'judge.slot.title': 'Algorithm slots',
  'judge.slot.settings': 'Points: {points} · {difficulty}',
  'judge.slot.deliveryPoint': 'Delivery point',
  'judge.slot.summary': 'Files: {files} · {bytes} B · preflight {state}',
  'judge.slot.empty': 'Slot is empty',
  'judge.slot.installed': 'Installed · from {source}',
  'judge.slot.unrecorded': 'No install record (factory seed / placed by hand)',
  'judge.slot.hash': 'Package hash {hash}…',
  'judge.slot.sealed': 'Sealed {hash}',
  'judge.slot.readonly': 'read-only',

  'judge.adv.summary': 'Advanced Controls · low-level actions & match settings',
  'judge.adv.desc':
    'The wizard highlights the one thing to do now; this is every action the server offers, including the low-level steps the wizard does not use. Availability is still read from the server — hover a greyed-out button to see why.',
  'judge.adv.installDesc':
    'For a real match use the wizard’s “seal both → validate → create match”. Algorithms belong in the runtime slots (see “Delivery point” above). Use this only to swap in an algorithm temporarily; it takes an absolute directory path on the server.',
  'judge.adv.teamDir': 'Team {team} algorithm directory',
  'judge.adv.pathPlaceholder': '/absolute/path/to/package',
  'judge.adv.install': 'Install Team {team} algorithm',
  'judge.adv.settingsDesc': 'Match settings — applied on the next reset / new match.',
  'judge.adv.seed': 'Seed (blank = random)',
  'judge.adv.points': 'Combat points (blank = keep)',
  'judge.adv.difficulty': 'Difficulty (blank = keep)',
  'judge.adv.keepDifficulty': 'keep {value}',

  'judge.audit.title': 'Audit',
  'judge.audit.events': 'Events: {n}',
  'judge.audit.artifacts': 'Artifacts: {dir}',
  'judge.audit.noArtifacts': 'no artifacts yet',
  'judge.audit.runtimeOk': '✓ matches the frozen manifest',
  'judge.audit.runtimeMismatch': '✕ differs from the frozen manifest',

  'judge.lastRound.attacks': 'Attacks',
  'judge.lastRound.kills': 'Kills',
  'judge.lastRound.alive': 'Alive',
  'judge.lastRound.verdict': 'Result',
  'judge.lastRound.draw': 'Draw',
  'judge.lastRound.winner': 'TEAM {team} wins',
  'judge.lastRound.notConnected': 'This action is not wired into the UI yet: {key}',
  'judge.lastRound.headline': 'R{round} · TEAM {team} first',

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
  'spectator.tie': 'simultaneous',
  'spectator.emitters': 'Match emitters',
  'spectator.readyNextRound': 'Round settled · awaiting the next round',
  'spectator.note.attacks': 'Attacks {attacks}   Kills {kills}',
  'spectator.note.noAttacks': 'none',
  'spectator.verdict.draw': 'DRAW',

  'replay.title': 'Replay',
  'replay.loading': 'Loading replay…',
  'replay.rounds': 'Rounds',
  'replay.roundsCount': 'Rounds: {n}',
  'replay.others': 'Other matches',
  'replay.frameKills': 'kills {kills}',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.prev': 'Previous round',
  'replay.next': 'Next round',
  'replay.slider': 'Round',
  'replay.meta': 'Points: {points} · {difficulty} · seed {seed}',
  'replay.frameSummary': 'first {first} · attacks {attacks} · kills {kills}',
  'replay.draw': 'Draw',
  'replay.winner': 'TEAM {team} wins',
  'replay.loadFailed': 'Could not load (HTTP {status})',

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
