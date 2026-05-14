import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { callMacroInputSchema, runMacroSource } from '../../src/mcp/tools/macro.js';
import type { MacroCallerContext } from '../../src/macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Caller Identity Test',
      id: 'macro-caller-identity-test',
      vault: { path: '/tmp/macro-caller-identity-test', markdownExtensions: ['.md'] },
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
          tools: ['search', 'archive_document', 'call_model'],
        },
      ],
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as FlashQueryConfig;
}

const catalog: NativeToolDefinition[] = [
  { name: 'search', description: 'search', inputSchema: {}, handler: vi.fn() },
  { name: 'archive_document', description: 'archive', inputSchema: {}, handler: vi.fn() },
  { name: 'call_model', description: 'model', inputSchema: {}, handler: vi.fn() },
];

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-caller-identity-test',
    traceId: 'trace-caller-identity',
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: { test: 'macro-caller-identity' },
  };
}

describe('macro caller identity', () => {
  it('T-U-169 constructs internal origin: host context for inbound MCP calls and uses host exposure', async () => {
    const expectedCallerContext: MacroCallerContext = { origin: 'host' };
    const result = await runMacroSource({
      source: 'exit fq.call_model({ resolver: "purpose", name: "research" })',
      config: makeConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(result.registryBuild.callerContext).toEqual(expectedCallerContext);
    expect(result.registryBuild.allowlistSource).toBe('resolveHostToolExposure');
    expect(result.registryBuild.allowedToolNames).toContain('fq.call_model');
  });

  it('T-U-170 constructs internal origin: delegated context for agentic-originated calls and uses purpose allowlist', async () => {
    const expectedCallerContext: MacroCallerContext = { origin: 'delegated', purposeName: 'research' };
    const result = await runMacroSource({
      source: 'exit fq.archive_document({ identifier: "ok.md" })',
      callerContext: expectedCallerContext,
      config: makeConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(result.registryBuild.callerContext).toEqual(expectedCallerContext);
    expect(result.registryBuild.allowlistSource).toBe('assembleNativeToolRegistry');
    expect(result.registryBuild.allowedToolNames).toContain('fq.archive_document');
  });

  it('T-U-171 public call_macro Zod request schema does not expose callerKind', () => {
    expect(Object.keys(callMacroInputSchema.shape)).not.toContain('callerKind');
    expect(callMacroInputSchema.safeParse({
      source: 'exit 1',
      callerKind: 'delegated',
    }).data).not.toHaveProperty('callerKind');
  });
});
