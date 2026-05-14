import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { shellBuiltins } from '../../src/macro/shell-verbs.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

async function makeVault() {
  const vaultRoot = await mkdtemp(join(tmpdir(), 'fq-macro-shell-'));
  await writeFile(
    join(vaultRoot, 'notes.md'),
    ['Alpha TODO', 'beta done', 'Gamma todo', 'Alpha keep'].join('\n') + '\n'
  );
  await writeFile(join(vaultRoot, 'other.txt'), ['plain', 'TODO second'].join('\n') + '\n');
  await writeFile(join(vaultRoot, '.hidden'), 'hidden\n');
  await writeFile(join(vaultRoot, 'empty.log'), '');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(join(vaultRoot, 'docs')));
  await writeFile(join(vaultRoot, 'docs', 'child.md'), ['child', 'TODO child'].join('\n') + '\n');
  return vaultRoot;
}

async function run(source: string, vaultRoot: string) {
  const result = await evaluateProgram(parseProgram(source), { vaultRoot });
  return { result, payload: parseToolPayload(result) };
}

describe('macro shell verb builtins', () => {
  it('T-U-126 grep PATTERN file supports grep -i, grep -v, grep -c, grep -l, and grep -n', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit grep "Alpha" "/notes.md"', vaultRoot)).payload)).toEqual([
      'Alpha TODO',
      'Alpha keep',
    ]);
    expect(resultOf((await run('exit grep -i "todo" "/notes.md"', vaultRoot)).payload)).toEqual([
      'Alpha TODO',
      'Gamma todo',
    ]);
    expect(resultOf((await run('exit grep -v "Alpha" "/notes.md"', vaultRoot)).payload)).toEqual([
      'beta done',
      'Gamma todo',
    ]);
    expect(resultOf((await run('exit grep -c "Alpha" "/notes.md"', vaultRoot)).payload)).toBe(2);
    expect(resultOf((await run('exit grep -l "TODO" "/*.md"', vaultRoot)).payload)).toEqual([
      '/notes.md',
    ]);
    expect(resultOf((await run('exit grep -n "Alpha" "/notes.md"', vaultRoot)).payload)).toEqual([
      '1:Alpha TODO',
      '4:Alpha keep',
    ]);
  });

  it('T-U-127 find --name and find --type return vault-rooted matching paths', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit find "/" --name "*.md"', vaultRoot)).payload)).toEqual([
      '/docs/child.md',
      '/notes.md',
    ]);
    expect(resultOf((await run('exit find "/" --type "f"', vaultRoot)).payload)).toContain(
      '/notes.md'
    );
    expect(resultOf((await run('exit find "/" --type "d"', vaultRoot)).payload)).toContain(
      '/docs'
    );
  });

  it('T-U-128 sed "s/OLD/NEW/g" file returns rewritten text and does not mutate the file', async () => {
    const vaultRoot = await makeVault();
    const before = await readFile(join(vaultRoot, 'notes.md'), 'utf8');

    const { payload } = await run('exit sed "s/Alpha/Omega/g" "/notes.md"', vaultRoot);

    expect(resultOf(payload)).toContain('Omega TODO');
    expect(resultOf(payload)).not.toContain('Alpha TODO');
    expect(await readFile(join(vaultRoot, 'notes.md'), 'utf8')).toBe(before);
  });

  it('T-U-129 cat file returns file contents', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit cat "/other.txt"', vaultRoot)).payload)).toBe(
      'plain\nTODO second\n'
    );
  });

  it('T-U-130 wc -l, wc -w, and wc -c return counts', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit wc -l "/notes.md"', vaultRoot)).payload)).toBe(4);
    expect(resultOf((await run('exit wc -w "/notes.md"', vaultRoot)).payload)).toBe(8);
    expect(resultOf((await run('exit wc -c "/notes.md"', vaultRoot)).payload)).toBe(
      Buffer.byteLength('Alpha TODO\nbeta done\nGamma todo\nAlpha keep\n')
    );
  });

  it('T-U-131 head -n returns first lines and T-U-132 tail -n returns last lines', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit head -n 3 "/notes.md"', vaultRoot)).payload)).toEqual([
      'Alpha TODO',
      'beta done',
      'Gamma todo',
    ]);
    expect(resultOf((await run('exit tail -n 3 "/notes.md"', vaultRoot)).payload)).toEqual([
      'beta done',
      'Gamma todo',
      'Alpha keep',
    ]);
  });

  it('T-U-133 ls path supports ls -A, ls -d, ls -l, and ls -R', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit ls "/"', vaultRoot)).payload)).toEqual([
      'docs',
      'empty.log',
      'notes.md',
      'other.txt',
    ]);
    expect(resultOf((await run('exit ls -A "/"', vaultRoot)).payload)).toContain('.hidden');
    expect(resultOf((await run('exit ls -d "/docs"', vaultRoot)).payload)).toEqual(['/docs']);
    expect(resultOf((await run('exit ls -l "/"', vaultRoot)).payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'notes.md', size: expect.any(Number), mtime: expect.any(String) }),
      ])
    );
    expect(resultOf((await run('exit ls -R "/"', vaultRoot)).payload)).toEqual(
      expect.arrayContaining(['/docs', '/docs/child.md', '/notes.md'])
    );
  });

  it('T-U-134 exposes exactly read-only shell registry keys and no mutation verbs', () => {
    expect(Object.keys(shellBuiltins).sort()).toEqual([
      'cat',
      'find',
      'grep',
      'head',
      'ls',
      'sed',
      'tail',
      'wc',
    ]);
    for (const verb of ['cp', 'mv', 'rm', 'mkdir', 'touch', 'chmod', 'exec']) {
      expect(shellBuiltins).not.toHaveProperty(verb);
    }
  });

  it('T-U-135 cat file | grep PATTERN | wc -l works end to end', async () => {
    const vaultRoot = await makeVault();

    const { payload } = await run('exit cat "/notes.md" | grep "Alpha" | wc -l', vaultRoot);

    expect(resultOf(payload)).toBe(2);
  });

  it('T-U-136 matching globs expand and empty glob matches return explicit errors', async () => {
    const vaultRoot = await makeVault();

    expect(resultOf((await run('exit cat "/*.md" | grep "TODO" | wc -l', vaultRoot)).payload)).toBe(
      1
    );
    const empty = await run('exit cat "/*.missing"', vaultRoot);
    expect(empty.result.isError).toBe(true);
    expect(empty.payload).toMatchObject({ details: { reason: 'glob_no_matches' } });
  });

  it('T-U-143 production macro source does not mutate process cwd', async () => {
    const files = await readdir('src/macro');
    const contents = await Promise.all(
      files
        .filter((file) => file.endsWith('.ts'))
        .map(async (file) => readFile(join('src/macro', file), 'utf8'))
    );

    expect(contents.join('\n')).not.toMatch(/sh\.cd\(|shelljs\.cd\(|process\.chdir\(/);
  });

  it('T-U-151 concurrent evaluations isolate vault roots and preserve process cwd', async () => {
    const firstVault = await makeVault();
    const secondVault = await makeVault();
    await writeFile(join(firstVault, 'marker.md'), 'first-only\n');
    await writeFile(join(secondVault, 'marker.md'), 'second-only\n');
    const cwdBefore = process.cwd();

    const [first, second] = await Promise.all([
      run('exit cat "/marker.md"', firstVault),
      run('exit cat "/marker.md"', secondVault),
    ]);

    expect(resultOf(first.payload)).toBe('first-only\n');
    expect(resultOf(second.payload)).toBe('second-only\n');
    expect(process.cwd()).toBe(cwdBefore);
  });
});
