import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_PRIMARY = 's166_names_primary';
const ENTRY_SECONDARY = 's166_names_secondary';
const ENTRY_OLD = 's166_names_old';

describe.skipIf(!HAS_SUPABASE).sequential('search embedding_names parameter', () => {
  let harness: EmbeddingSearchHarness;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY, ENTRY_SECONDARY, ENTRY_OLD]);
    }
  });

  it('T-I-051 limits semantic search to a singleton requested embedding name', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-embedding-names-singleton',
      entries: [{ name: ENTRY_PRIMARY }, { name: ENTRY_SECONDARY }],
    });
    await addSearchDocument({
      harness,
      path: 'primary-only.md',
      title: 'Primary Only',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0], [ENTRY_SECONDARY]: [0, 1, 0] },
    });

    const result = await harness.server.search({
      query: 'primary',
      mode: 'semantic',
      entity_types: ['documents'],
      embedding_names: [ENTRY_PRIMARY],
    });
    const payload = parseToolJson<{ embeddings_queried: string[]; fusion: string; results: unknown[] }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_PRIMARY]);
    expect(payload.fusion).toBe('none');
    expect(payload.results).toHaveLength(1);
  }, 90_000);

  it('T-I-052 rejects an empty embedding_names array as invalid_input', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-embedding-names-empty',
      entries: [{ name: ENTRY_PRIMARY }],
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      embedding_names: [],
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; identifier: string }>(result);

    expect(result.isError).toBeFalsy();
    expect(payload).toMatchObject({ error: 'invalid_input', identifier: 'embedding_names' });
  }, 90_000);

  it('T-I-053 rejects an unknown embedding name as not_found', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-embedding-names-unknown',
      entries: [{ name: ENTRY_PRIMARY }],
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      embedding_names: ['missing_entry'],
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; identifier: string }>(result);

    expect(result.isError).toBeFalsy();
    expect(payload).toMatchObject({ error: 'not_found', identifier: 'missing_entry' });
  }, 90_000);

  it('T-I-054 rejects an explicitly requested deactivated embedding as unsupported', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-embedding-names-deactivated',
      entries: [{ name: ENTRY_PRIMARY }, { name: ENTRY_OLD, status: 'deactivated' }],
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

  it('T-I-055 ignores embedding_names in filesystem mode with a warning', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-embedding-names-filesystem',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({ harness, path: 'filesystem-alpha.md', title: 'Filesystem Alpha' });

    const result = await harness.server.search({
      query: 'filesystem',
      mode: 'filesystem',
      entity_types: ['documents'],
      embedding_names: [ENTRY_PRIMARY],
    });
    const payload = parseToolJson<{ embeddings_queried: string[]; fusion: string; warnings: string[]; results: unknown[] }>(result);

    expect(payload.embeddings_queried).toEqual([]);
    expect(payload.fusion).toBe('none');
    expect(payload.warnings).toContain('embedding_names_ignored');
    expect(payload.results).toHaveLength(1);
  }, 90_000);
});
