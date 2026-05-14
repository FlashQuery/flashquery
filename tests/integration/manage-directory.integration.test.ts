import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-127-manage-directory-integration';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type DirectoryPayload = {
  results: Array<Record<string, unknown>>;
};

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'phase-127-manage-directory-integration',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none' as never, model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: true, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<ToolResult>> = {};
  const server = {
    registerTool: (
      name: string,
      _cfg: unknown,
      handler: (params: Record<string, unknown>) => Promise<ToolResult>
    ) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function parseDirectoryPayload(result: ToolResult): DirectoryPayload {
  expect(result.content[0]?.text).toBeTruthy();
  return JSON.parse(result.content[0]!.text) as DirectoryPayload;
}

describe.skipIf(!HAS_SUPABASE)('manage_directory integration', () => {
  let vaultPath: string;
  let outsidePath: string;
  let manageDirectory: (params: Record<string, unknown>) => Promise<ToolResult>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-manage-directory-vault-'));
    outsidePath = await mkdtemp(join(tmpdir(), 'fqc-manage-directory-outside-'));
    const config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const fixture = createMockServer();
    registerFileTools(fixture.server, config);
    manageDirectory = fixture.getHandler('manage_directory');
  }, 60_000);

  afterAll(async () => {
    const client = supabaseManager.getClient();
    await client.from('fqc_write_locks').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('creates real directories, preserves mixed result order, and reports idempotent unchanged', async () => {
    const result = await manageDirectory({
      action: 'create',
      paths: ['Alpha', '../Escape', 'Alpha', 'Beta/Nested'],
    });
    const payload = parseDirectoryPayload(result);

    expect(result.isError).toBe(false);
    expect(payload.results.map((entry) => entry.path ?? entry.identifier)).toEqual([
      'Alpha',
      '../Escape',
      'Alpha',
      'Beta/Nested',
    ]);
    expect(payload.results[0]).toMatchObject({ action: 'create', status: 'created' });
    expect(payload.results[1]).toMatchObject({ error: 'invalid_input' });
    expect(payload.results[2]).toMatchObject({ action: 'create', status: 'unchanged' });
    expect(payload.results[3]).toMatchObject({ action: 'create', status: 'created' });
    await expect(stat(join(vaultPath, 'Alpha'))).resolves.toSatisfy((s) => s.isDirectory());
    await expect(stat(join(vaultPath, 'Beta', 'Nested'))).resolves.toSatisfy((s) => s.isDirectory());
  });

  it('removes empty directories and returns removed status', async () => {
    await mkdir(join(vaultPath, 'RemoveMe'), { recursive: true });

    const result = await manageDirectory({ action: 'remove', paths: ['RemoveMe'] });
    const payload = parseDirectoryPayload(result);

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      path: 'RemoveMe',
      action: 'remove',
      status: 'removed',
    });
    await expect(stat(join(vaultPath, 'RemoveMe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns directory_not_empty conflict without removing contents', async () => {
    await mkdir(join(vaultPath, 'NonEmpty'), { recursive: true });
    await writeFile(join(vaultPath, 'NonEmpty', 'note.md'), 'content\n', 'utf8');

    const result = await manageDirectory({ action: 'remove', paths: ['NonEmpty'] });
    const payload = parseDirectoryPayload(result);

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      error: 'conflict',
      identifier: 'NonEmpty',
      details: { reason: 'directory_not_empty' },
    });
    await expect(stat(join(vaultPath, 'NonEmpty', 'note.md'))).resolves.toBeTruthy();
  });

  it('returns expected JSON errors for traversal, symlink, and file conflicts', async () => {
    await writeFile(join(vaultPath, 'file.md'), 'file\n', 'utf8');
    await symlink(outsidePath, join(vaultPath, 'linked-outside'), 'dir');

    const result = await manageDirectory({
      action: 'remove',
      paths: ['../outside', 'linked-outside/child', 'file.md'],
    });
    const payload = parseDirectoryPayload(result);

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({ error: 'invalid_input', identifier: '../outside' });
    expect(payload.results[1]).toMatchObject({ error: 'invalid_input', identifier: 'linked-outside/child' });
    expect(payload.results[2]).toMatchObject({
      error: 'conflict',
      identifier: 'file.md',
      details: { reason: 'not_directory' },
    });
  });
});
