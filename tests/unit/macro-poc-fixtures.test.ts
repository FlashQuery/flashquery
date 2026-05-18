import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import type { BrokeredTool, McpBroker } from '../../src/services/mcp-broker.js';
import { parseToolPayload } from './macro-test-helpers.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/macro/poc-examples');

const EXPECTED_FIXTURE_COUNT = 17;

const FIXTURE_INPUTS: Record<string, Record<string, unknown>> = {
  '13-input-vars.fqm': {
    search_phrases: ['FlashQuery macro language', 'MCP local-first memory'],
    output_path: 'Research/web-output.md',
    hits_per_topic: 2,
  },
  '17-input-var-missing.fqm': {},
};

const EXPECTED_ERRORS: Record<string, string> = {
  '11-fail-missing-server.fqm': 'macro_aborted',
  '15-vault-jail.fqm': 'forbidden_path',
  '17-input-var-missing.fqm': 'invalid_input',
};

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro POC Fixture Test',
      id: 'macro-poc-fixture-test',
      vault: { path: join(FIXTURE_DIR, 'sample-vault'), markdownExtensions: ['.md'] },
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
    hostMcpTools: {
      tools: [
        'search',
        'get_document',
        'write_document',
        'archive_document',
        'manage_directory',
        'move_document',
        'apply_tags',
        'call_model',
      ],
    },
    llm: { providers: [], models: [], purposes: [] },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    macro: { defaultTimeoutMs: 10000 },
  } as FlashQueryConfig;
}

function jsonResponse(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

function brokeredTool(serverId: string, toolName: string): BrokeredTool {
  return {
    serverId,
    toolName,
    registryKey: `__${serverId}__${toolName}`,
    description: `${serverId}.${toolName} fixture stub`,
    inputSchema: {},
    tofuHash: `${serverId}-${toolName}-hash`,
    costPerCall: 0,
  };
}

function makeTool(name: string, value: unknown): NativeToolDefinition {
  return {
    name,
    description: `${name} fixture stub`,
    inputSchema: z.object({}).passthrough(),
    handler: vi.fn(async () => jsonResponse(value)),
  };
}

function makeCatalog(): NativeToolDefinition[] {
  return [
    makeTool('search', [
      { fq_id: 'doc_a', title: 'Doc A', path: 'Drafts/doc-a.md', url: 'vault://Drafts/doc-a.md' },
      { fq_id: 'doc_b', title: 'Doc B', path: 'Drafts/doc-b.md', url: 'vault://Drafts/doc-b.md' },
    ]),
    {
      name: 'get_document',
      description: 'get_document fixture stub',
      inputSchema: z.object({}).passthrough(),
      handler: vi.fn(async (args) => {
        if (args['identifiers'] === 'doc_does_not_exist') {
          return jsonResponse({ error: 'not_found', message: 'Document not found' });
        }
        return jsonResponse({
          fq_id: args['identifiers'] === 'doc_c' ? 'doc_c' : 'doc_a',
          title: args['identifiers'] === 'doc_c' ? 'Doc C' : 'Doc A',
          path: args['identifiers'] === 'doc_c' ? 'Drafts/doc-c.md' : 'Drafts/doc-a.md',
          frontmatter: { related_to: ['doc_b'] },
          body: 'Fixture document body',
        });
      }),
    },
    makeTool('write_document', { fq_id: 'written_doc', path: 'Notes/written.md' }),
    makeTool('archive_document', { archived: true, fq_id: 'doc_a' }),
    makeTool('manage_directory', { created: true, path: 'Research/AI' }),
    makeTool('move_document', { moved: true, path: 'Research/AI/doc-a.md' }),
    makeTool('apply_tags', { tagged: true }),
    makeTool('call_model', { response: '{"ready":"yes","reason":"fixture"}', ready: 'yes', reason: 'fixture' }),
  ];
}

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-poc-fixture-test',
    traceId: 'trace-macro-poc-fixture',
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: { test: 'macro-poc-fixtures' },
  };
}

function makeBroker(): McpBroker {
  return {
    ensureConnected: vi.fn(),
    isConnected: vi.fn(async (serverId: string) => ['brave_search', 'web_fetch'].includes(serverId)),
    callTool: vi.fn(async (ref) => {
      if (ref.serverId === 'brave_search' && ref.toolName === 'web_search') {
        return jsonResponse([
            {
              title: 'FlashQuery',
              url: 'https://example.test',
              description: 'Fixture search result',
            },
        ]);
      }
      if (ref.serverId === 'web_fetch' && ref.toolName === 'fetch') {
        return jsonResponse({
            content: '# Fixture page\nFlashQuery fixture content.',
            markdown: '# Fixture page\nFlashQuery fixture content.',
        });
      }
      if (ref.serverId === 'pretend_search' && ref.toolName === 'web_search') {
        return jsonResponse([]);
      }
      return { isError: true, content: [{ type: 'text' as const, text: 'unknown fixture broker tool' }] };
    }),
    listToolsForConsumer: vi.fn(async () => [
      brokeredTool('brave_search', 'web_search'),
      brokeredTool('web_fetch', 'fetch'),
      brokeredTool('pretend_search', 'web_search'),
    ]),
    shutdown: vi.fn(),
  };
}

async function fixtureFiles(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR);
  return entries.filter((entry) => entry.endsWith('.fqm')).sort();
}

describe('migrated macro POC fixtures', () => {
  it('loads all 17 migrated POC fixtures from the dedicated fixture directory', async () => {
    await expect(fixtureFiles()).resolves.toHaveLength(EXPECTED_FIXTURE_COUNT);
  });

  it('executes each migrated POC fixture through runMacroSource with fixture stubs', async () => {
    for (const fixture of await fixtureFiles()) {
      const source = await readFile(join(FIXTURE_DIR, fixture), 'utf8');
      const result = await runMacroSource({
        source,
        sourceIdentifier: fixture,
        config: makeConfig(),
        catalog: makeCatalog(),
        broker: makeBroker(),
        brokerTools: [
          { server: 'brave_search', label: 'Brave Search', tools: ['web_search'] },
          { server: 'web_fetch', label: 'Web Fetch', tools: ['fetch'] },
          { server: 'pretend_search', label: 'Pretend Search', tools: ['web_search'] },
        ],
        nativeDispatchContext: nativeDispatchContext(),
        input_vars: FIXTURE_INPUTS[fixture] ?? { topic: 'FlashQuery', name: 'Ada', limit: 2 },
      });

      const payload = parseToolPayload(result.result);
      const expectedError = EXPECTED_ERRORS[fixture];
      if (expectedError) {
        expect(payload, fixture).toMatchObject({ error: expectedError });
        continue;
      }

      expect(payload, fixture).not.toHaveProperty('error');
      expect(payload, fixture).toHaveProperty('result');
    }
  });
});
