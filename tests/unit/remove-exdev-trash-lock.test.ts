import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const vaultMock = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
  writeMarkdown: vi.fn(),
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
  withDocumentLocks: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
}));

const fsPromisesMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: fsMock.existsSync,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: fsPromisesMock.readFile,
    stat: fsPromisesMock.stat,
  };
});

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

vi.mock('../../src/services/document-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/document-lock.js')>();
  return {
    ...actual,
    withAncestorDirectoryLocksShared: lockMock.withAncestorDirectoryLocksShared,
    withDocumentLock: lockMock.withDocumentLock,
    withDocumentLocks: lockMock.withDocumentLocks,
  };
});

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'unit',
      name: 'Unit',
      vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://example.invalid',
      serviceRoleKey: 'key',
      databaseUrl: 'postgresql://localhost/db',
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: true },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    trashFolder: { enabled: true, path: '.flashquery/removed', collisionStrategy: 'suffix' },
  } as FlashQueryConfig;
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
  };
}

async function registerRemoveTool(): Promise<ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  const { registerDocumentTools } = await import('../../src/mcp/tools/documents.js');

  registerDocumentTools(server, makeConfig());
  const handler = handlers.get('remove_document');
  if (!handler) throw new Error('remove_document handler was not registered');
  return handler;
}

function parsePayload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('remove_document trash destination locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseManagerMock.getClient.mockReturnValue(createSupabaseClient());
    resolverMock.resolveDocumentIdentifier.mockResolvedValue({
      absPath: '/tmp/fq-unit/Notes/Busy.md',
      relativePath: 'Notes/Busy.md',
      fqcId: 'doc-1',
      resolvedVia: 'path',
    });
    resolverMock.targetedScan.mockResolvedValue({
      capturedFrontmatter: { fqc_id: 'doc-1' },
    });
    vaultMock.readMarkdown.mockResolvedValue({
      data: { fq_title: 'Busy', fqc_id: 'doc-1', fq_status: 'active' },
      content: 'body',
    });
    vaultMock.writeMarkdown.mockResolvedValue(undefined);
    vaultMock.moveMarkdownToTrash.mockResolvedValue(undefined);
    fsMock.existsSync.mockReturnValue(false);
    fsPromisesMock.readFile.mockResolvedValue(
      '---\nfq_title: Busy\nfqc_id: doc-1\nfq_status: active\n---\nbody\n'
    );
    fsPromisesMock.stat.mockResolvedValue({ mtime: new Date('2026-05-26T00:00:00.000Z') });
  });

  it('locks the source and trash destination before moving to trash', async () => {
    const events: string[] = [];
    lockMock.withAncestorDirectoryLocksShared.mockImplementation(
      async (_config, filePath: string, fn: () => Promise<unknown>) => {
        events.push(`dir:${filePath}:enter`);
        try {
          return await fn();
        } finally {
          events.push(`dir:${filePath}:exit`);
        }
      }
    );
    lockMock.withDocumentLocks.mockImplementation(
      async (_config, filePaths: string[], fn: () => Promise<unknown>) => {
        events.push(`docs:${filePaths.join('|')}:enter`);
        try {
          return await fn();
        } finally {
          events.push(`docs:${filePaths.join('|')}:exit`);
        }
      }
    );
    vaultMock.moveMarkdownToTrash.mockImplementation(async () => {
      events.push('moveMarkdownToTrash');
    });

    const removeDocument = await registerRemoveTool();
    const result = await removeDocument({ identifiers: 'Notes/Busy.md' });

    expect(result.isError).not.toBe(true);
    expect(lockMock.withDocumentLock).not.toHaveBeenCalled();
    expect(lockMock.withAncestorDirectoryLocksShared).toHaveBeenCalledWith(
      expect.any(Object),
      '/tmp/fq-unit/Notes/Busy.md',
      expect.any(Function)
    );
    expect(lockMock.withAncestorDirectoryLocksShared).toHaveBeenCalledWith(
      expect.any(Object),
      '/tmp/fq-unit/.flashquery/removed/Busy.md',
      expect.any(Function)
    );
    expect(lockMock.withDocumentLocks).toHaveBeenCalledWith(
      expect.any(Object),
      ['/tmp/fq-unit/Notes/Busy.md', '/tmp/fq-unit/.flashquery/removed/Busy.md'],
      expect.any(Function)
    );
    expect(vaultMock.moveMarkdownToTrash).toHaveBeenCalledWith(
      'Notes/Busy.md',
      '/tmp/fq-unit/.flashquery/removed/Busy.md',
      { gitTitle: 'Busy' }
    );
    expect(events).toContain('moveMarkdownToTrash');
    expect(events.indexOf('docs:/tmp/fq-unit/Notes/Busy.md|/tmp/fq-unit/.flashquery/removed/Busy.md:enter'))
      .toBeLessThan(events.indexOf('moveMarkdownToTrash'));
    expect(events.indexOf('moveMarkdownToTrash')).toBeLessThan(
      events.indexOf('docs:/tmp/fq-unit/Notes/Busy.md|/tmp/fq-unit/.flashquery/removed/Busy.md:exit')
    );
    expect(parsePayload(result)).toMatchObject({
      identifier: 'Notes/Busy.md',
      moved_to: '.flashquery/removed/Busy.md',
      status: 'archived',
    });
  });
});
