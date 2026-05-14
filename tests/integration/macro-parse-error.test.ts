import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { registerMacroTools } from '../../src/mcp/tools/macro.js';

const mockConfig = {
  instance: { id: 'macro-parse-error-test', vault: { path: '/tmp/vault' } },
  locking: { enabled: false },
} as unknown as FlashQueryConfig;

function createMacroHandler() {
  let handler: ((params: Record<string, unknown>) => unknown) | undefined;
  const server = {
    registerTool: (
      name: string,
      _cfg: unknown,
      registeredHandler: (params: Record<string, unknown>) => unknown
    ) => {
      if (name === 'call_macro') {
        handler = registeredHandler;
      }
    },
  } as unknown as McpServer;

  registerMacroTools(server, mockConfig);
  if (!handler) {
    throw new Error('call_macro handler was not registered');
  }
  return handler;
}

function parseToolText(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'
  ) as Record<string, unknown>;
}

describe('call_macro parse-error integration', () => {
  it('T-I-001 returns canonical parse_error for invalid inline source with isError false', () => {
    const callMacro = createMacroHandler();
    const result = callMacro({ source: 'for = 5' }) as { isError?: boolean };
    const payload = parseToolText(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'parse_error',
      details: {
        reason: 'reserved_keyword_assignment',
        at_line: 1,
        near_token: 'for',
      },
    });
  });
});
