import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  assembleNativeToolRegistry,
  type NativeToolDefinition,
} from '../../src/llm/tool-registry.js';

const noopNativeHandler: NativeToolDefinition['handler'] = async () => ({
  content: [{ type: 'text', text: 'ok' }],
});

const FINAL_CATALOG_TOOL_NAMES = [
  'get_document',
  'list_vault',
  'copy_document',
  'move_document',
  'archive_document',
  'remove_document',
  'insert_in_doc',
  'replace_doc_section',
  'apply_tags',
  'get_briefing',
  'insert_doc_link',
  'write_document',
  'search',
  'get_memory',
  'archive_memory',
  'write_memory',
  'write_record',
  'get_record',
  'archive_record',
  'search_records',
  'manage_directory',
  'call_model',
  'maintain_vault',
  'get_llm_usage',
];

const CATALOG: NativeToolDefinition[] = FINAL_CATALOG_TOOL_NAMES.map((name) => ({
  name,
  description: `${name} description`,
  inputSchema: {},
  handler: noopNativeHandler,
}));

function makeConfig(tools: string[], excludedTools: string[] = []): FlashQueryConfig {
  return {
    instance: {
      name: 'Tool Registry Integration',
      id: 'tool-registry-integration',
      vault: {
        path: '/tmp/fqc-tool-registry-integration-vault',
        markdownExtensions: ['.md'],
      },
    },
    server: {
      host: 'localhost',
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
          name: 'registry-check',
          description: 'Registry integration purpose',
          models: [],
          tools,
          excludedTools,
        },
      ],
    },
  };
}

describe('delegated native tool registry tier assembly (Integration)', () => {
  it('I-tier-1 expands purpose tools: ["tier:read-only"] through metadata and includes list_vault', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-only']),
      'registry-check',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual(expect.arrayContaining([
      'get_document',
      'list_vault',
      'search',
    ]));
    expect(result.nativeToolNames).not.toEqual(expect.arrayContaining([
      'get_llm_usage',
      'call_model',
      'maintain_vault',
    ]));
    expect(result.diagnostics.expandedTiers).toEqual([
      { tier: 'tier:read-only', tools: expect.arrayContaining(['list_vault']) },
    ]);
  });

  it('I-tier-2 expands purpose tools: ["tier:read-write"] and includes corrected document write tools', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-write']),
      'registry-check',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual(expect.arrayContaining([
      'list_vault',
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(result.nativeToolNames).not.toEqual(expect.arrayContaining([
      'get_llm_usage',
      'call_model',
      'maintain_vault',
    ]));
    expect(result.diagnostics.expandedTiers).toEqual([
      {
        tier: 'tier:read-write',
        tools: expect.arrayContaining(['copy_document', 'insert_in_doc', 'replace_doc_section']),
      },
    ]);
  });

  it('I-tier-3 applies per-purpose excludedTools after read-write tier expansion', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-write'], ['insert_in_doc']),
      'registry-check',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual(expect.arrayContaining([
      'copy_document',
      'replace_doc_section',
    ]));
    expect(result.nativeToolNames).not.toContain('insert_in_doc');
    expect(result.diagnostics.excluded).toEqual(['insert_in_doc']);
  });

  it('I-tier-4 keeps call_model hard-excluded even when explicitly requested', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['tier:read-write', 'call_model']),
      'registry-check',
      CATALOG
    );

    expect(result.nativeToolNames).not.toContain('call_model');
    expect(result.diagnostics.hardExcluded).toEqual([
      { tool: 'call_model', reason: 'Tool can recursively call models and is not safe for delegated native access.' },
    ]);
  });

  it('I-tier-5 preserves delegatedHardExcludedReason for explicit maintain_vault requests', () => {
    const result = assembleNativeToolRegistry(
      makeConfig(['maintain_vault']),
      'registry-check',
      CATALOG
    );

    expect(result.nativeToolNames).toEqual([]);
    expect(result.providerTools).toBeUndefined();
    expect(result.diagnostics.explicitTools).toEqual(['maintain_vault']);
    expect(result.diagnostics.hardExcluded).toEqual([
      { tool: 'maintain_vault', reason: 'Tool performs administrative maintenance and is not safe for delegated native access.' },
    ]);
  });
});
