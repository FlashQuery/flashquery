// Production coverage for the 8-Jun-2026 surgical-editing update
// (Spec §12 / REQ-064..068): echo value-piping, --scope region selection,
// and sed -i scope-aware in-place editing. Mirrors the golden-model suite
// (tests/unit/macro-golden-surgical-edit.test.ts) against src/macro.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

const FM_DOC =
  '---\nfq_id: doc-123\nfq_status: draft\ntitle: Limits\n---\n' +
  'default_limit: 100\nburst_limit: 20\nkeep: me\n';
const PLAIN_DOC = 'default_limit: 100\nburst_limit: 20\nkeep: me\n';

async function run(source: string, vaultRoot?: string) {
  const result = await evaluateProgram(parseProgram(source), vaultRoot ? { vaultRoot } : {});
  return parseToolPayload(result);
}

function reasonOf(payload: Record<string, unknown>): unknown {
  return (payload['details'] as { reason?: unknown } | undefined)?.reason;
}

describe('REQ-064 echo is value-producing', () => {
  it('returns the joined string and binds in assignment', async () => {
    const payload = await run('x = echo "a" "b"\nexit { x: $x }');
    expect(resultOf(payload)).toEqual({ x: 'a b' });
  });

  it('pipes its value into sed (regression of stdin_type_mismatch)', async () => {
    const payload = await run('out = echo "hello world" | sed "s/world/there/"\nexit { out: $out }');
    expect(payload['error']).toBeUndefined();
    // Production's pipeline linesToText appends a trailing newline (pre-existing
    // behavior); the point is the substitution applied to the piped value.
    expect(resultOf(payload)).toEqual({ out: 'hello there\n' });
  });
});

describe('REQ-065 --scope region selection (read)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fq-scope-'));
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    await writeFile(join(dir, 'p.md'), PLAIN_DOC);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('cat defaults to body on a frontmatter doc', async () => {
    const b = resultOf(await run('exit cat "/doc.md"', dir)) as string;
    expect(b).toContain('default_limit: 100');
    expect(b).not.toContain('fq_id');
  });

  it('cat --scope "both" returns the whole raw file', async () => {
    const b = resultOf(await run('exit cat --scope "both" "/doc.md"', dir)) as string;
    expect(b).toContain('fq_id: doc-123');
    expect(b).toContain('default_limit: 100');
  });

  it('cat --scope "frontmatter" returns the YAML block only', async () => {
    const b = resultOf(await run('exit cat --scope "frontmatter" "/doc.md"', dir)) as string;
    expect(b).toContain('fq_id: doc-123');
    expect(b).not.toContain('default_limit: 100');
  });

  it('frontmatter-less file: body == both == whole; frontmatter == empty', async () => {
    const body = resultOf(await run('exit cat "/p.md"', dir)) as string;
    const both = resultOf(await run('exit cat --scope "both" "/p.md"', dir)) as string;
    expect(body).toEqual(both);
    expect(resultOf(await run('exit cat --scope "frontmatter" "/p.md"', dir))).toEqual('');
  });

  it('grep default body does NOT match a frontmatter-only term', async () => {
    expect(resultOf(await run('exit grep -c "fq_status" "/doc.md"', dir))).toEqual(0);
  });

  it('grep --scope frontmatter matches within the YAML', async () => {
    expect(resultOf(await run('exit grep -c --scope "frontmatter" "fq_status" "/doc.md"', dir))).toEqual(1);
  });

  it('find rejects --scope', async () => {
    const payload = await run('exit find "/" --scope "body"', dir);
    expect(reasonOf(payload)).toEqual('invalid_scope');
  });

  it('ls rejects --scope', async () => {
    const payload = await run('exit ls "/" --scope "body"', dir);
    expect(reasonOf(payload)).toEqual('invalid_scope');
  });

  it('invalid --scope value is rejected', async () => {
    const payload = await run('exit cat --scope "head" "/doc.md"', dir);
    expect(reasonOf(payload)).toEqual('invalid_scope');
  });
});

describe('REQ-066 sed -i in-place editing', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fq-sed-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('default body edit changes body and preserves frontmatter bytes', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    const payload = await run(
      'sed -i "s/default_limit: 100/default_limit: 250/" "/doc.md"\n' +
        'sed -i "s/burst_limit: 20/burst_limit: 50/" "/doc.md"\nexit { ok: true }',
      dir,
    );
    expect(payload['error']).toBeUndefined();
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('default_limit: 250');
    expect(after).toContain('burst_limit: 50');
    expect(after).toContain('keep: me');
    expect(after).toContain('---\nfq_id: doc-123\nfq_status: draft\ntitle: Limits\n---'); // frontmatter intact
  });

  it('default body does not touch a matching frontmatter line', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    await run('sed -i "s/draft/review/" "/doc.md"\nexit { ok: true }', dir);
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('fq_status: draft');
  });

  it('--scope both edits the whole file', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    await run('sed --scope "both" -i "s/draft/review/" "/doc.md"\nexit { ok: true }', dir);
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('fq_status: review');
  });

  it('--scope frontmatter altering fq_id is rejected; file unchanged', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    const payload = await run('sed --scope "frontmatter" -i "s/doc-123/HACKED/" "/doc.md"\nexit { ok: true }', dir);
    expect(reasonOf(payload)).toEqual('fq_managed_field_mutation');
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('fq_id: doc-123');
  });

  it('sed -i on a no-frontmatter file edits the whole content', async () => {
    await writeFile(join(dir, 'p.md'), PLAIN_DOC);
    await run('sed -i "s/default_limit: 100/default_limit: 250/" "/p.md"\nexit { ok: true }', dir);
    const after = await readFile(join(dir, 'p.md'), 'utf8');
    expect(after).toContain('default_limit: 250');
  });

  it('sed -i across a glob writes each matched file', async () => {
    await writeFile(join(dir, 'a.md'), PLAIN_DOC);
    await writeFile(join(dir, 'b.md'), PLAIN_DOC);
    await run('sed -i "s/keep: me/keep: us/" "/*.md"\nexit { ok: true }', dir);
    expect(await readFile(join(dir, 'a.md'), 'utf8')).toContain('keep: us');
    expect(await readFile(join(dir, 'b.md'), 'utf8')).toContain('keep: us');
  });
});
