/**
 * Unit tests for write-lock integration in MCP tool handlers (Phase 24, Plan 02).
 *
 * Verifies:
 * - When locking.enabled=true and acquireLock returns false, the tool returns isError:true
 *   with the lock timeout message.
 * - When locking.enabled=false, acquireLock is never called.
 * - releaseLock is called in the finally block even when the tool throws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be hoisted before any imports of mocked modules)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn(),
  },
  NullEmbeddingProvider: class NullEmbeddingProvider {
    embed(_text: string): Promise<number[]> {
      throw new Error('Semantic search unavailable');
    }
    getDimensions(): number { return 1536; }
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    writeMarkdown: vi.fn(),
    readMarkdown: vi.fn(),
  },
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {
    getTableSpec: vi.fn(),
    getAllEntries: vi.fn(() => []),
  },
  resolveTableName: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked modules for assertion
// ─────────────────────────────────────────────────────────────────────────────

import { acquireLock, releaseLock } from '../../src/services/write-lock.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { embeddingProvider } from '../../src/embedding/provider.js';

// Tool registrars
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => ToolHandler;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => handlers[name] as ToolHandler,
  };
}

function makeConfig(lockingEnabled: boolean): FlashQueryConfig {
  return {
    instance: {
      name: 'test',
      id: 'test-instance-id',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    },
    logging: { level: 'info', output: 'stdout' },
    locking: { enabled: lockingEnabled, ttlSeconds: 30 },
    mcp: { transport: 'stdio' },
    git: { autoCommit: false, autoPush: false, remote: '', branch: 'main' },
    server: { host: 'localhost', port: 3100 },
  } as unknown as FlashQueryConfig;
}

/** Minimal Supabase mock client */
function mockClient() {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'insert', 'select', 'single', 'eq', 'order', 'limit', 'rpc', 'update', 'delete', 'gte'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as Record<string, unknown> & { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null });
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('write-lock tool integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient() as ReturnType<typeof supabaseManager.getClient>);
    vi.mocked(releaseLock).mockResolvedValue(undefined);
  });

  // ─── save_memory ─────────────────────────────────────────────────────────

  describe('save_memory', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      const result = await getHandler('save_memory')({ content: 'test memory', tags: [] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('memory');
    });

    it('does not call acquireLock when locking.enabled is false', async () => {
      const config = makeConfig(false);
      const { server, getHandler } = createMockServer();

      // embed will throw, causing the tool body to error — that's fine, we just need to
      // verify acquireLock was NOT called
      vi.mocked(embeddingProvider.embed).mockRejectedValue(new Error('embed error'));

      registerMemoryTools(server, config);
      await getHandler('save_memory')({ content: 'test', tags: [] });

      expect(acquireLock).not.toHaveBeenCalled();
    });

    it('calls releaseLock in finally block even when tool body throws', async () => {
      vi.mocked(acquireLock).mockResolvedValue(true);
      vi.mocked(embeddingProvider.embed).mockRejectedValue(new Error('embed failed'));

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      await getHandler('save_memory')({ content: 'test', tags: [] });

      expect(releaseLock).toHaveBeenCalledWith(
        expect.anything(),
        config.instance.id,
        'memory'
      );
    });
  });

  // ─── create_document ──────────────────────────────────────────────────────

  describe('create_document', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerDocumentTools(server, config);

      const result = await getHandler('create_document')({ title: 'Test', content: 'body' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('documents');
    });

    it('does not call acquireLock when locking is disabled', async () => {
      const config = makeConfig(false);
      const { server, getHandler } = createMockServer();

      // vaultManager.writeMarkdown will be called — let it throw so we don't need full fs mock
      const { vaultManager } = await import('../../src/storage/vault.js');
      vi.mocked(vaultManager.writeMarkdown).mockRejectedValue(new Error('vault error'));

      registerDocumentTools(server, config);
      await getHandler('create_document')({ title: 'Test', content: 'body' });

      expect(acquireLock).not.toHaveBeenCalled();
    });

    it('calls releaseLock in finally block for create_document', async () => {
      vi.mocked(acquireLock).mockResolvedValue(true);
      const { vaultManager } = await import('../../src/storage/vault.js');
      vi.mocked(vaultManager.writeMarkdown).mockRejectedValue(new Error('vault error'));

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerDocumentTools(server, config);

      await getHandler('create_document')({ title: 'Test', content: 'body' });

      expect(releaseLock).toHaveBeenCalledWith(
        expect.anything(),
        config.instance.id,
        'documents'
      );
    });
  });

  // ─── update_document ──────────────────────────────────────────────────────

  describe('update_document', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerDocumentTools(server, config);

      const result = await getHandler('update_document')({ path: 'test.md', content: 'new body' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('documents');
    });
  });

  // ─── create_record ────────────────────────────────────────────────────────

  describe('create_record', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerRecordTools(server, config);

      const result = await getHandler('create_record')({
        plugin_id: 'crm',
        table: 'contacts',
        fields: { name: 'Alice' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('records');
    });

    it('does not call acquireLock when locking is disabled', async () => {
      const config = makeConfig(false);
      const { server, getHandler } = createMockServer();

      const { pluginManager, resolveTableName } = await import('../../src/plugins/manager.js');
      vi.mocked(pluginManager.getTableSpec).mockReturnValue(null);
      vi.mocked(resolveTableName).mockReturnValue('fqcp_crm_default_contacts');

      registerRecordTools(server, config);
      await getHandler('create_record')({
        plugin_id: 'crm',
        table: 'contacts',
        fields: { name: 'Alice' },
      });

      expect(acquireLock).not.toHaveBeenCalled();
    });

    it('calls releaseLock in finally block for create_record', async () => {
      vi.mocked(acquireLock).mockResolvedValue(true);

      const { pluginManager, resolveTableName } = await import('../../src/plugins/manager.js');
      vi.mocked(pluginManager.getTableSpec).mockReturnValue(null);
      vi.mocked(resolveTableName).mockReturnValue('fqcp_crm_default_contacts');

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerRecordTools(server, config);

      await getHandler('create_record')({
        plugin_id: 'crm',
        table: 'contacts',
        fields: { name: 'Alice' },
      });

      expect(releaseLock).toHaveBeenCalledWith(
        expect.anything(),
        config.instance.id,
        'records'
      );
    });
  });

  // ─── update_record ────────────────────────────────────────────────────────

  describe('update_record', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerRecordTools(server, config);

      const result = await getHandler('update_record')({
        plugin_id: 'crm',
        table: 'contacts',
        id: 'some-uuid',
        fields: { name: 'Bob' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('records');
    });
  });

  // ─── archive_record ───────────────────────────────────────────────────────

  describe('archive_record', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerRecordTools(server, config);

      const result = await getHandler('archive_record')({
        plugin_id: 'crm',
        table: 'contacts',
        id: 'some-uuid',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('records');
    });
  });

  // ─── update_doc_header ───────────────────────────────────────────────────

  describe('update_doc_header', () => {
    it('returns isError:true with lock timeout message when acquireLock returns false', async () => {
      vi.mocked(acquireLock).mockResolvedValue(false);

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const result = await getHandler('update_doc_header')({
        identifier: 'notes.md',
        updates: { title: 'New Title' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Write lock timeout');
      expect(result.content[0].text).toContain('documents');
    });

    it('calls releaseLock in finally block for update_doc_header', async () => {
      vi.mocked(acquireLock).mockResolvedValue(true);
      // File does not exist — will return early with an error, but finally should still run

      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      await getHandler('update_doc_header')({
        identifier: 'nonexistent.md',
        updates: { title: 'New Title' },
      });

      expect(releaseLock).toHaveBeenCalledWith(
        expect.anything(),
        config.instance.id,
        'documents'
      );
    });
  });

  // ─── Read tools / apply_tags — no lock ───────────────────────────────────

  describe('read tools do not acquire locks', () => {
    it('search_memory does not call acquireLock', async () => {
      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerMemoryTools(server, config);

      // NullEmbeddingProvider check will return isError — that's fine
      await getHandler('search_memory')({ query: 'test' });

      expect(acquireLock).not.toHaveBeenCalled();
    });

    it('list_memories does not call acquireLock', async () => {
      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();

      // Make the supabase chain resolve with empty data
      const client = mockClient();
      (client as Record<string, unknown> & { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });
      vi.mocked(supabaseManager.getClient).mockReturnValue(client as ReturnType<typeof supabaseManager.getClient>);

      registerMemoryTools(server, config);
      await getHandler('list_memories')({});

      expect(acquireLock).not.toHaveBeenCalled();
    });
  });

  describe('apply_tags does not acquire locks', () => {
    it('apply_tags does not call acquireLock', async () => {
      const config = makeConfig(true);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      // The handler will fail due to file not existing — that's expected
      await getHandler('apply_tags')({
        identifier: 'notes.md',
        add_tags: ['#project/test'],
        remove_tags: [],
      });

      expect(acquireLock).not.toHaveBeenCalled();
    });
  });
});
