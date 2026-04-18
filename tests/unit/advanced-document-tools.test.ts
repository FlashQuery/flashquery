import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    writeMarkdown: vi.fn(),
    readMarkdown: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234-5678-9abc-def012345678'),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn(),
    queue: vi.fn(),
  },
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: vi.fn().mockImplementation(async (_config: unknown, _supabase: unknown, identifier: string) => {
    const relativePath = identifier.endsWith('.md') ? identifier : `${identifier}.md`;
    return {
      absPath: `/tmp/test-vault/${relativePath}`,
      relativePath,
      fqcId: 'test-fqc-id',
      resolvedVia: 'path' as const,
    };
  }),
  ensureProvisioned: vi.fn().mockImplementation(async (_config: unknown, _supabase: unknown, resolved: unknown) => resolved),
  targetedScan: vi.fn().mockImplementation(async (_config: unknown, _supabase: unknown, resolved: unknown) => ({
    ...(resolved as Record<string, unknown>),
    capturedFrontmatter: {
      fqcId: 'some-uuid',
      created: new Date().toISOString(),
      status: 'active',
    },
    stalePathNote: undefined,
  })),
}));

vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-sha256-hash-abc123'),
  })),
}));

const { mockAcquire } = vi.hoisted(() => ({
  mockAcquire: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../src/services/scanner.js', () => ({
  scanMutex: { acquire: mockAcquire },
}));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

vi.mock('../../src/services/manifest-loader.js', () => ({
  reloadManifests: vi.fn(),
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getEntry: vi.fn(),
    loadEntry: vi.fn(),
    removeEntry: vi.fn(() => true),
  },
  parsePluginSchema: vi.fn(),
  buildPluginTableDDL: vi.fn(),
  resolveTableName: vi.fn(),
  validateInstanceName: vi.fn(),
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { vaultManager } from '../../src/storage/vault.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { embeddingProvider } from '../../src/embedding/provider.js';
import * as resolveDocumentModule from '../../src/mcp/utils/resolve-document.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a mock McpServer that captures registered tool handlers. */
function createMockServer(): { server: McpServer; tools: Map<string, (params: unknown) => unknown> } {
  const tools = new Map<string, (params: unknown) => unknown>();

  const server: McpServer = {
    registerTool: vi.fn((name: string, _schema: unknown, handler: (params: unknown) => unknown) => {
      tools.set(name, handler);
    }),
  } as unknown as McpServer;

  return { server, tools };
}

function createMockConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'test-instance-id',
      name: 'Test Instance',
      vault: {
        path: '/tmp/test-vault',
      },
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgres://test',
    },
    embedding: {
      dimensions: 1536,
      provider: 'openai',
      apiKey: 'test-key',
    },
    locking: {
      enabled: true,
      ttlSeconds: 30,
    },
  } as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for move_document (SPEC-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a Supabase mock that supports both the plugin ownership select query
 * (select('ownership_plugin_id').eq().eq().maybeSingle()) and the path update
 * query (update().eq().eq()). The ownership_plugin_id value defaults to null
 * (no plugin owner) unless overridden.
 */
function createMoveDocumentSupabaseMock(ownershipPluginId: string | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { ownership_plugin_id: ownershipPluginId },
  });
  const selectEq2 = vi.fn().mockReturnValue({ maybeSingle });
  const selectEq1 = vi.fn().mockReturnValue({ eq: selectEq2 });
  const select = vi.fn().mockReturnValue({ eq: selectEq1 });

  const updateEq2 = vi.fn().mockResolvedValue({ error: null });
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
  const update = vi.fn().mockReturnValue({ eq: updateEq1 });

  const mockSupabase = {
    from: vi.fn().mockReturnValue({ select, update }),
    _spies: { select, update, selectEq1, selectEq2, maybeSingle, updateEq1, updateEq2 },
  };
  return mockSupabase;
}

