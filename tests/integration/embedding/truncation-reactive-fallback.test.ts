import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbedding,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../../../src/embedding/background-embed.js';
import { OpenAICompatibleProvider } from '../../../src/embedding/provider.js';
import type { FlashQueryConfig } from '../../../src/config/types.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-166-truncation-fallback';
const ENTRY_NAME = 'primary';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-166-truncation-fallback', markdownExtensions: ['.md'] },
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
    logging: { level: 'error', output: 'stdout' },
    llm: {
      providers: [
        {
          name: 'openai-main',
          type: 'openai-compatible',
          endpoint: 'https://example.test',
          apiKey: 'sk-test',
        },
      ],
      models: [],
      purposes: [],
    },
    embeddings: [
      {
        name: ENTRY_NAME,
        dimensions: 3,
        endpoints: [
          {
            providerName: 'openai-main',
            model: 'model',
            maxInputChars: 40,
          },
        ],
      },
    ],
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('truncation reactive fallback', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, { name: ENTRY_NAME, dimensions: 3 });
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  }, 60_000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    for (const suffix of ['', '_model', '_dimensions', '_provider', '_truncated']) {
      await client?.query(
        `ALTER TABLE fqc_documents DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`embedding_${ENTRY_NAME}${suffix}`)} CASCADE`
      ).catch(() => undefined);
      await client?.query(
        `ALTER TABLE fqc_memory DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`embedding_${ENTRY_NAME}${suffix}`)} CASCADE`
      ).catch(() => undefined);
    }
    await client?.end();
    await supabaseManager.close();
  }, 60_000);

  it('T-I-044 retries once at 75 percent; second over-limit leaves vector null and records pending failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'input length exceeds context length',
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    const provider = new OpenAICompatibleProvider(
      'https://example.test',
      'model',
      'sk-test',
      3,
      'provider-primary',
      40
    );
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'too-long.md', 'Too Long')`,
      [documentId, TEST_INSTANCE_ID]
    );

    const result = await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: documentId, label: 'too-long.md' }),
      embedText: 'Sentence one. Sentence two. Sentence three. Sentence four.',
      provider,
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
      embeddingName: ENTRY_NAME,
    });

    expect(result.warnings).toEqual([`embedding_deferred:${ENTRY_NAME}`]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const columns = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_documents'
        AND column_name = ANY($1::text[])
      `,
      [['embedding_primary', 'embedding_primary_model', 'embedding_primary_truncated']]
    );
    if (columns.rows.length > 0) {
      const document = await client.query(
        `SELECT embedding_primary IS NULL AS vector_null,
                embedding_primary_model IS NULL AS model_null,
                embedding_primary_truncated IS NULL AS truncated_null
         FROM fqc_documents
         WHERE id = $1`,
        [documentId]
      );
      expect(document.rows[0]).toEqual({ vector_null: true, model_null: true, truncated_null: true });
    } else {
      expect(columns.rows).toEqual([]);
    }
    const pending = await client.query(
      `SELECT embedding_name, last_error, attempt_count FROM fqc_pending_embeds WHERE instance_id = $1`,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        embedding_name: ENTRY_NAME,
        attempt_count: 1,
      }),
    ]);
    expect(pending.rows[0].last_error).toMatch(/input length exceeds/i);
  });

  it('persists embedding_<name>_truncated true from a real provider truncation', async () => {
    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, 3, $3::jsonb, 'yaml', 'active')`,
      [
        TEST_INSTANCE_ID,
        ENTRY_NAME,
        JSON.stringify([
          { providerName: 'openai-main', model: 'model', maxInputChars: 40 },
        ]),
      ]
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'truncated.md', 'Truncated')`,
      [documentId, TEST_INSTANCE_ID]
    );

    const result = await scheduleBackgroundEmbeddingsForActiveEntries({
      config,
      target: documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: documentId, label: 'truncated.md' }),
      embedText: 'Paragraph one has enough text to exceed the configured limit.\n\nParagraph two is omitted.',
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
    });

    expect(result.warnings).toEqual(['truncated_inputs']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const document = await client.query(
      `SELECT embedding_primary_truncated AS truncated,
              embedding_primary_model AS model,
              embedding_primary_provider AS provider
       FROM fqc_documents
       WHERE id = $1`,
      [documentId]
    );
    expect(document.rows[0]).toEqual({
      truncated: true,
      model: 'model',
      provider: 'openai-main',
    });
  });
});
