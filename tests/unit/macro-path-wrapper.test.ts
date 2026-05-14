import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MacroExpectedError } from '../../src/macro/evaluator.js';
import {
  assertRealPathInsideVault,
  resolveMacroPath,
  toMacroPath,
} from '../../src/macro/path-wrapper.js';

let testDir: string;
let vaultRoot: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `fqc-macro-path-wrapper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  vaultRoot = join(testDir, 'vault');
  mkdirSync(join(vaultRoot, 'Specs'), { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function expectForbiddenPath(fn: () => unknown, path: string): void {
  try {
    fn();
    throw new Error('expected forbidden_path');
  } catch (error) {
    expect(error).toBeInstanceOf(MacroExpectedError);
    expect((error as MacroExpectedError).error).toBe('forbidden_path');
    // REQ-042 ac3 pins this public envelope message exactly.
    expect((error as MacroExpectedError).message).toBe(
      'macro shell verbs cannot reach outside the vault root'
    );
    expect((error as MacroExpectedError).details).toMatchObject({
      path,
      reason: 'resolves_outside_vault',
    });
  }
}

describe('resolveMacroPath', () => {
  it('T-U-137 resolves a vault-rooted macro path inside the vault root', () => {
    expect(resolveMacroPath('/Specs/foo.md', vaultRoot)).toBe(
      pathResolve(vaultRoot, 'Specs/foo.md')
    );
  });

  it('T-U-138 resolves a relative macro path inside the vault root', () => {
    expect(resolveMacroPath('Specs/foo.md', vaultRoot)).toBe(
      pathResolve(vaultRoot, 'Specs/foo.md')
    );
  });

  it('T-U-139 rejects paths that normalize outside the vault root', () => {
    expectForbiddenPath(() => resolveMacroPath('../etc/passwd', vaultRoot), '../etc/passwd');
  });

  it('rejects symlink realpath escapes before shell filesystem access', () => {
    mkdirSync(join(testDir, 'outside'), { recursive: true });
    writeFileSync(join(testDir, 'outside', 'secret.md'), 'secret\n');
    symlinkSync(join(testDir, 'outside', 'secret.md'), join(vaultRoot, 'Specs', 'secret-link.md'));
    const hostPath = resolveMacroPath('/Specs/secret-link.md', vaultRoot);

    expectForbiddenPath(
      () => assertRealPathInsideVault(hostPath, vaultRoot, '/Specs/secret-link.md'),
      '/Specs/secret-link.md'
    );
  });

  it('rejects sibling-prefix escapes instead of trusting string prefixes', () => {
    const macroPath = '/../vault-other/file.md';
    mkdirSync(join(testDir, 'vault-other'), { recursive: true });

    expect(pathResolve(vaultRoot, macroPath.slice(1))).toBe(
      pathResolve(testDir, 'vault-other/file.md')
    );
    expectForbiddenPath(() => resolveMacroPath(macroPath, vaultRoot), macroPath);
  });

  it('T-U-140 allows paths that normalize back inside the vault root', () => {
    expect(resolveMacroPath('/Specs/../Specs/foo.md', vaultRoot)).toBe(
      pathResolve(vaultRoot, 'Specs/foo.md')
    );
  });

  it('T-U-141 resolves macro root aliases to the vault root exactly', () => {
    expect(resolveMacroPath('/', vaultRoot)).toBe(pathResolve(vaultRoot));
    expect(resolveMacroPath('.', vaultRoot)).toBe(pathResolve(vaultRoot));
  });
});

describe('toMacroPath', () => {
  it('T-U-142 translates host paths under the vault back to vault-rooted macro paths', () => {
    expect(toMacroPath(pathResolve(vaultRoot, 'Specs/foo.md'), vaultRoot)).toBe('/Specs/foo.md');
  });

  it('translates the host vault root to the macro root', () => {
    expect(toMacroPath(pathResolve(vaultRoot), vaultRoot)).toBe('/');
  });

  it('rejects host paths outside the vault root', () => {
    const hostPath = pathResolve(testDir, 'vault-other/file.md');

    expectForbiddenPath(() => toMacroPath(hostPath, vaultRoot), hostPath);
  });
});
