import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { macroResult } from '../../src/mcp/utils/response-formats.js';
import type {
  MacroDryRunResult,
  MacroExecutionResult,
} from '../../src/mcp/utils/response-formats.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
});
