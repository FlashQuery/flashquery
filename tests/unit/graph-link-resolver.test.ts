import { describe, expect, it } from 'vitest';

import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';
import { resolveChunkReferences } from '../../src/graph/link-resolver.js';

const parserBase = {
  instanceId: 'graph-link-resolver-unit',
  params: { minChunkTokens: 1, maxChunkTokens: 120, overlapRatio: 0 },
};

function chunks(documentId: string, title: string, body: string) {
  return parseDocumentChunks({
    ...parserBase,
    documentId,
    title,
    body,
  });
}

const sourceDocumentId = '33333333-3333-4333-8333-333333333333';
const targetDocumentId = '44444444-4444-4444-8444-444444444444';

describe('graph markdown link resolver', () => {
  it('T-U-022 resolves wikilinks with slug-normalized anchors to target chunks', () => {
    const sourceChunks = chunks(sourceDocumentId, 'Source', '# Source\n\nSee [[target-doc#Deep Heading]].');
    const targetChunks = chunks(
      targetDocumentId,
      'Target',
      '# Target Root\n\nroot body\n\n## Deep Heading\n\ntarget body'
    );

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [
        { documentId: targetDocumentId, path: '/target-doc.md', title: 'Target', chunks: targetChunks },
      ],
    });

    expect(result.edges).toEqual([
      expect.objectContaining({
        source_chunk_id: sourceChunks[0]!.id,
        target_chunk_id: targetChunks.find((chunk) => chunk.heading_path === 'Target Root > Deep Heading')!.id,
        relation: 'references',
      }),
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('T-U-023 records unresolved-anchor metadata without creating an edge', () => {
    const sourceChunks = chunks(sourceDocumentId, 'Source', '# Source\n\nSee [[target-doc#Missing Heading]].');
    const targetChunks = chunks(targetDocumentId, 'Target', '# Target Root\n\nroot body');

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [
        { documentId: targetDocumentId, path: '/target-doc.md', title: 'Target', chunks: targetChunks },
      ],
    });

    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: 'unresolved_anchor',
        target: 'target-doc',
        anchor: 'Missing Heading',
      }),
    ]);
  });

  it('T-U-024 ignores markdown links and wikilinks inside fenced code blocks', () => {
    const sourceChunks = chunks(
      sourceDocumentId,
      'Source',
      ['# Source', '```md', '[bad](target-doc.md#Heading)', '[[target-doc#Heading]]', '```'].join('\n')
    );
    const targetChunks = chunks(targetDocumentId, 'Target', '# Heading\n\ntarget body');

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [
        { documentId: targetDocumentId, path: '/target-doc.md', title: 'Target', chunks: targetChunks },
      ],
    });

    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('T-U-070 resolves document-root links without anchors to the target root chunk', () => {
    const sourceChunks = chunks(sourceDocumentId, 'Source', '# Source\n\nSee [target](target-doc.md).');
    const targetChunks = chunks(
      targetDocumentId,
      'Target',
      '# Target Root\n\nroot body\n\n## Details\n\ndetail body'
    );

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [
        { documentId: targetDocumentId, path: '/target-doc.md', title: 'Target', chunks: targetChunks },
      ],
    });

    expect(result.edges[0]?.target_chunk_id).toBe(targetChunks[0]!.id);
  });

  it('T-U-071 records unresolved targets without creating fake nodes', () => {
    const sourceChunks = chunks(sourceDocumentId, 'Source', '# Source\n\nSee [[missing-doc#Heading]].');

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [],
    });

    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: 'unresolved_target',
        target: 'missing-doc',
        lint_warning: true,
      }),
    ]);
  });

  it('records malformed percent-encoded links as unresolved diagnostics instead of throwing', () => {
    const sourceChunks = chunks(sourceDocumentId, 'Source', '# Source\n\nSee [bad](Target%ZZ.md) and [[Target#bad%ZZ]].');
    const targetChunks = chunks(targetDocumentId, 'Target', '# Target\n\ntarget body');

    const result = resolveChunkReferences({
      sourceChunk: sourceChunks[0]!,
      documents: [
        { documentId: targetDocumentId, path: '/target.md', title: 'Target', chunks: targetChunks },
      ],
    });

    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'unresolved_target',
          target: 'Target%ZZ',
        }),
        expect.objectContaining({
          type: 'unresolved_anchor',
          target: 'Target',
          anchor: 'bad%ZZ',
        }),
      ])
    );
  });
});
