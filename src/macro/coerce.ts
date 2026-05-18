import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MacroValue } from './evaluator.js';

export function isCallToolErrorResult(result: CallToolResult): boolean {
  return result.isError === true;
}

export function coerceCallToolResult(result: CallToolResult): MacroValue {
  if (isCallToolErrorResult(result)) {
    throw new Error('Cannot coerce brokered error result; check isError before value binding.');
  }

  if (result.structuredContent !== undefined) {
    return toMacroValue(result.structuredContent);
  }

  const firstContent = result.content[0];
  if (isTextContent(firstContent)) {
    try {
      return toMacroValue(JSON.parse(firstContent.text) as unknown);
    } catch {
      return firstContent.text;
    }
  }

  return toMacroValue(result);
}

export function coerceBrokerToolArguments(args: Record<string, MacroValue>): Record<string, MacroValue> {
  return toMacroValue(args) as Record<string, MacroValue>;
}

function isTextContent(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

function toMacroValue(value: unknown): MacroValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toMacroValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toMacroValue(entry)])
    );
  }
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name === '' ? '[function]' : value.name;
  return null;
}
