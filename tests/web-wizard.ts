/**
 * web-wizard —— 裁判向导的展示模型 + 前端标签助手的纯回归（V1.4）
 *
 * 不开浏览器、不起服务：`web/src/pages/judgeWizard.ts` 与 `web/src/i18n/translations.ts`
 * 都是纯模块，这里直接 import。盯的是四件「不跑不知道」的事：
 *
 *   1. **每个 WirePhase 都有一格**，且格子沿主流程单调不减、七格全部被走到 ——
 *      向导表漂移（阶段改了、格子没跟上）在这里变红，而不是在现场；
 *   2. 候选主动作都是服务端**真的会下发**的 key（扫 boards.ts 源码对照）；
 *   3. `pickPrimary` 只用 `enabled` 在候选之间挑，一个都不可用时回退首选（仍禁用）；
 *   4. 终局原因 / 先手 / 难度 / 胜者的标签助手覆盖每个枚举值、两种语言，
 *      并且对 `'constructor'` 这类原型链名字**原样返回**而不是渲染出 “undefined”。
 *
 * 顺带回归首页「粘贴访问链接或令牌」的解析（`accessLink.ts`）：令牌只认 fragment。
 *
 * F3 追加：参赛者页的展示模型（`web/src/pages/teamSteps.ts`）—— 六步的完成 / 出错判据与
 * 「下一步」提示的优先级，全部由服务端事实推出；以及 TeamPage 的可点性只读 `enabled`。
 *
 * F4 追加：观众大屏的横幅键 / 先手色 token（`spectatorView.ts`）与回放播放器的纯模型
 * （`replayPlayer.ts`）—— 速度只缩放动画时长与换帧间隔，命令越界一律夹取；
 * 再扫两页源码：大屏没有按钮 / 没有 `data-action`，回放不 import 引擎、不求值函数。
 */

import * as fs from 'fs';
import * as path from 'path';
import { STAGE_ORDER, STEPS, pickPrimary, stageIndexOf } from '../web/src/pages/judgeWizard';
import { accessHref, parseAccessInput } from '../web/src/pages/accessLink';
import {
  STEP_STATE_KEYS,
  TEAM_STEPS,
  TEAM_STEP_KEYS,
  nextHint,
  stepStates,
} from '../web/src/pages/teamSteps';
import type { TeamFacts } from '../web/src/pages/teamSteps';
import {
  BASE_FRAME_MS,
  BASE_GAP_MS,
  SPEEDS,
  advance,
  applyCommand,
  autoplayDelayMs,
  clampIndex,
  frameDurationMs,
  isSpeed,
  keyToCommand,
  secondsText,
  speedText,
} from '../web/src/pages/replayPlayer';
import { arenaKey, bannerKey, firstTone } from '../web/src/pages/spectatorView';
import {
  DIFFICULTY_KEYS,
  END_REASON_KEYS,
  FIRST_SOLVER_KEYS,
  SLOT_STATUS_KEYS,
  WIZARD_STAGES,
  WIZARD_STAGE_KEYS,
  difficultyLabel,
  endReasonLabel,
  firstSolverLabel,
  slotStatusLabel,
  translations,
  winnerLabel,
} from '../web/src/i18n/translations';
import { LOCALES } from '../web/src/i18n/types';
import type { ActionView, WirePhase } from '../src/server/protocol';
import { assert, assertEqual, runAll, test } from './harness';

const REPO = path.join(__dirname, '..');

/** 主流程的规范阶段序列（与 `src/server/protocol.ts` 的 `WirePhase` 顺序一致） */
const PHASES: readonly WirePhase[] = [
  'SETUP',
  'UPLOAD_A',
  'UPLOAD_B',
  'PREFLIGHT',
  'EMITTER_SELECT',
  'READY',
  'PUBLIC',
  'REVEAL',
  'COUNTDOWN',
  'COMPUTING',
  'ROUND_RESULT',
  'MATCH_END',
];

/**
 * 阶段 → 格子的**期望表**（独立于实现的一份副本）。
 * 单调性检查对「把一个阶段挪到邻格」这种变异是钝的（邻格常常同格），
 * 所以这里再钉一张金表：挪任何一格都变红。
 */
const EXPECTED_STAGE: Record<WirePhase, (typeof WIZARD_STAGES)[number]> = {
  SETUP: 'SETUP',
  UPLOAD_A: 'ALGORITHM READY',
  UPLOAD_B: 'ALGORITHM READY',
  PREFLIGHT: 'ALGORITHM READY',
  EMITTER_SELECT: 'EMITTER LOCK',
  READY: 'READY',
  PUBLIC: 'START MATCH',
  REVEAL: 'START MATCH',
  COUNTDOWN: 'ROUND',
  COMPUTING: 'ROUND',
  ROUND_RESULT: 'ROUND',
  MATCH_END: 'MATCH END',
};

/** 服务端裁判板会下发的全部动作 key（`boards.ts` 的 `buildActions`） */
const JUDGE_ACTION_KEYS = [
  'prepare',
  'use-slot-a',
  'use-slot-b',
  'preflight',
  'start',
  'reveal',
  'start-round',
  'compute',
  'run-to-end',
  'reset',
];

function action(key: string, enabled: boolean): ActionView {
  return {
    key,
    label: key,
    enabled,
    hint: `hint:${key}`,
    labelKey: `action.${key}.label`,
    hintKey: `action.${key}.hint`,
  } as ActionView;
}

const table = (locale: (typeof LOCALES)[number]): Record<string, string> =>
  translations[locale] as unknown as Record<string, string>;

// ===========================================================================

test('wizard: 规范阶段序列与 protocol.ts 的 WirePhase 完全一致', () => {
  // 扫源码而不是信任上面那张手写表：引擎加一个阶段，这里先红。
  const src = fs.readFileSync(path.join(REPO, 'src', 'server', 'protocol.ts'), 'utf-8');
  const block = /export type WirePhase =([\s\S]*?);/.exec(src);
  assert(block, 'protocol.ts 里应当有 WirePhase 的联合类型');
  const declared = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assertEqual(declared, [...PHASES], '本套件的阶段序列必须与 protocol.ts 逐项一致');
});

