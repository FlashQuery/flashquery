import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dirname } from 'node:path';

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  const calls: Array<{ absPath: string; content: string }> = [];
  const pgQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const pgEnd = vi.fn().mockResolvedValue(undefined);
  const supabaseChain: Record<string, unknown> = {};

  return {
    calls,
    files,
    pgQuery,
    pgEnd,
    supabaseChain,
    readFile: vi.fn(async (absPath: string) => {
      return files.get(absPath) ?? ['---', 'fq_title: Auto Track', '---', 'body'].join('\n');
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (absPath: string, content: string | Buffer) => {
      files.set(absPath, Buffer.isBuffer(content) ? content.toString('utf8') : content);
    }),
    writeVaultFile: vi.fn(async (absPath: string, content: string | Buffer) => {
      const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
      calls.push({ absPath, content: text });
      files.set(absPath, text);
      return { contentHash: 'instrumented-hash' };
    }),
    pluginGetEntry: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
}));

vi.mock('../../src/storage/vault-write.js', () => ({
  isVaultTempFileName: (name: string) => name.endsWith('.fqc-tmp') || name.includes('.fqc-tmp-'),
  writeVaultFile: mocks.writeVaultFile,
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    resolveVaultPath: (relativePath: string) => `/vault/${relativePath}`,
  },
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({
      from: vi.fn(() => mocks.supabaseChain),
    })),
  },
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: mocks.pgQuery,
    end: mocks.pgEnd,
  })),
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getEntry: mocks.pluginGetEntry,
    getAllEntries: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('pg', () => ({
  default: {
    escapeIdentifier: (value: string) => `"${value}"`,
  },
}));

import { executeReconciliationActions } from '../../src/services/plugin-reconciliation.js';

describe('plugin reconciliation write routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.calls.length = 0;
    mocks.pgQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.pgEnd.mockResolvedValue(undefined);

    mocks.supabaseChain.update = vi.fn(() => mocks.supabaseChain);
    mocks.supabaseChain.select = vi.fn(() => mocks.supabaseChain);
    mocks.supabaseChain.eq = vi.fn(() => mocks.supabaseChain);
    mocks.supabaseChain.single = vi.fn().mockResolvedValue({
      data: {
        updated_at: '2026-05-26T12:00:00.000Z',
        content_hash: 'instrumented-hash',
      },
      error: null,
    });
    mocks.supabaseChain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.supabaseChain.delete = vi.fn(() => mocks.supabaseChain);

    mocks.pluginGetEntry.mockReturnValue({
      plugin_id: 'routing-plugin',
      plugin_instance: 'default',
      table_prefix: 'fqcp_routing_',
      schema: {
        plugin: { id: 'routing-plugin', name: 'Routing Plugin', version: '1.0.0' },
        tables: [],
        documents: {
          types: [
            {
              id: 'note',
              folder: 'Notes',
              access: 'read-write',
              on_added: 'auto-track',
              on_moved: 'keep-tracking',
              on_modified: 'ignore',
              track_as: 'notes',
              field_map: {},
            },
          ],
        },
      },
    });
  });

  it('T-U-040a routes executeReconciliationActions auto-track frontmatter writes through writeVaultFile', async () => {
    await executeReconciliationActions(
      {
        added: [
          {
            fqcId: 'doc-auto-track',
            path: 'Notes/auto-track.md',
            typeId: 'note',
            tableName: 'fqcp_routing_notes',
          },
        ],
        resurrected: [],
        deleted: [],
        disassociated: [],
        moved: [],
        modified: [],
        unchanged: 0,
      },
      'routing-plugin',
      'default',
      'fqc-test-instance',
      'postgresql://localhost/test'
    );

    expect(mocks.writeVaultFile).toHaveBeenCalledTimes(1);
    expect(mocks.calls).toEqual([
      {
        absPath: '/vault/Notes/auto-track.md',
        content: expect.stringContaining('fq_owner: routing-plugin') as unknown as string,
      },
    ]);
    expect(mocks.calls[0]?.content).toContain('fq_type: note');
    expect(mocks.writeFile).not.toHaveBeenCalledWith(
      '/vault/Notes/auto-track.md',
      expect.anything()
    );
    expect(dirname(mocks.calls[0]?.absPath ?? '')).toBe('/vault/Notes');
  });
});
