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

describe.skipIf(!HAS_SUPABASE)('plugin write_record embedding routing', () => {
  let harness: PluginRecordHarness | undefined;

  afterEach(async () => {
    providerState.calls = [];
    if (harness) {
      await destroyPluginRecordHarness(harness);
      harness = undefined;
    }
  });

  it('T-I-064 embeds against the plugin single registered entry only', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_write_one';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    const registerResult = await harness.registerPlugin({
      schema_yaml: pluginRecordYaml(pluginId, '*'),
      embedding_name: 'primary',
    }) as { isError?: boolean };
    expect(registerResult.isError).toBeFalsy();

    const writeResult = await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Alpha record', body: 'Primary embedding only' },
      include: ['data'],
    }) as { isError?: boolean };
    expect(writeResult.isError).toBeFalsy();
    const payload = JSON.parse(textOf(writeResult)) as { id: string; warnings?: string[] };
    expect(payload.warnings).toBeUndefined();
    expect(providerState.calls).toEqual([{ entryName: 'primary', text: 'Alpha record\nPrimary embedding only' }]);

    const row = await harness.client.query(
      `SELECT embedding_primary::text AS primary_vec,
              embedding_primary_model AS model
       FROM ${tableName} WHERE id = $1`,
      [payload.id]
    );
    expect(row.rows[0]).toMatchObject({ model: 'primary-model' });
    expect(row.rows[0].primary_vec).toBe('[0.1,0.2,0.3]');
  }, 90_000);

  it('T-I-064 emits no embed call for an opted-out plugin', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_write_null';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    await harness.registerPlugin({ schema_yaml: pluginRecordYaml(pluginId, null) });

    const writeResult = await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Opted out', body: 'No vectors' },
    }) as { isError?: boolean };
    expect(writeResult.isError).toBeFalsy();
    expect(providerState.calls).toEqual([]);
  }, 90_000);
});
