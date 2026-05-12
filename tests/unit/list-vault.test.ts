import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { stat, readdir, readFile } from 'node:fs/promises';
import { FM } from '../../src/constants/frontmatter-fields.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rmdir: vi.fn(),
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

vi.mock('../../src/mcp/utils/path-validation.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/utils/path-validation.js')>(
    '../../src/mcp/utils/path-validation.js'
  );
  return {
    ...actual,
    validateVaultPath: vi.fn(async (_vaultRoot: string, userPath: string) => ({
      valid: true,
      absPath: `/vault/${userPath}`,
      relativePath: userPath,
    })),
  };
});

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type ListVaultPayload = {
  path: string;
  total: number;
  displayed: number;
  truncated: boolean;
  entries: Array<Record<string, unknown>>;
};

function makeConfig(vaultPath = '/vault') {
  return {
    instance: {
      id: 'test-instance',
      vault: { path: vaultPath },
    },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as import('../../src/config/loader.js').FlashQueryConfig;
}

async function callListVault(params: Record<string, unknown>): Promise<ToolResult> {
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
  const listVaultHandler = handlers[1];
  if (!listVaultHandler) throw new Error('list_vault handler not registered');
  return listVaultHandler(params);
}

function parsePayload(result: ToolResult): ListVaultPayload {
  return JSON.parse(result.content[0].text) as ListVaultPayload;
}

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
  } as unknown as Awaited<ReturnType<typeof readdir>>[number];
}

function dirStat(date = '2026-01-01T00:00:00.000Z') {
  return {
    isDirectory: () => true,
    isFile: () => false,
    size: 0,
    mtime: new Date(date),
    birthtime: new Date(date),
  } as unknown as Awaited<ReturnType<typeof stat>>;
}

function fileStat(size = 123, date = '2026-01-02T00:00:00.000Z') {
  return {
    isDirectory: () => false,
    isFile: () => true,
    size,
    mtime: new Date(date),
    birthtime: new Date(date),
  } as unknown as Awaited<ReturnType<typeof stat>>;
}

describe('list_vault structured JSON output', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(false);

    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(stat).mockResolvedValue(dirStat());
    vi.mocked(readFile).mockResolvedValue('file body');

    const { supabaseManager } = await import('../../src/storage/supabase.js');
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);
  });

  it('returns a parseable JSON envelope by default with markdown body chars', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('notes.md', false)]);
    vi.mocked(stat).mockResolvedValueOnce(dirStat()).mockResolvedValue(fileStat(42));
    vi.mocked(readFile).mockResolvedValue('---\nfq_title: Notes\n---\nBody');

    const result = await callListVault({ path: '/' });
    const payload = parsePayload(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      path: '/',
      total: 1,
      displayed: 1,
      truncated: false,
    });
    expect(payload.entries).toEqual([
      expect.objectContaining({
        name: 'notes.md',
        path: 'notes.md',
        type: 'file',
        modified: '2026-01-02T00:00:00.000Z',
        size: { chars: 'Body'.length },
      }),
    ]);
  });

  it('adds directory metadata fields only when requested', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDirent('Projects', true)])
      .mockResolvedValueOnce([makeDirent('plan.md', false)]);
    vi.mocked(stat).mockResolvedValueOnce(dirStat()).mockResolvedValue(dirStat('2026-01-03T00:00:00.000Z'));

    const result = await callListVault({ path: '/', include: ['metadata'] });
    const payload = parsePayload(result);

    expect(payload.entries[0]).toMatchObject({
      name: 'Projects',
      path: 'Projects',
      type: 'directory',
      size: { entries: 1 },
      children: 1,
      created: '2026-01-03T00:00:00.000Z',
    });
  });

  it('adds tracking fields only for tracked files and omits null filler for untracked files', async () => {
    vi.mocked(readdir).mockResolvedValue([
      makeDirent('tracked.md', false),
      makeDirent('untracked.md', false),
    ]);
    vi.mocked(stat)
      .mockResolvedValueOnce(dirStat())
      .mockResolvedValueOnce(fileStat(200, '2026-01-03T00:00:00.000Z'))
      .mockResolvedValueOnce(fileStat(100, '2026-01-02T00:00:00.000Z'));

    const { supabaseManager } = await import('../../src/storage/supabase.js');
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: 'doc-1',
          path: 'tracked.md',
          title: 'Tracked Note',
          status: 'active',
          tags: ['project'],
          updated_at: '2026-01-03T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
        }],
        error: null,
      }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const result = await callListVault({ path: '/', show: 'files', include: ['tracking'] });
    const payload = parsePayload(result);

    const tracked = payload.entries.find((entry) => entry.path === 'tracked.md');
    const untracked = payload.entries.find((entry) => entry.path === 'untracked.md');
    expect(tracked).toMatchObject({
      title: 'Tracked Note',
      tags: ['project'],
      status: 'active',
      [FM.ID]: 'doc-1',
    });
    expect(untracked).not.toHaveProperty('title');
    expect(untracked).not.toHaveProperty('tags');
    expect(untracked).not.toHaveProperty('status');
    expect(untracked).not.toHaveProperty(FM.ID);
  });

  it('returns a runtime error when requested tracking metadata cannot be loaded', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('tracked.md', false)]);
    vi.mocked(stat)
      .mockResolvedValueOnce(dirStat())
      .mockResolvedValueOnce(fileStat(200, '2026-01-03T00:00:00.000Z'));

    const { supabaseManager } = await import('../../src/storage/supabase.js');
    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'network unavailable' },
      }),
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const result = await callListVault({ path: '/', show: 'files', include: ['tracking'] });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      error: 'tracking_unavailable',
      message: expect.stringContaining('tracking metadata'),
      details: { include: 'tracking' },
    });
  });

  it('returns a canonical JSON invalid_input envelope for invalid include values', async () => {
    const result = await callListVault({ path: '/', include: ['tracking', 'sync_state'] });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      message: expect.stringContaining('include'),
    });
  });

  it('returns an empty entries array instead of prose for empty directories', async () => {
    const result = await callListVault({ path: 'Empty' });
    const payload = parsePayload(result);

    expect(result.isError).toBe(false);
    expect(payload).toEqual({
      path: 'Empty',
      total: 0,
      displayed: 0,
      truncated: false,
      entries: [],
    });
  });
});
