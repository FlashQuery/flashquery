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
    getDimensions(): number { return 1536; }
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

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseManager } from '../../src/storage/supabase.js';
import { embeddingProvider, NullEmbeddingProvider } from '../../src/embedding/provider.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
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
function makeConfig(overrides: Partial<FlashQueryConfig['instance']> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance-id',
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
    logging: {
      level: 'info',
      output: 'stdout',
    },
    locking: { enabled: false, ttlSeconds: 30 },
    defaults: {
      project: 'DefaultProject',
    },
    projects: {
      areas: [],
    },
  } as unknown as FlashQueryConfig;
}

/** Creates a chainable supabase-js query mock. */
function makeChainableMock(finalResult: { data: unknown; error: unknown } | null) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'insert', 'select', 'single', 'eq', 'order', 'limit', 'contains', 'overlaps'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // The final resolution: single() or direct await resolves to finalResult
  if (finalResult !== null) {
    (chain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult);
    // Make the chain itself thenable for direct awaits (e.g., on query)
    (chain as Record<string, unknown> & { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(finalResult);
  }
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: save_memory
// ─────────────────────────────────────────────────────────────────────────────

describe('save_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts correct row with content and tags, returns id in response text (no project)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockVector = [0.1, 0.2, 0.3];
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(mockVector);

    const mockChain = makeChainableMock(null);
    (mockChain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'abc-123' },
      error: null,
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'abc-123' }, error: null }),
          }),
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({ content: 'User prefers dark mode', tags: ['ui', 'preferences'] }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('abc-123');
    // Response should contain tags, not project
    expect(result.content[0].text).toContain('ui');
    expect(result.content[0].text).not.toContain('project');
  });

  it('saves memory with no project — scoped by instance_id only', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'xyz-456' }, error: null }),
          }),
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({ content: 'User prefers dark mode' }) as {
      content: Array<{ type: string; text: string }>;
    };

    // Response should include id and not reference any project
    expect(result.content[0].text).toContain('xyz-456');
    expect(result.content[0].text).not.toContain('DefaultProject');
  });

  it('embeds content via embeddingProvider.embed fire-and-forget (embedding initially null, then updated)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockVector = [0.1, 0.2, 0.3];
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(mockVector);

    let capturedInsertRow: Record<string, unknown> = {};
    let capturedUpdateRow: Record<string, unknown> = {};
    const mockUpdateSingle = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'fqc_memory') {
          return {
            insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              capturedInsertRow = row;
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
                }),
              };
            }),
            update: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              capturedUpdateRow = row;
              return mockUpdateSingle;
            }),
          };
        }
        return {};
      }),
    });

    const handler = getHandler('save_memory');
    await handler({ content: 'Remember this' });

    // Verify initial insert has embedding: null (fire-and-forget pattern)
    expect(capturedInsertRow.embedding).toBe(null);

    // Wait a tick for the fire-and-forget embed to process
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify embeddingProvider.embed was called asynchronously
    expect(embeddingProvider.embed).toHaveBeenCalledWith('Remember this');
    // Verify the update happened with the stringified vector
    expect(capturedUpdateRow.embedding).toBe(JSON.stringify(mockVector));
  });

  it('returns isError: true when supabase insert fails', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
          }),
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Something' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
  });

  // ── Task 1 new tests: source_context removed from save_memory ──────────────

  it('Task1: save_memory inputSchema does NOT include source_context field', () => {
    const config = makeConfig();
    const { server } = createMockServer();
    registerMemoryTools(server, config);

    const registerCalls = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls as Array<[string, { inputSchema: Record<string, unknown> }, unknown]>;
    const saveMemoryCall = registerCalls.find(([name]) => name === 'save_memory');
    expect(saveMemoryCall).toBeDefined();
    const inputSchema = saveMemoryCall![1].inputSchema;
    expect(inputSchema).not.toHaveProperty('source_context');
  });

  it('Task1: save_memory insert does NOT include source_context column', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    let capturedInsertRow: Record<string, unknown> = {};
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
            }),
          };
        }),
      }),
    });

    const handler = getHandler('save_memory');
    await handler({ content: 'Test content' });

    expect(capturedInsertRow).not.toHaveProperty('source_context');
  });

  it('Task1: save_memory insert includes plugin_scope with default global', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    let capturedInsertRow: Record<string, unknown> = {};
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
            }),
          };
        }),
      }),
    });

    const handler = getHandler('save_memory');
    await handler({ content: 'Test content' });

    expect(capturedInsertRow.plugin_scope).toBe('global');
  });

  // ── Task 2 new tests: plugin_scope fuzzy matching ──────────────────────────

  it('Task2: save_memory with plugin_scope="CRM" calls find_plugin_scope RPC', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockResolvedValue({ data: 'fqc-crm', error: null });
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: mockInsertSingle }),
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    await handler({ content: 'Test CRM memory', plugin_scope: 'CRM' });

    expect(mockRpc).toHaveBeenCalledWith('find_plugin_scope', {
      search_name: 'CRM',
      p_instance_id: 'test-instance-id',
      threshold: 0.8,
    });
  });

  it('Task2: save_memory with plugin_scope="CRM" and RPC returns "fqc-crm" — inserts fqc-crm and response includes auto-corrected text', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockResolvedValue({ data: 'fqc-crm', error: null });
    let capturedInsertRow: Record<string, unknown> = {};
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return { select: vi.fn().mockReturnValue({ single: mockInsertSingle }) };
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Test CRM memory', plugin_scope: 'CRM' }) as {
      content: Array<{ text: string }>;
    };

    expect(capturedInsertRow.plugin_scope).toBe('fqc-crm');
    expect(result.content[0].text).toContain('auto-corrected');
    expect(result.content[0].text).toContain('fqc-crm');
  });

  it('Task2: save_memory with plugin_scope="xyz" and RPC returns "global" — inserts global, response contains warning', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockResolvedValue({ data: 'global', error: null });
    let capturedInsertRow: Record<string, unknown> = {};
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return { select: vi.fn().mockReturnValue({ single: mockInsertSingle }) };
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Test memory', plugin_scope: 'xyz' }) as {
      content: Array<{ text: string }>;
    };

    expect(capturedInsertRow.plugin_scope).toBe('global');
    expect(result.content[0].text).toContain('not found');
  });

  it('Task2: save_memory without plugin_scope — no RPC call, inserts global', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn();
    let capturedInsertRow: Record<string, unknown> = {};
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return { select: vi.fn().mockReturnValue({ single: mockInsertSingle }) };
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    await handler({ content: 'Test memory' });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(capturedInsertRow.plugin_scope).toBe('global');
  });

  it('Task2: save_memory with plugin_scope="global" — no RPC call, inserts global directly', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn();
    let capturedInsertRow: Record<string, unknown> = {};
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return { select: vi.fn().mockReturnValue({ single: mockInsertSingle }) };
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    await handler({ content: 'Test memory', plugin_scope: 'global' });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(capturedInsertRow.plugin_scope).toBe('global');
  });

  it('Task2: save_memory when find_plugin_scope RPC errors — defaults to global, save succeeds', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockRejectedValue(new Error('RPC timeout'));
    let capturedInsertRow: Record<string, unknown> = {};
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-id' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return { select: vi.fn().mockReturnValue({ single: mockInsertSingle }) };
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Test memory', plugin_scope: 'crm' }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    // Should NOT fail — graceful fallback
    expect(result.isError).toBeUndefined();
    expect(capturedInsertRow.plugin_scope).toBe('global');
  });

  // ── Task 1 new tests: tag validation in save_memory ───────────────────────────

  it('Task1: save_memory with duplicate tags returns isError', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    // No Supabase/embedding mock needed — should fail before any DB call
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
          }),
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({
      content: 'Some memory',
      tags: ['mytag', 'mytag'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tag validation failed');
    expect(result.content[0].text).toContain("Tag 'mytag' appears multiple times");
  });

  it('Task1: save_memory normalizes tags silently (trim + lowercase)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    let capturedInsertRow: Record<string, unknown> = {};
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
            }),
          };
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({
      content: 'Some memory',
      tags: [' MyTag '],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect((capturedInsertRow.tags as string[])).toContain('mytag');
    expect((capturedInsertRow.tags as string[])).not.toContain(' MyTag ');
    expect((capturedInsertRow.tags as string[])).not.toContain('MyTag');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: search_memory
// ─────────────────────────────────────────────────────────────────────────────

describe('search_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls embeddingProvider.embed with query and calls supabase.rpc with correct args', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const queryVector = [0.5, 0.6, 0.7];
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(queryVector);

    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        { id: 'mem-1', content: 'User prefers dark mode', project: 'Personal', tags: [], similarity: 0.92, created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: mockRpc });

    const handler = getHandler('search_memory');
    const result = await handler({ query: 'color preferences' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(embeddingProvider.embed).toHaveBeenCalledWith('color preferences');
    expect(mockRpc).toHaveBeenCalledWith('match_memories', expect.objectContaining({
      query_embedding: JSON.stringify(queryVector),
      filter_instance_id: 'test-instance-id',
    }));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('dark mode');
    expect(result.content[0].text).toContain('92%');
  });

  it('does NOT pass filter_project to RPC (dead param removed, D-07)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: mockRpc });

    const handler = getHandler('search_memory');
    await handler({ query: 'test' });

    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = (mockRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs).not.toHaveProperty('filter_project');
  });

  it('returns isError: true on RPC error', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } }),
    });

    const handler = getHandler('search_memory');
    const result = await handler({ query: 'test' }) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
  });

  // ── Task 2 new tests: NullEmbeddingProvider check in search_memory ─────────

  it('Task2: search_memory with NullEmbeddingProvider returns capability message with isError: true', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    // Replace embeddingProvider with a NullEmbeddingProvider instance to test instanceof detection
    const nullProvider = new NullEmbeddingProvider(1536);
    Object.setPrototypeOf(embeddingProvider, Object.getPrototypeOf(nullProvider));
    Object.assign(embeddingProvider, nullProvider);

    registerMemoryTools(server, config);
    const handler = getHandler('search_memory');
    const result = await handler({ query: 'test query' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    // Restore original prototype
    Object.setPrototypeOf(embeddingProvider, Object.prototype);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Semantic search unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: list_memories
// ─────────────────────────────────────────────────────────────────────────────

describe('list_memories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries with instance_id and status=active, returns formatted text', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockMemories = [
      { id: 'mem-1', content: 'User prefers dark mode', tags: ['ui'], plugin_scope: 'global', created_at: '2026-01-01T00:00:00Z' },
      { id: 'mem-2', content: 'Loves TypeScript', tags: [], plugin_scope: 'global', created_at: '2026-01-02T00:00:00Z' },
    ];

    const mockChain = {
      from: vi.fn(),
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      contains: vi.fn(),
    };
    // Chain all methods to return the same object, with limit() resolving the query
    mockChain.from.mockReturnValue(mockChain);
    mockChain.select.mockReturnValue(mockChain);
    mockChain.eq.mockReturnValue(mockChain);
    mockChain.order.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(Promise.resolve({ data: mockMemories, error: null }));
    mockChain.contains.mockReturnValue(Promise.resolve({ data: mockMemories, error: null }));

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

    const handler = getHandler('list_memories');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(mockChain.eq).toHaveBeenCalledWith('instance_id', 'test-instance-id');
    expect(mockChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('mem-1');
    expect(result.content[0].text).toContain('dark mode');
  });

  it('does NOT add .eq project filter (project param removed); uses instance_id filter (D-08)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockChain = {
      from: vi.fn(),
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      contains: vi.fn(),
    };
    mockChain.from.mockReturnValue(mockChain);
    mockChain.select.mockReturnValue(mockChain);
    mockChain.eq.mockReturnValue(mockChain);
    mockChain.order.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(Promise.resolve({ data: [], error: null }));

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

    const handler = getHandler('list_memories');
    await handler({});

    const eqCalls = (mockChain.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    // Should filter by instance_id only — no project filter
    const instanceIdCalls = eqCalls.filter(([field]) => field === 'instance_id');
    expect(instanceIdCalls.length).toBeGreaterThan(0);
    expect(instanceIdCalls[0][1]).toBe('test-instance-id');
    const projectCalls = eqCalls.filter(([field]) => field === 'project');
    expect(projectCalls.length).toBe(0);
  });

  it('returns isError: true on query error', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockChain = {
      from: vi.fn(),
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      contains: vi.fn(),
    };
    mockChain.from.mockReturnValue(mockChain);
    mockChain.select.mockReturnValue(mockChain);
    mockChain.eq.mockReturnValue(mockChain);
    mockChain.order.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(Promise.resolve({ data: null, error: { message: 'query failed' } }));

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

    const handler = getHandler('list_memories');
    const result = await handler({}) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
  });

  // ── Task 1 new tests: list_memories SELECT changes ────────────────────────

  it('Task1: list_memories SELECT includes plugin_scope not source_context', async () => {
    const config = makeConfig();
    const { server } = createMockServer();

    let capturedSelectArg = '';
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockImplementation((fields: string) => {
          capturedSelectArg = fields;
          const chain = {
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
          return chain;
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
    (server.registerTool as ReturnType<typeof vi.fn>).mock.calls.forEach(([name, , handler]: [string, unknown, (p: Record<string, unknown>) => Promise<unknown>]) => {
      handlers[name] = handler;
    });

    await handlers['list_memories']({});

    expect(capturedSelectArg).toContain('plugin_scope');
    expect(capturedSelectArg).not.toContain('source_context');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: update_memory
// ─────────────────────────────────────────────────────────────────────────────

describe('update_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a new row with previous_version_id and version incremented', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const existingId = 'existing-uuid-1111-1111-111111111111';
    const newId = 'new-uuid-2222-2222-222222222222';

    let capturedInsertRow: Record<string, unknown> = {};

    // Step 1 mock: fetch existing row (no source_context)
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { version: 1, project: 'Personal', tags: ['tag1'] },
      error: null,
    });

    // Step 3 mock: insert new version row
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: newId },
      error: null,
    });

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: fetchSingle,
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: insertSingle,
            }),
          };
        }),
      }),
    }));

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.resolve([0.1, 0.2])
    );

    const handler = getHandler('update_memory');
    const result = await handler({ memory_id: existingId, content: 'Updated content' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(capturedInsertRow.previous_version_id).toBe(existingId);
    expect(capturedInsertRow.version).toBe(2);
    expect(result.content[0].text).toContain(newId);
    expect(result.content[0].text).toContain(existingId);
  });

  it('returns isError when memory not found', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const fetchSingle = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: fetchSingle,
            }),
          }),
        }),
      }),
    }));

    const handler = getHandler('update_memory');
    const result = await handler({
      memory_id: 'nonexistent-uuid-0000-0000-000000000000',
      content: 'Updated content',
    }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
  });

  it('preserves existing tags when tags not provided', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const existingId = 'existing-uuid-3333-3333-333333333333';

    let capturedInsertRow: Record<string, unknown> = {};

    const fetchSingle = vi.fn().mockResolvedValueOnce({
      data: { version: 2, project: 'Work', tags: ['existing-tag'] },
      error: null,
    });

    const insertSingle = vi.fn().mockResolvedValueOnce({
      data: { id: 'new-id-3333' },
      error: null,
    });

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: fetchSingle,
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: insertSingle,
            }),
          };
        }),
      }),
    }));

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.resolve([0.5])
    );

    const handler = getHandler('update_memory');
    // Call without tags parameter — should preserve existing tags
    await handler({ memory_id: existingId, content: 'New content without new tags' });

    expect(capturedInsertRow.tags).toEqual(['existing-tag']);
  });

  // ── Task 1 new tests: source_context removed from update_memory ────────────

  it('Task1: update_memory inputSchema does NOT include source_context', () => {
    const config = makeConfig();
    const { server } = createMockServer();
    registerMemoryTools(server, config);

    const registerCalls = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls as Array<[string, { inputSchema: Record<string, unknown> }, unknown]>;
    const updateMemoryCall = registerCalls.find(([name]) => name === 'update_memory');
    expect(updateMemoryCall).toBeDefined();
    const inputSchema = updateMemoryCall![1].inputSchema;
    expect(inputSchema).not.toHaveProperty('source_context');
  });

  it('Task1: update_memory fetch SELECT does NOT include source_context', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    let capturedSelectArg = '';
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockImplementation((fields: string) => {
          capturedSelectArg = fields;
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { version: 1, project: 'Test', tags: [] },
                  error: null,
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
              }),
            }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
          }),
        }),
      }),
    });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    const handler = getHandler('update_memory');
    await handler({ memory_id: 'test-uuid-0000-0000-000000000000', content: 'New content' });

    expect(capturedSelectArg).not.toContain('source_context');
  });

  it('Task1: update_memory insert does NOT include source_context', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    let capturedInsertRow: Record<string, unknown> = {};

    const fetchSingle = vi.fn().mockResolvedValue({
      data: { version: 1, project: 'Test', tags: ['tag1'] },
      error: null,
    });

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ single: fetchSingle }),
          }),
        }),
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
            }),
          };
        }),
      }),
    }));

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    const handler = getHandler('update_memory');
    await handler({ memory_id: 'test-uuid-0000-0000-000000000000', content: 'Updated' });

    expect(capturedInsertRow).not.toHaveProperty('source_context');
  });

  it('preserves plugin_scope from existing memory on update (MEM-08)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    let capturedInsertRow: Record<string, unknown> = {};

    const fetchSingle = vi.fn().mockResolvedValue({
      data: { version: 1, project: 'Work', tags: ['crm'], plugin_scope: 'fqc-crm' },
      error: null,
    });

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'new-id-aaa' },
      error: null,
    });

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: fetchSingle,
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          capturedInsertRow = row;
          return {
            select: vi.fn().mockReturnValue({
              single: insertSingle,
            }),
          };
        }),
      }),
    }));

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);

    const handler = getHandler('update_memory');
    const result = await handler({ memory_id: 'existing-id', content: 'Updated CRM note' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(capturedInsertRow.plugin_scope).toBe('fqc-crm');
    expect(result.isError).toBeUndefined();
  });

  it('update_memory SELECT includes plugin_scope column (MEM-08)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    let capturedSelectArg = '';

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockImplementation((cols: string) => {
          capturedSelectArg = cols;
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { version: 1, project: 'Work', tags: ['crm'], plugin_scope: 'fqc-crm' },
                  error: null,
                }),
              }),
            }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'new-id-bbb' }, error: null }),
          }),
        }),
      }),
    });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);

    const handler = getHandler('update_memory');
    await handler({ memory_id: 'existing-id-2', content: 'Updated CRM note 2' });

    expect(capturedSelectArg).toContain('plugin_scope');
  });

  it('multi-update chain maintains plugin_scope consistency (MEM-09)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const capturedInsertRows: Record<string, unknown>[] = [];

    function makeMockForVersion(version: number) {
      const fetchSingle = vi.fn().mockResolvedValue({
        data: { version, project: 'Work', tags: ['crm'], plugin_scope: 'fqc-crm' },
        error: null,
      });
      const insertSingle = vi.fn().mockResolvedValue({
        data: { id: `new-id-chain-v${version + 1}` },
        error: null,
      });
      return (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: fetchSingle,
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            capturedInsertRows.push(row);
            return {
              select: vi.fn().mockReturnValue({
                single: insertSingle,
              }),
            };
          }),
        }),
      }));
    }

    // Set up three sequential update mocks.
    // Each update call uses one getClient() for fetch+insert.
    // The fire-and-forget embed is suppressed (embed rejects) so it never
    // triggers a second getClient() call that would consume the next mock.
    makeMockForVersion(1);
    makeMockForVersion(2);
    makeMockForVersion(3);

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('embed suppressed for test')
    );

    const handler = getHandler('update_memory');

    await handler({ memory_id: 'chain-id-v1', content: 'Update 1' });
    await handler({ memory_id: 'chain-id-v2', content: 'Update 2' });
    await handler({ memory_id: 'chain-id-v3', content: 'Update 3' });

    expect(capturedInsertRows).toHaveLength(3);
    expect(capturedInsertRows[0].plugin_scope).toBe('fqc-crm');
    expect(capturedInsertRows[1].plugin_scope).toBe('fqc-crm');
    expect(capturedInsertRows[2].plugin_scope).toBe('fqc-crm');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: archive_memory