test('wizard: 每个 WirePhase 都映射到步骤条的一格，且与金表一致', () => {
  for (const phase of PHASES) {
    const step = STEPS[phase];
    assert(step, `阶段 ${phase} 没有向导步骤`);
    assert(STAGE_ORDER.includes(step.stage), `阶段 ${phase} 指向了不存在的格子 ${step.stage}`);
    assertEqual(step.stage, EXPECTED_STAGE[phase], `阶段 ${phase} 的格子与金表不一致`);
    assert(
      typeof table('zh-CN')[step.whatKey] === 'string' && typeof table('en-US')[step.whatKey] === 'string',
      `阶段 ${phase} 的说明键 ${step.whatKey} 两种语言都要有`
    );
  }
  assertEqual([...STAGE_ORDER], [...WIZARD_STAGES], 'STAGE_ORDER 就是 WIZARD_STAGES');
  assertEqual(STAGE_ORDER.length, 7, '步骤条恰好七格');
});

test('wizard: 格号沿规范阶段序列单调不减，且七格全部被走到', () => {
  const idx = PHASES.map((p) => stageIndexOf(p));
  for (let i = 1; i < idx.length; i++) {
    assert(idx[i] >= idx[i - 1], `阶段 ${PHASES[i]}（格 ${idx[i]}）排在 ${PHASES[i - 1]}（格 ${idx[i - 1]}）之后却往回走了`);
  }
  assertEqual([...new Set(idx)], STAGE_ORDER.map((_, i) => i), '每一格都至少有一个阶段落在上面，且按顺序出现');
  assertEqual(stageIndexOf('SETUP'), 0, '起点是第 0 格');
  assertEqual(stageIndexOf('MATCH_END'), STAGE_ORDER.length - 1, '终局是最后一格');
});

test('wizard: 候选主动作都是服务端真的会下发的 key', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'server', 'boards.ts'), 'utf-8');
  for (const key of JUDGE_ACTION_KEYS) {
    // `use-slot-a/b` 在 boards.ts 里由模板拼出（`use-slot-${…}`），其余是字面量
    const needle = key.startsWith('use-slot-') ? 'use-slot-' : `'${key}'`;
    assert(src.includes(needle), `boards.ts 里找不到动作 key ${key} —— 服务端不会下发它`);
  }
  const known = new Set(JUDGE_ACTION_KEYS);
  for (const phase of PHASES) {
    for (const c of STEPS[phase].candidates) {
      assert(known.has(c), `阶段 ${phase} 的候选 ${c} 不是服务端动作 key`);
    }
  }
  // 只有选手在做的那一步（等待步）与主位置是链接的那一步（终局）没有候选，
  // 其余每步都有一个明确的主动作
  for (const phase of PHASES) {
    const step = STEPS[phase];
    if (step.waiting || step.primaryLink) {
      assertEqual(step.candidates.length, 0, `${phase} 是等待步 / 链接步，不该有候选`);
    } else {
      assert(step.candidates.length > 0, `${phase} 不是等待步，必须有候选主动作`);
    }
    assert(!(step.waiting && step.primaryLink), `${phase} 不能同时是等待步与链接步`);
  }
  assertEqual(
    PHASES.filter((p) => STEPS[p].waiting),
    ['EMITTER_SELECT'],
    '唯一的等待步是 EMITTER_SELECT（双方在参赛者页选锚点）'
  );
  // 终局的主位置是「打开回放」（V1.4 任务书：Match End → Open Replay）
  assertEqual(
    PHASES.filter((p) => STEPS[p].primaryLink),
    ['MATCH_END'],
    '唯一的链接步是 MATCH_END'
  );
  assertEqual(STEPS.MATCH_END.primaryLink, 'replay', '终局主位置是回放链接');
  // 危险动作永远不上主按钮：`reset` 只能从 Advanced 里两步确认地执行。
  // 否则终局一到，主按钮 + ⌘/Ctrl+Enter 两键就作废双方的 Emitter 锁定。
  for (const phase of PHASES) {
    assert(!STEPS[phase].candidates.includes('reset'), `${phase} 把危险动作 reset 列为主按钮候选`);
  }
});

test('wizard: pickPrimary 只用 enabled 在候选之间挑，无可用时回退首选', () => {
  const ready = STEPS.READY; // candidates: reveal, run-to-end
  const all = (on: string[]): ActionView[] => JUDGE_ACTION_KEYS.map((k) => action(k, on.includes(k)));

  assertEqual(pickPrimary(all(['reveal', 'run-to-end']), ready)?.key, 'reveal', '首选可用就选首选');
  assertEqual(pickPrimary(all(['run-to-end']), ready)?.key, 'run-to-end', '首选不可用时顺延到下一个可用候选');
  const none = pickPrimary(all(['reset']), ready);
  assertEqual(none?.key, 'reveal', '一个候选都不可用时仍返回首选');
  assertEqual(none?.enabled, false, '…并且它是禁用的（原因由 hint 给出）');
  assertEqual(pickPrimary(all(['reveal']), STEPS.EMITTER_SELECT), null, '等待步没有主按钮');
  assertEqual(pickPrimary([], ready), null, '服务端一个动作都没给时返回 null，不崩');

  // 候选之外的动作再「可用」也不会被挑成主按钮 —— 主按钮的候选集是向导表说了算
  assertEqual(pickPrimary(all(['reset', 'compute']), ready)?.key, 'reveal', '非候选动作不参与');
});

