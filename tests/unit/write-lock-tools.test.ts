import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
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
    locking: { enabled: true, ttlSeconds: 30 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

describe('write-lock final tool coverage', () => {
  it('registers lock-relevant final write tools without removed legacy names', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
    } as unknown as McpServer;

    const config = makeConfig();
    registerDocumentTools(server, config);
    registerMemoryTools(server, config);
    registerRecordTools(server, config);

    expect(names).toEqual(expect.arrayContaining([
      'write_document',
      'remove_document',
      'write_memory',
      'archive_memory',
      'write_record',
      'archive_record',
    ]));
    expect(names).not.toContain('create_document');
    expect(names).not.toContain('update_document');
    expect(names).not.toContain('save_memory');
    expect(names).not.toContain('update_memory');
    expect(names).not.toContain('create_record');
    expect(names).not.toContain('update_record');
  });
});
