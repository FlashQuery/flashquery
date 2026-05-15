import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { callMacroInputSchema, registerMacroTools, runMacroSource } from '../../src/mcp/tools/macro.js';
import { parseToolPayload } from './macro-test-helpers.js';

function config(): FlashQueryConfig {
  return {
    instance: { id: 'macro-handler-test', vault: { path: process.cwd(), markdownExtensions: ['.md'] } },
    server: {},
    macro: { defaultTimeoutMs: 60000 },
  } as FlashQueryConfig;
}

function registeredCallMacroHandler() {
  const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-handler-unit', version: '1.0.0' }));
  registerMacroTools(server, config());
  const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro')?.handler;
  expect(handler).toBeDefined();
  return handler!;
}

describe('macro handler request schema', () => {
  it('T-U-216 accepts documented production fields and strips deferred task-spec fields', () => {
    const parsed = callMacroInputSchema.safeParse({
      source: 'exit "ok"',
      source_ref: 'Macros/lib.md::add',
      input_vars: { name: 'Ada' },
      budget: {
        max_total_tokens: 100,
        max_model_calls: 2,
        max_external_tool_calls: 3,
        timeout_ms: 1000,
      },
      dry_run: true,
      trace: 'full',
      progress: 'silent',
      task: 'deferred',
      taskHint: 'later',
      pollInterval: 100,
      ttl: 5000,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.data).toEqual({
      source: 'exit "ok"',
      source_ref: 'Macros/lib.md::add',
      input_vars: { name: 'Ada' },
      budget: {
        max_total_tokens: 100,
        max_model_calls: 2,
        max_external_tool_calls: 3,
        timeout_ms: 1000,
      },
      dry_run: true,
      trace: 'full',
      progress: 'silent',
    });
    expect(parsed.data).not.toHaveProperty('task');
    expect(parsed.data).not.toHaveProperty('taskHint');
    expect(parsed.data).not.toHaveProperty('pollInterval');
    expect(parsed.data).not.toHaveProperty('ttl');
  });

  it('T-U-217 preserves documented defaults for omitted trace, progress, dry_run, and timeout_ms', async () => {
    const notifications: unknown[] = [];
    const result = await runMacroSource({
      source: 'status "milestone"\nexit "ok"',
      progressToken: 'default-progress-token',
      progressNotificationSink: async (entry) => notifications.push(entry),
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
    });

    const payload = parseToolPayload(result.result);
    expect(payload).toMatchObject({ result: 'ok' });
    expect(payload['trace']).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'progress', message: 'milestone' })])
    );
    expect(notifications).toEqual([
      expect.objectContaining({ progressToken: 'default-progress-token', message: 'milestone' }),
    ]);

    const timedOut = await runMacroSource({
      source: 'sleep 20',
      config: {
        ...config(),
        macro: { defaultTimeoutMs: 1 },
      },
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
    });
    expect(parseToolPayload(timedOut.result)).toMatchObject({
      error: 'timeout',
      details: { timeout_ms: 1 },
    });
  });
});

describe('macro handler source selector validation', () => {
  const cases: Array<{
    id: string;
    params: Record<string, unknown>;
    reason: string;
  }> = [
    {
      id: 'T-U-218',
      params: { source: 'if', source_ref: 'Macros/lib.md::foo' },
      reason: 'exactly_one_required',
    },
    {
      id: 'T-U-219',
      params: {},
      reason: 'exactly_one_required',
    },
    {
      id: 'T-U-220',
      params: { source: '' },
      reason: 'empty_source',
    },
    {
      id: 'T-U-221',
      params: { source_ref: '' },
      reason: 'empty_source_ref',
    },
    {
      id: 'T-U-222',
      params: { source_ref: '::foo' },
      reason: 'invalid_source_ref_format',
    },
    {
      id: 'T-U-223',
      params: { source_ref: 'Macros/lib.md::bad name' },
      reason: 'invalid_block_name_format',
    },
  ];

  it.each(cases)('$id returns invalid_input / $reason before parse or execution', async ({ params, reason }) => {
    const handler = registeredCallMacroHandler();
    const result = await handler(params, {} as never);

    expect(result.isError).toBeFalsy();
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason },
    });
  });
});

describe('macro handler progress token threading', () => {
  it('T-U-233 threads _meta.progressToken-style values into the engine notification path', async () => {
    const notifications: unknown[] = [];
    const result = await runMacroSource({
      source: 'status "working"',
      progress: 'full',
      progressToken: 'progress-token-1',
      progressNotificationSink: async (entry) => notifications.push(entry),
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
      taskRegistry: new MacroTaskRegistry(),
    });

    expect(parseToolPayload(result.result)['trace']).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'progress', message: 'working' })])
    );
    expect(notifications).toEqual([
      expect.objectContaining({ progressToken: 'progress-token-1', message: 'working' }),
    ]);
  });

  it('T-U-234 missing progressToken suppresses notification attempts', async () => {
    const notifications: unknown[] = [];
    await runMacroSource({
      source: 'status "working"',
      progress: 'full',
      progressNotificationSink: async (entry) => notifications.push(entry),
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
    });

    expect(notifications).toEqual([]);
  });

  it('preserves RegisterMacroToolsResult registrationSessionId fallback contract', () => {
    const source = readFileSync('src/mcp/tools/macro.ts', 'utf8');
    expect(source).toContain('RegisterMacroToolsResult');
    expect(source).toContain('registrationSessionId');
    expect(source).toContain('return { registrationSessionId }');
    expect(source).toContain('_meta?.progressToken');
    expect(source).toContain('notifications/progress');
    expect(source).toContain('sendNotification');
  });
});