test('labels: 步骤条七格的 V1.4 显示名（英文）与机器标识分离', () => {
  const en = STAGE_ORDER.map((s) => table('en-US')[WIZARD_STAGE_KEYS[s]]);
  assertEqual(
    en,
    ['Match Setup', 'Algorithm Ready', 'Emitter Lock', 'Ready', 'Reveal', 'Running', 'Match End'],
    '英文显示名按 V1.4 任务书'
  );
  for (const s of STAGE_ORDER) {
    for (const locale of LOCALES) {
      const v = table(locale)[WIZARD_STAGE_KEYS[s]];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺步骤 ${s} 的显示名`);
      assert(v !== s, `${locale} 的步骤 ${s} 直接印了机器标识`);
    }
  }
  // 机器标识（data-stage）不随显示名变
  assertEqual([...WIZARD_STAGES], ['SETUP', 'ALGORITHM READY', 'EMITTER LOCK', 'READY', 'START MATCH', 'ROUND', 'MATCH END'], 'data-stage 的取值保持稳定');
});

test('labels: endReason / firstSolver / difficulty 覆盖每个枚举值、两种语言', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'server', 'protocol.ts'), 'utf-8');
  const block = /export type WireEndReason =([\s\S]*?);/.exec(src);
  assert(block, 'protocol.ts 里应当有 WireEndReason');
  const reasons = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assertEqual(Object.keys(END_REASON_KEYS).sort(), [...reasons].sort(), 'END_REASON_KEYS 必须覆盖 WireEndReason 的每个值');

  for (const locale of LOCALES) {
    for (const r of reasons) {
      const v = endReasonLabel(locale, r);
      assert(v.length > 0 && v !== r, `${locale} 的终局原因 ${r} 没翻译（得到 ${JSON.stringify(v)}）`);
    }
    for (const f of ['A', 'B', 'tie', 'none'] as const) {
      assert(f in FIRST_SOLVER_KEYS, `FIRST_SOLVER_KEYS 缺 ${f}`);
      const v = firstSolverLabel(locale, f);
      assert(v.length > 0 && v !== 'undefined', `${locale} 的先手 ${f} 没翻译`);
      assert(v !== 'TEAM TIE' && v !== 'TEAM NONE', `${locale} 的先手 ${f} 仍是手工拼接的 “TEAM ${f.toUpperCase()}”`);
    }
    for (const d of ['easy', 'medium', 'hard'] as const) {
      assert(d in DIFFICULTY_KEYS, `DIFFICULTY_KEYS 缺 ${d}`);
      const v = difficultyLabel(locale, d);
      assert(v.length > 0 && v !== 'undefined', `${locale} 的难度 ${d} 没翻译`);
    }
  }
  assertEqual(firstSolverLabel('en-US', 'A'), 'TEAM A', '英文先手 A');
  assertEqual(firstSolverLabel('zh-CN', 'tie'), '同时', '中文并列');
  assertEqual(endReasonLabel('en-US', 'STALEMATE'), 'Stalemate', '英文僵局');
  assertEqual(difficultyLabel('zh-CN', 'easy'), '简单', '中文简单');
});

test('labels: 原型链名字与未知值原样返回，绝不渲染成 “undefined”', () => {
  const hostile = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'SOMETHING_NEW', ''];
  for (const locale of LOCALES) {
    for (const h of hostile) {
      assertEqual(endReasonLabel(locale, h), h, `endReasonLabel(${JSON.stringify(h)}) 应原样返回`);
      assertEqual(firstSolverLabel(locale, h), h, `firstSolverLabel(${JSON.stringify(h)}) 应原样返回`);
      assertEqual(difficultyLabel(locale, h), h, `difficultyLabel(${JSON.stringify(h)}) 应原样返回`);
      assertEqual(slotStatusLabel(locale, h), h, `slotStatusLabel(${JSON.stringify(h)}) 应原样返回`);
    }
  }
});

test('labels: 槽位状态覆盖 Slot.ts 的每个 SlotStatus 值、两种语言（裁判队卡，V1.4）', () => {
  // `SlotView.status` 在协议里是 string；真正的枚举在 src/submission/Slot.ts（依赖 node，
  // 浏览器 import 不了），所以前端存的是结构镜像 —— 扫源码对照，引擎加一种状态这里先红。
  const src = fs.readFileSync(path.join(REPO, 'src', 'submission', 'Slot.ts'), 'utf-8');
  const block = /export type SlotStatus =([^;]*);/.exec(src);
  assert(block, 'Slot.ts 里应当有 SlotStatus 的联合类型');
  const declared = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert(declared.length >= 3, `SlotStatus 至少三个值，实际 ${declared.length}`);
  assertEqual(Object.keys(SLOT_STATUS_KEYS).sort(), [...declared].sort(), 'SLOT_STATUS_KEYS 必须覆盖 SlotStatus 的每个值');
  for (const locale of LOCALES) {
    for (const v of declared) {
      const label = slotStatusLabel(locale, v);
      assert(label.length > 0 && label !== v && label !== 'undefined', `${locale} 的槽位状态 ${v} 没翻译（得到 ${JSON.stringify(label)}）`);
    }
  }
  assertEqual(slotStatusLabel('zh-CN', 'READY'), '就绪', '中文就绪');
  assertEqual(slotStatusLabel('en-US', 'INVALID'), 'invalid', '英文无效');
});

test('judge: 页面源码不渲染服务端绝对路径字段，且危险动作有两步确认（V1.4）', () => {
  // 三个字段都是服务端上的绝对路径（`SlotView.dir` / `SlotView.source` / `JudgeBoard.slotRoot` /
  // `artifactDir`）。裁判台此前把它们印在槽位面板与审计里；V1.4 要求任何页面都不渲染。
  // 这里扫的是 pages/ 与 components/ 的源码：出现 `.dir` / `.slotRoot` / `.artifactDir` /
  // `s.source` 这种取值就红 —— 比在浏览器里找一串 `/Users/` 更早、也更稳。
  const dirs = ['pages', 'components'].map((d) => path.join(REPO, 'web', 'src', d));
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.tsx')).map((f) => path.join(d, f)));
  assert(files.length >= 5, '应当扫到至少五个 .tsx');
  const forbidden = [/\.slotRoot\b/, /\.artifactDir\b/, /\bslots?\.[AB]?\.?dir\b/, /\b(s|slot)\.dir\b/, /\b(s|slot)\.source\b/];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const re of forbidden) {
      assert(!re.test(src), `${path.basename(f)} 仍在读服务端绝对路径字段（${re}）`);
    }
  }
  // 危险动作：`reset` 走两步确认，第二步的按钮就是 `data-action="reset-confirm"`（演练点的正是它）；
  // Reveal / START / 连续跑完**不**确认。
  const judge = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', 'JudgePage.tsx'), 'utf-8');
  assert(/DANGER_ACTIONS[^;]*new Set\(\['reset'\]\)/.test(judge), '危险动作集合应当恰好是 { reset }');
  assert(judge.includes('`${actionKey}-confirm`'), '确认按钮的 data-action 应当是 <key>-confirm');
  assert(judge.includes("actionKey=\"reset\""), 'reset 的确认块应当带 actionKey="reset"（→ data-action="reset-confirm"）');
  // 快捷键只给主流程：危险动作即便成了主按钮也不接 ⌘/Ctrl+Enter
  assert(judge.includes('shortcut={!DANGER_ACTIONS.has(primary.key)}'), '主按钮的快捷键必须对危险动作关闭');
  // 确认块的焦点落在**取消**上：执行按钮不得 autoFocus（否则「点一下 + 回车」两键换场）
  const goBtn = /<button[^>]*data-testid=\{`\$\{testId\}-go`\}[^>]*>/.exec(judge);
  assert(goBtn, '应当能找到确认块的执行按钮');
  assert(!/autoFocus/.test(goBtn[0]), '确认块的执行按钮不得 autoFocus');
  const cancelBtn = /<button[^>]*data-testid=\{`\$\{testId\}-cancel`\}[^>]*>/.exec(judge);
  assert(cancelBtn && /autoFocus/.test(cancelBtn[0]), '确认块的焦点应落在取消按钮上');
  // 终局：主位置是回放链接，且由向导表（primaryLink）决定，不在页面里再写一遍阶段名
  assert(judge.includes('data-testid="judge-open-replay"'), '终局主位置的回放链接');
  assert(judge.includes("step.primaryLink === 'replay'"), '回放链接的显示由向导表的 primaryLink 决定');
  assert(!judge.includes("board.phase === 'MATCH_END'"), 'JudgePage 不该再拿阶段名判断终局显示（交给向导表）');
  // Advanced 目录安装按钮：灰掉的原因可见（不只在 title 里），并接给读屏
  assert(judge.includes('aria-describedby={`judge-install-why-${side}`}'), '安装按钮 aria-describedby 指向原因');
  assert(judge.includes('data-testid={`judge-install-why-${side}`}'), '安装按钮下方渲染可见原因');
  for (const locale of LOCALES) {
    for (const key of ['judge.adv.installWhy', 'judge.adv.installReady']) {
      const v = table(locale)[key];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺 ${key}`);
    }
  }
  // 主按钮的 onClick 是稳定引用（useCallback），不是内联 lambda —— 否则快捷键监听随每条 board 重挂
  assert(judge.includes('onClick={onPrimary}'), '主按钮 onClick 应当是 memo 过的 onPrimary');
  assert(!/onClick=\{\(\) => runAction\(primary\.key\)\}/.test(judge), '主按钮不得再用内联 lambda');
});