describe('move_document (SPEC-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a file and updates database', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    // Mock filesystem
    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockImplementation((path: string) => {
      if (String(path).includes('test.md')) return true;
      return false;
    });

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Original Title
fqc_id: test-fqc-id
---
Content here`
    );

    // Mock Supabase — must support both select (ownership check) and update (path update)
    const mockSupabase = createMoveDocumentSupabaseMock(null);
    const mockGetClient = vi.mocked(supabaseManager.getClient);
    mockGetClient.mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    expect(moveTool).toBeDefined();

    const result = await moveTool?.({ identifier: 'test.md', destination: 'newdir/renamed.md' });

    expect(result).toHaveProperty('content');
    expect(result?.content[0].text).toContain('Document moved successfully');
    expect(mockRename).toHaveBeenCalledWith('/tmp/test-vault/test.md', '/tmp/test-vault/newdir/renamed.md');
  });

  it('rejects if destination already exists', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    // Mock filesystem — all paths exist (source and destination)
    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockReturnValue(true);

    // The plugin ownership check (Step 1.5) runs before the destination-exists check,
    // so Supabase must be mocked even for this error path.
    const mockSupabase = createMoveDocumentSupabaseMock(null);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'test.md', destination: 'existing.md' });

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('A file already exists');
  });

  it('rejects path traversal attempts', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockReturnValue(true); // source exists

    // Plugin ownership check runs before path traversal check
    const mockSupabase = createMoveDocumentSupabaseMock(null);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'test.md', destination: '../../etc/passwd' });

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('escapes vault root');
  });

  it('auto-appends extension if omitted', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockImplementation((path: string) => {
      if (String(path).includes('test.md')) return true;
      return false;
    });

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Test
fqc_id: test-fqc-id
---
Content`
    );

    const mockSupabase = createMoveDocumentSupabaseMock(null);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    await moveTool?.({ identifier: 'test.md', destination: 'newdir/renamed' });

    const callArgs = mockRename.mock.calls[0];
    expect(String(callArgs[1])).toMatch(/renamed\.md$/i);
  });

  // ── Plugin ownership warning tests (G-003) ──────────────────────────────────

  it('should display warning when document is owned by a plugin', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    // Source exists, destination does not
    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockImplementation((path: string) => {
      if (String(path).endsWith('test.md')) return true;
      return false;
    });

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Owned Doc
fqc_id: test-fqc-id
---
Content`
    );

    // Plugin ownership query: select('ownership_plugin_id').eq('id', ...).eq('instance_id', ...).maybeSingle()
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { ownership_plugin_id: 'crm-plugin' },
    });
    const mockSelectEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 });

    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        update: mockUpdate,
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'test.md', destination: 'newdir/renamed.md' });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0].text).toContain('Warning');
    expect(result?.content[0].text).toContain('owned by plugin');
    expect(result?.content[0].text).toContain('crm-plugin');
    expect(result?.content[0].text).toContain('may expect the original path');
  });

  it('should not display warning when document has no plugin ownership', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockExistsSync = vi.mocked(fs.existsSync);
    mockExistsSync.mockImplementation((path: string) => {
      if (String(path).endsWith('test.md')) return true;
      return false;
    });

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Unowned Doc
fqc_id: test-fqc-id
---
Content`
    );

    // ownership_plugin_id is null — no plugin owns this document
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { ownership_plugin_id: null },
    });
    const mockSelectEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 });

    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        update: mockUpdate,
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'test.md', destination: 'newdir/renamed.md' });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0].text).not.toContain('owned by plugin');
  });

  it('should skip plugin ownership check when document has no fqc_id', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    // Override resolveDocumentIdentifier to return fqcId: null (untracked document)
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValueOnce({
      absPath: '/tmp/test-vault/untracked.md',
      relativePath: 'untracked.md',
      fqcId: null,
      resolvedVia: 'path' as const,
    });

    const mockExistsSync = vi.mocked(fs.existsSync);
    // Source (/tmp/test-vault/untracked.md) exists; destination (/tmp/test-vault/newdir/untracked.md) does not
    mockExistsSync.mockImplementation((p: string) => String(p) === '/tmp/test-vault/untracked.md');

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Untracked Doc
---
Content without fqc_id`
    );

    const mockSelectSpy = vi.fn();
    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelectSpy,
        update: mockUpdate,
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'untracked.md', destination: 'newdir/untracked.md' });

    // Move should succeed
    expect(result?.isError).not.toBe(true);
    // No plugin ownership warning
    expect(result?.content[0].text).not.toContain('owned by plugin');
    // The ownership_plugin_id select query should NOT have been called
    // (the fqc_id guard prevents the query; select is only used for DB update path which has no fqcId)
    expect(mockSelectSpy).not.toHaveBeenCalled();
  });

  it('should complete move successfully even when plugin ownership warning is present', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockExistsSync = vi.mocked(fs.existsSync);
    // Source (/tmp/test-vault/plugin-doc.md) exists; destination (/tmp/test-vault/archive/plugin-doc.md) does not
    mockExistsSync.mockImplementation((p: string) => String(p) === '/tmp/test-vault/plugin-doc.md');

    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValueOnce({
      absPath: '/tmp/test-vault/plugin-doc.md',
      relativePath: 'plugin-doc.md',
      fqcId: 'tracked-fqc-id',
      resolvedVia: 'path' as const,
    });

    const mockRename = vi.mocked(fsPromises.rename);
    mockRename.mockResolvedValue(undefined as never);

    const mockMkdir = vi.mocked(fsPromises.mkdir);
    mockMkdir.mockResolvedValue(undefined as never);

    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue(
      `---
title: Plugin Doc
fqc_id: tracked-fqc-id
---
Plugin-managed content`
    );

    // Plugin owns this document
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { ownership_plugin_id: 'plugin-x' },
    });
    const mockSelectEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 });

    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        update: mockUpdate,
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerDocumentTools(server, config);

    const moveTool = tools.get('move_document');
    const result = await moveTool?.({ identifier: 'plugin-doc.md', destination: 'archive/plugin-doc.md' });

    // Warning is informational — move succeeds
    expect(result?.isError).not.toBe(true);
    // File was physically renamed
    expect(mockRename).toHaveBeenCalled();
    // DB was updated
    expect(mockUpdate).toHaveBeenCalled();
    // Warning is present in response
    expect(result?.content[0].text).toContain('Warning');
    expect(result?.content[0].text).toContain('plugin-x');
    // Success message is also present
    expect(result?.content[0].text).toContain('Document moved successfully');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for replace_doc_section (SPEC-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('replace_doc_section (SPEC-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces section content', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockReadMarkdown = vi.mocked(vaultManager.readMarkdown);
    mockReadMarkdown.mockResolvedValue({
      data: { fqc_id: 'test-id', title: 'Test' },
      content: `# Section 1
Old content here

# Section 2
Other content`,
    });

    const mockWriteMarkdown = vi.mocked(vaultManager.writeMarkdown);
    mockWriteMarkdown.mockResolvedValue(undefined);

    // Mock readFile for post-write hash computation (Step 9 in implementation)
    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue('# Section 1\nNew content here\n');

    // Mock embeddingProvider.embed for fire-and-forget re-embedding (Step 12)
    const mockEmbed = vi.mocked(embeddingProvider.embed);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerCompoundTools(server, config);

    const replaceTool = tools.get('replace_doc_section');
    expect(replaceTool).toBeDefined();

    const result = await replaceTool?.({
      identifier: 'test.md',
      heading: 'Section 1',
      content: 'New content here',
    });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0].text).toContain('Section 1');
  });

  it('fires and forgets embedding after write', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const mockReadMarkdown = vi.mocked(vaultManager.readMarkdown);
    mockReadMarkdown.mockResolvedValue({
      data: { fqc_id: 'test-id', title: 'Test' },
      content: '# Test\nContent',
    });

    const mockWriteMarkdown = vi.mocked(vaultManager.writeMarkdown);
    mockWriteMarkdown.mockResolvedValue(undefined);

    // Mock readFile for post-write hash computation (Step 9 in implementation)
    const mockReadFile = vi.mocked(fsPromises.readFile);
    mockReadFile.mockResolvedValue('# Test\nNew content\n');

    // Mock embeddingProvider.embed() (not queue) - implementation uses embed for fire-and-forget
    const mockEmbed = vi.mocked(embeddingProvider.embed);
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerCompoundTools(server, config);

    const replaceTool = tools.get('replace_doc_section');
    await replaceTool?.({
      identifier: 'test.md',
      heading: 'Test',
      content: 'New content',
    });

    // Verify embedding was called (fire-and-forget pattern)
    expect(mockEmbed).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for unregister_plugin (SPEC-16)
// ─────────────────────────────────────────────────────────────────────────────

describe('unregister_plugin (SPEC-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs dry-run inventory by default', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const schemaData = {
      schema_yaml: 'plugin:\n  id: test\n  name: Test\ntables:\n  - name: test_table',
    };

    // Create a chain that supports eq().eq().eq().maybeSingle()
    const eq3Chain = {
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: schemaData,
        }),
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: schemaData,
      }),
    };

    const eq2Chain = {
      eq: vi.fn().mockReturnValue(eq3Chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: schemaData }),
    };

    const filterChain = {
      eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
    };

    const selectChain = {
      eq: vi.fn().mockReturnValue(eq2Chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: schemaData }),
      filter: vi.fn().mockReturnValue(filterChain),
    };

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain),
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerPluginTools(server, config);

    const unregisterTool = tools.get('unregister_plugin');
    expect(unregisterTool).toBeDefined();

    const result = await unregisterTool?.({
      plugin_id: 'test',
      plugin_instance: 'default',
    });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0].text).toContain('DRY RUN');
  });

  it('errors if plugin not registered', async () => {
    const { server, tools } = createMockServer();
    const config = createMockConfig();

    const eq3Chain = {
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
        }),
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
      }),
    };

    const eq2Chain = {
      eq: vi.fn().mockReturnValue(eq3Chain),
      maybeSingle: vi.fn(),
    };

    const selectChain = {
      eq: vi.fn().mockReturnValue(eq2Chain),
      maybeSingle: vi.fn(),
    };

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain),
      }),
    };

    vi.mocked(supabaseManager.getClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof supabaseManager.getClient>);

    registerPluginTools(server, config);

    const unregisterTool = tools.get('unregister_plugin');
    const result = await unregisterTool?.({
      plugin_id: 'nonexistent',
      plugin_instance: 'default',
    });

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('not registered');
  });
});
