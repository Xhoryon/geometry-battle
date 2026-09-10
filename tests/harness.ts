/**
 * 极简测试框架 —— 不引入外部依赖
 *
 * 设计目标：每个 Finding 至少一条永久回归测试，且可以在 CI 里跑。
 * 用法：
 *   import { test, assert, assertEqual, runAll } from './harness';
 *   test('名字', () => { assert(true, '...'); });
 *   void runAll('suite-name');
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const cases: TestCase[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name, fn });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`断言失败: ${message}\n  期望: ${e}\n  实际: ${a}`);
}

export function assertClose(actual: number, expected: number, tol: number, message: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(`断言失败: ${message}\n  期望: ${expected} ± ${tol}\n  实际: ${actual}`);
  }
}

export async function assertRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`断言失败: ${message}（期望抛错，但没有）`);
}

export async function runAll(suiteName: string, expectedTests?: number): Promise<void> {
  console.log(`\n═══ ${suiteName} (${cases.length} tests) ═══`);
  let passed = 0;
  const failures: { name: string; error: Error }[] = [];

  // 零用例守卫（Re-Gate Cycle 2 PLAT-6 / P3-15）：一个套件若因为注册语句被注释掉、
  // import 路径写错、或文件被清空而**一个用例都没跑**，旧实现会打印 `0/0 passed`
  // 并以退出码 0 收场 —— 静默的假绿。那比一条失败断言更危险。
  if (cases.length === 0) {
    console.log(`\n${suiteName}: 0/0 passed  ← 零用例，判为失败`);
    console.log(`\n[harness] ${suiteName} 没有注册任何用例：套件文件可能被清空或注册语句被移除。`);
    process.exit(1);
  }
  // 期望用例数（可选）：写死一个数字后，删掉/漏跑用例会立刻变红，
  // 而不是悄悄少跑几条。
  if (expectedTests !== undefined && cases.length !== expectedTests) {
    console.log(
      `\n${suiteName}: 期望 ${expectedTests} 个用例，实际注册 ${cases.length} 个 —— 判为失败`
    );
    process.exit(1);
  }

  for (const c of cases) {
    const started = Date.now();
    try {
      await c.fn();
      passed++;
      console.log(`  ✓ ${c.name} (${Date.now() - started}ms)`);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      failures.push({ name: c.name, error });
      console.log(`  ✗ ${c.name}\n      ${error.message.split('\n').join('\n      ')}`);
    }
  }

  console.log(`\n${suiteName}: ${passed}/${cases.length} passed`);
  if (failures.length > 0) {
    console.log('\n失败用例:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error.message.split('\n')[0]}`);
    process.exit(1);
  }
}

/** 供测试使用的临时目录 */
export function tmpDir(prefix: string): string {
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gb-${prefix}-`));
  return dir;
}
