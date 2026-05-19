import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerMacroTools } from '../../src/mcp/tools/macro.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { createBroker, type McpBroker } from '../../src/services/mcp-broker.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = `macro-source-ref-${randomUUID().slice(0, 8)}`;
const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'mcp-servers');
const quirkyServer = join(fixtureDir, 'server-quirky.ts');

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'macro-source-ref-integration-test',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    server: { host: 'localhost', port: 3200 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    plugins: {},
    locking: { enabled: false, ttlSeconds: 30 },
    hostMcpTools: { tools: ['call_macro'], excludedTools: [] },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 60000 },
  } as unknown as FlashQueryConfig;
}

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

async function callMacro(config: FlashQueryConfig, args: Record<string, unknown>, broker?: McpBroker): Promise<{
  isError?: boolean;
  payload: Record<string, unknown>;
}> {
  const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-source-ref-test', version: '1.0.0' }));
  registerDocumentTools(server, config);
  registerMacroTools(server, config, broker === undefined ? {} : { broker });
  const client = new Client({ name: 'macro-source-ref-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'call_macro', arguments: args });
    return { isError: result.isError, payload: parseToolText(result) };
  } finally {
    await client.close();
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(!HAS_SUPABASE)('call_macro source_ref integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-macro-source-ref-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    initEmbedding(config);
    await mkdir(join(vaultPath, 'Macros'), { recursive: true });
  }, 60_000);

  afterAll(async () => {
    try {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Ignore cleanup failures in skipped or partially initialized environments.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('T-I-005 returns not_found for a non-existent source_ref', async () => {
    const result = await callMacro(config, { source_ref: 'Macros/missing.md::run' });

    expect(result.isError).toBeFalsy();
    expect(result.payload).toMatchObject({
      error: 'not_found',
      identifier: 'Macros/missing.md::run',
    });
  });

  it.skip('T-I-006 permission_denied is inherited from the document resolver when local ACL support exists', () => {
    // Current local resolver behavior has no per-caller read ACL that can produce
    // permission_denied for an otherwise resolvable vault document. Simulating
    // this with OS permissions would be platform- and user-dependent filesystem
    // error coverage, not the inherited app-level resolver contract this row
    // is meant to prove. Keep skipped until resolver ACL support exists.
  });

  it('T-I-007 returns not_found for an archived macro-library doc', async () => {
    await writeFile(
      join(vaultPath, 'Macros', 'archived.md'),
      [
        '---',
        'fq_status: archived',
        '---',
        '',
        '```fqm name=run',
        'exit "archived"',
        '```',
        '',
      ].join('\n')
    );

    const result = await callMacro(config, { source_ref: 'Macros/archived.md::run' });

    expect(result.isError).toBeFalsy();
    expect(result.payload).toMatchObject({
      error: 'not_found',
      identifier: 'Macros/archived.md::run',
    });
  });

  it('T-I-008 executes a valid fqm name block selected through source_ref', async () => {
    await writeFile(
      join(vaultPath, 'Macros', 'library.md'),
      [
        '---',
        'fq_status: active',
        'type: macro_library',
        '---',
        '',
        '```fqm name=ignored',
        'exit "wrong"',
        '```',
        '',
        '```fqm name=selected',
        'exit "from-source-ref"',
        '```',
        '',
      ].join('\n')
    );

    const result = await callMacro(config, { source_ref: 'Macros/library.md::selected' });

    expect(result.isError).toBeFalsy();
    expect(result.payload).toMatchObject({
      result: 'from-source-ref',
    });
  });

  it('T-E-001 analogue resumes a source_ref rundoc after TOFU drift and writes back to _self.frontmatter', async () => {
    const broker = createBroker({
      mcpServers: {
        quirky: {
          serverId: 'quirky',
          transport: 'stdio',
          command: process.execPath,
          args: ['--import', 'tsx', quirkyServer],
          env: {
            QUIRK_INITIAL_TOOLS: JSON.stringify([{
              name: 'stable',
              description: 'Stable test fixture tool.',
              inputSchema: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
              },
            }]),
            QUIRK_LATER_TOOLS: JSON.stringify([{
              name: 'stable',
              description: 'Stable test fixture tool with token.',
              inputSchema: {
                type: 'object',
                properties: { value: { type: 'string' }, token: { type: 'string' } },
                required: ['value', 'token'],
              },
            }]),
            QUIRK_EMIT_LIST_CHANGED_MS: '50',
          },
          costPerCall: 0,
          perCallTimeoutMs: 30_000,
          toolOverrides: {},
        },
      },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [] },
    });
    config = {
      ...config,
      hostMcpTools: { tools: ['call_macro', 'write_document'], excludedTools: [] },
      mcpServers: {
        quirky: {
          transport: 'stdio',
          command: process.execPath,
          args: ['--import', 'tsx', quirkyServer],
          env: {},
          costPerCall: 0,
          perCallTimeoutMs: 30_000,
          toolOverrides: {},
        },
      },
      host: { mcpServers: ['quirky'], toolSearch: 'disabled' },
    };

    try {
      await writeFile(
        join(vaultPath, 'Macros', 'drift-rundoc.md'),
        [
          '---',
          'fq_status: active',
          'fq_created: "2026-05-19T00:00:00.000Z"',
          'fq_title: Drift Rundoc',
          'type: macro_library',
          'completed: false',
          '---',
          '',
          '```fqm name=run',
          'broker_result = quirky.stable({ value: "second", token: "approved" })',
          'fq.write_document({',
          '  mode: "update",',
          '  identifier: _self.path,',
          '  frontmatter: { completed: "yes" }',
          '})',
          'exit { completed: "yes", broker_result: $broker_result }',
          '```',
          '',
        ].join('\n')
      );

      await broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-rundoc-drift' });
      await waitForCondition(() => broker.getPendingSchemaDrift().length === 1);

      const drift = await callMacro(config, { source_ref: 'Macros/drift-rundoc.md::run', trace: 'summary' }, broker);
      expect(drift.payload).toMatchObject({
        reason: 'needs_user_input',
        payload: expect.objectContaining({
          event: 'schema_drift_detected',
          server: 'quirky',
          tool: 'stable',
        }),
      });

      const approved = await callMacro(
        config,
        {
          source_ref: 'Macros/drift-rundoc.md::run',
          trace: 'summary',
          input_vars: {
            frontmatter: {
              user_decisions: {
                quirky__stable: { tofu_decision: 'approve' },
              },
            },
          },
        },
        broker
      );
      expect(approved.payload).toMatchObject({
        result: {
          completed: 'yes',
          broker_result: { tool: 'stable', arguments: { value: 'second', token: 'approved' } },
        },
      });

      const raw = await readFile(join(vaultPath, 'Macros', 'drift-rundoc.md'), 'utf-8');
      expect(raw).toContain('completed: "yes"');
    } finally {
      await broker.shutdown(50);
    }
  }, 60_000);

  it('T-I-008a returns named-block errors for invalid multi-block selectors', async () => {
    await writeFile(
      join(vaultPath, 'Macros', 'multi.md'),
      [
        '---',
        'fq_status: active',
        '---',
        '',
        '```fqm name=alpha',
        'exit "alpha"',
        '```',
        '',
        '```fqm name=beta',
        'exit "beta"',
        '```',
        '',
      ].join('\n')
    );

    const ambiguous = await callMacro(config, { source_ref: 'Macros/multi.md' });
    expect(ambiguous.payload).toMatchObject({
      error: 'invalid_input',
      details: {
        reason: 'ambiguous_macro_block',
        available_names: ['alpha', 'beta'],
      },
    });

    const missing = await callMacro(config, { source_ref: 'Macros/multi.md::gamma' });
    expect(missing.payload).toMatchObject({
      error: 'invalid_input',
      details: {
        reason: 'block_not_found',
        requested: 'gamma',
        available_names: ['alpha', 'beta'],
      },
    });
  });
});
