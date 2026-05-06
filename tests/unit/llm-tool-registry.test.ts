import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  HARD_EXCLUDED_NATIVE_TOOLS,
  TOOL_TIERS,
  assembleNativeToolRegistry,
  normalizeToolJsonSchema,
  toOpenAiToolDefinition,
  validateAndCacheNativeToolSchemas,
  type NativeToolDefinition,
} from '../../src/llm/tool-registry.js';
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { registerPendingReviewTools } from '../../src/mcp/tools/pending-review.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { registerLlmTools } from '../../src/mcp/tools/llm.js';
import { registerLlmUsageTools } from '../../src/mcp/tools/llm-usage.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const READ_ONLY_TOOLS = [
  'search_documents',
  'get_document',
  'search_memory',
  'get_memory',
  'list_memories',
  'search_records',
  'get_record',
  'search_all',
  'get_briefing',
];

const READ_WRITE_EXTRA_TOOLS = [
  'create_document',
  'update_document',
  'append_to_doc',
  'move_document',
  'save_memory',
  'update_memory',
  'create_record',
  'update_record',
  'apply_tags',
  'archive_document',
  'archive_memory',
  'archive_record',
  'create_directory',
  'remove_directory',
];

const HARD_EXCLUDED_TOOLS = [
  'call_model',
  'register_plugin',
  'unregister_plugin',
  'get_plugin_info',
];

const ALL_CATALOG_TOOL_NAMES = [
  ...READ_ONLY_TOOLS,
  ...READ_WRITE_EXTRA_TOOLS,
  ...HARD_EXCLUDED_TOOLS,
  'custom_native_tool',
];

const noopNativeHandler: NativeToolDefinition['handler'] = async () => ({
  content: [{ type: 'text', text: 'ok' }],
});

const CATALOG: NativeToolDefinition[] = ALL_CATALOG_TOOL_NAMES.map((name) => ({
  name,
  description: `${name} description`,
  inputSchema: {},
  handler: noopNativeHandler,
}));

function makeCatalogServer(): McpServer {
  return wrapServerWithToolCatalog({
    registerTool: () => undefined,
  } as unknown as McpServer);
}

function registerAllNativeTools(server: McpServer, config: FlashQueryConfig): void {
  registerMemoryTools(server, config);
  registerDocumentTools(server, config);
  registerPluginTools(server, config);
  registerRecordTools(server, config);
  registerCompoundTools(server, config);
  registerScanTools(server, config);
  registerPendingReviewTools(server, config);
  registerFileTools(server, config);
  registerLlmTools(server, config);
  registerLlmUsageTools(server, config);
}

function makeConfig(tools?: string[], excludedTools?: string[]): FlashQueryConfig {
  return {
    instance: {
      name: 'Test FlashQuery',
      id: 'test',
      vault: {
        path: '/tmp/test-vault',
        markdownExtensions: ['.md'],
      },
    },
    server: {
      host: 'localhost',
      port: 3100,
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://postgres:test@localhost:5432/postgres',
    },
    git: {
      autoCommit: false,
      autoPush: false,
      remote: 'origin',
      branch: 'main',
    },
    embedding: {
      provider: 'none',
      model: '',
      dimensions: 1536,
    },
    logging: {
      level: 'info',
      output: 'stdout',
    },
    llm: {
      providers: [],
      models: [],
      purposes: [
        {
          name: 'Research',
          description: 'Research purpose',
          models: [],
          ...(tools === undefined ? {} : { tools }),
          ...(excludedTools === undefined ? {} : { excludedTools }),
        },
      ],
    },
  };
}

