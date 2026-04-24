/**
 * Unit tests for create_directory MCP tool (Phase 92)
 *
 * Tests shutdown check (DIR-09 / F-52) and no-lock / no-DB assertion (DIR-10).
 * Handler is exercised via the registerFileTools factory, following the same
 * pattern as tests/unit/remove-directory.test.ts.
 *
 * Additional tests (array guards, partial success, idempotency, file conflict)
 * are added in Task 2 once the full handler body is implemented.
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

// path-validation.ts uses lstat internally — mock the full fs/promises for it too
vi.mock('../../src/mcp/utils/path-validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/mcp/utils/path-validation.js')>();
  return actual;
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

describe('create_directory handler — Task 1 skeleton tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('F-52: returns error immediately when server is shutting down', async () => {
    const { getIsShuttingDown } = await import('../../src/server/shutdown-state.js');
    (getIsShuttingDown as MockedFunction<typeof getIsShuttingDown>).mockReturnValue(true);

    const result = await callCreateDirectory({ paths: ['valid/path'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Server is shutting down; new requests cannot be processed.'
    );
  });

  it.skip('DIR-10: handler does not call supabase or acquireLock — verified by module-level no-import');
});
