import { describe, expect, it } from 'vitest';

import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';
import { buildContainsEdges } from '../../src/graph/structural.js';

const parserBase = {
  instanceId: 'graph-structural-unit',
  documentId: '22222222-2222-4222-8222-222222222222',
  title: 'Structural',
  params: { minChunkTokens: 1, maxChunkTokens: 80, overlapRatio: 0 },
};

describe('structural graph edge builder', () => {
  it('T-U-021 parent chunk IDs produce contains edges', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: '# Parent\n\nparent body has words\n\n## Child\n\nchild body has words',
    });

    const parent = chunks.find((chunk) => chunk.heading_path === 'Parent')!;
    const child = chunks.find((chunk) => chunk.heading_path === 'Parent > Child')!;
    const edges = buildContainsEdges(chunks);

    expect(child.parent_chunk_id).toBe(parent.id);
    expect(edges).toEqual([
      {
        source_chunk_id: parent.id,
        target_chunk_id: child.id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        metadata: { structural: true },
      },
    ]);
  });
});
