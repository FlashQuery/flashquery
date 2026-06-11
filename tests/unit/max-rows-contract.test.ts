import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  resolveRebuildConfirmFromResolvedWorkUnits,
  validateLifecycleActionParameters,
  validateMaxRows,
} from '../../src/embedding/lifecycle/scope.js';
import { maintainVault } from '../../src/services/maintenance.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance-id',
      vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false },
    embedding: {
      provider: 'none',
      model: '',
      apiKey: '',
      dimensions: 1536,
    },
    logging: { level: 'info', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

describe('max_rows lifecycle contract', () => {
  it('T-U-036 refuses when rows_in_scope exceeds max_rows', () => {
    const result = validateMaxRows('backfill_embeddings', 47_000, 1_000);

    expect(result).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'max_rows exceeded: 47000 rows are in scope but max_rows is 1000',
        identifier: 'max_rows',
        details: { rows_in_scope: 47_000, max_rows: 1_000 },
      },
    });
  });

  it('T-U-037 treats max_rows 0 as unlimited', () => {
    expect(validateMaxRows('backfill_embeddings', 47_000, 0)).toEqual({
      ok: true,
      payload: { effective_max_rows: 0, unlimited: true },
    });
  });

  it('T-U-038 rejects negative max_rows and names the 0-as-unlimited convention', () => {
    const result = validateMaxRows('backfill_embeddings', 10, -1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        error: 'invalid_input',
        identifier: 'max_rows',
        details: { max_rows: -1 },
      });
      expect(result.error.message).toContain('Use max_rows: 0 for unlimited');
    }
  });

  it('T-U-039 accepts omitted max_rows for backfill as unlimited', () => {
    expect(validateLifecycleActionParameters({ action: 'backfill_embeddings', scope: { entity_types: ['documents'] } }))
      .toEqual({
        ok: true,
        payload: { effective_max_rows: 0, unlimited: true },
      });
  });

  it('T-U-040 requires max_rows for rebuild_embeddings', () => {
    const result = validateLifecycleActionParameters({
      action: 'rebuild_embeddings',
      embedding_name: 'primary',
      confirm: 'primary',
      scope: { entity_types: ['documents'] },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'max_rows is required for rebuild_embeddings',
        identifier: 'max_rows',
        details: { action: 'rebuild_embeddings', parameter: 'max_rows' },
      },
    });
  });

  it('rejects max_rows for retire_embedding', () => {
    expect(
      validateLifecycleActionParameters({
        action: 'retire_embedding',
        embedding_name: 'primary',
        confirm: 'primary',
        max_rows: 1,
      })
    ).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'max_rows is not supported for retire_embedding',
        identifier: 'max_rows',
        details: { action: 'retire_embedding', parameter: 'max_rows' },
      },
    });
  });
});

describe('lifecycle action-array contract', () => {
  it('preserves the existing repair+sync action array', async () => {
    const result = await maintainVault(makeConfig(), { action: ['repair', 'sync'] });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['sync', 'backfill_embeddings'],
    ['repair', 'rebuild_embeddings'],
    ['retire_embedding'],
    ['abort'],
  ] as const)('rejects lifecycle action arrays before lifecycle work: %j', async (...action) => {
    const result = await maintainVault(makeConfig(), { action });

    expect(result).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message:
          'Lifecycle actions cannot be combined in action arrays; use one of backfill_embeddings, rebuild_embeddings, retire_embedding, or abort as a single action',
        identifier: 'maintain_vault',
        details: { parameter: 'action', action },
      },
    });
  });
});

describe('pure-records rebuild confirm contract', () => {
  it('derives expected_confirm from one resolved non-null plugin embedding_name', () => {
    expect(
      resolveRebuildConfirmFromResolvedWorkUnits({
        action: 'rebuild_embeddings',
        confirm: 'primary',
        scope: { entity_types: ['records'] },
        resolved_embedding_names: ['primary', 'primary', null],
      })
    ).toEqual({ ok: true, payload: { expected_confirm: 'primary' } });
  });

  it('requires a narrower records scope when resolved plugin embeddings span multiple names', () => {
    expect(
      resolveRebuildConfirmFromResolvedWorkUnits({
        action: 'rebuild_embeddings',
        confirm: 'primary',
        scope: { entity_types: ['records'] },
        resolved_embedding_names: ['primary', 'analysis'],
      })
    ).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message:
          'records scope resolves to multiple embedding names; narrow scope.plugin or scope.records.targets before rebuilding',
        identifier: 'scope',
        details: { resolved_embedding_names: ['analysis', 'primary'] },
      },
    });
  });
});
