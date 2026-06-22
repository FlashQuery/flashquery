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
