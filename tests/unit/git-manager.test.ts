import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock factories — vi.mock is hoisted before variable declarations,
// so mocked functions must be defined via vi.hoisted() to avoid TDZ errors.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockGitVersion = vi.fn();
  const mockGitAdd = vi.fn();
  const mockGitCommit = vi.fn();
  const mockGitPush = vi.fn();
  const mockAddAnnotatedTag = vi.fn();
  const mockGitInstance = {
    version: mockGitVersion,
    add: mockGitAdd,
    commit: mockGitCommit,
    push: mockGitPush,
    addAnnotatedTag: mockAddAnnotatedTag,
  };

  const mockExistsSync = vi.fn();
  const mockMkdir = vi.fn();
  const mockWriteFile = vi.fn();

  // pg.Client mock — connect/query/end can be overridden per-test
  const mockPgConnect = vi.fn().mockResolvedValue(undefined);
  const mockPgQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockPgEnd = vi.fn().mockResolvedValue(undefined);
  const MockPgClient = vi.fn().mockImplementation(function () {
    return { connect: mockPgConnect, query: mockPgQuery, end: mockPgEnd };
  });

  return {
    mockGitVersion,
    mockGitAdd,
    mockGitCommit,
    mockGitPush,
    mockAddAnnotatedTag,
    mockGitInstance,
    mockExistsSync,
    mockMkdir,
    mockWriteFile,
    MockPgClient,
    mockPgConnect,
    mockPgQuery,
    mockPgEnd,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mocks.mockGitInstance),
}));

// Also mock the ESM entry resolved from src/node_modules (used by production ts files via vitest transform)
vi.mock('/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-core/src/node_modules/simple-git/dist/esm/index.js', () => ({
  simpleGit: vi.fn(() => mocks.mockGitInstance),
  default: { simpleGit: vi.fn(() => mocks.mockGitInstance) },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: mocks.mockExistsSync,
  };
});

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mockMkdir,
  writeFile: mocks.mockWriteFile,
}));

vi.mock('pg', () => ({
  default: {
    Client: mocks.MockPgClient,
    escapeIdentifier: (s: string) => `"${s}"`,
  },
}));

