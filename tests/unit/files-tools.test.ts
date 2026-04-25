/**
 * Unit tests for create_directory and list_vault MCP tools (Phase 92 + 93)
 *
 * Covers:
 * - F-52 (DIR-09): shutdown check
 * - DIR-10: no lock / no DB (source inspection — create_directory only)
 * - Array-level guards: empty array, too many paths
 * - String wrapping: single string input reaches the per-path loop
 * - Partial success semantics (D-04): some pass + some fail → isError:false
 * - All-fail: isError:true
 * - Idempotency (D-05): already-existing dir is not an error
 * - File conflict (T-92-04): pre-walk stat detects file-at-path
 *
 * list_vault tests (Phase 93):
 * - U-34 through U-43, U-54 through U-58, U-66 through U-69
 *
 * Handler is exercised via the registerFileTools factory, following the same
 * pattern as tests/unit/remove-directory.test.ts.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { mkdir, stat, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
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
 * Invoke create_directory by capturing handlers[0] registered via registerFileTools.
 * create_directory is the FIRST registerTool call (handlers[0]).
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

  const handlers: Array<(args: Record<string, unknown>) => Promise<ToolResult>> = [];

  const mockServer = {
    registerTool: vi.fn(
      (
        _name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<ToolResult>
      ) => {
        handlers.push(handler);
      }
    ),
  } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;

  registerFileTools(mockServer, makeConfig());

  // create_directory is registered first (handlers[0])
  const createDirHandler = handlers[0];
  if (!createDirHandler) {
    throw new Error('registerFileTools did not call server.registerTool');
  }

  const args: Record<string, unknown> = { paths };
  if (root_path !== undefined) args['root_path'] = root_path;

  return createDirHandler(args);
}

/**
 * Invoke list_vault by capturing handlers[1] registered via registerFileTools.
 * create_directory is registered first (handlers[0]); list_vault is second (handlers[1]).
 */
async function callListVault(params: {
  path?: string;
  show?: 'files' | 'directories' | 'all';
  format?: 'table' | 'detailed';
  recursive?: boolean;
  extensions?: string[];
  after?: string;
  before?: string;
  date_field?: 'updated' | 'created';
  limit?: number;
}): Promise<ToolResult> {
  const { registerFileTools } = await import('../../src/mcp/tools/files.js');
  const handlers: Array<(args: Record<string, unknown>) => Promise<ToolResult>> = [];
  const mockServer = {
    registerTool: vi.fn(
      (_name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<ToolResult>) => {
        handlers.push(handler);
      }
    ),
  } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  registerFileTools(mockServer, makeConfig());
  // create_directory is registered first (handlers[0]); list_vault is second (handlers[1])
  const listVaultHandler = handlers[1];
  if (!listVaultHandler) throw new Error('list_vault handler not registered (expected handlers[1])');
  return listVaultHandler(params as Record<string, unknown>);
}

/**
 * Create a Dirent-like mock object for readdir results.
 */
