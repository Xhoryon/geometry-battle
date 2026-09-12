/**
 * i18n —— 翻译表与语言解析的回归（V1.3）
 *
 * 浏览器里的行为由 `web/e2e/i18n.spec.ts` 覆盖；这一套盯的是**表本身**，
 * 而且不需要浏览器：
 *
 *   1. 两张表的键集合完全一致、没有空文案；
 *   2. 插值不做手工拼接（缺参保留占位，而不是悄悄渲染成空串）；
 *   3. 服务端下发的动作 key **全部**有译文 —— 认不出来时也绝不吐裸 key；
 *   4. 浏览器语言 → locale 的规则（只有 `zh-*` 是中文，其余一律英文）；
 *   5. 机器标识不被翻译（`solver.py` / `manifest.json` / `DSL` / `SHA-256` /
 *      错误码 `NOT_THROUGH_SHOOTER` 等一律原样）。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PHASE_KEYS,
  getActiveLocale,
  setActiveLocale,
  t,
  td,
  translate,
  translateDynamic,
  translations,
} from '../web/src/i18n/translations';
import {
  FALLBACK_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  localeFromLanguageTag,
} from '../web/src/i18n/types';
import type { Locale } from '../web/src/i18n/types';
import { assert, assertEqual, runAll, test } from './harness';

const REPO = path.join(__dirname, '..');

/**
 * 一张表按「任意字符串键」看。
 *
 * 真实类型是 `Record<TranslationKey, string>`（键是联合字面量），
 * 而本套件要拿**运行期算出来的**键去查（服务端源码里扫出来的那些），
 * 所以这里显式放宽 —— 查不到正是我们要断言的事。
 */
const table = (locale: Locale): Record<string, string> =>
  translations[locale] as unknown as Record<string, string>;

const keysOf = (locale: Locale): string[] => Object.keys(table(locale)).sort();

// ===========================================================================

test('i18n: 两张表的键集合完全一致，且没有空文案', () => {
  // 类型层面 `Record<TranslationKey, string>` 已经保证了这一点；
  // 这里在**运行期**再验一次 —— 防的是有人用 `as any` 之类绕过类型。
  assertEqual(keysOf('en-US'), keysOf('zh-CN'), '英文表必须与中文表键完全一致');
  assert(keysOf('zh-CN').length > 100, `键数应当有几百条，实际 ${keysOf('zh-CN').length}`);

  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(table(locale))) {
      assert(typeof value === 'string' && value.trim().length > 0, `${locale} 的 ${key} 不得为空`);
      assert(!/\{\s*\}/.test(value), `${locale} 的 ${key} 有空的占位符`);
    }
  }
});

test('i18n: 每个阶段都有译文，且不是裸枚举', () => {
  for (const [phase, key] of Object.entries(PHASE_KEYS)) {
    for (const locale of LOCALES) {
      const text = table(locale)[key];
      assert(typeof text === 'string' && text.length > 0, `${locale} 缺阶段 ${phase}`);
      // 「翻译过」的最低标准：不等于枚举本身。观众不该在屏上看到 EMITTER_SELECT。
      assert(text !== phase, `${locale} 的阶段 ${phase} 看起来根本没翻译`);
    }
  }
});

