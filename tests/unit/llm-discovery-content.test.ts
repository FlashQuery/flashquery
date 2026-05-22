import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const queryCount = vi.hoisted(() => ({ value: 0 }));
const indexedRows = vi.hoisted(() => ({
  value: [{
    path: 'Templates/Research.md',
    template_meta: {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'template',
      fq_desc: 'Reusable research template',
      fq_params: {},
    },
  }],
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/storage/supabase.js', () => {
  function makeQuery() {
    const query = {
      eq: vi.fn(() => query),
      filter: vi.fn(() => {
        queryCount.value += 1;
        return Promise.resolve({
          data: [{
            path: 'Templates/Research.md',
            template_meta: {
              fq_template: true,
              fq_expose_as_tool: true,
              fq_namespace: 'template',
              fq_desc: 'Reusable research template',
              fq_params: {},
            },
          }],
          error: null,
        });
      }),
      in: vi.fn(() => {
        queryCount.value += 1;
        return Promise.resolve({ data: indexedRows.value, error: null });
      }),
    };
    return query;
  }

  return {
    supabaseManager: {
      getClient: vi.fn(() => ({
        from: vi.fn(() => ({
          select: vi.fn(() => makeQuery()),
        })),
      })),
    },
  };
});

function makeConfig(defaultAccess: 'permissive' | 'restrictive' = 'permissive'): FlashQueryConfig {
  return {
    instance: {
      id: 'discovery-content-unit',
      name: 'Discovery Content Unit',
      vault: { path: '/tmp/fqc-discovery-content-unit', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgres://postgres:postgres@localhost:54322/postgres',
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    templates: { defaultAccess },
    llm: {
      providers: [{ name: 'mock', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1' }],
      models: [{
        name: 'tool-model',
        providerName: 'mock',
        model: 'tool-model',
        type: 'language',
        costPerMillion: { input: 0, output: 0 },
        capabilities: { tool_calling: true },
      }],
      purposes: [
        { name: 'alpha', description: 'Alpha', models: ['tool-model'], templates: ['Templates/Research.md'] },
        { name: 'beta', description: 'Beta', models: ['tool-model'] },
      ],
    },
  };
}

describe('buildListPurposesContent', () => {
  beforeEach(() => {
    queryCount.value = 0;
    indexedRows.value = [{
      path: 'Templates/Research.md',
      template_meta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'template',
        fq_desc: 'Reusable research template',
        fq_params: {},
      },
    }];
    vi.clearAllMocks();
  });

  it('shares the permissive template candidate index query across all purposes and top-level template_tools', async () => {
    const { buildListPurposesContent } = await import('../../src/llm/discovery-content.js');

    const content = await buildListPurposesContent({
      config: makeConfig(),
      nativeToolCatalog: [],
      runtimeTemplateBindings: [],
    });

    expect(queryCount.value).toBe(1);
    expect(content.template_tools).toEqual([
      expect.objectContaining({ name: 'flashquery_template_research' }),
    ]);
    for (const purpose of content.purposes as Array<Record<string, unknown>>) {
      expect(purpose).not.toHaveProperty('template_tools');
      expect(purpose.template_tool_warnings).toEqual([]);
    }
  });

  it('keeps restrictive template_tools per purpose on the index-backed path', async () => {
    const { buildListPurposesContent } = await import('../../src/llm/discovery-content.js');

    const content = await buildListPurposesContent({
      config: makeConfig('restrictive'),
      nativeToolCatalog: [],
      runtimeTemplateBindings: [],
    });

    expect(queryCount.value).toBe(1);
    expect(content).not.toHaveProperty('template_tools');
    const purposes = content.purposes as Array<Record<string, unknown>>;
    expect(purposes.find((purpose) => purpose.name === 'alpha')?.template_tools).toEqual([
      expect.objectContaining({ name: 'flashquery_template_research' }),
    ]);
    expect(purposes.find((purpose) => purpose.name === 'beta')?.template_tools).toEqual([]);
  });
});
