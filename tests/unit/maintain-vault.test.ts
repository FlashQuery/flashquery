import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import {
  getMaintenanceJobStatus,
  maintainVault,
  resetMaintenanceStateForTests,
} from '../../src/services/maintenance.js';
import { setShuttingDown } from '../../src/server/shutdown-state.js';

const scannerMocks = vi.hoisted(() => ({
  runScanOnce: vi.fn(),
  repairFrontmatter: vi.fn(),
  reconcileTrackedDocuments: vi.fn(),
}));

vi.mock('../../src/services/scanner.js', () => ({
  runScanOnce: scannerMocks.runScanOnce,
  repairFrontmatter: scannerMocks.repairFrontmatter,
  reconcileTrackedDocuments: scannerMocks.reconcileTrackedDocuments,
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

function createMockServer(): {
  server: McpServer;
  handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return { server, handlers };
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ text: string }> };
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
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
    scannerMocks.reconcileTrackedDocuments.mockResolvedValue({
      scanned: 7,
      updated: 6,
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
    expect(scannerMocks.reconcileTrackedDocuments).toHaveBeenCalledBefore(scannerMocks.runScanOnce);
    expect(scannerMocks.repairFrontmatter).not.toHaveBeenCalled();
  });

  it('allows dry_run only for repair', async () => {
    const repair = await maintainVault(makeConfig(), { action: 'repair', dry_run: true });
    const sync = await maintainVault(makeConfig(), { action: 'sync', dry_run: true });

    expect(repair.ok).toBe(true);
    expect(scannerMocks.reconcileTrackedDocuments).toHaveBeenCalledWith(makeConfig(), { dryRun: true });
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

  it('rejects dry_run and background for status requests', async () => {
    const dryRun = await maintainVault(makeConfig(), { action: 'status', job_id: 'missing', dry_run: true });
    const background = await maintainVault(makeConfig(), { action: 'status', job_id: 'missing', background: true });

    expect(dryRun).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'dry_run is not supported for action: status',
        identifier: 'status',
        details: { parameter: 'dry_run' },
      },
    });
    expect(background).toEqual({
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'background is not supported for action: status',
        identifier: 'status',
        details: { parameter: 'background' },
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

  it('returns conflict instead of accepting background work while maintenance is running', async () => {
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
    const second = await maintainVault(makeConfig(), { action: 'sync', background: true });
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

  it('handles drain_query_failed with a stable public warning and no scanner internals', async () => {
    scannerMocks.runScanOnce.mockResolvedValueOnce({
      hashMismatches: 0,
      statusMismatches: 0,
      newFiles: 0,
      movedFiles: 0,
      deletedFiles: 0,
      embeddingStatus: 'drain_query_failed',
      embedsAwaited: 0,
    });

    const result = await maintainVault(makeConfig(), { action: 'sync' });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        actions: [
          {
            action: 'sync',
            warnings: ['embedding_drain_query_failed'],
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('embedding_status');
    expect(serialized).not.toContain('embeds_awaited');
  });
});

describe('maintain_vault MCP handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setShuttingDown(false);
    resetMaintenanceStateForTests();
    scannerMocks.runScanOnce.mockResolvedValue({
      hashMismatches: 1,
      statusMismatches: 0,
      newFiles: 2,
      movedFiles: 0,
      deletedFiles: 0,
      embeddingStatus: 'complete',
      embedsAwaited: 3,
    });
    scannerMocks.repairFrontmatter.mockResolvedValue({
      scanned: 4,
      added: 0,
      updated: 1,
      repaired: 1,
      archived: 0,
    });
    scannerMocks.reconcileTrackedDocuments.mockResolvedValue({
      scanned: 4,
      updated: 1,
      archived: 0,
    });
  });

  it('registers maintain_vault instead of active force_file_scan', () => {
    const { server, handlers } = createMockServer();

    registerScanTools(server, makeConfig());

    expect(server.registerTool).toHaveBeenCalledWith(
      'maintain_vault',
      expect.any(Object),
      expect.any(Function)
    );
    expect(handlers.maintain_vault).toBeTypeOf('function');
    expect(handlers.force_file_scan).toBeUndefined();
  });

  it('returns sync actions with started_at counts and no scanner-internal embedding_status fields', async () => {
    const { handlers } = createMockServer();
    registerScanTools({ registerTool: vi.fn((name, _config, handler) => (handlers[name] = handler)) } as unknown as McpServer, makeConfig());

    const result = await handlers.maintain_vault({ action: 'sync' });
    const payload = parseToolResult(result);

    expect(payload.actions).toMatchObject([
      {
        action: 'sync',
        started_at: expect.any(String),
        finished_at: expect.any(String),
        dry_run: false,
        counts: { scanned: 3, added: 2, updated: 1, repaired: 0, archived: 0 },
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain('embedding_status');
    expect(JSON.stringify(payload)).not.toContain('embeds_awaited');
  });

  it('returns accepted job_id metadata for background sync', async () => {
    const { server, handlers } = createMockServer();
    registerScanTools(server, makeConfig());

    const result = await handlers.maintain_vault({ action: 'sync', background: true });
    const payload = parseToolResult(result);

    expect(payload).toMatchObject({
      accepted: true,
      job_id: expect.any(String),
      started_at: expect.any(String),
    });
  });

  it('maps invalid combinations, conflicts, and unknown jobs to JSON expected errors', async () => {
    const { server, handlers } = createMockServer();
    registerScanTools(server, makeConfig());

    const invalid = await handlers.maintain_vault({ action: 'repair', background: true }) as {
      isError?: boolean;
    };
    const unknown = await handlers.maintain_vault({ action: 'status', job_id: 'missing' }) as {
      isError?: boolean;
    };

    expect(invalid.isError).toBe(false);
    expect(parseToolResult(invalid)).toMatchObject({
      error: 'invalid_input',
      details: { parameter: 'background' },
    });
    expect(unknown.isError).toBe(false);
    expect(parseToolResult(unknown)).toMatchObject({
      error: 'not_found',
      identifier: 'missing',
    });
  });
});
