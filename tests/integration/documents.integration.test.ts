/**
 * Integration tests for document embedding (Phase 10).
 * Requires: supabase start, valid embedding API key in env.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import matter from 'gray-matter';
import { FM } from '../../src/constants/frontmatter-fields.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding, embeddingProvider } from '../../src/embedding/provider.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, TEST_OPENAI_API_KEY, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const EMBEDDING_API_KEY = TEST_OPENAI_API_KEY;
const SKIP = !HAS_SUPABASE || !EMBEDDING_API_KEY;

function makeIntegrationConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'integration-test', id: 'integration-test-id', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: EMBEDDING_API_KEY, dimensions: 1536 },
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

describe.skipIf(SKIP)('Document Embedding Integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-integration-'));
    config = makeIntegrationConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  });

  afterAll(async () => {
    // Clean up test documents from fqc_documents
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', 'integration-test-id');
    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', 'integration-test-id');
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('DEMB-01: create_document inserts fqc_documents row with content_hash', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const result = await getHandler('create_document')({
      title: 'Integration Test Doc',
      content: 'This is a test document for embedding integration.',
      project: 'IntegrationTest',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('FQC ID:');

    // Extract fqc_id from response
    const fqcIdMatch = result.content[0].text.match(/FQC ID: ([a-f0-9-]+)/);
    expect(fqcIdMatch).not.toBeNull();
    const fqcId = fqcIdMatch![1];

    // Verify fqc_documents row was inserted
    const { data, error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id, content_hash, path, title')
      .eq('id', fqcId)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.content_hash).toBeTruthy();
    expect(data!.title).toBe('Integration Test Doc');
    expect(data!.path).toContain('Integration Test Doc');
  });

  it('DEMB-03: search_documents semantic returns results after embedding completes', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    // Create a document and wait for fire-and-forget embedding
    const createResult = await getHandler('create_document')({
      title: 'Quantum Computing Overview',
      content: 'Quantum computers use qubits and superposition to solve problems exponentially faster than classical computers.',
      project: 'IntegrationTest',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Extract the fqc_id so we can poll for THIS document's embedding specifically.
    // Polling for ANY document in the instance would exit early on DEMB-01's embedding.
    const quantumFqcIdMatch = createResult.content[0].text.match(/FQC ID: ([a-f0-9-]+)/);
    expect(quantumFqcIdMatch).not.toBeNull();
    const quantumFqcId = quantumFqcIdMatch![1];

    // Wait for fire-and-forget embedding to complete for THIS document (up to 10 seconds)
    let embedding: unknown = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('embedding')
        .eq('id', quantumFqcId)
        .not('embedding', 'is', null)
        .limit(1);
      if (data && data.length > 0) { embedding = data[0].embedding; break; }
    }
    expect(embedding).not.toBeNull();

    // Semantic search should find the document
    const searchResult = await getHandler('search_documents')({
      query: 'how do quantum computers use qubits and superposition',
      mode: 'semantic',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(searchResult.isError).toBeUndefined();
    expect(searchResult.content[0].text).toContain('Quantum Computing Overview');
    expect(searchResult.content[0].text).toMatch(/Match: \d+%/);
  });
});

/**
 * Integration tests for search_documents status filtering (STAT-04, STAT-05).
 * Uses filesystem-mode search (no embedding required) with real vault files.
 * Requires Supabase for provisioning but embedding is optional.
 */
describe.skipIf(!HAS_SUPABASE)('search_documents status filtering (STAT-04, STAT-05, STAT-10)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  function makeNoEmbedConfig(vp: string): FlashQueryConfig {
    return {
      instance: { name: 'stat-filter-test', id: 'stat-filter-test-id', vault: { path: vp, markdownExtensions: ['.md'] } },
      supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
      embedding: { provider: 'none' as never, model: '', apiKey: '', dimensions: 1536 },
      logging: { level: 'error', output: 'stdout' },
      locking: { enabled: false, ttlSeconds: 30 },
    } as unknown as FlashQueryConfig;
  }

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-stat-filter-'));
    config = makeNoEmbedConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  });

  afterAll(async () => {
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', 'stat-filter-test-id');
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('STAT-04/STAT-05: search_documents excludes archived, includes active and custom status', async () => {
    // Write test documents with various status values directly to vault
    await mkdir(join(vaultPath, 'Work'), { recursive: true });

    await writeFile(join(vaultPath, 'Work', 'active-doc.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Active Document', [FM.STATUS]: 'active', [FM.TAGS]: [] }));
    await writeFile(join(vaultPath, 'Work', 'custom-doc.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Custom Status Document', [FM.STATUS]: 'in-review', [FM.TAGS]: [] }));
    await writeFile(join(vaultPath, 'Work', 'archived-doc.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Archived Document', [FM.STATUS]: 'archived', [FM.TAGS]: [] }));
    await writeFile(join(vaultPath, 'Work', 'null-status-doc.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Null Status Document', [FM.TAGS]: [] }));

    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    // Filesystem mode search (no query = list all non-archived)
    const result = await getHandler('search_documents')({ mode: 'filesystem' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    // Active and custom status appear in results
    expect(result.content[0].text).toContain('Active Document');
    expect(result.content[0].text).toContain('Custom Status Document');
    // Null status implicitly non-archived (treated as active per D-02a)
    expect(result.content[0].text).toContain('Null Status Document');
    // Archived is excluded (STAT-05: status != 'archived')
    expect(result.content[0].text).not.toContain('Archived Document');
  });

  it('STAT-10: case-insensitive archived filtering excludes Archived/ARCHIVED/Archived', async () => {
    await mkdir(join(vaultPath, 'CaseTest'), { recursive: true });

    await writeFile(join(vaultPath, 'CaseTest', 'case-upper.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'ARCHIVED Case Upper', [FM.STATUS]: 'ARCHIVED', [FM.TAGS]: [] }));
    await writeFile(join(vaultPath, 'CaseTest', 'case-mixed.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Archived Case Mixed', [FM.STATUS]: 'Archived', [FM.TAGS]: [] }));
    await writeFile(join(vaultPath, 'CaseTest', 'case-normal.md'),
      matter.stringify('Body.', { [FM.TITLE]: 'Normal Active', [FM.STATUS]: 'active', [FM.TAGS]: [] }));

    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const result = await getHandler('search_documents')({ mode: 'filesystem' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    // Both uppercase and mixed-case "archived" documents should be excluded
    expect(result.content[0].text).not.toContain('ARCHIVED Case Upper');
    expect(result.content[0].text).not.toContain('Archived Case Mixed');
    // Normal active doc should appear
    expect(result.content[0].text).toContain('Normal Active');
  });
});
