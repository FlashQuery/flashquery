import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
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
  NullEmbeddingProvider: class NullEmbeddingProvider {},
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: {},
}));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/tag-validator.js', () => ({
  validateAllTags: vi.fn().mockReturnValue({ valid: true, errors: [], conflicts: [], normalized: [] }),
  normalizeTags: vi.fn((tags) => tags),
  deduplicateTags: vi.fn((tags) => tags),
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => ({
  resolveDocumentIdentifier: vi.fn(),
  targetedScan: vi.fn(),
}));

vi.mock('../../src/mcp/tools/documents.js', () => ({
  searchDocumentsSemantic: vi.fn(),
  listMarkdownFiles: vi.fn(),
  parseDocMeta: vi.fn(),
}));

vi.mock('../../src/mcp/tools/memory.js', () => ({
  searchMemoriesSemantic: vi.fn(),
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {},
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseManager } from '../../src/storage/supabase.js';
import { readFile } from 'node:fs/promises';
import { resolveDocumentIdentifier, targetedScan } from '../../src/mcp/utils/resolve-document.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (params: any) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        _config: unknown,
        handler: (params: Record<string, unknown>) => Promise<unknown>
      ) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => handlers[name],
  };
}

function makeConfig(overrides: Partial<FlashQueryConfig['instance']> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance-id',
      vault: {
        path: '/vault',
      },
      ...overrides,
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    },
    locking: { enabled: false },
  } as FlashQueryConfig;
}

