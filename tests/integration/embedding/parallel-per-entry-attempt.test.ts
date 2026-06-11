import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import type { FlashQueryConfig } from '../../../src/config/types.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';
import {
  createPluginRecordHarness,
  destroyPluginRecordHarness,
  pluginRecordYaml,
  textOf,
  type PluginRecordHarness,
} from '../plugin-record-embedding-helpers.js';

const providerState = vi.hoisted(() => ({
  calls: [] as Array<{ entryName: string; text: string }>,
}));

vi.mock('../../../src/embedding/provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/embedding/provider.js')>('../../../src/embedding/provider.js');
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn((_config, entry: { name: string; dimensions: number }) => ({
      embed: vi.fn(async (text: string) => {
        providerState.calls.push({ entryName: entry.name, text });
        return Array.from({ length: entry.dimensions }, (_, index) => (index + 1) / 10);
      }),
      getDimensions: () => entry.dimensions,
      getProviderInfo: () => ({ provider: 'mock-provider', model: `${entry.name}-model` }),
      getLastEmbeddingMetadata: () => ({ truncated: false, warnings: [] }),
    })),
  };
});

const TEST_INSTANCE_ID = 'phase-166-parallel-entry';
const ENTRY_NAMES = ['primary', 'analysis'] as const;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-166-parallel-entry', markdownExtensions: ['.md'] },
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
      providers: [],
      models: [],
      purposes: [],
    },
    embeddings: ENTRY_NAMES.map((name) => ({
      name,
      dimensions: 3,
      endpoints: [{ providerName: `provider-${name}`, model: `model-${name}` }],
    })),
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
  };
}

function providerFor(name: string, hooks?: { onStart?: (name: string) => void; waitMs?: number }): EmbeddingProvider {
  return {
    embed: vi.fn(async () => {
      hooks?.onStart?.(name);
      if (hooks?.waitMs) {
        await new Promise((resolve) => setTimeout(resolve, hooks.waitMs));
      }
      return name === 'primary' ? [0.1, 0.2, 0.3] : [0.4, 0.5, 0.6];
    }),
    getDimensions: () => 3,
    getProviderInfo: () => ({ provider: `provider-${name}`, model: `model-${name}` }),
  };
}

async function dropEntryColumns(client: pg.Client): Promise<void> {
  for (const name of ENTRY_NAMES) {
    for (const table of ['fqc_documents', 'fqc_memory']) {
      await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_${name}`);
      for (const suffix of ['', '_model', '_dimensions', '_provider', '_truncated']) {
        await client.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`embedding_${name}${suffix}`)} CASCADE`
        );
      }
    }
  }
}

describe.skipIf(!HAS_SUPABASE).sequential('parallel per-entry embedding attempts', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await dropEntryColumns(client);
    for (const entry of config.embeddings ?? []) {
      await createCoreEmbeddingColumnSet(config, entry);
    }
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await dropEntryColumns(client).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  }, 60_000);

  it('T-I-034 writes both active entry columns for a two-entry catalog', async () => {
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    for (const entry of config.embeddings ?? []) {
      await client.query(
        `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
         VALUES ($1, $2, $3, $4::jsonb, 'yaml', 'active')`,
        [TEST_INSTANCE_ID, entry.name, entry.dimensions, JSON.stringify(entry.endpoints.map((endpoint) => ({
          provider_name: endpoint.providerName,
          model: endpoint.model,
        })))]
      );
    }

    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'parallel.md', 'Parallel')`,
      [documentId, TEST_INSTANCE_ID]
    );

    const result = await scheduleBackgroundEmbeddingsForActiveEntries({
      config,
      target: documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: documentId, label: 'parallel.md' }),
      embedText: 'parallel body',
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: (entry) => providerFor(entry.name),
    });

    expect(result.warnings).toEqual([]);
    const { rows } = await client.query(
      `
      SELECT embedding_primary::text AS primary_vector,
             embedding_primary_model AS primary_model,
             embedding_analysis::text AS analysis_vector,
             embedding_analysis_model AS analysis_model
      FROM fqc_documents
      WHERE id = $1
      `,
      [documentId]
    );
    expect(rows[0]).toMatchObject({
      primary_vector: '[0.1,0.2,0.3]',
      primary_model: 'model-primary',
      analysis_vector: '[0.4,0.5,0.6]',
      analysis_model: 'model-analysis',
    });
  });

  it('T-I-035 starts per-entry embed calls in parallel', async () => {
    const startTimes = new Map<string, number>();
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'parallel-timing.md', 'Parallel Timing')`,
      [documentId, TEST_INSTANCE_ID]
    );

    await scheduleBackgroundEmbeddingsForActiveEntries({
      config,
      target: documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: documentId, label: 'parallel-timing.md' }),
      embedText: 'parallel timing body',
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: (entry) => ({
        embed: vi.fn(async () => {
          startTimes.set(entry.name, performance.now());
          await new Promise((resolve) => setTimeout(resolve, 100));
          return entry.name === 'primary' ? [0.1, 0.2, 0.3] : [0.4, 0.5, 0.6];
        }),
        getDimensions: () => 3,
        getProviderInfo: () => ({ provider: `provider-${entry.name}`, model: `model-${entry.name}` }),
      }),
    });

    expect([...startTimes.keys()].sort()).toEqual(['analysis', 'primary']);
    expect(Math.abs(startTimes.get('analysis')! - startTimes.get('primary')!)).toBeLessThan(50);
  });

  it('T-I-036 writes plugin records with exactly one embed call for the resolved entry', async () => {
    let harness: PluginRecordHarness | undefined;
    try {
      providerState.calls = [];
      harness = await createPluginRecordHarness();
      const pluginId = 'plug_parallel_single';
      const tableName = `fqcp_${pluginId}_default_notes`;
      harness.tablesToDrop.add(tableName);

      const registerResult = await harness.registerPlugin({
        schema_yaml: pluginRecordYaml(pluginId, '*'),
        embedding_name: 'primary',
      }) as { isError?: boolean };
      expect(registerResult.isError).toBeFalsy();

      const writeResult = await harness.writeRecord({
        mode: 'create',
        plugin_id: pluginId,
        table: 'notes',
        data: { title: 'One plugin route', body: 'Only primary should embed' },
        include: ['data'],
      }) as { isError?: boolean };
      expect(writeResult.isError).toBeFalsy();
      const payload = JSON.parse(textOf(writeResult)) as { id: string; warnings?: string[] };
      expect(payload.warnings).toBeUndefined();

      expect(providerState.calls).toEqual([
        { entryName: 'primary', text: 'One plugin route\nOnly primary should embed' },
      ]);
      const row = await harness.client.query(
        `SELECT embedding_primary::text AS primary_vec
         FROM ${pg.escapeIdentifier(tableName)}
         WHERE id = $1`,
        [payload.id]
      );
      expect(row.rows[0]).toMatchObject({
        primary_vec: '[0.1,0.2,0.3]',
      });
      const columns = await harness.client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = 'embedding_analysis'`,
        [tableName]
      );
      expect(columns.rows).toEqual([]);
    } finally {
      providerState.calls = [];
      if (harness) {
        await destroyPluginRecordHarness(harness);
      }
    }
  }, 90_000);
});
