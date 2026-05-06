import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  HARD_EXCLUDED_NATIVE_TOOLS,
  TOOL_TIERS,
  assembleNativeToolRegistry,
  normalizeToolJsonSchema,
  toOpenAiToolDefinition,
  type NativeToolDefinition,
} from '../../src/llm/tool-registry.js';

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

const CATALOG: NativeToolDefinition[] = ALL_CATALOG_TOOL_NAMES.map((name) => ({
  name,
  description: `${name} description`,
  inputSchema: {},
}));

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
  it('defines the exact tier:read-only native tool allowlist', () => {
    expect(TOOL_TIERS['tier:read-only']).toEqual(READ_ONLY_TOOLS);
  });

  it('defines tier:read-write as read-only plus write-capable native tools', () => {
    expect(TOOL_TIERS['tier:read-write']).toEqual([...READ_ONLY_TOOLS, ...READ_WRITE_EXTRA_TOOLS]);
  });
});

describe('assembleNativeToolRegistry', () => {
  it('expands tier:read-only to read-safe native tools', () => {
    const result = assembleNativeToolRegistry(makeConfig(['tier:read-only']), 'research', CATALOG);

    expect(result.nativeToolNames).toEqual(READ_ONLY_TOOLS);
    expect(result.providerTools).toBeUndefined();
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
