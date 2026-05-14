import { expect } from 'vitest';
import { parseMacroSource } from '../../src/macro/parser.js';
import type { MacroBuiltin, MacroValue } from '../../src/macro/evaluator.js';
import type { Program } from '../../src/macro/types.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';

export function parseProgram(source: string): Program {
  const result = parseMacroSource(source.trim());
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.program;
}

export function parseToolPayload(result: ToolResult): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}

export function basicBuiltins(extra: Record<string, MacroBuiltin> = {}): Record<string, MacroBuiltin> {
  const builtins: Record<string, MacroBuiltin> = {
    add: (positional) => Number(positional[0] ?? 0) + Number(positional[1] ?? 0),
    echo: (positional) => positional[0] ?? null,
    exit: (positional) => positional[0] ?? null,
    ...extra,
  };
  return builtins;
}

export function resultOf(payload: Record<string, unknown>): MacroValue {
  return payload['result'] as MacroValue;
}
