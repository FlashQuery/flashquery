import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { assembleNativeToolRegistry } from '../../src/llm/tool-registry.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { getNativeToolCatalog } from '../../src/mcp/tool-catalog.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Native Tool Catalog Unit',
      id: 'native-tool-catalog-unit',
      vault: {
        path: '/tmp/fqc-native-tool-catalog-unit-vault',
        markdownExtensions: ['.md'],
      },
    },
    server: {
      host: 'localhost',
      port: 3100,
    },
    mcp: {
      transport: 'stdio',
      port: 3100,
    },
    supabase: {
      url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-key',
      databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54322/postgres',
    },
    git: {
      autoCommit: false,
      autoPush: false,
      remote: 'origin',
      branch: 'main',
    },
    trashFolder: {
      enabled: false,
      path: '.flashquery/removed',
      collisionStrategy: 'suffix',
    },
    embedding: {
      provider: 'none',
      model: '',
      dimensions: 1536,
    },
    logging: {
      level: 'info',
      output: 'stderr',
    },
    mcpServers: {},
    host: {
      mcpServers: [],
      toolSearch: 'disabled',
    },
    macro: {
      defaultTimeoutMs: 60000,
    },
    llm: {
      providers: [],
      models: [],
      purposes: [
        {
          name: 'delegated-tier-edit',
          description: 'Delegated tier edit purpose',
          models: [],
          tools: ['tier:read-write'],
        },
      ],
    },
  };
}

describe('native tool catalog capture', () => {
  it('assembles delegated tier tools from the real registered server catalog', () => {
    const config = makeConfig();
    const server = createMcpServer(config, 'test');
    const catalog = getNativeToolCatalog(server);
    const registry = assembleNativeToolRegistry(config, 'delegated-tier-edit', catalog);

    expect(catalog.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_vault',
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(registry.nativeToolNames).toEqual(expect.arrayContaining([
      'list_vault',
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(registry.diagnostics.unknown).not.toEqual(expect.arrayContaining([
      'insert_in_doc',
    ]));
  });

  it('T-U-044 uses .tool.md descriptions in the native catalog at startup', () => {
    const config = makeConfig();
    const server = createMcpServer(config, 'test');
    const catalog = getNativeToolCatalog(server);

    expect(catalog.find((tool) => tool.name === 'get_document')?.description).toBe(
      'Read one or more vault documents with include-gated bodies, frontmatter, headings, sections, and frontmatter references. Pass {help: true} for full help.'
    );
  });
});