test('i18n: 服务端下发的动作 key 全部有译文（防漂移）', () => {
  // 动作的 label/hint 由**服务端**给键（`ActionView.labelKey` / `hintKey`），
  // 客户端按语言翻译。少一条译文，界面上就会出现一句服务端原文（中文），
  // 而界面其余部分是英文 —— 那正是「混合语言」事故。
  //
  // 因此这里直接扫 `boards.ts` 的源码，把里面出现的每个 `action.*` 字面量
  // 都拿去两张表里查一遍。不构造引擎：这样连三元分支里的键也一网打尽。
  const src = fs.readFileSync(path.join(REPO, 'src', 'server', 'boards.ts'), 'utf-8');
  const emitted = new Set<string>();
  for (const m of src.matchAll(/'(action\.[A-Za-z0-9_.]+)'/g)) emitted.add(m[1]);

  assert(emitted.size >= 20, `boards.ts 里的动作 key 应当有二十来条，实际 ${emitted.size}`);

  for (const key of emitted) {
    for (const locale of LOCALES) {
      const text = table(locale)[key];
      assert(
        typeof text === 'string' && text.length > 0,
        `${locale} 缺少服务端动作 key 的译文: ${key}`
      );
    }
  }

  // 反向对照：表里的 action.* 键也应当都被服务端用着，不留死键
  const inTable = new Set(Object.keys(table('zh-CN')).filter((k) => k.startsWith('action.')));
  const dead = [...inTable].filter((k) => !emitted.has(k));
  assertEqual(dead, [], '翻译表里的 action.* 键必须都被服务端发出，否则是死键');
});

test('i18n: 插值与宽容查找', () => {
  assertEqual(
    translate('zh-CN', 'team.note.selected', { id: 'A3' }),
    '已选择 A3',
    '中文插值'
  );
  assertEqual(translate('en-US', 'team.note.selected', { id: 'A3' }), 'Picked A3', '英文插值');

  // 缺参**保留占位**（一眼看得出漏传），而不是渲染成空串
  assert(
    translate('en-US', 'team.note.selected').includes('{id}'),
    '缺参时必须保留占位符，便于排查'
  );

  // 宽容查找：认不出的 key 回退到服务端原文，**绝不把 key 当文案吐出去**
  assertEqual(
    translateDynamic('en-US', 'action.brandNew.thing', {}, '服务端原文'),
    '服务端原文',
    '认不出时必须回退到 fallback'
  );
  assertEqual(
    translateDynamic('en-US', 'action.useSlot.label', { team: 'A' }),
    'Use the algorithm in the slot (Team A)',
    '认得出时按当前语言翻译'
  );
  // 连 fallback 都没有时退回 key 本身（可见地坏掉，好过静默）
  assertEqual(translateDynamic('en-US', 'nope.nope'), 'nope.nope', '没有 fallback 时退回 key');
});

test('i18n: 浏览器语言 → locale（规格：只有 zh-* 是中文）', () => {
  assertEqual(localeFromLanguageTag('zh-CN'), 'zh-CN', 'zh-CN');
  assertEqual(localeFromLanguageTag('zh'), 'zh-CN', 'zh');
  assertEqual(localeFromLanguageTag('zh-TW'), 'zh-CN', 'zh-TW 也归到 zh-CN');
  assertEqual(localeFromLanguageTag('zh-Hans-CN'), 'zh-CN', '带脚本的 zh-*');

  assertEqual(localeFromLanguageTag('en-US'), 'en-US', 'en-US');
  assertEqual(localeFromLanguageTag('ja-JP'), 'en-US', '其它语言一律英文');
  assertEqual(localeFromLanguageTag('de'), 'en-US', '德语也走英文');
  assertEqual(localeFromLanguageTag(null), FALLBACK_LOCALE, '拿不到语言时用兜底');
  assertEqual(localeFromLanguageTag(undefined), FALLBACK_LOCALE, 'undefined 同理');

  assertEqual(FALLBACK_LOCALE, 'en-US', '兜底语言是英文');
  assertEqual(LOCALE_STORAGE_KEY, 'geometry-battle.locale', '持久化键由规格指定，不要改');
});

test('i18n: 模块级 t() 跟随当前语言（非组件代码用）', () => {
  const before = getActiveLocale();
  try {
    setActiveLocale('zh-CN');
    assertEqual(t('team.emitter.locked'), '已锁定', '中文');
    assertEqual(td('action.reveal.label'), '揭晓本轮（REVEAL）', '中文（服务端键）');

    setActiveLocale('en-US');
    assertEqual(t('team.emitter.locked'), 'Locked', '英文');
    assertEqual(td('action.reveal.label'), 'Reveal this round (REVEAL)', '英文（服务端键）');
    assertEqual(td('action.reveal.hint'), 'Publish this round’s obstacles — contestant code still has not run', '英文（hint）');
  } finally {
    setActiveLocale(before);
  }
});

