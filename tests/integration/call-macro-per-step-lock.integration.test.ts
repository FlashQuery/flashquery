import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import matter from 'gray-matter';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMcpServer } from '../../src/mcp/server.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('REQ-025 call_macro per-step document lock integration', () => {
  let harness: Phase155Harness;
  let client: Client;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-call-macro-per-step-');
    const server = createMcpServer(harness.config, '0.1.0');
    client = new Client({ name: 'call-macro-per-step-lock-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await harness?.cleanup();
  });

  async function callMacro(source: string): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name: 'call_macro', arguments: { source } });
    expect(result.isError).toBeFalsy();
    return parseToolText(result);
  }

  it('T-I-049 parallel call_macro write steps to one file complete through tool-level locks', async () => {
    const created = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'phase155/macro-same-file.md',
        title: 'Macro Same File',
        content: 'initial',
        tags: ['wco-phase-155'],
      },
    });
    expect(created.isError).toBeFalsy();

    const [first, second] = await Promise.all([
      callMacro('exit fq.write_document({ mode: "update", identifier: "phase155/macro-same-file.md", content: "macro first" })'),
      callMacro('exit fq.write_document({ mode: "update", identifier: "phase155/macro-same-file.md", content: "macro second" })'),
    ]);

    expect(first).toMatchObject({ result: { path: 'phase155/macro-same-file.md' } });
    expect(second).toMatchObject({ result: { path: 'phase155/macro-same-file.md' } });
  }, 40_000);

  it.skip('T-I-050 deferred to Phase 162 / REQ-012 version_token expected_version conflict handling', () => {
    // Phase 155 intentionally keeps macro writes per-step and does not auto-thread
    // version_token / expected_version. REQ-012 and the positive conflict envelope
    // assertion land in Phase 162.
  });

  it('T-I-051 macro writes without expected_version retain opt-in last-writer-wins behavior', async () => {
    const created = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'phase155/macro-no-token.md',
        title: 'Macro No Token',
        content: 'initial',
        tags: ['wco-phase-155'],
      },
    });
    expect(created.isError).toBeFalsy();

    const result = await callMacro('exit fq.write_document({ mode: "update", identifier: "phase155/macro-no-token.md", content: "unconditional macro update" })');

    expect(result).toMatchObject({ result: { path: 'phase155/macro-no-token.md' } });
    const raw = await readFile(join(harness.vaultPath, 'phase155/macro-no-token.md'), 'utf-8');
    expect(matter(raw).content.trim()).toBe('unconditional macro update');
  }, 40_000);
});
