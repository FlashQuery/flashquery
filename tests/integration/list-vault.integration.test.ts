import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type ListVaultPayload = {
  path: string;
  total: number;
  displayed: number;
  truncated: boolean;
  entries: Array<Record<string, unknown>>;
};

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'list-vault-integration',
      id: 'list-vault-integration-id',
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
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<ToolResult>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<ToolResult>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function parseListVault(result: ToolResult): ListVaultPayload {
  expect(result.content[0]?.text).toBeTruthy();
  return JSON.parse(result.content[0]!.text) as ListVaultPayload;
}

describe.skipIf(!HAS_SUPABASE)('list_vault structured JSON integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let getHandler: (name: string) => (params: Record<string, unknown>) => Promise<ToolResult>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-list-vault-integration-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const fixture = createMockServer();
    registerDocumentTools(fixture.server, config);
    registerFileTools(fixture.server, config);
    getHandler = fixture.getHandler;
  }, 60_000);

  afterAll(async () => {
    if (supabaseManager) {
      await supabaseManager.getClient()
        .from('fqc_documents')
        .delete()
        .eq('instance_id', 'list-vault-integration-id');
    }
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('returns structured entries for a directory and a created document with show all', async () => {
    await mkdir(join(vaultPath, 'ListVaultJson', 'child-dir'), { recursive: true });
    const createResult = await getHandler('create_document')({
      title: 'List Vault JSON Doc',
      content: 'List vault integration body.',
      path: 'ListVaultJson/note.md',
      tags: ['list-vault-json'],
    });
    expect(createResult.isError).toBeFalsy();

    const result = await getHandler('list_vault')({
      path: 'ListVaultJson',
      show: 'all',
      include: ['metadata', 'tracking'],
    });
    const payload = parseListVault(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      path: 'ListVaultJson',
      total: 2,
      displayed: 2,
      truncated: false,
    });
    expect(payload.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ListVaultJson/child-dir',
        type: 'directory',
        size: { entries: 0 },
        children: 0,
        created: expect.any(String),
      }),
      expect.objectContaining({
        path: 'ListVaultJson/note.md',
        type: 'file',
        title: 'List Vault JSON Doc',
        tags: ['list-vault-json'],
        status: 'active',
        fq_id: expect.any(String),
        size: { chars: expect.any(Number) },
      }),
    ]));
    const fileEntry = payload.entries.find((entry) => entry.path === 'ListVaultJson/note.md');
    expect((fileEntry?.size as { chars: number }).chars).toBeGreaterThanOrEqual('List vault integration body.'.length);
    expect((fileEntry?.size as { chars: number }).chars).toBeLessThan(100);
  });

  it('keeps directories while filtering files by extension', async () => {
    await mkdir(join(vaultPath, 'ListVaultExt', 'subdir'), { recursive: true });
    await writeFile(join(vaultPath, 'ListVaultExt', 'keep.md'), '# Keep\n', 'utf8');
    await writeFile(join(vaultPath, 'ListVaultExt', 'drop.txt'), 'drop\n', 'utf8');

    const result = await getHandler('list_vault')({
      path: 'ListVaultExt',
      show: 'all',
      extensions: ['.md'],
    });
    const payload = parseListVault(result);
    const paths = payload.entries.map((entry) => entry.path);

    expect(paths).toContain('ListVaultExt/subdir');
    expect(paths).toContain('ListVaultExt/keep.md');
    expect(paths).not.toContain('ListVaultExt/drop.txt');
  });

  it('hides dot-prefixed entries by default', async () => {
    await mkdir(join(vaultPath, 'ListVaultHidden', '.hidden-dir'), { recursive: true });
    await writeFile(join(vaultPath, 'ListVaultHidden', '.hidden.md'), 'hidden\n', 'utf8');
    await writeFile(join(vaultPath, 'ListVaultHidden', 'visible.md'), 'visible\n', 'utf8');

    const result = await getHandler('list_vault')({
      path: 'ListVaultHidden',
      show: 'all',
    });
    const payload = parseListVault(result);
    const paths = payload.entries.map((entry) => entry.path);

    expect(paths).toContain('ListVaultHidden/visible.md');
    expect(paths).not.toContain('ListVaultHidden/.hidden.md');
    expect(paths).not.toContain('ListVaultHidden/.hidden-dir');
  });
});