describe('TOOL_TIERS', () => {
  it('captures native tool handlers while preserving SDK registration behavior', async () => {
    const originalRegisterTool = vi.fn();
    const server = wrapServerWithToolCatalog({
      registerTool: originalRegisterTool,
    } as unknown as McpServer);
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const inputSchema = { identifier: z.string() };
    const signal = new AbortController().signal;

    server.registerTool(
      'get_document',
      {
        description: 'Get document',
        inputSchema,
      },
      handler as never
    );

    const catalog = getNativeToolCatalog(server);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: 'get_document',
      description: 'Get document',
      inputSchema,
    });
    expect(catalog[0].handler).toEqual(expect.any(Function));
    expect(originalRegisterTool).toHaveBeenCalledWith(
      'get_document',
      { description: 'Get document', inputSchema },
      handler
    );

    await catalog[0].handler(
      { identifier: 'Research/ATL.md' },
      {
        signal,
        traceId: 'trace-handler',
        instanceId: 'instance-handler',
        logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        logContext: { request_id: 'req-handler' },
      }
    );

    expect(handler).toHaveBeenCalledWith(
      { identifier: 'Research/ATL.md' },
      expect.objectContaining({
        signal,
        traceId: 'trace-handler',
        instanceId: 'instance-handler',
      })
    );
  });

  it('defines the exact tier:read-only native tool allowlist', () => {
    expect(TOOL_TIERS['tier:read-only']).toEqual(READ_ONLY_TOOLS);
  });

  it('defines tier:read-write as read-only plus write-capable native tools', () => {
    expect(TOOL_TIERS['tier:read-write']).toEqual([...READ_ONLY_TOOLS, ...READ_WRITE_EXTRA_TOOLS]);
  });

  it('contains only currently registered native MCP tools', () => {
    const server = makeCatalogServer();
    registerAllNativeTools(server, makeConfig());
    const catalog = getNativeToolCatalog(server);
    validateAndCacheNativeToolSchemas(catalog);
    const catalogNames = new Set(catalog.map((tool) => tool.name));

    for (const toolName of Object.values(TOOL_TIERS).flat()) {
      expect(catalogNames.has(toolName), `${toolName} must be registered before it can appear in a tier`).toBe(true);
    }
    expect(catalogNames.has('get_doc_outline')).toBe(false);
    expect(catalog.every((tool) => tool.openAiStrict && tool.openAiNonStrict)).toBe(true);
  });
});

