import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';

const fsState = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
}));

const fsPromisesMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));

const vaultWriteMock = vi.hoisted(() => ({
  writeVaultFile: vi.fn(),
}));

const vaultManagerMock = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
}));

const supabaseManagerMock = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

const resolverMock = vi.hoisted(() => ({
  resolveDocumentIdentifier: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => fsState.existingPaths.has(path)),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: fsPromisesMock.mkdir,
    readFile: fsPromisesMock.readFile,
    rename: fsPromisesMock.rename,
    unlink: fsPromisesMock.unlink,
  };
});

vi.mock('../../src/storage/vault-write.js', () => ({
  writeVaultFile: vaultWriteMock.writeVaultFile,
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: vaultManagerMock,
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: supabaseManagerMock,
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: resolverMock.resolveDocumentIdentifier,
}));

vi.mock('../../src/services/document-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/document-lock.js')>();
  return {
    ...actual,
    withAncestorDirectoryLocksShared: vi.fn(
      async (_config, _filePath, fn: () => Promise<unknown>) => fn()
    ),
    withDocumentLocks: vi.fn(async (_config, _filePaths, fn: () => Promise<unknown>) => fn()),
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

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'test-instance',
      name: 'Test',
      vault: { path: '/tmp/fq-vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://example.invalid',
      serviceRoleKey: 'service-role',
      databaseUrl: 'postgres://test',
    },
    locking: { enabled: true },
  } as FlashQueryConfig;
}

function makeSupabase() {
  const ownershipMaybeSingle = vi.fn().mockResolvedValue({ data: { ownership_plugin_id: null } });
  const ownershipEq2 = vi.fn().mockReturnValue({ maybeSingle: ownershipMaybeSingle });
  const ownershipEq1 = vi.fn().mockReturnValue({ eq: ownershipEq2 });
  const selectOwnership = vi.fn().mockReturnValue({ eq: ownershipEq1 });

  const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null });
  const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle });
  const updateEq2 = vi.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
  const update = vi.fn().mockReturnValue({ eq: updateEq1 });

  return {
    from: vi.fn().mockReturnValue({ select: selectOwnership, update }),
  };
}

async function registerMoveTool(): Promise<ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  const { registerDocumentTools } = await import('../../src/mcp/tools/documents.js');

  registerDocumentTools(server, makeConfig());
  const handler = handlers.get('move_document');
  if (!handler) throw new Error('move_document handler was not registered');
  return handler;
}

function parsePayload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-022 move-exdev-fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsState.existingPaths = new Set(['/tmp/fq-vault/source.md']);
    resolverMock.resolveDocumentIdentifier.mockResolvedValue({
      absPath: '/tmp/fq-vault/source.md',
      relativePath: 'source.md',
      fqcId: 'doc-1',
      resolvedVia: 'path',
    });
    supabaseManagerMock.getClient.mockReturnValue(makeSupabase());
    fsPromisesMock.mkdir.mockResolvedValue(undefined);
    fsPromisesMock.readFile.mockResolvedValue('source body');
    fsPromisesMock.rename.mockRejectedValue(
      Object.assign(new Error('rename failed'), { code: 'EXDEV' })
    );
    fsPromisesMock.unlink.mockResolvedValue(undefined);
    vaultWriteMock.writeVaultFile.mockResolvedValue({ contentHash: 'hash' });
    vaultManagerMock.readMarkdown.mockResolvedValue({
      data: { fq_title: 'Destination', fq_id: 'doc-1', fq_updated: '2026-05-27T00:00:00.000Z' },
      content: 'source body',
    });
  });

  it('T-U-034 writes the destination durably before unlinking the source on EXDEV', async () => {
    const events: string[] = [];
    fsPromisesMock.rename.mockImplementation(async () => {
      events.push('rename');
      throw Object.assign(new Error('plain errno object'), { code: 'EXDEV' });
    });
    fsPromisesMock.readFile.mockImplementation(async () => {
      events.push('readFile');
      return 'source body';
    });
    vaultWriteMock.writeVaultFile.mockImplementation(async () => {
      events.push('writeVaultFile');
      return { contentHash: 'hash' };
    });
    fsPromisesMock.unlink.mockImplementation(async () => {
      events.push('unlink');
    });

    const moveDocument = await registerMoveTool();
    const result = await moveDocument({ identifier: 'source.md', destination: 'dest.md' });

    expect(result.isError).not.toBe(true);
    expect(vaultWriteMock.writeVaultFile).toHaveBeenCalledWith(
      '/tmp/fq-vault/dest.md',
      'source body',
      {
        lockConfig: expect.objectContaining({
          instance: expect.objectContaining({ id: 'test-instance' }),
        }),
      }
    );
    expect(fsPromisesMock.unlink).toHaveBeenCalledWith('/tmp/fq-vault/source.md');
    expect(events.slice(0, 4)).toEqual(['rename', 'readFile', 'writeVaultFile', 'unlink']);
  });

  it('T-U-035 does not unlink the source when the durable destination commit fails', async () => {
    vaultWriteMock.writeVaultFile.mockRejectedValueOnce(new Error('durable write failed'));

    const moveDocument = await registerMoveTool();
    const result = await moveDocument({ identifier: 'source.md', destination: 'dest.md' });

    expect(fsPromisesMock.unlink).not.toHaveBeenCalled();
    expect(parsePayload(result)).toMatchObject({
      error: 'runtime_error',
      message: expect.stringContaining('durable write failed'),
    });
  });
});
