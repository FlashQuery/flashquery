import { describe, expect, it, vi } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseMacroSource } from '../../src/macro/parser.js';
import type { McpBroker } from '../../src/services/mcp-broker.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

function throwingDispatch() {
  return vi.fn(() => {
    throw new Error('namespace introspection must not dispatch tool handlers');
  });
}

describe('macro namespace introspection', () => {
  it('T-U-152 returns true for native fq._exists without dispatching a handler', async () => {
    const dispatchTool = throwingDispatch();

    const result = await evaluateProgram(parseProgram('exit fq._exists()'), { dispatchTool });

    expect(resultOf(parseToolPayload(result))).toBe(true);
    expect(dispatchTool).not.toHaveBeenCalled();
  });

  it('T-U-153 returns false for brokered _exists with NullMcpBroker', async () => {
    const dispatchTool = throwingDispatch();

    const result = await evaluateProgram(parseProgram('exit brave_search._exists()'), {
      broker: new NullMcpBroker(),
      dispatchTool,
    });

    expect(resultOf(parseToolPayload(result))).toBe(false);
    expect(dispatchTool).not.toHaveBeenCalled();
  });

  it('T-U-154 parses unknown leading-underscore methods and fails at runtime', async () => {
    const parsed = parseMacroSource('exit fq._unknown_method()');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);

    const result = await evaluateProgram(parsed.program, { dispatchTool: throwingDispatch() });

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'tool_call_failed',
      details: {
        reason: 'unsupported_introspection_method',
        server: 'fq',
        method: '_unknown_method',
      },
    });
  });

  it('T-U-155 calls broker.isConnected exactly once per brokered _exists evaluation', async () => {
    const broker = {
      isConnected: vi.fn(async (serverId: string) => serverId === 'brave_search'),
      getToolHandler: vi.fn(() => null),
    } satisfies McpBroker;
    const dispatchTool = throwingDispatch();

    const first = await evaluateProgram(parseProgram('exit brave_search._exists()'), {
      broker,
      dispatchTool,
    });
    const second = await evaluateProgram(parseProgram('exit brave_search._exists()'), {
      broker,
      dispatchTool,
    });

    expect(resultOf(parseToolPayload(first))).toBe(true);
    expect(resultOf(parseToolPayload(second))).toBe(true);
    expect(broker.isConnected).toHaveBeenCalledTimes(2);
    expect(broker.isConnected).toHaveBeenNthCalledWith(1, 'brave_search');
    expect(broker.isConnected).toHaveBeenNthCalledWith(2, 'brave_search');
    expect(dispatchTool).not.toHaveBeenCalled();
  });

  it('T-U-156 returns false when a brokered _exists probe exceeds the 5-second timeout', async () => {
    vi.useFakeTimers();
    const broker = {
      isConnected: vi.fn(() => new Promise<boolean>(() => {})),
      getToolHandler: vi.fn(() => null),
    } satisfies McpBroker;
    const dispatchTool = throwingDispatch();

    const evaluation = evaluateProgram(parseProgram('exit brave_search._exists()'), {
      broker,
      dispatchTool,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await evaluation;

    expect(resultOf(parseToolPayload(result))).toBe(false);
    expect(broker.isConnected).toHaveBeenCalledTimes(1);
    expect(broker.isConnected).toHaveBeenCalledWith('brave_search');
    expect(dispatchTool).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