describe('assembleNativeToolRegistry', () => {
  it('returns stable empty native diagnostics when a purpose declares no native tools', () => {
    const result = assembleNativeToolRegistry(makeConfig(), 'research', CATALOG);

    expect(result.nativeToolNames).toEqual([]);
    expect(result.providerTools).toBeUndefined();
    expect(result.diagnostics).toEqual({
      expandedTiers: [],
      explicitTools: [],
      excluded: [],
      hardExcluded: [],
      unknown: [],
    });
  });

  it('expands tier:read-only to read-safe native tools', () => {
    const result = assembleNativeToolRegistry(makeConfig(['tier:read-only']), 'research', CATALOG);

    expect(result.nativeToolNames).toEqual(READ_ONLY_TOOLS);
    expect(result.providerTools?.map((tool) => tool.function.name)).toEqual(READ_ONLY_TOOLS);
    expect(result.diagnostics).toEqual({
      expandedTiers: [{ tier: 'tier:read-only', tools: READ_ONLY_TOOLS }],
      explicitTools: [],
      excluded: [],
      hardExcluded: [],
      unknown: [],
    });
  });

  it('expands tier:read-write to read-only and write-capable native tools', () => {
    const result = assembleNativeToolRegistry(makeConfig(['tier:read-write']), 'research', CATALOG);

    expect(result.nativeToolNames).toEqual([...READ_ONLY_TOOLS, ...READ_WRITE_EXTRA_TOOLS]);
    expect(result.diagnostics.expandedTiers).toEqual([
      { tier: 'tier:read-write', tools: [...READ_ONLY_TOOLS, ...READ_WRITE_EXTRA_TOOLS] },
    ]);
  });

  it('unions explicit named tools with tiers, ignores duplicates, and preserves deterministic order', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['custom_native_tool', 'tier:read-only', 'get_document', 'custom_native_tool']),
      'research',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual(['custom_native_tool', ...READ_ONLY_TOOLS]);
    expect(result.diagnostics.explicitTools).toEqual(['custom_native_tool', 'get_document']);
  });

  it('applies excludedTools after tier and named expansion', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-only', 'custom_native_tool'], ['get_memory', 'search_all', 'custom_native_tool']),
      'research',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual([
      'search_documents',
      'get_document',
      'search_memory',
      'list_memories',
      'search_records',
      'get_record',
      'get_briefing',
    ]);
    expect(result.diagnostics.excluded).toEqual(['get_memory', 'search_all', 'custom_native_tool']);
  });

  it('removes hard-excluded native tools and reports exact diagnostics', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-only', 'call_model', 'register_plugin', 'unregister_plugin', 'get_plugin_info']),
      'research',
      CATALOG
    );

    expect(HARD_EXCLUDED_NATIVE_TOOLS).toEqual(HARD_EXCLUDED_TOOLS);
    expect(result.nativeToolNames).toEqual(READ_ONLY_TOOLS);
    expect(result.nativeToolNames).not.toContain('call_model');
    expect(result.nativeToolNames).not.toContain('register_plugin');
    expect(result.nativeToolNames).not.toContain('unregister_plugin');
    expect(result.nativeToolNames).not.toContain('get_plugin_info');
    expect(result.diagnostics.hardExcluded).toEqual([
      { tool: 'call_model', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'register_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'unregister_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'get_plugin_info', reason: 'Tool is not safe for delegated model-visible native access.' },
    ]);
  });

  it('returns an exact empty result when all requested tools are excluded', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['search_documents', 'get_document'], ['search_documents', 'get_document']),
      'research',
      CATALOG
    );

    expect(result).toEqual({
      nativeToolNames: [],
      providerTools: undefined,
      diagnostics: {
        expandedTiers: [],
        explicitTools: ['search_documents', 'get_document'],
        excluded: ['search_documents', 'get_document'],
        hardExcluded: [],
        unknown: [],
      },
    });
  });

  it('omits providerTools when hard-excluded catalog entries are requested', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['call_model', 'register_plugin', 'unregister_plugin', 'get_plugin_info']),
      'research',
      CATALOG,
      { strictTools: true }
    );

    expect(result.nativeToolNames).toEqual([]);
    expect(result.providerTools).toBeUndefined();
    expect(result.diagnostics.hardExcluded).toEqual([
      { tool: 'call_model', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'register_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'unregister_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
      { tool: 'get_plugin_info', reason: 'Tool is not safe for delegated model-visible native access.' },
    ]);
  });

  it('assembles strict OpenAI provider tools from catalog schemas', () => {
    const schema = z.object({
      query: z.string().describe('Search query'),
      tags: z.array(z.string()).optional().describe('Optional tags'),
      mode: z.enum(['fast', 'deep']),
      nested: z.object({
        path: z.string(),
      }),
    });
    const catalog: NativeToolDefinition[] = [
      {
        name: 'search_documents',
        description: 'Search documents',
        inputSchema: schema,
        handler: noopNativeHandler,
      },
    ];

    const result = assembleNativeToolRegistry(makeConfig(['search_documents']), 'research', catalog, {
      strictTools: true,
    });

    expect(result.providerTools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_documents',
          description: 'Search documents',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags',
              },
              mode: { type: 'string', enum: ['fast', 'deep'] },
              nested: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                },
                required: ['path'],
                additionalProperties: false,
              },
            },
            required: ['query', 'tags', 'mode', 'nested'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    ]);
  });
});

