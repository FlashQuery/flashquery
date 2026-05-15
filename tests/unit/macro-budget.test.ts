import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';

describe('macro runtime budgets', () => {
  it('T-U-211 timeout_ms halts at the next safe point after in-flight work completes', async () => {
    const result = await evaluateProgram(parseProgram('slow_op 120 "late"\necho "never"'), {
      budgetLimits: { timeout_ms: 1 },
    });
    expect(parseToolPayload(result)).toMatchObject({ error: 'timeout', details: { timeout_ms: 1 } });
  });

  it('T-U-211a in-flight tool call completes before timeout envelope surfaces at next safe point', async () => {
    let handlerCompleted = false;
    const startedAt = Date.now();
    const result = await evaluateProgram(parseProgram('brave.web({})\necho "after"'), {
      budgetLimits: { timeout_ms: 5 },
      dispatchTool: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        handlerCompleted = true;
        return { content: [{ type: 'text', text: '{}' }] };
      },
    });

    const payload = parseToolPayload(result);
    expect(handlerCompleted).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(payload).toMatchObject({ error: 'timeout', details: { timeout_ms: 5 } });
    expect((payload['details'] as Record<string, unknown>)['elapsed_ms']).toEqual(expect.any(Number));
    expect(JSON.stringify(payload)).not.toContain('after');
  });

  it('T-U-212 max_total_tokens halts after the offending model call returns', async () => {
    const result = await evaluateProgram(parseProgram('fq.call_model({})'), {
      budgetLimits: { max_total_tokens: 3 },
      dispatchTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ metadata: { tokens: { input: 2, output: 2 } } }) }],
      }),
    });
    expect(parseToolPayload(result)).toMatchObject({
      error: 'budget_exceeded',
      details: { which: 'max_total_tokens', limit: 3, consumed: 4 },
    });
  });

  it('T-U-213 max_model_calls halts before dispatch', async () => {
    const result = await evaluateProgram(parseProgram('fq.call_model({})'), {
      budgetLimits: { max_model_calls: 0 },
      dispatchTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    });
    expect(parseToolPayload(result)).toMatchObject({
      error: 'budget_exceeded',
      details: { which: 'max_model_calls', limit: 0, consumed: 0 },
    });
  });

  it('T-U-214 max_external_tool_calls counts only brokered external tools', async () => {
    const result = await evaluateProgram(parseProgram('brave.web({})'), {
      budgetLimits: { max_external_tool_calls: 0 },
      dispatchTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    });
    expect(parseToolPayload(result)).toMatchObject({
      error: 'budget_exceeded',
      details: { which: 'max_external_tool_calls', limit: 0, consumed: 0 },
    });
  });

  it('T-U-215 budget counters are isolated per invocation', async () => {
    const first = await evaluateProgram(parseProgram('fq.call_model({})'), {
      budgetLimits: { max_model_calls: 1 },
      dispatchTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    });
    const second = await evaluateProgram(parseProgram('fq.call_model({})'), {
      budgetLimits: { max_model_calls: 1 },
      dispatchTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    });
    expect(parseToolPayload(first)).toHaveProperty('result');
    expect(parseToolPayload(second)).toHaveProperty('result');
  });

  it('uses config.macro.defaultTimeoutMs when budget.timeout_ms is omitted', async () => {
    const config = loadConfig('flashquery.yml');
    const result = await runMacroSource({
      source: 'exit "ok"',
      config,
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: config.instance.id, logContext: {} },
      taskRegistry: new MacroTaskRegistry(),
      budget: {},
    });
    expect(parseToolPayload(result.result)).toMatchObject({ result: 'ok' });
  });
});
