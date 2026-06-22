import { describe, expect, it } from 'vitest';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import {
  parseResultPayload,
  transitionTaskFromResult,
} from '../../src/mcp/tools/macro.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';

function toolResult(text: string, isError?: boolean): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError === undefined ? {} : { isError }),
  };
}

function parseText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('macro task result transitions', () => {
  it('T-U-019 repairs success envelopes before completing tasks', () => {
    const registry = new MacroTaskRegistry();
    const task = registry.create({ taskId: 'task-success', sessionId: 'session-a' });
    const transitions: string[] = [];

    const replacement = transitionTaskFromResult(
      registry,
      task,
      toolResult('{task_id: "task-success", result: {ok: true,},}'),
      (record) => transitions.push(record.status)
    );

    expect(replacement).toBeUndefined();
    expect(transitions).toEqual(['completed']);
    expect(registry.get('task-success', 'session-a')).toBeUndefined();
  });

  it('T-U-020 repairs cancellation envelopes before cancelling and clearing cancellation state', () => {
    const registry = new MacroTaskRegistry();
    const task = registry.create({ taskId: 'task-cancel', sessionId: 'session-a' });
    const transitions: string[] = [];

    const replacement = transitionTaskFromResult(
      registry,
      task,
      toolResult('{error: "cancelled", message: "Macro cancelled", details: {reason: "cancelled",},}'),
      (record) => transitions.push(record.status)
    );

    expect(replacement).toBeUndefined();
    expect(transitions).toEqual(['cancelled']);
    expect(registry.get('task-cancel', 'session-a')).toBeUndefined();
    expect(registry.isCancellationRequested('task-cancel')).toBe(false);
  });

  it('T-U-021 and T-U-023 fail irreparable malformed envelopes with an isError result', () => {
    const registry = new MacroTaskRegistry();
    const task = registry.create({ taskId: 'task-malformed', sessionId: 'session-a' });
    const transitions: string[] = [];

    const replacement = transitionTaskFromResult(
      registry,
      task,
      toolResult('{task_id: "task-malformed", result: 1 2}'),
      (record) => transitions.push(record.status)
    );

    expect(replacement?.isError).toBe(true);
    expect(parseText(replacement as ToolResult)).toMatchObject({
      error: 'invalid_json_payload',
      message: 'Structured JSON payload could not be parsed.',
      details: { site: 'macro_task_result' },
    });
    expect(transitions).toEqual(['failed']);
    expect(registry.get('task-malformed', 'session-a')).toBeUndefined();
  });

  it('fails repaired expected-error envelopes instead of completing tasks', () => {
    const registry = new MacroTaskRegistry();
    const task = registry.create({ taskId: 'task-expected-error', sessionId: 'session-a' });
    const transitions: string[] = [];

    const replacement = transitionTaskFromResult(
      registry,
      task,
      toolResult('{error: "invalid_input", message: "Bad input", details: {reason: "x",},}'),
      (record) => transitions.push(record.status)
    );

    expect(replacement).toBeUndefined();
    expect(transitions).toEqual(['failed']);
    expect(registry.get('task-expected-error', 'session-a')).toBeUndefined();
  });

  it('parseResultPayload repairs structured envelopes and rejects unreadable ones', () => {
    expect(parseResultPayload(toolResult('{task_id: "task-success", result: "ok",}'))).toMatchObject({
      ok: true,
      payload: { task_id: 'task-success', result: 'ok' },
    });

    expect(parseResultPayload(toolResult('{task_id: "task-malformed", result: 1 2}'))).toMatchObject({
      ok: false,
      result: {
        isError: true,
      },
    });
  });
});
