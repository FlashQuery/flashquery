import { describe, expect, it } from 'vitest';
import { evaluateProgram, MacroExitError, MacroFailError } from '../../src/macro/evaluator.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';
import { basicBuiltins, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro evaluator termination envelopes', () => {
  it('T-U-084 returns result null on fall-off with no isError flag', async () => {
    const result = await evaluateProgram(parseProgram('x = 1'), { builtins: basicBuiltins() });
    expect(result.isError).toBeUndefined();
    expect(parseToolPayload(result)).toMatchObject({ result: null });
  });

  it('T-U-085 exit "done" returns immediately and skips later statements', async () => {
    const result = await evaluateProgram(parseProgram('exit "done"\nfail "after"'), {
      builtins: basicBuiltins(),
    });
    expect(result.isError).toBeUndefined();
    expect(resultOf(parseToolPayload(result))).toBe('done');
  });

  it('T-U-086 exits with a structured object value', async () => {
    const result = await evaluateProgram(parseProgram('exit { a: 1, b: [2,3] }'), {
      builtins: basicBuiltins(),
    });
    expect(resultOf(parseToolPayload(result))).toEqual({ a: 1, b: [2, 3] });
  });

  it('T-U-087 fail "msg" returns macro_aborted expected envelope and skips later statements', async () => {
    const result = await evaluateProgram(parseProgram('fail "msg"\nexit "after"'), {
      builtins: basicBuiltins(),
    });
    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'macro_aborted',
      message: 'msg',
      details: { line: 1 },
    });
  });

  it('T-U-088 treats expected tool envelopes with isError: false as branchable values', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        response = fq.missing({})
        if $response.error == "not_found" then
          exit "handled"
        fi
        exit "unhandled"
      `),
      {
        builtins: basicBuiltins(),
        dispatchTool: async () => ({
          content: [{ type: 'text', text: JSON.stringify({ isError: false, error: 'not_found' }) }],
          isError: false,
        }),
      }
    );
    expect(resultOf(parseToolPayload(result))).toBe('handled');
  });

  it('T-U-089 maps thrown tools and isError true tool results to tool_call_failed runtime errors', async () => {
    const thrown = await evaluateProgram(parseProgram('fq.boom({})'), {
      builtins: basicBuiltins(),
      dispatchTool: async () => {
        throw new Error('boom');
      },
    });
    expect(thrown.isError).toBe(true);
    expect(parseToolPayload(thrown)).toMatchObject({
      error: 'tool_call_failed',
      details: { server: 'fq', tool: 'boom' },
    });

    const fatal = await evaluateProgram(parseProgram('fq.boom({})'), {
      builtins: basicBuiltins(),
      dispatchTool: async () =>
        ({
          content: [{ type: 'text', text: JSON.stringify({ error: 'not_found', message: 'Nope' }) }],
          isError: true,
        }) satisfies ToolResult,
    });
    expect(fatal.isError).toBe(true);
    expect(parseToolPayload(fatal)).toMatchObject({
      error: 'tool_call_failed',
      details: { underlying_error: { error: 'not_found', message: 'Nope' } },
    });
  });

  it('T-U-090 zero-arg exit returns null', async () => {
    const result = await evaluateProgram(parseProgram('exit'), { builtins: basicBuiltins() });
    expect(resultOf(parseToolPayload(result))).toBeNull();
  });

  it('T-U-091 multi-arg exit a b returns expected invalid_input with exit_argument_count', async () => {
    const result = await evaluateProgram(parseProgram('a = 1\nb = 2\nexit $a $b'), {
      builtins: basicBuiltins(),
    });
    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'exit_argument_count' },
    });
  });

  it('exports terminal control errors', () => {
    expect(new MacroExitError('x').value).toBe('x');
    expect(new MacroFailError('nope')).toBeInstanceOf(Error);
  });
});
