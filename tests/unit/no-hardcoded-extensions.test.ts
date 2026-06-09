import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FM } from '../../src/constants/frontmatter-fields.js';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// These files legitimately define or document the markdown_extensions config key itself.
const ALLOWLISTED_FILES = new Set([
  'src/config/loader.ts',
]);

const MANAGED_FRONTMATTER_FIELDS = new Set<string>(Object.values(FM));

// Existing legacy code and fixtures still contain raw fq_* literals. This guard
// blocks new unmanaged frontmatter literals while later migration phases shrink
// the allowlist.
const MANAGED_FRONTMATTER_LITERAL_ALLOWLIST = new Set([
  'src/constants/frontmatter-fields.ts',
  'src/mcp/tools/compound.ts',
  'src/mcp/tools/documents.ts',
  'src/mcp/tools/documents/archive.ts',
  'src/mcp/tools/documents/copy.ts',
  'src/mcp/tools/documents/move.ts',
  'src/mcp/tools/documents/remove.ts',
  'src/mcp/tools/documents/write.ts',
  'src/mcp/utils/document-output.ts',
  'src/mcp/utils/frontmatter-sanitizer.ts',
  'src/storage/vault.ts',
  'src/utils/frontmatter.ts',
  // Golden-model prototype (standalone module boundary — cannot import FM
  // constants) intentionally references the managed `fq_id` field name as the
  // sed -i --scope frontmatter immutability guard (REQ-066 ac4).
  'tests/macro-framework/macro-golden-model/src/shellbuiltins.ts',
  // Surgical-edit golden test fixtures use literal `fq_id` frontmatter (REQ-066).
  'tests/unit/macro-golden-surgical-edit.test.ts',
  'tests/unit/macro-surgical-edit.test.ts',
  'tests/e2e/call-model-template-tools.e2e.test.ts',
  'tests/helpers/discovery-fixtures.ts',
  'tests/helpers/synthetic-vault-generator.ts',
  'tests/integration/compound-tools.integration.test.ts',
  'tests/integration/e2e-workflows.test.ts',
  'tests/integration/frontmatter-ordering.integration.test.ts',
  'tests/integration/maintain-vault.integration.test.ts',
  'tests/integration/plugin-reconciliation.integration.test.ts',
  'tests/integration/reference-resolver.integration.test.ts',
  'tests/integration/scan-command.integration.test.ts',
  'tests/integration/tools-response-format.test.ts',
  'tests/integration/update-header-tags.test.ts',
  'tests/unit/compound-tools.test.ts',
  'tests/unit/document-output.test.ts',
  'tests/unit/document-tools.test.ts',
  'tests/unit/frontmatter-fields.test.ts',
  'tests/unit/frontmatter-sanitizer.test.ts',
  'tests/unit/no-hardcoded-extensions.test.ts',
  'tests/unit/resolve-document.test.ts',
  'tests/unit/response-formats.test.ts',
  'tests/unit/vault.test.ts',
]);

function collectTsFilesFromRoots(roots: string[]): string[] {
  return roots.flatMap((root) => collectTsFiles(join(process.cwd(), root)));
}

function stripLineComment(line: string): string {
  const commentIndex = line.indexOf('//');
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

describe('[ANTIPATTERN] no hardcoded markdown extension arrays', () => {
  it('all listMarkdownFiles call sites must use config.instance.vault.markdownExtensions, not [".md"]', () => {
    const srcRoot = join(process.cwd(), 'src');
    const violations: string[] = [];

    for (const absPath of collectTsFiles(srcRoot)) {
      const relPath = relative(process.cwd(), absPath);
      if (ALLOWLISTED_FILES.has(relPath)) continue;

      const lines = readFileSync(absPath, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Must contain a ['.md'] or [".md"] array literal to be relevant
        if (!/\[\s*['"]\.md['"]\s*\]/.test(line)) continue;
        // Skip comment-only lines
        if (/^\s*\/\//.test(line)) continue;
        // Allow function/parameter default values: extensions: string[] = ['.md']
        if (/=\s*\[\s*['"]\.md['"]\s*\]/.test(line)) continue;

        violations.push(`  ${relPath}:${i + 1}  →  ${line.trim()}`);
      }
    }

    expect(violations, [
      '',
      'Hardcoded markdown extension array detected in source.',
      'Use config.instance.vault.markdownExtensions instead of [\'.md\'].',
      'If this is a function-signature default, use: extensions: string[] = [\'.md\']',
      '',
      ...violations,
      '',
    ].join('\n')).toHaveLength(0);
  });
});

describe('[ANTIPATTERN] no hardcoded managed frontmatter literals', () => {
  it('new source and test code must use FM constants for managed fq_* frontmatter fields', () => {
    const violations: string[] = [];
    const literalPattern = /(['"`])(fq_[a-z_]+)\1/g;

    for (const absPath of collectTsFilesFromRoots(['src', 'tests'])) {
      const relPath = relative(process.cwd(), absPath);
      if (MANAGED_FRONTMATTER_LITERAL_ALLOWLIST.has(relPath)) continue;

      const lines = readFileSync(absPath, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = stripLineComment(lines[i]);
        for (const match of line.matchAll(literalPattern)) {
          const fieldName = match[2];
          if (!MANAGED_FRONTMATTER_FIELDS.has(fieldName)) continue;

          violations.push(`  ${relPath}:${i + 1}  ->  ${fieldName}`);
        }
      }
    }

    expect(violations, [
      '',
      'Hardcoded managed frontmatter literal detected.',
      'Use FM.* constants from src/constants/frontmatter-fields.ts instead.',
      'If this is a fixture, migration compatibility case, or database-column assertion, add an explicit allowlist entry.',
      '',
      ...violations,
      '',
    ].join('\n')).toHaveLength(0);
  });
});
