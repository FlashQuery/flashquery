import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { assembleNativeToolRegistry } from '../../src/llm/tool-registry.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { getNativeToolCatalog, registerUncatalogedTool, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';

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

  it('injects optional boolean help into native catalog schemas', () => {
    const config = makeConfig();
    const server = createMcpServer(config, 'test');
    const catalog = getNativeToolCatalog(server);
    const getDocument = catalog.find((tool) => tool.name === 'get_document');

    expect(getDocument).toBeDefined();
    const schema = getDocument?.inputSchema as Record<string, unknown> | undefined;
    expect(schema).toHaveProperty('help');
    expect((schema?.help as z.ZodType).safeParse(true).success).toBe(true);
    expect((schema?.help as z.ZodType).safeParse('true').success).toBe(false);
  });

  it('does not inject native help schema into uncataloged brokered tool registrations', () => {
    const registered: Array<{ name: string; config: { inputSchema?: Record<string, unknown> } }> = [];
    const server = wrapServerWithToolCatalog({
      registerTool: vi.fn((name: string, config: { inputSchema?: Record<string, unknown> }) => {
        registered.push({ name, config });
        return undefined;
      }),
    } as unknown as Parameters<typeof wrapServerWithToolCatalog>[0]);

    registerUncatalogedTool(
      server,
      'upstream__remote_tool',
      { inputSchema: { value: z.string() } },
      vi.fn()
    );

    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe('upstream__remote_tool');
    expect(registered[0].config.inputSchema).toHaveProperty('value');
    expect(registered[0].config.inputSchema).not.toHaveProperty('help');
    expect(getNativeToolCatalog(server).map((tool) => tool.name)).not.toContain('upstream__remote_tool');
  });
});
