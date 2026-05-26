import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
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

describe('memory search/list final surface', () => {
  it('registers search-capable final memory tools without legacy memory names', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => {
        names.push(name);
      }),
    } as unknown as McpServer;

    registerMemoryTools(server, makeConfig());

    expect(names).toEqual(expect.arrayContaining(['write_memory', 'get_memory', 'archive_memory']));
    expect(names).not.toContain('save_memory');
    expect(names).not.toContain('update_memory');
    expect(names).not.toContain('search_memory');
    expect(names).not.toContain('list_memories');
  });
});
