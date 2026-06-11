import { describe, expect, it } from 'vitest';
import { parsePluginSchema } from '../../src/plugins/manager.js';

function manifest(embeddingLine = ''): string {
  return `
id: embed_test
name: Embed Test
version: 1.0.0
${embeddingLine}
tables:
  - name: notes
    embed_fields: [title]
    columns:
      - name: title
        type: text
`;
}

describe('plugin manifest embedding parsing', () => {
  it('T-U-030 parses embedding null', () => {
    const parsed = parsePluginSchema(manifest('embedding: null'));
    expect(parsed.embedding).toBeNull();
  });

  it('T-U-031 parses embedding wildcard', () => {
    const parsed = parsePluginSchema(manifest('embedding: "*"'));
    expect(parsed.embedding).toBe('*');
  });

  it('T-U-032 parses a specific embedding name', () => {
    const parsed = parsePluginSchema(manifest('embedding: primary'));
    expect(parsed.embedding).toBe('primary');
  });

  it('T-U-030 treats omitted embedding as null', () => {
    const parsed = parsePluginSchema(manifest());
    expect(parsed.embedding).toBeNull();
  });

  it('T-U-033 rejects non-string non-null embedding values', () => {
    expect(() => parsePluginSchema(manifest('embedding: 42'))).toThrow(/embedding must be null/);
    expect(() => parsePluginSchema(manifest('embedding: [primary]'))).toThrow(/embedding must be null/);
    expect(() => parsePluginSchema(manifest('embedding: { name: primary }'))).toThrow(/embedding must be null/);
  });
});
