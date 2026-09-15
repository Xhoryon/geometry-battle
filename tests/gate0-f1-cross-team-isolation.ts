/**
 * Gate 0.5 Wave 1 — F1 跨队隔离边界
 *
 * 审计发现：Team A install/preflight 可读取 Team B 原始上传残留
 * 优先级：P0
 *
 * 修复策略：
 * 1. session.uploadPackage 立即清理原始上传目录（第一道防线）
 * 2. SandboxRunner SYSTEM_DENIES 添加 /private/var/folders（第二道防线）
 *
 * 此测试使用合成无害标记，不读取真实参赛数据。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MatchSession } from '../src/server/session';
import { PY_ARGV_PRELUDE, PY_EMIT } from './protocol-fixture';
import { test, runAll, assert } from './harness';

const SYNTHETIC_MARKER = 'GATE0_SYNTHETIC_CROSS_TEAM_MARKER_12345';

test('gate0-f1: cross-team isolation - raw upload should be inaccessible', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-f1-'));

  let session: MatchSession | undefined;

  try {
    session = new MatchSession({
      slotRoot: path.join(tempRoot, 'slots'),
      artifactRoot: path.join(tempRoot, 'artifacts'),
      sandboxRoot: path.join(tempRoot, 'sandboxes'),
      seed: 20260914,
      pointCount: 6,
      difficulty: 'easy',
    });

    // Step 1: Team B uploads package with synthetic marker
    const teamBSource =
      PY_ARGV_PRELUDE +
      PY_EMIT +
      `
# Synthetic marker for testing: ${SYNTHETIC_MARKER}
with open(args.public) as f:
    p = json.load(f)
emit({"type": "number", "value": p["emitters"][args.team]["y"]})
`;

    const teamBPackage = [
      {
        path: 'solver.py',
        contentBase64: Buffer.from(teamBSource).toString('base64'),
      },
    ];

    const uploadB = await session.uploadPackage('B', teamBPackage);
    assert(uploadB.ok, `Team B upload should succeed, got: ${uploadB.errors.join('; ')}`);

    // Step 2: Verify raw upload was cleaned (first defense layer)
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    const uploadDirs = entries.filter((e) => e.startsWith('gb-upload-'));

    let foundBRawUpload = false;
    for (const dir of uploadDirs) {
      const fullPath = path.join(tmpDir, dir);
      const solverPath = path.join(fullPath, 'solver.py');
      if (fs.existsSync(solverPath)) {
        const content = fs.readFileSync(solverPath, 'utf8');
        if (content.includes(SYNTHETIC_MARKER)) {
          foundBRawUpload = true;
          break;
        }
      }
    }

    assert(
      !foundBRawUpload,
      'DEFENSE LAYER 1: Raw upload should be cleaned immediately after install'
    );
    console.log('✓ Defense Layer 1 verified: Raw upload cleaned after install');

    // Step 3: Test sandbox denial (second defense layer)
    // Even if raw upload wasn't cleaned, sandbox should block access to /private/var/folders

    // Create a synthetic "leaked" file in /var/folders to test sandbox blocking
    const syntheticLeakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-synthetic-leak-'));
    const syntheticLeakFile = path.join(syntheticLeakDir, 'leaked-data.txt');
    fs.writeFileSync(syntheticLeakFile, SYNTHETIC_MARKER);
    const syntheticLeakPath = fs.realpathSync(syntheticLeakFile);

    console.log('Created synthetic leak at:', syntheticLeakPath);
    assert(
      syntheticLeakPath.startsWith('/private/var/folders') || syntheticLeakPath.startsWith('/var/folders'),
      'Synthetic leak should be in /var/folders'
    );

    // Team A attempts to read the synthetic leak
    const teamASource =
      PY_ARGV_PRELUDE +
      PY_EMIT +
      `
cross_team_read_succeeded = False

try:
    # Attempt to read synthetic leak in /var/folders
    with open(${JSON.stringify(syntheticLeakPath)}, 'r') as f:
        content = f.read(4096)

    if ${JSON.stringify(SYNTHETIC_MARKER)} in content:
        cross_team_read_succeeded = True
except Exception:
    # Expected: sandbox should deny access
    pass

# Load public input
with open(args.public) as f:
    p = json.load(f)

y_base = p["emitters"][args.team]["y"]

# If read succeeded, emit invalid function (signal vulnerability)
# Otherwise emit valid function
if cross_team_read_succeeded:
    emit({"type": "number", "value": y_base + 99.0})
else:
    emit({"type": "number", "value": y_base})
`;

    const teamAPackage = [
      {
        path: 'solver.py',
        contentBase64: Buffer.from(teamASource).toString('base64'),
      },
    ];

    const uploadA = await session.uploadPackage('A', teamAPackage);

    // AFTER FIX: Team A should PASS (sandbox denied access, emitted valid function)
    assert(
      uploadA.ok === true,
      `DEFENSE LAYER 2: Team A should PASS (sandbox denied /var/folders access), got: ${uploadA.errors.join('; ')}`
    );

    console.log('✓ Defense Layer 2 verified: Sandbox blocks /private/var/folders access');
    console.log('');
    console.log('✓ F1 CROSS-TEAM ISOLATION: PASS');
    console.log('  - Raw uploads cleaned immediately after install');
    console.log('  - Sandbox blocks /private/var/folders access');
    console.log('  - Team A cannot read Team B data');

    // Cleanup synthetic leak
    try {
      fs.rmSync(syntheticLeakDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  } finally {
    if (session) session.close();

    // Cleanup
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    // Clean up any remaining gb-upload-* directories
    const tmpDir = os.tmpdir();
    try {
      const entries = fs.readdirSync(tmpDir);
      const uploadDirs = entries.filter((e) => e.startsWith('gb-upload-') || e.startsWith('gb-synthetic-leak-'));
      for (const dir of uploadDirs) {
        const fullPath = path.join(tmpDir, dir);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch {
      // Ignore if tmpdir is not accessible
    }
  }
});

runAll('gate0-f1-cross-team-isolation');

