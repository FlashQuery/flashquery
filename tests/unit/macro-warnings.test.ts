import { describe, expect, it } from 'vitest';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';

describe('macro warning propagation', () => {
  it('T-U-209 returns trace_value_truncated warnings on successful macro payloads', async () => {
    const result = await evaluateProgram(parseProgram('brave.web({ q: "x" })'), {
      traceMode: 'full',
      dispatchTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ text: 'x'.repeat(2050) }) }],
      }),
    });

    expect(result.isError).toBeUndefined();
    expect(parseToolPayload(result)['warnings']).toEqual(['trace_value_truncated']);
  });

  it('T-U-210 returns broker_unavailable once for brokered _exists false results', async () => {
    const result = await evaluateProgram(
      parseProgram('first = brave_search._exists()\nsecond = brave_search._exists()\nexit { first: $first, second: $second }'),
      { broker: new NullMcpBroker() }
    );

    const payload = parseToolPayload(result);
    expect(payload['warnings']).toEqual(['broker_unavailable']);
  });
});
