import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return walkFiles(full);
    return [full];
  });
}

describe('codebase audit remaining remediation guards', () => {
  it('T-U-004: embedding provider no longer uses non-null apiKey assertion', () => {
    expect(read('src/embedding/provider.ts')).not.toContain('config.apiKey!');
  });

  it('T-U-007: plugin reconciliation no longer casts VaultManager to private rootPath', () => {
    const source = read('src/services/plugin-reconciliation.ts');
    expect(source).not.toContain('vaultManager as unknown as { rootPath: string }');
    expect(source).not.toMatch(/rootPath/);
  });

  it('T-U-008: inert projects seeder source file is absent', () => {
    expect(existsSync(join(repoRoot, 'src/projects/seeder.ts'))).toBe(false);
  });

  it('T-U-009: production source no longer imports or calls initProjects', () => {
    const token = ['init', 'Projects'].join('');
    const seederPath = ['projects', 'seeder'].join('/');
    const production = walkFiles(join(repoRoot, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(file, 'utf-8').replaceAll(token, '').replaceAll(seederPath, ''));
    expect(production.join('\n')).not.toContain(token);
    expect(production.join('\n')).not.toContain(seederPath);
  });

  it('T-U-011: git backup cleanup no longer swallows pg close failures', () => {
    expect(read('src/git/manager.ts')).not.toContain('.catch(() => {})');
  });

  it('T-U-012: direct esbuild type import is matched by package metadata', () => {
    const tsupConfig = read('tsup.config.ts');
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (tsupConfig.includes("from 'esbuild'") || tsupConfig.includes('from "esbuild"')) {
      expect({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }).toHaveProperty('esbuild');
    }
  });

  it('T-U-013: package metadata does not depend on @types/uuid', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies).not.toHaveProperty('@types/uuid');
    expect(packageJson.devDependencies).not.toHaveProperty('@types/uuid');
  });
});
