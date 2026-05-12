import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = `search-integration-${randomUUID().slice(0, 8)}`;
const SKIP = !HAS_SUPABASE;

function makeConfig(vaultPath: string, hostTools: string[] = ['tier:read-write']): FlashQueryConfig {
  return {
    instance: {
      name: 'search-integration-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
    hostMcpTools: { tools: hostTools, excludedTools: [] },
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

describe.skipIf(SKIP)('unified search integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let mockServer: ReturnType<typeof createMockServer>;
  const memoryIds: string[] = [];
  let nonLatestMemoryId = '';

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-search-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    initVault(config);
    mockServer = createMockServer();
    registerCompoundTools(mockServer.server, config);

    await mkdir(join(vaultPath, '_global'), { recursive: true });
    const docs = [
      { name: 'alpha-project.md', title: 'Alpha Project', status: 'active', tags: ['phase125', 'alpha'] },
      { name: 'archived-project.md', title: 'Archived Alpha', status: 'archived', tags: ['phase125', 'alpha'] },
    ];
    for (const doc of docs) {
      const raw = matter.stringify(`Body for ${doc.title}.`, {
        [FM.TITLE]: doc.title,
        [FM.ID]: randomUUID(),
        [FM.STATUS]: doc.status,
        [FM.TAGS]: doc.tags,
      });
      await writeFile(join(vaultPath, '_global', doc.name), raw, 'utf-8');
    }

    for (const memory of [
      { content: 'Alpha memory visible in unified search', status: 'active', is_latest: true, archived_at: null },
      { content: 'Archived alpha memory hidden by default', status: 'archived', is_latest: true, archived_at: new Date().toISOString() },
      { content: 'Superseded alpha memory hidden from latest-only search', status: 'active', is_latest: false, archived_at: null },
    ]) {
      const id = randomUUID();
      memoryIds.push(id);
      if (!memory.is_latest) nonLatestMemoryId = id;
      await supabaseManager.getClient().from('fqc_memory').insert({
        id,
        instance_id: INSTANCE_ID,
        content: memory.content,
        tags: ['phase125', 'alpha'],
        plugin_scope: 'global',
        status: memory.status,
        version: 1,
        previous_version_id: null,
        is_latest: memory.is_latest,
        archived_at: memory.archived_at,
        embedding: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('returns document filesystem search JSON with entity_types and mode: "filesystem"', async () => {
    const result = await mockServer.getHandler('search')({
      query: 'alpha',
      mode: 'filesystem',
      entity_types: ['documents'],
      tags: ['phase125'],
    }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as { mode: string; entity_types: string[]; results: Array<Record<string, unknown>> };
    expect(payload.mode).toBe('filesystem');
    expect(payload.entity_types).toEqual(['documents']);
    expect(payload.results).toEqual([
      expect.objectContaining({
        entity_type: 'document',
        title: 'Alpha Project',
        modified: expect.any(String),
        size: { chars: expect.any(Number) },
        match_source: ['filesystem'],
      }),
    ]);
    expect(payload.results[0]).not.toHaveProperty('score');
  });

  it('supports memory list-mode without semantic provider calls', async () => {
    const result = await mockServer.getHandler('search')({
      query: '',
      tags: ['phase125'],
      entity_types: ['memories'],
    }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as { mode: string; results: Array<Record<string, unknown>> };
    expect(payload.mode).toBe('list');
    expect(payload.results).toEqual([
      expect.objectContaining({
        entity_type: 'memory',
        memory_id: memoryIds[0],
        content_preview: expect.stringContaining('Alpha memory'),
        plugin_scope: 'global',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      }),
    ]);
    expect(payload.results[0]).not.toHaveProperty('score');
    expect(payload.results[0]).not.toHaveProperty('match_source');
  });

  it('applies one global limit after mixed document and memory merge', async () => {
    const result = await mockServer.getHandler('search')({
      query: 'alpha',
      mode: 'mixed',
      entity_types: ['documents', 'memories'],
      limit: 1,
    }) as { isError?: boolean };
    const payload = JSON.parse(textOf(result)) as { total: number; results: unknown[] };
    expect(payload.total).toBe(1);
    expect(payload.results).toHaveLength(1);
  });

  it('excludes archived documents and memories by default and includes them with include_archived', async () => {
    const defaultResult = await mockServer.getHandler('search')({
      query: 'archived',
      mode: 'filesystem',
      entity_types: ['documents', 'memories'],
    });
    const defaultPayload = JSON.parse(textOf(defaultResult)) as { results: Array<{ title?: string; content_preview?: string }> };
    expect(JSON.stringify(defaultPayload.results)).not.toContain('Archived Alpha');
    expect(JSON.stringify(defaultPayload.results)).not.toContain('Archived alpha memory');

    const archivedResult = await mockServer.getHandler('search')({
      query: 'archived',
      mode: 'filesystem',
      entity_types: ['documents', 'memories'],
      include_archived: true,
    });
    const archivedPayload = JSON.parse(textOf(archivedResult)) as { results: Array<{ title?: string; content_preview?: string }> };
    expect(JSON.stringify(archivedPayload.results)).toContain('Archived Alpha');
    expect(JSON.stringify(archivedPayload.results)).toContain('Archived alpha memory');
  });

  it('keeps memory search latest-only even when include_archived is true', async () => {
    const result = await mockServer.getHandler('search')({
      query: 'superseded alpha',
      mode: 'filesystem',
      entity_types: ['memories'],
      include_archived: true,
      list_all: true,
    });
    const payload = JSON.parse(textOf(result)) as { results: Array<{ memory_id?: string }> };
    expect(payload.results.map((item) => item.memory_id)).not.toContain(nonLatestMemoryId);
  });

  it('keeps document search available and applies canonical disabled-memory degradation', async () => {
    const disabledConfig = makeConfig(vaultPath, ['category:doc-read']);
    const disabledServer = createMockServer();
    registerCompoundTools(disabledServer.server, disabledConfig);

    const documentsOnly = await disabledServer.getHandler('search')({
      query: 'alpha',
      mode: 'filesystem',
      entity_types: ['documents'],
      tags: ['phase125'],
    }) as { isError?: boolean };
    expect(documentsOnly.isError).toBeFalsy();
    expect(JSON.parse(textOf(documentsOnly))).toMatchObject({
      entity_types: ['documents'],
      results: [expect.objectContaining({ entity_type: 'document', title: 'Alpha Project' })],
    });

    const narrowed = await disabledServer.getHandler('search')({
      query: 'alpha',
      mode: 'filesystem',
      entity_types: ['documents', 'memories'],
      tags: ['phase125'],
    }) as { isError?: boolean };
    expect(narrowed.isError).toBeFalsy();
    expect(JSON.parse(textOf(narrowed))).toMatchObject({
      entity_types: ['documents'],
      warnings: ['memory_category_disabled'],
      results: [expect.objectContaining({ entity_type: 'document', title: 'Alpha Project' })],
    });

    const result = await disabledServer.getHandler('search')({
      query: 'alpha',
      entity_types: ['memories'],
    }) as { isError?: boolean };
    expect(result.isError).toBe(false);
    expect(JSON.parse(textOf(result))).toMatchObject({
      error: 'unsupported',
      identifier: 'memories',
      details: { disabled_category: 'memory' },
    });
  });
});
