import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { withDocumentLock } from '../../src/services/document-lock.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = `archive-lock-${randomUUID().slice(0, 8)}`;

function makeConfig(vaultPath: string, lockingEnabled: boolean): FlashQueryConfig {
  return {
    instance: {
      name: 'archive-document-lock-integration-test',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    server: { host: 'localhost', port: 3200 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    plugins: {},
    locking: { enabled: lockingEnabled },
    hostMcpTools: { tools: ['tier:read-write'], excludedTools: [] },
    trashFolder: {
      enabled: false,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    },
  } as unknown as FlashQueryConfig;
}

function createHandlers(config: FlashQueryConfig): Record<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerDocumentTools(server, config);
  return handlers;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function parseResult<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T {
  return JSON.parse(textOf(result)) as T;
}

function advisoryKeyForPath(filePath: string): string {
  const digest = createHash('sha256').update(`document:${filePath}`).digest();
  return digest.readBigInt64BE(0).toString();
}

async function supportsSessionAdvisoryLocks(filePath: string): Promise<boolean> {
  const key = advisoryKeyForPath(filePath);
  const holder = new pg.Client({ connectionString: TEST_DATABASE_URL });
  const contender = new pg.Client({ connectionString: TEST_DATABASE_URL });

  try {
    await holder.connect();
    await contender.connect();
    await holder.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    const blocked = await contender.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [key]
    );
    return blocked.rows[0]?.acquired === false;
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => undefined);
    await contender.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => undefined);
    await holder.end().catch(() => undefined);
    await contender.end().catch(() => undefined);
  }
}

describe.skipIf(!HAS_SUPABASE)('archive_document shared lock integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-archive-lock-'));
    config = makeConfig(vaultPath, false);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    handlers = createHandlers(config);
  }, 60_000);

  afterAll(async () => {
    try {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Ignore cleanup failures in skipped or partially initialized environments.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    config = makeConfig(vaultPath, false);
    await initVault(config);
    handlers = createHandlers(config);
  });

  async function writeDoc(path: string, title: string): Promise<{ fq_id: string; path: string }> {
    const result = await handlers.write_document({
      mode: 'create',
      path,
      title,
      content: `${title} integration body.`,
      tags: ['archive-lock-integration'],
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    return parseResult<{ fq_id: string; path: string }>(result);
  }

  it('T-I-011 archive_document and remove_document complete through advisory document locks without table contention', async () => {
    if (!(await supportsSessionAdvisoryLocks(join(vaultPath, 'archive-lock/session-capability-probe.md')))) {
      console.warn('Skipping T-I-011: configured TEST_DATABASE_URL is not session-capable for advisory locks');
      return;
    }

    const archiveTarget = await writeDoc('archive-lock/archive-target.md', 'Archive Lock Target');
    const removeTarget = await writeDoc('archive-lock/remove-target.md', 'Remove Lock Target');
    const lockedConfig = makeConfig(vaultPath, true);
    handlers = createHandlers(lockedConfig);

    const [archivePayload, removePayload] = await Promise.all([
      handlers.archive_document({ identifiers: archiveTarget.path }).then(parseResult),
      handlers.remove_document({ identifiers: removeTarget.path }).then(parseResult),
    ]);

    expect(archivePayload).toMatchObject({
      path: archiveTarget.path,
      fq_id: archiveTarget.fq_id,
    });
    expect(removePayload).toMatchObject({
      path: removeTarget.path,
      fq_id: removeTarget.fq_id,
    });
    for (const payload of [archivePayload, removePayload]) {
      expect(payload).not.toMatchObject({
        error: 'conflict',
        details: { reason: 'lock_contention' },
      });
    }

    await expect(withDocumentLock(lockedConfig, join(vaultPath, archiveTarget.path), async () => true)).resolves.toBe(true);
  }, 40_000);
});
