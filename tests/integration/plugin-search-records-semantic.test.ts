import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const providerState = vi.hoisted(() => ({ calls: [] as Array<{ entryName: string; text: string }> }));

vi.mock('../../src/embedding/provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/embedding/provider.js')>('../../src/embedding/provider.js');
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn((_config, entry: { name: string; dimensions: number }) => ({
      embed: vi.fn(async (text: string) => {
        providerState.calls.push({ entryName: entry.name, text });
        return Array.from({ length: entry.dimensions }, (_, index) => (index + 1) / 10);
      }),
      getProviderInfo: () => ({ provider: 'mock-provider', model: `${entry.name}-model` }),
      getLastEmbeddingMetadata: () => ({ truncated: false, warnings: [] }),
    })),
  };
});

import {
  createPluginRecordHarness,
  destroyPluginRecordHarness,
  pluginRecordYaml,
  textOf,
  type PluginRecordHarness,
} from './plugin-record-embedding-helpers.js';

describe.skipIf(!HAS_SUPABASE)('plugin search_records semantic routing', () => {
  let harness: PluginRecordHarness | undefined;

  afterEach(async () => {
    providerState.calls = [];
    if (harness) {
      await destroyPluginRecordHarness(harness);
      harness = undefined;
    }
  });

  it('T-I-065 queries the plugin resolved embedding column', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_search_one';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    await harness.registerPlugin({
      schema_yaml: pluginRecordYaml(pluginId, '*'),
      embedding_name: 'primary',
    });
    providerState.calls = [];

    const writeResult = await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Needle', body: 'Semantic haystack' },
    }) as { isError?: boolean };
    const written = JSON.parse(textOf(writeResult)) as { id: string };
    expect(written.id).toEqual(expect.any(String));
    providerState.calls = [];

    const searchResult = await harness.searchRecords({
      plugin_id: pluginId,
      table: 'notes',
      query: 'Needle',
      include: ['data'],
    }) as { isError?: boolean };
    expect(searchResult.isError).toBeFalsy();
    const payload = JSON.parse(textOf(searchResult)) as { total: number; results: Array<{ score?: number; data?: Record<string, unknown> }> };
    expect(providerState.calls).toEqual([{ entryName: 'primary', text: 'Needle' }]);
    expect(payload.total).toBe(1);
    expect(payload.results[0]?.score).toEqual(expect.any(Number));
    expect(payload.results[0]?.data?.title).toBe('Needle');
  }, 90_000);

  it('T-I-066 falls back to ILIKE for an opted-out plugin without semantic score', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_search_null';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    await harness.registerPlugin({ schema_yaml: pluginRecordYaml(pluginId, null) });

    await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Fallback Needle', body: 'Plain text path' },
    });
    providerState.calls = [];

    const searchResult = await harness.searchRecords({
      plugin_id: pluginId,
      table: 'notes',
      query: 'Fallback',
      include: ['data'],
    }) as { isError?: boolean };
    expect(searchResult.isError).toBeFalsy();
    const payload = JSON.parse(textOf(searchResult)) as { total: number; results: Array<{ score?: number; data?: Record<string, unknown> }> };
    expect(providerState.calls).toEqual([]);
    expect(payload.total).toBe(1);
    expect(payload.results[0]?.score).toBeUndefined();
    expect(payload.results[0]?.data?.title).toBe('Fallback Needle');
  }, 90_000);
});
