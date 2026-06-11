import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_NAME = 's166_zero_semantic';

describe.skipIf(!HAS_SUPABASE).sequential('zero-active semantic search', () => {
  let harness: EmbeddingSearchHarness;

  afterEach(async () => {
    if (harness) await destroyEmbeddingSearchHarness(harness, [ENTRY_NAME]);
  });

  it('T-I-056 refuses semantic search with identifier search when every entry is deactivated', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-166-zero-active-semantic-file',
      entries: [{ name: ENTRY_NAME, status: 'deactivated' }],
    });

    const result = await harness.server.search({
      query: 'anything',
      mode: 'semantic',
      entity_types: ['documents'],
    }) as { isError?: boolean };
    const payload = parseToolJson<{ error: string; identifier: string; details: { remediation: string[] } }>(result);

    expect(result.isError).toBeFalsy();
    expect(payload.error).toBe('unsupported');
    expect(payload.identifier).toBe('search');
    expect(payload.details.remediation.length).toBeGreaterThan(0);
  }, 90_000);
});
