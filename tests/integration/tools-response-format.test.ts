import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { jsonExpectedError, jsonToolResult } from '../../src/mcp/utils/response-formats.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

function parseToolText(result: { content: Array<{ type: string; text: string }> }): unknown {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '');
}

function captureHandlers(register: (server: McpServer) => void): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;

  register(server);
  return handlers;
}

function minimalConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'response-format-integration',
      id: `response-format-${Date.now()}`,
      vault: {
        path: '/tmp/flashquery-response-format-test-vault',
        markdownExtensions: ['.md'],
      },
    },
    supabase: {
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'test-service-role-key',
      databaseUrl: '',
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: '',
      dimensions: 1536,
    },
    locking: { enabled: false },
  } as FlashQueryConfig;
}

describe('Integration: JSON response helper smoke paths', () => {
  it('parses a helper-backed representative success response as JSON', async () => {
    const handler: ToolHandler = async () =>
      jsonToolResult({
        identifier: 'docs/example.md',
        title: 'Example',
        path: 'docs/example.md',
        fq_id: 'doc-1',
        modified: '2026-05-11T00:00:00.000Z',
        size: { chars: 7 },
      });

    const result = await handler({});
    const parsed = parseToolText(result);

    expect(result.isError).toBeUndefined();
    expect(parsed).toMatchObject({
      identifier: 'docs/example.md',
      title: 'Example',
      size: { chars: 7 },
    });
  });

  it('parses a helper-backed expected error response without runtime isError', async () => {
    const handler: ToolHandler = async () =>
      jsonExpectedError({
        error: 'not_found',
        message: 'No document found for identifier: missing.md',
        identifier: 'missing.md',
      });

    const result = await handler({});
    const parsed = parseToolText(result);

    expect(result.isError).toBe(false);
    expect(parsed).toEqual({
      error: 'not_found',
      message: 'No document found for identifier: missing.md',
      identifier: 'missing.md',
    });
  });

  it('routes get_document expected validation errors through parseable JSON with isError false', async () => {
    const handlers = captureHandlers((server) => registerDocumentTools(server, minimalConfig()));
    const result = await handlers.get_document({
      identifiers: 'docs/example.md',
      include: ['headings'],
      sections: ['Missing'],
    });

    const parsed = parseToolText(result);

    expect(result.isError).toBe(false);
    expect(parsed).toMatchObject({
      error: 'invalid_input',
      message: 'sections requires "body" in include',
      details: { conflict: 'sections_without_body' },
    });
  });
});
