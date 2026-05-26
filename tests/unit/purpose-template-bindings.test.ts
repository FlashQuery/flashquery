import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('purpose-template binding import boundaries', () => {
  it('depends on the config-sync contract leaf instead of config-sync service implementation', () => {
    const source = readFileSync('src/llm/purpose-template-bindings.ts', 'utf8');

    expect(source).toContain("from './config-sync-types.js'");
    expect(source).not.toMatch(/from ['"]\.\/config-sync\.js['"]/);
  });
});