// ─────────────────────────────────────────────────────────────────────────────

describe('archive_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Helper: build a supabase client mock that returns fetchResult on .single() and updateResult on the update chain. */
  function makeArchiveMock(
    fetchResult: { data: unknown; error: unknown },
    updateResult: { error: unknown }
  ) {
    // select chain: .from().select().eq().eq().single()
    const selectChain = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue(fetchResult),
    };
    selectChain.select.mockReturnValue(selectChain);
    selectChain.eq.mockReturnValue(selectChain);

    // update chain: .from().update().eq().eq() resolves with updateResult
    const updateEq2 = vi.fn().mockResolvedValue(updateResult);
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const updateChain = { update: vi.fn().mockReturnValue({ eq: updateEq1 }) };

    // Alternate between select and update on successive .from() calls
    let fromCallCount = 0;
    const client = {
      from: vi.fn().mockImplementation(() => {
        fromCallCount++;
        return fromCallCount === 1 ? selectChain : updateChain;
      }),
    };
    return { client, selectChain, updateChain, updateEq1, updateEq2 };
  }

  it('ARC-01: sets status=archived and adds #status/archived to tags', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const { client, updateChain } = makeArchiveMock(
      { data: { tags: ['some-tag', '#status/active'], status: 'active' }, error: null },
      { error: null }
    );
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const result = await getHandler('archive_memory')({ memory_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff' }) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('archived');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'archived',
        tags: expect.arrayContaining(['some-tag', '#status/archived']),
      })
    );
  });

  it('removes #status/active from tags', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const { client, updateChain } = makeArchiveMock(
      { data: { tags: ['#status/active', 'other-tag'], status: 'active' }, error: null },
      { error: null }
    );
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    await getHandler('archive_memory')({ memory_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff' });

    const updateCallArg = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { tags: string[] };
    expect(updateCallArg.tags).not.toContain('#status/active');
    expect(updateCallArg.tags).toContain('#status/archived');
  });

  it('does not add duplicate #status/archived if already present', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const { client, updateChain } = makeArchiveMock(
      { data: { tags: ['#status/archived'], status: 'archived' }, error: null },
      { error: null }
    );
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    await getHandler('archive_memory')({ memory_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff' });

    const updateCallArg = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { tags: string[] };
    const archivedCount = updateCallArg.tags.filter(t => t === '#status/archived').length;
    expect(archivedCount).toBe(1);
  });

  it('returns isError when memory not found', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    // fetch returns error
    const selectChain = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'record not found' } }),
    };
    selectChain.select.mockReturnValue(selectChain);
    selectChain.eq.mockReturnValue(selectChain);

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(selectChain),
    });

    const result = await getHandler('archive_memory')({ memory_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff' }) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: search_memory tag_match (TAGMATCH-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('search_memory tag_match (TAGMATCH-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(Array(1536).fill(0.1));
  });

  it('passes filter_tag_match to match_memories RPC', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: mockRpc });

    await getHandler('search_memory')({ query: 'test', tags: ['#a'], tag_match: 'all' });

    expect(mockRpc).toHaveBeenCalledWith('match_memories', expect.objectContaining({
      filter_tag_match: 'all',
    }));
  });

  it('defaults filter_tag_match to any when omitted', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: mockRpc });

    await getHandler('search_memory')({ query: 'test', tags: ['#a'] });

    expect(mockRpc).toHaveBeenCalledWith('match_memories', expect.objectContaining({
      filter_tag_match: 'any',
    }));
  });

  it('does not pass filter_project to match_memories RPC', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: mockRpc });

    await getHandler('search_memory')({ query: 'test' });

    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = (mockRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs).not.toHaveProperty('filter_project');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: list_memories tag_match (TAGMATCH-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('list_memories tag_match (TAGMATCH-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tag_match=any uses .overlaps()', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockOverlaps = vi.fn().mockReturnThis();
    const mockContains = vi.fn().mockReturnThis();
    const queryChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      overlaps: mockOverlaps,
      contains: mockContains,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    });

    await getHandler('list_memories')({ tags: ['#a', '#b'], tag_match: 'any' });

    expect(mockOverlaps).toHaveBeenCalledWith('tags', ['#a', '#b']);
    expect(mockContains).not.toHaveBeenCalled();
  });

  it('tag_match=all uses .contains()', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockOverlaps = vi.fn().mockReturnThis();
    const mockContains = vi.fn().mockReturnThis();
    const queryChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      overlaps: mockOverlaps,
      contains: mockContains,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    });

    await getHandler('list_memories')({ tags: ['#a', '#b'], tag_match: 'all' });

    expect(mockContains).toHaveBeenCalledWith('tags', ['#a', '#b']);
    expect(mockOverlaps).not.toHaveBeenCalled();
  });

  it('defaults to any (.overlaps) when tag_match omitted', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockOverlaps = vi.fn().mockReturnThis();
    const mockContains = vi.fn().mockReturnThis();
    const queryChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      overlaps: mockOverlaps,
      contains: mockContains,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    });

    await getHandler('list_memories')({ tags: ['#a'] });

    expect(mockOverlaps).toHaveBeenCalledWith('tags', ['#a']);
    expect(mockContains).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: 60b-01 fixes — list_memories isolation, search_memory isError:false, save_memory scope
