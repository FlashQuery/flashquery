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

  it('uses canonical envelopes for empty targets and disabled memory targets', () => {
    expect(source).toContain("error: 'invalid_input'");
    expect(source).toContain("details: { field: 'targets' }");
    expect(source).toContain("error: 'unsupported'");
    expect(source).toContain("details: { disabled_category: 'memory' }");
    expect(source).toContain('jsonRuntimeError({ message: `Error applying tags: ${msg}` })');
  });

  it('fetches complete memory identification fields instead of placeholder metadata', () => {
    expect(source).toContain(".select('content,tags,plugin_scope,created_at,updated_at')");
    expect(source).toContain("content_preview: typeof memData?.content === 'string' ? memData.content.slice(0, 120) : ''");
    expect(source).toContain("created_at: memData?.created_at ?? ''");
    expect(source).not.toContain("identifier: memoryId,\n            entity_type: 'memory'");
  });
});
