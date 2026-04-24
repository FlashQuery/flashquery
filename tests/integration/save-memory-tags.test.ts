/**
 * Integration tests: save_memory tag normalization and validation (Plan 25-02).
 * Verifies tags are normalized and validated before inserting into fqc_memory.
 * Requires: Supabase running, SUPABASE_SERVICE_ROLE_KEY set.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const SKIP = !HAS_SUPABASE;

const TEST_INSTANCE_ID = 'tag-test-save-memory-id';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'tag-test-save-memory',
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/tag-test-save-memory-vault', markdownExtensions: ['.md'] },
    },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

describe.skipIf(SKIP)('save_memory tag normalization (integration)', () => {
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
  });

  afterAll(async () => {
    await supabaseManager.getClient()
      .from('fqc_memory')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.close();
  });

  it('save_memory normalizes tags in DB (trim + lowercase)', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const result = await getHandler('save_memory')({
      content: 'Tag normalization test memory.',
      tags: [' MixedCase ', 'UPPER'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Memory saved');

    // Extract id from response
    const idMatch = result.content[0].text.match(/id: ([a-f0-9-]+)/);
    expect(idMatch).not.toBeNull();
    const memId = idMatch![1];

    // Verify DB row has normalized tags
    const { data: dbRow, error } = await supabaseManager.getClient()
      .from('fqc_memory')
      .select('id, tags')
      .eq('id', memId)
      .single();

    expect(error).toBeNull();
    expect(dbRow).not.toBeNull();
    const dbTags: string[] = dbRow!.tags ?? [];
    expect(dbTags).toContain('mixedcase');
    expect(dbTags).toContain('upper');
    expect(dbTags).not.toContain(' MixedCase ');
    expect(dbTags).not.toContain('UPPER');
  });

  it('save_memory rejects duplicate tags with isError', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const result = await getHandler('save_memory')({
      content: 'Duplicate tag test.',
      tags: ['duplicate', 'duplicate'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tag validation failed');
    expect(result.content[0].text).toContain("Tag 'duplicate' appears multiple times");
  });

  it('save_memory accepts multiple status tags — D-06 removed status mutual exclusivity', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    // D-06: multiple #status/* tags are now allowed
    const result = await getHandler('save_memory')({
      content: 'Status conflict test.',
      tags: ['#status/active', '#status/archived'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Memory saved');
  });
});