test('pages: 三块板都带 data-board 两态（演练以 ready 为同步点），且减弱动效时呼吸动画停止', () => {
  // `data-board="ready"` 是「权威 board 已到达」的机器可读标记：演练**等它**再读文案，
  // 而不是睡眠。此前只有 TeamPage 的那一处被 e2e 守着 —— 去掉 Judge / Spectator 的照样全绿。
  for (const [file, root] of [
    ['JudgePage.tsx', 'judge'],
    ['TeamPage.tsx', 'team'],
    ['SpectatorPage.tsx', 'spectator'],
  ] as const) {
    const src = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', file), 'utf-8');
    assert(src.includes('data-board="ready"'), `${file} 缺 data-board="ready"`);
    assert(src.includes('data-board="pending"'), `${file} 缺 data-board="pending"`);
    // ready 根元素就是演练用的 testid（judge / team / spectator）
    const readyRoot = new RegExp(`data-testid="${root}"[^>]*data-board="ready"|data-board="ready"[^>]*data-testid="${root}"`);
    assert(readyRoot.test(src), `${file} 的 ready 根元素应当带 data-testid="${root}"`);
  }
  // 减弱动效：只缩短时长对 infinite 动画不管用（它会每帧闪一轮），必须一轮即停 / 直接关掉
  const css = fs.readFileSync(path.join(REPO, 'web', 'src', 'styles.css'), 'utf-8');
  const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
  assert(block, 'styles.css 应当有 prefers-reduced-motion 媒体查询');
  assert(/animation-iteration-count:\s*1\s*!important/.test(block[1]), '减弱动效下 infinite 动画一轮即停');
  assert(/\.conn__dot[\s\S]*animation:\s*none/.test(block[1]), '连接标签的呼吸点在减弱动效下关闭');
  assert(/is-running[\s\S]*animation:\s*none/.test(block[1]), '计算条的呼吸在减弱动效下关闭');
});

