import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NormalizedToolError, ToolErrorKind } from './types.js';

const EXPERIMENTAL_TASKS_PATTERN = /requires task-based execution|callToolStream/i;

export interface FormatToolErrorContext {
  serverId?: string;
  toolName?: string;
}

export type SerializedToolError = Omit<NormalizedToolError, 'raw'>;

export class NormalizedToolErrorObject extends Error implements NormalizedToolError {
  readonly kind: ToolErrorKind;
  readonly serverId?: string;
  readonly toolName?: string;
  readonly code?: number | string;
  readonly subkind?: string;
  readonly raw?: unknown;

  constructor(error: NormalizedToolError) {
    super(error.message);
    this.name = 'NormalizedToolError';
    this.kind = error.kind;
    this.serverId = error.serverId;
    this.toolName = error.toolName;
    this.code = error.code;
    this.subkind = error.subkind;
    this.raw = error.raw;
  }
}

export function formatToolError(input: unknown, context: FormatToolErrorContext = {}): NormalizedToolError {
  if (isNormalizedToolError(input)) {
    return withContext(input, context);
  }

  if (isCallToolErrorResult(input)) {
    return withContext(
      {
        kind: 'is_error_result',
        message: extractCallToolResultMessage(input),
        raw: input,
      },
      context
    );
  }

  if (isMcpErrorLike(input)) {
    return withContext(
      {
        kind: mapMcpErrorKind(input),
        message: normalizeMcpMessage(input),
        code: input.code,
        ...(EXPERIMENTAL_TASKS_PATTERN.test(input.message) ? { subkind: 'experimental_tasks_required' } : {}),
        raw: input,
      },
      context
    );
  }

  if (input instanceof Error) {
    return withContext(
      {
        kind: mapNativeErrorKind(input),
        message: input.message,
        raw: input,
      },
      context
    );
  }

  return withContext(
    {
      kind: 'unknown',
      message: stringifyUnknown(input),
      raw: input,
    },
    context
  );
}

export function toThrowableToolError(error: NormalizedToolError): NormalizedToolErrorObject {
  return new NormalizedToolErrorObject(error);
}

function isNormalizedToolError(value: unknown): value is NormalizedToolError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function stripRawFromToolError(error: NormalizedToolError): SerializedToolError {
  const { raw: _raw, ...serialized } = error;
  return serialized;
}

function withContext(error: NormalizedToolError, context: FormatToolErrorContext): NormalizedToolError {
  return {
    ...error,
    ...(context.serverId === undefined ? {} : { serverId: context.serverId }),
    ...(context.toolName === undefined ? {} : { toolName: context.toolName }),
  };
}

function isCallToolErrorResult(value: unknown): value is CallToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isError' in value &&
    (value as { isError?: unknown }).isError === true &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function extractCallToolResultMessage(result: CallToolResult): string {
  const firstText = result.content.find(
    (item): item is { type: 'text'; text: string } =>
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string'
  );
  return firstText?.text ?? 'Brokered tool returned an error result.';
}

function isMcpErrorLike(value: unknown): value is McpError {
  return value instanceof McpError || (value instanceof Error && typeof (value as { code?: unknown }).code === 'number');
}

function mapMcpErrorKind(error: Pick<McpError, 'code'>): ToolErrorKind {
  const code = Number(error.code);
  if (code === Number(ErrorCode.MethodNotFound)) return 'unsupported_method';
  if (code === Number(ErrorCode.InvalidParams)) return 'bad_args';
  if (code === Number(ErrorCode.ConnectionClosed)) return 'transport_closed';
  if (code === Number(ErrorCode.RequestTimeout)) return 'server_timeout';
  return 'unknown';
}

function normalizeMcpMessage(error: Pick<McpError, 'code' | 'message'>): string {
  return error.message.replace(new RegExp(`^MCP error ${error.code}:\\s*`), '');
}

function mapNativeErrorKind(error: Error): ToolErrorKind {
  const message = error.message;
  const codeValue = (error as { code?: unknown }).code;
  const code = typeof codeValue === 'string' ? codeValue : '';
  const combined = `${code} ${message}`;

  if (/\bEPIPE\b|Connection closed|transport closed/i.test(combined)) return 'transport_closed';
  if (/timed out|timeout|RequestTimeout/i.test(combined)) return 'server_timeout';
  if (/spawn .*ENOENT|ENOENT|exited|crashed/i.test(combined)) return 'server_crashed';
  return 'unknown';
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'Unknown broker error: null';
  if (value === undefined) return 'Unknown broker error: undefined';
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
