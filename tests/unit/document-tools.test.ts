import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { computeHash, listMarkdownFiles } from '../../src/storage/document-primitives.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({})) },
}));

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

describe('document tools final surface', () => {
  it('registers current document tools and omits removed legacy handlers', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
    } as unknown as McpServer;

    registerDocumentTools(server, makeConfig());

    expect(names).toEqual(expect.arrayContaining([
      'write_document',
      'get_document',
      'archive_document',
      'remove_document',
      'copy_document',
      'move_document',
    ]));
    expect(names).not.toContain('create_document');
    expect(names).not.toContain('update_document');
    expect(names).not.toContain('search_documents');
  });

  it('registers get_document connections as an include-gated payload with validation', async () => {
    let getDocumentConfig: { inputSchema?: Record<string, unknown> } | undefined;
    let getDocumentHandler: ((params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>) | undefined;
    const server = {
      registerTool: vi.fn((name: string, config: { inputSchema?: Record<string, unknown> }, handler: typeof getDocumentHandler) => {
        if (name === 'get_document') {
          getDocumentConfig = config;
          getDocumentHandler = handler;
        }
      }),
    } as unknown as McpServer;

    registerDocumentTools(server, makeConfig());

    const includeSchema = getDocumentConfig?.inputSchema?.include as { safeParse(value: unknown): { success: boolean } } | undefined;
    expect(includeSchema?.safeParse(['connections']).success).toBe(true);
    expect(getDocumentConfig?.inputSchema?.connections).toBeDefined();

    const result = await getDocumentHandler?.({
      identifiers: 'Notes/Plan.md',
      include: ['body'],
      connections: { limit: 10 },
    });
    const payload = JSON.parse(result?.content[0]?.text ?? '{}') as { error?: string; details?: { conflict?: string } };

    expect(result?.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      details: { conflict: 'connections_without_include' },
    });
  });
});

describe('document primitives', () => {
  it('T-U-021 computes stable SHA-256 hashes for raw markdown content', () => {
    expect(computeHash('---\ntitle: Alpha\n---\nBody\n')).toBe(
      'a68539c0e44efb1d786ded26752df5eef9413db38e41c1629ad838595777dc2c'
    );
  });

  it('T-U-021 lists markdown recursively while preserving extension, prefix, and dotfile filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq-doc-primitives-'));
    try {
      await mkdir(join(root, 'Project', 'Nested'), { recursive: true });
      await mkdir(join(root, 'Project', '.obsidian'), { recursive: true });
      await mkdir(join(root, 'Other'), { recursive: true });
      await writeFile(join(root, 'Project', 'alpha.md'), 'alpha');
      await writeFile(join(root, 'Project', 'Nested', 'beta.markdown'), 'beta');
      await writeFile(join(root, 'Project', '.hidden.md'), 'hidden');
      await writeFile(join(root, 'Project', '.obsidian', 'cache.md'), 'cache');
      await writeFile(join(root, 'Other', 'gamma.md'), 'gamma');

      await expect(listMarkdownFiles(root, ['.md', '.markdown'], 'Project')).resolves.toEqual(
        expect.arrayContaining([
          'Project/alpha.md',
          'Project/Nested/beta.markdown',
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists markdown files when the vault itself is under a hidden parent directory', async () => {
    const hiddenParent = await mkdtemp(join(tmpdir(), '.fq-doc-primitives-'));
    const root = join(hiddenParent, 'vault');
    try {
      await mkdir(join(root, 'Project', '.obsidian'), { recursive: true });
      await writeFile(join(root, 'Project', 'visible.md'), 'visible');
      await writeFile(join(root, 'Project', '.hidden.md'), 'hidden');
      await writeFile(join(root, 'Project', '.obsidian', 'cache.md'), 'cache');

      await expect(listMarkdownFiles(root, ['.md'])).resolves.toEqual([
        'Project/visible.md',
      ]);
    } finally {
      await rm(hiddenParent, { recursive: true, force: true });
    }
  });
});
