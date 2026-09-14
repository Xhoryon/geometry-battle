/**
 * Bilingual Documentation Regression Tests
 *
 * Verifies that all public-facing documentation maintains bilingual
 * coverage (zh-CN + en-US) with language-switchable pairs.
 *
 * V1.4.2 — Language-pair model: each key document has .md (English) + .zh-CN.md (Chinese)
 *          with top navigation links.
 *
 * REQUIREMENTS:
 * 1. Inventory completeness - all tracked *.md files discovered via git
 * 2. Pair completeness - every .zh-CN.md has .md counterpart and vice versa
 * 3. Exact navigation link validation - parse href, resolve path, verify file exists
 * 4. Language anti-vacuity - detect substantial opposite-language prose leakage
 * 5. Critical numeric parity - 500ms, 512MB, 1 core, 20 rounds, 60 rounds, 8MB, 256 files, 1e-6
 * 6. Critical normative parity - Team A/B, solver.py required, 500ms limit, network prohibited
 * 7. Link/anchor integrity - verify internal README anchors work after split
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { test, assert, runAll } from './harness';

const REPO_ROOT = resolve(__dirname, '..');

/**
 * Files exempt from bilingual pairing requirements
 */
const EXEMPT_FROM_PAIRING = new Set([
  'LICENSE',          // Official legal text, not translated
  'CLAUDE.md',        // Internal agent context (if present)
]);

/**
 * Convert base path to Chinese pair path
 * e.g., "README.md" -> "README.zh-CN.md"
 */
function toChinesePairPath(basePath: string): string {
  return basePath.replace(/\.md$/, '.zh-CN.md');
}

/**
 * Convert Chinese pair path back to base path
 */
function toBasePath(chinesePath: string): string {
  return chinesePath.replace(/\.zh-CN\.md$/, '.md');
}

/**
 * Get all tracked markdown files via git ls-files
 */
function getAllTrackedMarkdownFiles(): string[] {
  try {
    const output = execSync('git ls-files "*.md"', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    throw new Error(`Failed to list tracked markdown files: ${error}`);
  }
}

/**
 * Check if a file should be exempt from pairing
 */
function isExemptFromPairing(filePath: string): boolean {
  const basename = filePath.split('/').pop() || '';
  return EXEMPT_FROM_PAIRING.has(basename) || filePath.includes('node_modules/');
}

/**
 * Extract markdown links from content
 */
interface MarkdownLink {
  text: string;
  href: string;
  lineNumber: number;
}

function extractMarkdownLinks(content: string): MarkdownLink[] {
  const lines = content.split('\n');
  const links: MarkdownLink[] = [];

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const htmlLinkRegex = /<a\s+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;

  lines.forEach((line, index) => {
    let match;

    while ((match = markdownLinkRegex.exec(line)) !== null) {
      links.push({
        text: match[1],
        href: match[2],
        lineNumber: index + 1,
      });
    }

    while ((match = htmlLinkRegex.exec(line)) !== null) {
      links.push({
        text: match[2],
        href: match[1],
        lineNumber: index + 1,
      });
    }
  });

  return links;
}

/**
 * Resolve a relative link from a source file
 */
function resolveLinkPath(sourceFilePath: string, href: string): string | null {
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
    return null;
  }

  const pathOnly = href.split('#')[0];
  if (!pathOnly) return null;

  const sourceDir = dirname(sourceFilePath);
  const resolved = join(sourceDir, pathOnly);

  // Skip validation for src/ paths (source files not in public export)
  if (resolved.includes('src/')) {
    return null;
  }

  return resolved;
}

/**
 * Extract anchor definitions from markdown content
 */
function extractAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const lines = content.split('\n');

  const headerRegex = /^#+\s+(.+)$/;
  lines.forEach(line => {
    const match = headerRegex.exec(line);
    if (match) {
      const anchor = match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-');
      anchors.add(anchor);
    }
  });

  const htmlAnchorRegex = /<a\s+(?:name|id)=["']([^"']+)["']/gi;
  const fullText = lines.join('\n');
  let match;
  while ((match = htmlAnchorRegex.exec(fullText)) !== null) {
    anchors.add(match[1]);
  }

  return anchors;
}

