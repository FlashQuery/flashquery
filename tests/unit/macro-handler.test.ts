import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import { parseToolPayload } from './macro-test-helpers.js';

function config(): FlashQueryConfig {
  return {
    instance: { id: 'macro-handler-test', vault: { path: process.cwd(), markdownExtensions: ['.md'] } },
    server: {},
    macro: { defaultTimeoutMs: 60000 },
  } as FlashQueryConfig;
}

describe('macro handler progress token threading', () => {
  it('T-U-233 threads _meta.progressToken-style values into the engine notification path', async () => {
    const notifications: unknown[] = [];
    const result = await runMacroSource({
      source: 'status "working"',
      progress: 'full',
      progressToken: 'progress-token-1',
      progressNotificationSink: async (entry) => notifications.push(entry),
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
      taskRegistry: new MacroTaskRegistry(),
    });

    expect(parseToolPayload(result.result)).toHaveProperty('progress');
    expect(notifications).toEqual([
      expect.objectContaining({ progressToken: 'progress-token-1', message: 'working' }),
    ]);
  });

  it('T-U-234 missing progressToken suppresses notification attempts', async () => {
    const notifications: unknown[] = [];
    await runMacroSource({
      source: 'status "working"',
      progress: 'full',
      progressNotificationSink: async (entry) => notifications.push(entry),
      config: config(),
      catalog: [],
      broker: new NullMcpBroker(),
      nativeDispatchContext: { signal: new AbortController().signal, instanceId: 'macro-handler-test', logContext: {} },
    });

    expect(notifications).toEqual([]);
  });

  it('preserves RegisterMacroToolsResult registrationSessionId fallback contract', () => {
    const source = readFileSync('src/mcp/tools/macro.ts', 'utf8');
    expect(source).toContain('RegisterMacroToolsResult');
    expect(source).toContain('registrationSessionId');
    expect(source).toContain('return { registrationSessionId }');
    expect(source).toContain('_meta?.progressToken');
    expect(source).toContain('notifications/progress');
    expect(source).toContain('sendNotification');
  });
});
