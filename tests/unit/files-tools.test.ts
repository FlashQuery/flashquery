/**
 * Unit tests for create_directory MCP tool (Phase 92)
 *
 * Covers:
 * - F-52 (DIR-09): shutdown check
 * - DIR-10: no lock / no DB (source inspection)
 * - Array-level guards: empty array, too many paths
 * - String wrapping: single string input reaches the per-path loop
 * - Partial success semantics (D-04): some pass + some fail → isError:false
 * - All-fail: isError:true
 * - Idempotency (D-05): already-existing dir is not an error
 * - File conflict (T-92-04): pre-walk stat detects file-at-path
 *
 * Handler is exercised via the registerFileTools factory, following the same
 * pattern as tests/unit/remove-directory.test.ts.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { mkdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn().mockReturnValue(false),
}));

// Mock path-validation.ts to avoid lstat calls on non-existent paths.
// We use a partial mock: validateVaultPath is mocked to approve safe paths,
// while normalizePath / joinWithRoot / sanitizeDirectorySegment / validateSegment
// are passed through from the real implementation so response formatting works correctly.
vi.mock('../../src/mcp/utils/path-validation.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/utils/path-validation.js')>(
    '../../src/mcp/utils/path-validation.js'
  );
  return {
    ...actual,
    // validateVaultPath will be selectively overridden per-test via vi.mocked()
    validateVaultPath: vi.fn(async (_vaultRoot: string, userPath: string) => {
      // Default: approve everything that doesn't start with '..'
      if (userPath.startsWith('..')) {
        return { valid: false, absPath: '', relativePath: userPath, error: 'Path traversal detected — path must be within the vault root.' };
      }
      if (userPath === '' || userPath === '.') {
        return { valid: false, absPath: '', relativePath: userPath, error: 'Path cannot target the vault root itself.' };
      }
      return { valid: true, absPath: `/vault/${userPath}`, relativePath: userPath };
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

/**
 * Build a minimal FlashQueryConfig for the vault root at /vault
 */
function makeConfig(vaultPath = '/vault') {
  return {
    instance: {
      id: 'test-instance',
      vault: { path: vaultPath },
    },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as import('../../src/config/loader.js').FlashQueryConfig;
}

/**
 * Invoke create_directory by capturing the handler registered via registerFileTools.
 * Follows the same dynamic-import + handler-capture pattern as remove-directory.test.ts.
 */
async function callCreateDirectory({
  paths,
  root_path,
}: {
  paths: string | string[];
  root_path?: string;
}): Promise<ToolResult> {
  const { registerFileTools } = await import('../../src/mcp/tools/files.js');

  let capturedHandler: ((args: Record<string, unknown>) => Promise<ToolResult>) | null = null;

  const mockServer = {
    registerTool: vi.fn(
      (
        _name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<ToolResult>
      ) => {
        capturedHandler = handler;
      }
    ),
  } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;

  registerFileTools(mockServer, makeConfig());

  if (!capturedHandler) {
    throw new Error('registerFileTools did not call server.registerTool');
  }

  const args: Record<string, unknown> = { paths };
  if (root_path !== undefined) args['root_path'] = root_path;

  return (capturedHandler as (args: Record<string, unknown>) => Promise<ToolResult>)(args);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('create_directory handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset getIsShuttingDown to false for every test (F-52 sets it to true)
    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(false);
    // Restore validateVaultPath to the default approving implementation
    const { validateVaultPath } = await import('../../src/mcp/utils/path-validation.js');
    (validateVaultPath as MockedFunction<typeof validateVaultPath>).mockImplementation(
      async (_vaultRoot: string, userPath: string) => {
        if (userPath.startsWith('..')) {
          return { valid: false, absPath: '', relativePath: userPath, error: 'Path traversal detected — path must be within the vault root.' };
        }
        if (userPath === '' || userPath === '.') {
          return { valid: false, absPath: '', relativePath: userPath, error: 'Path cannot target the vault root itself.' };
        }
        return { valid: true, absPath: `/vault/${userPath}`, relativePath: userPath };
      }
    );
    // Default: mkdir resolves successfully
    vi.mocked(mkdir).mockResolvedValue(undefined);
    // Default: stat throws ENOENT (path doesn't exist yet → will be created)
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  // ── Test 1 (F-52): shutdown check ────────────────────────────────────────────

  it('F-52: returns error immediately when server is shutting down', async () => {
    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(true);

    const result = await callCreateDirectory({ paths: ['valid/path'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Server is shutting down; new requests cannot be processed.'
    );
  });

  // ── Test 2 (DIR-10): no lock / no DB — source inspection ─────────────────────

  it('DIR-10: handler source does not reference acquireLock, supabase, or embeddingProvider', () => {
    const source = readFileSync('src/mcp/tools/files.ts', 'utf8');
    expect(source).not.toMatch(/acquireLock|supabase|embeddingProvider/i);
  });

  // ── Test 3: empty array guard ─────────────────────────────────────────────────

  it('No paths provided: empty array returns isError:true with exact message', async () => {
    const result = await callCreateDirectory({ paths: [] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('No paths provided.');
  });

  // ── Test 4: too-many-paths guard ─────────────────────────────────────────────

  it('Too many paths: 51-element array returns isError:true with exact message', async () => {
    const result = await callCreateDirectory({ paths: Array(51).fill('a') });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Too many paths: 51 provided, maximum is 50.');
  });

  // ── Test 5: string input is wrapped in array ──────────────────────────────────

  it('String wrap: single string path reaches mkdir', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const result = await callCreateDirectory({ paths: 'CRM' });

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith(
      expect.stringContaining('CRM'),
      { recursive: true }
    );
  });

  // ── Test 6: partial success (D-04) ───────────────────────────────────────────

  it('Partial success: valid path succeeds, invalid path fails, isError:false (D-04)', async () => {
    // validateVaultPath is mocked to approve 'valid' but reject '../escape'
    // (default mock rejects anything starting with '..')
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const result = await callCreateDirectory({ paths: ['valid', '../escape'] });

    // isError must be false — at least one path succeeded
    expect(result.isError).toBeFalsy();
    // Response should contain a success entry and a Failed block
    expect(result.content[0].text).toContain('valid/');
    expect(result.content[0].text).toContain('Failed (1 path):');
    expect(result.content[0].text).toContain('../escape');
  });

  // ── Test 7: all-fail → isError:true ──────────────────────────────────────────

  it('All paths failed: isError:true with "All paths failed:" header', async () => {
    const result = await callCreateDirectory({ paths: ['../a', '../b'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('All paths failed:');
  });

  // ── Test 8: idempotency (D-05) ───────────────────────────────────────────────

  it('Idempotent (D-05): already-existing dir is reported with "(already exists)", isError:false', async () => {
    // stat returns a directory stat (preExisted=true for the single segment 'CRM')
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as unknown as Awaited<ReturnType<typeof stat>>);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    const { logger } = await import('../../src/logging/logger.js');

    const result = await callCreateDirectory({ paths: 'CRM' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('already exists');
    expect(result.content[0].text).toContain('Created 0 directories:');
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  // ── Test 9: file conflict (T-92-04) ──────────────────────────────────────────

  it('File conflict (T-92-04): file-at-path returns error with "already exists as a file at"', async () => {
    // stat returns a non-directory (isDirectory()=false) → file conflict
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callCreateDirectory({ paths: 'notes.md/subfolder' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists as a file at');
    // mkdir should NOT have been called
    expect(vi.mocked(mkdir)).not.toHaveBeenCalled();
  });
});
