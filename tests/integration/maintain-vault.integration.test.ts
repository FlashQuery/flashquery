import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { resetMaintenanceStateForTests } from '../../src/services/maintenance.js';
import { setShuttingDown } from '../../src/server/shutdown-state.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'maintain-vault-integration-test-id';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'maintain-vault-integration-test',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    server: { host: 'localhost', port: 3200 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    plugins: {},
    locking: { enabled: true, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createHandler(config: FlashQueryConfig): (params: Record<string, unknown>) => Promise<unknown> {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  registerScanTools(server, config);
  return handlers.maintain_vault;
}

function parseResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('maintain_vault integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let maintainVault: (params: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-maintain-vault-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    maintainVault = createHandler(config);
  }, 30_000);

  afterAll(async () => {
    try {
      await supabaseManager
        .getClient()
        .from('fqc_documents')
        .delete()
        .eq('instance_id', TEST_INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Ignore cleanup failures in skipped or partially initialized environments.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    setShuttingDown(false);
    resetMaintenanceStateForTests();
    await supabaseManager
      .getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await initVault(config);
    maintainVault = createHandler(config);
  });

  it('maintain_vault sync indexes an external markdown file and returns counts.scanned', async () => {
    await writeFile(join(vaultPath, 'external-sync.md'), '# External Sync\n\nCreated outside FlashQuery.');

    const result = await maintainVault({ action: 'sync' });
    const payload = parseResult(result);

    expect(payload.actions).toMatchObject([
      {
        action: 'sync',
        counts: { scanned: expect.any(Number), added: expect.any(Number) },
      },
    ]);
    expect((payload.actions as Array<{ counts: { scanned: number } }>)[0].counts.scanned).toBeGreaterThan(0);

    const { data } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('path')
      .eq('instance_id', TEST_INSTANCE_ID)
      .eq('path', 'external-sync.md')
      .single();
    expect(data?.path).toBe('external-sync.md');
  });

  it('maintain_vault repair dry_run reports action result without mutating frontmatter', async () => {
    await writeFile(join(vaultPath, 'needs-repair.md'), '# Needs Repair\n\nNo FQ frontmatter.');
    await supabaseManager.getClient().from('fqc_documents').insert({
      id: '11111111-1111-4111-8111-111111111111',
      instance_id: TEST_INSTANCE_ID,
      path: 'needs-repair.md',
      title: 'Needs Repair',
      status: 'active',
      content_hash: 'pre-repair-hash',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      needs_frontmatter_repair: true,
    });

    const result = await maintainVault({ action: 'repair', dry_run: true });
    const payload = parseResult(result);
    const fileAfterDryRun = await readFile(join(vaultPath, 'needs-repair.md'), 'utf8');

    expect(payload.actions).toMatchObject([
      { action: 'repair', dry_run: true, counts: { scanned: 1, repaired: 1 } },
    ]);
    expect(fileAfterDryRun).not.toContain('fq_id');
  });

  it('maintain_vault combined repair sync orders repair before sync', async () => {
    const result = await maintainVault({ action: ['sync', 'repair'] });
    const payload = parseResult(result);

    expect((payload.actions as Array<{ action: string }>).map((action) => action.action)).toEqual([
      'repair',
      'sync',
    ]);
  });

  it('maintain_vault background sync exposes job_id status and unknown status returns not_found', async () => {
    const acceptedResult = await maintainVault({ action: 'sync', background: true });
    const accepted = parseResult(acceptedResult);

    expect(accepted).toMatchObject({
      accepted: true,
      job_id: expect.any(String),
      started_at: expect.any(String),
    });

    await vi.waitFor(async () => {
      const statusPayload = parseResult(await maintainVault({ action: 'status', job_id: accepted.job_id }));
      expect(statusPayload.status).toMatch(/running|completed|failed|aborted/);
    });

    const unknown = await maintainVault({ action: 'status', job_id: 'unknown-job-id' }) as { isError?: boolean };
    expect(unknown.isError).toBe(false);
    expect(parseResult(unknown)).toMatchObject({ error: 'not_found', identifier: 'unknown-job-id' });
  });

  it('maintain_vault concurrent maintenance returns conflict with maintenance_in_progress', async () => {
    await writeFile(join(vaultPath, 'conflict.md'), '# Conflict\n\nForces background work.');

    const accepted = parseResult(await maintainVault({ action: 'sync', background: true }));
    expect(accepted.job_id).toEqual(expect.any(String));

    const conflict = await maintainVault({ action: 'sync' }) as { isError?: boolean };
    expect(conflict.isError).toBe(false);
    expect(parseResult(conflict)).toMatchObject({
      error: 'conflict',
      details: { reason: 'maintenance_in_progress' },
    });
  });

  it('maintain_vault shutdown rejects new starts and documents drain abort status boundary', async () => {
    setShuttingDown(true);

    const rejected = await maintainVault({ action: 'sync' }) as { isError?: boolean };
    const payload = parseResult(rejected);

    expect(rejected.isError).toBe(true);
    expect(payload).toMatchObject({
      error: 'runtime_error',
      details: { reason: 'shutdown' },
    });
    expect(JSON.stringify(payload)).not.toContain('queue_depth');
    expect(JSON.stringify(payload)).not.toContain('availability');
    // In-flight drain/abort is owned by the same service status state as background jobs.
  });
});
