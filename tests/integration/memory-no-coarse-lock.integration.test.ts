import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = 'phase-157-memory-no-coarse-lock';

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: INSTANCE_ID, id: INSTANCE_ID, vault: { path: '/tmp/phase-157-memory', markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
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

function payload(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('memory-no-coarse-lock T-I-043', () => {
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
    await supabaseManager.close();
  }, 60_000);

  it('T-I-043 concurrent write_memory updates converge through fqc_memory_create_version', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const createdResult = await getHandler('write_memory')({
      mode: 'create',
      content: 'Phase 157 original memory.',
      tags: ['phase157'],
    });
    const created = payload(createdResult);
    expect(created.memory_id).toEqual(expect.any(String));

    const updates = await Promise.allSettled([
      getHandler('write_memory')({ mode: 'update', memory_id: created.memory_id, content: 'Phase 157 concurrent update A.' }),
      getHandler('write_memory')({ mode: 'update', memory_id: created.memory_id, content: 'Phase 157 concurrent update B.' }),
    ]);

    const settledPayloads = updates.map((entry) => entry.status === 'fulfilled' ? payload(entry.value) : { error: 'rejected' });
    const successes = settledPayloads.filter((item) => item.memory_id && item.previous_version_id === created.memory_id);
    const expectedConflicts = settledPayloads.filter((item) =>
      item.error === 'conflict' &&
      (item as { details?: { reason?: string } }).details?.reason === 'non_latest_memory_version'
    );

    expect(successes).toHaveLength(1);
    expect(expectedConflicts.length).toBeGreaterThanOrEqual(1);

    const { data: rows, error } = await supabaseManager.getClient()
      .from('fqc_memory')
      .select('id, previous_version_id, is_latest')
      .eq('instance_id', INSTANCE_ID);
    expect(error).toBeNull();
    expect((rows ?? []).filter((row) => row.is_latest === true)).toHaveLength(1);
  }, 120_000);
});