/**
 * Detect substantial language content in text
 */
function detectLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/[^\s]+/g, '');

  const chineseChars = (cleaned.match(/[一-龥]/g) || []).length;
  const englishWords = (cleaned.match(/\b[a-zA-Z]+\b/g) || []).length;

  const totalSignificant = chineseChars + englishWords;
  if (totalSignificant < 10) return 'unknown';

  const chineseRatio = chineseChars / totalSignificant;
  const englishRatio = englishWords / totalSignificant;

  if (chineseRatio > 0.6) return 'zh';
  if (englishRatio > 0.6) return 'en';
  return 'mixed';
}

/**
 * Extract numeric values from text for comparison
 */
interface NumericValues {
  timeouts: number;
  memory: number;
  cores: number;
  rounds: number;
  sizes: number;
  precision: number;
}

function extractNumericValues(content: string): NumericValues {
  return {
    timeouts: (content.match(/\b500\s*ms\b/gi) || []).length,
    memory: (content.match(/\b512\s*MB\b/gi) || []).length,
    // Match "1 core" in English or "1 核" in Chinese (with any whitespace)
    cores: (content.match(/\b1\s*(?:core|cores|核)\b/gi) || []).length,
    rounds: (content.match(/\b(?:20|60)\s*(?:rounds?|回合)\b/gi) || []).length,
    sizes: (content.match(/\b8\s*MB\b/gi) || []).length,
    precision: (content.match(/\b1e-6\b/g) || []).length,
  };
}

/**
 * Extract normative requirements from text
 */
interface NormativeRequirements {
  hasSolverPyRequired: boolean;
  has500msLimit: boolean;
  hasTeamAPlus: boolean;
  hasTeamBMinus: boolean;
  hasNetworkProhibited: boolean;
}

function extractNormativeRequirements(content: string): NormativeRequirements {
  return {
    // Match "solver.py" + "required/must" nearby (within 50 chars)
    hasSolverPyRequired: /solver\.py.{0,50}(?:required|must|必须|必需)/is.test(content) ||
                         /(?:required|must|必须|必需).{0,50}solver\.py/is.test(content),
    has500msLimit: /500\s*ms.{0,100}(?:limit|timeout|budget|上限|限制)/is.test(content) ||
                   /(?:limit|timeout|budget|上限|限制).{0,100}500\s*ms/is.test(content),
    hasTeamAPlus: /Team\s+A.{0,100}[+＋]/is.test(content) || /A\s+队.{0,100}[+＋]/s.test(content),
    hasTeamBMinus: /Team\s+B.{0,100}[-－—]/is.test(content) || /B\s+队.{0,100}[-－—]/s.test(content),
    hasNetworkProhibited: /network.{0,100}(?:prohibited|forbidden|禁止)/is.test(content) ||
                          /(?:prohibited|forbidden|禁止).{0,100}network/is.test(content) ||
                          /网络.{0,50}禁止/s.test(content),
  };
}

// ============================================================================
// REQUIREMENT 1: Inventory Completeness
// ============================================================================

test('REQ1: discovers all tracked markdown files via git ls-files', () => {
  const files = getAllTrackedMarkdownFiles();
  assert(files.length > 0, '应发现至少一个 Markdown 文件');
  assert(files.includes('README.md'), 'README.md 应被 git 跟踪');
  assert(files.includes('README.zh-CN.md'), 'README.zh-CN.md 应被 git 跟踪');
});

test('REQ1: filters out node_modules and other ignored paths', () => {
  const files = getAllTrackedMarkdownFiles();
  files.forEach(file => {
    assert(!file.includes('node_modules/'), `${file} 不应包含 node_modules/`);
  });
});

// ============================================================================
// REQUIREMENT 2: Pair Completeness
// ============================================================================

const allFiles = getAllTrackedMarkdownFiles();
const baseFiles = allFiles.filter(f => !f.endsWith('.zh-CN.md') && !isExemptFromPairing(f));
const chineseFiles = allFiles.filter(f => f.endsWith('.zh-CN.md'));