test('labels: winnerLabel 覆盖 A / B / draw，英文含 TEAM A，未知值原样', () => {
  assertEqual(winnerLabel('en-US', 'A'), 'TEAM A WINS', '英文 A 胜');
  assertEqual(winnerLabel('en-US', 'B'), 'TEAM B WINS', '英文 B 胜');
  assertEqual(winnerLabel('en-US', 'draw'), 'DRAW', '英文平局');
  assertEqual(winnerLabel('zh-CN', 'A'), 'TEAM A 获胜', '中文 A 胜');
  assert(winnerLabel('zh-CN', 'draw').includes('平局'), '中文平局');
  assertEqual(winnerLabel('en-US', 'constructor'), 'constructor', '未知值原样');
  // 不再有手工拼接：任何页面都不该出现 `TEAM ${winner}` 字面量
  const pages = fs.readdirSync(path.join(REPO, 'web', 'src', 'pages')).filter((f) => f.endsWith('.tsx'));
  for (const f of pages) {
    const src = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', f), 'utf-8');
    assert(!/`TEAM \$\{/.test(src), `${f} 里仍有手工拼接的 TEAM \${…}`);
    assert(!/firstSolver\.toUpperCase\(\)/.test(src), `${f} 里仍把 firstSolver 大写后直接渲染`);
  }
});

test('access: 粘贴解析只认 fragment 令牌与本站链接', () => {
  const origin = 'http://127.0.0.1:17800';
  const tok = 'VLHCobRIw08YBxfA0jqPTmms1o09m60EaW3T8lsx5dg';

  assertEqual(parseAccessInput(tok, '/team/a', origin), { path: '/team/a', token: tok }, '裸令牌 → 卡片自己的路线');
  assertEqual(parseAccessInput(`  ${tok}\n`, '/judge', origin), { path: '/judge', token: tok }, '两端空白被剪掉');
  assertEqual(
    parseAccessInput(`${origin}/team/b#t=${tok}`, '/team/a', origin),
    { path: '/team/b', token: tok },
    '本站链接：按链接自己的路线走，而不是卡片的'
  );
  assertEqual(
    parseAccessInput(`${origin}/judge#t=${tok}`, '/team/a', origin),
    { path: '/judge', token: tok },
    '裁判链接粘进参赛者卡片 → 去裁判台'
  );
  assertEqual(
    parseAccessInput(`${origin}/somewhere#t=${tok}`, '/team/a', origin),
    { path: '/team/a', token: tok },
    '未知路径的本站链接 → 取令牌、走卡片路线'
  );
  assertEqual(parseAccessInput(`${origin}/team/a?t=${tok}`, '/team/a', origin), null, '查询串里的令牌**不认**');
  assertEqual(parseAccessInput(`http://evil.example/team/a#t=${tok}`, '/team/a', origin), null, '别站链接不认');
  assertEqual(parseAccessInput(`${origin}/team/a`, '/team/a', origin), null, '没有 #t= 的链接不认');
  assertEqual(parseAccessInput('hello world', '/team/a', origin), null, '随手打的词不是令牌');
  assertEqual(parseAccessInput('short', '/team/a', origin), null, '太短不是令牌');
  assertEqual(parseAccessInput('', '/team/a', origin), null, '空输入');
  assertEqual(accessHref({ path: '/judge', token: tok }), `/judge#t=${tok}`, '导航地址只把令牌放进 fragment');
  assert(!accessHref({ path: '/judge', token: tok }).includes('?'), '绝不进查询串');
});

// ===========================================================================
// 参赛者页展示模型（F3）
// ===========================================================================

/** 一个「刚打开、槽位为空」的参赛者局面；用例在它上面改几个事实 */
const EMPTY_FACTS: TeamFacts = {
  installed: false,
  slotStatus: 'EMPTY',
  packageReady: false,
  preflightOk: null,
  hasCandidates: false,
  selected: null,
  locked: false,
  opponentLocked: false,
  revealed: false,
  round: 0,
  ended: false,
};
const facts = (patch: Partial<TeamFacts>): TeamFacts => ({ ...EMPTY_FACTS, ...patch });
const READY_PKG: Partial<TeamFacts> = { installed: true, slotStatus: 'READY', packageReady: true, preflightOk: true };
const states = (f: TeamFacts): string[] => TEAM_STEPS.map((s) => stepStates(f)[s]);

test('team: 六步的机器标识与显示键齐全，英文显示名按 V1.4（Submit → Validate → Preflight → Select → Lock → Wait）', () => {
  assertEqual([...TEAM_STEPS], ['submit', 'validate', 'preflight', 'select', 'lock', 'wait'], 'data-step 的取值');
  for (const s of TEAM_STEPS) {
    for (const locale of LOCALES) {
      const v = table(locale)[TEAM_STEP_KEYS[s]];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺步骤 ${s} 的显示名（${TEAM_STEP_KEYS[s]}）`);
    }
  }
  for (const st of ['done', 'now', 'todo', 'error'] as const) {
    for (const locale of LOCALES) {
      const v = table(locale)[STEP_STATE_KEYS[st]];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺步骤状态 ${st} 的可读词`);
    }
  }
  const en = TEAM_STEPS.map((s) => table('en-US')[TEAM_STEP_KEYS[s]]);
  assertEqual(en, ['Upload package', 'Validation', 'Preflight', 'Pick emitter', 'Lock', 'Wait for start'], '英文显示名');
});

test('team: 步骤状态只由服务端事实推出，且沿主流程单调推进', () => {
  assertEqual(states(EMPTY_FACTS), ['now', 'todo', 'todo', 'todo', 'todo', 'todo'], '空槽位：第一步进行中');
  assertEqual(
    states(facts({ installed: true, slotStatus: 'INVALID' })),
    ['done', 'error', 'todo', 'todo', 'todo', 'todo'],
    '槽位无效：校验一步标 error（不是 now），后面全部 todo'
  );
  assertEqual(
    states(facts({ installed: true, slotStatus: 'READY', packageReady: false, preflightOk: true })),
    ['done', 'now', 'todo', 'todo', 'todo', 'todo'],
    '锦标赛模式下的平台自带包：结构 READY 但 packageReady=false ⇒ 校验一步仍未完成'
  );
  assertEqual(
    states(facts({ installed: true, slotStatus: 'READY', packageReady: true, preflightOk: false })),
    ['done', 'done', 'error', 'todo', 'todo', 'todo'],
    'Preflight 未通过 ⇒ 第三步 error'
  );
  assertEqual(states(facts(READY_PKG)), ['done', 'done', 'done', 'now', 'todo', 'todo'], '包就绪：等选点');
  assertEqual(
    states(facts({ ...READY_PKG, hasCandidates: true, selected: 'A3' })),
    ['done', 'done', 'done', 'done', 'now', 'todo'],
    '已选未锁：锁定进行中'
  );
  assertEqual(
    states(facts({ ...READY_PKG, hasCandidates: true, selected: 'A3', locked: true })),
    ['done', 'done', 'done', 'done', 'done', 'now'],
    '已锁定：等待开赛'
  );
  assertEqual(
    states(facts({ ...READY_PKG, hasCandidates: true, selected: 'A3', locked: true, opponentLocked: true, revealed: true, round: 3 })),
    ['done', 'done', 'done', 'done', 'done', 'done'],
    '打到第 3 轮：六步全完成'
  );
  // 地图已生成就说明双方的包都过了封装与 Preflight —— 即便本队的安装记录里没有 Preflight 结论
  assertEqual(
    states(facts({ installed: true, slotStatus: 'READY', packageReady: true, preflightOk: null, hasCandidates: true })),
    ['done', 'done', 'done', 'now', 'todo', 'todo'],
    '建赛后前三步一律视为完成'
  );
  // 单调性：沿一条真实的推进路径，done 的数量不减
  const path: TeamFacts[] = [
    EMPTY_FACTS,
    facts({ installed: true, slotStatus: 'READY', packageReady: true, preflightOk: true }),
    facts({ ...READY_PKG, hasCandidates: true }),
    facts({ ...READY_PKG, hasCandidates: true, selected: 'A1' }),
    facts({ ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true }),
    facts({ ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true, opponentLocked: true, revealed: true }),
    facts({ ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true, opponentLocked: true, revealed: true, round: 1 }),
    facts({ ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true, opponentLocked: true, revealed: true, round: 9, ended: true }),
  ];
  let prev = -1;
  for (const f of path) {
    const n = states(f).filter((x) => x === 'done').length;
    assert(n >= prev, `done 数从 ${prev} 退到了 ${n}`);
    prev = n;
    // 恰好一格是 now / error（除非全部完成）
    const current = states(f).filter((x) => x === 'now' || x === 'error').length;
    assert(current === (n === TEAM_STEPS.length ? 0 : 1), `应恰有一格进行中，实际 ${current}`);
  }
});

