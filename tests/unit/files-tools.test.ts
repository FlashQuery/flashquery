/**
 * Unit tests for the list_vault MCP tool (Phase 93).
 *
 * Covers U-34 through U-43, U-54 through U-58, U-66 through U-69.
 *
 * Handler is exercised via the registerFileTools factory. (The legacy
 * create_directory unit tests were removed when that tool was merged into
 * manage_directory in Phase 127; manage_directory coverage now lives in
 * tests/unit/manage-directory.test.ts and tests/integration/manage-directory.integration.test.ts.)
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { stat, readdir } from 'node:fs/promises';
import { FM } from '../../src/constants/frontmatter-fields.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
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
// while normalizePath (and other helpers) are passed through from the real
// implementation so response formatting works correctly.
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
 * Invoke list_vault by capturing the handler registered under that name by registerFileTools.
 */
async function callListVault(params: {
  path?: string;
  show?: 'files' | 'directories' | 'all';
  include?: Array<'metadata' | 'tracking'>;
  recursive?: boolean;
  extensions?: string[];
  after?: string;
  before?: string;
  date_field?: 'updated' | 'created';
  limit?: number;
}): Promise<ToolResult> {
  const { registerFileTools } = await import('../../src/mcp/tools/files.js');
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>();
  const mockServer = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<ToolResult>) => {
        handlers.set(name, handler);
      }
    ),
  } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  registerFileTools(mockServer, makeConfig());
  const listVaultHandler = handlers.get('list_vault');
  if (!listVaultHandler) throw new Error('list_vault handler not registered');
  return listVaultHandler(params as Record<string, unknown>);
}

function parseListVault(result: ToolResult) {
  return JSON.parse(result.content[0].text) as {
    path: string;
    total: number;
    displayed: number;
    truncated: boolean;
    entries: Array<Record<string, unknown>>;
  };
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

  it('U-35: returns expected not_found JSON when target path does not exist (ENOENT)', async () => {
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await callListVault({ path: 'nonexistent/dir' });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({ error: 'not_found', identifier: 'nonexistent/dir' });
  });

  // ── U-36: invalid after date ──────────────────────────────────────────────────

  it('U-36: returns isError:true with date format error for invalid after date string', async () => {
    const result = await callListVault({ after: 'not-a-date' });

    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({ error: 'invalid_input' });
    expect(payload.message).toContain('Invalid date format: "not-a-date"');
    expect(payload.message).toContain('YYYY-MM-DD');
  });

  // ── U-37: invalid before date ─────────────────────────────────────────────────

  it('U-37: returns isError:true with date format error for invalid before date string', async () => {
    const result = await callListVault({ before: 'bad' });

    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({ error: 'invalid_input' });
    expect(payload.message).toContain('Invalid date format: "bad"');
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

  // ── U-41: default output is structured JSON ──────────────────────────────────

  it('U-41: default response text is parseable JSON with entries', async () => {
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

    const result = await callListVault({ path: '/' });
    const payload = parseListVault(result);

    expect(result.isError).toBeFalsy();
    expect(payload.entries[0]).toMatchObject({ name: 'notes.md', type: 'file', size: { chars: 500 } });
  });

  // ── U-42: legacy table header is absent ──────────────────────────────────────

  it('U-42: structured JSON response text does NOT contain table header "| Name |"', async () => {
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

    const result = await callListVault({ path: '/' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain('| Name |');
  });

  // ── U-43: path='/' (vault root) succeeds, no isError ─────────────────────────

  it('U-43: path="/" (vault root) returns successful listing, result.isError is falsy', async () => {
    // stat mock already set to return isDirectory()=true by default in beforeEach
    const result = await callListVault({ path: '/' });

    expect(result.isError).toBeFalsy();
  });

  // ── U-54: directory entry size reads entries count ───────────────────────────

  it('U-54: directory entry in JSON has size.entries matching readdir child count', async () => {
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

    const result = await callListVault({ path: '/', show: 'directories' });
    const payload = parseListVault(result);

    expect(result.isError).toBeFalsy();
    expect(payload.entries[0]).toMatchObject({ size: { entries: 3 } });
  });

  // ── U-55: file entry size reads chars ────────────────────────────────────────

  it('U-55: file entry in JSON uses size.chars from stat().size', async () => {
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

    const result = await callListVault({ path: '/', show: 'files' });
    const payload = parseListVault(result);

    expect(result.isError).toBeFalsy();
    expect(payload.entries[0]).toMatchObject({ size: { chars: 2340 } });
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

    const result = await callListVault({ path: '/', show: 'directories' });
    const payload = parseListVault(result);

    expect(result.isError).toBeFalsy();
    expect(payload.entries[0]).toMatchObject({ size: { entries: 2 } });
  });

  // ── U-57: untracked file in results omits tracking filler ───────────────────

  it('U-57: untracked file in results omits tracking fields', async () => {
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
    const payload = parseListVault(result);

    expect(result.isError).toBeFalsy();
    expect(payload.entries[0]).not.toHaveProperty('title');
    expect(payload.entries[0]).not.toHaveProperty(FM.ID);
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

    const result = await callListVault({ path: '/', show: 'directories' });

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

    const result = await callListVault({ path: '/', show: 'all' });

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
