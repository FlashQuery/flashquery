/**
 * Integration tests for the search_all compound tool.
 *
 * Validates cross-entity search behavior against the filesystem (documents)
 * and Supabase (memories). Semantic search tests require an embedding API key;
 * they are guarded by HAS_EMBEDDINGS and skip gracefully when absent.
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
import { initPlugins } from '../../src/plugins/manager.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

import {
  HAS_SUPABASE,
  TEST_SUPABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_DATABASE_URL,
} from '../helpers/test-env.js';

const describeIf = HAS_SUPABASE ? describe : describe.skip;

// Unique instance ID per test run
const INSTANCE_ID = `search-all-integration-${randomUUID().slice(0, 8)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'search-all-integration-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    server: { host: 'localhost', port: 3100 },
    // No embedding provider — exercises filesystem fallback for documents
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

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for search_all
// ─────────────────────────────────────────────────────────────────────────────

describeIf('search_all integration (no-embedding, filesystem fallback)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let mockServer: ReturnType<typeof createMockServer>;

  const seededMemoryIds: string[] = [];

  beforeAll(async () => {
    initLogger({ level: 'error', output: 'stdout' });

    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-search-all-'));
    config = makeConfig(vaultPath);

    await initSupabase(config);
    initEmbedding(config);
    initVault(config);
    await initPlugins(config);

    mockServer = createMockServer();
    registerCompoundTools(mockServer.server, config);

    // Seed vault documents
    const docs = [
      { name: 'alpha-project.md', title: 'Alpha Project', tags: ['project-alpha', 'active'] },
      { name: 'beta-notes.md', title: 'Beta Notes', tags: ['project-beta'] },
    ];
    await mkdir(join(vaultPath, '_global'), { recursive: true });
    for (const doc of docs) {
      const fqcId = randomUUID();
      const fm = { title: doc.title, fqc_id: fqcId, status: 'active', tags: doc.tags };
      const raw = matter.stringify(`Body of ${doc.title}.`, fm);
      await writeFile(join(vaultPath, '_global', doc.name), raw, 'utf-8');
    }

    // Seed memories
    const memSeeds = [
      { content: 'Alpha project memory note', tags: ['project-alpha'] },
      { content: 'Beta project memory note', tags: ['project-beta'] },
    ];
    for (const mem of memSeeds) {
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
    if (seededMemoryIds.length > 0) {
      await supabaseManager.getClient()
        .from('fqc_memory')
        .delete()
        .in('id', seededMemoryIds)
        .eq('instance_id', INSTANCE_ID);
    }
  });

  it('search_all returns documents section (filesystem fallback) when no embeddings', async () => {
    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'alpha' });
    const text = getText(result);

    // Should contain filesystem-fallback document section
    expect(text).toContain('filesystem search — semantic unavailable');
    // Should match "Alpha" document by title substring
    expect(text).toContain('Alpha Project');
    // Memories section should note embedding requirement
    expect(text).toContain('Memory search requires embedding configuration');
    expect(isError(result)).toBe(false);
  });

  it('search_all entity_types=["documents"] returns no memories section', async () => {
    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'beta', entity_types: ['documents'] });
    const text = getText(result);

    // Documents section present
    expect(text).toContain('filesystem search — semantic unavailable');
    // No memories section
    expect(text).not.toContain('=== Memories');
    expect(isError(result)).toBe(false);
  });

  it('search_all entity_types=["memories"] with no embeddings returns isError', async () => {
    const handler = mockServer.getHandler('search_all');
    const result = await handler({ query: 'alpha', entity_types: ['memories'] });

    // Memory-only with no embeddings: isError true
    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toContain('Memory search requires semantic embeddings');
  });

  it('search_all respects tags filter in filesystem fallback', async () => {
    const handler = mockServer.getHandler('search_all');
    const result = await handler({
      query: 'project',
      tags: ['project-alpha'],
      tag_match: 'any',
    });
    const text = getText(result);

    // Should only match Alpha doc (has project-alpha tag)
    expect(text).toContain('Alpha Project');
    // Beta doc has project-beta tag, not project-alpha
    expect(text).not.toContain('Beta Notes');
  });
});