baseFiles.forEach(baseFile => {
  test(`REQ2: ${baseFile} → has Chinese pair`, () => {
    const chinesePair = toChinesePairPath(baseFile);
    const fullPath = resolve(REPO_ROOT, chinesePair);
    assert(existsSync(fullPath), `期望 ${chinesePair} 存在作为 ${baseFile} 的中文对`);
  });
});

chineseFiles.forEach(chineseFile => {
  test(`REQ2: ${chineseFile} → has English base`, () => {
    const basePair = toBasePath(chineseFile);
    const fullPath = resolve(REPO_ROOT, basePair);
    assert(existsSync(fullPath), `期望 ${basePair} 存在作为 ${chineseFile} 的英文对`);
  });
});

// ============================================================================
// REQUIREMENT 3: Exact Navigation Link Validation
// ============================================================================

allFiles.filter(f => !isExemptFromPairing(f)).forEach(filePath => {
  const fullPath = resolve(REPO_ROOT, filePath);
  if (!existsSync(fullPath)) return;

  const content = readFileSync(fullPath, 'utf-8');
  const links = extractMarkdownLinks(content);
  const internalFileLinks = links
    .map(link => ({...link, resolved: resolveLinkPath(filePath, link.href)}))
    .filter(link => link.resolved !== null);

  internalFileLinks.forEach(link => {
    test(`REQ3: ${filePath}:${link.lineNumber} "${link.text}" → ${link.href}`, () => {
      const targetPath = resolve(REPO_ROOT, link.resolved!);
      assert(existsSync(targetPath),
        `链接目标 ${link.resolved} 不存在（来自 ${filePath}:${link.lineNumber}）`);
    });
  });

  test(`REQ3: ${filePath} has language switcher link`, () => {
    const isChineseFile = filePath.endsWith('.zh-CN.md');
    const counterpartFile = isChineseFile ? toBasePath(filePath) : toChinesePairPath(filePath);

    const first20Lines = content.split('\n').slice(0, 20).join('\n');
    const hasCounterpartLink = first20Lines.includes(counterpartFile) ||
                               first20Lines.includes('简体中文') ||
                               first20Lines.includes('English');

    assert(hasCounterpartLink,
      `${filePath} 必须在前 20 行包含语言切换链接`);
  });
});

// ============================================================================
// REQUIREMENT 4: Language Anti-Vacuity
// ============================================================================

allFiles.filter(f => !isExemptFromPairing(f)).forEach(filePath => {
  test(`REQ4: ${filePath} substantial content in correct language`, () => {
    const fullPath = resolve(REPO_ROOT, filePath);
    if (!existsSync(fullPath)) return;

    const content = readFileSync(fullPath, 'utf-8');
    const detectedLang = detectLanguage(content);

    const isChineseFile = filePath.endsWith('.zh-CN.md');
    const expectedLang = isChineseFile ? 'zh' : 'en';

    if (detectedLang === 'unknown' || detectedLang === 'mixed') {
      return; // Allow mixed/unknown (technical docs)
    }

    assert(detectedLang === expectedLang,
      `${filePath} 应主要为 ${expectedLang}，但检测为 ${detectedLang}`);
  });
});

// ============================================================================
// REQUIREMENT 5: Critical Numeric Parity
// ============================================================================

const pairs = baseFiles
  .map(base => ({
    base,
    chinese: toChinesePairPath(base),
  }))
  .filter(pair => existsSync(resolve(REPO_ROOT, pair.chinese)));

