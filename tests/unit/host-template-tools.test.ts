import { describe, expect, it } from 'vitest';
import { callResultFromTemplateText } from '../../src/mcp/host-template-tools.js';

function parseText(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}

describe('host template tool payload parsing', () => {
  it('T-U-015 repairs ok:true payloads into structuredContent without isError', () => {
    const result = callResultFromTemplateText('```json\n{ok: true, result: { answer: 42, },}\n```');

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true, result: { answer: 42 } });
    expect(result.content).toEqual([
      { type: 'text', text: '```json\n{ok: true, result: { answer: 42, },}\n```' },
    ]);
  });

  it('T-U-016 repairs ok:false payloads into structuredContent and sets isError', () => {
    const result = callResultFromTemplateText('{ok: false, error: "template_failed", message: "No match",}');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: 'template_failed',
      message: 'No match',
    });
  });

  it('T-U-017 and T-U-022 mark irreparable JSON-like payloads as bounded invalid_json_payload errors', () => {
    const result = callResultFromTemplateText('{ok: true, result: 1 2}');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(parseText(result)).toMatchObject({
      error: 'invalid_json_payload',
      message: 'Structured JSON payload could not be parsed.',
      details: {
        site: 'host_template_tool',
      },
    });
    const details = parseText(result).details as Record<string, unknown>;
    expect(JSON.stringify(details).length).toBeLessThan(600);
  });

  it('T-U-018 leaves ordinary prose text-only without isError', () => {
    const result = callResultFromTemplateText('ordinary prose answer');

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ordinary prose answer' }],
    });
  });
});
