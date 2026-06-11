import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const pgMocks = vi.hoisted(() => ({
  withPgClient: vi.fn(),
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  withPgClient: pgMocks.withPgClient,
}));

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'unit-lifecycle-core',
      id: 'unit-lifecycle-core',
      vault: { path: '/tmp/unit-lifecycle-core', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    logging: { level: 'error', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

describe('core lifecycle embedding-name resolution', () => {
  it('REQ-041 returns ambiguous_identifier with active entries when embedding_name is omitted', async () => {
    const { resolveCoreLifecycleWorkPlan } =
      await import('../../src/embedding/lifecycle/core-processor.js');
    pgMocks.withPgClient.mockImplementation(async (_databaseUrl, callback) => {
      return await callback({
        query: vi.fn().mockResolvedValue({
          rows: [
            { name: 'analysis', dimensions: 3, endpoints: [], status: 'active' },
            { name: 'primary', dimensions: 3, endpoints: [], status: 'active' },
          ],
        }),
      });
    });

    const result = await resolveCoreLifecycleWorkPlan(
      makeConfig(),
      { action: 'backfill_embeddings', scope: { entity_types: ['documents'] } },
      'backfill_embeddings'
    );

    expect(result).toEqual({
      ok: false,
      error: {
        error: 'ambiguous_identifier',
        message: 'embedding_name is required when multiple active embedding catalog entries exist',
        identifier: 'embedding_name',
        details: { active_embeddings: ['analysis', 'primary'] },
      },
    });
  });
});
