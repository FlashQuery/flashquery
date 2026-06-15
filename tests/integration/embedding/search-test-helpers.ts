import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../../src/config/types.js';
import { FM } from '../../../src/constants/frontmatter-fields.js';
import { initLogger } from '../../../src/logging/logger.js';
import { registerCompoundTools } from '../../../src/mcp/tools/compound.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

export interface CapturedSearchServer {
  search(params: Record<string, unknown>): Promise<unknown>;
}

export interface EmbeddingSearchHarness {
  config: FlashQueryConfig;
  client: pg.Client;
  vaultPath: string;
  server: CapturedSearchServer;
}

export function makeEmbeddingSearchConfig(input: {
  instanceId: string;
  vaultPath: string;
  entries: Array<{ name: string; dimensions?: number; status?: 'active' | 'deactivated' }>;
}): FlashQueryConfig {
  return {
    instance: {
      name: input.instanceId,
      id: input.instanceId,
      vault: { path: input.vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: '127.0.0.1', port: 3100 },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, lockTimeoutSeconds: 10 },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    llm: {
      providers: [{ name: 'search_provider', type: 'openai', endpoint: 'https://embedding.test', apiKey: 'sk-test' }],
      models: [],
      purposes: [],
    },
    embeddings: input.entries.map((entry) => ({
      name: entry.name,
      dimensions: entry.dimensions ?? 3,
      endpoints: [{ providerName: 'search_provider', model: `model-${entry.name}` }],
    })),
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
  };
}

export function captureSearchServer(config: FlashQueryConfig): CapturedSearchServer {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerCompoundTools(server, config);
  return {
    search: (params) => handlers.search!(params),
  };
}

export function parseToolJson<T>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as T;
}

export async function createEmbeddingSearchHarness(input: {
  instanceId: string;
  entries: Array<{ name: string; dimensions?: number; status?: 'active' | 'deactivated' }>;
}): Promise<EmbeddingSearchHarness> {
  const vaultPath = await mkdtemp(join(tmpdir(), `${input.instanceId}-`));
  const config = makeEmbeddingSearchConfig({ ...input, vaultPath });
  initLogger(config);
  await initSupabase(config);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await resetEmbeddingSearchData(client, input.instanceId, config.embeddings?.map((entry) => entry.name) ?? []);
  for (const entry of config.embeddings ?? []) {
    await createCoreEmbeddingColumnSet(config, entry);
  }
  for (const entry of input.entries) {
    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, $3, $4::jsonb, 'yaml', $5)`,
      [
        input.instanceId,
        entry.name,
        entry.dimensions ?? 3,
        JSON.stringify([{ provider_name: 'search_provider', model: `model-${entry.name}` }]),
        entry.status ?? 'active',
      ]
    );
  }
  return { config, client, vaultPath, server: captureSearchServer(config) };
}

export async function destroyEmbeddingSearchHarness(harness: EmbeddingSearchHarness, entryNames: string[]): Promise<void> {
  await resetEmbeddingSearchData(harness.client, harness.config.instance.id, entryNames).catch(() => undefined);
  await harness.client.end().catch(() => undefined);
  await rm(harness.vaultPath, { recursive: true, force: true }).catch(() => undefined);
}

export async function resetEmbeddingSearchData(client: pg.Client, instanceId: string, entryNames: string[]): Promise<void> {
  await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [instanceId]);
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [instanceId]);
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [instanceId]);
  for (const name of entryNames) {
    for (const table of ['fqc_chunks', 'fqc_memory']) {
      await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_${name}`);
      for (const suffix of ['', '_model', '_dimensions', '_provider', '_truncated', '_indexed_at']) {
        await client.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`embedding_${name}${suffix}`)} CASCADE`
        );
      }
    }
    await client.query(`DROP FUNCTION IF EXISTS ${pg.escapeIdentifier(`match_memories_${name}`)}(vector, double precision, integer, text[], text, text, boolean) CASCADE`);
    await client.query(`DROP FUNCTION IF EXISTS ${pg.escapeIdentifier(`match_documents_${name}`)}(vector, double precision, integer, text, text[], text, boolean) CASCADE`);
  }
}

export async function addSearchDocument(input: {
  harness: EmbeddingSearchHarness;
  id?: string;
  path: string;
  title: string;
  vectorByEntry?: Record<string, number[]>;
}): Promise<string> {
  const id = input.id ?? randomUUID();
  await mkdir(join(input.harness.vaultPath, input.path, '..'), { recursive: true });
  await writeFile(
    join(input.harness.vaultPath, input.path),
    matter.stringify(`Body for ${input.title}`, {
      [FM.ID]: id,
      [FM.TITLE]: input.title,
      [FM.STATUS]: 'active',
      [FM.TAGS]: ['search166'],
    }),
    'utf-8'
  );
  await input.harness.client.query(
    `INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [id, input.harness.config.instance.id, input.path, input.title, ['search166']]
  );
  const chunkId = randomUUID();
  await input.harness.client.query(
    `INSERT INTO fqc_chunks (
       id, instance_id, document_id, heading_path, heading_level, breadcrumb,
       content, content_hash, chunk_index
     )
     VALUES ($1, $2, $3, $4, 1, $4, $5, $6, 0)`,
    [chunkId, input.harness.config.instance.id, id, input.title, `Body for ${input.title}`, `hash-${chunkId}`]
  );
  for (const [entryName, vector] of Object.entries(input.vectorByEntry ?? {})) {
    await input.harness.client.query(
      `UPDATE fqc_chunks
       SET ${pg.escapeIdentifier(`embedding_${entryName}`)} = $1::vector,
           ${pg.escapeIdentifier(`embedding_${entryName}_model`)} = $2,
           ${pg.escapeIdentifier(`embedding_${entryName}_dimensions`)} = $3,
           ${pg.escapeIdentifier(`embedding_${entryName}_provider`)} = 'search-provider',
           ${pg.escapeIdentifier(`embedding_${entryName}_truncated`)} = false,
           ${pg.escapeIdentifier(`embedding_${entryName}_indexed_at`)} = now()
       WHERE id = $4`,
      [`[${vector.join(',')}]`, `model-${entryName}`, vector.length, chunkId]
    );
  }
  return id;
}
