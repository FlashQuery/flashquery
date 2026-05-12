import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn() },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: { embed: vi.fn().mockResolvedValue([0.1]) },
  NullEmbeddingProvider: class NullEmbeddingProvider {},
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

import { supabaseManager } from '../../src/storage/supabase.js';

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: 'test', id: 'test-instance-id' },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test', databaseUrl: 'postgresql://test' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
    defaults: { project: 'Default' },
    projects: { areas: [] },
  } as unknown as FlashQueryConfig;
}

function parseResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

function makeThenableChain(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['insert', 'select', 'single', 'eq', 'update']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult);
  chain.then = (resolve: (value: unknown) => void) => resolve(finalResult);
  return chain;
}

describe('write_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mode is required and unknown modes return expected invalid_input errors', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());
    const handler = getHandler('write_memory');

    const missing = await handler({ content: 'remember this' }) as { isError?: boolean };
    expect(missing.isError).toBe(false);
    expect(parseResult(missing)).toMatchObject({ error: 'invalid_input', message: expect.stringContaining('mode is required') });

    const unknown = await handler({ mode: 'replace', content: 'remember this' }) as { isError?: boolean };
    expect(unknown.isError).toBe(false);
    expect(parseResult(unknown)).toMatchObject({ error: 'invalid_input' });
  });

  it('create defaults plugin_scope, rejects generated fields, inserts is_latest true, and returns JSON identification', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());

    const generated = await getHandler('write_memory')({ mode: 'create', content: 'x', memory_id: 'caller-id' }) as { isError?: boolean };
    expect(generated.isError).toBe(false);
    expect(parseResult(generated)).toEqual({
      error: 'invalid_input',
      message: 'memory_id is not allowed when mode is create',
      identifier: 'caller-id',
    });

    let capturedInsert: Record<string, unknown> = {};
    const insertChain = makeThenableChain({
      data: {
        id: 'mem-1',
        content: 'User prefers JSON',
        tags: ['preference'],
        plugin_scope: 'global',
        created_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-05-12T00:00:00.000Z',
        version: 1,
        previous_version_id: null,
        is_latest: true,
        archived_at: null,
      },
      error: null,
    });
    (insertChain.insert as ReturnType<typeof vi.fn>).mockImplementation((row: Record<string, unknown>) => {
      capturedInsert = row;
      return insertChain;
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(insertChain) });

    const result = await getHandler('write_memory')({ mode: 'create', content: 'User prefers JSON', tags: ['preference'], include: ['content'] });
    const payload = parseResult(result);

    expect(capturedInsert).toMatchObject({
      plugin_scope: 'global',
      is_latest: true,
      previous_version_id: null,
      chain_root_id: expect.any(String),
    });
    expect(capturedInsert.chain_root_id).toBe(capturedInsert.id);
    expect(payload).toMatchObject({ memory_id: 'mem-1', content: 'User prefers JSON', is_latest: true });
  });

  it('update requires memory_id and mutable fields, rejects non-latest updates with conflict', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());
    const handler = getHandler('write_memory');

    expect(parseResult(await handler({ mode: 'update', content: 'new' }))).toMatchObject({ error: 'invalid_input' });
    expect(parseResult(await handler({ mode: 'update', memory_id: 'mem-1' }))).toMatchObject({ error: 'invalid_input' });

    const fetchChain = makeThenableChain({
      data: {
        id: 'mem-1',
        content: 'old',
        tags: [],
        plugin_scope: 'global',
        version: 1,
        previous_version_id: null,
        is_latest: false,
        archived_at: null,
      },
      error: null,
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(fetchChain) });

    const conflict = await handler({ mode: 'update', memory_id: 'mem-1', content: 'new' }) as { isError?: boolean };
    expect(conflict.isError).toBe(false);
    expect(parseResult(conflict)).toMatchObject({
      error: 'conflict',
      message: 'Cannot update a non-latest memory version',
      identifier: 'mem-1',
      details: { reason: 'non_latest_memory_version' },
    });
  });

  it('update creates a new latest version through the transactional database RPC', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());

    const fetchChain = makeThenableChain({
      data: {
        id: 'mem-1',
        content: 'old',
        tags: ['old'],
        plugin_scope: 'global',
        version: 1,
        previous_version_id: null,
        is_latest: true,
        archived_at: null,
      },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'mem-2',
        content: 'new',
        tags: ['new'],
        plugin_scope: 'global',
        created_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-05-12T00:00:00.000Z',
        version: 2,
        previous_version_id: 'mem-1',
        is_latest: true,
        archived_at: null,
      },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce(fetchChain);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from, rpc });

    const result = await getHandler('write_memory')({ mode: 'update', memory_id: 'mem-1', content: 'new', tags: ['new'] });

    expect(rpc).toHaveBeenCalledWith('fqc_memory_create_version', {
      p_instance_id: 'test-instance-id',
      p_previous_id: 'mem-1',
      p_content: 'new',
      p_tags: ['new'],
      p_plugin_scope: 'global',
    });
    expect(parseResult(result)).toMatchObject({ memory_id: 'mem-2', previous_version_id: 'mem-1', is_latest: true });
  });

  it('maps transactional RPC non-latest races to the canonical conflict envelope', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());

    const fetchChain = makeThenableChain({
      data: {
        id: 'mem-1',
        content: 'old',
        tags: [],
        plugin_scope: 'global',
        version: 1,
        previous_version_id: null,
        is_latest: true,
        archived_at: null,
      },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'Cannot update a non-latest memory version' },
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(fetchChain), rpc });

    const result = await getHandler('write_memory')({ mode: 'update', memory_id: 'mem-1', content: 'new' }) as { isError?: boolean };

    expect(result.isError).toBe(false);
    expect(parseResult(result)).toMatchObject({
      error: 'conflict',
      message: 'Cannot update a non-latest memory version',
      identifier: 'mem-1',
      details: { reason: 'non_latest_memory_version' },
    });
  });

  it('maps transactional RPC missing-row races to the canonical not_found envelope', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, makeConfig());

    const fetchChain = makeThenableChain({
      data: {
        id: 'mem-1',
        content: 'old',
        tags: [],
        plugin_scope: 'global',
        version: 1,
        previous_version_id: null,
        is_latest: true,
        archived_at: null,
      },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'Memory not found: mem-1' },
    });
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(fetchChain), rpc });

    const result = await getHandler('write_memory')({ mode: 'update', memory_id: 'mem-1', content: 'new' }) as { isError?: boolean };

    expect(result.isError).toBe(false);
    expect(parseResult(result)).toMatchObject({
      error: 'not_found',
      message: 'Memory not found: mem-1',
      identifier: 'mem-1',
    });
  });
});
