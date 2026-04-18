/**
 * Integration tests: update_doc_header tag validation and D-07 conflict detection (Plan 25-02).
 * Verifies: tag normalization, conflict rejection, D-07 existing conflict detection.
 * Requires: Supabase running, SUPABASE_SERVICE_ROLE_KEY set.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const SKIP = !HAS_SUPABASE;

const TEST_INSTANCE_ID = 'tag-test-update-header-id';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'tag-test-update-header',
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

describe.skipIf(SKIP)('update_doc_header tag validation (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-tag-header-'));
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

  it('update_doc_header normalizes tag updates in both vault AND DB', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // First create a document
    const createResult = await getHandler('create_document')({
      title: 'Header Tag Test',
      content: 'Content.',
      tags: ['existing'],
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]+)/);
    expect(fqcIdMatch).not.toBeNull();
    const fqcId = fqcIdMatch![1];

    // Get vault path from DB
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // Update tags with mixed-case input
    const updateResult = await getHandler('update_doc_header')({
      identifier: docVaultPath,
      updates: { tags: [' MixedCase ', 'UPPER'] },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(updateResult.isError).toBeUndefined();

    // Verify vault frontmatter has normalized tags
    const rawFile = await readFile(join(vaultPath, docVaultPath), 'utf-8');
    const parsed = matter(rawFile);
    const vaultTags: string[] = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
    expect(vaultTags).toContain('mixedcase');
    expect(vaultTags).toContain('upper');
    expect(vaultTags).not.toContain(' MixedCase ');

    // Verify DB also has normalized tags
    const { data: updatedRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('tags').eq('id', fqcId).single();
    const dbTags: string[] = (updatedRow as { tags: string[] }).tags ?? [];
    expect(dbTags).toContain('mixedcase');
    expect(dbTags).toContain('upper');

    // Both vault and DB must match
    expect(vaultTags.sort()).toEqual(dbTags.sort());
  });

  it('update_doc_header with multiple #status/* tags in updates succeeds (D-06: no conflict rejection)', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // Create a document first
    const createResult = await getHandler('create_document')({
      title: 'Header Conflict Test',
      content: 'Content.',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]+)/);
    const fqcId = fqcIdMatch![1];
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // D-06: multiple #status/* tags are treated like any other tag — update succeeds
    const result = await getHandler('update_doc_header')({
      identifier: docVaultPath,
      updates: { tags: ['#status/draft', '#status/published'] },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('conflicting statuses');
  });

  it('update_doc_header with document containing multiple #status/* tags proceeds normally (D-06)', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // Create a document
    const createResult = await getHandler('create_document')({
      title: 'D07 Conflict Test',
      content: 'Content.',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]+)/);
    const fqcId = fqcIdMatch![1];
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // Manually set multiple #status/* tags in vault (D-06: no conflict rejection)
    const rawFile = await readFile(join(vaultPath, docVaultPath), 'utf-8');
    const parsed = matter(rawFile);
    parsed.data.tags = ['#status/active', '#status/archived'];
    const corruptedRaw = matter.stringify(parsed.content, parsed.data);
    await writeFile(join(vaultPath, docVaultPath), corruptedRaw, 'utf-8');

    // D-06: update proceeds normally even with multiple status tags present
    const result = await getHandler('update_doc_header')({
      identifier: docVaultPath,
      updates: { title: 'New Title' },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('conflicting statuses');
  });
});
