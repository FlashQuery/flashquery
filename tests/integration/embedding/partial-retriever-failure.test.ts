import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_OK = 's166_partial_ok';
const ENTRY_FAIL = 's166_partial_fail';

describe.skipIf(!HAS_SUPABASE).sequential('partial retriever failure search behavior', () => {
  let harness: EmbeddingSearchHarness;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) await destroyEmbeddingSearchHarness(harness, [ENTRY_OK, ENTRY_FAIL]);
  });

  it('T-I-059 continues with successful retrievers and warns for failed retrievers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = JSON.parse(String((options as RequestInit).body));
      if (String(body.model).includes(ENTRY_FAIL)) {
        return { ok: false, status: 500, text: async () => 'provider down' } as Response;
      }
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) } as Response;
    });
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-partial-retriever',
      entries: [{ name: ENTRY_OK }, { name: ENTRY_FAIL }],
    });
    await addSearchDocument({
      harness,
      path: 'partial-alpha.md',
      title: 'Partial Alpha',
      vectorByEntry: { [ENTRY_OK]: [1, 0, 0], [ENTRY_FAIL]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 5,
    });
    const payload = parseToolJson<{
      embeddings_queried: string[];
      warnings: string[];
      results: Array<{ path: string }>;
    }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_OK]);
    expect(payload.warnings).toContain(`partial_retriever_failure:${ENTRY_FAIL}`);
    expect(payload.results).toEqual([expect.objectContaining({ path: 'partial-alpha.md' })]);
  }, 90_000);

  it('T-I-060 returns runtime_error when every selected retriever fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'provider down',
    } as Response);
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-all-retrievers-fail',
      entries: [{ name: ENTRY_OK }, { name: ENTRY_FAIL }],
    });

    const result = await harness.server.search({
      query: 'alpha',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 5,
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; details: { reason: string; retriever_failures: unknown[] } }>(result);

    expect(result.isError).toBe(true);
    expect(payload.error).toBe('runtime_error');
    expect(payload.details.reason).toBe('all_retrievers_failed');
    expect(payload.details.retriever_failures).toHaveLength(2);
  }, 90_000);
});
