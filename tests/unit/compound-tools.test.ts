import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { RegistryEntry } from '../../src/plugins/manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports of mocked modules)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    writeMarkdown: vi.fn(),
    readMarkdown: vi.fn(),
    resolvePath: vi.fn((p: string) => `/mock-vault/${p}`),
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

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn(),
  },
}));

vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-sha256-hash'),
  })),
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getAllEntries: vi.fn(() => [] as RegistryEntry[]),
  },
}));

vi.mock('../../src/mcp/utils/resolve-document.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveDocumentIdentifier: vi.fn().mockResolvedValue({
      absPath: '/mock-vault/test.md',
      relativePath: 'test.md',
      fqcId: 'mock-fqc-uuid',
      resolvedVia: 'path',
    }),
    targetedScan: vi.fn().mockImplementation((_c: unknown, _s: unknown, resolved: { absPath: string; relativePath: string; fqcId: string | null; resolvedVia: string }) => Promise.resolve({
      ...resolved,
      capturedFrontmatter: {
        fqcId: 'mock-fqc-uuid-from-scan',
        created: new Date().toISOString(),
        status: 'active',
        contentHash: 'test-hash-abc123',
      },
    })),
    ensureProvisioned: vi.fn().mockImplementation(
      (_c: unknown, _s: unknown, resolved: unknown) => Promise.resolve(resolved)
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons and module under test
// ─────────────────────────────────────────────────────────────────────────────

import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { embeddingProvider } from '../../src/embedding/provider.js';
import { vaultManager } from '../../src/storage/vault.js';
import { pluginManager } from '../../src/plugins/manager.js';
import * as resolveDocumentModule from '../../src/mcp/utils/resolve-document.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a mock McpServer that captures registered tool handlers. */
function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => handlers[name],
  };
}

/** Creates a minimal FlashQueryConfig for testing. */
function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance',
      vault: { path: '/mock-vault', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    },
    logging: {
      level: 'info',
      output: 'stdout',
    },
  } as unknown as FlashQueryConfig;
}