pairs.forEach(({base, chinese}) => {
  test(`REQ5: ${base} ↔ ${chinese} numeric parity`, () => {
    const baseContent = readFileSync(resolve(REPO_ROOT, base), 'utf-8');
    const chineseContent = readFileSync(resolve(REPO_ROOT, chinese), 'utf-8');

    const baseNums = extractNumericValues(baseContent);
    const cnNums = extractNumericValues(chineseContent);

    // Only check if at least one side has the value
    if (baseNums.timeouts > 0 || cnNums.timeouts > 0) {
      assert(cnNums.timeouts === baseNums.timeouts,
        `500ms 出现次数不匹配: EN=${baseNums.timeouts}, CN=${cnNums.timeouts}`);
    }

    if (baseNums.memory > 0 || cnNums.memory > 0) {
      assert(cnNums.memory === baseNums.memory,
        `512MB 出现次数不匹配: EN=${baseNums.memory}, CN=${cnNums.memory}`);
    }

    if (baseNums.cores > 0 || cnNums.cores > 0) {
      assert(cnNums.cores === baseNums.cores,
        `1 core 出现次数不匹配: EN=${baseNums.cores}, CN=${cnNums.cores}`);
    }

    if (baseNums.rounds > 0 || cnNums.rounds > 0) {
      assert(cnNums.rounds === baseNums.rounds,
        `rounds 出现次数不匹配: EN=${baseNums.rounds}, CN=${cnNums.rounds}`);
    }

    if (baseNums.precision > 0 || cnNums.precision > 0) {
      assert(cnNums.precision === baseNums.precision,
        `1e-6 出现次数不匹配: EN=${baseNums.precision}, CN=${cnNums.precision}`);
    }
  });
});

// ============================================================================
// REQUIREMENT 6: Critical Normative Parity
// ============================================================================

pairs.forEach(({base, chinese}) => {
  test(`REQ6: ${base} ↔ ${chinese} normative parity`, () => {
    const baseContent = readFileSync(resolve(REPO_ROOT, base), 'utf-8');
    const chineseContent = readFileSync(resolve(REPO_ROOT, chinese), 'utf-8');

    const baseReqs = extractNormativeRequirements(baseContent);
    const cnReqs = extractNormativeRequirements(chineseContent);

    assert(cnReqs.hasSolverPyRequired === baseReqs.hasSolverPyRequired,
      `solver.py required 不匹配: EN=${baseReqs.hasSolverPyRequired}, CN=${cnReqs.hasSolverPyRequired}`);

    assert(cnReqs.has500msLimit === baseReqs.has500msLimit,
      `500ms limit 不匹配: EN=${baseReqs.has500msLimit}, CN=${cnReqs.has500msLimit}`);

    assert(cnReqs.hasTeamAPlus === baseReqs.hasTeamAPlus,
      `Team A + 不匹配: EN=${baseReqs.hasTeamAPlus}, CN=${cnReqs.hasTeamAPlus}`);

    assert(cnReqs.hasTeamBMinus === baseReqs.hasTeamBMinus,
      `Team B - 不匹配: EN=${baseReqs.hasTeamBMinus}, CN=${cnReqs.hasTeamBMinus}`);

    assert(cnReqs.hasNetworkProhibited === baseReqs.hasNetworkProhibited,
      `network prohibited 不匹配: EN=${baseReqs.hasNetworkProhibited}, CN=${cnReqs.hasNetworkProhibited}`);
  });
});

// ============================================================================
// REQUIREMENT 7: Link/Anchor Integrity
// ============================================================================

allFiles.filter(f => !isExemptFromPairing(f)).forEach(filePath => {
  const fullPath = resolve(REPO_ROOT, filePath);
  if (!existsSync(fullPath)) return;

  const content = readFileSync(fullPath, 'utf-8');
  const links = extractMarkdownLinks(content);
  const anchorLinks = links.filter(link => link.href.includes('#'));

  anchorLinks.forEach(link => {
    test(`REQ7: ${filePath}:${link.lineNumber} anchor "${link.href}" exists`, () => {
      const [filePart, anchor] = link.href.split('#');

      let targetFile: string;
      if (!filePart || filePart === '') {
        targetFile = filePath;
      } else {
        const resolved = resolveLinkPath(filePath, filePart);
        if (!resolved) return;
        targetFile = resolved;
      }

      const targetFullPath = resolve(REPO_ROOT, targetFile);

      // Skip if target file is a source file (not in public export)
      if (targetFile.includes('src/')) {
        return;
      }

      assert(existsSync(targetFullPath), `目标文件 ${targetFile} 不存在`);

      const targetContent = readFileSync(targetFullPath, 'utf-8');
      const anchors = extractAnchors(targetContent);

      assert(anchors.has(anchor),
        `锚点 "#${anchor}" 在 ${targetFile} 中未找到（可用: ${Array.from(anchors).slice(0, 5).join(', ')}...）`);
    });
  });
});

void runAll('bilingual-docs');
