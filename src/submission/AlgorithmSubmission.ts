/**
 * Algorithm Submission System
 * Plan 2 Phase A: Upload, Validation, Hash
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseManifest, Manifest } from './Manifest';

export interface SubmissionStatus {
  packageValid: boolean;
  manifestValid: boolean;
  runtimeValid: boolean;
  importTest: boolean;
  sampleRoundTest: boolean;
  dslValidation: boolean;
  timeoutTest: boolean;
  ready: boolean;
  errors: string[];
  packageHash: string | null;
}

export interface AlgorithmSubmission {
  teamId: 'A' | 'B';
  packagePath: string | null;
  manifest: Manifest | null;
  status: SubmissionStatus;
  uploadTime: Date | null;
}

/**
 * 计算文件包的 SHA-256 hash
 */
export function computePackageHash(dirPath: string): string {
  const hash = crypto.createHash('sha256');

  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files.sort()) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath);
      } else {
        const content = fs.readFileSync(filePath);
        hash.update(content);
      }
    }
  }

  walkDir(dirPath);
  return hash.digest('hex');
}

/**
 * 验证 Algorithm Package
 */
export function validatePackage(dirPath: string): {
  valid: boolean;
  errors: string[];
  manifest: Manifest | null;
} {
  const errors: string[] = [];

  // Check directory exists
  if (!fs.existsSync(dirPath)) {
    return { valid: false, errors: ['Package 目录不存在'], manifest: null };
  }

  // Check manifest.json
  const manifestPath = path.join(dirPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, errors: ['缺少 manifest.json'], manifest: null };
  }

  // Parse manifest
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifestResult = parseManifest(manifestContent);

  if (!manifestResult.valid || !manifestResult.manifest) {
    return { valid: false, errors: manifestResult.errors, manifest: null };
  }

  // Check entry file exists
  const entryPath = path.join(dirPath, manifestResult.manifest.entry);
  if (!fs.existsSync(entryPath)) {
    return { valid: false, errors: [`entry 文件不存在: ${manifestResult.manifest.entry}`], manifest: null };
  }

  return { valid: true, errors: [], manifest: manifestResult.manifest };
}

/**
 * 创建空的 Submission
 */
export function createEmptySubmission(teamId: 'A' | 'B'): AlgorithmSubmission {
  return {
    teamId,
    packagePath: null,
    manifest: null,
    status: {
      packageValid: false,
      manifestValid: false,
      runtimeValid: false,
      importTest: false,
      sampleRoundTest: false,
      dslValidation: false,
      timeoutTest: false,
      ready: false,
      errors: [],
      packageHash: null,
    },
    uploadTime: null,
  };
}
