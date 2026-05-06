import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  HARD_EXCLUDED_NATIVE_TOOLS,
  TOOL_TIERS,
  assembleNativeToolRegistry,
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
});
