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

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseManager } from '../../src/storage/supabase.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_1 = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  content: 'User prefers dark mode',
  tags: ['#preference'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const MEMORY_2 = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444',
  content: 'Project deadline is April 15',
  tags: ['#project', '#deadline'],
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-04T00:00:00Z',
};

const MISSING_ID = 'cccccccc-1111-2222-3333-444444444444';

/** Build a chainable supabase mock that resolves the chain with the given final result. */
function makeQueryChain(finalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  // Make the chain thenable so `await chain` resolves to finalResult
  (chain as Record<string, unknown> & { then: unknown }).then = (
    resolve: (v: unknown) => void
  ) => resolve(finalResult);
  return chain;
}

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_memory
// ─────────────────────────────────────────────────────────────────────────────

describe('get_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single string ID: returns single-memory format with content-first, blank line, then metadata', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [MEMORY_1], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    const result = (await handler({ memory_ids: MEMORY_1.id })) as ToolResult;

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // Single-mode format: content first (unlabeled), blank line, then metadata
    const lines = text.split('\n');
    expect(lines[0]).toBe('User prefers dark mode'); // Content first
    expect(lines[1]).toBe(''); // Blank line delimiter

    // Metadata in key-value format
    expect(text).toContain('Memory ID:');
    expect(text).toContain(`Memory ID: ${MEMORY_1.id}`);
    expect(text).toContain('Tags:');
    expect(text).toContain('Created:');
    expect(text).toContain('Updated:');
  });

  it('array of 2 IDs: returns batch format with --- separators', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [MEMORY_1, MEMORY_2], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    const result = (await handler({ memory_ids: [MEMORY_1.id, MEMORY_2.id] })) as ToolResult;

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // NEW format: --- separators instead of === delimiters
    expect(text).toContain('---');
    // NEW format: key-value pairs instead of inline format
    expect(text).toContain('Memory ID:');
    expect(text).toContain(`Memory ID: ${MEMORY_1.id}`);
    expect(text).toContain(`Memory ID: ${MEMORY_2.id}`);
    expect(text).toContain('Content:');
    expect(text).toContain('User prefers dark mode');
    expect(text).toContain('Project deadline is April 15');
  });

  it('array of 3 IDs with 1 missing: returns batch format with found memories and Not found note', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    // DB returns only MEMORY_1 and MEMORY_2; MISSING_ID is not found
    const chain = makeQueryChain({ data: [MEMORY_1, MEMORY_2], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    const result = (await handler({
      memory_ids: [MEMORY_1.id, MEMORY_2.id, MISSING_ID],
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // NEW format: --- separators, key-value pairs
    expect(text).toContain('---');
    expect(text).toContain(`Memory ID: ${MEMORY_1.id}`);
    expect(text).toContain(`Memory ID: ${MEMORY_2.id}`);
    // Not found note at end for missing ID (NEW format: no underscores)
    expect(text).toContain(`Not found: ${MISSING_ID}`);
  });

  it('array where ALL IDs are missing: returns isError true', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    const result = (await handler({ memory_ids: [MISSING_ID] })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found');
  });

  it('single string ID not found: returns isError true', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    const result = (await handler({ memory_ids: MISSING_ID })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found');
  });

  it('queries include instance_id filter for tenant isolation', async () => {
    const config = makeConfig({ id: 'my-tenant-id' });
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [MEMORY_1], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    await handler({ memory_ids: MEMORY_1.id });

    // Verify .eq was called with instance_id
    expect(chain.eq).toHaveBeenCalledWith('instance_id', 'my-tenant-id');
  });

  it('queries use .in("id", ids) NOT .in("memory_id", ids)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [MEMORY_1], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    await handler({ memory_ids: MEMORY_1.id });

    expect(chain.in).toHaveBeenCalledWith('id', [MEMORY_1.id]);
    // Should NOT be called with 'memory_id'
    expect(chain.in).not.toHaveBeenCalledWith('memory_id', expect.anything());
  });

  it('single-element array uses batch format (dispatch on Array.isArray, not length)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const chain = makeQueryChain({ data: [MEMORY_1], error: null });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const handler = getHandler('get_memory');
    // Array with one element → should use BATCH format (--- separators), not single format
    const result = (await handler({ memory_ids: [MEMORY_1.id] })) as ToolResult;

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // NEW batch format includes --- separator (no blank line needed for single-entry batch)
    // Key-value format
    expect(text).toContain(`Memory ID: ${MEMORY_1.id}`);
    expect(text).not.toContain('\n\n'); // No blank line in batch mode
  });
});
