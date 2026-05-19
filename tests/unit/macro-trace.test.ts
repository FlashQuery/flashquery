import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../src/mcp/utils/response-formats.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { dispatchRegistry, parseProgram, parseToolPayload } from './macro-test-helpers.js';

describe('macro trace response contracts', () => {
  it('T-U-187 trace full includes args and result for tool and model calls', async () => {
    const result = await evaluateProgram(parseProgram('fq.call_model({ prompt: "hi" })\nbrave.web({ q: "x" })'), {
      ...dispatchRegistry(['fq.call_model', 'brave.web']),
      traceMode: 'full',
      dispatchTool: async (server, tool) => ({
        content: [{ type: 'text', text: JSON.stringify({ ok: `${server}.${tool}` }) }],
      }),
    });

    const payload = parseToolPayload(result);
    expect(payload['trace']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'model_call', name: 'fq.call_model', args: { prompt: 'hi' }, result: { ok: 'fq.call_model' } }),
      expect.objectContaining({ kind: 'tool_call', name: 'brave.web', args: { q: 'x' }, result: { ok: 'brave.web' } }),
    ]));
  });

  it('T-U-188 trace summary omits only args and result from retained steps', async () => {
    const result = await evaluateProgram(parseProgram('fq.call_model({ prompt: "hi" })'), {
      ...dispatchRegistry(['fq.call_model']),
      traceMode: 'summary',
      dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
    });

    const step = (parseToolPayload(result)['trace'] as Record<string, unknown>[])
      .find((item) => item['kind'] === 'model_call');
    expect(step).toBeDefined();
    expect(step).toMatchObject({ kind: 'model_call', name: 'fq.call_model', at: expect.any(String) });
    expect(step).not.toHaveProperty('args');
    expect(step).not.toHaveProperty('result');
  });

  it('T-U-189 trace none omits the trace field instead of returning an empty list', async () => {
    const result = await evaluateProgram(parseProgram('echo "hidden"\nexit "ok"'), { traceMode: 'none' });
    expect(parseToolPayload(result)).not.toHaveProperty('trace');
  });

  it('T-U-190 large trace values are capped to the documented byte sentinel', async () => {
    const large = 'x'.repeat(2050);
    const result = await evaluateProgram(parseProgram('brave.web({ q: "large" })'), {
      ...dispatchRegistry(['brave.web']),
      traceMode: 'full',
      dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ large }) }] }),
    });

    const payload = parseToolPayload(result);
    const step = (payload['trace'] as Record<string, unknown>[])[0];
    expect(step['result']).toBe('<truncated: 2062 bytes>');
    expect(payload['warnings']).toEqual(['trace_value_truncated']);
  });

  it('T-U-193 applies trace mode while writing and does not retain omitted values', async () => {
    const result = await evaluateProgram(parseProgram('brave.web({ secret: "value" })'), {
      ...dispatchRegistry(['brave.web']),
      traceMode: 'summary',
      dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ secret: 'result' }) }] }),
    });

    expect(JSON.stringify(parseToolPayload(result)['trace'])).not.toContain('secret');
  });

  it('T-U-191 TraceStep shape matches the flat v0 interface', () => {
    const step: TraceStep = {
      kind: 'tool_call',
      name: 'fq.search',
      args: { query: 'macro' },
      result: { count: 1 },
      at: '2026-05-14T00:00:00.000Z',
      elapsed_ms: 12,
    };

    expect(step).toEqual({
      kind: 'tool_call',
      name: 'fq.search',
      args: { query: 'macro' },
      result: { count: 1 },
      at: '2026-05-14T00:00:00.000Z',
      elapsed_ms: 12,
    });
  });

  it('T-U-192 TraceStep has no children field in v0', () => {
    const step: TraceStep = {
      kind: 'log',
      message: 'started',
      at: '2026-05-14T00:00:00.000Z',
    };

    expect(Object.keys(step)).toEqual(['kind', 'message', 'at']);
    expect('children' in step).toBe(false);
  });
});
