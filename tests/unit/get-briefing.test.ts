import { describe, expect, it } from 'vitest';
import { getToolMetadata } from '../../src/mcp/tool-metadata.js';

describe('get_briefing transitional JSON contract', () => {
  it('documents the call_macro removal gate in metadata', () => {
    const metadata = getToolMetadata('get_briefing');

    expect(metadata?.status).toBe('transitional');
    expect(metadata?.description).toContain('call_macro');
  });

  it('documents the transitional array-of-tag-groups JSON shape', () => {
    const payload = {
      generated_at: '2026-05-13T00:00:00.000Z',
      entity_types: ['documents', 'memories'],
      tags: ['phase-128'],
      tag_match: 'any',
      limit: 20,
      removal_gate: 'call_macro parity',
      groups: [
        {
          type: 'tag',
          tag: 'phase-128',
          items: [{
            entity_type: 'document',
            identifier: 'doc-id',
            fq_id: 'doc-id',
            title: 'Phase 128',
            path: 'phase-128.md',
            modified: '2026-05-13T00:00:00.000Z',
            size: { chars: 128 },
          }, {
            entity_type: 'memory',
            memory_id: 'memory-id',
            content_preview: 'Phase 128 memory',
            tags: ['phase-128'],
            plugin_scope: 'global',
            created_at: '2026-05-13T00:00:00.000Z',
            updated_at: '2026-05-13T00:00:00.000Z',
          }],
        },
      ],
    };

    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload;

    expect(parsed.generated_at).toBeTruthy();
    expect(parsed.entity_types).toEqual(['documents', 'memories']);
    expect(parsed.groups[0].type).toBe('tag');
    expect(parsed.groups[0].items[0]).toMatchObject({
      entity_type: 'document',
      fq_id: 'doc-id',
      modified: expect.any(String),
      size: { chars: 128 },
    });
    expect(parsed.groups[0].items[1]).toMatchObject({
      entity_type: 'memory',
      memory_id: 'memory-id',
      plugin_scope: 'global',
      updated_at: expect.any(String),
    });
    expect(parsed.removal_gate).toContain('call_macro');
  });
});
