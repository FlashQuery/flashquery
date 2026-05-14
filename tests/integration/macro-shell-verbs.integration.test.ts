import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseMacroSource } from '../../src/macro/parser.js';

function parseProgram(source: string) {
  const parsed = parseMacroSource(source.trim());
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.program;
}

function parsePayload(result: Awaited<ReturnType<typeof evaluateProgram>>) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('macro shell verbs integration', () => {
  it('Phase 134 integration: executes shell verbs against a temp vault and preserves cwd isolation', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'fq-macro-shell-integration-'));
    await writeFile(join(vaultRoot, 'notes.md'), 'TODO one\nkeep\nTODO two\n');
    const cwdBefore = process.cwd();

    const result = await evaluateProgram(
      parseProgram(`
        matches = cat "/notes.md" | grep "TODO" | wc -l
        found = find "/" --name "*.md"
        exit { matches: $matches, found: $found, fq_exists: fq._exists(), broker_exists: brave_search._exists() }
      `),
      { vaultRoot }
    );
    const payload = parsePayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload['result']).toEqual({
      matches: 2,
      found: ['/notes.md'],
      fq_exists: true,
      broker_exists: false,
    });
    expect(process.cwd()).toBe(cwdBefore);
    expect(await readFile(join(vaultRoot, 'notes.md'), 'utf8')).toBe('TODO one\nkeep\nTODO two\n');
  });

  it('Phase 134 integration: rejects vault-jail escapes before host filesystem access', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'fq-macro-shell-integration-'));
    const result = await evaluateProgram(parseProgram('exit cat "../etc/passwd"'), { vaultRoot });
    const payload = parsePayload(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'forbidden_path',
      message: 'macro shell verbs cannot reach outside the vault root',
      details: { path: '../etc/passwd', reason: 'resolves_outside_vault' },
    });
  });
});
