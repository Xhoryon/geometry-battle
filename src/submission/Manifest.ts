/**
 * Algorithm Package Manifest
 * Plan 2 Phase A: Algorithm Submission Protocol
 *
 * V1.1（Plans/Input/V1.1 — Algorithm Slot, Startup & JSON Protocol §3/§4）：
 *   入口名被**冻结**为 `solver.py`，平台不再用 `manifest.entry` 决定执行什么。
 *   因此 manifest.json 变为**可选**的元数据（名称 / 版本 / 语言）：
 *     - 缺失 → 用包目录名作为队名，版本记为 0.0.0；
 *     - 存在 → 仍做基本校验；`entry` 若写了，只允许写 `solver.py`。
 *   「不再读取 entry」不等于「随便写什么都行」：写成 `main.py` 会被明确拒绝，
 *   而不是静默忽略 —— 静默忽略只会让选手以为自己改的入口生效了。
 */

/** V1.1 固定入口（规范 §3/§4）：包根目录下必须存在，且是唯一正式入口。 */
export const ENTRY_FILENAME = 'solver.py';

export interface Manifest {
  name: string;
  version: string;
  /** V1.1：恒为 ENTRY_FILENAME —— 入口由协议冻结，不再由包自己声明。 */
  entry: string;
  language: 'python';
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
  manifest: Manifest | null;
}

/** 没有 manifest.json 时的默认元数据（V1.1 起 manifest 是可选的） */
export function defaultManifest(name: string): Manifest {
  return { name, version: '0.0.0', entry: ENTRY_FILENAME, language: 'python' };
}

export function parseManifest(json: string): ManifestValidation {
  const errors: string[] = [];

  try {
    const obj = JSON.parse(json);

    // Required fields
    if (!obj.name || typeof obj.name !== 'string') {
      errors.push('manifest.name 是必需的');
    }
    if (!obj.version || typeof obj.version !== 'string') {
      errors.push('manifest.version 是必需的');
    }
    // V1.1：entry 可选；写了就必须是固定入口，否则明确报错（规范 §4）
    if (obj.entry !== undefined) {
      if (typeof obj.entry !== 'string') {
        errors.push('manifest.entry 必须是字符串');
      } else if (obj.entry.split(/[\\/]/).pop() !== ENTRY_FILENAME) {
        errors.push(
          `manifest.entry 只能是 "${ENTRY_FILENAME}"（V1.1 §4：平台不再读取 entry，入口固定为 ${ENTRY_FILENAME}）`
        );
      }
    }
    if (obj.language !== undefined && obj.language !== 'python') {
      errors.push('目前只支持 python runtime');
    }

    if (errors.length > 0) {
      return { valid: false, errors, manifest: null };
    }

    return {
      valid: true,
      errors: [],
      manifest: {
        name: obj.name,
        version: obj.version,
        entry: ENTRY_FILENAME,
        language: 'python',
      },
    };
  } catch (e) {
    return { valid: false, errors: ['manifest.json 解析失败'], manifest: null };
  }
}
