/**
 * Algorithm Package Manifest
 * Plan 2 Phase A: Algorithm Submission Protocol
 */

export interface Manifest {
  name: string;
  version: string;
  entry: string;
  language: 'python';
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
  manifest: Manifest | null;
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
    if (!obj.entry || typeof obj.entry !== 'string') {
      errors.push('manifest.entry 是必需的');
    }
    if (obj.language !== 'python') {
      errors.push('目前只支持 python runtime');
    }

    // Validate entry file extension
    if (obj.entry && !obj.entry.endsWith('.py')) {
      errors.push('entry 必须是 .py 文件');
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
        entry: obj.entry,
        language: obj.language,
      },
    };
  } catch (e) {
    return { valid: false, errors: ['manifest.json 解析失败'], manifest: null };
  }
}
