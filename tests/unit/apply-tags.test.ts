import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('apply_tags Phase 124 contract', () => {
  const source = readFileSync(resolve('src/mcp/tools/compound.ts'), 'utf-8');

  it('accepts explicit ordered targets for document and memory entities', () => {
    expect(source).toContain('targets: z');
    expect(source).toContain("entity_type: z.enum(['document', 'memory'])");
    expect(source).toContain('const normalizedTargets = targets');
  });

  it('returns structured JSON identification results for both domains', () => {
    expect(source).toContain('documentIdentification({');
    expect(source).toContain('memoryIdentification({');
    expect(source).toContain('return jsonToolResult(results)');
  });
});
