import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import type { McpBroker } from '../../src/services/mcp-broker.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram } from './macro-test-helpers.js';
import { macroResult } from '../../src/mcp/utils/response-formats.js';
import type {
  MacroDryRunResult,
  MacroExecutionResult,
} from '../../src/mcp/utils/response-formats.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const broker: McpBroker = {
  isConnected: async () => true,
  getToolHandler: () => async () => ({ content: [{ type: 'text', text: '{}' }] }),
};

function config(): FlashQueryConfig {
  return {
    instance: { id: 'macro-envelope-test', vault: { path: process.cwd(), markdownExtensions: ['.md'] } },
    server: {},
    macro: { defaultTimeoutMs: 60000 },
  } as FlashQueryConfig;
}

function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}

describe('macro envelope response contracts', () => {
  it('T-U-199 MacroExecutionResult shape uses a UUID task_id and execution counters', () => {
    const payload: MacroExecutionResult = {
      task_id: randomUUID(),
      result: { ok: true },
      trace: [
        {
          kind: 'log',
          message: 'started',
          at: '2026-05-14T00:00:00.000Z',
        },
      ],
      token_total: 42,
      model_calls: 1,
      external_tool_calls: 0,
      warnings: ['trace_value_truncated'],
    };

    const parsed = parseToolText(macroResult(payload));
    expect(parsed).toEqual(payload);
    expect(parsed['task_id']).toMatch(UUID_RE);
  });

  it('T-U-199b evaluateProgram returns execution counters on successful macro payloads', async () => {
    const result = await evaluateProgram(parseProgram('fq.call_model({})'), {
      dispatchTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ metadata: { tokens: { input: 3, output: 4 } } }) }],
      }),
    });

    const payload = parseToolText(result);
    expect(payload).toMatchObject({
      token_total: 7,
      model_calls: 1,
      external_tool_calls: 0,
    });
  });

  it('T-U-200 MacroDryRunResult shape uses a UUID task_id and canonical input_var_contract', () => {
    const payload: MacroDryRunResult = {
      task_id: randomUUID(),
      parsed_ok: true,
      input_var_contract: {
        required: ['query'],
        optional: [{ key: 'limit', default: 5 }],
      },
      tool_references: ['fq.search'],
      server_references: ['fq'],
    };

    const parsed = parseToolText(macroResult(payload));
    expect(parsed).toEqual(payload);
    expect(parsed['task_id']).toMatch(UUID_RE);
    expect(parsed['parsed_ok']).toBe(true);
    expect(payload.input_var_contract.required).toEqual(['query']);
    expect(payload.input_var_contract.optional).toEqual([{ key: 'limit', default: 5 }]);
  });

  it('T-U-201 dry-run omits a dry_run flag and does not register a task', async () => {
    const registry = new MacroTaskRegistry();
    const result = await runMacroSource({
      source: 'exit "ok"',
      dry_run: true,
      config: config(),
      catalog: [],
      broker,
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-envelope-test', logContext: {} },
      taskRegistry: registry,
    });

    const payload = parseToolText(result.result);
    expect(payload).toMatchObject({ parsed_ok: true });
    expect(payload).not.toHaveProperty('dry_run');
    expect(registry.list()).toEqual([]);
  });

  it('T-U-202 dry-run reports missing required input_var through invalid_input', async () => {
    const result = await runMacroSource({
      source: 'value = input_var "query"\nexit $value',
      dry_run: true,
      config: config(),
      catalog: [],
      broker,
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-envelope-test', logContext: {} },
    });

    expect(parseToolText(result.result)).toMatchObject({
      error: 'invalid_input',
      details: { missing_inputs: ['query'] },
    });
  });

  it('T-U-203 dry-run sorts tool_references and deduplicates server_references', async () => {
    const result = await runMacroSource({
      source: 'z.web({})\na.search({})\nz.other({})',
      dry_run: true,
      config: config(),
      catalog: [],
      broker,
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-envelope-test', logContext: {} },
      brokerTools: [
        { server: 'z', label: 'Z', tools: ['web', 'other'] },
        { server: 'a', label: 'A', tools: ['search'] },
      ],
    });

    const payload = parseToolText(result.result);
    expect(payload['tool_references']).toEqual(['a.search', 'z.other', 'z.web']);
    expect(payload['server_references']).toEqual(['a', 'z']);
  });

  it('T-U-204 dry-run includes required and optional input_var contract entries', async () => {
    const result = await runMacroSource({
      source: 'query = input_var "query"\nlimit = input_var "limit" --default 5\nexit $query',
      dry_run: true,
      input_vars: { query: 'x' },
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-envelope-test', logContext: {} },
    });

    expect(parseToolText(result.result)).toMatchObject({
      input_var_contract: { required: ['query'], optional: [{ key: 'limit', default: 5 }] },
    });
  });
});
