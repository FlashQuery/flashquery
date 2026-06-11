import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const providerState = vi.hoisted(() => ({
  calls: [] as Array<{ entryName: string; text: string }>,
  fail: false,
}));

vi.mock('../../src/embedding/provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/embedding/provider.js')>('../../src/embedding/provider.js');
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn((_config, entry: { name: string; dimensions: number }) => ({
      embed: vi.fn(async (text: string) => {
        providerState.calls.push({ entryName: entry.name, text });
        if (providerState.fail) {
          throw new Error('forced plugin embedding failure');
        }
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
    providerState.fail = false;
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

  it('embeds against the switched entry after same-version re-registration', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_write_switch';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    await harness.registerPlugin({
      schema_yaml: pluginRecordYaml(pluginId, '*'),
      embedding_name: 'primary',
    });
    await harness.registerPlugin({
      schema_yaml: pluginRecordYaml(pluginId, '*'),
      embedding_name: 'analysis',
    });
    providerState.calls = [];

    const writeResult = await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Switched', body: 'Analysis embedding only' },
      include: ['data'],
    }) as { isError?: boolean };
    expect(writeResult.isError).toBeFalsy();
    const payload = JSON.parse(textOf(writeResult)) as { id: string; warnings?: string[] };
    expect(payload.warnings).toBeUndefined();
    expect(providerState.calls).toEqual([{ entryName: 'analysis', text: 'Switched\nAnalysis embedding only' }]);

    const row = await harness.client.query(
      `SELECT embedding_primary::text AS primary_vec,
              embedding_analysis::text AS analysis_vec,
              embedding_analysis_model AS analysis_model
       FROM ${tableName} WHERE id = $1`,
      [payload.id]
    );
    expect(row.rows[0]).toMatchObject({ primary_vec: null, analysis_model: 'analysis-model' });
    expect(row.rows[0].analysis_vec).toBe('[0.1,0.2,0.3]');
  }, 90_000);

  it('emits a suffixed deferred warning and pending row when plugin embedding fails', async () => {
    harness = await createPluginRecordHarness();
    const pluginId = 'plug_write_deferred';
    const tableName = `fqcp_${pluginId}_default_notes`;
    harness.tablesToDrop.add(tableName);
    await harness.registerPlugin({
      schema_yaml: pluginRecordYaml(pluginId, '*'),
      embedding_name: 'primary',
    });
    providerState.fail = true;

    const writeResult = await harness.writeRecord({
      mode: 'create',
      plugin_id: pluginId,
      table: 'notes',
      data: { title: 'Deferred', body: 'Provider fails' },
      include: ['data'],
    }) as { isError?: boolean };
    expect(writeResult.isError).toBeFalsy();
    const payload = JSON.parse(textOf(writeResult)) as { id: string; warnings?: string[] };
    expect(payload.warnings).toEqual(['embedding_deferred:primary']);

    const pending = await harness.client.query(
      `SELECT embedding_name, target_table, target_id, last_error
       FROM fqc_pending_embeds
       WHERE instance_id = $1 AND target_id = $2`,
      [harness.instanceId, payload.id]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        embedding_name: 'primary',
        target_table: tableName,
        target_id: payload.id,
      }),
    ]);
    expect(pending.rows[0].last_error).toMatch(/forced plugin embedding failure/i);
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
