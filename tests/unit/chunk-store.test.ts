import { describe, expect, it, vi } from 'vitest';
import {
  classifyDocumentChunkDiff,
  diffAndPersistDocumentChunks,
  planDocumentChunkPersistence,
  type ExistingDocumentChunkRow,
} from '../../src/embedding/chunks/store.js';
import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';

const baseInput = {
  instanceId: 'inst-store',
  documentId: '11111111-1111-4111-8111-111111111111',
  title: 'Store Doc',
  params: { minChunkTokens: 1, maxChunkTokens: 80, overlapRatio: 0 },
};

function parsedChunks(body: string) {
  return parseDocumentChunks({ ...baseInput, body });
}

describe('document chunk store', () => {
  it('T-U-026 diff classifies new, unchanged, changed, and orphan chunks by id/hash', () => {
    const current = parsedChunks('# Stable\n\nsame body\n\n# Changed\n\nnew body\n\n# New\n\nbrand new body');
    const stable = current.find((chunk) => chunk.heading_path === 'Stable')!;
    const changed = current.find((chunk) => chunk.heading_path === 'Changed')!;

    const existing: ExistingDocumentChunkRow[] = [
      { id: stable.id, content_hash: stable.content_hash },
      { id: changed.id, content_hash: 'old-hash' },
      { id: '22222222-2222-4222-8222-222222222222', content_hash: 'orphan-hash' },
    ];

    const diff = classifyDocumentChunkDiff(existing, current);

    expect(diff.unchangedChunks.map((chunk) => chunk.id)).toEqual([stable.id]);
    expect(diff.changedChunks.map((chunk) => chunk.id)).toEqual([changed.id]);
    expect(diff.newChunks.map((chunk) => chunk.heading_path)).toEqual(['New']);
    expect(diff.orphanChunks.map((chunk) => chunk.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(diff.chunksNeedingEmbedding.map((chunk) => chunk.id)).toEqual([
      changed.id,
      current.find((chunk) => chunk.heading_path === 'New')!.id,
    ]);
  });

  it('T-U-027 plans orphan delete and insert/update statements inside one transaction', async () => {
    const initial = parsedChunks('# Old Heading\n\nold body\n\n# Edited\n\nbefore edit');
    const next = parsedChunks('# New Heading\n\nold body\n\n# Edited\n\nafter edit');
    const edited = next.find((chunk) => chunk.heading_path === 'Edited')!;
    const existing: ExistingDocumentChunkRow[] = [
      { id: initial.find((chunk) => chunk.heading_path === 'Old Heading')!.id, content_hash: 'old-heading-hash' },
      { id: edited.id, content_hash: 'before-edit-hash' },
    ];

    const planned = planDocumentChunkPersistence(classifyDocumentChunkDiff(existing, next));
    expect(planned.map((operation) => operation.kind)).toEqual(['begin', 'select', 'insert', 'update', 'delete', 'commit']);

    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (/SELECT id, content_hash/i.test(sql)) {
          return { rows: existing };
        }
        return { rows: [] };
      }),
    };

    const result = await diffAndPersistDocumentChunks({
      ...baseInput,
      body: '# New Heading\n\nold body\n\n# Edited\n\nafter edit',
      client,
    });

    expect(result.chunksNeedingEmbedding.map((chunk) => chunk.id)).toEqual([
      next.find((chunk) => chunk.heading_path === 'New Heading')!.id,
      edited.id,
    ]);
    expect(calls.map((call) => call.sql.trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'COMMIT',
    ]);
    for (const call of calls.slice(1, -1)) {
      expect(call.sql).toContain('fqc_chunks');
    }
    expect(calls.find((call) => call.sql.trim().startsWith('DELETE'))?.params).toEqual([
      baseInput.instanceId,
      baseInput.documentId,
      [initial.find((chunk) => chunk.heading_path === 'Old Heading')!.id],
    ]);
  });
});
