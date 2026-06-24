import type { ToolResult } from '../mcp/utils/response-formats.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  withWarnings,
  type WarningCode,
} from '../mcp/utils/response-formats.js';

export interface GraphSuccessEnvelope<TData> {
  ok: true;
  action: string;
  data: TData;
  warnings?: WarningCode[];
}

export function graphToolResult<TData>(
  action: string,
  data: TData,
  warnings: WarningCode[] = []
): ToolResult {
  return jsonToolResult(withWarnings({ ok: true, action, data }, warnings));
}

export function graphExpectedError(input: {
  action?: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): ToolResult {
  return jsonExpectedError({
    error: 'invalid_input',
    message: input.message,
    details: {
      code: input.code,
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.details ?? {}),
    },
  });
}

export function graphRuntimeError(input: {
  action?: string;
  message: string;
  details?: Record<string, unknown>;
}): ToolResult {
  return jsonRuntimeError({
    error: 'runtime_error',
    message: input.message,
    details: {
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.details ?? {}),
    },
  });
}
