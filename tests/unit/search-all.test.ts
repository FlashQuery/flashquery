import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { DocMeta } from '../../src/mcp/tools/documents.js';

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

// Default: embedding provider is real (not NullEmbeddingProvider)
vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
  NullEmbeddingProvider: class NullEmbeddingProvider {},
}));

vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-sha256-hash'),
  })),
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getAllEntries: vi.fn(() => []),
  },
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: vi.fn().mockResolvedValue({
    absPath: '/mock-vault/test.md',
    relativePath: 'test.md',
    fqcId: 'mock-fqc-uuid',
    resolvedVia: 'path',
  }),
  ensureProvisioned: vi.fn().mockImplementation(
    (_c: unknown, _s: unknown, resolved: { absPath: string; relativePath: string; fqcId: string | null; resolvedVia: string }) =>
      Promise.resolve(resolved)
  ),
}));

// Mock the document and memory helper modules used by compound.ts
vi.mock('../../src/mcp/tools/documents.js', () => ({
  searchDocumentsSemantic: vi.fn().mockResolvedValue([]),
  listMarkdownFiles: vi.fn().mockResolvedValue([]),
  parseDocMeta: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/mcp/tools/memory.js', () => ({
  searchMemoriesSemantic: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/utils/tag-validator.js', () => ({
  validateAllTags: vi.fn().mockReturnValue({ valid: true, errors: [], conflicts: [], normalized: [] }),
  normalizeTags: vi.fn().mockImplementation((tags: string[]) => tags),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked modules and module under test
// ─────────────────────────────────────────────────────────────────────────────

import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import * as documentsModule from '../../src/mcp/tools/documents.js';
import * as memoryModule from '../../src/mcp/tools/memory.js';
import * as embeddingModule from '../../src/embedding/provider.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => handlers[name],
  };
}

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

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: search_all
// ─────────────────────────────────────────────────────────────────────────────

describe('search_all', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let config: FlashQueryConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockServer();
    config = makeConfig();
    registerCompoundTools(mockServer.server, config);

    // Default: embedding provider is a real provider (not NullEmbeddingProvider)
    vi.spyOn(embeddingModule, 'embeddingProvider', 'get').mockReturnValue({
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as typeof embeddingModule.embeddingProvider);
  });

  it('search_all is registered as a tool', () => {
    const handler = mockServer.getHandler('search_all');
    expect(handler).toBeDefined();
    // Verify it was registered (registerTool was called with 'search_all')
    const calls = vi.mocked(mockServer.server.registerTool).mock.calls;
    const searchAllCall = calls.find(([name]) => name === 'search_all');
    expect(searchAllCall).toBeDefined();
    const schema = searchAllCall![1] as { inputSchema: Record<string, unknown> };
    expect(schema.inputSchema).toHaveProperty('query');
    expect(schema.inputSchema).toHaveProperty('tags');
    expect(schema.inputSchema).toHaveProperty('tag_match');
    expect(schema.inputSchema).toHaveProperty('limit');
    expect(schema.inputSchema).toHaveProperty('entity_types');
  });

  it('returns documents and memories sections with correct delimiters (SEARCHALL-02, D-03)', async () => {
    vi.mocked(documentsModule.searchDocumentsSemantic).mockResolvedValue([
      { id: 'doc-1', path: 'notes/doc1.md', title: 'Doc One', tags: ['#project'], similarity: 0.92, created_at: '2026-01-01T00:00:00Z' },
      { id: 'doc-2', path: 'notes/doc2.md', title: 'Doc Two', tags: [], similarity: 0.85, created_at: '2026-01-02T00:00:00Z' },
    ]);
    vi.mocked(memoryModule.searchMemoriesSemantic).mockResolvedValue([
      { id: 'mem-1', content: 'Memory content here', tags: ['#project'], similarity: 0.88, created_at: '2026-01-01T00:00:00Z' },
    ]);

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test' });
    const text = getText(result);

    // v2.5 format: section headers with counts (no === === delimiters)
    expect(text).toContain('## Documents (2)');
    expect(text).toContain('## Memories (1)');
    expect(isError(result)).toBe(false);
  });

  it('delegates to searchDocumentsSemantic and searchMemoriesSemantic (SEARCHALL-03)', async () => {
    const handler = mockServer.getHandler('search_all');
    await handler({ query: 'my query' });

    expect(documentsModule.searchDocumentsSemantic).toHaveBeenCalledWith(
      config,
      'my query',
      expect.objectContaining({ tagMatch: 'any', limit: 10 })
    );
    expect(memoryModule.searchMemoriesSemantic).toHaveBeenCalledWith(
      config,
      'my query',
      expect.objectContaining({ tagMatch: 'any', limit: 10 })
    );
  });

  it('entity_types=["documents"] only searches documents', async () => {
    vi.mocked(documentsModule.searchDocumentsSemantic).mockResolvedValue([]);
    vi.mocked(memoryModule.searchMemoriesSemantic).mockResolvedValue([]);

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test', entity_types: ['documents'] });
    const text = getText(result);

    expect(documentsModule.searchDocumentsSemantic).toHaveBeenCalled();
    expect(memoryModule.searchMemoriesSemantic).not.toHaveBeenCalled();
    expect(text).not.toContain('## Memories');
  });

  it('entity_types=["memories"] only searches memories', async () => {
    vi.mocked(memoryModule.searchMemoriesSemantic).mockResolvedValue([]);

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test', entity_types: ['memories'] });
    const text = getText(result);

    expect(memoryModule.searchMemoriesSemantic).toHaveBeenCalled();
    expect(documentsModule.searchDocumentsSemantic).not.toHaveBeenCalled();
    expect(text).not.toContain('## Documents');
  });

  it('falls back to filesystem search when embeddings unavailable (D-04)', async () => {
    // Mock embeddingProvider as NullEmbeddingProvider instance
    const NullProvider = embeddingModule.NullEmbeddingProvider;
    const nullInstance = new NullProvider();
    vi.spyOn(embeddingModule, 'embeddingProvider', 'get').mockReturnValue(
      nullInstance as unknown as typeof embeddingModule.embeddingProvider
    );

    vi.mocked(documentsModule.listMarkdownFiles).mockResolvedValue(['notes/test-doc.md']);
    const mockMeta: DocMeta = {
      relativePath: 'notes/test-doc.md',
      title: 'Test Doc',
      tags: [],
      project: '_global',
      status: 'active',
      fqcId: 'abc-123',
      modified: '2026-01-01T00:00:00Z',
    };
    vi.mocked(documentsModule.parseDocMeta).mockResolvedValue(mockMeta);

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test' });
    const text = getText(result);

    // v2.5: filesystem fallback emits ## Documents section with results (no "filesystem search" label)
    expect(text).toContain('## Documents (1)');
    expect(text).toContain('Title: Test Doc');
    expect(isError(result)).toBe(false);
  });

  it('memories-only with no embeddings returns isError: true (D-05)', async () => {
    const NullProvider = embeddingModule.NullEmbeddingProvider;
    const nullInstance = new NullProvider();
    vi.spyOn(embeddingModule, 'embeddingProvider', 'get').mockReturnValue(
      nullInstance as unknown as typeof embeddingModule.embeddingProvider
    );

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test', entity_types: ['memories'] });

    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toContain('Memory search requires semantic embeddings');
  });

  it('mixed query with no embeddings omits memories section without isError (D-05)', async () => {
    const NullProvider = embeddingModule.NullEmbeddingProvider;
    const nullInstance = new NullProvider();
    vi.spyOn(embeddingModule, 'embeddingProvider', 'get').mockReturnValue(
      nullInstance as unknown as typeof embeddingModule.embeddingProvider
    );

    vi.mocked(documentsModule.listMarkdownFiles).mockResolvedValue([]);

    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'test' }); // default: both documents and memories

    const text = getText(result);
    // v2.5: no "filesystem search" label; memory section shows graceful degradation message
    expect(text).toContain('## Documents (0)');
    expect(text).toContain('## Memories (0)');
    expect(text).toContain('Memory search requires embedding configuration');
    expect(isError(result)).toBe(false);
  });

  it('passes tags and tag_match to helpers', async () => {
    vi.mocked(documentsModule.searchDocumentsSemantic).mockResolvedValue([]);
    vi.mocked(memoryModule.searchMemoriesSemantic).mockResolvedValue([]);

    const handler = mockServer.getHandler('search_all');
    await handler({ query: 'test', tags: ['#project'], tag_match: 'all' });

    expect(documentsModule.searchDocumentsSemantic).toHaveBeenCalledWith(
      config,
      'test',
      expect.objectContaining({ tags: ['#project'], tagMatch: 'all' })
    );
    expect(memoryModule.searchMemoriesSemantic).toHaveBeenCalledWith(
      config,
      'test',
      expect.objectContaining({ tags: ['#project'], tagMatch: 'all' })
    );
  });

  it('respects custom limit per entity type', async () => {
    vi.mocked(documentsModule.searchDocumentsSemantic).mockResolvedValue([]);
    vi.mocked(memoryModule.searchMemoriesSemantic).mockResolvedValue([]);

    const handler = mockServer.getHandler('search_all');
    await handler({ query: 'test', limit: 5 });

    expect(documentsModule.searchDocumentsSemantic).toHaveBeenCalledWith(
      config,
      'test',
      expect.objectContaining({ limit: 5 })
    );
    expect(memoryModule.searchMemoriesSemantic).toHaveBeenCalledWith(
      config,
      'test',
      expect.objectContaining({ limit: 5 })
    );
  });
});
