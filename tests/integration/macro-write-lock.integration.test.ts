import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { acquireLock, releaseLock } from '../../src/services/write-lock.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = `macro-write-lock-${randomUUID().slice(0, 8)}`;

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Write Lock Integration',
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
    locking: { enabled: true, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: {
      tools: ['write_document', 'archive_document', 'remove_document', 'search', 'call_macro'],
      excludedTools: [],
    },
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

describe.skipIf(!HAS_SUPABASE)('macro write-lock inheritance integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: Client;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fq-macro-write-lock-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const server = createMcpServer(config, '0.1.0');
    client = new Client({ name: 'macro-write-lock-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    try {
      const supabase = supabaseManager.getClient();
      await supabase.from('fqc_write_locks').delete().eq('instance_id', INSTANCE_ID);
      await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabase.from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Setup may fail before the singleton is initialized; cleanup remains best effort.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const supabase = supabaseManager.getClient();
    await supabase.from('fqc_write_locks').delete().eq('instance_id', INSTANCE_ID);
    await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    await supabase.from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
  });

  async function callMacro(source: string): Promise<Record<string, unknown>> {
    const result = await client.callTool({
      name: 'call_macro',
      arguments: { source },
    });
    expect(result.isError).toBeFalsy();
    return parseToolText(result);
  }

  function writeDocumentMacro(path: string, title: string): string {
    return `
      exit fq.write_document({
        mode: "create",
        path: "${path}",
        title: "${title}",
        content: "Created by call_macro while document locking is enabled.",
        tags: ["macro-write-lock"]
      })
    `;
  }

  it('T-I-009 serializes concurrent macro writes through the existing fq.write_document lock', async () => {
    const [first, second] = await Promise.all([
      callMacro(writeDocumentMacro('macro-write-lock/first.md', 'Macro Lock First')),
      callMacro(writeDocumentMacro('macro-write-lock/second.md', 'Macro Lock Second')),
    ]);

    expect(first).toMatchObject({
      result: {
        path: 'macro-write-lock/first.md',
        fq_id: expect.any(String),
      },
    });
    expect(second).toMatchObject({
      result: {
        path: 'macro-write-lock/second.md',
        fq_id: expect.any(String),
      },
    });

    const { data, error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('path,status')
      .eq('instance_id', INSTANCE_ID)
      .in('path', ['macro-write-lock/first.md', 'macro-write-lock/second.md']);
    expect(error).toBeNull();
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'macro-write-lock/first.md', status: 'active' }),
        expect.objectContaining({ path: 'macro-write-lock/second.md', status: 'active' }),
      ])
    );
  }, 40_000);

  it('T-I-010 surfaces the tool-layer lock_contention conflict envelope through call_macro', async () => {
    const lockAcquired = await acquireLock(
      supabaseManager.getClient(),
      config.instance.id,
      'documents',
      { ttlSeconds: config.locking.ttlSeconds }
    );
    expect(lockAcquired).toBe(true);

    try {
      const payload = await callMacro(writeDocumentMacro('macro-write-lock/contention.md', 'Macro Lock Contention'));
      expect(payload).toMatchObject({
        result: {
          error: 'conflict',
          details: { reason: 'lock_contention' },
        },
      });
    } finally {
      await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
    }
  }, 20_000);

  it('T-I-011 inherits archive_document and remove_document lock_contention without macro-layer acquireLock', async () => {
    await callMacro(writeDocumentMacro('macro-write-lock/archive.md', 'Macro Lock Archive'));
    await callMacro(writeDocumentMacro('macro-write-lock/remove.md', 'Macro Lock Remove'));

    const lockAcquired = await acquireLock(
      supabaseManager.getClient(),
      config.instance.id,
      'documents',
      { ttlSeconds: config.locking.ttlSeconds }
    );
    expect(lockAcquired).toBe(true);

    try {
      const archivePayload = await callMacro(`
        exit fq.archive_document({ identifiers: "macro-write-lock/archive.md" })
      `);
      expect(archivePayload).toMatchObject({
        result: {
          error: 'conflict',
          details: { reason: 'lock_contention' },
        },
      });

      const removePayload = await callMacro(`
        exit fq.remove_document({ identifiers: "macro-write-lock/remove.md" })
      `);
      expect(removePayload).toMatchObject({
        result: {
          error: 'conflict',
          details: { reason: 'lock_contention' },
        },
      });
    } finally {
      await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
    }
  }, 35_000);
});
