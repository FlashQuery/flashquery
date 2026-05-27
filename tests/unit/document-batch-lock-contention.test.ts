import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';

const vaultMock = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
  writeMarkdown: vi.fn(),
  removeMarkdown: vi.fn(),
  moveMarkdownToTrash: vi.fn(),
}));

const supabaseManagerMock = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

const resolverMock = vi.hoisted(() => ({
  resolveDocumentIdentifier: vi.fn(),
  targetedScan: vi.fn(),
}));

const lockMock = vi.hoisted(() => ({
  withAncestorDirectoryLocksShared: vi.fn(),
  withDocumentLock: vi.fn(),
}));

const fsPromisesMock = vi.hoisted(() => ({
  stat: vi.fn(),
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: vaultMock,
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: supabaseManagerMock,
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: resolverMock.resolveDocumentIdentifier,
  targetedScan: resolverMock.targetedScan,
}));

vi.mock('../../src/services/document-lock.js', () => {
  class LockTimeoutError extends Error {
    constructor(resource: string) {
      super(`Write lock timeout: another instance is writing to ${resource}. Retry in a few seconds.`);
      this.name = 'LockTimeoutError';
    }
  }

  return {
    LockTimeoutError,
    withAncestorDirectoryLocksShared: lockMock.withAncestorDirectoryLocksShared,
    withDocumentLock: lockMock.withDocumentLock,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: fsPromisesMock.stat,
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: true },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
  } as FlashQueryConfig;
}

async function registerHandlers(): Promise<Map<string, ToolHandler>> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  const { registerDocumentTools } = await import('../../src/mcp/tools/documents.js');

  registerDocumentTools(server, makeConfig());
  return handlers;
}

function createSupabaseClient() {
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }),
  };

  return {
    from: vi.fn(() => query),
    query,
  };
}

function parsePayload(result: Awaited<ReturnType<ToolHandler>>): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('document batch lock-contention envelopes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initLogger({ level: 'error', output: 'stderr' });
    supabaseManagerMock.getClient.mockReturnValue(createSupabaseClient());
    resolverMock.resolveDocumentIdentifier.mockResolvedValue({
      absPath: '/tmp/fq-unit/Notes/Busy.md',
      relativePath: 'Notes/Busy.md',
      fqcId: 'doc-1',
      resolvedVia: 'path',
    });
    resolverMock.targetedScan.mockResolvedValue({ capturedFrontmatter: { fqcId: 'doc-1' } });
    vaultMock.readMarkdown.mockResolvedValue({
      data: { title: 'Busy', fqc_id: 'doc-1', fq_status: 'active' },
      content: 'body',
    });
    vaultMock.writeMarkdown.mockResolvedValue(undefined);
    vaultMock.removeMarkdown.mockResolvedValue(undefined);
    vaultMock.moveMarkdownToTrash.mockResolvedValue(undefined);
    fsPromisesMock.stat.mockResolvedValue({ mtime: new Date('2026-05-26T00:00:00.000Z') });
    const { LockTimeoutError } = await import('../../src/services/document-lock.js');
    lockMock.withAncestorDirectoryLocksShared.mockImplementation(async (_config, _filePath, fn) => fn());
    lockMock.withDocumentLock.mockRejectedValue(new LockTimeoutError('/tmp/fq-unit/Notes/Busy.md'));
  });

  it('archive_document batch item lock timeouts use conflict lock_timeout envelopes', async () => {
    const handlers = await registerHandlers();
    const archiveDocument = handlers.get('archive_document');
    if (!archiveDocument) throw new Error('archive_document handler was not registered');

    const result = await archiveDocument({ identifiers: ['Notes/Busy.md'] });

    expect(result.isError).toBeUndefined();
    expect(parsePayload(result)).toEqual([
      expect.objectContaining({
        error: 'conflict',
        identifier: 'Notes/Busy.md',
        details: { reason: 'lock_timeout' },
      }),
    ]);
    expect(vaultMock.writeMarkdown).not.toHaveBeenCalled();
  });

  it('remove_document batch item lock timeouts use conflict lock_timeout envelopes', async () => {
    const handlers = await registerHandlers();
    const removeDocument = handlers.get('remove_document');
    if (!removeDocument) throw new Error('remove_document handler was not registered');

    const result = await removeDocument({ identifiers: ['Notes/Busy.md'] });

    expect(result.isError).toBeUndefined();
    expect(parsePayload(result)).toMatchObject({
      results: [
        {
          error: 'conflict',
          identifier: 'Notes/Busy.md',
          details: { reason: 'lock_timeout' },
        },
      ],
    });
    expect(vaultMock.writeMarkdown).not.toHaveBeenCalled();
  });
});
