import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { initVault } from '../../../src/storage/vault.js';
import { registerDocumentTools } from '../../../src/mcp/tools/documents.js';
import { runScanOnce } from '../../../src/services/scanner.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

vi.mock('../../../src/embedding/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/embedding/provider.js')>();
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn((_config: unknown, entry: { name: string }) => ({
      embed: vi.fn(async () => {
        throw new Error(`forced chunk provider failure for ${entry.name}`);
      }),
      getDimensions: () => 3,
      getProviderInfo: () => ({ provider: 'mock-provider', model: `mock-${entry.name}` }),
    })),
    embeddingProvider: {
      embed: vi.fn(async () => {
        throw new Error('forced legacy provider failure');
      }),
      getDimensions: () => 3,
    },
  };
});

const TEST_INSTANCE_ID = 'embedding-chunk-write-roundtrip-test';
const ALPHA_BODY = Array.from({ length: 140 }, (_, index) => `alpha-${index}`).join(' ');
const ALPHA_BODY_CHANGED = Array.from({ length: 140 }, (_, index) => `alpha-changed-${index}`).join(' ');
const BETA_BODY = Array.from({ length: 140 }, (_, index) => `beta-${index}`).join(' ');
const OLD_BODY = Array.from({ length: 140 }, (_, index) => `old-${index}`).join(' ');
const CHILD_BODY = Array.from({ length: 140 }, (_, index) => `child-${index}`).join(' ');
const COPY_BODY = Array.from({ length: 140 }, (_, index) => `copy-${index}`).join(' ');
const SCANNER_BODY = Array.from({ length: 140 }, (_, index) => `scanner-${index}`).join(' ');

function makeConfig(vaultPath: string): FlashQueryConfig {
  const config = loadConfig('tests/fixtures/flashquery.test.yml');
  config.instance.id = TEST_INSTANCE_ID;
  config.instance.name = TEST_INSTANCE_ID;
  config.instance.vault.path = vaultPath;
  config.supabase.url = TEST_SUPABASE_URL;
  config.supabase.serviceRoleKey = TEST_SUPABASE_KEY;
  config.supabase.databaseUrl = TEST_DATABASE_URL;
  config.supabase.skipDdl = false;
  config.locking = { enabled: false };
  config.embeddings = [
    {
      name: 'primary',
      dimensions: 3,
      endpoints: [{ providerName: 'mock-provider', model: 'mock-primary' }],
    },
  ];
  return config;
}

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function parseJsonResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  expect(toolResult.isError).toBeUndefined();
  return JSON.parse(toolResult.content[0]?.text ?? '{}') as Record<string, unknown>;
}

async function cleanup(client: pg.Client): Promise<void> {
  await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
}

async function insertCatalog(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', 3, $2::jsonb, 'yaml', 'active')`,
    [
      TEST_INSTANCE_ID,
      JSON.stringify([{ provider_name: 'mock-provider', model: 'mock-primary' }]),
    ]
  );
}

async function chunksForPath(client: pg.Client, path: string): Promise<Array<{
  id: string;
  breadcrumb: string;
  content: string;
  content_hash: string;
}>> {
  const result = await client.query(
    `SELECT c.id::text, c.breadcrumb, c.content, c.content_hash
     FROM fqc_chunks c
     JOIN fqc_documents d ON d.id = c.document_id
     WHERE d.instance_id = $1 AND d.path = $2
     ORDER BY c.breadcrumb, c.chunk_index`,
    [TEST_INSTANCE_ID, path]
  );
  return result.rows;
}

