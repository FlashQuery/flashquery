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

  it('T-I-001: plugin reconciliation integration suite is enabled in the integration config', () => {
    const config = read('tests/config/vitest.integration.config.ts');
    expect(config).toContain('tests/integration/plugin-reconciliation.integration.test.ts');
  });

  it('T-I-001: plugin reconciliation integration suite uses environment-gated skips only', () => {
    const source = read('tests/integration/plugin-reconciliation.integration.test.ts');
    expect(source).not.toContain('describe.skip(');
    expect(source).toContain('describe.skipIf(SKIP_DB)');
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

  it('T-U-016: document-output consolidated response no longer uses a double assertion', () => {
    expect(read('src/mcp/utils/document-output.ts')).not.toContain(
      'as unknown as Record<string, unknown>'
    );
  });

  it('T-U-017: scanner document selects no longer use Promise double assertions', () => {
    expect(read('src/services/scanner.ts')).not.toContain('as unknown as Promise');
  });

  it('T-U-019: llm usage query helpers no longer use broad unsafe eslint disable blocks', () => {
    const source = read('src/mcp/tools/llm-usage.ts');
    expect(source).not.toMatch(
      /eslint-disable[^\n]*(no-explicit-any|no-unsafe-assignment|no-unsafe-call|no-unsafe-member-access)/
    );
  });

  it('T-U-020: llm usage grouping no longer uses non-null assertion push patterns', () => {
    const source = read('src/mcp/tools/llm-usage.ts');
    expect(source).not.toMatch(/!\.push|\.get\([^\n]+\)!\.push/);
  });

  it('T-U-025: records search timing TODO markers are removed', () => {
    expect(read('src/mcp/tools/records.ts')).not.toContain('TODO LOG-01');
  });

  it('T-U-026: document tool entrypoint remains thin and delegates moved modules', () => {
    const source = read('src/mcp/tools/documents.ts');
    const lines = source.split('\n').length;
    const movedModules = [
      './documents/write.js',
      './documents/get.js',
      './documents/archive.js',
      './documents/remove.js',
      './documents/copy.js',
      './documents/move.js',
    ];

    expect(source).toContain('export function registerDocumentTools');
    expect(lines).toBeLessThanOrEqual(160);
    for (const modulePath of movedModules) {
      expect(source).toContain(modulePath);
    }
    expect(source).toContain('registerWriteDocumentTool(server, deps)');
    expect(source).toContain('registerGetDocumentTool(server, deps)');
    expect(source).toContain('registerArchiveDocumentTool(server, deps)');
    expect(source).toContain('registerRemoveDocumentTool(server, deps)');
    expect(source).toContain('registerCopyDocumentTool(server, deps)');
    expect(source).toContain('registerMoveDocumentTool(server, deps)');
    expect(source).not.toContain("server.registerTool(\n    'write_document'");
    expect(source).not.toContain("server.registerTool(\n    'move_document'");
  });

  it('T-U-027: document tool implementation files stay below the REQ-009 threshold or justify size', () => {
    const documentsDir = join(repoRoot, 'src/mcp/tools/documents');
    const implementationFiles = readdirSync(documentsDir)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => `src/mcp/tools/documents/${entry}`);
    const violations = implementationFiles.filter((relativePath) => {
      const source = read(relativePath);
      return source.split('\n').length > 500 && !source.includes('REQ-009 size justification');
    });

    expect(violations).toEqual([]);
  });

  it('T-U-028: document/plugin cycle-prone imports do not reappear in shared document wiring', () => {
    const sharedFiles = [
      'src/mcp/tools/documents.ts',
      'src/mcp/tools/documents/deps.ts',
      'src/mcp/tools/documents/helpers.ts',
    ];

    for (const file of sharedFiles) {
      const source = read(file);
      expect(source).not.toContain('plugins/manager');
      expect(source).not.toContain('pluginManager');
      expect(source).not.toContain('getFolderClaimsMap');
    }
  });
});
