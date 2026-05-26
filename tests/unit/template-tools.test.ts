import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('template tool metadata import boundaries', () => {
  it('depends on reference metadata types through the metadata leaf', () => {
    const source = readFileSync('src/llm/template-tools.ts', 'utf8');

    expect(source).toContain("from './reference-metadata.js'");
    expect(source).not.toMatch(/type TemplateParamDeclaration[\s\S]*from ['"]\.\/reference-resolver\.js['"]/);
    expect(source).not.toMatch(/type TemplateParamUsage[\s\S]*from ['"]\.\/reference-resolver\.js['"]/);
  });
});
