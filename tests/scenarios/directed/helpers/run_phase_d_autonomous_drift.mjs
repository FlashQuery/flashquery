#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMacroSource } from '../../../../src/mcp/tools/macro.ts';
import { McpBroker } from '../../../../src/services/mcp-broker.ts';

const root = resolve(process.cwd());
const quirkyServer = join(root, 'tests', 'fixtures', 'mcp-servers', 'server-quirky.ts');
const before = [{
  name: 'mutable',
  description: 'Mutable before',
  inputSchema: { type: 'object', properties: { value: {} }, required: ['value'] },
}];
const after = [{
  name: 'mutable',
  description: 'Mutable after',
  inputSchema: {
    type: 'object',
    properties: { value: {}, token: { type: 'string' } },
    required: ['value', 'token'],
  },
}];

const config = {
  instance: {
    name: 'Phase D Autonomous Drift Helper',
    id: 'phase-d-autonomous-drift-helper',
    vault: { path: join(tmpdir(), 'phase-d-autonomous-drift-helper'), markdownExtensions: ['.md'] },
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
  locking: { enabled: false },
  trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
  hostMcpTools: { tools: ['call_macro'] },
  mcpServers: {
    quirky: {
      transport: 'stdio',
      command: process.execPath,
      args: ['--import', 'tsx', quirkyServer],
      env: {
        QUIRK_INITIAL_TOOLS: JSON.stringify(before),
        QUIRK_LATER_TOOLS: JSON.stringify(after),
        QUIRK_EMIT_LIST_CHANGED_MS: '25',
      },
      costPerCall: 0,
      perCallTimeoutMs: 30000,
      toolOverrides: {},
    },
  },
  host: { mcpServers: [], toolSearch: 'disabled' },
  llm: {
    providers: [],
    models: [],
    purposes: [{
      name: 'research',
      description: 'Research purpose',
      models: [],
      tools: [],
      mcpServers: ['quirky'],
    }],
  },
  embedding: { provider: 'none', model: '', dimensions: 1536 },
  logging: { level: 'error', output: 'stderr' },
};

const broker = new McpBroker(config);
const consumerContext = {
  kind: 'purpose',
  purposeId: 'research',
  traceId: 'trace-phase-d-autonomous-drift',
  interactive: false,
};

try {
  await broker.listToolsForConsumer(consumerContext);
  await sleep(100);
  const output = await runMacroSource({
    source: 'exit quirky.mutable({ value: "after-drift" })',
    callerContext: {
      origin: 'delegated',
      purposeName: 'research',
      interactive: false,
      consumerContext,
    },
    config,
    catalog: [],
    broker,
    brokerTools: [{ server: 'quirky', label: 'Quirky', tools: ['mutable'] }],
    nativeDispatchContext: {
      signal: new AbortController().signal,
      instanceId: config.instance.id,
      traceId: consumerContext.traceId,
      logContext: { test: 'phase-d-autonomous-drift-helper' },
    },
  });
  const payload = JSON.parse(output.result.content[0]?.text ?? '{}');
  console.log(JSON.stringify({ payload }, null, 2));
} finally {
  await broker.shutdown(50).catch(() => undefined);
}
