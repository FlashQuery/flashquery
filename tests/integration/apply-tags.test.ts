/**
 * Integration tests: apply_tags tag validation and normalization (Plan 25-02).
 * Verifies: final set validation, normalization, document and memory paths.
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
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const SKIP = !HAS_SUPABASE;

const TEST_INSTANCE_ID = 'tag-test-apply-tags-id';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'tag-test-apply-tags',
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

describe.skipIf(SKIP)('apply_tags tag validation (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-tag-apply-'));
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
      .from('fqc_memory')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('apply_tags normalizes added tags in vault AND DB', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // Create a document
    const createResult = await getHandler('create_document')({
      title: 'Apply Tags Norm Test',
      content: 'Content.',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]{36})/);
    if (!fqcIdMatch) {
      throw new Error(`Expected FQC ID in response, got:\n${createResult.content[0].text}`);
    }
    const fqcId = fqcIdMatch[1];
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // Apply tags with mixed-case input
    const applyResult = await getHandler('apply_tags')({
      identifiers: docVaultPath,
      add_tags: [' MixedCase ', 'UPPER'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(applyResult.isError).toBeUndefined();

    // Verify vault frontmatter has normalized tags
    const rawFile = await readFile(join(vaultPath, docVaultPath), 'utf-8');
    const parsed = matter(rawFile);
    const vaultTags: string[] = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
    expect(vaultTags).toContain('mixedcase');
    expect(vaultTags).toContain('upper');
    expect(vaultTags).not.toContain(' MixedCase ');

    // Verify DB has normalized tags
    const { data: updatedRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('tags').eq('id', fqcId).single();
    const dbTags: string[] = (updatedRow as { tags: string[] }).tags ?? [];
    expect(dbTags).toContain('mixedcase');
    expect(dbTags).toContain('upper');

    // Vault and DB must be in sync
    expect(vaultTags.sort()).toEqual(dbTags.sort());
  });

  it('apply_tags adding conflicting status tag reports failure in results', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // Create a document with tag 'dup' already present
    const createResult = await getHandler('create_document')({
      title: 'Apply Tags Dup Test',
      content: 'Content.',
      tags: ['dup'],
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]{36})/);
    if (!fqcIdMatch) {
      throw new Error(`Expected FQC ID in response, got:\n${createResult.content[0].text}`);
    }
    const fqcId = fqcIdMatch[1];
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // Try to add the same tag again — final set would have normalized duplicate
    // Since applyTagChanges uses a Set, duplicates are deduped before validation
    // So test: adding an unnormalized version of existing tag creates a scenario
    // where after normalization the add results in a clean set (Set-dedup handles it)
    // Instead test with a truly invalid final: force a status conflict
    const result = await getHandler('apply_tags')({
      identifiers: docVaultPath,
      add_tags: ['#status/published'],  // doc already has #status/active from create_document
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Per-item errors reported in results text (batch identifiers mode)
    expect(result.content[0].text).toContain('Tag validation failed');
    expect(result.content[0].text).toContain('conflicting statuses');
  });

  it('apply_tags with final set having conflicting statuses returns failure in results', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    // Create a document (gets #status/active automatically)
    const createResult = await getHandler('create_document')({
      title: 'Apply Tags Conflict Test',
      content: 'Content.',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(createResult.isError).toBeUndefined();

    const fqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]{36})/);
    if (!fqcIdMatch) {
      throw new Error(`Expected FQC ID in response, got:\n${createResult.content[0].text}`);
    }
    const fqcId = fqcIdMatch[1];
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents').select('path').eq('id', fqcId).single();
    const docVaultPath = (docRow as { path: string }).path;

    // Adding another status tag would conflict with existing #status/active
    const result = await getHandler('apply_tags')({
      identifiers: docVaultPath,
      add_tags: ['#status/archived'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Per-item errors reported in results text (batch identifiers mode)
    expect(result.content[0].text).toContain('conflicting statuses');
  });

  it('apply_tags on memory with conflicting statuses returns isError', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);
    registerCompoundTools(server, config);

    // Create a memory with #status/active
    const saveResult = await getHandler('save_memory')({
      content: 'Memory for tag conflict test.',
      tags: ['#status/active'],
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(saveResult.isError).toBeUndefined();

    const idMatch = saveResult.content[0].text.match(/id: ([a-f0-9-]{36})/);
    if (!idMatch) {
      throw new Error(`Expected memory id in response, got:\n${saveResult.content[0].text}`);
    }
    const memId = idMatch[1];

    // Try to add a second status tag
    const result = await getHandler('apply_tags')({
      memory_id: memId,
      add_tags: ['#status/archived'],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('conflicting statuses');
  });
});