// ─────────────────────────────────────────────────────────────────────────────

describe('60b-01: list_memories instance isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only returns memories from the current instance (instance_id filter verified)', async () => {
    const config = makeConfig({ id: 'instance-1' });
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockMemories = [
      {
        id: 'mem-1',
        content: 'User from instance-1',
        tags: ['work'],
        plugin_scope: 'global',
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    const mockChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockMemories, error: null }),
    };
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

    const handler = getHandler('list_memories');
    const result = await handler({}) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Verify instance_id filter was applied with the correct value
    const eqCalls = (mockChain.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    const instanceFilter = eqCalls.find(([field]) => field === 'instance_id');
    expect(instanceFilter).toBeDefined();
    expect(instanceFilter![1]).toBe('instance-1');

    expect(result.content[0].text).toContain('Memory ID:');
    expect(result.content[0].text).toContain('User from instance-1');
    expect(result.isError).toBeUndefined(); // Success response
  });
});

describe('60b-01: search_memory empty result returns isError: false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results with isError: false (not an error condition)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockVector = [0.1, 0.2, 0.3];
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(mockVector);

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [], // Empty results
        error: null,
      }),
    });

    const handler = getHandler('search_memory');
    const result = await handler({ query: 'nonexistent topic' }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.content[0].text).toBe('No memories found.');
    expect(result.isError).toBe(false); // Explicitly false, not undefined
  });
});