describe('toOpenAiToolDefinition', () => {
  it('wraps raw MCP inputSchema shapes before JSON Schema conversion', () => {
    const tool = toOpenAiToolDefinition(
      {
        name: 'save_memory',
        description: 'Save memory',
        inputSchema: {
          content: z.string().describe('Memory content'),
          tags: z.array(z.string()).optional(),
        },
      },
      { strict: false }
    );

    expect(tool).toEqual({
      type: 'function',
      function: {
        name: 'save_memory',
        description: 'Save memory',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['content'],
          additionalProperties: false,
        },
      },
    });
  });

  it('converts z.object inputSchema values directly and omits strict in non-strict mode', () => {
    const tool = toOpenAiToolDefinition(
      {
        name: 'get_document',
        description: 'Get document',
        inputSchema: z.object({
          identifier: z.string(),
          include: z.array(z.enum(['body', 'frontmatter'])).optional(),
        }),
      },
      { strict: false }
    );

    expect(tool).toEqual({
      type: 'function',
      function: {
        name: 'get_document',
        description: 'Get document',
        parameters: {
          type: 'object',
          properties: {
            identifier: { type: 'string' },
            include: {
              type: 'array',
              items: { type: 'string', enum: ['body', 'frontmatter'] },
            },
          },
          required: ['identifier'],
          additionalProperties: false,
        },
      },
    });
    expect(tool.function).not.toHaveProperty('strict');
  });

  it('sets strict mode and normalizes every object to disallow additional properties', () => {
    const tool = toOpenAiToolDefinition(
      {
        name: 'search_documents',
        description: 'Search documents',
        inputSchema: z.object({
          query: z.string(),
          filters: z
            .object({
              tags: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      },
      { strict: true }
    );

    expect(tool.function.strict).toBe(true);
    expect(tool.function.parameters).toMatchObject({
      additionalProperties: false,
      required: ['query', 'filters'],
      properties: {
        filters: {
          additionalProperties: false,
          required: ['tags'],
        },
      },
    });
  });
});

describe('validateAndCacheNativeToolSchemas', () => {
  it('precomputes strict and non-strict OpenAI definitions for native tools', () => {
    const catalog: NativeToolDefinition[] = [
      {
        name: 'search_documents',
        description: 'Search documents',
        inputSchema: { query: z.string() },
        handler: noopNativeHandler,
      },
    ];

    validateAndCacheNativeToolSchemas(catalog);

    expect(catalog[0].openAiNonStrict?.function.strict).toBeUndefined();
    expect(catalog[0].openAiStrict?.function.strict).toBe(true);
    expect(catalog[0].openAiStrict?.function.parameters).toMatchObject({
      additionalProperties: false,
      required: ['query'],
    });
  });

  it('fails startup validation with the offending native tool name for untranslatable schemas', () => {
    const catalog: NativeToolDefinition[] = [
      {
        name: 'bad_native_tool',
        description: 'Bad native tool',
        inputSchema: z.string(),
        handler: noopNativeHandler,
      },
    ];

    expect(() => validateAndCacheNativeToolSchemas(catalog)).toThrow(
      /Config error: \[native-tool\] tool 'bad_native_tool' schema translation failed/
    );
  });

  it('fails startup validation when a native tool uses the reserved template prefix', () => {
    const catalog: NativeToolDefinition[] = [
      {
        name: 'flashquery_diagnostics',
        description: 'Reserved-prefix native tool',
        inputSchema: {},
        handler: noopNativeHandler,
      },
    ];

    expect(() => validateAndCacheNativeToolSchemas(catalog)).toThrow(
      /Config error: \[native-tool\] tool 'flashquery_diagnostics' uses the reserved 'flashquery_' prefix/
    );
  });
});

describe('normalizeToolJsonSchema', () => {
  it('requires every root property in strict mode', () => {
    const normalized = normalizeToolJsonSchema(
      {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
      },
      { strict: true }
    );

    expect(normalized).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['query', 'tags'],
      additionalProperties: false,
    });
  });
});

describe('ATL-U-15 combined provider-visible registry contracts', () => {
  it('keeps native and template provider tools in one final registry and reports collisions by final function name', async () => {
    const module = await import('../../src/llm/template-tools.js') as {
      mergeModelVisibleToolRegistries: (input: Record<string, unknown>) => {
        providerTools?: Array<{ function: { name: string } }>;
        collisions: Array<Record<string, unknown>>;
      };
    };
    const native = assembleNativeToolRegistry(makeConfig(['get_document']), 'research', CATALOG);
    const merged = module.mergeModelVisibleToolRegistries({
      native,
      template: {
        providerTools: [
          { type: 'function', function: { name: 'flashquery_skill_research_skill', description: 'Research', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'get_document', description: 'Conflicting template', parameters: { type: 'object', properties: {} } } },
        ],
        templateTools: [
          { name: 'flashquery_skill_research_skill', template_path: 'Templates/Research-Skill.md' },
          { name: 'get_document', template_path: 'Templates/Get Document.md' },
        ],
      },
    });

    expect(merged.providerTools?.map((tool) => tool.function.name)).toEqual([
      'get_document',
      'flashquery_skill_research_skill',
      'get_document',
    ]);
    expect(merged.collisions).toEqual([
      expect.objectContaining({
        name: 'get_document',
        template_paths: ['Templates/Get Document.md'],
      }),
    ]);
  });
});
