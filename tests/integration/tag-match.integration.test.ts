/**
 * Integration tests for tag_match behavior across search_documents, list_memories.
 *
 * Validates that the tag_match=any / tag_match=all parameter is correctly
 * applied against real data in Supabase. Requires credentials in .env.test.
 *
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

import { HAS_SUPABASE, TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL } from '../helpers/test-env.js';

const describeIf = HAS_SUPABASE ? describe : describe.skip;

// Unique instance ID per test run to prevent cross-test pollution
const INSTANCE_ID = `tag-match-integration-${randomUUID().slice(0, 8)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'tag-match-integration-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true, // DDL already run; skip for integration tests
    },
    server: { host: 'localhost', port: 3100 },
    embedding: {
      provider: 'none' as const,
      model: '',
      apiKey: '',
      dimensions: 1536,
    },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (
      _name: string,
      _cfg: unknown,
      handler: (params: Record<string, unknown>) => Promise<unknown>
    ) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content[0]?.text ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for tag_match
// ─────────────────────────────────────────────────────────────────────────────

describeIf('tag_match integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let mockServer: ReturnType<typeof createMockServer>;

  // Memory IDs seeded for cleanup
  const seededMemoryIds: string[] = [];

  beforeAll(async () => {
    // Init logger (suppressed)
    initLogger({ level: 'error', output: 'stdout' });

    // Create temp vault
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-tag-match-'));
    config = makeConfig(vaultPath);

    // Init Supabase
    await initSupabase(config);

    // Init embedding (none provider — no API key needed)
    initEmbedding(config);

    // Init vault
    initVault(config);

    // Create mock server and register tools
    mockServer = createMockServer();
    registerDocumentTools(mockServer.server, config);
    registerMemoryTools(mockServer.server, config);

    // Seed vault documents with known tags
    // Doc A: tags=[tag-a, tag-b]
    // Doc B: tags=[tag-b, tag-c]
    // Doc C: tags=[tag-d]
    const docs = [
      { name: 'doc-a.md', title: 'Doc A', tags: ['tag-a', 'tag-b'] },
      { name: 'doc-b.md', title: 'Doc B', tags: ['tag-b', 'tag-c'] },
      { name: 'doc-c.md', title: 'Doc C', tags: ['tag-d'] },
    ];
    for (const doc of docs) {
      const fqcId = randomUUID();
      const fm = { fq_title: doc.title, fq_id: fqcId, fq_status: 'active', fq_tags: doc.tags };
      const raw = matter.stringify(`Body of ${doc.title}.`, fm);
      await mkdir(join(vaultPath, '_global'), { recursive: true });
      await writeFile(join(vaultPath, '_global', doc.name), raw, 'utf-8');
    }

    // Seed memories with known tags
    // Mem A: tags=[tag-x, tag-y]
    // Mem B: tags=[tag-y, tag-z]
    const memorySeeds = [
      { content: 'Memory about topic X and Y', tags: ['tag-x', 'tag-y'] },
      { content: 'Memory about topic Y and Z', tags: ['tag-y', 'tag-z'] },
    ];
    for (const mem of memorySeeds) {
      const id = randomUUID();
      seededMemoryIds.push(id);
      await supabaseManager.getClient().from('fqc_memory').insert({
        id,
        instance_id: INSTANCE_ID,
        content: mem.content,
        tags: mem.tags,
        status: 'active',
        plugin_scope: 'global',
        version: 1,
        embedding: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  });

  afterAll(async () => {
    // Clean up seeded memories
    if (seededMemoryIds.length > 0) {
      await supabaseManager.getClient()
        .from('fqc_memory')
        .delete()
        .in('id', seededMemoryIds)
        .eq('instance_id', INSTANCE_ID);
    }
  });

  // ── search_documents filesystem tag_match tests ────────────────────────────

  it('search_documents filesystem: tag_match=any returns docs with at least one tag', async () => {
    const handler = mockServer.getHandler('search_documents');
    const result = await handler({
      tags: ['tag-a', 'tag-c'],
      tag_match: 'any',
      mode: 'filesystem',
    });
    const text = getText(result);

    // Doc A has tag-a, Doc B has tag-c — both should match
    expect(text).toContain('Doc A');
    expect(text).toContain('Doc B');
    // Doc C has only tag-d — should NOT match
    expect(text).not.toContain('Doc C');
  });

  it('search_documents filesystem: tag_match=all returns only docs with every tag', async () => {
    const handler = mockServer.getHandler('search_documents');
    const result = await handler({
      tags: ['tag-a', 'tag-b'],
      tag_match: 'all',
      mode: 'filesystem',
    });
    const text = getText(result);

    // Only Doc A has BOTH tag-a and tag-b
    expect(text).toContain('Doc A');
    // Doc B has tag-b but not tag-a — should NOT match
    expect(text).not.toContain('Doc B');
    // Doc C has neither — should NOT match
    expect(text).not.toContain('Doc C');
  });

  it('search_documents filesystem: tag_match defaults to any when omitted', async () => {
    const handler = mockServer.getHandler('search_documents');
    const result = await handler({
      tags: ['tag-a', 'tag-c'],
      mode: 'filesystem',
      // No tag_match — should default to 'any'
    });
    const text = getText(result);

    // With any-match: Doc A (has tag-a) and Doc B (has tag-c) should both appear
    expect(text).toContain('Doc A');
    expect(text).toContain('Doc B');
  });

  // ── list_memories tag_match tests ─────────────────────────────────────────

  it('list_memories: default tag_match is any — returns mems with at least one tag', async () => {
    const handler = mockServer.getHandler('list_memories');
    const result = await handler({
      tags: ['tag-x', 'tag-z'],
      // No tag_match — should default to 'any'
    });
    const text = getText(result);

    // Mem A has tag-x, Mem B has tag-z — both should match with ANY
    expect(text).toContain('Memory about topic X and Y');
    expect(text).toContain('Memory about topic Y and Z');
  });

  it('list_memories: tag_match=all filters strictly — requires every tag', async () => {
    const handler = mockServer.getHandler('list_memories');
    const result = await handler({
      tags: ['tag-x', 'tag-y'],
      tag_match: 'all',
    });
    const text = getText(result);

    // Only Mem A has BOTH tag-x and tag-y
    expect(text).toContain('Memory about topic X and Y');
    // Mem B has tag-y but not tag-x — should NOT match
    expect(text).not.toContain('Memory about topic Y and Z');
  });

  it('list_memories: tag_match=any returns both when sharing one tag', async () => {
    const handler = mockServer.getHandler('list_memories');
    const result = await handler({
      tags: ['tag-y'],
      tag_match: 'any',
    });
    const text = getText(result);

    // Both Mem A and Mem B have tag-y
    expect(text).toContain('Memory about topic X and Y');
    expect(text).toContain('Memory about topic Y and Z');
  });
});
