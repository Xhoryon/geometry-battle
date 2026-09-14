/**
 * Bilingual Documentation Regression Tests
 *
 * Verifies that all public-facing documentation maintains bilingual
 * coverage (zh-CN + en-US) with language-switchable pairs.
 *
 * V1.4.2 — Language-pair model: each key document has .md (English) + .zh-CN.md (Chinese)
 *          with top navigation links.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

/**
 * All public-facing documentation files that MUST have language pairs.
 *
 * Format: [baseRelativePath (without .zh-CN.md), description]
 * Test will verify both .md and .zh-CN.md exist.
 */
const REQUIRED_LANGUAGE_PAIRS: Array<[string, string]> = [
  // Core documentation
  ['README.md', 'Main repository introduction'],
  ['docs/ARCHITECTURE.md', 'System architecture'],
  ['docs/V1.4_FAIRNESS_REPORT.md', 'Platform fairness report'],
  ['docs/RELEASE_NOTES.md', 'Release history'],
  ['docs/BILINGUAL_DOCUMENTATION.md', 'Bilingual documentation index'],
  ['docs/REPRODUCIBILITY.md', 'Reproducibility guide'],

  // Competitor documentation
  ['competitor-kit/README.md', 'Competitor kit overview'],
  ['competitor-kit/ALGORITHM_REQUIREMENTS.md', 'Algorithm requirements'],
  ['competitor-kit/DSL_SPECIFICATION.md', 'DSL specification'],
  ['competitor-kit/JSON_SCHEMA.md', 'JSON schema documentation'],
  ['competitor-kit/RUNTIME_MANIFEST.md', 'Runtime manifest specification'],
  ['algorithms/README.md', 'Algorithm submission structure'],

  // Demo & reference
  ['demo/reference-solver-v2/README.md', 'Reference solver documentation'],

  // Playtest documentation
  ['playtest/competitors/solver-fast/README.md', 'solver-fast documentation'],
  ['playtest/competitors/solver-optimizer/README.md', 'solver-optimizer documentation'],
  ['playtest/competitors/solver-hybrid/README.md', 'solver-hybrid documentation'],
  ['playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md', 'Dual algorithm playtest report'],
  ['playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md', 'Round 2 playtest report'],
  ['playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md', 'Shooter rule rebalance report'],
];

/**
 * Convert base path to Chinese pair path
 * e.g., "README.md" -> "README.zh-CN.md"
 *       "docs/RULES.md" -> "docs/RULES.zh-CN.md"
 */
function toChinesePairPath(basePath: string): string {
  return basePath.replace(/\.md$/, '.zh-CN.md');
}

describe('Bilingual Documentation — Language Pairs (V1.4.2)', () => {
  describe('File Existence', () => {
    REQUIRED_LANGUAGE_PAIRS.forEach(([basePath, description]) => {
      const chinesePath = toChinesePairPath(basePath);

      it(`${description}: English version exists (${basePath})`, () => {
        const fullPath = resolve(REPO_ROOT, basePath);
        expect(existsSync(fullPath), `Expected ${basePath} to exist`).toBe(true);
      });

      it(`${description}: Chinese version exists (${chinesePath})`, () => {
        const fullPath = resolve(REPO_ROOT, chinesePath);
        expect(existsSync(fullPath), `Expected ${chinesePath} to exist`).toBe(true);
      });
    });
  });

  describe('Language Navigation Links', () => {
    REQUIRED_LANGUAGE_PAIRS.forEach(([basePath, description]) => {
      const chinesePath = toChinesePairPath(basePath);

      it(`${description}: English version has language switcher`, () => {
        const fullPath = resolve(REPO_ROOT, basePath);
        if (!existsSync(fullPath)) return; // Skip if file doesn't exist

        const content = readFileSync(fullPath, 'utf-8');
        const first100Lines = content.split('\n').slice(0, 100).join('\n');

        // Must contain link to Chinese version
        const hasChineseLink = first100Lines.includes(chinesePath) ||
                               first100Lines.includes('简体中文');

        expect(hasChineseLink,
          `${basePath} must link to Chinese version in top navigation`
        ).toBe(true);
      });

      it(`${description}: Chinese version has language switcher`, () => {
        const fullPath = resolve(REPO_ROOT, chinesePath);
        if (!existsSync(fullPath)) return; // Skip if file doesn't exist

        const content = readFileSync(fullPath, 'utf-8');
        const first100Lines = content.split('\n').slice(0, 100).join('\n');

        // Must contain link to English version
        const hasEnglishLink = first100Lines.includes(basePath) ||
                               first100Lines.includes('English');

        expect(hasEnglishLink,
          `${chinesePath} must link to English version in top navigation`
        ).toBe(true);
      });
    });
  });

  describe('No Obsolete Bilingual Markers', () => {
    REQUIRED_LANGUAGE_PAIRS.forEach(([basePath]) => {
      const chinesePath = toChinesePairPath(basePath);

      it(`${basePath}: should NOT contain obsolete bilingual-doc marker`, () => {
        const fullPath = resolve(REPO_ROOT, basePath);
        if (!existsSync(fullPath)) return;

        const content = readFileSync(fullPath, 'utf-8');
        const hasObsoleteMarker = content.includes('<!-- bilingual-doc:');

        expect(hasObsoleteMarker,
          `${basePath} should not contain V1.4.1 bilingual-doc marker`
        ).toBe(false);
      });

      it(`${chinesePath}: should NOT contain obsolete bilingual-doc marker`, () => {
        const fullPath = resolve(REPO_ROOT, chinesePath);
        if (!existsSync(fullPath)) return;

        const content = readFileSync(fullPath, 'utf-8');
        const hasObsoleteMarker = content.includes('<!-- bilingual-doc:');

        expect(hasObsoleteMarker,
          `${chinesePath} should not contain V1.4.1 bilingual-doc marker`
        ).toBe(false);
      });
    });
  });
});
