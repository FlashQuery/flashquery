import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initLogger, logger } from '../../src/logging/logger.js';
import { logInvalidMcpSessionRequest } from '../../src/mcp/server.js';

describe('MCP session diagnostics', () => {
  beforeEach(() => {
    initLogger({ level: 'debug', output: 'stdout' }, () => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  it('logs unknown MCP session IDs at warn level with a redacted prefix', () => {
    logInvalidMcpSessionRequest({
      method: 'POST',
      path: '/mcp',
      sessionId: '12345678-90ab-cdef-1234-567890abcdef',
      activeSessionCount: 2,
      jsonRpcMethod: 'tools/call',
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown mcp-session-id=12345678...'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('POST /mcp'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('jsonrpc_method=tools/call'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('active_sessions=2'));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('90ab-cdef'));
  });

  it('logs missing MCP session IDs at warn level without leaking request body contents', () => {
    logInvalidMcpSessionRequest({
      method: 'POST',
      path: '/mcp',
      activeSessionCount: 1,
      jsonRpcMethod: 'tools/call',
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing mcp-session-id'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('POST /mcp'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('jsonrpc_method=tools/call'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('active_sessions=1'));
  });
});
