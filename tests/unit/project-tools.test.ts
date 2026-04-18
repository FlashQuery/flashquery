import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectTools } from '../../src/mcp/tools/projects.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
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

// Mock node:fs/promises readdir for vault doc counting
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

// Mock node:fs existsSync for vault path check
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseManager } from '../../src/storage/supabase.js';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
    registerTool: vi.fn((name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    }),
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
      id: 'test-instance-id',
      vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
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
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

/** Creates a chainable supabase query mock for list_projects chain. */
function makeListProjectsChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, unknown> = {};
  // The chain: from -> select -> eq -> eq -> order -> order -> resolves
  chain['from'] = vi.fn(() => chain);
  chain['select'] = vi.fn(() => chain);
  chain['eq'] = vi.fn(() => chain);
  chain['order'] = vi.fn(() => chain);
  // Second order() resolves with data
  let orderCallCount = 0;
  (chain['order'] as ReturnType<typeof vi.fn>).mockImplementation((_col: string) => {
    orderCallCount++;
    if (orderCallCount >= 2) {
      return Promise.resolve({ data, error });
    }
    return chain;
  });
  return chain;
}

/**
 * Creates a chainable Supabase mock for get_project_info.
 * Chain: from -> select -> eq(instance_id) -> eq(name) -> [optional eq(area)] -> single()
 */
function makeGetProjectChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn(() => chain);
  chain['select'] = vi.fn(() => chain);
  chain['eq'] = vi.fn(() => chain);
  chain['single'] = vi.fn(() => Promise.resolve({ data, error }));
  return chain;
}

/**
 * Creates a chainable Supabase mock for the memory count query.
 * Chain: from -> select -> eq -> eq -> eq -> (resolves with count)
 */
function makeCountChain(count: number, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn(() => chain);
  chain['select'] = vi.fn(() => chain);
  chain['eq'] = vi.fn(() => chain);
  // Last eq resolves with count
  let eqCallCount = 0;
  (chain['eq'] as ReturnType<typeof vi.fn>).mockImplementation(() => {
    eqCallCount++;
    if (eqCallCount >= 3) {
      return Promise.resolve({ count, error });
    }
    return chain;
  });
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: list_projects
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deprecation message mentioning "removed in v1.7" (D-04)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('list_projects');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('removed in v1.7');
  });

  it('mentions path-based + tag-based scoping in deprecation message', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('list_projects');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content[0].text).toContain('path-based');
    expect(result.content[0].text).toContain('tag-based');
  });

  it('directs to fqc scan in deprecation message', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('list_projects');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content[0].text).toContain('fqc scan');
  });

  it('does NOT query Supabase fqc_projects table (no-op handler)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const mockGetClient = vi.fn();
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementation(mockGetClient);

    const handler = getHandler('list_projects');
    await handler({});

    // Supabase should NOT be called — handler is a no-op
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: get_project_info
// ─────────────────────────────────────────────────────────────────────────────

describe('get_project_info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deprecation message mentioning "removed in v1.7" (PROJ-03)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('get_project_info');
    const result = await handler({ project: 'Personal/Fitness' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('removed in v1.7');
  });

  it('mentions path-based + tag-based scoping in deprecation message', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('get_project_info');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content[0].text).toContain('path-based');
    expect(result.content[0].text).toContain('tag-based');
  });

  it('directs to search_documents in deprecation message', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const handler = getHandler('get_project_info');
    const result = await handler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content[0].text).toContain('search_documents');
  });

  it('does NOT query Supabase fqc_projects table (no-op handler)', async () => {
    const config = makeConfig();
    const { server, getHandler } = createMockServer();
    registerProjectTools(server, config);

    const mockGetClient = vi.fn();
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockImplementation(mockGetClient);

    const handler = getHandler('get_project_info');
    await handler({});

    // Supabase should NOT be called — handler is a no-op
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});