function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
  } as unknown as Awaited<ReturnType<typeof readdir>>[number];
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

  // ── Test 2 (DIR-10): no lock / no DB in create_directory handler ─────────────
  // Note: list_vault (registered after create_directory) DOES use supabase.
  // This test verifies that the create_directory handler itself does NOT reference
  // acquireLock, supabaseManager, or embeddingProvider within its own handler body.
  // We check by extracting the create_directory section only (before 'list_vault').

  it('DIR-10: create_directory handler source does not reference acquireLock or embeddingProvider', () => {
    const source = readFileSync('src/mcp/tools/files.ts', 'utf8');
    // Extract only the create_directory handler body (between its tool comment and list_vault section).
    // acquireLock is imported at module level for remove_directory (Phase 94), so we must start
    // extraction from the handler comment rather than the file start.
    const createDirStart = source.indexOf('// ─── Tool: create_directory');
    const createDirEnd = source.indexOf('// ─── Tool: list_vault');
    const createDirSource = (createDirStart > 0 && createDirEnd > createDirStart)
      ? source.slice(createDirStart, createDirEnd)
      : source;
    expect(createDirSource).not.toMatch(/acquireLock|embeddingProvider/i);
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

// ─── list_vault handler tests ─────────────────────────────────────────────────

describe('list_vault handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset getIsShuttingDown to false
    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(false);

    // Restore validateVaultPath to default approving implementation
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

    // Default: readdir returns empty array
    vi.mocked(readdir).mockResolvedValue([]);

    // Default: stat returns a directory (target path exists as directory by default)
    vi.mocked(stat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
      mtime: new Date('2026-01-01'),
      birthtime: new Date('2026-01-01'),
    } as unknown as Awaited<ReturnType<typeof stat>>);

    // Reset supabaseManager mock to return empty data (all files untracked)
    const { supabaseManager } = await import('../../src/storage/supabase.js');
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
  });

  // ── U-34: shutdown check ──────────────────────────────────────────────────────

  it('U-34: returns isError:true with shutdown message when server is shutting down', async () => {
    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(true);

    const result = await callListVault({ path: '/' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Server is shutting down; new requests cannot be processed.');
  });

  // ── U-35: non-existent path ───────────────────────────────────────────────────

  it('U-35: returns isError:true when target path does not exist (ENOENT)', async () => {
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await callListVault({ path: 'nonexistent/dir' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  // ── U-36: invalid after date ──────────────────────────────────────────────────

  it('U-36: returns isError:true with date format error for invalid after date string', async () => {
    const result = await callListVault({ after: 'not-a-date' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid date format: "not-a-date"');
    expect(result.content[0].text).toContain('YYYY-MM-DD');
  });

  // ── U-37: invalid before date ─────────────────────────────────────────────────

  it('U-37: returns isError:true with date format error for invalid before date string', async () => {
    const result = await callListVault({ before: 'bad' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid date format: "bad"');
  });

  // ── U-38: show='files' filters out directories ────────────────────────────────

  it('U-38: show="files" returns only files, not directories', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('subdir', true),
      makeDirent('notes.md', false),
      makeDirent('readme.txt', false),
    ]);
    // stat for each entry + child count for directory
    vi.mocked(stat).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
      mtime: new Date('2026-01-02'),
      birthtime: new Date('2026-01-01'),
    } as unknown as Awaited<ReturnType<typeof stat>>);
    // First stat call is for the target path — make it return a dir
    vi.mocked(stat).mockResolvedValueOnce({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
      mtime: new Date('2026-01-01'),
      birthtime: new Date('2026-01-01'),
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'files' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('notes.md');
    expect(result.content[0].text).toContain('readme.txt');
    expect(result.content[0].text).not.toContain('subdir/');
  });

  // ── U-39: show='directories' filters out files ────────────────────────────────

  it('U-39: show="directories" returns only directories, not files', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('subdir', true),
      makeDirent('notes.md', false),
    ]);
    // First stat call is for target path (directory), subsequent calls for entries
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'directories' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('subdir');
    expect(result.content[0].text).not.toContain('notes.md');
  });

  // ── U-40: show='all' returns both, directories appear first ──────────────────

  it('U-40: show="all" returns both files and directories; directories appear before files in output', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('notes.md', false),
      makeDirent('subdir', true),
    ]);
    // stat: target path (dir), then subdir (dir stat), then notes.md (file stat)
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'all' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    const subdirPos = text.indexOf('subdir');
    const notesPos = text.indexOf('notes.md');
    expect(subdirPos).toBeGreaterThanOrEqual(0);
    expect(notesPos).toBeGreaterThanOrEqual(0);
    expect(subdirPos).toBeLessThan(notesPos); // directories before files
  });

  // ── U-41: format='table' includes table header ────────────────────────────────

  it('U-41: format="table" response text contains table header "| Name | Type | Size | Created | Updated |"', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('notes.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 500,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', format: 'table' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('| Name | Type | Size | Created | Updated |');
  });

  // ── U-42: format='detailed' does NOT include table header ────────────────────

  it('U-42: format="detailed" response text does NOT contain table header "| Name |"', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('notes.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 500,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', format: 'detailed' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain('| Name |');
  });

  // ── U-43: path='/' (vault root) succeeds, no isError ─────────────────────────

  it('U-43: path="/" (vault root) returns successful listing, result.isError is falsy', async () => {
    // stat mock already set to return isDirectory()=true by default in beforeEach
    const result = await callListVault({ path: '/' });

    expect(result.isError).toBeFalsy();
  });

  // ── U-54: directory entry size column reads 'N items' ────────────────────────

  it('U-54: directory entry in table format shows "N items" in size column matching readdir child count', async () => {
    // Target path has one subdirectory
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDirent('projects', true)]) // target path contents
      .mockResolvedValueOnce([                               // children of 'projects'
        makeDirent('crm', true),
        makeDirent('blog', true),
        makeDirent('notes.md', false),
      ]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'directories', format: 'table' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('3 items');
  });

  // ── U-55: file entry size column reads formatted file size ────────────────────

  it('U-55: file entry in table format shows formatted file size from stat().size', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('report.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 2340,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'files', format: 'table' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('2.3 KB');
  });

  // ── U-56: children count for directory matches readdir() call on that directory path ─

  it('U-56: children count for directory matches readdir() call count on that directory path', async () => {
    const childDirents = [makeDirent('a', false), makeDirent('b', false)];
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDirent('mydir', true)]) // target path contents
      .mockResolvedValueOnce(childDirents);               // children of 'mydir'
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'directories', format: 'table' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('2 items');
  });

  // ── U-57: untracked file in results → trailing note contains 'untracked file(s) included' ──

  it('U-57: untracked file in results → trailing note contains "untracked file(s) included"', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('untracked.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    // supabaseManager returns empty data — no tracked files
    const result = await callListVault({ path: '/', show: 'files' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('untracked file(s) included');
  });

  // ── U-58: all files tracked → no untracked note ───────────────────────────────

  it('U-58: all files tracked → trailing note about untracked files is absent', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('tracked.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 200,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    // supabaseManager returns the file as tracked
    const { supabaseManager } = await import('../../src/storage/supabase.js');
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: 'uuid-1', path: 'tracked.md', title: 'Tracked', status: 'active', tags: [], updated_at: '2026-01-02T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const result = await callListVault({ path: '/', show: 'files' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain('untracked file(s) included');
  });

  // ── U-66: directories sort depth-first then alpha ─────────────────────────────

  it('U-66: directories sort depth-first then alpha (shallow dirs before deep; alpha within same depth)', async () => {
    // Two dirs at same depth, unsorted (beta before alpha)
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        makeDirent('beta', true),
        makeDirent('alpha', true),
      ])
      .mockResolvedValue([]); // children count readdir calls
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'directories', format: 'table' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('beta'));
  });

  // ── U-67: files sort by date_field descending ─────────────────────────────────

  it('U-67: files sort by date_field descending (newest first)', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('older.md', false),
      makeDirent('newer.md', false),
    ]);
    // stat: target dir first, then entries
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      // older.md stat
      .mockResolvedValueOnce({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-01-01'), // older
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      // newer.md stat
      .mockResolvedValueOnce({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-04-01'), // newer
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'files', date_field: 'updated' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text.indexOf('newer.md')).toBeLessThan(text.indexOf('older.md'));
  });

  // ── U-68: with show='all', directories precede files in output ────────────────

  it('U-68: show="all" — directories precede files in the output', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('zfile.md', false),
      makeDirent('adir', true),
    ]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'all', format: 'table' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    const adirPos = text.indexOf('adir');
    const zfilePos = text.indexOf('zfile.md');
    expect(adirPos).toBeGreaterThanOrEqual(0);
    expect(zfilePos).toBeGreaterThanOrEqual(0);
    expect(adirPos).toBeLessThan(zfilePos);
  });

  // ── U-69: limit=2 with 5 entries → response text contains 'truncated' ─────────

  it('U-69: limit=2 with 5 entries → response text contains "truncated"', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('a.md', false),
      makeDirent('b.md', false),
      makeDirent('c.md', false),
      makeDirent('d.md', false),
      makeDirent('e.md', false),
    ]);
    vi.mocked(stat)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date('2026-01-02'),
        birthtime: new Date('2026-01-01'),
      } as unknown as Awaited<ReturnType<typeof stat>>);

    const result = await callListVault({ path: '/', show: 'files', limit: 2 });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('truncated');
  });
});
