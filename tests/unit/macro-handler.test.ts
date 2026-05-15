import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import {
  callMacroInputSchema,
  registerMacroTools,
  resolveMacroSourceForRequest,
  runMacroSource,
} from '../../src/mcp/tools/macro.js';
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

function mockSupabaseClient() {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: null }),
  };
  return {
    from: () => query,
  };
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
  it('T-U-224 resolves source_ref into the same dry-run and task execution path as inline source', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-macro-handler-'));
    try {
      const macroSource = 'status "resolved-source-ref"\nexit "ok"';
      await writeFile(
        join(vaultPath, 'library.md'),
        [
          '---',
          'fq_status: active',
          '---',
          '',
          '# Macro Library',
          '',
          '```fqm name=selected',
          macroSource,
          '```',
          '',
        ].join('\n')
      );

      const sourceRef = 'library.md::selected';
      const resolved = await resolveMacroSourceForRequest({
        source_ref: sourceRef,
        config: {
          ...config(),
          instance: {
            ...config().instance,
            vault: { path: vaultPath, markdownExtensions: ['.md'] },
          },
        },
        supabase: mockSupabaseClient() as never,
      });
      expect(resolved).toMatchObject({ ok: true, source: macroSource, identifier: sourceRef });
      if (!resolved.ok) throw new Error('source_ref did not resolve');

      const common = {
        config: config(),
        catalog: [],
        broker: new NullMcpBroker(),
        nativeDispatchContext: {
          signal: new AbortController().signal,
          instanceId: 'macro-handler-test',
          logContext: {},
        },
        taskId: 'task-source-ref',
      };

      const sourceRefDryRun = await runMacroSource({
        ...common,
        source: resolved.source,
        sourceIdentifier: resolved.identifier,
        dry_run: true,
      });
      const inlineDryRun = await runMacroSource({
        ...common,
        source: macroSource,
        dry_run: true,
      });

      expect(parseToolPayload(sourceRefDryRun.result)).toEqual(parseToolPayload(inlineDryRun.result));

      const transitions: unknown[] = [];
      const registry = new MacroTaskRegistry();
      const executed = await runMacroSource({
        ...common,
        source: resolved.source,
        sourceIdentifier: resolved.identifier,
        taskRegistry: registry,
        onTaskTransition: (record) => transitions.push(record),
      });

      expect(parseToolPayload(executed.result)).toMatchObject({ task_id: 'task-source-ref', result: 'ok' });
      expect(transitions[0]).toMatchObject({
        task_id: 'task-source-ref',
        status: 'working',
        source_preview: sourceRef,
      });
      expect(transitions.at(-1)).toMatchObject({
        task_id: 'task-source-ref',
        status: 'completed',
      });
      expect(registry.list()).toEqual([]);
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

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

  it('fails and clears a registered task when post-registration execution throws unexpectedly', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const transitions: unknown[] = [];
    const result = await runMacroSource({
      source: 'exit "unreachable"',
      taskId: 'task-transition-throws',
      sessionId: 'session-transition-throws',
      taskRegistry,
      onTaskTransition: (record) => {
        transitions.push(record);
        if (record.status === 'working') {
          throw new Error('transition listener unavailable');
        }
      },
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
    });

    expect(result.result.isError).toBe(true);
    expect(parseToolPayload(result.result)).toMatchObject({
      error: 'runtime_error',
      message: expect.stringContaining('transition listener unavailable'),
    });
    expect(transitions).toEqual([
      expect.objectContaining({ task_id: 'task-transition-throws', status: 'working' }),
    ]);
    expect(taskRegistry.list('session-transition-throws')).toEqual([]);
  });

  it('returns a runtime envelope instead of rejecting when handler internals throw', async () => {
    const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-handler-boundary', version: '1.0.0' }));
    registerMacroTools(server, {
      ...config(),
      llm: { providers: [], models: [], purposes: [] },
    } as FlashQueryConfig);
    const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro')?.handler;
    expect(handler).toBeDefined();

    const result = await handler!(
      { source: 'exit "unreachable"' },
      { signal: new AbortController().signal } as never
    );

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'runtime_error',
      message: expect.stringContaining('Error running call_macro:'),
    });
  });

  it('preserves RegisterMacroToolsResult session fallback and progress notification behavior', async () => {
    const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-handler-session-fallback', version: '1.0.0' }));
    const taskRegistry = new MacroTaskRegistry();
    const fallbackSessionId = 'registration-session';
    const providerSessionId = 'provider-session';
    taskRegistry.create({ taskId: 'fallback-visible', sessionId: fallbackSessionId, source: 'sleep 1000' });
    taskRegistry.create({ taskId: 'provider-hidden', sessionId: providerSessionId, source: 'sleep 1000' });
    const registration = registerMacroTools(server, config(), {
      sessionId: fallbackSessionId,
      taskRegistry,
    });
    const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro')?.handler;
    expect(handler).toBeDefined();

    const notifications: unknown[] = [];
    const result = await handler!(
      { source: 'status "handler-progress"\nvisible = list_tasks\nexit { visible: $visible }', progress: 'full' },
      {
        _meta: { progressToken: 'handler-token' },
        sendNotification: async (notification: unknown) => notifications.push(notification),
        signal: new AbortController().signal,
      } as never
    );

    const payload = parseToolPayload(result);
    const value = payload['result'] as Record<string, unknown>;
    const visible = value['visible'] as Array<Record<string, unknown>>;
    expect(registration.registrationSessionId).toBe(fallbackSessionId);
    expect(visible.map((task) => task['task_id'])).toContain('fallback-visible');
    expect(visible.map((task) => task['task_id'])).not.toContain('provider-hidden');
    expect(notifications).toEqual([
      expect.objectContaining({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progressToken: 'handler-token',
          message: 'handler-progress',
        }),
      }),
    ]);
  });

  it('sessionIdProvider overrides the registration session fallback', async () => {
    const server = wrapServerWithToolCatalog(new McpServer({ name: 'macro-handler-session-provider', version: '1.0.0' }));
    const taskRegistry = new MacroTaskRegistry();
    taskRegistry.create({ taskId: 'fallback-hidden', sessionId: 'registration-session', source: 'sleep 1000' });
    taskRegistry.create({ taskId: 'provider-visible', sessionId: 'provider-session', source: 'sleep 1000' });
    registerMacroTools(server, config(), {
      sessionId: 'registration-session',
      sessionIdProvider: () => 'provider-session',
      taskRegistry,
    });
    const handler = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro')?.handler;
    expect(handler).toBeDefined();

    const result = await handler!(
      { source: 'visible = list_tasks\nexit { visible: $visible }' },
      { signal: new AbortController().signal } as never
    );

    const payload = parseToolPayload(result);
    const value = payload['result'] as Record<string, unknown>;
    const visible = value['visible'] as Array<Record<string, unknown>>;
    expect(visible.map((task) => task['task_id'])).toContain('provider-visible');
    expect(visible.map((task) => task['task_id'])).not.toContain('fallback-hidden');
  });
});
