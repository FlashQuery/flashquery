import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock the chunk scheduler at the boundary the shared document re-embed helper
// depends on. `scheduleChangedDocumentChunks` is the *only* producer of
// `documentChunkEmbeddingTarget` (kind `document_chunk`, table `fqc_chunks`),
// so proving the helper routes here proves it embeds chunks and never the
// retired `fqc_documents` document-vector target.
const mocks = vi.hoisted(() => ({
  scheduleChangedDocumentChunks: vi.fn(),
}));

vi.mock('../../src/embedding/chunks/scheduler.js', () => ({
  scheduleChangedDocumentChunks: mocks.scheduleChangedDocumentChunks,
}));

// Imported after the mock is registered so the helper binds to the spy.
const { scheduleDocumentEmbedding } = await import('../../src/mcp/tools/documents/helpers.js');

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'inst-1' },
    supabase: { databaseUrl: 'postgres://localhost/test' },
  } as unknown as FlashQueryConfig;
}

const fakeSupabase = { from: () => ({}) } as never;

function input(overrides: Record<string, unknown>) {
  return {
    instanceId: 'inst-1',
    id: 'doc-1',
    label: 'notes/alpha.md',
    embedText: 'Alpha Title\n\nFirst paragraph.\n\nSecond paragraph.',
    provider: {} as never,
    supabase: fakeSupabase,
    config: makeConfig(),
    ...overrides,
  } as never;
}

describe('document re-embed routes through the chunk scheduler (behavioral)', () => {
  beforeEach(() => {
    mocks.scheduleChangedDocumentChunks.mockReset();
    mocks.scheduleChangedDocumentChunks.mockResolvedValue({
      warnings: [],
      changedChunkCount: 1,
      totalChunkCount: 1,
    });
  });

  it('schedules changed document chunks with the document body and heading title', async () => {
    const config = makeConfig();
    await scheduleDocumentEmbedding(
      input({ id: 'doc-1', label: 'notes/alpha.md', config })
    );

    expect(mocks.scheduleChangedDocumentChunks).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleChangedDocumentChunks).toHaveBeenCalledWith({
      config,
      supabase: fakeSupabase,
      documentId: 'doc-1',
      documentPath: 'notes/alpha.md',
      title: 'Alpha Title',
      body: 'First paragraph.\n\nSecond paragraph.',
    });
  });

  it('falls back to the document label as title when embed text has no leading title', async () => {
    await scheduleDocumentEmbedding(
      input({ id: 'doc-2', label: 'notes/beta.md', embedText: '\n\nBody only.' })
    );

    expect(mocks.scheduleChangedDocumentChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-2',
        documentPath: 'notes/beta.md',
        title: 'notes/beta.md',
        body: 'Body only.',
      })
    );
  });

  it('does not schedule any embedding when config is absent', async () => {
    await scheduleDocumentEmbedding(
      input({ id: 'doc-3', label: 'notes/gamma.md', config: undefined })
    );

    expect(mocks.scheduleChangedDocumentChunks).not.toHaveBeenCalled();
  });
});

describe('catalog embedding routing guards (static)', () => {
  // Belt-and-suspenders source guards: catch any re-introduction of the retired
  // `fqc_documents` document-vector target across every write path, including
  // `copy_document`, which schedules chunks directly rather than via the helper.
  it.each([
    ['copy_document', 'src/mcp/tools/documents/copy.ts', /scheduleChangedDocumentChunks/],
    ['get_document / reference stale re-embed helper', 'src/mcp/tools/documents/helpers.ts', /scheduleChangedDocumentChunks/],
    ['reference resolver', 'src/llm/reference-resolver.ts', /scheduleDocumentEmbedding\b/],
  ])('%s routes document re-embeds through the chunk path and never the legacy document target', (_label, path, requiredToken) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toMatch(requiredToken as RegExp);
    expect(source).not.toContain('documentEmbeddingTarget');
    expect(source).not.toContain("targetTable: 'fqc_documents'");
  });
});
