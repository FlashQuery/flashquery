#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runMacroSource } from '../../../../src/mcp/tools/macro.ts';
import { NullMcpBroker } from '../../../../src/services/mcp-broker.ts';

const mode = process.argv[2] ?? '';

const config = {
  instance: {
    name: 'Macro Delegated Hard Exclusions Directed Helper',
    id: 'macro-delegated-hard-exclusions-helper',
    vault: { path: join(tmpdir(), 'macro-delegated-hard-exclusions-helper'), markdownExtensions: ['.md'] },
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
  hostMcpTools: { tools: ['call_model'] },
  llm: {
    providers: [],
    models: [],
    purposes: [
      {
        name: 'research',
        description: 'Research purpose',
        models: [],
        tools: ['call_model'],
      },
    ],
  },
  embedding: { provider: 'none', model: '', dimensions: 1536 },
  logging: { level: 'info', output: 'stdout' },
};

const catalog = [
  {
    name: 'call_model',
    description: 'directed fake call_model',
    inputSchema: z.object({}).passthrough(),
    handler: async (args) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, tool: 'call_model', args }),
        },
      ],
    }),
  },
];

const callerContext = mode === 'delegated'
  ? { origin: 'delegated', purposeName: 'research' }
  : { origin: 'host' };

const source = 'exit fq.call_model({ resolver: "purpose", name: "research" })';
const output = await runMacroSource({
  source,
  callerContext,
  config,
  catalog,
  broker: new NullMcpBroker(),
  nativeDispatchContext: {
    signal: new AbortController().signal,
    instanceId: config.instance.id,
    logContext: { test: 'macro-delegated-hard-exclusions-helper' },
  },
});

const payload = JSON.parse(output.result.content[0]?.text ?? '{}');
console.log(JSON.stringify({
  mode,
  payload,
  registryBuild: {
    callerContext: output.registryBuild.callerContext,
    allowlistSource: output.registryBuild.allowlistSource,
    allowedToolNames: output.registryBuild.allowedToolNames,
    hardExcludedReasons: Object.fromEntries(output.registryBuild.toolRegistry.hardExcludedReasons),
  },
}, null, 2));
