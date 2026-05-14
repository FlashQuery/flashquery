import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { mkdir, stat, readdir, rmdir } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  rmdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
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

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/mcp/utils/path-validation.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/utils/path-validation.js')>(
    '../../src/mcp/utils/path-validation.js'
  );
  return {
    ...actual,
    validateVaultPath: vi.fn(async (_vaultRoot: string, userPath: string) => {
      if (userPath.includes('\0')) {
        throw new Error('Path contains invalid null byte.');
      }
      if (userPath.startsWith('..')) {
        return {
          valid: false,
          absPath: '',
          relativePath: userPath,
          error: 'Path traversal detected - path must be within the vault root.',
        };
      }
      if (userPath === '' || userPath === '.') {
        return {
          valid: false,
          absPath: '',
          relativePath: userPath,
          error: 'Path cannot target the vault root itself.',
        };
      }
      return { valid: true, absPath: `/vault/${userPath}`, relativePath: userPath };
    }),
  };
});

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  name: string;
  config: { inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

function makeConfig(overrides: Partial<import('../../src/config/loader.js').FlashQueryConfig> = {}) {
  return {
    instance: {
      id: 'test-instance',
      vault: { path: '/vault' },
    },
    locking: { enabled: true, ttlSeconds: 30 },
    ...overrides,
  } as unknown as import('../../src/config/loader.js').FlashQueryConfig;
}

async function registerTools(
  config: import('../../src/config/loader.js').FlashQueryConfig = makeConfig()
): Promise<RegisteredTool[]> {
  const { registerFileTools } = await import('../../src/mcp/tools/files.js');
  const tools: RegisteredTool[] = [];
  const mockServer = {
    registerTool: vi.fn(
      (
        name: string,
        config: RegisteredTool['config'],
        handler: (args: Record<string, unknown>) => Promise<ToolResult>
      ) => {
        tools.push({ name, config, handler });
      }
    ),
  } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;

  registerFileTools(mockServer, config);
  return tools;
}

async function callManageDirectory(
  args: Record<string, unknown>,
  config: import('../../src/config/loader.js').FlashQueryConfig = makeConfig()
): Promise<ToolResult> {
  const tools = await registerTools(config);
  const tool = tools.find((entry) => entry.name === 'manage_directory');
  if (!tool) {
    throw new Error('manage_directory handler not registered');
  }
  return tool.handler(args);
}

function parseJson(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function makeStatResult(isDirectory: boolean) {
  return {
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  } as Awaited<ReturnType<typeof stat>>;
}

function makeErrnoError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(code);
  err.code = code;
  return err;
}

describe('manage_directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(rmdir).mockResolvedValue(undefined);
    vi.mocked(stat).mockRejectedValue(makeErrnoError('ENOENT'));
    vi.mocked(readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
  });

  it('registers manage_directory with action and paths schema', async () => {
    const tools = await registerTools();
    const tool = tools.find((entry) => entry.name === 'manage_directory');

    expect(tool).toBeDefined();
    expect(tool?.config.inputSchema).toHaveProperty('action');
    expect(tool?.config.inputSchema).toHaveProperty('paths');
  });

  it('returns canonical invalid_input when action is missing', async () => {
    const result = await callManageDirectory({ paths: ['Inbox'] });
    const payload = parseJson(result);

    expect(result.isError).toBe(false);
    expect(payload.error).toBe('invalid_input');
    expect(payload.details).toMatchObject({ field: 'action' });
  });

  it('returns canonical invalid_input when action is unknown', async () => {
    const result = await callManageDirectory({ action: 'rename', paths: ['Inbox'] });
    const payload = parseJson(result);

    expect(result.isError).toBe(false);
    expect(payload.error).toBe('invalid_input');
    expect(payload.details).toMatchObject({ field: 'action' });
  });

  it('requires paths to be a string array', async () => {
    const result = await callManageDirectory({ action: 'create', paths: 'Inbox' });
    const payload = parseJson(result);

    expect(result.isError).toBe(false);
    expect(payload.error).toBe('invalid_input');
    expect(payload.details).toMatchObject({ field: 'paths' });
  });

  it('preserves input order and executes duplicate paths sequentially', async () => {
    vi.mocked(stat)
      .mockRejectedValueOnce(makeErrnoError('ENOENT'))
      .mockResolvedValueOnce(makeStatResult(true))
      .mockRejectedValueOnce(makeErrnoError('ENOENT'));

    const result = await callManageDirectory({
      action: 'create',
      paths: ['Alpha', 'Alpha', 'Beta'],
    });
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results.map((entry) => entry.path)).toEqual(['Alpha', 'Alpha', 'Beta']);
    expect(payload.results.map((entry) => entry.status)).toEqual(['created', 'unchanged', 'created']);
    expect(vi.mocked(mkdir)).toHaveBeenCalledTimes(2);
  });

  it('returns directory_not_empty conflict for non-empty remove', async () => {
    vi.mocked(stat).mockResolvedValue(makeStatResult(true));
    vi.mocked(readdir).mockResolvedValue(['note.md'] as unknown as Awaited<ReturnType<typeof readdir>>);

    const result = await callManageDirectory({ action: 'remove', paths: ['Projects'] });
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      error: 'conflict',
      identifier: 'Projects',
      details: { reason: 'directory_not_empty' },
    });
    expect(vi.mocked(rmdir)).not.toHaveBeenCalled();
  });

  it('returns path_traversal reason for unsafe vault paths', async () => {
    const result = await callManageDirectory({ action: 'create', paths: ['../outside'] });
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      error: 'invalid_input',
      message: 'Path must stay inside the vault',
      identifier: '../outside',
      details: { reason: 'path_traversal' },
    });
  });

  it('returns lock_contention conflict when the directory lock cannot be acquired', async () => {
    const { acquireLock } = await import('../../src/services/write-lock.js');
    (acquireLock as MockedFunction<typeof acquireLock>).mockResolvedValueOnce(false);

    const result = await callManageDirectory({ action: 'create', paths: ['Locked'] });
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      error: 'conflict',
      identifier: 'Locked',
      details: { reason: 'lock_contention' },
    });
    expect(vi.mocked(mkdir)).not.toHaveBeenCalled();
  });

  it('sanitizes unsafe directory characters before per-path processing', async () => {
    const result = await callManageDirectory({
      action: 'create',
      paths: ['Bad\0Path', 'Good'],
    });
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toMatchObject({
      path: 'Bad Path',
      status: 'created',
    });
    expect(payload.results[1]).toMatchObject({
      path: 'Good',
      status: 'created',
    });
  });

  it('does not acquire directory locks when locking is disabled', async () => {
    const { acquireLock, releaseLock } = await import('../../src/services/write-lock.js');
    (acquireLock as MockedFunction<typeof acquireLock>).mockResolvedValueOnce(false);

    const result = await callManageDirectory(
      { action: 'create', paths: ['Unlocked'] },
      makeConfig({ locking: { enabled: false, ttlSeconds: 30 } })
    );
    const payload = parseJson(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).toBe(false);
    expect(payload.results[0]).toMatchObject({
      path: 'Unlocked',
      status: 'created',
    });
    expect(acquireLock).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith('/vault/Unlocked', { recursive: true });
  });
});
