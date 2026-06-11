import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { supabaseManager } from '../../../src/storage/supabase.js';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_ACTIVE = 's166_deact_active';
const ENTRY_OLD = 's166_deact_old';

function providerFor(name: string): EmbeddingProvider {
  return {
    embed: vi.fn(async () => name === ENTRY_ACTIVE ? [1, 0, 0] : [0, 1, 0]),
    getDimensions: () => 3,
    getProviderInfo: () => ({ provider: `provider-${name}`, model: `model-${name}` }),
    getLastEmbeddingMetadata: () => ({ truncated: false, warnings: [] }),
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('deactivated embedding search operations', () => {
  let harness: EmbeddingSearchHarness;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) await destroyEmbeddingSearchHarness(harness, [ENTRY_ACTIVE, ENTRY_OLD]);
  });

  it('T-I-018 skips deactivated write columns without deferred warnings', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-deactivated-write',
      entries: [{ name: ENTRY_ACTIVE }, { name: ENTRY_OLD, status: 'deactivated' }],
    });
    const documentId = randomUUID();
    await harness.client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title, status)
       VALUES ($1, $2, 'deactivated-write.md', 'Deactivated Write', 'active')`,
      [documentId, harness.config.instance.id]
    );

    const result = await scheduleBackgroundEmbeddingsForActiveEntries({
      config: harness.config,
      target: documentEmbeddingTarget({
        instanceId: harness.config.instance.id,
        id: documentId,
        label: 'deactivated-write.md',
      }),
      embedText: 'deactivated write body',
      supabase: supabaseManager.getClient(),
      databaseUrl: harness.config.supabase.databaseUrl,
      providerFactory: (entry) => providerFor(entry.name),
    });

    expect(result.warnings).not.toContain(`embedding_deferred:${ENTRY_OLD}`);
    expect(result.warnings).toEqual([]);
    const row = await harness.client.query(
      `SELECT embedding_${ENTRY_ACTIVE}::text AS active_vec,
              embedding_${ENTRY_OLD}::text AS old_vec
       FROM fqc_documents
       WHERE id = $1`,
      [documentId]
    );
    expect(row.rows[0]).toMatchObject({
      active_vec: '[1,0,0]',
      old_vec: null,
    });
  }, 90_000);

  it('T-I-019 refuses explicit search against a deactivated entry', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-deactivated-explicit',
      entries: [{ name: ENTRY_ACTIVE }, { name: ENTRY_OLD, status: 'deactivated' }],
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      embedding_names: [ENTRY_OLD],
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; identifier: string; details: { status: string } }>(result);

    expect(result.isError).toBeFalsy();
    expect(payload).toMatchObject({
      error: 'unsupported',
      identifier: ENTRY_OLD,
      details: { status: 'deactivated' },
    });
  }, 90_000);

  it('T-I-020 excludes deactivated entries from catalog-default search', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-deactivated-default',
      entries: [{ name: ENTRY_ACTIVE }, { name: ENTRY_OLD, status: 'deactivated' }],
    });
    await addSearchDocument({
      harness,
      path: 'active-alpha.md',
      title: 'Active Alpha',
      vectorByEntry: { [ENTRY_ACTIVE]: [1, 0, 0], [ENTRY_OLD]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 5,
    });
    const payload = parseToolJson<{ embeddings_queried: string[]; results: Array<{ path: string }> }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_ACTIVE]);
    expect(payload.results).toEqual([expect.objectContaining({ path: 'active-alpha.md' })]);
  }, 90_000);
});
