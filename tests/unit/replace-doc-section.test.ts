import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('replace_doc_section Phase 124 contract', () => {
  const source = readFileSync(resolve('src/mcp/tools/compound.ts'), 'utf-8');

  it('uses include_nested instead of include_subheadings in the registered schema', () => {
    const replaceBlock = source.slice(
      source.indexOf("'replace_doc_section'"),
      source.indexOf('// ─── Tool', source.indexOf("'replace_doc_section'") + 1)
    );

    expect(replaceBlock).toContain('include_nested');
    expect(replaceBlock).not.toContain('include_subheadings:');
  });

  it('implements empty-content deletion with heading_removed metadata', () => {
    expect(source).toContain("const headingRemoved = content === ''");
    expect(source).toContain('heading_removed: headingRemoved');
    expect(source).toContain('extracted_section');
  });
});
