import { describe, expect, it } from 'vitest';
import { callResultFromTemplateText } from '../../src/mcp/host-template-tools.js';

function parseText(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('host-template JSON repair near-public integration', () => {
  it('T-E-001 T-E-003 maps repairable host-template success text to structuredContent', () => {
    const result = callResultFromTemplateText('```json\n{ok: true, result: { content: "repair success", count: 2, },}\n```');

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      ok: true,
      result: {
        content: 'repair success',
        count: 2,
      },
    });
    expect(result.content[0]?.text).toContain('```json');
    expect(result.structuredContent).not.toHaveProperty('repaired');
  });

  it('T-E-002 maps repairable host-template error text to structuredContent and isError', () => {
    const result = callResultFromTemplateText('{ok: false, error: {code: "template_failed", message: "No match",},}');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'template_failed',
        message: 'No match',
      },
    });
  });

  it('T-E-004 maps irreparable JSON-like host-template text to a bounded parseable error', () => {
    const result = callResultFromTemplateText('{ok: true, result: 1 2}');
    const payload = parseText(result);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(payload).toMatchObject({
      error: 'invalid_json_payload',
      message: 'Structured JSON payload could not be parsed.',
      details: {
        site: 'host_template_tool',
      },
    });
    expect(JSON.stringify(payload.details).length).toBeLessThan(600);
  });
});
