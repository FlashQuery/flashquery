/**
 * Integration tests: create_document tag normalization and validation (Plan 25-02).
 * Verifies Pitfall 1 prevention: normalized tags appear in BOTH vault frontmatter AND database.
 * Requires: Supabase running, SUPABASE_SERVICE_ROLE_KEY set.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const SKIP = !HAS_SUPABASE;

const TEST_INSTANCE_ID = 'tag-test-create-doc-id';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'tag-test-create-doc',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
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

describe.skipIf(SKIP)('create_document tag normalization (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-tag-create-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  });

  afterAll(async () => {
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('create_document normalizes tags in both vault frontmatter AND database (Pitfall 1 prevention)', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    // Input has mixed case and whitespace — should be normalized silently
    const result = await getHandler('create_document')({
      title: 'Tag Norm Test',
      content: 'Integration test content.',
      tags: [' MixedCase ', 'UPPER', '  spaced  '],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Document created');

    // Extract fqc_id from response
    const fqcIdMatch = result.content[0].text.match(/FQC ID: ([a-f0-9-]{36})/);
    if (!fqcIdMatch) {
      throw new Error(`Expected FQC ID in response, got:\n${result.content[0].text}`);
    }
    const fqcId = fqcIdMatch[1];

    // Verify DB row has normalized tags
    const { data: dbRow, error: dbError } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id, tags, path')
      .eq('id', fqcId)
      .single();

    expect(dbError).toBeNull();
    expect(dbRow).not.toBeNull();
    const dbTags: string[] = dbRow!.tags ?? [];
    expect(dbTags).toContain('mixedcase');
    expect(dbTags).toContain('upper');
    expect(dbTags).toContain('spaced');
    expect(dbTags).not.toContain(' MixedCase ');
    expect(dbTags).not.toContain('UPPER');

    // Verify vault frontmatter ALSO has normalized tags (Pitfall 1 prevention)
    const rawFile = await readFile(join(vaultPath, dbRow!.path), 'utf-8');
    const parsed = matter(rawFile);
    const vaultTags: string[] = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
    expect(vaultTags).toContain('mixedcase');
    expect(vaultTags).toContain('upper');
    expect(vaultTags).toContain('spaced');
    expect(vaultTags).not.toContain(' MixedCase ');

    // Both vault and DB must match (synchronized)
    expect(vaultTags.sort()).toEqual(dbTags.sort());
  });

  it('create_document rejects duplicate tags with isError', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const result = await getHandler('create_document')({
      title: 'Dup Tag Rejection',
      content: 'Content.',
      tags: ['duplicate', 'duplicate'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tag validation failed');
    expect(result.content[0].text).toContain("Tag 'duplicate' appears multiple times");
  });

  it('create_document rejects conflicting status tags with isError', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const result = await getHandler('create_document')({
      title: 'Conflict Status Rejection',
      content: 'Content.',
      tags: ['#status/draft', '#status/published'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tag validation failed');
    expect(result.content[0].text).toContain('conflicting statuses');
  });
});
