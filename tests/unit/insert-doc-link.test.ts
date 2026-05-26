import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import {
  AmbiguousDocumentIdentifierError,
  DocumentNotFoundError,
  resolveDocumentIdentifier,
  targetedScan,
} from '../../src/mcp/utils/resolve-document.js';
import { vaultManager } from '../../src/storage/vault.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({ from: vi.fn() })) },
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: { writeMarkdown: vi.fn() },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/mcp/utils/resolve-document.js', () => {
  class DocumentNotFoundError extends Error {
    constructor(public identifier: string, message = `Document not found: "${identifier}"`) {
      super(message);
      this.name = 'DocumentNotFoundError';
    }
  }

  class AmbiguousDocumentIdentifierError extends Error {
    constructor(public identifier: string, public matches: string[]) {
      super(`Ambiguous filename "${identifier}" matches ${matches.length} files`);
      this.name = 'AmbiguousDocumentIdentifierError';
    }
  }

  return {
    DocumentNotFoundError,
    AmbiguousDocumentIdentifierError,
    resolveDocumentIdentifier: vi.fn(),
    targetedScan: vi.fn(),
  };
});

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface CapturedTool {
  config: { inputSchema: Record<string, z.ZodType> };
  handler: Handler;
}

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
  } as FlashQueryConfig;
}

function captureInsertDocLink(vaultPath: string): CapturedTool {
  let captured: CapturedTool | undefined;
  const server = {
    registerTool: vi.fn((name: string, config: CapturedTool['config'], handler: Handler) => {
      if (name === 'insert_doc_link') captured = { config, handler };
    }),
  } as unknown as McpServer;

  registerCompoundTools(server, makeConfig(vaultPath));
  if (!captured) throw new Error('insert_doc_link handler not registered');
  return captured;
}

