import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { documentArchiveResult } from '../../src/mcp/utils/response-formats.js';

const vaultMock = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
  writeMarkdown: vi.fn(),
}));

const supabaseManagerMock = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

const resolverMock = vi.hoisted(() => ({
  resolveDocumentIdentifier: vi.fn(),
  targetedScan: vi.fn(),
}));

const lockMock = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
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

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: lockMock.acquireLock,
  releaseLock: lockMock.releaseLock,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: fsPromisesMock.stat,
  };
});

type ToolHandler = (args: { identifiers: string | string[] }) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

function makeConfig(lockingEnabled = false): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: lockingEnabled, ttlSeconds: 30 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

function createSupabaseClient(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };

  return {
    from: vi.fn(() => query),
    query,
  };
}

async function createArchiveHandler(config = makeConfig()): Promise<ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  const { registerDocumentTools } = await import('../../src/mcp/tools/documents.js');

  registerDocumentTools(server, config);

  const handler = handlers.get('archive_document');
  if (!handler) {
    throw new Error('archive_document handler was not registered');
  }
  return handler;
}

function parseToolJson(result: Awaited<ReturnType<ToolHandler>>): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function setupSuccessfulArchive(result: { data: unknown; error: { message: string } | null } = { data: { id: 'doc-1' }, error: null }) {
  const supabase = createSupabaseClient(result);
  supabaseManagerMock.getClient.mockReturnValue(supabase);
  resolverMock.resolveDocumentIdentifier.mockResolvedValue({
    absPath: '/tmp/fq-unit/Notes/Archive Me.md',
    relativePath: 'Notes/Archive Me.md',
    fqcId: 'doc-1',
    resolvedVia: 'path',
  });
  resolverMock.targetedScan.mockResolvedValue({
    capturedFrontmatter: {
      fqcId: 'doc-1',
    },
  });
  vaultMock.readMarkdown.mockResolvedValue({
    data: { title: 'Archive Me', fqc_id: 'doc-1', fq_status: 'active' },
    content: 'body',
  });
  vaultMock.writeMarkdown.mockResolvedValue(undefined);
  fsPromisesMock.stat.mockResolvedValue({ mtime: new Date('2026-05-12T00:00:00.000Z') });
  return supabase;
}

describe('archive_document JSON result helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initLogger({ level: 'error', output: 'stderr' });
    lockMock.acquireLock.mockResolvedValue(true);
    lockMock.releaseLock.mockResolvedValue(undefined);
  });

  it('adds archived status and archived_at to the document identification block', () => {
    expect(
      documentArchiveResult({
        identifier: 'Notes/Archive Me.md',
        title: 'Archive Me',
        path: 'Notes/Archive Me.md',
        fq_id: '11111111-1111-4111-8111-111111111111',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 128,
        archived_at: '2026-05-12T00:01:00.000Z',
      })
    ).toEqual({
      identifier: 'Notes/Archive Me.md',
      title: 'Archive Me',
      path: 'Notes/Archive Me.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: 128 },
      status: 'archived',
      archived_at: '2026-05-12T00:01:00.000Z',
    });
  });

  it('preserves an existing archived_at value for already archived documents', () => {
    const existingArchivedAt = '2026-05-11T22:30:00.000Z';

    const result = documentArchiveResult({
      identifier: 'Notes/Archived.md',
      title: 'Archived',
      path: 'Notes/Archived.md',
      fq_id: '22222222-2222-4222-8222-222222222222',
      modified: '2026-05-12T00:10:00.000Z',
      chars: 64,
      archived_at: existingArchivedAt,
    });

    expect(result.archived_at).toBe(existingArchivedAt);
    expect(result.status).toBe('archived');
  });

  it('keeps batch archive runtime failures inside positional JSON results', async () => {
    setupSuccessfulArchive({ data: null, error: { message: 'db down' } });
    const handler = await createArchiveHandler();

    const result = await handler({ identifiers: ['Notes/Archive Me.md'] });
    const payload = JSON.parse(result.content[0]?.text ?? '[]') as Array<Record<string, unknown>>;

    expect(result.isError).toBeUndefined();
    expect(payload).toEqual([
      expect.objectContaining({
        error: 'runtime_error',
        message: expect.stringContaining('Supabase archive update failed'),
        identifier: 'Notes/Archive Me.md',
      }),
    ]);
  });

  it('T-U-225 lock acquisition: archive_document acquires the standard documents lock before mutation', async () => {
    setupSuccessfulArchive();
    const handler = await createArchiveHandler(makeConfig(true));

    await handler({ identifiers: 'Notes/Archive Me.md' });

    expect(lockMock.acquireLock).toHaveBeenCalledWith(
      expect.anything(),
      'unit',
      'documents',
      { ttlSeconds: 30 }
    );
    expect(lockMock.acquireLock.mock.invocationCallOrder[0]).toBeLessThan(
      vaultMock.writeMarkdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('T-U-226 release in finally: archive_document releases the standard documents lock', async () => {
    setupSuccessfulArchive();
    const handler = await createArchiveHandler(makeConfig(true));

    await handler({ identifiers: 'Notes/Archive Me.md' });

    expect(lockMock.releaseLock).toHaveBeenCalledWith(expect.anything(), 'unit', 'documents');
  });

  it('T-U-227 lock timeout: archive_document returns conflict lock_contention before archive mutation', async () => {
    setupSuccessfulArchive();
    lockMock.acquireLock.mockResolvedValue(false);
    const handler = await createArchiveHandler(makeConfig(true));

    const result = await handler({ identifiers: 'Notes/Archive Me.md' });
    const payload = parseToolJson(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'conflict',
      details: { reason: 'lock_contention' },
    });
    expect(vaultMock.writeMarkdown).not.toHaveBeenCalled();
    expect(resolverMock.targetedScan).not.toHaveBeenCalled();
  });

  it('rolls back archived vault frontmatter when the database archive update fails', async () => {
    setupSuccessfulArchive({ data: null, error: { message: 'db down' } });
    const handler = await createArchiveHandler();

    const result = await handler({ identifiers: 'Notes/Archive Me.md' });
    const payload = parseToolJson(result);

    expect(result.isError).toBe(true);
    expect(payload.message).toContain('Supabase archive update failed');
    expect(vaultMock.writeMarkdown).toHaveBeenCalledTimes(2);
    expect(vaultMock.writeMarkdown).toHaveBeenNthCalledWith(
      2,
      'Notes/Archive Me.md',
      { title: 'Archive Me', fqc_id: 'doc-1', fq_status: 'active' },
      'body'
    );
  });

  it('returns canonical expected-error envelope for a single missing identifier', async () => {
    const notFound = new Error('missing');
    notFound.name = 'DocumentNotFoundError';
    setupSuccessfulArchive();
    resolverMock.resolveDocumentIdentifier.mockRejectedValue(notFound);
    const handler = await createArchiveHandler();

    const result = await handler({ identifiers: 'missing.md' });
    const payload = parseToolJson(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'not_found',
      identifier: 'missing.md',
    });
  });
});
