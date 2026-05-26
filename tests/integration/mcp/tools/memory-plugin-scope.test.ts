import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../../../src/config/loader.js';
import { initEmbedding } from '../../../../src/embedding/provider.js';
import { initLogger } from '../../../../src/logging/logger.js';
import { registerMemoryTools } from '../../../../src/mcp/tools/memory.js';
import { initSupabase, supabaseManager } from '../../../../src/storage/supabase.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-145-memory-plugin-scope';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-145-memory-plugin-scope-vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

describe.skipIf(!HAS_SUPABASE)('write_memory plugin scope lookup failure (integration)', () => {
  let config: FlashQueryConfig;
  let realClient: ReturnType<typeof supabaseManager.getClient>;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    realClient = supabaseManager.getClient();
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await realClient.from('fqc_memory').delete().eq('instance_id', TEST_INSTANCE_ID);
    await realClient.from('fqc_vault').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.close();
  });

  it('returns lookup_failed and does not insert a global fallback memory', async () => {
    vi.spyOn(supabaseManager, 'getClient').mockReturnValue({
      ...realClient,
      from: realClient.from.bind(realClient),
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        if (fn === 'find_plugin_scope') {
          return Promise.resolve({ data: null, error: { message: 'forced lookup failure' } });
        }
        return realClient.rpc(fn, args);
      }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);
    const result = await getHandler('write_memory')({
      mode: 'create',
      content: 'Phase 145 lookup failure must not fall back to global.',
      plugin_scope: 'crm',
    }) as { isError?: boolean };

    expect(result.isError).toBe(false);
    expect(JSON.parse(textOf(result))).toMatchObject({
      error: 'lookup_failed',
      details: { reason: 'lookup_failed' },
    });

    const { data, error } = await realClient
      .from('fqc_memory')
      .select('id, plugin_scope, content')
      .eq('instance_id', TEST_INSTANCE_ID)
      .eq('plugin_scope', 'global')
      .eq('content', 'Phase 145 lookup failure must not fall back to global.');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