async function pendingAttempts(client: pg.Client): Promise<Map<string, number>> {
  const result = await client.query<{ target_id: string; attempt_count: number }>(
    `SELECT target_id::text, attempt_count
     FROM fqc_pending_embeds
     WHERE instance_id = $1 AND target_kind = 'document_chunk' AND embedding_name = 'primary'`,
    [TEST_INSTANCE_ID]
  );
  return new Map(result.rows.map((row) => [row.target_id, row.attempt_count]));
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk write roundtrip integration', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;
  let vaultPath: string;
  let writeDocument: (params: Record<string, unknown>) => Promise<unknown>;
  let copyDocument: (params: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'chunk-write-roundtrip-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    const mock = createMockServer();
    registerDocumentTools(mock.server, config);
    writeDocument = mock.getHandler('write_document');
    copyDocument = mock.getHandler('copy_document');
  }, 90_000);

  beforeEach(async () => {
    await cleanup(client);
    await insertCatalog(client);
  });

  afterAll(async () => {
    await cleanup(client).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager.close().catch(() => undefined);
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('T-I-014 write_document(create) creates document chunks and document_chunk pending rows', async () => {
    const result = parseJsonResult(await writeDocument({
      mode: 'create',
      path: 'chunks/create.md',
      title: 'Chunk Create',
      content: `# Chunk Create\n\n## Alpha\n\n${ALPHA_BODY}\n\n## Beta\n\n${BETA_BODY}`,
    }));

    expect(result.warnings).toContain('embedding_deferred:primary');
    const chunks = await chunksForPath(client, 'chunks/create.md');
    expect(chunks.map((chunk) => chunk.breadcrumb)).toEqual(
      expect.arrayContaining(['Chunk Create > Alpha', 'Chunk Create > Beta'])
    );

    const pending = await client.query(
      `SELECT target_kind, target_table, embedding_name
       FROM fqc_pending_embeds
       WHERE instance_id = $1`,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toHaveLength(chunks.length);
    expect(pending.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_kind: 'document_chunk',
          target_table: 'fqc_chunks',
          embedding_name: 'primary',
        }),
      ])
    );
  });

  it('T-I-015 body-only update re-embeds only changed chunks', async () => {
    await writeDocument({
      mode: 'create',
      path: 'chunks/update.md',
      title: 'Chunk Update',
      content: `# Chunk Update\n\n## Alpha\n\n${ALPHA_BODY}\n\n## Beta\n\n${BETA_BODY}`,
    });
    const beforeChunks = await chunksForPath(client, 'chunks/update.md');
    const beforeAttempts = await pendingAttempts(client);

    await writeDocument({
      mode: 'update',
      identifier: 'chunks/update.md',
      content: `# Chunk Update\n\n## Alpha\n\n${ALPHA_BODY_CHANGED}\n\n## Beta\n\n${BETA_BODY}`,
    });

    const afterChunks = await chunksForPath(client, 'chunks/update.md');
    const afterAttempts = await pendingAttempts(client);
    const changed = afterChunks.filter((chunk) => chunk.content.includes('alpha-changed-0'));
    const unchanged = afterChunks.filter((chunk) => chunk.content.includes('beta-0'));
    expect(changed).toHaveLength(1);
    expect(unchanged).toHaveLength(1);
    expect(afterAttempts.get(changed[0].id)).toBe((beforeAttempts.get(changed[0].id) ?? 0) + 1);
    expect(afterAttempts.get(unchanged[0].id)).toBe(beforeAttempts.get(unchanged[0].id));
    expect(afterChunks.map((chunk) => chunk.id).sort()).toEqual(beforeChunks.map((chunk) => chunk.id).sort());
  });

  it('T-I-016 heading rename deletes orphan chunks and inserts replacement descendants', async () => {
    await writeDocument({
      mode: 'create',
      path: 'chunks/rename.md',
      title: 'Chunk Rename',
      content: `# Chunk Rename\n\n## Old Heading\n\n${OLD_BODY}\n\n### Child\n\n${CHILD_BODY}`,
    });
    const before = await chunksForPath(client, 'chunks/rename.md');
    expect(before.some((chunk) => chunk.breadcrumb.includes('Old Heading'))).toBe(true);

    await writeDocument({
      mode: 'update',
      identifier: 'chunks/rename.md',
      content: `# Chunk Rename\n\n## New Heading\n\n${OLD_BODY}\n\n### Child\n\n${CHILD_BODY}`,
    });

    const after = await chunksForPath(client, 'chunks/rename.md');
    expect(after.some((chunk) => chunk.breadcrumb.includes('Old Heading'))).toBe(false);
    expect(after.some((chunk) => chunk.breadcrumb.includes('New Heading'))).toBe(true);
  });

  it('T-I-017 copy and scanner-discovered documents follow the same chunk diff path', async () => {
    await writeDocument({
      mode: 'create',
      path: 'chunks/source.md',
      title: 'Chunk Source',
      content: `# Chunk Source\n\n## Copy Section\n\n${COPY_BODY}`,
    });
    const copyResult = parseJsonResult(await copyDocument({
      identifier: 'chunks/source.md',
      destination: 'chunks/copied.md',
    }));
    expect(copyResult.warnings).toContain('embedding_deferred:primary');
    expect(await chunksForPath(client, 'chunks/copied.md')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ breadcrumb: 'Chunk Source > Copy Section' }),
      ])
    );

    await mkdir(join(vaultPath, 'chunks'), { recursive: true });
    await writeFile(
      join(vaultPath, 'chunks/scanned.md'),
      [
        '---',
        'fq_title: Scanned Chunk',
        'fq_status: active',
        '---',
        '# Scanned Chunk',
        '',
        '## Scanner Section',
        '',
        SCANNER_BODY,
        '',
      ].join('\n'),
      'utf-8'
    );
    const scanResult = await runScanOnce(config);
    expect(scanResult.newFiles).toBeGreaterThanOrEqual(1);
    expect(await chunksForPath(client, 'chunks/scanned.md')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ breadcrumb: 'Scanned Chunk > Scanner Section' }),
      ])
    );
  }, 90_000);
});
