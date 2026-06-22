import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { parseLlmJson } from '../llm/json-repair.js';
import { logger } from '../logging/logger.js';
import type { MacroValue } from './runtime-types.js';

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
    const parsed = parseLlmJson(firstContent.text, z.unknown());
    if (parsed.ok) {
      return toMacroValue(parsed.data);
    }
    if (isJsonLikeText(firstContent.text)) {
      logger.warn(`Brokered tool result looked like JSON but could not be parsed: ${parsed.summary}`);
    }
    return firstContent.text;
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

function isJsonLikeText(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('```json') ||
    trimmed.startsWith('```')
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
