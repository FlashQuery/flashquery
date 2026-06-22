import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseLlmJson } from '../../src/llm/json-repair.js';

describe('LLM JSON repair parser foundation', () => {
  it('T-U-001 imports parseLlmJson through ESM and repairs jsonrepair-compatible text', () => {
    const result = parseLlmJson('{ok: true}', z.object({ ok: z.boolean() }));

    expect(result).toMatchObject({
      ok: true,
      data: { ok: true },
      raw: '{ok: true}',
      repaired: true,
    });
  });

  it('T-U-002 keeps the parser source free of macro and MCP imports', () => {
    const source = readFileSync(new URL('../../src/llm/json-repair.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/from ['"](?:\.\.\/macro|\.\.\/mcp|\.\.\/\.\.\/macro|\.\.\/\.\.\/mcp)/);
  });
});

describe('parseLlmJson result contract', () => {
  const payloadSchema = z.object({
    ok: z.boolean(),
    label: z.string().optional(),
    items: z.array(z.number()).optional(),
  });

  it('T-U-003 returns typed success metadata for valid JSON', () => {
    const raw = '{"ok":true,"label":"ready"}';
    const result = parseLlmJson(raw, payloadSchema);

    expect(result).toEqual({
      ok: true,
      data: { ok: true, label: 'ready' },
      raw,
      repaired: false,
    });
  });

  it.each([
    ['fenced JSON', '```json\n{"ok": true, "label": "fenced",}\n```', { ok: true, label: 'fenced' }],
    ['trailing comma', '{"ok": true,}', { ok: true }],
    ['single quotes', "{'ok': true, 'label': 'single'}", { ok: true, label: 'single' }],
    ['unquoted keys', '{ok: true, label: "keys"}', { ok: true, label: 'keys' }],
  ])('T-U-004 repairs %s and validates the result', (_name, raw, expected) => {
    const result = parseLlmJson(raw, payloadSchema);

    expect(result).toMatchObject({
      ok: true,
      data: expected,
      raw,
      repaired: true,
    });
  });

  it('T-U-004a repairs smart quotes in keys and string values', () => {
    const raw = '{“ok”: true, “label”: “smart”}';
    const result = parseLlmJson(raw, payloadSchema);

    expect(result).toMatchObject({
      ok: true,
      data: { ok: true, label: 'smart' },
      raw,
      repaired: true,
    });
  });

  it('T-U-004b repairs truncated JSON objects', () => {
    const raw = '{"ok": true, "label": "truncated"';
    const result = parseLlmJson(raw, payloadSchema);

    expect(result).toMatchObject({
      ok: true,
      data: { ok: true, label: 'truncated' },
      raw,
      repaired: true,
    });
  });

  it('T-U-004c repairs missing nested closing brackets', () => {
    const raw = '{"ok": true, "items": [1, 2';
    const result = parseLlmJson(raw, payloadSchema);

    expect(result).toMatchObject({
      ok: true,
      data: { ok: true, items: [1, 2] },
      raw,
      repaired: true,
    });
  });

  it('T-U-004d supports schema-free parsing with z.unknown()', () => {
    const result = parseLlmJson('[1, 2, 3]', z.unknown());

    expect(result).toEqual({
      ok: true,
      data: [1, 2, 3],
      raw: '[1, 2, 3]',
      repaired: false,
    });
  });

  it('T-U-005 returns a schema failure with machine-readable issues without throwing', () => {
    const result = parseLlmJson('{"ok":"yes"}', payloadSchema);

    expect(result).toMatchObject({
      ok: false,
      raw: '{"ok":"yes"}',
      repaired: false,
      failure: 'schema',
      issues: [{ path: ['ok'], message: expect.any(String) }],
      summary: expect.stringContaining('ok'),
    });
  });

  it('T-U-006 returns a syntax failure for irreparable syntax without throwing', () => {
    expect(() => parseLlmJson('}', z.unknown())).not.toThrow();

    const result = parseLlmJson('}', z.unknown());
    expect(result).toMatchObject({
      ok: false,
      raw: '}',
      repaired: false,
      failure: 'syntax',
      summary: expect.stringContaining('JSON syntax'),
    });
  });

  it('T-U-006a catches jsonrepair failures and reports syntax failure metadata', () => {
    const result = parseLlmJson('{"ok": true,,}', payloadSchema);

    expect(result).toMatchObject({
      ok: false,
      raw: '{"ok": true,,}',
      repaired: false,
      failure: 'syntax',
      summary: expect.stringContaining('JSON syntax'),
    });
  });
});
