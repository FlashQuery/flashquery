import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { closePgPools } from '../../src/utils/pg-client.js';
import {
  withAncestorDirectoryLocksShared,
  withDirectoryLockExclusive,
} from '../../src/services/document-lock.js';
import {
  HAS_SESSION_CAPABLE_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

function makeConfig(vaultPath: string, lockTimeoutSeconds = 1): FlashQueryConfig {
  return {
    instance: {
      name: 'folder-lock-integration',
      id: 'folder-lock-integration',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: true,
    },
    locking: { enabled: true, lockTimeoutSeconds },
  } as FlashQueryConfig;
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function registerManageDirectory(config: FlashQueryConfig) {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<ToolResult>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<ToolResult>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerFileTools(server, config);
  return handlers.manage_directory;
}

function parsePayload(result: ToolResult): { results: Array<Record<string, unknown>> } {
  return JSON.parse(result.content[0]?.text ?? '{"results":[]}') as { results: Array<Record<string, unknown>> };
}

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-007 folder-lock integration', () => {
  afterAll(async () => {
    await closePgPools();
  });

  it('T-I-012 folder-lock shared sibling writes can overlap under the same ancestor directory', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-folder-lock-'));
    const config = makeConfig(vault);
    const firstEntered = createGate();
    const releaseFirst = createGate();
    let secondEntered = false;

    try {
      await mkdir(join(vault, 'Notes'), { recursive: true });
      const first = withAncestorDirectoryLocksShared(config, join(vault, 'Notes', 'A.md'), async () => {
        firstEntered.release();
        await releaseFirst.promise;
      });
      await firstEntered.promise;

      await withAncestorDirectoryLocksShared(config, join(vault, 'Notes', 'B.md'), async () => {
        secondEntered = true;
      });

      expect(secondEntered).toBe(true);
      releaseFirst.release();
      await first;
    } finally {
      releaseFirst.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('T-I-011 folder-lock public manage_directory rename returns lock_timeout behind a descendant shared write', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-folder-lock-'));
    const config = makeConfig(vault, 0.05);
    const manageDirectory = registerManageDirectory(config);
    const holderEntered = createGate();
    const releaseHolder = createGate();

    try {
      await mkdir(join(vault, 'Notes'), { recursive: true });
      await writeFile(join(vault, 'Notes', 'A.md'), 'a\n', 'utf8');
      const holder = withAncestorDirectoryLocksShared(config, join(vault, 'Notes', 'A.md'), async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });
      await holderEntered.promise;

      const result = await manageDirectory({
        action: 'rename',
        paths: ['Notes'],
        destinations: ['RenamedNotes'],
      });
      expect(result.isError).toBe(false);
      expect(parsePayload(result).results[0]).toMatchObject({
        error: 'conflict',
        details: { reason: 'lock_timeout' },
      });

      releaseHolder.release();
      await holder;
    } finally {
      releaseHolder.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('T-I-013 folder-lock manage_directory create remains exclusive-lock compatible', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-folder-lock-'));
    const config = makeConfig(vault, 0.05);
    const manageDirectory = registerManageDirectory(config);
    const holderEntered = createGate();
    const releaseHolder = createGate();

    try {
      const holder = withDirectoryLockExclusive(config, join(vault, 'Created'), async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });
      await holderEntered.promise;

      const result = await manageDirectory({ action: 'create', paths: ['Created'] });
      expect(result.isError).toBe(false);
      expect(parsePayload(result).results[0]).toMatchObject({
        action: 'create',
        status: 'created',
      });

      releaseHolder.release();
      await holder;
    } finally {
      releaseHolder.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);
});
