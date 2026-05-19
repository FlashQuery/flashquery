import { describe, expect, it } from 'vitest';
import {
  evaluateProgram,
  MacroExitError,
  MacroFailError,
  MacroNeedsUserInputError,
} from '../../src/macro/evaluator.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';
import { basicBuiltins, dispatchRegistry, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

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

  it('rejects invalid fail argument shapes as invalid_input', async () => {
    for (const source of ['fail 1', 'fail "a" "b"', 'fail --progress 1 "msg"']) {
      const result = await evaluateProgram(parseProgram(source));
      expect(result.isError).toBe(false);
      expect(parseToolPayload(result)).toMatchObject({
        error: 'invalid_input',
        details: { reason: 'fail_argument_shape' },
      });
    }
  });

  it('rejects named args on exit as invalid_input', async () => {
    const result = await evaluateProgram(parseProgram('exit --progress 1 "done"'));
    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'exit_argument_count' },
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
        ...dispatchRegistry(['fq.missing']),
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
      ...dispatchRegistry(['fq.boom']),
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
      ...dispatchRegistry(['fq.boom']),
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

  it('T-U-091 multi-arg exit a b fails preflight before prior statements execute', async () => {
    let echoed = false;
    const result = await evaluateProgram(parseProgram('echo "should not run"\nexit "a" "b"'), {
      builtins: basicBuiltins({
        echo: () => {
          echoed = true;
          return null;
        },
      }),
    });
    expect(result.isError).toBe(false);
    expect(echoed).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'exit_argument_count' },
    });
  });

  it('REQ-105 terminates with needs_user_input and preserves schema drift payload fields', async () => {
    const payload = {
      event: 'schema_drift_detected',
      server: 'brave_search',
      tool: 'web_search',
      question: 'Review changed schema.',
      old_schema: { name: 'web_search', inputSchema: { type: 'object' } },
      new_schema: {
        name: 'web_search',
        inputSchema: { type: 'object', required: ['query'] },
      },
      diff_summary: 'Added required parameter: query (string)',
      options: ['approve', 'reject'],
      answer_shape: 'frontmatter.user_decisions.brave_search__web_search.tofu_decision',
      resume_hint: 'approve or reject the new schema',
    } as const;

    const result = await evaluateProgram(parseProgram('broker_drift'), {
      builtins: basicBuiltins({
        broker_drift: () => {
          throw new MacroNeedsUserInputError(payload);
        },
      }),
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      reason: 'needs_user_input',
      payload: {
        event: 'schema_drift_detected',
        server: 'brave_search',
        tool: 'web_search',
        old_schema: payload.old_schema,
        new_schema: payload.new_schema,
        diff_summary: 'Added required parameter: query (string)',
      },
    });
  });

  it('exports terminal control errors', () => {
    expect(new MacroExitError('x').value).toBe('x');
    expect(new MacroFailError('nope')).toBeInstanceOf(Error);
    expect(new MacroNeedsUserInputError({ question: 'Continue?' })).toBeInstanceOf(Error);
  });
});
