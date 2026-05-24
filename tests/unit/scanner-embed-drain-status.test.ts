import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { runScanOnce } from '../../src/services/scanner.js';

const scannerState = vi.hoisted(() => ({
  vaultFiles: [] as string[],
  drainMode: 'ok' as 'ok' | 'error' | 'throw' | 'docs',
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('---\ntitle: Test Doc\n---\nBody'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(() => ({ isFile: () => true })),
}));

vi.mock('../../src/mcp/tools/documents.js', () => ({
  listMarkdownFiles: vi.fn(() => Promise.resolve(scannerState.vaultFiles)),
  computeHash: vi.fn(() => 'hash-1'),
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    readMarkdown: vi.fn().mockResolvedValue({ data: { status: 'active' }, content: 'Body' }),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1]),
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

vi.mock('../../src/plugins/manager.js', () => ({
  getFolderClaimsMap: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('../../src/services/plugin-propagation.js', () => ({
  propagateFqcIdChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => makeSupabaseClient()),
  },
}));

import { embeddingProvider } from '../../src/embedding/provider.js';
import { logger } from '../../src/logging/logger.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance-id',
      vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
    },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test', databaseUrl: 'postgresql://test' },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

function ok(data: unknown[] = []) {
  return { data, error: null };
}

function makeQuery(table: string) {
  const state = { select: '' };
  const query: Record<string, unknown> = {
    select: vi.fn((columns: string) => {
      state.select = columns;
      return query;
    }),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    in: vi.fn(() => query),
    update: vi.fn(() => query),
    insert: vi.fn(() => query),
    upsert: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(ok(null as unknown as unknown[]))),
    is: vi.fn(() => {
      if (table === 'fqc_documents' && state.select === 'id, path, title') {
        if (scannerState.drainMode === 'error') {
          return Promise.resolve({ data: null, error: { message: 'forced drain failure' } });
        }
        if (scannerState.drainMode === 'throw') {
          throw new Error('forced drain throw');
        }
        if (scannerState.drainMode === 'docs') {
          return Promise.resolve({ data: [{ id: 'doc-1', path: 'doc.md', title: 'Doc' }], error: null });
        }
      }
      return Promise.resolve(ok());
    }),
    then: (resolve: (value: unknown) => void) => resolve(ok()),
  };
  return query;
}

function makeSupabaseClient() {
  return {
    from: vi.fn((table: string) => makeQuery(table)),
  };
}

describe('runScanOnce EMBED-DRAIN status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    scannerState.vaultFiles = [];
    scannerState.drainMode = 'ok';
    vi.mocked(embeddingProvider.embed).mockResolvedValue([0.1]);
  });

  it('returns drain_query_failed and logs a stable error when the drain query returns an error object', async () => {
    scannerState.drainMode = 'error';

    const result = await runScanOnce(makeConfig());

    expect(result.embeddingStatus).toBe('drain_query_failed');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[EMBED-DRAIN] drain_query_failed'));
  });

  it('returns drain_query_failed and logs a stable error when the drain query throws', async () => {
    scannerState.drainMode = 'throw';

    const result = await runScanOnce(makeConfig());

    expect(result.embeddingStatus).toBe('drain_query_failed');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[EMBED-DRAIN] drain_query_failed'));
  });

  it('keeps timed_out precedence when drain embed promises do not settle', async () => {
    vi.useFakeTimers();
    scannerState.drainMode = 'docs';
    vi.mocked(embeddingProvider.embed).mockReturnValue(new Promise(() => undefined));

    const scan = runScanOnce(makeConfig());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await scan;

    expect(result.embeddingStatus).toBe('timed_out');
  });
});