test('i18n: 机器标识不被翻译', () => {
  // 两类东西，判据不同：
  //
  //   A. **机器标识** —— 文件名、格式名、算法名。它们不是「词」，是标识符：
  //      同一条文案里，一边写了就必须两边都写，而且要逐字节相同。
  //   B. **产品术语** —— Emitter / Preflight / Team A / START……
  //      规格要求它们是稳定术语。中文界面的措辞可以是地道的（例如导航里
  //      「参赛者 A」对应英文的「Team A」），但**英文界面**必须用这些原词，
  //      不许换说法。
  const MACHINE = ['solver.py', 'manifest.json', 'DSL', 'SHA-256'];
  const TERMS = ['Emitter', 'Preflight', 'Team A', 'Team B', 'START'];

  const zh = table('zh-CN');
  const en = table('en-US');

  let machineHits = 0;
  for (const key of Object.keys(zh)) {
    for (const id of MACHINE) {
      const inZh = zh[key].includes(id);
      const inEn = en[key].includes(id);
      assertEqual(inEn, inZh, `机器标识 ${id} 在 ${key} 里两边不一致（zh=${inZh} / en=${inEn}）`);
      if (inZh) machineHits++;
    }
  }
  // 空转对照：用一个**具体且稳定**的锚点，而不是一个随手定的阈值 ——
  // 阈值只要接近当前命中数，改一次文案就会假红。
  assert(
    zh['team.upload.folderHint'].includes('solver.py') &&
      en['team.upload.folderHint'].includes('solver.py'),
    '上传提示里必须原样出现 solver.py —— 否则上面的对称检查是空转的'
  );
  assert(machineHits >= 1, `机器标识命中数应当大于零，实际 ${machineHits}`);

  // 英文界面里术语必须是原词（中文那边怎么写不限制）
  const enText = Object.values(en).join('\n');
  for (const term of TERMS) {
    assert(enText.includes(term), `英文界面必须原样使用术语 ${term}`);
  }

  // 错误码是对外机器标识，一个字都不许被改写
  for (const code of ['NOT_THROUGH_SHOOTER', 'TIMEOUT', 'INVALID_DSL', 'CRASH']) {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(table(locale))) {
        if (value.includes(code)) {
          assert(value.includes(code), `${locale} 的 ${key} 改写了错误码 ${code}`);
        }
      }
    }
  }

  // 命令 / 路径 / 协议字段名一律不进译文表（它们是机器标识，不是文案）
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(table(locale))) {
      assert(!value.includes('/api/'), `${locale} 的 ${key} 不该把 API 路径当文案`);
      assert(!value.includes('public_state.json'), `${locale} 的 ${key} 不该内嵌协议文件名`);
    }
  }
});

