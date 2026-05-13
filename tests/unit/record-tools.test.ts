import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
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
    locking: { enabled: false, ttlSeconds: 30 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

describe('record tools final surface', () => {
  it('registers current record tools and omits removed legacy handlers', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
    } as unknown as McpServer;

    registerRecordTools(server, makeConfig());

    expect(names).toEqual(expect.arrayContaining([
      'write_record',
      'get_record',
      'archive_record',
      'search_records',
    ]));
    expect(names).not.toContain('create_record');
    expect(names).not.toContain('update_record');
  });
});
