/**
 * 裁判向导的**展示模型** —— 纯模块，不含 React。
 *
 * 只回答两个问题：「当前阶段该高亮步骤条的哪一格」与「这一步该把哪个动作
 * 放到主按钮上」。它**不回答**「能不能点」：可用性永远只读服务端下发的
 * `ActionView.enabled`（ARCHITECTURE §2.3）。阶段名在这里只决定**显示**。
 *
 * 从 JudgePage.tsx 抽出来的原因：这张表是向导的核心不变量（每个 WirePhase 都有
 * 一格、格子沿主流程单调不减、候选动作都是服务端认得的 key），值得一套不开浏览器
 * 就能跑的回归（`tests/web-wizard.ts`）—— 而 .tsx 在根 tsconfig 下编译不过。
 */

import { WIZARD_STAGES } from '../i18n/translations';
import type { TranslationKey, WizardStage } from '../i18n/translations';
import type { ActionView, WirePhase } from '../../../src/server/protocol';

/**
 * 步骤条的七格，按主流程顺序。
 *
 * 机器标识（`data-stage`）沿用 V1.2 的取值，不随 V1.4 的显示名改动 ——
 * 显示名由 `WIZARD_STAGE_KEYS` 按语言取：Match Setup / Algorithm Ready /
 * Emitter Lock / Ready / Reveal / Running / Match End。
 */
export const STAGE_ORDER: readonly WizardStage[] = WIZARD_STAGES;

export interface WizardStep {
  /** 步骤条里高亮哪一格 */
  stage: WizardStage;
  /** 这一步在做什么（静态说明 —— 不是可用性判据）。存**键**，渲染时再取文案 */
  whatKey: TranslationKey;
  /**
   * 本步的**候选主动作**（按优先级）。
   *
   * 这张表只回答「这一步该做哪件事」；「能不能做」永远只读服务端的
   * `action.enabled`。首选动作若被服务端判为不可用，就顺延到本步下一个
   * **服务端说可用**的动作（例：READY 下 `reveal` 与 `run-to-end` 的分工）。
   * 一个候选都不可用时，仍然展示首选动作并把它**不可点的原因**（服务端 hint）亮出来。
   */
  candidates: readonly string[];
  /** 这一步由选手完成、裁判没有动作（EMITTER_SELECT）—— 不摆主按钮，只报状态 */
  waiting?: boolean;
  /**
   * 本步的主位置放的是一条**链接**而不是服务端动作（MATCH_END → 打开回放）。
   *
   * 终局时服务端给的唯一动作是 `reset`（= 换场，危险动作）。V1.4 任务书把终局的
   * 主动作定为「Open Replay」：把换场摆在主按钮上、再配 ⌘/Ctrl+Enter，等于让裁判
   * 两下键就作废双方的 Emitter 锁定。所以这里 `candidates` 为空、换场退到 Advanced
   * （仍两步确认），主位置由页面渲染成回放链接。
   */
  primaryLink?: 'replay';
}

export const STEPS: Record<WirePhase, WizardStep> = {
  SETUP: {
    stage: 'SETUP',
    whatKey: 'judge.step.SETUP',
    // `prepare` 排在前面：它一次做完封装双方 → Preflight → 建赛。
    // 只有在它不可用（例如另一边还没就绪）时，才顺延到单队的「使用槽位算法」。
    // 反过来排会把 `prepare` 挤进 Advanced 折叠区 —— 那正好是本步的主按钮。
    candidates: ['prepare', 'use-slot-a'],
  },
  UPLOAD_A: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.UPLOAD_A',
    candidates: ['prepare', 'use-slot-b'],
  },
  UPLOAD_B: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.UPLOAD_B',
    candidates: ['prepare', 'preflight', 'start'],
  },
  PREFLIGHT: {
    stage: 'ALGORITHM READY',
    whatKey: 'judge.step.PREFLIGHT',
    candidates: ['prepare', 'start'],
  },
  EMITTER_SELECT: {
    stage: 'EMITTER LOCK',
    whatKey: 'judge.step.EMITTER_SELECT',
    candidates: [],
    waiting: true,
  },
  READY: {
    stage: 'READY',
    whatKey: 'judge.step.READY',
    candidates: ['reveal', 'run-to-end'],
  },
  PUBLIC: {
    stage: 'START MATCH',
    whatKey: 'judge.step.PUBLIC',
    candidates: ['reveal', 'start-round', 'run-to-end'],
  },
  REVEAL: {
    stage: 'START MATCH',
    whatKey: 'judge.step.REVEAL',
    candidates: ['start-round', 'reveal', 'run-to-end'],
  },
  COUNTDOWN: {
    stage: 'ROUND',
    whatKey: 'judge.step.COUNTDOWN',
    candidates: ['compute'],
  },
  COMPUTING: {
    stage: 'ROUND',
    whatKey: 'judge.step.COMPUTING',
    candidates: ['compute'],
  },
  ROUND_RESULT: {
    stage: 'ROUND',
    whatKey: 'judge.step.ROUND_RESULT',
    candidates: ['reveal', 'run-to-end'],
  },
  MATCH_END: {
    stage: 'MATCH END',
    whatKey: 'judge.step.MATCH_END',
    // 主位置是「打开回放」；`reset` 不做候选 —— 它只在 Advanced 里出现（见 primaryLink 的说明）
    candidates: [],
    primaryLink: 'replay',
  },
};

/**
 * 从服务端的动作清单里挑出本步的主按钮。
 *
 * **只用 `enabled` 做「本步候选之间」的选择，不用它之外的东西判断可用性。**
 * 一个候选都没启用时返回首选候选（按钮仍然是 disabled，原因由它的 hint 给出）；
 * 本步没有候选（选手在做的那一步，或主位置是链接的终局）时返回 null。
 */
export function pickPrimary(actions: readonly ActionView[], step: WizardStep): ActionView | null {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  for (const key of step.candidates) {
    const a = byKey.get(key);
    if (a?.enabled) return a;
  }
  const first = step.candidates[0];
  return first ? byKey.get(first) ?? null : null;
}

/** 阶段 → 步骤条的格号（0 起）。步骤条用它给每格定 done / now / todo。 */
export function stageIndexOf(phase: WirePhase): number {
  return STAGE_ORDER.indexOf(STEPS[phase].stage);
}