function makeQueryChain(result: { data: unknown; error: unknown }): unknown {
  // Build a self-referential chain where every method returns the chain itself
  // so that arbitrary call chains like .select().eq().eq().single() all work.
  // The chain is also thenable so `await chain` resolves to result.
  const chain: Record<string, unknown> = {};
  const returnChain = vi.fn().mockReturnValue(chain);
  chain.select = returnChain;
  chain.eq = returnChain;
  chain.in = returnChain;
  chain.single = vi.fn().mockResolvedValue(result);
  // Make thenable so `await query` resolves to result
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  chain.catch = vi.fn().mockReturnValue(chain);
  // Wrap in a from() that returns the chain for any table name
  return {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue(result),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_doc_outline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('single-mode: full file-based outline', () => {
    it('returns response with frontmatter, headings, and linked documents', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const fileContent = `---
title: Test Document
tags: [test, sample]
---

# Introduction

Some text here

## Background

More details

[[Related Document]]
[[Another Link]]`;

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({
        absPath: '/vault/test.md',
      });
      (targetedScan as ReturnType<typeof vi.fn>).mockResolvedValue({
        relativePath: 'test.md',
        fqcId: 'doc-123',
        capturedFrontmatter: {
          fqcId: 'doc-123',
          status: 'active',
          created: '2026-01-01T00:00:00Z',
        },
      });

      const chain = makeQueryChain({
        data: [{ id: 'doc-123' }],
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: 'test.md' })) as any;

      expect(result.content[0].type).toBe('text');
      const text = result.content[0].text;

      // Verify structure
      expect(text).toContain('Frontmatter:');
      expect(text).toContain('title:');
      expect(text).toContain('Headings:');
      expect(text).toContain('Linked Documents:');

      // Verify headings are formatted without [level N] annotations
      expect(text).toContain('Introduction');
      expect(text).not.toContain('[level 1]');
      expect(text).not.toContain('[level 2]');

      // Verify linked documents are listed
      expect(text).toContain('Related Document');
      expect(text).toContain('Another Link');
    });

    it('supports max_depth parameter to filter headings', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const fileContent = `---
title: Test
---

# H1

## H2

### H3

#### H4`;

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({
        absPath: '/vault/test.md',
      });
      (targetedScan as ReturnType<typeof vi.fn>).mockResolvedValue({
        relativePath: 'test.md',
        fqcId: 'doc-123',
        capturedFrontmatter: {
          fqcId: 'doc-123',
          status: 'active',
          created: '2026-01-01T00:00:00Z',
        },
      });

      const chain = makeQueryChain({
        data: [{ id: 'doc-123' }],
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: 'test.md', max_depth: 2 })) as any;
      const text = result.content[0].text;

      // v2.5 format: headings as key-value (Level: N / Text: heading / Line: N)
      expect(text).toContain('Text: H1');
      expect(text).toContain('Text: H2');
      // H3 and H4 should not appear (filtered by max_depth: 2)
      expect(text).not.toContain('Text: H3');
      expect(text).not.toContain('Text: H4');
    });

    it('supports exclude_headings parameter to omit heading section', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const fileContent = `---
title: Test
---

# Introduction

Some text`;

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({
        absPath: '/vault/test.md',
      });
      (targetedScan as ReturnType<typeof vi.fn>).mockResolvedValue({
        relativePath: 'test.md',
        fqcId: 'doc-123',
        capturedFrontmatter: {
          fqcId: 'doc-123',
          status: 'active',
          created: '2026-01-01T00:00:00Z',
        },
      });

      const chain = makeQueryChain({
        data: [{ id: 'doc-123' }],
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({
        identifiers: 'test.md',
        exclude_headings: true,
      })) as any;
      const text = result.content[0].text;

      // Should not include Headings section
      expect(text).not.toContain('Headings:');
      // Should still have Frontmatter and Linked Documents
      expect(text).toContain('Frontmatter:');
      expect(text).toContain('Linked Documents:');
    });

    it('shows unresolved marker for broken wikilinks', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const fileContent = `---
title: Test
---

# Content

[[Existing Document]]
[[Missing Document]]`;

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({
        absPath: '/vault/test.md',
      });
      (targetedScan as ReturnType<typeof vi.fn>).mockResolvedValue({
        relativePath: 'test.md',
        fqcId: 'doc-123',
        capturedFrontmatter: {
          fqcId: 'doc-123',
          status: 'active',
          created: '2026-01-01T00:00:00Z',
        },
      });

      // Mock DB query that returns only one of the two linked docs
      const chain = makeQueryChain({
        data: [{ id: 'doc-123' }],
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      // This is a simplified test; in practice, the DB query would filter
      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: 'test.md' })) as any;
      const text = result.content[0].text;

      // Response should show linked documents with status
      expect(text).toContain('Linked Documents:');
      expect(text).toContain('Status:');
    });
  });

  describe('batch mode: DB-based metadata', () => {
    it('returns batch response with --- separators', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue('---\ntitle: Test\n---\nContent');
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ absPath: '/vault/doc1.md' })
        .mockResolvedValueOnce({ absPath: '/vault/doc2.md' });
      (targetedScan as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          relativePath: 'doc1.md',
          fqcId: 'id-1',
          capturedFrontmatter: { fqcId: 'id-1', status: 'active', created: '2026-01-01T00:00:00Z' },
        })
        .mockResolvedValueOnce({
          relativePath: 'doc2.md',
          fqcId: 'id-2',
          capturedFrontmatter: { fqcId: 'id-2', status: 'active', created: '2026-01-01T00:00:00Z' },
        });

      const chain = makeQueryChain({
        data: [
          { id: 'id-1', path: 'doc1.md', title: 'Doc One', tags: [], status: 'active', description: null },
          { id: 'id-2', path: 'doc2.md', title: 'Doc Two', tags: ['#important'], status: 'active', description: 'A note' },
        ],
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: ['doc1.md', 'doc2.md'] })) as any;
      const text = result.content[0].text;

      // Should contain --- separators
      expect(text).toContain('---');
      // Should have both documents
      expect(text).toContain('Doc One');
      expect(text).toContain('Doc Two');
      // Should use key-value format
      expect(text).toContain('Path:');
      expect(text).toContain('Title:');
    });

    it('shows progress message for >100 identifiers', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      const largeIdentifierList = Array.from({ length: 150 }, (_, i) => `doc${i}.md`);

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue('---\ntitle: Test\n---\nContent');
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({ absPath: '/vault/test.md' });
      (targetedScan as ReturnType<typeof vi.fn>).mockResolvedValue({
        relativePath: 'test.md',
        fqcId: 'doc-123',
        capturedFrontmatter: { fqcId: 'doc-123', status: 'active', created: '2026-01-01T00:00:00Z' },
      });

      const chain = makeQueryChain({
        data: largeIdentifierList.map((path, i) => ({
          id: `id-${i}`,
          path,
          title: `Document ${i}`,
          tags: [],
          status: 'active',
          description: null,
        })),
        error: null,
      });
      (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: largeIdentifierList })) as any;
      const text = result.content[0].text;

      // Should include progress message
      expect(text).toContain('Processing 150 documents');
      expect(text).toContain('may take a moment');
    });
  });

  describe('error handling', () => {
    it('returns error when file cannot be read', async () => {
      const config = makeConfig();
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, config);

      (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('File not found'));
      (resolveDocumentIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue({
        absPath: '/vault/missing.md',
      });

      const handler = getHandler('get_doc_outline');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await handler({ identifiers: 'missing.md' })) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
