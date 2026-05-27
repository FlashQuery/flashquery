import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({ from: vi.fn() })) },
}));

vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    moveMarkdownToTrash: vi.fn(),
    readMarkdown: vi.fn(),
    removeMarkdown: vi.fn(),
    writeMarkdown: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

interface CapturedTool {
  inputSchema: Record<string, z.ZodType>;
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
  } as FlashQueryConfig;
}

function captureTools(): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool: vi.fn((name: string, config: CapturedTool) => {
      tools.set(name, config);
    }),
  } as unknown as McpServer;

  const config = makeConfig();
  registerDocumentTools(server, config);
  registerCompoundTools(server, config);
  return tools;
}

function toolSchema(tools: Map<string, CapturedTool>, name: string): z.ZodObject<Record<string, z.ZodType>> {
  const captured = tools.get(name);
  if (!captured) {
    throw new Error(`${name} was not registered`);
  }
  return z.strictObject(captured.inputSchema);
}

describe('T-U-026 mixed batch identifier shape', () => {
  it('accepts string, string array, and mixed object arrays for archive_document, remove_document, and insert_doc_link', () => {
    const tools = captureTools();
    const archiveDocument = toolSchema(tools, 'archive_document');
    const removeDocument = toolSchema(tools, 'remove_document');
    const insertDocLink = toolSchema(tools, 'insert_doc_link');
    const mixedIdentifiers = [
      'Notes/bare.md',
      { identifier: 'Notes/tokened.md', version_token: 'sha256-token' },
    ];

    for (const schema of [archiveDocument, removeDocument]) {
      expect(schema.safeParse({ identifiers: 'Notes/one.md' }).success).toBe(true);
      expect(schema.safeParse({ identifiers: ['Notes/one.md', 'Notes/two.md'] }).success).toBe(true);
      expect(schema.safeParse({ identifiers: mixedIdentifiers }).success).toBe(true);
    }

    expect(insertDocLink.safeParse({ identifiers: 'Notes/one.md', target_identifier: 'Notes/target.md' }).success).toBe(true);
    expect(insertDocLink.safeParse({ identifiers: ['Notes/one.md', 'Notes/two.md'], target_identifier: 'Notes/target.md' }).success).toBe(true);
    expect(insertDocLink.safeParse({ identifiers: mixedIdentifiers, target_identifier: 'Notes/target.md' }).success).toBe(true);
  });

  it('accepts mixed document targets for apply_tags while preserving memory target shape', () => {
    const tools = captureTools();
    const applyTags = toolSchema(tools, 'apply_tags');

    expect(applyTags.safeParse({
      identifiers: 'Notes/one.md',
      add_tags: ['#topic/test'],
    }).success).toBe(true);
    expect(applyTags.safeParse({
      identifiers: ['Notes/one.md', { identifier: 'Notes/two.md', version_token: 'sha256-token' }],
      add_tags: ['#topic/test'],
    }).success).toBe(true);
    expect(applyTags.safeParse({
      targets: [
        { entity_type: 'document', identifier: 'Notes/one.md', version_token: 'sha256-token' },
        { entity_type: 'memory', identifier: 'memory-1' },
      ],
      add_tags: ['#topic/test'],
    }).success).toBe(true);
  });
});

describe('T-U-027 unsupported positional token shapes', () => {
  it('rejects top-level version_tokens fields on scoped batch schemas', () => {
    const tools = captureTools();
    const scopedCases = [
      ['archive_document', { identifiers: ['Notes/one.md'], version_tokens: ['token'] }],
      ['remove_document', { identifiers: ['Notes/one.md'], version_tokens: ['token'] }],
      ['insert_doc_link', { identifiers: ['Notes/one.md'], target_identifier: 'Notes/target.md', version_tokens: ['token'] }],
      ['apply_tags', { identifiers: ['Notes/one.md'], add_tags: ['#topic/test'], version_tokens: ['token'] }],
    ] as const;

    for (const [name, payload] of scopedCases) {
      expect(toolSchema(tools, name).safeParse(payload).success).toBe(false);
    }
  });

  it('rejects identifier-token maps and malformed object items', () => {
    const tools = captureTools();
    const malformedIdentifiers = [
      { identifier: 'Notes/missing-token.md' },
      { version_token: 'missing-identifier' },
      { 'Notes/map-key.md': 'sha256-token' },
    ];

    for (const name of ['archive_document', 'remove_document']) {
      const schema = toolSchema(tools, name);
      for (const badItem of malformedIdentifiers) {
        expect(schema.safeParse({ identifiers: [badItem] }).success).toBe(false);
      }
      expect(schema.safeParse({ identifiers: { 'Notes/map-key.md': 'sha256-token' } }).success).toBe(false);
    }

    const insertDocLink = toolSchema(tools, 'insert_doc_link');
    for (const badItem of malformedIdentifiers) {
      expect(insertDocLink.safeParse({ identifiers: [badItem], target_identifier: 'Notes/target.md' }).success).toBe(false);
    }
    expect(insertDocLink.safeParse({
      identifiers: { 'Notes/map-key.md': 'sha256-token' },
      target_identifier: 'Notes/target.md',
    }).success).toBe(false);

    const applyTags = toolSchema(tools, 'apply_tags');
    for (const badItem of malformedIdentifiers) {
      expect(applyTags.safeParse({ identifiers: [badItem], add_tags: ['#topic/test'] }).success).toBe(false);
    }
    expect(applyTags.safeParse({
      targets: [{ entity_type: 'document', version_token: 'missing-identifier' }],
      add_tags: ['#topic/test'],
    }).success).toBe(false);
    expect(applyTags.safeParse({
      targets: [{ entity_type: 'document', 'Notes/map-key.md': 'sha256-token' }],
      add_tags: ['#topic/test'],
    }).success).toBe(false);
    expect(applyTags.safeParse({
      targets: [{ entity_type: 'document', identifier: 'Notes/missing-token.md' }],
      add_tags: ['#topic/test'],
    }).success).toBe(true);
  });
});