async function writeMarkdownFixture(vaultPath: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<string> {
  const absPath = join(vaultPath, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, matter.stringify(body, frontmatter), 'utf-8');
  return absPath;
}

function parseText(result: Awaited<ReturnType<Handler>>): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('insert_doc_link handler contract', () => {
  let vaultPath: string;
  let tool: CapturedTool;
  let absSourceA: string;
  let absSourceB: string;
  let absTarget: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-insert-doc-link-unit-'));
    absSourceA = await writeMarkdownFixture(
      vaultPath,
      'source-a.md',
      { [FM.TITLE]: 'Source A', [FM.ID]: 'source-a-id', [FM.UPDATED]: '2026-05-13T10:00:00.000Z' },
      'Source A body'
    );
    absSourceB = await writeMarkdownFixture(
      vaultPath,
      'source-b.md',
      { [FM.TITLE]: 'Source B', [FM.ID]: 'source-b-id' },
      'Source B body'
    );
    absTarget = await writeMarkdownFixture(
      vaultPath,
      'target.md',
      { [FM.TITLE]: 'Target Doc', [FM.ID]: 'target-id' },
      'Target body'
    );

    vi.mocked(resolveDocumentIdentifier).mockImplementation(async (_config, _supabase, identifier) => {
      if (identifier === 'target.md') return { absPath: absTarget, relativePath: 'target.md', fqcId: 'target-id', resolvedVia: 'path' };
      if (identifier === 'source-a.md') return { absPath: absSourceA, relativePath: 'source-a.md', fqcId: 'source-a-id', resolvedVia: 'path' };
      if (identifier === 'source-b.md') return { absPath: absSourceB, relativePath: 'source-b.md', fqcId: 'source-b-id', resolvedVia: 'path' };
      if (identifier === 'ambiguous.md') throw new AmbiguousDocumentIdentifierError('ambiguous.md', ['a/ambiguous.md', 'b/ambiguous.md']);
      throw new DocumentNotFoundError(String(identifier));
    });
    vi.mocked(targetedScan).mockImplementation(async (_config, _supabase, resolved) => ({
      ...resolved,
      capturedFrontmatter: {
        fqcId: resolved.fqcId ?? `${resolved.relativePath}-id`,
        created: '2026-05-13T09:00:00.000Z',
        status: 'active',
        contentHash: 'hash',
      },
    }));
    vi.mocked(vaultManager.writeMarkdown).mockResolvedValue(undefined);
    tool = captureInsertDocLink(vaultPath);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('schema accepts string or array identifiers and requires target_identifier', () => {
    const schema = z.object(tool.config.inputSchema);

    expect(schema.safeParse({ identifiers: 'source-a.md', target_identifier: 'target.md' }).success).toBe(true);
    expect(schema.safeParse({ identifiers: ['source-a.md', 'source-b.md'], target_identifier: 'target.md' }).success).toBe(true);
    expect(schema.safeParse({ identifier: 'source-a.md', target: 'target.md' }).success).toBe(false);
    expect(schema.safeParse({ identifiers: 'source-a.md' }).success).toBe(false);
  });

  it('returns a document identification block with modified and size.chars for a single source', async () => {
    const result = await tool.handler({ identifiers: 'source-a.md', target_identifier: 'target.md', property: 'links' });

    expect(result.isError).not.toBe(true);
    expect(parseText(result)).toMatchObject({
      results: [{
        identifier: 'source-a.md',
        title: 'Source A',
        path: 'source-a.md',
        fq_id: 'source-a-id',
        modified: '2026-05-13T10:00:00.000Z',
        size: { chars: expect.any(Number) },
        status: 'updated',
        property: 'links',
        link: '[[Target Doc]]',
        target: { identifier: 'target.md', fq_id: 'target-id', path: 'target.md', title: 'Target Doc' },
      }],
      removal_gate: 'call_macro parity',
    });
  });

  it('returns single top-level expected envelopes for missing or ambiguous targets', async () => {
    const missing = await tool.handler({ identifiers: 'source-a.md', target_identifier: 'missing-target.md' });
    const ambiguous = await tool.handler({ identifiers: 'source-a.md', target_identifier: 'ambiguous.md' });

    expect(missing.isError).toBe(false);
    expect(parseText(missing)).toMatchObject({ error: 'not_found', identifier: 'missing-target.md' });
    expect(ambiguous.isError).toBe(false);
    expect(parseText(ambiguous)).toMatchObject({
      error: 'ambiguous_identifier',
      identifier: 'ambiguous.md',
      details: { matches: ['a/ambiguous.md', 'b/ambiguous.md'] },
    });
    expect(vaultManager.writeMarkdown).not.toHaveBeenCalled();
  });

  it('returns ordered batch results with a per-source missing envelope', async () => {
    const result = await tool.handler({ identifiers: ['source-a.md', 'missing-source.md'], target_identifier: 'target.md' });
    const payload = parseText(result) as { results: Array<Record<string, unknown>> };

    expect(result.isError).not.toBe(true);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toMatchObject({ identifier: 'source-a.md' });
    expect(['updated', 'unchanged']).toContain(payload.results[0].status);
    expect(payload.results[1]).toMatchObject({ error: 'not_found', identifier: 'missing-source.md' });
  });

  it('reports unchanged and does not duplicate an existing wikilink', async () => {
    absSourceA = await writeMarkdownFixture(
      vaultPath,
      'source-a.md',
      { [FM.TITLE]: 'Source A', [FM.ID]: 'source-a-id', links: ['[[Target Doc]]'] },
      'Source A body'
    );

    const result = await tool.handler({ identifiers: 'source-a.md', target_identifier: 'target.md' });
    const payload = parseText(result) as { results: Array<Record<string, unknown>> };

    expect(payload.results[0]).toMatchObject({ status: 'unchanged', link: '[[Target Doc]]' });
    expect(vaultManager.writeMarkdown).toHaveBeenCalledWith(
      'source-a.md',
      expect.objectContaining({ links: ['[[Target Doc]]'] }),
      expect.stringContaining('Source A body')
    );
  });
});