test('i18n: README 的代码围栏与文内锚点自洽', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf-8');
  const lines = readme.split('\n');

  // ---- 1) 代码围栏必须配对，且不得把 markdown 结构吞进代码块 ----
  //
  // 这条盯的是一个真实发生过的事故：双语化时中文那半的 ```python 少写了一个
  // 收尾围栏，于是「英文那半」整段被当成代码渲染，配对从那一处起整体错位 ——
  // 最严重的地方把第 3~6 节与「运行」整段（约 200 行）吞进了一个代码块，
  // 三个 Python 注释还被渲染成了 H1 标题。
  //
  // 围栏**数量是偶数**并不代表配对正确（那次就是偶数），所以这里查的是
  // 「块里有没有本该在块外的结构」。
  const fences: Array<{ n: number; info: string }> = [];
  lines.forEach((line, i) => {
    if (/^\s{0,3}```/.test(line)) fences.push({ n: i + 1, info: line.trim() });
  });
  assertEqual(fences.length % 2, 0, `README 的代码围栏必须是偶数，实际 ${fences.length}`);

  const STRUCTURE = /^(\*\*(English|中文)\.\*\*|#{2,6}\s|>\s|\|)/;
  const swallowed: string[] = [];
  for (let k = 0; k + 1 < fences.length; k += 2) {
    const open = fences[k];
    const close = fences[k + 1];
    lines.slice(open.n, close.n - 1).forEach((line, idx) => {
      if (STRUCTURE.test(line.trim())) {
        swallowed.push(`L${open.n + idx + 1}: ${line.trim().slice(0, 70)}`);
      }
    });
  }
  assertEqual(
    swallowed,
    [],
    `README 有 markdown 结构被吞进代码块（围栏配对错位）:\n  ${swallowed.join('\n  ')}`
  );

  // ---- 2) 文内锚点必须真的指得到某个标题 ----
  //
  // 双语化把标题改成「中文 / English」之后 slug 随之变化，只看中文的那批锚点
  // （`#许可与使用范围`）会全部失效。competitor-kit 的链接检查**显式跳过**
  // `#` 开头的目标，所以它抓不到这一类 —— 这里补上。
  const slug = (text: string): string =>
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/ /g, '-');

  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of lines) {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{1,6} (.+?)\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }

  const dead: string[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(/\]\(#([^)]*)\)/g)) {
      const anchor = decodeURIComponent(m[1]);
      if (!slugs.has(anchor)) dead.push(`#${anchor}`);
    }
  }
  assertEqual(dead, [], `README 里有指不到任何标题的锚点:\n  ${dead.join('\n  ')}`);

  // 空转对照：上面两条检查必须真的看过东西，否则它们对空文件也是绿的
  assert(slugs.size >= 20, `README 的标题数应当有几十个，实际 ${slugs.size}`);
  assert(fences.length >= 20, `README 的代码围栏应当有几十条，实际 ${fences.length}`);
});

test('i18n: 两张表的占位符集合一致（防串台 / 防漏参）', () => {
  const holes = (s: string): string[] =>
    [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

  const mismatched: string[] = [];
  for (const key of Object.keys(table('zh-CN'))) {
    const zhP = holes(table('zh-CN')[key]).join(',');
    const enP = holes(table('en-US')[key]).join(',');
    if (zhP !== enP) mismatched.push(`${key} → zh={${zhP}} / en={${enP}}`);
  }
  assertEqual(mismatched, [], `中英占位符不一致:\n  ${mismatched.join('\n  ')}`);

  // 空转对照：确定真的存在带占位符的键，否则上面是个空循环
  assert(holes(table('zh-CN')['judge.slot.settings']).length === 2, 'judge.slot.settings 应当有两个占位符');
  assert(holes(table('zh-CN')['action.useSlot.label']).includes('team'), 'action.useSlot.label 应当有 {team}');
});

test('i18n: 客户端必须把插值参数透传给 td()', () => {
  // 盯的是一个真实发生过的 bug：`actionLabel` 写成
  // `td(a.labelKey, undefined, a.label)`，于是 `action.useSlot.label` 的
  // `{team}` 被原样渲染成字面量 —— 中文界面和英文界面**同样**显示
  // “使用槽位算法（Team {team}）”。两边的表都没错，错在客户端没把参数传下去，
  // 所以「两张表一致」「键齐全」这类检查一条也抓不到它。
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) files.push(p);
    }
  };
  walk(path.join(REPO, 'web', 'src'));
  assert(files.length > 5, `web/src 下应当扫到若干源文件，实际 ${files.length}`);

  const bare: string[] = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf-8')
      .split('\n')
      .forEach((line, i) => {
        // `td(key, undefined, fallback)` —— 第二参写死 undefined，占位符必然漏参
        if (/\btd\([^)]*,\s*undefined\s*,/.test(line)) {
          bare.push(`${path.relative(REPO, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assertEqual(bare, [], `td() 的插值参数不得写死 undefined（占位符会原样渲染）:\n  ${bare.join('\n  ')}`);
});

void runAll('i18n');
