import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coerceBrokerToolArguments,
  coerceCallToolResult,
  isCallToolErrorResult,
} from '../../src/macro/coerce.js';
import { logger } from '../../src/logging/logger.js';
import type { MacroValue } from '../../src/macro/evaluator.js';

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe('brokered CallToolResult macro coercion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T-U-032 treats isError as fail-fast before value binding', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'oops' }],
    };

    expect(isCallToolErrorResult(result)).toBe(true);
    expect(() => coerceCallToolResult(result)).toThrow(/Cannot coerce brokered error result/);
  });

  it('T-U-028 binds structuredContent before text content', () => {
    const result: CallToolResult = {
      structuredContent: { answer: 42, nested: { ok: true } },
      content: [{ type: 'text', text: '{"answer":"wrong"}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ answer: 42, nested: { ok: true } });
  });

  it('T-U-029 parses JSON text content when structuredContent is absent', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"count":2,"items":["a",null,true]}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ count: 2, items: ['a', null, true] });
  });

  it('T-U-029 repairs JSON-like text content when structuredContent is absent', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{count: 2, items: ["a", null, true,],}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ count: 2, items: ['a', null, true] });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('T-U-029 repairs fenced JSON-like text content when structuredContent is absent', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '```json\n{answer: 42, branch: "repaired", nested: { ok: true, },}\n```' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ answer: 42, branch: 'repaired', nested: { ok: true } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('T-U-029 parses JSON scalar text content when structuredContent is absent', () => {
    expect(coerceCallToolResult({ content: [{ type: 'text', text: '42' }] })).toBe(42);
    expect(coerceCallToolResult({ content: [{ type: 'text', text: 'null' }] })).toBeNull();
    expect(coerceCallToolResult({ content: [{ type: 'text', text: 'true' }] })).toBe(true);
    expect(coerceCallToolResult({ content: [{ type: 'text', text: '"hello"' }] })).toBe('hello');
  });

  it('T-U-030 binds non-JSON text content as a raw string without warning', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'plain answer' }],
    };

    expect(coerceCallToolResult(result)).toBe('plain answer');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('T-U-030 preserves comma-containing prose as a raw string without repair', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' }],
    };

    expect(coerceCallToolResult(result)).toBe('Lorem ipsum dolor sit amet, consectetur adipiscing elit.');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('T-U-031 binds malformed JSON-like text as a raw string and logs one warning', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"count": true false}' }],
    };

    expect(coerceCallToolResult(result)).toBe('{"count": true false}');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Brokered tool result looked like JSON'));
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