describe('60b-01: save_memory scope display in response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes "Scope: Global." in response when no plugin_scope specified', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const mockVector = [0.1, 0.2, 0.3];
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue(mockVector);

    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'mem-123' }, error: null }),
          }),
        }),
      }),
    });

    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Test memory', tags: ['test'] }) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toContain('Scope: Global.');
  });

  it('includes "Scope: {plugin} (auto-corrected)" when plugin_scope is fuzzy-matched', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockResolvedValue({ data: 'fqc-crm', error: null });
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-456' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: mockInsertSingle }),
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    const result = await handler({ content: 'CRM note', plugin_scope: 'CRM' }) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toContain('fqc-crm');
    expect(result.content[0].text).toContain('auto-corrected');
    expect(result.content[0].text).toContain('Scope:');
  });

  it('includes warning when plugin_scope not found (defaults to global)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();

    const mockRpc = vi.fn().mockResolvedValue({ data: 'global', error: null });
    const mockInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'mem-789' }, error: null });

    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: mockInsertSingle }),
        }),
      }),
    });

    registerMemoryTools(server, config);
    const handler = getHandler('save_memory');
    const result = await handler({ content: 'Test memory', plugin_scope: 'nonexistent' }) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toContain('Warning:');
    expect(result.content[0].text).toContain('not found');
    expect(result.content[0].text).toContain('global scope');
  });
});
