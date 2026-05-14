import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { resetMaintenanceStateForTests } from '../../src/services/maintenance.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = `remove-document-${randomUUID().slice(0, 8)}`;

function makeConfig(
  vaultPath: string,
  trashFolder: FlashQueryConfig['trashFolder'] = {
    enabled: false,
    path: '.flashquery/removed',
    collisionStrategy: 'suffix',
  }
): FlashQueryConfig {
  return {
    instance: {
      name: 'remove-document-integration-test',
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
    locking: { enabled: false, ttlSeconds: 30 },
    hostMcpTools: { tools: ['tier:read-write'], excludedTools: [] },
    trashFolder,
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
  registerCompoundTools(server, config);
  registerScanTools(server, config);
  return handlers;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function parseResult<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T {
  return JSON.parse(textOf(result)) as T;
}

describe.skipIf(!HAS_SUPABASE)('remove_document integration', () => {
  let vaultPath: string;
  let externalTrashPath: string;
  let config: FlashQueryConfig;
  let handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-remove-document-'));
    externalTrashPath = await mkdtemp(join(tmpdir(), 'fqc-remove-document-trash-'));
    config = makeConfig(vaultPath);
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
    await rm(externalTrashPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    resetMaintenanceStateForTests();
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await initVault(config);
    handlers = createHandlers(config);
  });

  async function useConfig(nextConfig: FlashQueryConfig): Promise<void> {
    config = nextConfig;
    await initVault(config);
    handlers = createHandlers(config);
  }

  async function writeDoc(path: string, title: string, content = 'Removal integration body.'): Promise<{ fq_id: string; path: string }> {
    const result = await handlers.write_document({
      mode: 'create',
      path,
      title,
      content,
      tags: ['remove-document-integration'],
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    return parseResult<{ fq_id: string; path: string }>(result);
  }

  it('hard delete removes the markdown file and leaves the DB row archived with archived_at', async () => {
    const created = await writeDoc('remove/hard-delete.md', 'Hard Delete');

    const removed = parseResult(await handlers.remove_document({ identifiers: created.fq_id }));

    expect(removed).toMatchObject({
      identifier: created.fq_id,
      path: 'remove/hard-delete.md',
      status: 'archived',
      archived_at: expect.any(String),
      moved_to: null,
    });
    expect(existsSync(join(vaultPath, 'remove/hard-delete.md'))).toBe(false);

    const { data: row } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('status, archived_at')
      .eq('id', created.fq_id)
      .single();
    expect(row).toMatchObject({ status: 'archived', archived_at: expect.any(String) });
  });

  it('moves to in-vault trash with fq_original_path and default search excludes archived trash files', async () => {
    await useConfig(makeConfig(vaultPath, {
      enabled: true,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    }));
    const created = await writeDoc('remove/trash-me.md', 'Trash Me');

    const removed = parseResult(await handlers.remove_document({ identifiers: created.path }));

    expect(removed).toMatchObject({
      path: 'remove/trash-me.md',
      status: 'archived',
      moved_to: '.flashquery/removed/trash-me.md',
      archived_at: expect.any(String),
    });
    expect(existsSync(join(vaultPath, 'remove/trash-me.md'))).toBe(false);
    const trashRaw = await readFile(join(vaultPath, '.flashquery/removed/trash-me.md'), 'utf8');
    const trashParsed = matter(trashRaw);
    expect(trashParsed.data[FM.ORIGINAL_PATH]).toBe('remove/trash-me.md');
    expect(trashParsed.data[FM.STATUS]).toBe('archived');

    const search = parseResult<{ results: Array<Record<string, unknown>> }>(await handlers.search({
      query: 'Trash Me',
      mode: 'filesystem',
      entity_types: ['documents'],
    }));
    expect(JSON.stringify(search.results)).not.toContain('Trash Me');
  });

  it('moves to external trash and keeps archived lifecycle state', async () => {
    await useConfig(makeConfig(vaultPath, {
      enabled: true,
      path: externalTrashPath,
      collisionStrategy: 'suffix',
    }));
    const created = await writeDoc('remove/external-trash.md', 'External Trash');

    const removed = parseResult(await handlers.remove_document({ identifiers: created.path }));

    expect(removed).toMatchObject({
      path: 'remove/external-trash.md',
      status: 'archived',
      moved_to: join(externalTrashPath, 'external-trash.md'),
    });
    expect(existsSync(join(vaultPath, 'remove/external-trash.md'))).toBe(false);
    expect(existsSync(join(externalTrashPath, 'external-trash.md'))).toBe(true);

    const { data: row } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('status, archived_at')
      .eq('id', created.fq_id)
      .single();
    expect(row).toMatchObject({ status: 'archived', archived_at: expect.any(String) });
  });

  it('trash collision strategy suffix avoids overwriting existing trash files', async () => {
    await useConfig(makeConfig(vaultPath, {
      enabled: true,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    }));
    await mkdir(join(vaultPath, '.flashquery/removed'), { recursive: true });
    await writeFile(join(vaultPath, '.flashquery/removed/collide.md'), 'existing trash');
    await writeDoc('remove/collide.md', 'Collide');

    const removed = parseResult(await handlers.remove_document({ identifiers: 'remove/collide.md' }));

    expect(removed.moved_to).toBe('.flashquery/removed/collide-1.md');
    expect(await readFile(join(vaultPath, '.flashquery/removed/collide.md'), 'utf8')).toBe('existing trash');
    expect(existsSync(join(vaultPath, '.flashquery/removed/collide-1.md'))).toBe(true);
  });

  it('trash collision strategy timestamp avoids same-millisecond overwrites', async () => {
    await useConfig(makeConfig(vaultPath, {
      enabled: true,
      path: '.flashquery/removed',
      collisionStrategy: 'timestamp',
    }));
    await mkdir(join(vaultPath, '.flashquery/removed'), { recursive: true });
    await writeFile(join(vaultPath, '.flashquery/removed/note.md'), 'existing basename trash');
    const frozen = new Date('2026-05-12T12:34:56.789Z');
    const timestamp = frozen.toISOString().replace(/[:.]/g, '-');
    await writeFile(join(vaultPath, `.flashquery/removed/note-${timestamp}.md`), 'existing timestamp trash');
    await writeDoc('remove/a/note.md', 'Timestamp Collision A', 'first same-basename body');
    await writeDoc('remove/b/note.md', 'Timestamp Collision B', 'second same-basename body');

    vi.useFakeTimers();
    vi.setSystemTime(frozen);
    try {
      const removed = parseResult<{ results: Array<Record<string, unknown>> }>(
        await handlers.remove_document({
          identifiers: ['remove/a/note.md', 'remove/b/note.md'],
        })
      );

      expect(removed.results.map((item) => item.moved_to)).toEqual([
        `.flashquery/removed/note-${timestamp}-1.md`,
        `.flashquery/removed/note-${timestamp}-2.md`,
      ]);
    } finally {
      vi.useRealTimers();
    }

    expect(await readFile(join(vaultPath, '.flashquery/removed/note.md'), 'utf8')).toBe('existing basename trash');
    expect(await readFile(join(vaultPath, `.flashquery/removed/note-${timestamp}.md`), 'utf8')).toBe('existing timestamp trash');
    expect(await readFile(join(vaultPath, `.flashquery/removed/note-${timestamp}-1.md`), 'utf8')).toContain('first same-basename body');
    expect(await readFile(join(vaultPath, `.flashquery/removed/note-${timestamp}-2.md`), 'utf8')).toContain('second same-basename body');
  });

  it('invalid trash path returns invalid_input path_traversal and leaves the source file present', async () => {
    await useConfig(makeConfig(vaultPath));
    const created = await writeDoc('remove/unsafe.md', 'Unsafe Trash');
    await useConfig(makeConfig(vaultPath, {
      enabled: true,
      path: '../outside-vault',
      collisionStrategy: 'suffix',
    }));

    const result = await handlers.remove_document({ identifiers: created.path }) as { isError?: boolean };
    const payload = parseResult(result);

    expect(result.isError).toBeFalsy();
    expect(payload).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'path_traversal' },
    });
    expect(existsSync(join(vaultPath, 'remove/unsafe.md'))).toBe(true);
  });

  it('batch partial failure preserves input order, not_found elements, and bulk_removal warning', async () => {
    await useConfig(makeConfig(vaultPath));
    const created = await writeDoc('remove/batch.md', 'Batch Remove');

    const payload = parseResult<{ results: Array<Record<string, unknown>>; warnings: string[] }>(
      await handlers.remove_document({
        identifiers: [
          created.fq_id,
          'missing-one.md',
          'missing-two.md',
          'missing-three.md',
          'missing-four.md',
          'missing-five.md',
        ],
      })
    );

    expect(payload.warnings).toEqual(['bulk_removal: 6 items']);
    expect(payload.results[0]).toMatchObject({ fq_id: created.fq_id, status: 'archived' });
    expect(payload.results.slice(1).map((item) => item.error)).toEqual([
      'not_found',
      'not_found',
      'not_found',
      'not_found',
      'not_found',
    ]);
  });

  it('INT-rdoc-4/I5 remove followed by maintain_vault sync and repair does not reclassify as missing or stale', async () => {
    await useConfig(makeConfig(vaultPath));
    const created = await writeDoc('remove/maintenance.md', 'Maintenance Removed');

    await handlers.remove_document({ identifiers: created.fq_id });
    await handlers.maintain_vault({ action: 'sync' });
    await handlers.maintain_vault({ action: 'repair' });

    const { data: row } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('status, archived_at')
      .eq('id', created.fq_id)
      .single();
    expect(row).toMatchObject({ status: 'archived', archived_at: expect.any(String) });
    expect(row?.status).not.toBe('missing');

    const search = parseResult<{ results: Array<Record<string, unknown>> }>(await handlers.search({
      query: 'Maintenance Removed',
      mode: 'filesystem',
      entity_types: ['documents'],
    }));
    expect(JSON.stringify(search.results)).not.toContain('Maintenance Removed');
  });
});
