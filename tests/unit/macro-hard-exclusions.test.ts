import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { preScanToolReferences } from '../../src/macro/permission-prescan.js';
import { buildToolRegistry } from '../../src/macro/registry.js';
import type { ToolFn, ToolRegistry } from '../../src/macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { parseProgram } from './macro-test-helpers.js';

function parseEnvelope(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function registry(): ToolRegistry {
  const noop: ToolFn = vi.fn(async () => ({ ok: true }));
  return {
    fq: {
      label: 'FlashQuery',
      tools: {
        search: noop,
        call_model: noop,
      },
    },
    templates: {
      label: 'Template Tools',
      tools: {
        flashquery_template_brief: noop,
      },
    },
  };
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Hard Exclusions Test',
      id: 'macro-hard-exclusions-test',
      vault: { path: '/tmp/macro-hard-exclusions-test', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://postgres:test@localhost:5432/postgres',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: { tools: ['search', 'call_model'] },
    llm: {
      providers: [],
      models: [],
      purposes: [
        {
          name: 'research',
          description: 'Research purpose',
          models: [],
          tools: ['search', 'call_model'],
        },
      ],
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as FlashQueryConfig;
}

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-hard-exclusions-test',
  };
}

const catalog: NativeToolDefinition[] = [
  {
    name: 'search',
    description: 'search',
    inputSchema: z.object({}),
    handler: vi.fn(),
  },
  {
    name: 'call_model',
    description: 'model',
    inputSchema: z.object({}),
    handler: vi.fn(),
  },
];

describe('macro hard exclusions', () => {
  it('T-U-165 reports fq.call_macro as unknown_tool for every macro caller', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_macro({ source: "exit 1" })'),
      registry: registry(),
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'unknown_tool',
      details: {
        server: 'fq',
        tool: 'call_macro',
      },
    });
  });

  it('T-U-166 reports template masquerade references with template_masquerade_tools_not_callable_from_macro', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit templates.flashquery_template_brief({ topic: "dispatch" })'),
      registry: registry(),
      allowlist: new Set(['templates.flashquery_template_brief']),
      templateToolNames: new Set(['flashquery_template_brief']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'template_masquerade_tools_not_callable_from_macro',
      details: {
        server: 'templates',
        tool: 'flashquery_template_brief',
      },
    });
  });

  it('T-U-167 allows host fq.call_model when resolveHostToolExposure exposes it', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_model({ resolver: "purpose", name: "research" })'),
      registry: registry(),
      allowlist: new Set(['fq.call_model']),
      callerContext: { origin: 'host' },
    });

    expect(result).toBeUndefined();
  });

  it('T-U-168 rejects delegated fq.call_model with recursive_model_excluded_from_delegated_macros', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_model({ resolver: "purpose", name: "research" })'),
      registry: registry(),
      allowlist: new Set(['fq.search']),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      hardExcludedReasons: new Map([
        ['fq.call_model', 'recursive_model_excluded_from_delegated_macros'],
      ]),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.call_model'],
        reason: 'recursive_model_excluded_from_delegated_macros',
      },
    });
  });

  it('T-U-168 rejects delegated fq.call_model when production registry omits the hard-excluded handler', async () => {
    const built = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      broker: new NullMcpBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(built.registry.fq.tools.call_model).toBeUndefined();

    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_model({ resolver: "purpose", name: "research" })'),
      registry: built.registry,
      allowlist: new Set(built.allowedToolNames),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      hardExcludedReasons: built.hardExcludedReasons,
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.call_model'],
        reason: 'recursive_model_excluded_from_delegated_macros',
      },
    });
  });

  it('T-U-166 rejects templateReverseMap names from production registry metadata', async () => {
    const built = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker: new NullMcpBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      templateReverseMap: new Map([['flashquery_template_brief', 'Templates/Brief.md']]),
    });

    const result = preScanToolReferences({
      program: parseProgram('exit templates.flashquery_template_brief({ topic: "dispatch" })'),
      registry: {
        ...built.registry,
        templates: {
          label: 'Template Tools',
          tools: {
            flashquery_template_brief: vi.fn(async () => null),
          },
        },
      },
      allowlist: new Set(['templates.flashquery_template_brief']),
      templateToolNames: built.templateToolNames,
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'template_masquerade_tools_not_callable_from_macro',
      details: {
        server: 'templates',
        tool: 'flashquery_template_brief',
      },
    });
  });
});
