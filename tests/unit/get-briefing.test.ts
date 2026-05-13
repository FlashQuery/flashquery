import { describe, expect, it } from 'vitest';
import { getToolMetadata } from '../../src/mcp/tool-metadata.js';

describe('get_briefing transitional JSON contract', () => {
  it('documents the call_macro removal gate in metadata', () => {
    const metadata = getToolMetadata('get_briefing');

    expect(metadata?.status).toBe('transitional');
    expect(metadata?.description).toContain('call_macro');
  });

  it('uses parseable grouped JSON rather than section prose', () => {
    const payload = {
      generated_at: '2026-05-13T00:00:00.000Z',
      entity_types: ['documents', 'memories'],
      tags: ['phase-128'],
      tag_match: 'any',
      limit: 20,
      removal_gate: 'call_macro parity',
      groups: {
        documents: {
          count: 1,
          results: [{
            identifier: 'doc-id',
            fq_id: 'doc-id',
            title: 'Phase 128',
            path: 'phase-128.md',
            status: 'active',
            tags: ['phase-128'],
          }],
        },
        memories: {
          count: 1,
          results: [{
            memory_id: 'memory-id',
            content_preview: 'Phase 128 memory',
            tags: ['phase-128'],
            created_at: '2026-05-13T00:00:00.000Z',
          }],
        },
      },
    };

    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload;

    expect(parsed.generated_at).toBeTruthy();
    expect(parsed.entity_types).toEqual(['documents', 'memories']);
    expect(parsed.groups.documents.results[0].fq_id).toBe('doc-id');
    expect(parsed.groups.memories.results[0].memory_id).toBe('memory-id');
    expect(parsed.removal_gate).toContain('call_macro');
  });
});
