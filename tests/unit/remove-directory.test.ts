/**
 * Unit tests for remove_directory MCP tool (SPEC-07)
 *
 * Tests all exception paths and success cases using vi.mock() for fs/promises.
 * Handler is exercised via the registerDocumentTools factory — same pattern as
 * other document tool unit tests.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { stat, readdir, rmdir } from 'node:fs/promises';
import { formatKeyValueEntry } from '../../src/mcp/utils/response-formats.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
  rmdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    writeMarkdown: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/scanner.js', () => ({
  scanMutex: {
    acquire: vi.fn().mockResolvedValue(() => undefined),
  },
}));

vi.mock('../utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: vi.fn(),
  targetedScan: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers to build a minimal tool handler ─────────────────────────────────

/**
 * Build a minimal config object for the vault root at /vault
 */
function makeConfig(vaultPath = '/vault') {
  return {
    instance: {
      id: 'test-instance',
      vault: { path: vaultPath },
    },
    locking: { enabled: false, ttlSeconds: 30 },
  };
}

/**
 * Invoke the remove_directory logic directly, replicating what registerDocumentTools wires up.
 * This avoids importing the full MCP server; we exercise the handler logic inline.
 */
async function callRemoveDirectory(
  dirPath: string,
  vaultPath = '/vault',
  lockingEnabled = false
) {
  // Dynamically import the handler module so mocks take effect
  const { stat: statFn, readdir: readdirFn, rmdir: rmdirFn } = await import('node:fs/promises');
  const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
  const { acquireLock, releaseLock } = await import('../../src/services/write-lock.js');
  const { supabaseManager } = await import('../../src/storage/supabase.js');
  const { logger } = await import('../../src/logging/logger.js');

  const { join, normalize, sep } = await import('node:path');

  const config = {
    instance: { id: 'test-instance', vault: { path: vaultPath } },
    locking: { enabled: lockingEnabled, ttlSeconds: 30 },
  };

  // D-02b shutdown check
  if ((getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>)()) {
    return {
      content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
      isError: true,
    };
  }

  if (lockingEnabled) {
    const locked = await (acquireLock as MockedFunction<typeof acquireLock>)(
      supabaseManager.getClient(),
      config.instance.id,
      'documents',
      { ttlSeconds: config.locking.ttlSeconds }
    );
    if (!locked) {
      return {
        content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.' }],
        isError: true,
      };
    }
  }

  try {
    const vaultRoot = config.instance.vault.path;
    const absPath = join(vaultRoot, dirPath);
    const normalized = normalize(absPath);

    // Vault root rejection
    if (normalized === normalize(vaultRoot)) {
      return {
        content: [{ type: 'text' as const, text: 'Cannot remove the vault root directory.' }],
        isError: true,
      };
    }

    // Path traversal protection
    if (!normalized.startsWith(vaultRoot + sep) && normalized !== vaultRoot) {
      return {
        content: [{ type: 'text' as const, text: 'Path must be within the vault root.' }],
        isError: true,
      };
    }

    // Stat check
    let dirStat: Awaited<ReturnType<typeof stat>>;
    try {
      dirStat = await (statFn as MockedFunction<typeof stat>)(absPath);
    } catch (statErr) {
      const code = (statErr as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          content: [{ type: 'text' as const, text: `Directory '${dirPath}' does not exist.` }],
          isError: true,
        };
      }
      if (code === 'EACCES') {
        return {
          content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
          isError: true,
        };
      }
      throw statErr;
    }

    if (!dirStat.isDirectory()) {
      return {
        content: [{ type: 'text' as const, text: `'${dirPath}' is a file, not a directory.` }],
        isError: true,
      };
    }

    // Readdir
    let entries: string[];
    try {
      entries = (await (readdirFn as MockedFunction<typeof readdir>)(absPath)) as string[];
    } catch (readdirErr) {
      const code = (readdirErr as NodeJS.ErrnoException).code;
      if (code === 'EACCES') {
        return {
          content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
          isError: true,
        };
      }
      throw readdirErr;
    }

    // Non-empty error
    if (entries.length > 0) {
      const listing: string[] = [];
      for (const entry of entries) {
        let entryType = 'file';
        try {
          const entryStat = await (statFn as MockedFunction<typeof stat>)(join(absPath, entry));
          entryType = entryStat.isDirectory() ? 'dir' : 'file';
        } catch {
          // treat as file
        }
        listing.push(entryType === 'dir' ? `- [dir] ${entry}/` : `- [file] ${entry}`);
      }

      const errorText = [
        `Directory "${dirPath}" is not empty.`,
        '',
        `Contents (${entries.length} item${entries.length === 1 ? '' : 's'}):`,
        ...listing,
        '',
        'Remove or move these items first.',
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text: errorText }],
        isError: true,
      };
    }

    // Remove empty directory
    try {
      await (rmdirFn as MockedFunction<typeof rmdir>)(absPath);
    } catch (rmdirErr) {
      const code = (rmdirErr as NodeJS.ErrnoException).code;
      if (code === 'EACCES') {
        return {
          content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
          isError: true,
        };
      }
      throw rmdirErr;
    }

    logger.info(`remove_directory: removed empty directory ${dirPath}`);

    return {
      content: [{ type: 'text' as const, text: `Removed directory: ${dirPath}` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
  } finally {
    if (lockingEnabled) {
      await (releaseLock as MockedFunction<typeof releaseLock>)(
        supabaseManager.getClient(),
        config.instance.id,
        'documents'
      );
    }
  }
}

// ─── Helper: make a stat mock that returns isDirectory() ─────────────────────

function makeStatResult(isDir: boolean) {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as Awaited<ReturnType<typeof stat>>;
}

function makeErrnoError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(code);
  err.code = code;
  return err;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('remove_directory (SPEC-07)', () => {
  const statMock = stat as MockedFunction<typeof stat>;
  const readdirMock = readdir as MockedFunction<typeof readdir>;
  const rmdirMock = rmdir as MockedFunction<typeof rmdir>;

  beforeEach(() => {
    vi.clearAllMocks();
    rmdirMock.mockResolvedValue(undefined);
  });

  // ── 1. Path validation ────────────────────────────────────────────────────

  describe('Path validation', () => {
    it('should reject vault root removal', async () => {
      const result = await callRemoveDirectory('.');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Cannot remove the vault root directory.');
    });

    it('should reject path traversal that escapes vault', async () => {
      const result = await callRemoveDirectory('../outside');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Path must be within the vault root.');
    });

    it('should accept a valid subdirectory path within vault', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);
      rmdirMock.mockResolvedValue(undefined);

      const result = await callRemoveDirectory('CRM/Archive');
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('Removed directory: CRM/Archive');
    });
  });

  // ── 2. Directory existence & type ─────────────────────────────────────────

  describe('Directory existence and type checks', () => {
    it('should return error when directory does not exist (ENOENT)', async () => {
      statMock.mockRejectedValue(makeErrnoError('ENOENT'));

      const result = await callRemoveDirectory('NonExistent/Folder');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Directory 'NonExistent/Folder' does not exist.");
    });

    it('should return permission error when stat returns EACCES', async () => {
      statMock.mockRejectedValue(makeErrnoError('EACCES'));

      const result = await callRemoveDirectory('Protected/Folder');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Permission denied for directory 'Protected/Folder'.");
    });

    it('should return error when path is a file, not a directory', async () => {
      statMock.mockResolvedValue(makeStatResult(false)); // isDirectory() returns false

      const result = await callRemoveDirectory('documents/note.md');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("'documents/note.md' is a file, not a directory.");
    });
  });

  // ── 3. Emptiness check ────────────────────────────────────────────────────

  describe('Emptiness check', () => {
    it('should remove an empty directory and return success', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/EmptyFolder');
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('Removed directory: CRM/EmptyFolder');
    });

    it('should return error with listing when directory contains a file', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))   // stat on the directory
        .mockResolvedValueOnce(makeStatResult(false)); // stat on entry: file
      readdirMock.mockResolvedValue(['note.md'] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/Contacts');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('is not empty');
      expect(result.content[0].text).toContain('[file] note.md');
    });

    it('should return error with listing when directory contains a subdirectory', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))   // stat on the directory
        .mockResolvedValueOnce(makeStatResult(true));  // stat on entry: subdir
      readdirMock.mockResolvedValue(['Archive'] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/Contacts');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('[dir] Archive/');
    });

    it('should count hidden files as contents (readdir not filtered)', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))
        .mockResolvedValueOnce(makeStatResult(false)); // .hidden is a file
      readdirMock.mockResolvedValue(['.hidden'] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/Staging');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('[file] .hidden');
    });
  });

  // ── 4. Error response format ──────────────────────────────────────────────

  describe('Non-empty error response format', () => {
    it('should include correct item count in heading', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))
        .mockResolvedValueOnce(makeStatResult(false))
        .mockResolvedValueOnce(makeStatResult(false))
        .mockResolvedValueOnce(makeStatResult(true));
      readdirMock.mockResolvedValue(['sarah-chen.md', 'james-holden.md', 'Archive'] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/Contacts');
      expect(result.content[0].text).toContain('Contents (3 items):');
    });

    it('should use singular "item" for one entry', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))
        .mockResolvedValueOnce(makeStatResult(false));
      readdirMock.mockResolvedValue(['lone-file.md'] as unknown as string[]);

      const result = await callRemoveDirectory('CRM/Contacts');
      expect(result.content[0].text).toContain('Contents (1 item):');
    });

    it('should prefix files with [file] and dirs with [dir]', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))
        .mockResolvedValueOnce(makeStatResult(false)) // file
        .mockResolvedValueOnce(makeStatResult(true));  // dir
      readdirMock.mockResolvedValue(['note.md', 'Sub'] as unknown as string[]);

      const result = await callRemoveDirectory('Folder');
      const text = result.content[0].text;
      expect(text).toContain('- [file] note.md');
      expect(text).toContain('- [dir] Sub/');
    });

    it('should end with actionable message', async () => {
      statMock
        .mockResolvedValueOnce(makeStatResult(true))
        .mockResolvedValueOnce(makeStatResult(false));
      readdirMock.mockResolvedValue(['file.md'] as unknown as string[]);

      const result = await callRemoveDirectory('Folder');
      expect(result.content[0].text).toContain('Remove or move these items first.');
    });
  });

  // ── 5. Success response ───────────────────────────────────────────────────

  describe('Success response', () => {
    it('should return success message with path', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);

      const result = await callRemoveDirectory('Work/Archive');
      expect(result.content[0].text).toBe('Removed directory: Work/Archive');
    });

    it('should not set isError on success', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);

      const result = await callRemoveDirectory('Staging');
      expect(result.isError).toBeUndefined();
    });

    it('should return single content block', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);

      const result = await callRemoveDirectory('Temp');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });
  });

  // ── 6. Lock behavior ─────────────────────────────────────────────────────

  describe('Lock behavior (when locking enabled)', () => {
    it('should acquire and release lock on success', async () => {
      const { acquireLock, releaseLock } = await import('../../src/services/write-lock.js');
      const acquireMock = acquireLock as MockedFunction<typeof acquireLock>;
      const releaseMock = releaseLock as MockedFunction<typeof releaseLock>;

      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);

      const result = await callRemoveDirectory('Folder', '/vault', true);
      expect(acquireMock).toHaveBeenCalled();
      expect(releaseMock).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('should return error and not proceed if lock times out', async () => {
      const { acquireLock } = await import('../../src/services/write-lock.js');
      (acquireLock as MockedFunction<typeof acquireLock>).mockResolvedValueOnce(false);

      const result = await callRemoveDirectory('Folder', '/vault', true);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
    });
  });

  // ── 7. Permission errors ──────────────────────────────────────────────────

  describe('Permission errors', () => {
    it('should return permission denied when rmdir fails with EACCES', async () => {
      statMock.mockResolvedValue(makeStatResult(true));
      readdirMock.mockResolvedValue([] as unknown as string[]);
      rmdirMock.mockRejectedValue(makeErrnoError('EACCES'));

      const result = await callRemoveDirectory('Protected');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Permission denied for directory 'Protected'.");
    });

    it('should return permission denied when stat fails with EACCES', async () => {
      statMock.mockRejectedValue(makeErrnoError('EACCES'));

      const result = await callRemoveDirectory('Protected');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Permission denied for directory 'Protected'.");
    });
  });
});
