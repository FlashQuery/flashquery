import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerMacroTools } from '../../src/mcp/tools/macro.js';
import { wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

const TEST_INSTANCE_ID = `macro-source-ref-${randomUUID().slice(0, 8)}`;

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
    macro: { defaultTimeoutMs: 60000 },
  } as unknown as FlashQueryConfig;
}

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

async function callMacro(config: FlashQueryConfig, args: Record<string, unknown>): Promise<{
  isError?: boolean;
  payload: Record<string, unknown>;
}> {
  const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-source-ref-test', version: '1.0.0' }));
  registerMacroTools(server, config);
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

describe.skipIf(!HAS_SUPABASE)('call_macro source_ref integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-macro-source-ref-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
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
    // Current local resolver behavior has no per-caller read ACL to deny a vault file.
    // This row stays skipped rather than adding macro-specific permission logic.
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

  it('T-I-012 returns named-block errors for invalid multi-block selectors', async () => {
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
