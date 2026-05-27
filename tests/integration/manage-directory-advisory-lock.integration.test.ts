import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FlashQueryConfig } from '../../src/config/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFileTools, __setManageDirectoryLockHookForTesting } from '../../src/mcp/tools/files.js';
import { closePgPools } from '../../src/utils/pg-client.js';
import { withPgClient } from '../../src/utils/pg-client.js';
import { advisoryKeyForDirectory, queryAdvisoryLocks } from '../helpers/pg-locks.js';
import {
  HAS_SESSION_CAPABLE_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

function makeConfig(vaultPath: string, lockTimeoutSeconds = 1): FlashQueryConfig {
  return {
    instance: {
      name: 'manage-directory-advisory-lock-integration',
      id: 'manage-directory-advisory-lock-integration',
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

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

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

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-024 manage-directory-advisory integration', () => {
  afterAll(async () => {
    await closePgPools();
    __setManageDirectoryLockHookForTesting(null);
  });

  it('T-I-046 manage_directory holds an exclusive advisory lock visible in pg_locks', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-manage-directory-advisory-'));
    const config = makeConfig(vault);
    const manageDirectory = registerManageDirectory(config);
    const holderEntered = createGate();
    const releaseHolder = createGate();

    try {
      await mkdir(join(vault, 'Folder'), { recursive: true });
      __setManageDirectoryLockHookForTesting(async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });

      const operation = manageDirectory({ action: 'remove', paths: ['Folder'] });
      await holderEntered.promise;

      const expectedKey = await advisoryKeyForDirectory(config, join(vault, 'Folder'));
      const observed = await withPgClient(TEST_DATABASE_URL, (client) =>
        queryAdvisoryLocks(client, { mode: 'exclusive', key: expectedKey })
      );
      expect(observed).toHaveLength(1);

      releaseHolder.release();
      const result = await operation;
      expect(parsePayload(result).results[0]).toMatchObject({ status: 'removed' });
    } finally {
      __setManageDirectoryLockHookForTesting(null);
      releaseHolder.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('T-I-047 manage_directory same-folder contention returns one success and one lock_timeout conflict', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-manage-directory-advisory-'));
    const config = makeConfig(vault, 0.05);
    const manageDirectory = registerManageDirectory(config);
    const holderEntered = createGate();
    const releaseHolder = createGate();

    try {
      await mkdir(join(vault, 'Folder'), { recursive: true });
      __setManageDirectoryLockHookForTesting(async () => {
        holderEntered.release();
        await releaseHolder.promise;
      });

      const first = manageDirectory({ action: 'remove', paths: ['Folder'] });
      await holderEntered.promise;
      const second = await manageDirectory({ action: 'remove', paths: ['Folder'] });

      releaseHolder.release();
      const firstResult = await first;
      const results = [
        parsePayload(firstResult).results[0],
        parsePayload(second).results[0],
      ];

      expect(results.filter((entry) => entry.status === 'removed')).toHaveLength(1);
      expect(
        results.filter((entry) => entry.error === 'conflict' && (entry.details as { reason?: string })?.reason === 'lock_timeout')
      ).toHaveLength(1);
    } finally {
      __setManageDirectoryLockHookForTesting(null);
      releaseHolder.release();
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);

  it('manage-directory-advisory disjoint folder locks can proceed independently', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'fq-manage-directory-advisory-'));
    const config = makeConfig(vault);
    const manageDirectory = registerManageDirectory(config);

    try {
      await mkdir(join(vault, 'A'), { recursive: true });
      await mkdir(join(vault, 'B'), { recursive: true });
      const [first, second] = await Promise.all([
        manageDirectory({ action: 'remove', paths: ['A'] }),
        manageDirectory({ action: 'remove', paths: ['B'] }),
      ]);
      expect(parsePayload(first).results[0]).toMatchObject({ status: 'removed' });
      expect(parsePayload(second).results[0]).toMatchObject({ status: 'removed' });
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  }, 20_000);
});
