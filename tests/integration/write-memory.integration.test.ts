import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-125-write-memory-integration';
const SKIP = !HAS_SUPABASE;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'phase-125-write-memory-integration',
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-125-write-memory-vault', markdownExtensions: ['.md'] },
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

describe.skipIf(SKIP)('write_memory final contracts (integration)', () => {
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.getClient().from('fqc_vault').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.close();
  });

  it('creates, updates, reads previous versions, rejects non-latest updates, and archives the full chain', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const createResult = await getHandler('write_memory')({
      mode: 'create',
      content: 'Phase 125 memory create integration.',
      tags: ['phase125', 'memory'],
      include: ['content', 'tags_full'],
    }) as { isError?: boolean };
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(textOf(createResult)) as { memory_id: string; content: string; tags_full: string[]; is_latest: boolean };
    expect(created).toMatchObject({
      content: 'Phase 125 memory create integration.',
      tags_full: ['phase125', 'memory'],
      is_latest: true,
    });

    const updateResult = await getHandler('write_memory')({
      mode: 'update',
      memory_id: created.memory_id,
      content: 'Phase 125 memory updated integration.',
      tags: ['phase125', 'updated'],
    }) as { isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(textOf(updateResult)) as { memory_id: string; previous_version_id: string; is_latest: boolean };
    expect(updated).toMatchObject({
      previous_version_id: created.memory_id,
      is_latest: true,
    });

    const { data: rows, error: chainError } = await supabaseManager.getClient()
      .from('fqc_memory')
      .select('id, previous_version_id, is_latest, tags')
      .eq('instance_id', TEST_INSTANCE_ID)
      .in('id', [created.memory_id, updated.memory_id]);
    expect(chainError).toBeNull();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.memory_id, is_latest: false }),
      expect.objectContaining({ id: updated.memory_id, previous_version_id: created.memory_id, is_latest: true }),
    ]));

    const conflictResult = await getHandler('write_memory')({
      mode: 'update',
      memory_id: created.memory_id,
      content: 'Should conflict.',
    }) as { isError?: boolean };
    expect(conflictResult.isError).toBe(false);
    expect(JSON.parse(textOf(conflictResult))).toMatchObject({ error: 'conflict' });

    const previousVersion = await getHandler('get_memory')({
      memory_ids: created.memory_id,
      include: ['content'],
    }) as { isError?: boolean };
    expect(previousVersion.isError).toBeFalsy();
    expect(JSON.parse(textOf(previousVersion))).toMatchObject({
      memory_id: created.memory_id,
      content: 'Phase 125 memory create integration.',
      is_latest: false,
    });

    const archiveResult = await getHandler('archive_memory')({ memory_ids: updated.memory_id }) as { isError?: boolean };
    expect(archiveResult.isError).toBeFalsy();
    const archived = JSON.parse(textOf(archiveResult)) as { archived_at: string };
    expect(archived.archived_at).toBeTruthy();

    const rearchiveResult = await getHandler('archive_memory')({ memory_ids: created.memory_id }) as { isError?: boolean };
    expect(rearchiveResult.isError).toBeFalsy();
    const rearchived = JSON.parse(textOf(rearchiveResult)) as { archived_at: string };
    expect(new Date(rearchived.archived_at).toISOString()).toBe(new Date(archived.archived_at).toISOString());

    const { data: archivedRows, error: archiveError } = await supabaseManager.getClient()
      .from('fqc_memory')
      .select('id, status, archived_at, tags')
      .eq('instance_id', TEST_INSTANCE_ID)
      .in('id', [created.memory_id, updated.memory_id]);
    expect(archiveError).toBeNull();
    expect(archivedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.memory_id, status: 'archived' }),
      expect.objectContaining({ id: updated.memory_id, status: 'archived' }),
    ]));
    for (const row of archivedRows ?? []) {
      expect((row.tags as string[])).toContain('#status/archived');
      expect(new Date(row.archived_at as string).toISOString()).toBe(new Date(archived.archived_at).toISOString());
    }
  });
});
