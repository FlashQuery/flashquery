import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';

async function run(source: string) {
  const result = await evaluateProgram(parseProgram(source));
  return { result, payload: parseToolPayload(result) };
}

function expectForbiddenFlag(
  payload: Record<string, unknown>,
  details: { verb: string; flag: string; reason: string; line?: number }
) {
  expect(payload).toMatchObject({
    error: 'forbidden_shell_flag',
    message: 'Macro shell flag is forbidden.',
    details,
  });
}

describe('macro forbidden shell flag pre-scan', () => {
  it('T-U-144 rejects sed -i before execution', async () => {
    const { result, payload } = await run('sed -i "s/a/b/" "file.md"');

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'sed',
      flag: '-i',
      reason: 'sed_in_place_mutates_files',
      line: 1,
    });
  });

  it('T-U-145 rejects sed --in-place before execution', async () => {
    const { result, payload } = await run('sed --in-place "s/a/b/" "file.md"');

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'sed',
      flag: '--in-place',
      reason: 'sed_in_place_mutates_files',
      line: 1,
    });
  });

  it('T-U-146 rejects bundled sed -ie before execution', async () => {
    const { result, payload } = await run('sed -ie "s/a/b/" "file.md"');

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'sed',
      flag: '-ie',
      reason: 'sed_in_place_mutates_files',
      line: 1,
    });
  });

  it('T-U-147 rejects find -exec before execution', async () => {
    const { result, payload } = await run('find "/" -exec "echo" "{}"');

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'find',
      flag: '-exec',
      reason: 'find_exec_mutates_or_executes',
      line: 1,
    });
  });

  it('T-U-148 rejects find --delete before execution', async () => {
    const { result, payload } = await run('find "/" --delete 1');

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'find',
      flag: '--delete',
      reason: 'find_delete_mutates_files',
      line: 1,
    });
  });

  it('T-U-149 catches forbidden flags inside nested loop and conditional bodies', async () => {
    const { result, payload } = await run(`
      for path in ["a.md"] do
        if count [$path] > 0 then
          while null do
            find "/" --exec "echo" "{}"
          done
        fi
      done
    `);

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'find',
      flag: '--exec',
      reason: 'find_exec_mutates_or_executes',
      line: 5,
    });
  });

  it('T-U-150 does not execute earlier statements before a later forbidden flag', async () => {
    const { result, payload } = await run(`
      echo "before"
      find "/" -delete
    `);

    expect(result.isError).toBe(false);
    expectForbiddenFlag(payload, {
      verb: 'find',
      flag: '-delete',
      reason: 'find_delete_mutates_files',
      line: 2,
    });
    expect(payload['log']).toBeUndefined();
    expect(payload['trace']).toBeUndefined();
    expect(JSON.stringify(payload['log'] ?? '')).not.toContain('before');
    expect(JSON.stringify(payload['trace'] ?? '')).not.toContain('before');
  });

  it('allows non-mutating sed and find flags', async () => {
    const { result, payload } = await run('exit { sed: sed --n "s/a/b/" "file.md", find: find "/" --name "*.md" }');

    expect(result.isError).toBe(true);
    expect(payload).not.toMatchObject({ error: 'forbidden_shell_flag' });
  });
});
