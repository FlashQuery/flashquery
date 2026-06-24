import { describe, expect, it } from 'vitest';

import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';
import { buildGraphNodeRows } from '../../src/graph/structural.js';

const baseInput = {
  instanceId: 'graph-node-identity-unit',
  documentId: '11111111-1111-4111-8111-111111111111',
  title: 'Node Identity',
  params: { minChunkTokens: 1, maxChunkTokens: 80, overlapRatio: 0 },
};

describe('graph node identity', () => {
  it('T-U-019 graph node identity uses existing chunk ID', () => {
    const chunks = parseDocumentChunks({
      ...baseInput,
      body: '# Root\n\nalpha beta\n\n## Child\n\ngamma delta',
    });

    const nodes = buildGraphNodeRows(baseInput.instanceId, chunks);

    expect(nodes.map((node) => node.chunk_id)).toEqual(chunks.map((chunk) => chunk.id));
    expect(nodes).toEqual(
      chunks.map((chunk) => ({
        chunk_id: chunk.id,
        instance_id: baseInput.instanceId,
      }))
    );
  });

  it('T-U-020 body edit with stable heading keeps chunk identity for stale graph handling', () => {
    const before = parseDocumentChunks({
      ...baseInput,
      body: '# Stable Heading\n\noriginal body',
    });
    const after = parseDocumentChunks({
      ...baseInput,
      body: '# Stable Heading\n\nedited body with new claim',
    });

    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.content_hash).not.toBe(before[0]?.content_hash);
    expect(buildGraphNodeRows(baseInput.instanceId, after)[0]?.chunk_id).toBe(before[0]?.id);
  });
});
