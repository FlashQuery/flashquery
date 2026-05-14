import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { getToolMetadata } from '../../src/mcp/tool-metadata.js';
import { parseDocMeta } from '../../src/mcp/tools/documents.js';
import { pluginManager } from '../../src/plugins/manager.js';

interface QueryResult {
  data: unknown[];
  error: { message: string } | null;
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private filters = new Map<string, unknown>();
  private tags: string[] = [];
  private tagMode: 'any' | 'all' = 'any';

  constructor(private readonly rows: unknown[]) {}

  select(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  eq(field: string, value: unknown): this {
    this.filters.set(field, value);
    return this;
  }
  overlaps(_field: string, tags: string[]): this {
    this.tags = tags;
    this.tagMode = 'any';
    return this;
  }
  contains(_field: string, tags: string[]): this {
    this.tags = tags;
    this.tagMode = 'all';
    return this;
  }
  in(_field: string, tags: string[]): this {
    this.tags = tags;
    this.tagMode = 'any';
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled ?? ((value) => value as TResult1));
  }

  private result(): QueryResult {
    const rows = this.rows.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const record = row as Record<string, unknown>;
      for (const [field, value] of this.filters.entries()) {
        if (record[field] !== value) return false;
      }
      if (this.tags.length === 0) return true;
      const rowTags = Array.isArray(record.tags)
        ? record.tags
        : typeof record.tag === 'string'
          ? [record.tag]
          : [];
      return this.tagMode === 'all'
        ? this.tags.every((tag) => rowTags.includes(tag))
        : this.tags.some((tag) => rowTags.includes(tag));
    });
    return { data: rows, error: null };
  }
}

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => mockSupabaseClient) },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/mcp/tools/documents.js', () => ({
  parseDocMeta: vi.fn(),
  searchDocumentsSemantic: vi.fn(),
  listMarkdownFiles: vi.fn(),
}));

vi.mock('../../src/mcp/tools/memory.js', () => ({
  searchMemoriesSemantic: vi.fn(),
}));

vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: { getAllEntries: vi.fn() },
}));

let tableRows: Record<string, unknown[]> = {};
const mockSupabaseClient = {
  from: vi.fn((table: string) => new QueryBuilder(tableRows[table] ?? [])),
};

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function makeConfig(hostTools?: string[]): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    locking: { enabled: false, ttlSeconds: 30 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    ...(hostTools === undefined ? {} : { hostMcpTools: { tools: hostTools, excludedTools: [] } }),
  } as FlashQueryConfig;
}

function captureGetBriefing(config: FlashQueryConfig): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, toolHandler: Handler) => {
      if (name === 'get_briefing') handler = toolHandler;
    }),
  } as unknown as McpServer;

  registerCompoundTools(server, config);
  if (!handler) throw new Error('get_briefing handler not registered');
  return handler;
}

function parseText(result: Awaited<ReturnType<Handler>>): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('get_briefing transitional JSON contract', () => {
  beforeEach(() => {
    tableRows = {
      fqc_documents: [{
        id: 'doc-id',
        title: 'Phase 128 Doc',
        path: 'phase-128.md',
        tags: ['phase-128'],
        status: 'active',
        instance_id: 'unit',
        updated_at: '2026-05-13T10:00:00.000Z',
      }],
      fqc_memory: [{
        id: 'memory-id',
        content: 'Phase 128 memory',
        tags: ['phase-128'],
        plugin_scope: 'global',
        status: 'active',
        is_latest: true,
        instance_id: 'unit',
        created_at: '2026-05-13T09:00:00.000Z',
        updated_at: '2026-05-13T10:00:00.000Z',
      }],
      fqc_contacts: [{
        id: 'record-id',
        tags: ['phase-128'],
        status: 'active',
        instance_id: 'unit',
        created_at: '2026-05-13T08:00:00.000Z',
        updated_at: '2026-05-13T10:00:00.000Z',
      }],
    };
    vi.mocked(parseDocMeta).mockResolvedValue({
      relativePath: 'phase-128.md',
      title: 'Phase 128 Doc',
      tags: ['phase-128'],
      status: 'active',
      fqcId: 'doc-id',
      modified: '2026-05-13T10:00:00.000Z',
      size: { chars: 128 },
    });
    vi.mocked(pluginManager.getAllEntries).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('documents the call_macro removal gate in metadata', () => {
    const metadata = getToolMetadata('get_briefing');

    expect(metadata?.status).toBe('transitional');
    expect(metadata?.description).toContain('call_macro');
  });

  it('returns tag-group arrays with discriminated identification items by default', async () => {
    const handler = captureGetBriefing(makeConfig());
    const result = await handler({ tags: ['phase-128'], limit: 5 });
    const payload = parseText(result) as { groups: Array<{ items: Array<Record<string, unknown>> }> };

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      entity_types: ['documents', 'memories'],
      groups: [{
        type: 'tag',
        tag: 'phase-128',
        items: expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'document',
            identifier: 'phase-128.md',
            fq_id: 'doc-id',
            modified: '2026-05-13T10:00:00.000Z',
            size: { chars: 128 },
          }),
          expect.objectContaining({
            entity_type: 'memory',
            memory_id: 'memory-id',
            plugin_scope: 'global',
            created_at: '2026-05-13T09:00:00.000Z',
            updated_at: '2026-05-13T10:00:00.000Z',
          }),
        ]),
      }],
    });
  });

  it('returns unsupported when only memories are requested and memory tools are disabled', async () => {
    const handler = captureGetBriefing(makeConfig(['category:doc-read']));
    const result = await handler({ tags: ['phase-128'], entity_types: ['memories'] });

    expect(result.isError).toBe(false);
    expect(parseText(result)).toMatchObject({
      error: 'unsupported',
      identifier: 'memories',
      details: { disabled_entity_types: ['memories'] },
    });
  });

  it('warns and returns documents only when mixed request includes disabled memory', async () => {
    const handler = captureGetBriefing(makeConfig(['category:doc-read']));
    const result = await handler({ tags: ['phase-128'], entity_types: ['documents', 'memories'] });
    const payload = parseText(result) as { groups: Array<{ items: Array<Record<string, unknown>> }> };

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      entity_types: ['documents'],
      warnings: ['memory_category_disabled'],
    });
    expect(payload.groups[0].items).toEqual([
      expect.objectContaining({ entity_type: 'document', fq_id: 'doc-id' }),
    ]);
  });

  it('warns when records are requested but no plugin table is taggable', async () => {
    vi.mocked(pluginManager.getAllEntries).mockReturnValue([{
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqc_',
      schema: { tables: [{ name: 'contacts', columns: [{ name: 'name' }] }] },
    } as never]);
    const handler = captureGetBriefing(makeConfig(['category:plugin']));
    const result = await handler({ tags: ['phase-128'], entity_types: ['records'] });

    expect(result.isError).not.toBe(true);
    expect(parseText(result)).toMatchObject({
      entity_types: ['records'],
      warnings: ['plugin_no_taggable_tables'],
      groups: [{ type: 'tag', tag: 'phase-128', items: [] }],
    });
  });
});