// Mock pg-client utility so dumpDatabase uses MockPgClient regardless of pg module resolution
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: mocks.mockPgConnect,
    query: mocks.mockPgQuery,
    end: mocks.mockPgEnd,
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import subject under test (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { GitManagerImpl } from '../../src/git/manager.js';
import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function testConfig(overrides?: Partial<FlashQueryConfig['git']>): FlashQueryConfig {
  return {
    instance: { name: 'test', id: 'test-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'key',
      databaseUrl: 'postgresql://localhost/test',
      skipDdl: false,
    },
    git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main', ...overrides },
    mcp: { transport: 'stdio' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as FlashQueryConfig;
}

// Temp vault directory — created per test so simpleGit() doesn't reject a missing path
let tempVaultDir = '';

function makeManager(gitConfig?: Partial<FlashQueryConfig['git']>): GitManagerImpl {
  const config = testConfig(gitConfig);
  // Use the real temp dir so simple-git constructor doesn't throw
  return new GitManagerImpl(tempVaultDir || config.instance.vault.path, config.git, {
    databaseUrl: config.supabase.databaseUrl,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GitManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create a real temp directory so simpleGit(vaultPath) constructor succeeds
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-manager-test-'));
    // Default: git binary available, .git exists
    mocks.mockGitVersion.mockResolvedValue({ major: 2, minor: 50, patch: 1 });
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockGitAdd.mockResolvedValue(undefined);
    mocks.mockGitCommit.mockResolvedValue({ commit: 'abc1234' });
    mocks.mockGitPush.mockResolvedValue(undefined);
    mocks.mockAddAnnotatedTag.mockResolvedValue(undefined);
    mocks.mockMkdir.mockResolvedValue(undefined);
    mocks.mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Remove temp vault directory
    if (tempVaultDir) {
      fs.rmSync(tempVaultDir, { recursive: true, force: true });
      tempVaultDir = '';
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('initialize', () => {
    it('logs WARN when git binary is missing', async () => {
      mocks.mockGitVersion.mockRejectedValue(new Error('git not found'));

      const manager = makeManager();
      await manager.initialize(testConfig());

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('git binary not found')
      );
    });

    it('logs WARN when .git directory does not exist', async () => {
      mocks.mockExistsSync.mockReturnValue(false);

      const manager = makeManager();
      await manager.initialize(testConfig());

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not a git repository')
      );
    });

    it('logs info and succeeds when both git binary and .git exist', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Git: initialized')
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('commitVaultChanges', () => {
    it('calls git.add(relativePath) then git.commit() with message format vault: {action} document {title} (D-04)', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      await manager.commitVaultChanges('create', 'My Doc', 'docs/my-doc.md');

      expect(mocks.mockGitAdd).toHaveBeenCalledWith('docs/my-doc.md');
      expect(mocks.mockGitCommit).toHaveBeenCalledWith("vault: create document 'My Doc'");
    });

    it('skips commit and logs WARN when gitAvailable is false (runtime re-check D-02)', async () => {
      // git binary missing at initialize
      mocks.mockGitVersion.mockRejectedValue(new Error('git not found'));
      const manager = makeManager();
      await manager.initialize(testConfig());

      vi.clearAllMocks();
      // existsSync returns false to confirm skip path
      mocks.mockExistsSync.mockReturnValue(false);

      await manager.commitVaultChanges('update', 'My Doc', 'docs/my-doc.md');

      expect(mocks.mockGitAdd).not.toHaveBeenCalled();
      expect(mocks.mockGitCommit).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("skipping commit for 'My Doc'")
      );
    });

    it('skips commit silently when autoCommit is false', async () => {
      const manager = makeManager({ autoCommit: false });
      await manager.initialize(testConfig({ autoCommit: false }));

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);

      await manager.commitVaultChanges('create', 'My Doc', 'docs/my-doc.md');

      expect(mocks.mockGitAdd).not.toHaveBeenCalled();
      expect(mocks.mockGitCommit).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('catches git.commit() errors and logs WARN, does not throw', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);
      mocks.mockGitAdd.mockResolvedValue(undefined);
      mocks.mockGitCommit.mockRejectedValue(new Error('nothing to commit'));

      await expect(
        manager.commitVaultChanges('create', 'My Doc', 'docs/my-doc.md')
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("commit failed for 'My Doc'")
      );
    });

    it('calls git.push() with configured remote and branch when autoPush=true (D-05)', async () => {
      const manager = makeManager({ autoPush: true, remote: 'upstream', branch: 'develop' });
      await manager.initialize(testConfig({ autoPush: true, remote: 'upstream', branch: 'develop' }));

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);
      mocks.mockGitAdd.mockResolvedValue(undefined);
      mocks.mockGitCommit.mockResolvedValue({ commit: 'abc1234' });
      mocks.mockGitPush.mockResolvedValue(undefined);

      await manager.commitVaultChanges('create', 'My Doc', 'docs/my-doc.md');

      // Allow event loop to process the fire-and-forget push
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mocks.mockGitPush).toHaveBeenCalledWith('upstream', 'develop');
    });

    it('logs WARN on push failure and does not throw (D-05)', async () => {
      const manager = makeManager({ autoPush: true });
      await manager.initialize(testConfig({ autoPush: true }));

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);
      mocks.mockGitAdd.mockResolvedValue(undefined);
      mocks.mockGitCommit.mockResolvedValue({ commit: 'abc1234' });
      mocks.mockGitPush.mockRejectedValue(new Error('remote unreachable'));

      await manager.commitVaultChanges('create', 'My Doc', 'docs/my-doc.md');

      // Allow event loop to process the fire-and-forget push rejection
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('push failed')
      );
    });

    it('serializes concurrent calls via mutex (D-03)', async () => {
      const callOrder: string[] = [];
      let resolveFirstAdd!: () => void;

      const manager = makeManager();
      await manager.initialize(testConfig());

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);

      let addCallCount = 0;
      mocks.mockGitAdd.mockImplementation(() => {
        addCallCount++;
        if (addCallCount === 1) {
          callOrder.push('add-1-start');
          return new Promise<void>((resolve) => {
            resolveFirstAdd = () => {
              callOrder.push('add-1-end');
              resolve();
            };
          });
        } else {
          callOrder.push('add-2-start');
          callOrder.push('add-2-end');
          return Promise.resolve();
        }
      });
      mocks.mockGitCommit.mockResolvedValue({ commit: 'abc' });

      // Start both commits concurrently
      const p1 = manager.commitVaultChanges('create', 'Doc 1', 'doc1.md');
      const p2 = manager.commitVaultChanges('create', 'Doc 2', 'doc2.md');

      // Give p1 time to acquire lock and start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Complete the first add
      resolveFirstAdd();

      await Promise.all([p1, p2]);

      // Second commit must not start before first commit's add completes
      expect(callOrder.indexOf('add-2-start')).toBeGreaterThan(
        callOrder.indexOf('add-1-end')
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('dumpDatabase', () => {
    it('queries fqc_* and fqcp_* tables and writes .fqc/backup.json', async () => {
      mocks.mockPgQuery
        .mockResolvedValueOnce({ rows: [{ tablename: 'fqc_memory' }, { tablename: 'fqcp_contacts' }] })
        .mockResolvedValue({ rows: [{ id: '1', content: 'test' }] });

      const manager = makeManager();
      await manager.initialize(testConfig());

      const result = await manager.dumpDatabase();

      expect(result).toBe('.fqc/backup.json');
      expect(mocks.mockPgConnect).toHaveBeenCalled();
      expect(mocks.mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('backup.json'),
        expect.stringContaining('"exported_at"'),
        'utf-8'
      );
      expect(mocks.mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"fqc_memory"'),
        'utf-8'
      );
    });

    it('calls pgClient.end() even when query throws', async () => {
      mocks.mockPgConnect.mockResolvedValue(undefined);
      mocks.mockPgQuery.mockRejectedValueOnce(new Error('query failed'));

      const manager = makeManager();
      await manager.initialize(testConfig());

      await expect(manager.dumpDatabase()).rejects.toThrow('query failed');
      expect(mocks.mockPgEnd).toHaveBeenCalled();
    });

    it('throws on pg connection failure (caller handles exit code)', async () => {
      mocks.mockPgConnect.mockRejectedValueOnce(new Error('connection refused'));

      const manager = makeManager();
      await manager.initialize(testConfig());

      await expect(manager.dumpDatabase()).rejects.toThrow('connection refused');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('commitAllVaultChanges', () => {
    it('runs git add -A then commit with provided message', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);
      mocks.mockGitAdd.mockResolvedValue(undefined);
      mocks.mockGitCommit.mockResolvedValue({ commit: 'abc1234' });

      await manager.commitAllVaultChanges('chore: full vault backup 2026-03-26T02:00:00.000Z');

      expect(mocks.mockGitAdd).toHaveBeenCalledWith('-A');
      expect(mocks.mockGitCommit).toHaveBeenCalledWith(
        'chore: full vault backup 2026-03-26T02:00:00.000Z'
      );
    });

    it('throws when git commit fails (caller handles warning)', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      vi.clearAllMocks();
      mocks.mockExistsSync.mockReturnValue(true);
      mocks.mockGitAdd.mockResolvedValue(undefined);
      mocks.mockGitCommit.mockRejectedValue(new Error('nothing to commit'));

      await expect(
        manager.commitAllVaultChanges('chore: test')
      ).rejects.toThrow('nothing to commit');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('tagBackup', () => {
    it('calls git.addAnnotatedTag with tagName and message containing timestamp', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());

      await manager.tagBackup('fqc-backup-20260326T020000Z');

      expect(mocks.mockAddAnnotatedTag).toHaveBeenCalledWith(
        'fqc-backup-20260326T020000Z',
        expect.stringContaining('FQ coherent backup')
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('isGitReady', () => {
    it('returns false when git binary is unavailable', async () => {
      mocks.mockGitVersion.mockRejectedValue(new Error('git not found'));
      const manager = makeManager();
      await manager.initialize(testConfig());
      expect(manager.isGitReady).toBe(false);
    });

    it('returns false when vault is not a git repo', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      const manager = makeManager();
      await manager.initialize(testConfig());
      expect(manager.isGitReady).toBe(false);
    });

    it('returns true when git binary available and vault is a repo', async () => {
      const manager = makeManager();
      await manager.initialize(testConfig());
      expect(manager.isGitReady).toBe(true);
    });
  });
});
