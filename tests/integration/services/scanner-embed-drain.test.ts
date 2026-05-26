import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { initEmbedding } from '../../../src/embedding/provider.js';
import { initLogger } from '../../../src/logging/logger.js';
import { runScanOnce } from '../../../src/services/scanner.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-145-scanner-drain';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
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
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

function wrapDrainQuery<T extends object>(query: T): T {
  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === 'is') {
        return () => Promise.resolve({ data: null, error: { message: 'forced drain query failure' } });
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        return next === target ? receiver : next;
      };
    },
  });
}

describe.skipIf(!HAS_SUPABASE)('scanner EMBED-DRAIN failure status (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let realClient: ReturnType<typeof supabaseManager.getClient>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'phase-145-scanner-drain-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    realClient = supabaseManager.getClient();
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await realClient.from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await realClient.from('fqc_vault').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.close();
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('continues the scan and returns drain_query_failed when the unembedded-doc query fails', async () => {
    vi.spyOn(supabaseManager, 'getClient').mockReturnValue({
      ...realClient,
      from: vi.fn((table: string) => {
        const query = realClient.from(table);
        return new Proxy(query, {
          get(target, prop, receiver) {
            if (prop === 'select') {
              return (columns: string, ...args: unknown[]) => {
                const selected = target.select(columns, ...args);
                return columns === 'id, path, title' ? wrapDrainQuery(selected) : selected;
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }),
      rpc: realClient.rpc.bind(realClient),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const result = await runScanOnce(config);

    expect(result.embeddingStatus).toBe('drain_query_failed');
  });
});
