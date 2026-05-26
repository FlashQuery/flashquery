import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  HAS_SESSION_CAPABLE_DATABASE_URL,
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

  it.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('T-I-011 archive_document and remove_document complete through advisory document locks without table contention', async () => {
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
