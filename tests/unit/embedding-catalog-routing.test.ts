import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('catalog embedding routing guards', () => {
  it.each([
    ['copy_document', 'src/mcp/tools/documents/copy.ts'],
    ['get_document stale re-embed helper', 'src/mcp/tools/documents/helpers.ts'],
    ['reference resolver stale re-embed helper', 'src/llm/reference-resolver.ts'],
  ])('%s routes document re-embeds through the current document embedding path', (_label, path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toMatch(/scheduleChangedDocumentChunks|from ['"]\.\.\/mcp\/tools\/documents\/helpers\.js['"]/);
    expect(source).not.toMatch(/scheduleBackgroundEmbedding\s*\(\s*\{/);
    expect(source).not.toContain('documentEmbeddingTarget');
    expect(source).not.toContain('target_kind: \'document\'');
    expect(source).not.toContain('targetTable: \'fqc_documents\'');
  });
});
