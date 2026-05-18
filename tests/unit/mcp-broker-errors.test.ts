import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { formatToolError, stripRawFromToolError } from '../../src/services/mcp-broker/errors.js';

describe('mcp broker error normalization', () => {
  it('T-U-008 maps CallToolResult isError envelopes to is_error_result', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'upstream failed' }],
    };

    expect(formatToolError(result, { serverId: 'brave_search', toolName: 'web_search' })).toMatchObject({
      kind: 'is_error_result',
      message: 'upstream failed',
      serverId: 'brave_search',
      toolName: 'web_search',
      raw: result,
    });
  });

  it('T-U-009 maps McpError MethodNotFound to unsupported_method', () => {
    const error = new McpError(ErrorCode.MethodNotFound, 'No such method', { method: 'tools/call' });

    expect(formatToolError(error)).toMatchObject({
      kind: 'unsupported_method',
      code: ErrorCode.MethodNotFound,
      message: 'No such method',
      raw: error,
    });
  });

  it('T-U-010 maps McpError InvalidParams to bad_args', () => {
    const error = new McpError(ErrorCode.InvalidParams, 'Bad arguments', { field: 'q' });

    expect(formatToolError(error)).toMatchObject({
      kind: 'bad_args',
      code: ErrorCode.InvalidParams,
      message: 'Bad arguments',
    });
  });

  it('T-U-011 maps native EPIPE errors to transport_closed', () => {
    expect(formatToolError(new Error('write EPIPE'))).toMatchObject({
      kind: 'transport_closed',
      message: 'write EPIPE',
    });
  });

  it('T-U-012 maps timeout errors to server_timeout', () => {
    expect(formatToolError(new Error('Request timed out after 30000ms'))).toMatchObject({
      kind: 'server_timeout',
    });
  });

  it('T-U-013 maps spawn ENOENT errors to server_crashed', () => {
    expect(formatToolError(new Error('spawn ENOENT'))).toMatchObject({
      kind: 'server_crashed',
    });
  });

  it('T-U-014 marks experimental task API errors with experimental_tasks_required subkind', () => {
    const error = new McpError(ErrorCode.MethodNotFound, 'This tool requires task-based execution via callToolStream');

    expect(formatToolError(error)).toMatchObject({
      kind: 'unsupported_method',
      subkind: 'experimental_tasks_required',
    });
  });

  it('T-U-015 strips raw before process-boundary serialization', () => {
    const error = formatToolError(new Error('secret token should stay raw'));
    const serialized = stripRawFromToolError(error);

    expect(serialized).toMatchObject({
      kind: 'unknown',
      message: 'secret token should stay raw',
    });
    expect(serialized).not.toHaveProperty('raw');
  });
});