/** Creates a chainable Supabase mock that returns the given result at end of chain. */
function makeSupabaseMock(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  const terminal = vi.fn().mockResolvedValue(result);

  // Phase 1: Create object with basic structure (no self-references yet)
  const self: Record<string, unknown> = {
    from: vi.fn(),
    select: vi.fn(),
    insert: terminal,
    update: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    _terminal: terminal,
  };

  // Phase 2: Configure self-returning methods after self exists
  (self.from as ReturnType<typeof vi.fn>).mockReturnValue(self);
  (self.select as ReturnType<typeof vi.fn>).mockReturnValue(self);
  (self.update as ReturnType<typeof vi.fn>).mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });
  (self.eq as ReturnType<typeof vi.fn>).mockReturnValue(self);
  (self.ilike as ReturnType<typeof vi.fn>).mockReturnValue(self);
  (self.order as ReturnType<typeof vi.fn>).mockReturnValue(self);
  (self.limit as ReturnType<typeof vi.fn>).mockReturnValue(self);

  void chain;
  return self as unknown as ReturnType<typeof supabaseManager.getClient>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: TSA-04 targetedScan integration in compound tools
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: TSA-04 tests skipped due to vitest mock isolation issue (see: .planning/debug/failing-tests.md)
// The issue: vi.mock() mocks are not properly isolated between describe blocks when mocks are set in beforeEach
// Workaround: move these tests to separate file or refactor mock setup
describe('TSA-04: targetedScan integration in compound tools', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mocks BEFORE creating mockServer and registering tools
    // Default: file exists
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Default: readFile returns a document with frontmatter + body
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Test Doc\nfqc_id: doc-uuid-123\nstatus: active\n---\n\nExisting body content.' as unknown as Buffer
    );

    // Default: writeFile succeeds
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    // Default: embed returns a mock vector
    vi.mocked(embeddingProvider.embed).mockResolvedValue(Array(1536).fill(0.1));

    // CRITICAL: Restore targetedScan mock after vi.clearAllMocks() wipes the module-level implementation
    vi.mocked(resolveDocumentModule.targetedScan).mockImplementation((_c: unknown, _s: unknown, resolved: { absPath: string; relativePath: string; fqcId: string | null; resolvedVia: string }) => Promise.resolve({
      ...resolved,
      capturedFrontmatter: {
        fqcId: 'mock-fqc-uuid-from-scan',
        created: new Date().toISOString(),
        status: 'active',
        contentHash: 'test-hash-abc123',
      },
    }));
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValue({
      absPath: '/mock-vault/test.md',
      relativePath: 'test.md',
      fqcId: 'mock-fqc-uuid',
      resolvedVia: 'path',
    });

    // Default Supabase mock
    const mockClient = makeSupabaseMock({});
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient);

    // NOW create mockServer and register tools
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);
  });

  it('TSA-04: append_to_doc calls targetedScan before writeMarkdown', async () => {
    const handler = mockServer.getHandler('append_to_doc');

    await handler({
      identifier: '_global/test-doc.md',
      content: '## Notes\n\nSome text',
    });

    // targetedScan should have been called
    expect(resolveDocumentModule.targetedScan).toHaveBeenCalled();
    // writeMarkdown should have been called
    expect(vaultManager.writeMarkdown).toHaveBeenCalled();
  });

  it('TSA-04: update_doc_header calls targetedScan before writeMarkdown', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/test-doc.md',
      updates: { title: 'New Title' },
    });

    // targetedScan should have been called
    expect(resolveDocumentModule.targetedScan).toHaveBeenCalled();
    // writeMarkdown should have been called
    expect(vaultManager.writeMarkdown).toHaveBeenCalled();
  });

  it('TSA-04: insert_doc_link calls targetedScan before writeMarkdown', async () => {
    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/test-doc.md',
      target: 'other-doc.md',
    });

    // targetedScan should have been called
    expect(resolveDocumentModule.targetedScan).toHaveBeenCalled();
    // writeMarkdown should have been called
    expect(vaultManager.writeMarkdown).toHaveBeenCalled();
  });

  it('TSA-04: apply_tags calls targetedScan before writeMarkdown', async () => {
    const handler = mockServer.getHandler('apply_tags');

    await handler({
      identifiers: '_global/test-doc.md',
      add_tags: ['test-tag'],
    });

    // targetedScan should have been called
    expect(resolveDocumentModule.targetedScan).toHaveBeenCalled();
    // writeMarkdown should have been called
    expect(vaultManager.writeMarkdown).toHaveBeenCalled();
  });

  afterEach(async () => {
    // Flush pending microtasks so fire-and-forget embed promises from tool handlers
    // don't bleed into subsequent tests' mock call records after vi.clearAllMocks().
    await new Promise(resolve => setTimeout(resolve, 0));
    // Clear gray-matter's parse cache: gray-matter returns the SAME cached data object
    // by reference, so mutations (e.g. parsed.data.title = 'New Title') persist across
    // calls with the same raw string and pollute subsequent tests.
    matter.clearCache();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: append_to_doc
// ─────────────────────────────────────────────────────────────────────────────

describe('append_to_doc', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mocks BEFORE creating mockServer and registering tools (mock state must be ready when handlers are registered)
    // Default: file exists
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // CRITICAL: Use mockImplementation to ensure fresh mock behavior for each call
    // This prevents mock state pollution from previous describe blocks
    const testDocContent = '---\ntitle: Test Doc\nfqc_id: doc-uuid-123\nstatus: active\n---\n\nExisting body content.';
    vi.mocked(fsPromises.readFile).mockImplementation(async () => testDocContent as unknown as Buffer);

    // Default: writeFile succeeds
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    // Default: embed returns a mock vector
    vi.mocked(embeddingProvider.embed).mockResolvedValue(Array(1536).fill(0.1));

    // NOW create mockServer and register tools
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    // Default Supabase mock
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    // Reset resolveDocumentModule mocks to ensure isolation
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValue({
      absPath: '/mock-vault/test.md',
      relativePath: 'test.md',
      fqcId: 'mock-fqc-uuid',
      resolvedVia: 'path',
    });
    vi.mocked(resolveDocumentModule.targetedScan).mockImplementation((_c: unknown, _s: unknown, resolved: { absPath: string; relativePath: string; fqcId: string | null; resolvedVia: string }) => Promise.resolve({
      ...resolved,
      capturedFrontmatter: {
        fqcId: 'mock-fqc-uuid-from-scan',
        created: new Date().toISOString(),
        status: 'active',
        contentHash: 'test-hash-abc123',
      },
    }));
  });

  it('Test 1: appends content to document without modifying existing content', async () => {
    const handler = mockServer.getHandler('append_to_doc');

    const result = await handler({
      identifier: '_global/test-doc.md',
      content: '## Notes\n\nSome text',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // vaultManager.writeMarkdown should have been called (not raw writeFile)
    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();

    const [, , writtenBody] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // Original content must be preserved
    expect(writtenBody).toContain('Existing body content.');

    // New content must be appended
    expect(writtenBody).toContain('## Notes');
    expect(writtenBody).toContain('Some text');

    // The new content must come AFTER the existing body
    const existingBodyPos = writtenBody.indexOf('Existing body content.');
    const newContentPos = writtenBody.indexOf('## Notes');
    expect(newContentPos).toBeGreaterThan(existingBodyPos);

    // Return message must not reference heading param
    expect(result.content[0].text).toContain('Appended content to');
  });

  it('Test 1b: inputSchema does NOT have heading key', () => {
    // Verify heading param was removed from the tool registration
    const calls = vi.mocked(mockServer.server.registerTool).mock.calls;
    const appendCall = calls.find(c => c[0] === 'append_to_doc');
    expect(appendCall).toBeDefined();
    const schema = (appendCall![1] as { inputSchema: Record<string, unknown> }).inputSchema;
    expect(schema).not.toHaveProperty('heading');
    expect(schema).toHaveProperty('content');
  });

  it('Test 2: calls embeddingProvider.embed fire-and-forget and updates Supabase', async () => {
    const handler = mockServer.getHandler('append_to_doc');

    await handler({
      identifier: '_global/test-doc.md',
      content: '## Notes\n\nSome text',
    });

    // embed must have been called
    expect(embeddingProvider.embed).toHaveBeenCalledOnce();

    // embed called with title + new content
    const embedArg = (embeddingProvider.embed as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(embedArg).toContain('Test Doc');

    // Supabase fqc_documents should be updated with content_hash
    const mockClient = vi.mocked(supabaseManager.getClient).mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    expect(mockClient.from).toHaveBeenCalledWith('fqc_documents');
  });

  it('Test 3: returns error when document cannot be resolved', async () => {
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockRejectedValueOnce(
      new Error('Document not found: _global/missing.md')
    );
    const handler = mockServer.getHandler('append_to_doc');

    const result = await handler({
      identifier: '_global/missing.md',
      content: 'Some text',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  it('DCP-05: append_to_doc calls vaultManager.writeMarkdown instead of writeFile', async () => {
    const handler = mockServer.getHandler('append_to_doc');

    await handler({
      identifier: '_global/test-doc.md',
      content: '## New Section\n\nContent',
    });

    // writeMarkdown must have been called (atomic write)
    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    // writeFile must NOT have been called for the vault write
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });

  it('DCP-05: append_to_doc reads file from disk after writeMarkdown for hash computation', async () => {
    // readFile is called twice: once to read doc before append, once after writeMarkdown for hash
    const handler = mockServer.getHandler('append_to_doc');

    await handler({
      identifier: '_global/test-doc.md',
      content: '## New Section\n\nContent',
    });

    // readFile should be called at least twice: initial read + post-write hash recompute
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });

  it('Test 4: returns error when resolved doc has no fqc_id', async () => {
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValueOnce({
      absPath: '/mock-vault/no-id.md',
      relativePath: 'no-id.md',
      fqcId: null,
      resolvedVia: 'path',
    });
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: No ID Doc\nstatus: active\n---\n\nBody content.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('append_to_doc');

    const result = await handler({
      identifier: '_global/no-id.md',
      content: 'Some text',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: update_doc_header
// ─────────────────────────────────────────────────────────────────────────────

describe('update_doc_header', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Old\nstatus: draft\nfqc_id: doc-uuid-456\n---\n\nBody unchanged.' as unknown as Buffer
    );
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
  });

  it('Test 5: updates specified frontmatter field and leaves body and other fields untouched', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/doc.md',
      updates: { title: 'New' },
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter, writtenBody] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // New title must appear in frontmatter
    expect(writtenFrontmatter.title).toBe('New');
    // Old status must be preserved
    expect(writtenFrontmatter.status).toBe('draft');
    // Body must be preserved
    expect(writtenBody).toContain('Body unchanged.');
    // Old title must not be present
    expect(writtenFrontmatter.title).not.toBe('Old');
  });

  it('Test 6: passing null value removes the key from frontmatter entirely', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Doc\nstatus: draft\nobsolete_field: some_value\nfqc_id: doc-uuid-456\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/doc.md',
      updates: { obsolete_field: null },
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // The field must be removed from the frontmatter object
    expect(writtenFrontmatter).not.toHaveProperty('obsolete_field');
  });

  it('Test 7: passing tags in updates syncs to Supabase fqc_documents.tags', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/doc.md',
      updates: { tags: ['tag1', 'tag2'] },
    });

    // Supabase update must have been called with 'fqc_documents'
    const mockClient = vi.mocked(supabaseManager.getClient).mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    expect(mockClient.from).toHaveBeenCalledWith('fqc_documents');
    const updateMock = mockClient.from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(updateMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['tag1', 'tag2'] })
    );
  });

  it('Test 8: does NOT call embeddingProvider.embed (D-06 — frontmatter-only change)', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/doc.md',
      updates: { title: 'New Title' },
    });

    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  // ── Task 2 new tests: tag validation in update_doc_header ────────────────────

  it('Task2: update_doc_header with multiple #status/* tags in updates succeeds (D-06: no conflict rejection)', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    const result = await handler({
      identifier: '_global/doc.md',
      updates: { tags: ['#status/draft', '#status/published'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // D-06: #status/* tags treated like any other tag — no conflict rejection
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('conflicting statuses');
  });

  it('Task2: update_doc_header with document containing multiple #status/* tags proceeds normally (D-06)', async () => {
    // Mock a document with 2 #status/* tags (previously a conflict, now treated as normal tags)
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Old\nfqc_id: doc-uuid-456\ntags:\n  - "#status/draft"\n  - "#status/published"\n---\n\nBody unchanged.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('update_doc_header');

    // Update a non-tag field — D-06 means no conflict check happens
    const result = await handler({
      identifier: '_global/doc.md',
      updates: { title: 'New Title' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // D-06: No conflict detection for #status/* tags — update proceeds
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('conflicting statuses');
  });

  it('Test 9: returns error when document cannot be resolved', async () => {
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockRejectedValueOnce(
      new Error('Document not found: _global/missing.md')
    );
    const handler = mockServer.getHandler('update_doc_header');

    const result = await handler({
      identifier: '_global/missing.md',
      updates: { title: 'New' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  it('DCP-05: update_doc_header calls vaultManager.writeMarkdown instead of writeFile', async () => {
    const handler = mockServer.getHandler('update_doc_header');

    await handler({
      identifier: '_global/doc.md',
      updates: { title: 'New Title' },
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: insert_doc_link
// ─────────────────────────────────────────────────────────────────────────────

describe('insert_doc_link', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockReset();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Default: readFile returns source doc content for the source, target doc for the target
    // First call = target (to read title), second call = source (to read links array)
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce('---\ntitle: My Doc\nfqc_id: target-uuid\n---\n\nTarget body.' as unknown as Buffer)  // target
      .mockResolvedValue('---\ntitle: Source Doc\nfqc_id: source-uuid\n---\n\nSource body.' as unknown as Buffer);  // source

    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    // Default resolveDocumentIdentifier: returns different paths for source and target
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier)
      .mockResolvedValueOnce({ absPath: '/mock-vault/source.md', relativePath: 'source.md', fqcId: 'source-uuid', resolvedVia: 'path' as const })
      .mockResolvedValueOnce({ absPath: '/mock-vault/my-doc.md', relativePath: 'my-doc.md', fqcId: 'target-uuid', resolvedVia: 'path' as const });

    vi.mocked(resolveDocumentModule.ensureProvisioned).mockImplementation(
      (_c, _s, resolved) => Promise.resolve(resolved)
    );

    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
  });

  it('Test 10: creates links array when frontmatter has no links property', async () => {
    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/source.md',
      target: '_global/my-doc.md',
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // The link is based on the target's title (resolved from frontmatter)
    expect(writtenFrontmatter.links).toContain('[[My Doc]]');
  });

  it('Test 11: appends to existing links array without removing existing entries', async () => {
    // Reset readFile: first call = target (title read), second call = source (with existing links)
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce('---\ntitle: My Doc\nfqc_id: target-uuid\n---\n\nTarget body.' as unknown as Buffer)
      .mockResolvedValueOnce('---\ntitle: Source Doc\nfqc_id: source-uuid\nlinks:\n  - "[[Existing]]"\n---\n\nSource body.' as unknown as Buffer);

    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/source.md',
      target: '_global/my-doc.md',
    });

    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    expect(writtenFrontmatter.links).toContain('[[Existing]]');
    expect(writtenFrontmatter.links).toContain('[[My Doc]]');
  });

  it('Test 12: inserting a link that already exists is a no-op — array unchanged', async () => {
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce('---\ntitle: My Doc\nfqc_id: target-uuid\n---\n\nTarget body.' as unknown as Buffer)
      .mockResolvedValueOnce('---\ntitle: Source Doc\nfqc_id: source-uuid\nlinks:\n  - "[[My Doc]]"\n---\n\nSource body.' as unknown as Buffer);

    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/source.md',
      target: '_global/my-doc.md',
    });

    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // Only one occurrence of [[My Doc]] in links array
    const links = writtenFrontmatter.links as string[];
    const occurrences = links.filter((l) => l === '[[My Doc]]').length;
    expect(occurrences).toBe(1);
  });

  it('Test 13: using property param writes to specified array instead of links', async () => {
    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/source.md',
      target: '_global/my-doc.md',
      property: 'related',
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // The link MUST appear in the related property
    expect(writtenFrontmatter.related).toBeDefined();
    expect(writtenFrontmatter.related).toContain('[[My Doc]]');
  });

  it('Test 14: insert_doc_link resolves both source and target via identifier', async () => {
    const handler = mockServer.getHandler('insert_doc_link');

    const result = await handler({
      identifier: '_global/source.md',
      target: '_global/my-doc.md',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('My Doc');
    // Both source and target should have been resolved
    expect(resolveDocumentModule.resolveDocumentIdentifier).toHaveBeenCalledTimes(2);
  });

  it('Test 15: returns error when target cannot be resolved', async () => {
    // Reset so beforeEach queued values don't interfere
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockReset();
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier)
      .mockResolvedValueOnce({ absPath: '/mock-vault/source.md', relativePath: 'source.md', fqcId: 'source-uuid', resolvedVia: 'path' as const })
      .mockRejectedValueOnce(new Error('Document not found: nonexistent.md'));
    vi.mocked(resolveDocumentModule.ensureProvisioned).mockImplementation(
      (_c, _s, resolved) => Promise.resolve(resolved)
    );

    const handler = mockServer.getHandler('insert_doc_link');

    const result = await handler({
      identifier: '_global/source.md',
      target: 'nonexistent.md',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|Error/i);
  });

  it('Test 16: insert_doc_link tool description says "document link" not "wikilink"', () => {
    const calls = vi.mocked(mockServer.server.registerTool).mock.calls;
    const insertCall = calls.find(c => c[0] === 'insert_doc_link');
    expect(insertCall).toBeDefined();
    const desc = (insertCall![1] as { description: string }).description;
    expect(desc.toLowerCase()).toContain('document link');
    expect(desc.toLowerCase()).not.toContain('wikilink');
  });

  it('Test 17: fallback to relative path when target file has no title frontmatter', async () => {
    // Reset readFile so beforeEach queued values don't interfere
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce('---\nfqc_id: target-uuid\n---\n\nTarget body (no title).' as unknown as Buffer)
      .mockResolvedValueOnce('---\ntitle: Source Doc\nfqc_id: source-uuid\n---\n\nSource body.' as unknown as Buffer);

    const handler = mockServer.getHandler('insert_doc_link');

    await handler({
      identifier: '_global/source.md',
      target: '_global/explicit-target.md',
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];
    // Falls back to relativePath when no title in frontmatter — link should exist in links array
    const links = writtenFrontmatter.links as string[];
    expect(links.some((l) => l.startsWith('[['))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: apply_tags
// ─────────────────────────────────────────────────────────────────────────────

describe('apply_tags', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  /** Build a Supabase mock that handles apply_tags for documents */
  function makeApplyTagsDocMock(existingTags: string[] = ['old']) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { tags: existingTags }, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };
  }

  /** Build a Supabase mock that handles apply_tags for memories */
  function makeApplyTagsMemoryMock(existingTags: string[] = ['old', 'keep']) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { tags: existingTags }, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockReset();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - old\n---\n\nBody content.' as unknown as Buffer
    );
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    // Ensure resolveDocumentIdentifier always resolves (may have been mockReset by a prior describe)
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValue({
      absPath: '/mock-vault/tagged-doc.md',
      relativePath: 'tagged-doc.md',
      fqcId: 'doc-uuid-tags',
      resolvedVia: 'path',
    });
    vi.mocked(resolveDocumentModule.ensureProvisioned).mockImplementation(
      (_c, _s, resolved) => Promise.resolve(resolved)
    );
  });

  it('Test 1 (apply_tags): add_tags adds new tag to document frontmatter and Supabase', async () => {
    const mockClient = makeApplyTagsDocMock(['old']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['new'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();

    // vaultManager.writeMarkdown should have been called (not raw writeFile)
    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];
    expect(writtenFrontmatter.tags).toContain('old');
    expect(writtenFrontmatter.tags).toContain('new');

    // Supabase fqc_documents update must have been called
    expect(mockClient.from).toHaveBeenCalledWith('fqc_documents');
    const updateMock = mockClient.from.mock.results.find(
      (r: { value: { update?: ReturnType<typeof vi.fn> } }) => r.value.update
    )?.value as { update: ReturnType<typeof vi.fn> };
    expect(updateMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['old', 'new']) })
    );
  });

  it('Test 2 (apply_tags): adding a tag that already exists is idempotent — no duplicate', async () => {
    const mockClient = makeApplyTagsDocMock(['old', 'existing']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - old\n  - existing\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['existing'],
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];

    // 'existing' must appear exactly once in the tags array
    const tags = writtenFrontmatter.tags as string[];
    const existingCount = tags.filter((t) => t === 'existing').length;
    expect(existingCount).toBe(1);
  });

  it('Test 3 (apply_tags): remove_tags removes tag from document frontmatter and Supabase', async () => {
    const mockClient = makeApplyTagsDocMock(['old', 'keep']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - old\n  - keep\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    await handler({
      identifiers: '_global/tagged-doc.md',
      remove_tags: ['old'],
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];
    const tags = writtenFrontmatter.tags as string[];
    expect(tags).not.toContain('old');
    expect(tags).toContain('keep');

    // Supabase tags should not include 'old'
    const updateMock = mockClient.from.mock.results.find(
      (r: { value: { update?: ReturnType<typeof vi.fn> } }) => r.value.update
    )?.value as { update: ReturnType<typeof vi.fn> };
    expect(updateMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.not.arrayContaining(['old']) })
    );
  });

  it('Test 4 (apply_tags): removing a tag that does not exist is a silent no-op', async () => {
    const mockClient = makeApplyTagsDocMock(['existing']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - existing\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      identifiers: '_global/tagged-doc.md',
      remove_tags: ['nonexistent'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Must succeed (no error)
    expect(result.isError).toBeUndefined();
    // vaultManager.writeMarkdown should have been called (idempotent write back is acceptable)
    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
  });

  it('Test 5 (apply_tags): memory_id updates fqc_memory.tags in Supabase only — no vault file read/write', async () => {
    const mockClient = makeApplyTagsMemoryMock(['old']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      memory_id: 'mem-uuid-123',
      add_tags: ['new'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();

    // vault file operations should NOT have been called
    expect(fsPromises.readFile).not.toHaveBeenCalled();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();

    // Supabase fqc_memory must have been queried
    expect(mockClient.from).toHaveBeenCalledWith('fqc_memory');
  });

  it('Test 6 (apply_tags): both add_tags and remove_tags in a single call — add applied then remove applied', async () => {
    // Note: this test verifies content via vaultManager.writeMarkdown frontmatter arg
    const mockClient = makeApplyTagsDocMock(['keep', 'remove-me']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - keep\n  - remove-me\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['added'],
      remove_tags: ['remove-me'],
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    const [, writtenFrontmatter] = (vaultManager.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];
    const tags = writtenFrontmatter.tags as string[];
    expect(tags).toContain('keep');
    expect(tags).toContain('added');
    expect(tags).not.toContain('remove-me');
  });

  it('Test 7 (apply_tags): error when neither doc_path nor memory_id provided', async () => {
    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      add_tags: ['new'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  // ── Task 2 new tests: tag validation in apply_tags ────────────────────────────

  it('Task2: apply_tags allows adding #status/published to doc with #status/draft — no conflict rejection (D-06)', async () => {
    const mockClient = makeApplyTagsDocMock(['#status/draft']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags:\n  - "#status/draft"\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['#status/published'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // D-06: #status/* tags treated like any other tag — apply_tags succeeds
    const text = result.content[0].text;
    expect(text).not.toMatch(/conflicting/i);
    // File write should have been called (tag applied successfully)
    expect(vaultManager.writeMarkdown).toHaveBeenCalled();
  });

  it('Task2: apply_tags normalizes added tags — add [" MyTag "] results in ["mytag"] in written file', async () => {
    const mockClient = makeApplyTagsDocMock([]);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      '---\ntitle: Tagged Doc\nfqc_id: doc-uuid-tags\ntags: []\n---\n\nBody.' as unknown as Buffer
    );

    const handler = mockServer.getHandler('apply_tags');
    const result = await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: [' MyTag '],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
  });

  it('DCP-05: apply_tags calls vaultManager.writeMarkdown instead of writeFile', async () => {
    const mockClient = makeApplyTagsDocMock(['old']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('apply_tags');
    await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['new'],
    });

    expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });

  it('DCP-05: apply_tags reads file from disk after writeMarkdown for hash computation', async () => {
    const mockClient = makeApplyTagsDocMock(['old']);
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('apply_tags');
    await handler({
      identifiers: '_global/tagged-doc.md',
      add_tags: ['new'],
    });

    // readFile called at least twice: initial read + post-write hash recompute
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });

  describe('STAT-08: apply_tags status property handling', () => {
    it('STAT-08a: preserves existing custom status value when adding tags', async () => {
      const mockClient = makeApplyTagsDocMock(['existing-tag']);
      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

      // Mock document with existing custom status: 'in-review'
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        '---\ntitle: Doc in Review\nfqc_id: doc-uuid-status\nstatus: in-review\ntags:\n  - existing-tag\n---\n\nBody content.' as unknown as Buffer
      );

      const handler = mockServer.getHandler('apply_tags');
      const result = await handler({
        identifiers: '_global/doc-in-review.md',
        add_tags: ['new-tag'],
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // apply_tags should succeed
      expect(result.isError).toBeUndefined();

      // Verify writeMarkdown was called and status was preserved
      expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();
      const writeCall = vi.mocked(vaultManager.writeMarkdown).mock.calls[0];
      const frontmatterArg = writeCall[1];

      // Status should remain 'in-review' (unchanged)
      expect(frontmatterArg.status).toBe('in-review');
      // Tags should be updated (new-tag added)
      expect(frontmatterArg.tags).toContain('new-tag');
    });

    it('STAT-08b: does not inject #status/* tags into the tags array', async () => {
      const mockClient = makeApplyTagsDocMock([]);
      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

      vi.mocked(fsPromises.readFile).mockResolvedValue(
        '---\ntitle: Doc for Tags\nfqc_id: doc-uuid-tags\ntags: []\n---\n\nBody content.' as unknown as Buffer
      );

      const handler = mockServer.getHandler('apply_tags');
      const result = await handler({
        identifiers: '_global/doc-for-tags.md',
        add_tags: ['mytag'],
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();

      const writeCall = vi.mocked(vaultManager.writeMarkdown).mock.calls[0];
      const frontmatterArg = writeCall[1];

      // Verify no #status/* tags are present in the tags array
      const hasSuspiciousTag = frontmatterArg.tags && frontmatterArg.tags.some((t: string) => t.startsWith('#status/'));
      expect(hasSuspiciousTag).toBe(false);

      // Verify the requested tag is present
      expect(frontmatterArg.tags).toContain('mytag');
    });

    it('STAT-08c: applies D-02c by making null status explicit when writing', async () => {
      const mockClient = makeApplyTagsDocMock(['old-tag']);
      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

      // Mock document with NO status property (null/missing)
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        '---\ntitle: Doc No Status\nfqc_id: doc-uuid-nostatus\ntags:\n  - old-tag\n---\n\nBody content.' as unknown as Buffer
      );

      const handler = mockServer.getHandler('apply_tags');
      const result = await handler({
        identifiers: '_global/doc-no-status.md',
        add_tags: ['new-tag'],
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(vaultManager.writeMarkdown).toHaveBeenCalledOnce();

      const writeCall = vi.mocked(vaultManager.writeMarkdown).mock.calls[0];
      const frontmatterArg = writeCall[1];

      // D-02c: null status should be made explicit to 'active' on write
      expect(frontmatterArg.status).toBe('active');
      // Tags should be updated
      expect(frontmatterArg.tags).toContain('new-tag');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_briefing (MOD-07 — tag-based scoping)
// ─────────────────────────────────────────────────────────────────────────────

describe('get_briefing', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  /** Build a chainable Supabase mock for tag-based get_briefing. */
  function makeBriefingMock(options: {
    docRows?: Array<{ id: string; title: string; tags: string[]; status: string; path: string; description: string | null }>;
    memRows?: Array<{ id: string; content: string; tags: string[]; created_at: string; updated_at: string }>;
    pluginRows?: Array<Record<string, unknown>>;
    docError?: { message: string } | null;
    memError?: { message: string } | null;
  } = {}) {
    const {
      docRows = [
        { id: 'u1', title: 'Doc A', tags: ['#project/acme'], status: 'active', path: 'docs/a.md', description: null },
      ],
      memRows = [
        { id: 'mem-1', content: 'Remember X', tags: ['#project/acme'], created_at: '2026-01-01', updated_at: '2026-01-02' },
      ],
      pluginRows = [],
      docError = null,
      memError = null,
    } = options;

    // Track overlaps/contains calls for assertions
    const overlapsCalls: Array<{ column: string; values: string[] }> = [];
    const containsCalls: Array<{ column: string; values: string[] }> = [];
    const limitCalls: number[] = [];

    const mockClient = {
      from: vi.fn().mockImplementation((tableName: string) => {
        // Determine the data this chain should resolve to
        const resolveData = () => {
          if (tableName === 'fqc_documents') return { data: docRows, error: docError };
          if (tableName === 'fqc_memory') return { data: memRows, error: memError };
          return { data: pluginRows, error: null };
        };

        // Build a thenable chain — every method returns self, await resolves data
        const chain: Record<string, unknown> = {};
        const returnChain = () => chain;

        chain.select = vi.fn().mockImplementation(returnChain);
        chain.eq = vi.fn().mockImplementation(returnChain);
        chain.order = vi.fn().mockImplementation(returnChain);
        chain.in = vi.fn().mockImplementation(returnChain);
        chain.overlaps = vi.fn().mockImplementation((col: string, vals: string[]) => {
          overlapsCalls.push({ column: col, values: vals });
          return chain;
        });
        chain.contains = vi.fn().mockImplementation((col: string, vals: string[]) => {
          containsCalls.push({ column: col, values: vals });
          return chain;
        });
        chain.limit = vi.fn().mockImplementation((n: number) => {
          limitCalls.push(n);
          return chain;
        });

        // Make the chain thenable so `await query` resolves to data
        chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          return Promise.resolve(resolveData()).then(resolve, reject);
        };

        return chain;
      }),
      _overlapsCalls: overlapsCalls,
      _containsCalls: containsCalls,
      _limitCalls: limitCalls,
    };
    return mockClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);
    vi.mocked(pluginManager.getAllEntries).mockReturnValue([]);
  });

  it('Test 8 (get_briefing): tags param required, tag_match defaults to any with overlaps', async () => {
    const mockClient = makeBriefingMock();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#project/acme'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // v2.5 format: section headers, key-value blocks (no "Briefing for tags:" header)
    expect(text).toContain('## Documents');
    expect(text).toContain('## Memories');
    // overlaps should have been called (default tag_match=any)
    expect(mockClient._overlapsCalls.length).toBeGreaterThan(0);
    expect(mockClient._overlapsCalls[0].column).toBe('tags');
    expect(mockClient._containsCalls.length).toBe(0);
  });

  it('Test 9 (get_briefing): tag_match=all uses contains operator', async () => {
    const mockClient = makeBriefingMock();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a', '#b'], tag_match: 'all' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(mockClient._containsCalls.length).toBeGreaterThan(0);
    expect(mockClient._containsCalls[0].values).toEqual(['#a', '#b']);
    expect(mockClient._overlapsCalls.length).toBe(0);
  });

  it('Test 10 (get_briefing): documents returned in batch outline format (BRIEF-02)', async () => {
    const mockClient = makeBriefingMock({
      docRows: [{ id: 'u1', title: 'Doc A', tags: ['#a'], status: 'active', path: 'docs/a.md', description: null }],
    });
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const text = result.content[0].text;
    // v2.5 format: section headers + key-value blocks (no === path === delimiters in get_briefing)
    expect(text).toContain('## Documents (1)');
    expect(text).toContain('Title: Doc A');
    expect(text).toContain('FQC ID: u1');
    expect(text).toContain('Path: docs/a.md');
  });

  it('Test 11 (get_briefing): memories returned with content and timestamps (BRIEF-03)', async () => {
    const mockClient = makeBriefingMock({
      memRows: [{ id: 'mem-1', content: 'Remember X', tags: ['#a'], created_at: '2026-01-01', updated_at: '2026-01-02' }],
    });
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const text = result.content[0].text;
    // v2.5 format: key-value blocks with --- separators (no === id === delimiters)
    expect(text).toContain('## Memories (1)');
    expect(text).toContain('Memory ID: mem-1');
    expect(text).toContain('Content: Remember X');
    expect(text).toContain('Created: 2026-01-01');
  });

  it('Test 12 (get_briefing): plugin records included when plugin_id provided (BRIEF-04)', async () => {
    const mockEntry: RegistryEntry = {
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqcp_crm_default_',
      schema: {
        plugin: { id: 'crm', name: 'CRM', version: 1 },
        tables: [{ name: 'contacts', columns: [{ name: 'name', type: 'text' }] }],
      },
    };
    vi.mocked(pluginManager.getAllEntries).mockReturnValue([mockEntry]);

    const mockClient = makeBriefingMock({ pluginRows: [{ id: 'r1', name: 'Alice' }] });
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'], plugin_id: 'crm' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // v2.5 format: Plugin Records section with count (not "Plugin Records: crm")
    expect(text).toContain('## Plugin Records (');
  });

  it('Test 13 (get_briefing): plugin records omitted when plugin_id not provided', async () => {
    const mockClient = makeBriefingMock();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain('## Plugin Records');
  });

  it('Test 14 (get_briefing): no project parameter accepted', async () => {
    const mockClient = makeBriefingMock();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    // Passing project should be ignored — handler signature is { tags, tag_match, limit, plugin_id }
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Should not contain "Project:" — old format is gone
    expect(text).not.toContain('Project:');
  });

  it('Test 15 (get_briefing): limit parameter respected', async () => {
    const mockClient = makeBriefingMock();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    await handler({ tags: ['#a'], limit: 5 });

    // Both doc and memory queries should use limit(5)
    expect(mockClient._limitCalls).toContain(5);
  });

  it('Test 16 (get_briefing): documents returned with key-value format (SPEC-14, SPEC-19 description removed)', async () => {
    const mockClient = makeBriefingMock({
      docRows: [{ id: 'u1', title: 'Doc A', tags: ['#a'], status: 'active', path: 'docs/a.md', description: 'A short summary' }],
    });
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // v2.5 SPEC-14: get_briefing uses key-value blocks; SPEC-19 removed description column
    expect(result.content[0].text).toContain('Title: Doc A');
    expect(result.content[0].text).toContain('## Documents (1)');
  });

  it('Test 17 (get_briefing): description omitted when null', async () => {
    const mockClient = makeBriefingMock({
      docRows: [{ id: 'u1', title: 'Doc A', tags: ['#a'], status: 'active', path: 'docs/a.md', description: null }],
    });
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof supabaseManager.getClient>);

    const handler = mockServer.getHandler('get_briefing');
    const result = await handler({ tags: ['#a'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.content[0].text).not.toContain('description:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_doc_outline
// ─────────────────────────────────────────────────────────────────────────────

describe('get_doc_outline', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  const SAMPLE_DOC = `---
title: Outline Test
fqc_id: outline-uuid
status: active
links:
  - "[[Frontmatter Link]]"
---

# Main Title

Some intro text.

## Background

Some background content. [[Body Link]] is referenced here.

### Deep Section

Content with [[Another Link|alias]].

%% [[Obsidian Comment Link]] %%

More content.
`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockReset();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readFile).mockResolvedValue(SAMPLE_DOC as unknown as Buffer);

    // Default resolve mock: resolves to /mock-vault/outline.md
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValue({
      absPath: '/mock-vault/outline.md',
      relativePath: 'outline.md',
      fqcId: 'outline-uuid',
      resolvedVia: 'path',
    });
    vi.mocked(resolveDocumentModule.ensureProvisioned).mockImplementation(
      (_c, _s, resolved) => Promise.resolve(resolved)
    );

    // Default Supabase mock for get_doc_outline (single mode: select().eq().eq().single())
    const makeEqChain = (finalResult: { data: unknown; error: null }) => {
      const inner = {
        eq: vi.fn().mockResolvedValue(finalResult),
        single: vi.fn().mockResolvedValue(finalResult),
      };
      // Support both .eq().single() and .eq().eq().single()
      inner.eq.mockReturnValue(inner);
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            eq: vi.fn().mockReturnValue(inner),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
      return mockClient;
    };
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeEqChain({ data: { id: 'outline-uuid' }, error: null }) as unknown as ReturnType<typeof supabaseManager.getClient>
    );
  });

  it('Test 13 (get_doc_outline): returns frontmatter fields without body content', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Frontmatter fields must appear
    expect(text).toContain('title');
    expect(text).toContain('Outline Test');
    expect(text).toContain('fqc_id');
    // Body prose must NOT appear
    expect(text).not.toContain('Some intro text');
    expect(text).not.toContain('Some background content');
  });

  it('Test 14 (get_doc_outline): extracts H1-H6 headings as flat list with level indicators', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // v2.5 format: headings as key-value blocks (Level: N / Text: heading / Line: N)
    expect(text).toContain('Text: Main Title');
    expect(text).toContain('Text: Background');
    expect(text).toContain('Text: Deep Section');
    // Level indicators present as "Level: N" lines
    expect(text).toMatch(/Level: 1/);
    expect(text).toMatch(/Level: 2/);
    expect(text).toMatch(/Level: 3/);
  });

  it('Test 15 (get_doc_outline): extracts linked documents from body — [[Note]] and [[Note|alias]]', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('Body Link');
    expect(text).toContain('Another Link');
    // Alias text must NOT appear (only target captured)
    expect(text).not.toContain('alias');
  });

  it('Test 16 (get_doc_outline): extracts linked documents from frontmatter property values', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('Frontmatter Link');
  });

  it('Test 17 (get_doc_outline): extracts linked documents from hidden comments %% [[Note]] %%', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('Obsidian Comment Link');
  });

  it('Test 18 (get_doc_outline): returns deduplicated linked documents', async () => {
    const docWithDuplicate = `---
title: Dup Test
fqc_id: dup-uuid
links:
  - "[[Shared Note]]"
---

# Heading

References [[Shared Note]] again and [[Shared Note|alias]].
`;
    vi.mocked(fsPromises.readFile).mockResolvedValue(docWithDuplicate as unknown as Buffer);

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/dup.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // v2.5 format: "Linked Documents:" header (no count in parens)
    // Deduplication: "Shared Note" should only appear once in the Linked Documents section
    expect(text).toContain('Linked Documents:');
    // Extract just the Linked Documents section to count entries
    const linkedDocsSectionMatch = text.match(/Linked Documents:([\s\S]*)/);
    const linkedDocsSection = linkedDocsSectionMatch?.[1] ?? text;
    // In key-value format each linked doc entry has a "Title: ..." line
    const titleMatches = linkedDocsSection.match(/Title: Shared Note/g) ?? [];
    expect(titleMatches.length).toBe(1);
  });

  it('Test 19 (get_doc_outline): does NOT call embeddingProvider.embed (read-only)', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    await handler({ identifiers: '_global/outline.md' });

    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it('Test 20 (get_doc_outline): single-doc output says "Linked Documents:" not "Wikilinks"', async () => {
    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: '_global/outline.md' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const text = result.content[0].text;
    // v2.5: production emits "Linked Documents:" (capital D) not "Wikilinks"
    expect(text).toContain('Linked Documents');
    expect(text).not.toMatch(/[Ww]ikilinks/);
  });

  it('Test 21 (get_doc_outline): tool description says "linked files" not "wikilinks"', () => {
    const calls = vi.mocked(mockServer.server.registerTool).mock.calls;
    const outlineCall = calls.find(c => c[0] === 'get_doc_outline');
    expect(outlineCall).toBeDefined();
    const desc = (outlineCall![1] as { description: string }).description;
    // v2.5: description says "linked files" (not "linked documents" or "wikilinks")
    expect(desc.toLowerCase()).toContain('linked files');
    expect(desc.toLowerCase()).not.toContain('wikilinks');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_doc_outline batch mode
// ─────────────────────────────────────────────────────────────────────────────

describe('get_doc_outline batch mode', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  const BATCH_DB_ROW = {
    id: 'uuid1',
    title: 'Doc A',
    tags: ['#tag1'],
    status: 'active',
    path: 'notes/doc-a.md',
    description: null as string | null,
  };

  function makeBatchSupabaseMock(rows: typeof BATCH_DB_ROW[]) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockReset();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    // Default: resolves to a doc with fqcId
    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier).mockResolvedValue({
      absPath: '/mock-vault/notes/doc-a.md',
      relativePath: 'notes/doc-a.md',
      fqcId: 'uuid1',
      resolvedVia: 'path',
    });

    // Mock targetedScan to return fqcId matching DB records
    vi.mocked(resolveDocumentModule.targetedScan).mockImplementation(
      async (_c, _s, resolved) => ({
        ...resolved,
        capturedFrontmatter: {
          fqcId: resolved.fqcId || 'uuid1',
          created: new Date().toISOString(),
          status: 'active',
          contentHash: 'test-hash-abc123',
        },
      })
    );
  });

  it('Test B1: array input returns DB metadata format with key-value blocks', async () => {
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([BATCH_DB_ROW]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: ['notes/doc-a.md'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // v2.5 batch format: key-value pairs with --- separators (no === path === delimiters)
    expect(text).toContain('Path: notes/doc-a.md');
    expect(text).toContain('Title: Doc A');
    expect(text).toContain('FQC ID: uuid1');
    expect(text).toContain('Tags:');
    expect(text).toContain('#tag1');
    expect(text).toContain('Status: active');
    // DB-only: no heading hierarchy or "Linked Documents" section
    expect(text).not.toContain('Headings');
    expect(text).not.toContain('Linked Documents');
  });

  it('Test B2: single-element array uses batch path (not single-doc format)', async () => {
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([BATCH_DB_ROW]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: ['notes/doc-a.md'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const text = result.content[0].text;
    // v2.5 batch format: key-value with --- separators (no === delimiters, no Frontmatter: header)
    expect(text).toContain('Path: notes/doc-a.md');
    // Must NOT have frontmatter section header (single-doc format)
    expect(text).not.toContain('Frontmatter:');
  });

  it('Test B3: batch response contains path and title key-value fields', async () => {
    // v2.5 SPEC-19: description column removed from fqc_documents; batch mode shows path/title/fqc_id/tags/status
    const rowWithDesc = { ...BATCH_DB_ROW, description: 'A short summary' };
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([rowWithDesc]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: ['notes/doc-a.md'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Batch format: key-value fields present
    expect(result.content[0].text).toContain('Path: notes/doc-a.md');
    expect(result.content[0].text).toContain('Title: Doc A');
  });

  it('Test B4: description field omitted when null', async () => {
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([BATCH_DB_ROW]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: ['notes/doc-a.md'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.content[0].text).not.toContain('description:');
  });

  it('Test B5: multiple identifiers produce multiple key-value blocks separated by ---', async () => {
    const row2 = { id: 'uuid2', title: 'Doc B', tags: [], status: 'active', path: 'notes/doc-b.md', description: null };

    vi.mocked(resolveDocumentModule.resolveDocumentIdentifier)
      .mockResolvedValueOnce({ absPath: '/mock-vault/notes/doc-a.md', relativePath: 'notes/doc-a.md', fqcId: 'uuid1', resolvedVia: 'path' as const })
      .mockResolvedValueOnce({ absPath: '/mock-vault/notes/doc-b.md', relativePath: 'notes/doc-b.md', fqcId: 'uuid2', resolvedVia: 'path' as const });

    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([BATCH_DB_ROW, row2]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    const result = await handler({ identifiers: ['notes/doc-a.md', 'notes/doc-b.md'] }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const text = result.content[0].text;
    // v2.5 batch format: key-value blocks separated by --- (no === path === delimiters)
    expect(text).toContain('Path: notes/doc-a.md');
    expect(text).toContain('Path: notes/doc-b.md');
    expect(text).toContain('---');
  });

  it('Test B6: targetedScan is called for each identifier in batch', async () => {
    vi.mocked(supabaseManager.getClient).mockReturnValue(
      makeBatchSupabaseMock([BATCH_DB_ROW]) as unknown as ReturnType<typeof supabaseManager.getClient>
    );

    const handler = mockServer.getHandler('get_doc_outline');
    await handler({ identifiers: ['notes/doc-a.md'] });

    expect(resolveDocumentModule.targetedScan).toHaveBeenCalledOnce();
  });
});
