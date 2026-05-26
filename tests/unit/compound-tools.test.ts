import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { getToolMetadata } from '../../src/mcp/tool-metadata.js';

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

describe('compound tool registration final surface', () => {
  it('keeps transitional tools and removes merged document/search tools', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => {
        names.push(name);
      }),
    } as unknown as McpServer;

    registerCompoundTools(server, makeConfig());

    expect(names).toEqual(expect.arrayContaining(['insert_doc_link', 'get_briefing']));
    expect(names).not.toContain('append_to_doc');
    expect(names).not.toContain('update_doc_header');
    expect(names).not.toContain('search_all');
  });

  it('marks transitional helpers as call_macro-gated and structured', () => {
    const briefing = getToolMetadata('get_briefing');
    const insertLink = getToolMetadata('insert_doc_link');

    expect(briefing?.status).toBe('transitional');
    expect(insertLink?.status).toBe('transitional');
    expect(briefing?.description).toContain('call_macro');
    expect(insertLink?.description).toContain('call_macro');
    expect(insertLink?.description).not.toContain('identifier({})');
  });
});
