import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseMacroSource } from '../../src/macro/parser.js';
import { resolveMacroSourceForRequest } from '../../src/mcp/tools/macro.js';
import { parseToolPayload, resultOf } from './macro-test-helpers.js';

function config(vaultPath = process.cwd()): FlashQueryConfig {
  return {
    instance: { id: 'macro-self-test', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    server: {},
    macro: { defaultTimeoutMs: 60000 },
  } as FlashQueryConfig;
}

function mockSupabaseClient(fqcId = 'doc-fq-id') {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: { id: fqcId }, error: null }),
  };
  return {
    from: () => query,
  };
}

function parseProgram(source: string) {
  const parsed = parseMacroSource(source.trim(), 'macro-self-test.fqm');
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.program;
}

describe('macro _self source_ref binding', () => {
  it('T-U-038 returns the required runtime error when inline source accesses _self.path', async () => {
    const result = await evaluateProgram(parseProgram('exit _self.path'));

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'tool_call_failed',
      message: '`_self` is only available when the macro was loaded via source_ref.',
      details: { reason: 'self_requires_source_ref' },
    });
  });

  it('T-U-038 binds _self.path, frontmatter, title, tags, and fq_id from source_ref metadata', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-macro-self-'));
    try {
      await writeFile(
        join(vaultPath, 'rundoc.md'),
        [
          '---',
          'title: Source Rundoc',
          'tags:',
          '  - macro',
          '  - rundoc',
          'fq_id: frontmatter-fq-id',
          'targets:',
          '  - alpha',
          '  - beta',
          '---',
          '',
          '# Source Rundoc',
          '',
          '```fqm name=selected',
          'exit { path: _self.path, title: _self.title, tags: _self.tags, fq_id: _self.fq_id, targets: _self.frontmatter.targets }',
          '```',
          '',
        ].join('\n')
      );

      const resolved = await resolveMacroSourceForRequest({
        source_ref: 'rundoc.md::selected',
        config: config(vaultPath),
        supabase: mockSupabaseClient('db-fq-id') as never,
      });

      expect(resolved.ok).toBe(true);
      if (!resolved.ok) throw new Error('source_ref did not resolve');
      expect(resolved.identifier).toBe('rundoc.md::selected');
      expect((resolved as { self?: unknown }).self).toMatchObject({
        path: 'rundoc.md',
        title: 'Source Rundoc',
        tags: ['macro', 'rundoc'],
        fq_id: 'frontmatter-fq-id',
        frontmatter: { targets: ['alpha', 'beta'] },
      });

      const result = await evaluateProgram(parseProgram(resolved.source), {
        self: (resolved as { self?: unknown }).self,
      } as never);

      expect(resultOf(parseToolPayload(result))).toEqual({
        path: 'rundoc.md',
        title: 'Source Rundoc',
        tags: ['macro', 'rundoc'],
        fq_id: 'frontmatter-fq-id',
        targets: ['alpha', 'beta'],
      });
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('T-U-039 rejects assignments to _self.path and _self.frontmatter.x at parse time', () => {
    for (const source of ['_self.path = "x"', '_self.frontmatter.x = 1']) {
      const parsed = parseMacroSource(source, 'macro-self-test.fqm');
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error('expected parse failure');
      expect(parsed.error).toMatchObject({
        error: 'parse_error',
        details: { reason: 'readonly_self_assignment' },
      });
    }
  });

  it('T-S-006/T-S-007 unit analogue clones _self.frontmatter at the evaluator boundary', async () => {
    const original = {
      path: 'rundoc.md',
      frontmatter: { targets: ['alpha'], nested: { status: 'planned' } },
      title: 'Snapshot',
      tags: ['macro'],
      fq_id: 'snapshot-id',
    };
    const program = parseProgram('exit { targets: _self.frontmatter.targets, status: _self.frontmatter.nested.status }');
    const run = evaluateProgram(program, { self: original } as never);

    original.frontmatter.targets.push('beta');
    original.frontmatter.nested.status = 'mutated';

    const result = await run;
    expect(resultOf(parseToolPayload(result))).toEqual({
      targets: ['alpha'],
      status: 'planned',
    });
  });
});