test('team: 「下一步」提示按优先级取第一条成立的，且每条键两种语言都有', () => {
  const key = (f: TeamFacts): string => nextHint(f).key;
  assertEqual(key(EMPTY_FACTS), 'team.next.upload', '空槽位 → 上传');
  assertEqual(key(facts({ installed: true, slotStatus: 'INVALID' })), 'team.next.invalid', '无效 → 修正后重传');
  assertEqual(
    key(facts({ installed: true, slotStatus: 'READY', packageReady: false, preflightOk: true })),
    'team.next.bundled',
    '结构就绪但 packageReady=false 只可能是平台自带包'
  );
  assertEqual(key(facts({ ...READY_PKG, preflightOk: false })), 'team.next.preflightFailed', 'Preflight 未通过');
  assertEqual(key(facts({ ...READY_PKG, preflightOk: null })), 'team.next.preflightPending', '没有安装记录');
  assertEqual(key(facts(READY_PKG)), 'team.next.waitJudge', '就绪 → 等裁判筹备');
  assertEqual(key(facts({ ...READY_PKG, hasCandidates: true })), 'team.next.select', '有候选 → 选点');
  const lock = nextHint(facts({ ...READY_PKG, hasCandidates: true, selected: 'B2' }));
  assertEqual(lock.key, 'team.next.lock', '已选 → 锁定');
  assertEqual(lock.params, { id: 'B2' }, '锁定提示带上所选 id');
  assertEqual(
    key(facts({ ...READY_PKG, hasCandidates: true, selected: 'B2', locked: true })),
    'team.next.waitOpponent',
    '已锁 → 等对方'
  );
  assertEqual(
    key(facts({ ...READY_PKG, hasCandidates: true, selected: 'B2', locked: true, opponentLocked: true, revealed: true })),
    'team.next.waitStart',
    '双方已锁 → 等裁判开赛'
  );
  const running = nextHint(facts({ ...READY_PKG, hasCandidates: true, selected: 'B2', locked: true, opponentLocked: true, revealed: true, round: 4 }));
  assertEqual(running.key, 'team.next.running', '进行中');
  assertEqual(running.params, { round: 4 }, '带轮次');
  const ended = nextHint(facts({ ...READY_PKG, hasCandidates: true, locked: true, round: 4, ended: true }));
  assertEqual(ended.key, 'team.next.ended', '终局');
  assertEqual(ended.replay, true, '终局附回放链接');
  // 比赛已在进行时，包的状态不再决定提示（即便安装记录缺 Preflight 结论）
  assertEqual(
    key(facts({ installed: true, slotStatus: 'READY', packageReady: true, preflightOk: null, hasCandidates: true })),
    'team.next.select',
    '建赛后不再问 Preflight'
  );
  // 每条提示键两种语言都有译文
  const seen = new Set<string>();
  const all: Partial<TeamFacts>[] = [
    {},
    { installed: true, slotStatus: 'INVALID' },
    { installed: true, slotStatus: 'READY', packageReady: false },
    { ...READY_PKG, preflightOk: false },
    { ...READY_PKG, preflightOk: null },
    READY_PKG,
    { ...READY_PKG, hasCandidates: true },
    { ...READY_PKG, hasCandidates: true, selected: 'A1' },
    { ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true },
    { ...READY_PKG, hasCandidates: true, selected: 'A1', locked: true, opponentLocked: true, revealed: true },
    { ...READY_PKG, round: 2 },
    { ...READY_PKG, ended: true },
  ];
  for (const p of all) {
    const h = nextHint(facts(p));
    seen.add(h.key);
    for (const locale of LOCALES) {
      const v = table(locale)[h.key];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺提示 ${h.key}`);
      if (h.params) for (const k of Object.keys(h.params)) assert(v.includes(`{${k}}`), `${locale} 的 ${h.key} 缺占位符 {${k}}`);
    }
  }
  assertEqual(seen.size, 12, '十二条提示各自可达');
});

test('team: 锁定后的字面量 —— 英文含 LOCKED 与 “cannot be changed for this match”，中文含「锁定」', () => {
  const en = table('en-US');
  const zh = table('zh-CN');
  assert(en['team.emitter.lockedBadge'].includes('LOCKED'), '英文徽章含 LOCKED');
  assert(zh['team.emitter.lockedBadge'].includes('LOCKED') && zh['team.emitter.lockedBadge'].includes('锁定'), '中文徽章同时含 LOCKED 与「锁定」');
  assert(/cannot be changed for this match/i.test(en['team.emitter.immutable']), '英文不可变句');
  assert(zh['team.emitter.immutable'].includes('不可更改'), '中文不可变句');
  // 演练钉住的两个 .tag 全文
  assertEqual(zh['team.emitter.locked'], '已锁定', 'team-emitter 的 .tag（zh）');
  assertEqual(zh['team.package.ready'], '已就绪', 'team-package 的 .tag（zh）');
  assertEqual(en['team.package.ready'], 'Ready', 'team-package 的 .tag（en）');
});

test('team: TeamPage 的可点性只读服务端 enabled —— disabled 表达式里不出现阶段名，且不开锁定快捷键', () => {
  const src = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', 'TeamPage.tsx'), 'utf-8');
  const disabledExprs = [...src.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1]);
  assert(disabledExprs.length >= 3, `应当扫到若干 disabled 表达式，实际 ${disabledExprs.length}`);
  for (const e of disabledExprs) {
    assert(!/phase/i.test(e), `disabled 表达式里出现了阶段名：${e}`);
    assert(/enabled|busy|canSelect/.test(e), `disabled 表达式应由 enabled / busy 推出：${e}`);
  }
  assert(!/phase\s*===/.test(src), 'TeamPage 里不该有 phase === 的判断（阶段只决定展示，且那部分在 teamSteps.ts）');
  // 锁定不可撤销：主动作不接 Cmd/Ctrl+Enter
  assert(!/shortcut(=\{true\}|\s)/.test(src), 'team-lock 不得开启快捷键');
  // 两个区块各恰好渲染一个 .tag（演练用 toHaveText 读全文）
  const tags = [...src.matchAll(/className=\{`tag\$\{/g)].length;
  assertEqual(tags, 2, '恰好两个 .tag（算法包 / Emitter 各一）');
  assert(!src.includes('className="tag'), '不得再有别的 .tag');
});

// ===========================================================================
// 观众大屏 / 回放播放器（F4）
// ===========================================================================

test('player: 速度只有 0.5 / 1 / 2，且只缩放动画时长与换帧间隔（同一倍率）', () => {
  assertEqual([...SPEEDS], [0.5, 1, 2], '三档速度');
  assertEqual(BASE_FRAME_MS, 1100, '1× 的帧动画时长与 V1.1 回放一致');
  assertEqual(frameDurationMs(1), 1100, '1×');
  assertEqual(frameDurationMs(2), 550, '2× 减半');
  assertEqual(frameDurationMs(0.5), 2200, '0.5× 加倍');
  assertEqual(autoplayDelayMs(1), BASE_FRAME_MS + BASE_GAP_MS, '1× 的换帧间隔 = 动画 + 停顿');
  assertEqual(autoplayDelayMs(2), 550 + 175, '2× 两段一起减半');
  assertEqual(autoplayDelayMs(0.5), 2200 + 700, '0.5× 两段一起加倍');
  for (const sp of SPEEDS) {
    assert(autoplayDelayMs(sp) > frameDurationMs(sp), `${sp}× 换帧间隔必须大于动画时长（命中闪要有时间衰减）`);
    assert(isSpeed(sp), `${sp} 是合法速度`);
  }
  assert(!isSpeed(3) && !isSpeed('1') && !isSpeed(null), '其它值不是速度');
  assertEqual(SPEEDS.map(speedText), ['0.5×', '1×', '2×'], '速度文本 = 数 + 乘号，不随语言变');
  assertEqual(secondsText(123), '0.123 s', '毫秒 → 秒');
  assertEqual(secondsText(null), '—', '没记录画短横');
  assertEqual(secondsText(undefined), '—', '旧产物缺字段也画短横');
});

test('player: 命令越界夹取、手动换帧即暂停、末帧播放从头开始、自动播放到末帧停下', () => {
  const T = 5;
  assertEqual(clampIndex(-3, T), 0, '下界');
  assertEqual(clampIndex(99, T), 4, '上界');
  assertEqual(clampIndex(2.7, T), 2, '取整');
  assertEqual(clampIndex(3, 0), 0, '没有帧时恒为 0');

  assertEqual(applyCommand({ index: 2, playing: true }, 'next', T), { index: 3, playing: false }, '下一轮并暂停');
  assertEqual(applyCommand({ index: 0, playing: true }, 'prev', T), { index: 0, playing: false }, '首帧再上一轮：不越界');
  assertEqual(applyCommand({ index: 4, playing: false }, 'next', T), { index: 4, playing: false }, '末帧再下一轮：不越界');
  assertEqual(applyCommand({ index: 3, playing: true }, 'first', T), { index: 0, playing: false }, 'Home');
  assertEqual(applyCommand({ index: 0, playing: true }, 'last', T), { index: 4, playing: false }, 'End');
  assertEqual(applyCommand({ index: 1, playing: false }, 'toggle', T), { index: 1, playing: true }, '播放');
  assertEqual(applyCommand({ index: 1, playing: true }, 'toggle', T), { index: 1, playing: false }, '暂停');
  assertEqual(applyCommand({ index: 4, playing: false }, 'toggle', T), { index: 0, playing: true }, '停在末帧按播放 = 从头再看');
  assertEqual(applyCommand({ index: 4, playing: true }, 'toggle', T), { index: 4, playing: false }, '末帧正在播放时按 = 暂停，不跳帧');

  assertEqual(advance({ index: 0, playing: true }, T), { index: 1, playing: true }, '自动播放走一帧');
  assertEqual(advance({ index: 4, playing: true }, T), { index: 4, playing: false }, '末帧后停下，不循环');
  // 一条真实的自动播放路径：从 0 走到末帧恰好 T-1 步，然后 playing=false
  let st = { index: 0, playing: true };
  let steps = 0;
  while (st.playing && steps < 100) {
    st = advance(st, T);
    steps++;
  }
  assertEqual(steps, T, `走满 ${T} 帧后停下（含最后一次判停）`);
  assertEqual(st, { index: T - 1, playing: false }, '停在末帧');

  assertEqual(keyToCommand('ArrowLeft'), 'prev', '←');
  assertEqual(keyToCommand('ArrowRight'), 'next', '→');
  assertEqual(keyToCommand(' '), 'toggle', '空格');
  assertEqual(keyToCommand('Home'), 'first', 'Home');
  assertEqual(keyToCommand('End'), 'last', 'End');
  assertEqual(keyToCommand('Enter'), null, '其它键不认');
  for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assertEqual(keyToCommand(hostile), null, `原型链名字 ${hostile} 不得命中`);
  }
});

