import { describe, expect, it } from 'vitest';
import { ProgressEmitter } from '../../src/macro/progress-emitter.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';

describe('macro progress modes', () => {
  it.each([
    ['full', ['for item', 'for item', 'for item', 'model_call:start:fq.call_model', 'model_call:finish:fq.call_model', 'tool_call:start:brave.web']],
    ['milestones', ['model_call:start:fq.call_model', 'model_call:finish:fq.call_model']],
    ['silent', []],
  ] as const)(
    'T-U-194/T-U-195/T-U-196 auto-progress trace steps honor %s mode',
    async (progressMode, expectedMessages) => {
      const result = await evaluateProgram(
        parseProgram('for item in [1,2,3] do\necho $item\ndone\nfq.call_model({})\nbrave.web({})\nexit "ok"'),
        {
          progressMode,
          traceMode: 'full',
          dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
        }
      );

      const payload = parseToolPayload(result);
      const trace = payload['trace'] as Array<Record<string, unknown>>;
      const progressMessages = trace
        .filter((step) => step['kind'] === 'progress')
        .map((step) => step['message']);
      expect(progressMessages).toEqual(expectedMessages);
    }
  );

  it('T-U-194 progress full emits explicit status, for-loop, model, and tool notifications', async () => {
    const notifications: unknown[] = [];
    const result = await evaluateProgram(parseProgram('status "ready"\nfor item in [1] do\nbrave.web({})\ndone\nfq.call_model({})'), {
      progressMode: 'full',
      progressToken: 'tok',
      progressNotificationSink: async (entry) => notifications.push(entry),
      dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
    });

    expect(parseToolPayload(result)['warnings']).toEqual(['progress_throttled']);
    expect(JSON.stringify(notifications)).toContain('ready');
  });

  it('T-U-195 progress milestones emits explicit status and model boundaries only', async () => {
    let now = 0;
    const notifications: unknown[] = [];
    const warnings: string[] = [];
    const entries: unknown[] = [];
    const emitter = new ProgressEmitter('milestones', 'tok', async (entry) => notifications.push(entry), warnings, entries, () => {
      now += 101;
      return now;
    });

    await emitter.emitExplicitStatus({ message: 'explicit' });
    await emitter.emitForLoopIteration();
    await emitter.emitModelCallStart('fq.call_model');
    await emitter.emitModelCallFinish('fq.call_model');
    await emitter.emitToolCallStart('brave.web');

    expect(notifications).toEqual([
      expect.objectContaining({ message: 'explicit', progressToken: 'tok' }),
      expect.objectContaining({ message: 'model_call:start:fq.call_model' }),
      expect.objectContaining({ message: 'model_call:finish:fq.call_model' }),
    ]);
  });

  it('T-U-196 progress silent emits nothing including explicit status', async () => {
    const notifications: unknown[] = [];
    const result = await evaluateProgram(parseProgram('status "quiet"\nexit null'), {
      progressMode: 'silent',
      progressToken: 'tok',
      progressNotificationSink: async (entry) => notifications.push(entry),
    });

    expect(parseToolPayload(result)).not.toHaveProperty('progress');
    expect(notifications).toEqual([]);
  });

  it('T-U-197 rapid progress emissions are throttled at 100 ms and warn once', async () => {
    const notifications: unknown[] = [];
    const warnings: string[] = [];
    const entries: unknown[] = [];
    const emitter = new ProgressEmitter('full', 'tok', async (entry) => notifications.push(entry), warnings, entries, () => 1);

    await emitter.emitExplicitStatus({ message: 'a' });
    await emitter.emitToolCallStart('brave.web');
    await emitter.emitModelCallStart('fq.call_model');

    expect(notifications).toHaveLength(1);
    expect(warnings).toEqual(['progress_throttled']);
  });

  it('T-U-198 absent progressToken is a notification no-op', async () => {
    const notifications: unknown[] = [];
    const result = await evaluateProgram(parseProgram('status "no-token"\nexit null'), {
      progressMode: 'full',
      progressNotificationSink: async (entry) => notifications.push(entry),
    });

    const payload = parseToolPayload(result);
    expect(payload).not.toHaveProperty('progress');
    expect(payload['trace']).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'progress', message: 'no-token' })])
    );
    expect(notifications).toEqual([]);
  });
});
