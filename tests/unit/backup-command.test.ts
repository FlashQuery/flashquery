/**
 * Tests for `flashquery backup` CLI command.
 *
 * Strategy: mock GitManagerImpl and loadConfig entirely — the git-manager.test.ts suite
 * covers the individual method behaviors. Here we test the CLI's routing
 * logic: does it call the right methods in the right order, handle
 * --db-only correctly, degrade gracefully without git, and exit correctly?
 *
 * We test via the exported runBackupCommand() function which contains the
 * backup logic extracted from the CLI's async IIFE. This avoids the need
 * to re-import the module for each test (which breaks Vitest mock hoisting).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockLoadConfig = vi.fn();
  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockDumpDatabase = vi.fn().mockResolvedValue('.fqc/backup.json');
  const mockCommitAllVaultChanges = vi.fn().mockResolvedValue(undefined);
  const mockTagBackup = vi.fn().mockResolvedValue(undefined);

  // Store isGitReady on the mocks object so it can be accessed from the getter
  // after vi.clearAllMocks() resets mock implementations
  const state = { isGitReady: true };

  const MockGitManagerImpl = vi.fn().mockImplementation(function () {
    return {
      initialize: mockInitialize,
      dumpDatabase: mockDumpDatabase,
      commitAllVaultChanges: mockCommitAllVaultChanges,
      tagBackup: mockTagBackup,
      get isGitReady() { return state.isGitReady; },
    };
  });

  return {
    mockLoadConfig,
    mockInitialize,
    mockDumpDatabase,
    mockCommitAllVaultChanges,
    mockTagBackup,
    MockGitManagerImpl,
    state,
    setIsGitReady: (val: boolean) => { state.isGitReady = val; },
  };
});

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: mocks.mockLoadConfig,
}));

vi.mock('../../src/git/manager.js', () => ({
  GitManagerImpl: mocks.MockGitManagerImpl,
  initGit: vi.fn(),
}));

// Mock all other imports that index.ts uses at module level
vi.mock('../../src/logging/logger.js', () => ({
  initLogger: vi.fn(),
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/storage/supabase.js', () => ({
  initSupabase: vi.fn(),
  supabaseManager: {
    getClient: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({ data: [], error: null }),
        update: vi.fn().mockReturnThis(),
      }),
    }),
  },
}));
vi.mock('../../src/storage/vault.js', () => ({
  initVault: vi.fn(),
  vaultManager: { readMarkdown: vi.fn().mockResolvedValue({ data: {}, content: '' }) },
}));
vi.mock('../../src/projects/seeder.js', () => ({ initProjects: vi.fn() }));
vi.mock('../../src/embedding/provider.js', () => ({
  initEmbedding: vi.fn(),
  embeddingProvider: { embed: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../src/plugins/manager.js', () => ({
  initPlugins: vi.fn(),
  pluginManager: { getAllEntries: vi.fn().mockReturnValue([]) },
}));
vi.mock('../../src/mcp/server.js', () => ({ initMCP: vi.fn() }));
vi.mock('../../src/services/scanner.js', () => ({
  runScanOnce: vi.fn().mockResolvedValue({
    hashMismatches: 0,
    statusMismatches: 0,
    newFiles: 0,
    movedFiles: 0,
    deletedFiles: 0,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import the exported function under test
// ─────────────────────────────────────────────────────────────────────────────

import { runBackupCommand, runScanCommand } from '../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('flashquery backup command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setIsGitReady(true);
    // Restore MockGitManagerImpl implementation after clearAllMocks wipes it.
    // The getter references mocks.state.isGitReady so setIsGitReady() takes effect.
    mocks.MockGitManagerImpl.mockImplementation(function () {
      return {
        initialize: mocks.mockInitialize,
        dumpDatabase: mocks.mockDumpDatabase,
        commitAllVaultChanges: mocks.mockCommitAllVaultChanges,
        tagBackup: mocks.mockTagBackup,
        get isGitReady() { return mocks.state.isGitReady; },
      };
    });
    mocks.mockLoadConfig.mockReturnValue({
      instance: { name: 'test', id: 'test-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
      git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
      supabase: { databaseUrl: 'postgresql://localhost/test', url: 'http://localhost', serviceRoleKey: 'key', skipDdl: false },
      embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
      logging: { level: 'info', output: 'stdout' },
      mcp: { transport: 'stdio' },
    });
    mocks.mockInitialize.mockResolvedValue(undefined);
    mocks.mockDumpDatabase.mockResolvedValue('.fqc/backup.json');
    mocks.mockCommitAllVaultChanges.mockResolvedValue(undefined);
    mocks.mockTagBackup.mockResolvedValue(undefined);
  });

  it('full backup: calls dumpDatabase, commitAllVaultChanges, tagBackup in order', async () => {
    const callOrder: string[] = [];
    mocks.mockDumpDatabase.mockImplementation(async () => { callOrder.push('dump'); return '.fqc/backup.json'; });
    mocks.mockCommitAllVaultChanges.mockImplementation(async () => { callOrder.push('commitAll'); });
    mocks.mockTagBackup.mockImplementation(async () => { callOrder.push('tag'); });

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
    await runBackupCommand('./test.yaml', false);
    mockExit.mockRestore();

    expect(callOrder).toEqual(['dump', 'commitAll', 'tag']);
  });

  it('--db-only: calls dumpDatabase and commitAllVaultChanges, NOT tagBackup', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
    await runBackupCommand('./test.yaml', true);
    mockExit.mockRestore();

    expect(mocks.mockDumpDatabase).toHaveBeenCalled();
    expect(mocks.mockCommitAllVaultChanges).toHaveBeenCalled();
    expect(mocks.mockTagBackup).not.toHaveBeenCalled();
  });

  it('full backup tagName matches fqc-backup-<compact ISO> format', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
    await runBackupCommand('./test.yaml', false);
    mockExit.mockRestore();

    expect(mocks.mockTagBackup).toHaveBeenCalledWith(
      expect.stringMatching(/^fqc-backup-\d{8}T\d{6}Z$/)
    );
  });

  it('skips git operations and exits 0 when isGitReady is false (BCK-03)', async () => {
    mocks.setIsGitReady(false);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runBackupCommand('./test.yaml', false);

    expect(mocks.mockDumpDatabase).toHaveBeenCalled();
    expect(mocks.mockCommitAllVaultChanges).not.toHaveBeenCalled();
    expect(mocks.mockTagBackup).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
  });

  it('exits 1 when dumpDatabase throws (BCK-01)', async () => {
    mocks.mockDumpDatabase.mockRejectedValue(new Error('connection refused'));
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runBackupCommand('./test.yaml', false);

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it('exits 1 when loadConfig throws (BCK-01)', async () => {
    mocks.mockLoadConfig.mockImplementation(() => { throw new Error('Config error: missing field'); });
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runBackupCommand('./test.yaml', false);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mocks.mockDumpDatabase).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });

  it('exits 0 even when git commit fails (non-fatal for db-only)', async () => {
    mocks.mockCommitAllVaultChanges.mockRejectedValue(new Error('nothing to commit'));
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runBackupCommand('./test.yaml', true);

    expect(mocks.mockDumpDatabase).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
  });
});

describe('runScanCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLoadConfig.mockReturnValue({
      instance: { name: 'test', id: 'test-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
      git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
      supabase: { databaseUrl: 'postgresql://localhost/test', url: 'http://localhost', serviceRoleKey: 'key', skipDdl: false },
      embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
      logging: { level: 'info', output: 'stdout' },
      mcp: { transport: 'stdio' },
    });
  });

  it('exits 0 after successful scan', async () => {
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runScanCommand('/path/to/config.yaml');

    expect(exitMock).toHaveBeenCalledWith(0);
    exitMock.mockRestore();
  });

  it('exits 1 when config cannot be loaded', async () => {
    mocks.mockLoadConfig.mockImplementationOnce(() => { throw new Error('bad config'); });
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    await runScanCommand('/bad/path.yaml');

    expect(exitMock).toHaveBeenCalledWith(1);
    exitMock.mockRestore();
  });
});
