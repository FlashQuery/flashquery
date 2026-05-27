import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';

const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
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
  existsSync: vi.fn((path: string) => fsState.files.has(path)),
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
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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
  return { from: vi.fn().mockReturnValue({ select: selectOwnership, update }) };
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

describe('REQ-022 move-exdev integration fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsState.files = new Map([['/tmp/fq-vault/source.md', 'source body']]);
    resolverMock.resolveDocumentIdentifier.mockResolvedValue({
      absPath: '/tmp/fq-vault/source.md',
      relativePath: 'source.md',
      fqcId: 'doc-1',
      resolvedVia: 'path',
    });
    supabaseManagerMock.getClient.mockReturnValue(makeSupabase());
    fsPromisesMock.mkdir.mockResolvedValue(undefined);
    fsPromisesMock.readFile.mockImplementation(
      async (path: string) => fsState.files.get(path) ?? ''
    );
    fsPromisesMock.rename.mockRejectedValue(
      Object.assign(new Error('cross-device'), { code: 'EXDEV' })
    );
    fsPromisesMock.unlink.mockImplementation(async (path: string) => {
      fsState.files.delete(path);
    });
    vaultWriteMock.writeVaultFile.mockRejectedValue(new Error('simulated durable commit failure'));
    vaultManagerMock.readMarkdown.mockResolvedValue({
      data: { fq_title: 'Destination', fq_id: 'doc-1' },
      content: 'source body',
    });
  });

  it('T-I-042 simulated EXDEV durable commit failure leaves source intact and no partial destination', async () => {
    const moveDocument = await registerMoveTool();
    const result = await moveDocument({ identifier: 'source.md', destination: 'dest.md' });

    expect(vaultWriteMock.writeVaultFile).toHaveBeenCalledWith(
      '/tmp/fq-vault/dest.md',
      'source body',
      {
        lockConfig: expect.objectContaining({
          instance: expect.objectContaining({ id: 'test-instance' }),
        }),
      }
    );
    expect(fsPromisesMock.unlink).not.toHaveBeenCalled();
    expect(fsState.files.get('/tmp/fq-vault/source.md')).toBe('source body');
    expect(fsState.files.has('/tmp/fq-vault/dest.md')).toBe(false);
    expect(parsePayload(result)).toMatchObject({
      error: 'runtime_error',
      message: expect.stringContaining('simulated durable commit failure'),
    });
  });
});
