import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import {
  coerceBrokerToolArguments,
  coerceCallToolResult,
  isCallToolErrorResult,
} from '../../src/macro/coerce.js';
import type { MacroValue } from '../../src/macro/evaluator.js';

describe('brokered CallToolResult macro coercion', () => {
  it('T-U-016 treats isError as fail-fast before value binding', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'oops' }],
    };

    expect(isCallToolErrorResult(result)).toBe(true);
    expect(() => coerceCallToolResult(result)).toThrow(/Cannot coerce brokered error result/);
  });

  it('T-U-017 binds structuredContent before text content', () => {
    const result: CallToolResult = {
      structuredContent: { answer: 42, nested: { ok: true } },
      content: [{ type: 'text', text: '{"answer":"wrong"}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ answer: 42, nested: { ok: true } });
  });

  it('T-U-018 parses JSON text content when structuredContent is absent', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"count":2,"items":["a",null,true]}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ count: 2, items: ['a', null, true] });
  });

  it('T-U-019 binds non-JSON text content as a raw string', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'plain answer' }],
    };

    expect(coerceCallToolResult(result)).toBe('plain answer');
  });

  it('T-U-020 binds multimodal content as the full envelope converted to MacroValue', () => {
    const result: CallToolResult = {
      content: [
        {
          type: 'image',
          data: 'base64-data',
          mimeType: 'image/png',
        },
      ],
    };

    expect(coerceCallToolResult(result)).toEqual({
      content: [{ type: 'image', data: 'base64-data', mimeType: 'image/png' }],
    });
  });

  it('T-U-021 preserves macro argument JSON types without engine coercion', () => {
    const args: Record<string, MacroValue> = {
      int: 42,
      stringInt: '42',
      bool: true,
      nil: null,
      nested: {
        array: [1, '1', false, null, { deep: 'value' }],
      },
    };

    expect(coerceBrokerToolArguments(args)).toEqual(args);
    expect(JSON.stringify(coerceBrokerToolArguments(args))).toBe(JSON.stringify(args));
  });
});
