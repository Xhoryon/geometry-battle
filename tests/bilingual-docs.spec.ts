/**
 * Bilingual Documentation Regression Tests
 *
 * Verifies that all public-facing documentation maintains bilingual
 * coverage (zh-CN + en-US) with the required format marker.
 *
 * V1.4.1 — Permanent regression protection for bilingual documentation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

/**
 * All public-facing documentation files that MUST be bilingual.
 *
 * Format: [relativePath, description]
 */
const REQUIRED_BILINGUAL_FILES: Array<[string, string]> = [
  // Core documentation
  ['README.md', 'Main repository introduction'],
  ['docs/ARCHITECTURE.md', 'System architecture'],
  ['docs/V1.4_FAIRNESS_REPORT.md', 'Platform fairness report'],
  ['docs/RELEASE_NOTES.md', 'Release history'],
  ['docs/BILINGUAL_DOCUMENTATION.md', 'Bilingual documentation index'],

  // Competitor documentation
  ['competitor-kit/ALGORITHM_REQUIREMENTS.md', 'Algorithm requirements'],
  ['algorithms/README.md', 'Algorithm submission structure'],

  // Demo & reference
  ['demo/reference-solver-v2/README.md', 'Reference solver documentation'],

  // Playtest documentation
  ['playtest/competitors/solver-fast/README.md', 'Algorithm A documentation'],
  ['playtest/competitors/solver-optimizer/README.md', 'Algorithm B documentation'],
  ['playtest/competitors/solver-hybrid/README.md', 'Algorithm C documentation'],
  ['playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md', 'Round 2 playtest report'],
];

/**
 * The canonical bilingual marker that must appear at the top of each file.
 */
const BILINGUAL_MARKER = '<!-- bilingual-doc: zh-CN + en-US -->';

describe('Bilingual Documentation', () => {
  describe('Required Files', () => {
    REQUIRED_BILINGUAL_FILES.forEach(([relativePath, description]) => {
      it(`${relativePath} exists`, () => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        expect(existsSync(fullPath), `${description} file must exist`).toBe(true);
      });

      it(`${relativePath} has bilingual marker`, () => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        const content = readFileSync(fullPath, 'utf-8');
        const firstLine = content.split('\n')[0];

        expect(
          firstLine,
          `${description} must start with bilingual marker: ${BILINGUAL_MARKER}`
        ).toBe(BILINGUAL_MARKER);
      });

      it(`${relativePath} is non-empty`, () => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        const content = readFileSync(fullPath, 'utf-8');

        expect(
          content.length,
          `${description} must have content beyond the marker`
        ).toBeGreaterThan(BILINGUAL_MARKER.length + 10);
      });
    });
  });

  describe('Bilingual Format', () => {
    it('all required files use consistent marker format', () => {
      const markers = new Set<string>();

      REQUIRED_BILINGUAL_FILES.forEach(([relativePath]) => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        const content = readFileSync(fullPath, 'utf-8');
        const firstLine = content.split('\n')[0];
        markers.add(firstLine);
      });

      expect(
        markers.size,
        'All bilingual files must use the same marker format'
      ).toBe(1);

      expect(
        [...markers][0],
        'The single marker format must match the canonical marker'
      ).toBe(BILINGUAL_MARKER);
    });
  });

  describe('Coverage Statistics', () => {
    it('reports total bilingual file count', () => {
      const count = REQUIRED_BILINGUAL_FILES.length;

      // V1.4.1 baseline: 12 files
      expect(count).toBeGreaterThanOrEqual(12);

      // Log for human verification in test output
      console.log(`✓ ${count} bilingual documentation files verified`);
    });

    it('reports total bilingual line count', () => {
      let totalLines = 0;

      REQUIRED_BILINGUAL_FILES.forEach(([relativePath]) => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        const content = readFileSync(fullPath, 'utf-8');
        const lineCount = content.split('\n').length;
        totalLines += lineCount;
      });

      // V1.4.1 baseline: ~4,683 lines
      expect(totalLines).toBeGreaterThan(4000);

      console.log(`✓ ${totalLines} total lines of bilingual documentation`);
    });
  });

  describe('File Structure Integrity', () => {
    it('no bilingual file is unexpectedly small', () => {
      REQUIRED_BILINGUAL_FILES.forEach(([relativePath, description]) => {
        const fullPath = resolve(REPO_ROOT, relativePath);
        const content = readFileSync(fullPath, 'utf-8');
        const lineCount = content.split('\n').length;

        // Minimum expected: marker + title + some content (at least 10 lines)
        expect(
          lineCount,
          `${description} (${relativePath}) seems unexpectedly small`
        ).toBeGreaterThanOrEqual(10);
      });
    });

    it('README.md has substantial content', () => {
      const readmePath = resolve(REPO_ROOT, 'README.md');
      const content = readFileSync(readmePath, 'utf-8');
      const lineCount = content.split('\n').length;

      // README should be comprehensive (V1.4.1 baseline: ~1,284 lines)
      expect(
        lineCount,
        'README.md must be comprehensive (>1000 lines for bilingual)'
      ).toBeGreaterThan(1000);
    });

    it('ALGORITHM_REQUIREMENTS.md is comprehensive', () => {
      const reqPath = resolve(REPO_ROOT, 'competitor-kit/ALGORITHM_REQUIREMENTS.md');
      const content = readFileSync(reqPath, 'utf-8');
      const lineCount = content.split('\n').length;

      // Requirements doc should be detailed (V1.4.1 baseline: 1,343 lines)
      expect(
        lineCount,
        'ALGORITHM_REQUIREMENTS.md must be comprehensive (>1000 lines)'
      ).toBeGreaterThan(1000);
    });
  });

  describe('Bilingual Index Integrity', () => {
    it('BILINGUAL_DOCUMENTATION.md lists all required files', () => {
      const indexPath = resolve(REPO_ROOT, 'docs/BILINGUAL_DOCUMENTATION.md');
      const indexContent = readFileSync(indexPath, 'utf-8');

      REQUIRED_BILINGUAL_FILES.forEach(([relativePath, description]) => {
        // Check if the file is mentioned in the index
        // (either as a link or in a table)
        const isListed =
          indexContent.includes(relativePath) ||
          indexContent.includes(relativePath.replace('../', ''));

        expect(
          isListed,
          `${relativePath} (${description}) must be listed in BILINGUAL_DOCUMENTATION.md`
        ).toBe(true);
      });
    });
  });
});
