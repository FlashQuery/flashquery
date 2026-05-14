import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../src/mcp/utils/response-formats.js';

describe('macro trace response contracts', () => {
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
