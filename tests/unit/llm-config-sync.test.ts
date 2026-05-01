import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tracks every Supabase op invoked during a test for later assertions.
type SupabaseOp = { table: string; op: 'delete' | 'insert' | 'select'; payload?: unknown; filters: Array<[string, unknown]> };
const supabaseCalls: SupabaseOp[] = [];

function makeMockClient() {
  let current: { table?: string; op?: SupabaseOp['op']; filters: Array<[string, unknown]> } = { filters: [] };

  const recordAndReset = (op: SupabaseOp['op'], payload?: unknown) => {
    supabaseCalls.push({ table: current.table!, op, payload, filters: current.filters });
    current = { filters: [] };
  };

  const chain: any = {
    from(table: string) { current = { table, filters: [] }; return chain; },
    delete() { current.op = 'delete'; return chain; },
    select() { current.op = 'select'; return chain; },
    eq(col: string, val: unknown) { current.filters.push([col, val]); return chain; },
    in(col: string, vals: unknown[]) { current.filters.push([col, vals]); return chain; },
    insert(payload: unknown) { recordAndReset('insert', payload); return Promise.resolve({ data: null, error: null }); },
    maybeSingle() { recordAndReset(current.op ?? 'select'); return Promise.resolve({ data: null, error: null }); },
    // Awaiting a delete chain (no maybeSingle) — record on then()
    then(onFulfilled: (v: unknown) => unknown) {
      if (current.op === 'delete') recordAndReset('delete');
      return Promise.resolve({ data: null, error: null }).then(onFulfilled);
    },
  };
  return chain;
}

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => makeMockClient()) },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { syncLlmConfigToDb } from '../../src/llm/config-sync.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Helper: attach a pre-built rawLlmApiKeyRefs Map to a test config object so that
// getLlmApiKeyRefs(config) returns the expected values without going through loadConfig().
// This mirrors what loadConfig() does at startup (T-98-01: raw ${ENV_VAR} refs captured
// before env expansion and stored on the config object).
function withRawApiKeyRefs(config: FlashQueryConfig, refs: Record<string, string>): FlashQueryConfig {
  (config as unknown as Record<string, unknown>)['_rawLlmApiKeyRefs'] = new Map(Object.entries(refs));
  return config;
}

beforeEach(() => {
  supabaseCalls.length = 0;
  vi.clearAllMocks();
});

describe('syncLlmConfigToDb()', () => {
  it('[U-14] inserts providers, models, purposes, and purpose_models rows with source = yaml', async () => {
    const config = withRawApiKeyRefs(
      {
        instance: { name: 'Test', id: 'i-test-u14', vault: { path: '/tmp/v', markdownExtensions: ['.md'] } },
        server: { host: 'localhost', port: 3100 },
        supabase: { url: 'http://localhost', serviceRoleKey: 'k', databaseUrl: 'postgres://x', skipDdl: true },
        git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
        mcp: { transport: 'stdio' },
        locking: { enabled: true, ttlSeconds: 30 },
        embedding: { provider: 'none', model: '', dimensions: 1536 },
        logging: { level: 'info', output: 'stdout' },
        llm: {
          providers: [
            // apiKey here would be the RESOLVED value in production; the raw ref is
            // separately injected via withRawApiKeyRefs below (simulating loadConfig()).
            { name: 'openai', type: 'openai-compatible', endpoint: 'https://api.openai.com', apiKey: 'sk-resolved-secret' },
          ],
          models: [
            { name: 'gpt-4o', providerName: 'openai', model: 'gpt-4o', type: 'language', costPerMillion: { input: 2.5, output: 10 } },
          ],
          purposes: [
            { name: 'default', description: 'General', models: ['gpt-4o'] },
          ],
        },
      } satisfies FlashQueryConfig,
      // Simulate what loadConfig() captures BEFORE env expansion (T-98-01):
      { openai: '${OPENAI_API_KEY}' }
    );

    await syncLlmConfigToDb(config);

    // Deletes happen in dependency order: purpose_models (by purpose) -> purpose_models (by model, CR-02) -> purposes -> models -> providers.
    const deletes = supabaseCalls.filter((c) => c.op === 'delete').map((c) => c.table);
    expect(deletes).toEqual([
      'fqc_llm_purpose_models',  // by purpose_name (yaml purpose cleanup)
      'fqc_llm_purpose_models',  // by model_name (CR-02: prevent dangling FK from webapp purposes)
      'fqc_llm_purposes',
      'fqc_llm_models',
      'fqc_llm_providers',
    ]);

    // Provider insert with source='yaml' AND api_key_ref stores the literal ${ENV_VAR}, not the resolved secret.
    const providerInsert = supabaseCalls.find((c) => c.table === 'fqc_llm_providers' && c.op === 'insert');
    expect(providerInsert).toBeDefined();
    expect(providerInsert!.payload).toMatchObject({
      instance_id: 'i-test-u14',
      name: 'openai',
      type: 'openai-compatible',
      endpoint: 'https://api.openai.com',
      api_key_ref: '${OPENAI_API_KEY}',  // CRITICAL: raw reference, not resolved
      source: 'yaml',
    });

    // Model insert flattens cost_per_million.input/output to flat columns and includes source.
    const modelInsert = supabaseCalls.find((c) => c.table === 'fqc_llm_models' && c.op === 'insert');
    expect(modelInsert).toBeDefined();
    expect(modelInsert!.payload).toMatchObject({
      instance_id: 'i-test-u14',
      name: 'gpt-4o',
      provider_name: 'openai',
      model: 'gpt-4o',
      type: 'language',
      cost_per_million_input: 2.5,
      cost_per_million_output: 10,
      source: 'yaml',
    });

    // Purpose insert.
    const purposeInsert = supabaseCalls.find((c) => c.table === 'fqc_llm_purposes' && c.op === 'insert');
    expect(purposeInsert).toBeDefined();
    expect(purposeInsert!.payload).toMatchObject({
      instance_id: 'i-test-u14',
      name: 'default',
      source: 'yaml',
    });

    // purpose_models insert with 1-indexed position.
    const purposeModelInsert = supabaseCalls.find((c) => c.table === 'fqc_llm_purpose_models' && c.op === 'insert');
    expect(purposeModelInsert).toBeDefined();
    expect(purposeModelInsert!.payload).toMatchObject({
      instance_id: 'i-test-u14',
      purpose_name: 'default',
      model_name: 'gpt-4o',
      position: 1,
    });
  });
});