test('player: ReplayPage 只消费落盘帧 —— 不 import 引擎、不求值函数、速度只进 durationMs', () => {
  const src = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', 'ReplayPage.tsx'), 'utf-8');
  // 权威边界：回放不重跑算法、不重判、不补拉实时轨迹
  for (const bad of ['src/core', 'parseCanonicalDSL', 'evaluate(', 'judgeShot', '/api/trajectory', 'useTrajectory', 'useBoard']) {
    assert(!src.includes(bad), `ReplayPage 不该出现 ${bad}`);
  }
  // 轨迹点来自帧，动画时长来自速度模型；换帧间隔也是
  assert(src.includes('A: frame.trajectoryA') && src.includes('B: frame.trajectoryB'), '轨迹点直接取帧');
  assert(src.includes('durationMs: frameDurationMs(speed)'), 'durationMs 只由速度模型给');
  assert(src.includes('autoplayDelayMs(speed)'), '自动播放间隔由速度模型给');
  // 播放器控件的 testid 与演练钉住的 .frame-btn
  for (const id of ['replay-prev', 'replay-play', 'replay-next', 'replay-counter', 'replay-timeline', 'replay-speed', 'replay-frame-list', 'replay-frame', 'replay-verdict', 'replay-player', 'replay-frame-info']) {
    assert(src.includes(`data-testid="${id}"`) || src.includes(`data-testid={\`${id}`), `ReplayPage 缺 data-testid ${id}`);
  }
  assert(src.includes('className="frame-btn"'), '逐轮按钮保留 .frame-btn（演练用它）');
  assert(src.includes('aria-pressed={player.playing}'), '播放键 aria-pressed');
  // 计数器走 t()，不手拼
  assert(src.includes("t('replay.counter', { n: frame.round, total })"), '「第 N / 共 T 轮」经 t()');
  // 胜者 / 终局原因 / 先手 / 难度都经标签助手，枚举原文只进 data-*
  for (const helper of ['winnerLabel(', 'endReasonLabel(', 'firstSolverLabel(', 'difficultyLabel(']) {
    assert(src.includes(helper), `ReplayPage 应使用 ${helper}`);
  }
  assert(src.includes('data-end-reason={replay.endReason}') && src.includes('data-winner={replay.winner}'), '枚举原文进 data-*');
});

