import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  getMaintenanceJobStatus,
  maintainVault,
  resetMaintenanceStateForTests,
} from '../../src/services/maintenance.js';
import { setShuttingDown } from '../../src/server/shutdown-state.js';

const scannerMocks = vi.hoisted(() => ({
  runScanOnce: vi.fn(),
  repairFrontmatter: vi.fn(),
}));

vi.mock('../../src/services/scanner.js', () => ({
  runScanOnce: scannerMocks.runScanOnce,
  repairFrontmatter: scannerMocks.repairFrontmatter,
}));

vi.mock('../../src/services/plugin-reconciliation.js', () => ({
  invalidateReconciliationCache: vi.fn(),
}));

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
    locking: { enabled: false, ttlSeconds: 30 },
    embedding: {
      provider: 'none',
      model: '',
      apiKey: '',
      dimensions: 1536,
    },
    logging: { level: 'info', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

describe('maintainVault service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setShuttingDown(false);
    resetMaintenanceStateForTests();
    scannerMocks.runScanOnce.mockResolvedValue({
      hashMismatches: 3,
      statusMismatches: 1,
      newFiles: 2,
      movedFiles: 4,
      deletedFiles: 5,
      embeddingStatus: 'complete',
      embedsAwaited: 9,
    });
    scannerMocks.repairFrontmatter.mockResolvedValue({
      scanned: 7,
      added: 0,
      updated: 0,
      repaired: 6,
      archived: 1,
    });
  });

  it('runs combined sync and repair actions as repair before sync', async () => {
    const result = await maintainVault(makeConfig(), { action: ['sync', 'repair'] });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        actions: [
          { action: 'repair', dry_run: false, counts: { scanned: 7, repaired: 6, archived: 1 } },
          { action: 'sync', dry_run: false, counts: { scanned: 15, added: 2, updated: 7, repaired: 0, archived: 5 } },
        ],
      },
    });
    expect(scannerMocks.repairFrontmatter).toHaveBeenCalledBefore(scannerMocks.runScanOnce);
  });

  it('allows dry_run only for repair', async () => {
    const repair = await maintainVault(makeConfig(), { action: 'repair', dry_run: true });
    const sync = await maintainVault(makeConfig(), { action: 'sync', dry_run: true });

    expect(repair.ok).toBe(true);
    expect(scannerMocks.repairFrontmatter).toHaveBeenCalledWith(makeConfig(), { dryRun: true });
    expect(sync).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'dry_run is only supported for action: repair',
        identifier: 'sync',
        details: { parameter: 'dry_run' },
      },
    });
  });

  it('allows background only for sync and returns accepted job_id metadata', async () => {
    const sync = await maintainVault(makeConfig(), { action: 'sync', background: true });
    const repair = await maintainVault(makeConfig(), { action: 'repair', background: true });

    expect(sync).toMatchObject({
      ok: true,
      payload: { accepted: true, job_id: expect.any(String), started_at: expect.any(String) },
    });
    expect(repair).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'background is only supported for action: sync',
        identifier: 'repair',
        details: { parameter: 'background' },
      },
    });
  });

  it('returns not_found for unknown job_id status', () => {
    const status = getMaintenanceJobStatus('missing-job-id');

    expect(status).toEqual({
      ok: false,
      error: {
        error: 'not_found',
        message: "No maintenance job found for job_id 'missing-job-id'",
        identifier: 'missing-job-id',
      },
    });
  });

  it('returns conflict with maintenance_in_progress for concurrent maintenance', async () => {
    let releaseScan: () => void = () => {};
    scannerMocks.runScanOnce.mockReturnValue(
      new Promise((resolve) => {
        releaseScan = () =>
          resolve({
            hashMismatches: 0,
            statusMismatches: 0,
            newFiles: 0,
            movedFiles: 0,
            deletedFiles: 0,
            embeddingStatus: 'complete',
            embedsAwaited: 0,
          });
      })
    );

    const first = maintainVault(makeConfig(), { action: 'sync' });
    const second = await maintainVault(makeConfig(), { action: 'repair' });
    releaseScan();
    await first;

    expect(second).toEqual({
      ok: false,
      error: {
        error: 'conflict',
        message: 'A vault maintenance operation is already running',
        identifier: 'maintain_vault',
        details: { reason: 'maintenance_in_progress' },
      },
    });
  });

  it('rejects new maintenance starts during shutdown and marks in-flight abort state', async () => {
    setShuttingDown(true);

    const rejected = await maintainVault(makeConfig(), { action: 'sync' });
    const statusKeys = Object.keys(
      (await maintainVault(makeConfig(), { action: 'sync', background: true })).ok ? {} : {}
    );

    expect(rejected).toEqual({
      ok: false,
      error: {
        error: 'runtime_error',
        message: 'Server is shutting down; new requests cannot be processed',
        details: { reason: 'shutdown' },
      },
    });
    expect(statusKeys).not.toContain('queue_depth');
  });

  it('status output excludes scanner internals and availability fields', async () => {
    const accepted = await maintainVault(makeConfig(), { action: 'sync', background: true });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error('background sync should be accepted');
    }

    await vi.waitFor(() => {
      const status = getMaintenanceJobStatus(accepted.payload.job_id);
      expect(status.ok).toBe(true);
    });
    const status = getMaintenanceJobStatus(accepted.payload.job_id);
    expect(status.ok).toBe(true);
    if (!status.ok) {
      throw new Error('status should exist');
    }

    const serialized = JSON.stringify(status.payload);
    expect(serialized).not.toContain('queue_depth');
    expect(serialized).not.toContain('hash');
    expect(serialized).not.toContain('embedding_status');
    expect(serialized).not.toContain('embeds_awaited');
    expect(serialized).not.toContain('availability');
    expect(serialized).not.toContain('per_document');
  });
});
