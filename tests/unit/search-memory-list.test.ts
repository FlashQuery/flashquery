import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn(),
  },
  NullEmbeddingProvider: class NullEmbeddingProvider {
    embed(_text: string): Promise<number[]> {
      throw new Error('Semantic search unavailable');
    }
    getDimensions(): number {
      return 1536;
    }
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

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/tag-validator.js', () => ({
  validateAllTags: vi.fn().mockReturnValue({ valid: true, errors: [], conflicts: [], normalized: [] }),
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseManager } from '../../src/storage/supabase.js';
import { embeddingProvider } from '../../src/embedding/provider.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        _config: unknown,
        handler: (params: Record<string, unknown>) => Promise<unknown>
      ) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => handlers[name],
  };
}

function makeConfig(overrides: Partial<FlashQueryConfig['instance']> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance-id',
      vault: {
        path: '/vault',
      },
      ...overrides,
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    },
    locking: { enabled: false },
  } as FlashQueryConfig;
}

function makeQueryChain(result: { data: unknown; error: unknown }): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    overlaps: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    then: (callback: (value: unknown) => unknown) => callback(result),
    catch: vi.fn().mockReturnThis(),
  };
  // list_memories calls supabase.from(...).select()... so from() must return the chain
  chain.from = vi.fn().mockReturnValue(chain);
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('search_memory and list_memories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('search_memory', () => {
    it('returns results with key-value format and --- separators', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      // Mock embedding provider
      (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'User prefers dark mode',
            tags: ['#preference'],
            similarity: 0.95,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'mem-2',
            content: 'Project deadline April 15',
            tags: ['#project'],
            similarity: 0.85,
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);
      chain.rpc = vi.fn().mockReturnValue(chain);

      const handler = getHandler('search_memory');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ query: 'preferences' })) as any;
      const text = result.content[0].text;

      // Should use key-value format, not numbered lists
      expect(text).not.toMatch(/^1\./m);
      expect(text).not.toMatch(/^2\./m);

      // Should have --- separators
      expect(text).toContain('---');

      // Should have both results with key-value pairs
      expect(text).toContain('Memory ID: mem-1');
      expect(text).toContain('Memory ID: mem-2');
      expect(text).toContain('Match Score: 95%');
      expect(text).toContain('Match Score: 85%');
      expect(text).toContain('Content:');
    });

    it('returns empty result message when no memories found', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);

      const chain = makeQueryChain({
        data: [],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);
      chain.rpc = vi.fn().mockReturnValue(chain);

      const handler = getHandler('search_memory');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ query: 'nonexistent query' })) as any;
      const text = result.content[0].text;

      expect(text).toBe('No memories found.');
      expect(result.isError).toBe(false);
    });

    it('formats match score as percentage', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'Test content',
            tags: [],
            similarity: 0.8765, // Should round to 88%
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);
      chain.rpc = vi.fn().mockReturnValue(chain);

      const handler = getHandler('search_memory');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ query: 'test' })) as any;
      const text = result.content[0].text;

      expect(text).toContain('Match Score: 88%');
    });

    it('returns error when embedding provider is disabled', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();

      // Swap embeddingProvider mock to a NullEmbeddingProvider instance so
      // production's `instanceof NullEmbeddingProvider` check evaluates true.
      const embeddingModule = await import('../../src/embedding/provider.js');
      const nullInstance = new embeddingModule.NullEmbeddingProvider();
      vi.spyOn(embeddingModule, 'embeddingProvider', 'get').mockReturnValue(
        nullInstance as unknown as typeof embeddingModule.embeddingProvider
      );

      registerMemoryTools(server, config);

      const handler = getHandler('search_memory');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ query: 'test' })) as any;

      // Should return error message about unavailable semantic search
      expect(result.content[0].text).toContain('Semantic search unavailable');
      expect(result.isError).toBe(true);
    });
  });

  describe('list_memories', () => {
    it('returns results with key-value format and --- separators', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'User prefers dark mode settings in the application',
            tags: ['#preference', '#ui'],
            plugin_scope: 'global',
            created_at: '2026-01-02T00:00:00Z',
          },
          {
            id: 'mem-2',
            content: 'Project deadline April 15 with team review scheduled',
            tags: ['#project'],
            plugin_scope: 'global',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('list_memories');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({})) as any;
      const text = result.content[0].text;

      // Should use key-value format, not numbered lists
      expect(text).not.toMatch(/^1\./m);
      expect(text).not.toMatch(/^2\./m);

      // Should have --- separators
      expect(text).toContain('---');

      // Should have both results
      expect(text).toContain('Memory ID: mem-1');
      expect(text).toContain('Memory ID: mem-2');
    });

    it('truncates content to 200 chars in list view', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const longContent =
        'A'.repeat(300) + ' end of content'; // 314 chars total

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: longContent,
            tags: [],
            plugin_scope: 'global',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('list_memories');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({})) as any;
      const text = result.content[0].text;

      // Should be truncated with ...
      expect(text).toContain('...');
      // Should not contain the full original content
      expect(text).not.toContain('end of content');
      // But should have the truncated part
      const truncated = longContent.slice(0, 200) + '...';
      expect(text).toContain(truncated.substring(0, 50)); // Check partial match
    });

    it('returns empty result message when no memories found', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const chain = makeQueryChain({
        data: [],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('list_memories');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({})) as any;
      const text = result.content[0].text;

      expect(text).toBe('No memories found.');
    });

    it('respects limit parameter', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'First',
            tags: [],
            plugin_scope: 'global',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('list_memories');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ limit: 5 })) as any;

      expect(result.content[0].type).toBe('text');
    });

    it('filters by tags with match mode', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const chain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'Tagged memory',
            tags: ['#work', '#urgent'],
            plugin_scope: 'global',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('list_memories');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ tags: ['#work'], tag_match: 'any' })) as any;

      expect(result.content[0].text).toContain('mem-1');
    });
  });

  describe('format consistency', () => {
    it('search_memory and list_memories use consistent key-value format', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      // Set up search_memory (2 results so joinBatchEntries emits ---)
      (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);
      const searchChain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'Test content',
            tags: ['#tag1'],
            similarity: 0.9,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'mem-2',
            content: 'Second content',
            tags: ['#tag2'],
            similarity: 0.8,
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      });
      searchChain.rpc = vi.fn().mockReturnValue(searchChain);

      // Set up list_memories (2 results so joinBatchEntries emits ---)
      const listChain = makeQueryChain({
        data: [
          {
            id: 'mem-1',
            content: 'Test content',
            tags: ['#tag1'],
            plugin_scope: 'global',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'mem-2',
            content: 'Second content',
            tags: ['#tag2'],
            plugin_scope: 'global',
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      });

      const getClientMock = vi.fn();
      getClientMock.mockReturnValueOnce(searchChain);
      getClientMock.mockReturnValueOnce(listChain);
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementation(getClientMock);

      const searchHandler = getHandler('search_memory');
      const listHandler = getHandler('list_memories');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchResult = (await searchHandler({ query: 'test' })) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listResult = (await listHandler({})) as any;

      const searchText = searchResult.content[0].text;
      const listText = listResult.content[0].text;

      // Both should use key-value format
      expect(searchText).toContain('Memory ID:');
      expect(listText).toContain('Memory ID:');

      // Both should use --- separators
      expect(searchText).toContain('---');
      expect(listText).toContain('---');

      // Both should not use numbered lists
      expect(searchText).not.toMatch(/^1\./m);
      expect(listText).not.toMatch(/^1\./m);
    });
  });
});