test('spectator: 横幅键只由阶段与回合推出；先手色 token 对未知值中性；arenaKey 按内容相等', () => {
  for (const phase of PHASES) {
    const k0 = bannerKey(phase, 0);
    const k3 = bannerKey(phase, 3);
    if (phase === 'READY') {
      assertEqual(k0, 'phase.READY', '开赛前的 READY 就是「就绪」');
      assertEqual(k3, 'spectator.readyNextRound', '第一轮之后的 READY 是「等待下一轮」');
    } else {
      assertEqual(k0, `phase.${phase}`, `${phase} 用阶段表`);
      assertEqual(k3, k0, `${phase} 不随回合变`);
    }
    for (const locale of LOCALES) {
      const v = table(locale)[k0];
      assert(typeof v === 'string' && v.length > 0 && v !== phase, `${locale} 的 ${k0} 要有译文且不是裸枚举`);
    }
  }
  assertEqual(firstTone('A'), 'a', 'A 队色');
  assertEqual(firstTone('B'), 'b', 'B 队色');
  assertEqual(firstTone('tie'), 'neutral', '并列中性');
  assertEqual(firstTone('none'), 'neutral', '无中性');
  assertEqual(firstTone(undefined), 'neutral', '还没打过：中性');
  for (const hostile of ['constructor', 'toString', '__proto__', 'X']) {
    assertEqual(firstTone(hostile), 'neutral', `未知值 ${hostile} 中性，不命中原型链`);
  }
  const arena = {
    field: { xMin: -20, xMax: 20, yMin: -12, yMax: 12 },
    obstacles: [],
    emitters: null,
    points: [{ id: 'A1', team: 'A' as const, position: { x: -10, y: 1 }, alive: true }],
  };
  assertEqual(arenaKey(arena), arenaKey(JSON.parse(JSON.stringify(arena))), '内容相同 → 键相同（board 每条都是新对象）');
  assert(
    arenaKey(arena) !== arenaKey({ ...arena, points: [{ ...arena.points[0], alive: false }] }),
    '一个点死了 → 键变化'
  );
});

test('spectator: SpectatorPage 源码没有按钮 / 没有 data-action / 没有点击处理，且 testid 齐全', () => {
  const src = fs.readFileSync(path.join(REPO, 'web', 'src', 'pages', 'SpectatorPage.tsx'), 'utf-8');
  assert(!/<button/.test(src), '大屏不渲染任何 <button>（语言开关在 AppShell 里）');
  assert(!/data-action/.test(src), '大屏没有任何 data-action');
  assert(!/onClick|onKeyDown|command\(/.test(src), '大屏没有任何交互处理，也不发命令');
  assert(src.includes("nav: 'none'"), '外壳导航关掉（除语言开关外不得有按钮）');
  for (const id of ['spectator', 'spectator-pending', 'spectator-status', 'spectator-verdict', 'spectator-round', 'spectator-first', 'spectator-note']) {
    assert(src.includes(`data-testid="${id}"`), `SpectatorPage 缺 data-testid ${id}`);
  }
  assert(src.includes('data-board="ready"') && src.includes('data-board="pending"'), 'data-board 两态都在');
  // 只读根元素才叫 spectator：演练以它可见为同步点，随后立刻读正文 —— pending 门不得冒名
  assert(!/data-testid="spectator"[^>]*data-board="pending"/.test(src), 'pending 门不得使用 data-testid="spectator"');
  // 判决与先手都经标签助手；终局带上没有手拼的 TEAM
  for (const helper of ['winnerLabel(', 'endReasonLabel(', 'firstSolverLabel(', 'localizeRoundErrors(']) {
    assert(src.includes(helper), `SpectatorPage 应使用 ${helper}`);
  }
  // 演练钉住的英文原句：`Team A alive`（lowercase 比对）与回放页的 `Rounds`
  assertEqual(table('en-US')['spectator.alive'].replace('{team}', 'A'), 'Team A alive', 'i18n.spec 钉住的大屏英文');
  assertEqual(table('en-US')['replay.rounds'], 'Rounds', 'i18n.spec 钉住的回放英文');
  // 新键两种语言都有、占位符齐
  for (const [key, holes] of [
    ['replay.counter', ['n', 'total']],
    ['spectator.verdictRound', ['n']],
    ['replay.speedOption', ['x']],
    ['replay.frameEnd', ['reason']],
  ] as const) {
    for (const locale of LOCALES) {
      const v = table(locale)[key];
      assert(typeof v === 'string' && v.length > 0, `${locale} 缺 ${key}`);
      for (const h of holes) assert(v.includes(`{${h}}`), `${locale} 的 ${key} 缺占位符 {${h}}`);
    }
  }
  assert(table('en-US')['spectator.verdictRound'].startsWith('ROUND '), '英文终局带写 ROUND N');
});

void runAll('web-wizard');
