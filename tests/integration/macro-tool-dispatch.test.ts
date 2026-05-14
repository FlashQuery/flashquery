import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = 'macro-tool-dispatch-integration';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Tool Dispatch Integration',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: { tools: ['write_document', 'search', 'call_macro'] },
    llm: { providers: [], models: [], purposes: [] },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
  } as FlashQueryConfig;
}

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('macro native tool dispatch integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: Client;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fq-macro-tool-dispatch-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const server = createMcpServer(config, '0.1.0');
    client = new Client({ name: 'macro-tool-dispatch-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 30000);

  afterAll(async () => {
    await client?.close();
    try {
      const supabase = supabaseManager.getClient();
      await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabase.from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
      await supabase.from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Setup may fail before the singleton is initialized; cleanup remains best effort.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('T-I-003 dispatches real fq.write_document through call_macro and persists fqc_documents lifecycle', async () => {
    const result = await client.callTool({
      name: 'call_macro',
      arguments: {
        source: `
          fq.write_document({
            mode: "create",
            path: "macro-dispatch/write-document.md",
            title: "Macro Dispatch Write Document",
            content: "Created by fq.write_document inside call_macro.",
            tags: ["macro-tool-dispatch"]
          })
        `,
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = parseToolText(result);
    expect(payload).toMatchObject({
      task_id: expect.any(String),
      result: null,
    });

    const { data, error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('path,title,lifecycle_state')
      .eq('instance_id', INSTANCE_ID)
      .eq('path', 'macro-dispatch/write-document.md')
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      path: 'macro-dispatch/write-document.md',
      title: 'Macro Dispatch Write Document',
      lifecycle_state: 'active',
    });
  });

  it('T-I-004 dispatches real fq.search through call_macro and returns canonical search result shape', async () => {
    await client.callTool({
      name: 'call_macro',
      arguments: {
        source: `
          fq.write_document({
            mode: "create",
            path: "macro-dispatch/search-target.md",
            title: "Macro Dispatch Search Target",
            content: "Searchable content from macro dispatch integration.",
            tags: ["macro-tool-dispatch-search"]
          })
        `,
      },
    });

    const result = await client.callTool({
      name: 'call_macro',
      arguments: {
        source: `
          exit fq.search({
            query: "",
            mode: "filesystem",
            entity_types: ["documents"],
            tags: ["macro-tool-dispatch-search"]
          })
        `,
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = parseToolText(result);
    expect(payload.result).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'document',
          title: 'Macro Dispatch Search Target',
        }),
      ]),
      counts: expect.any(Object),
    });
  });
});
