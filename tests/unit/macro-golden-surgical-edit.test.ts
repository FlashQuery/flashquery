// Golden-model coverage for the 8-Jun-2026 surgical-editing update
// (Spec §12 / REQ-064..068): echo value-piping, --scope region selection,
// and sed -i scope-aware in-place editing.
//
// Runs macros against the golden model via captureSnapshot. sed -i tests use
// a caller-controlled vaultRoot so the written file can be re-read and asserted.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureSnapshot } from '../macro-framework/macro-golden-model/src/snapshot.js';
import { defaultToolRegistry } from '../macro-framework/macro-golden-model/src/mockfq.js';

const surface = { registry: defaultToolRegistry };

const FM_DOC =
  '---\nfq_id: doc-123\nstatus: draft\ntitle: Limits\n---\n' +
  'default_limit: 100\nburst_limit: 20\nkeep: me\n';
const PLAIN_DOC = 'default_limit: 100\nburst_limit: 20\nkeep: me\n';

async function runReturn(macro: string, vaultState: Record<string, string> = {}) {
  const env = await captureSnapshot(macro, {}, vaultState, surface);
  return env;
}

describe('REQ-064 echo is value-producing', () => {
  it('returns the joined string and binds in assignment', async () => {
    const env = await runReturn('x = echo "a" "b"\nexit { x: $x }');
    expect(env.result_envelope).toMatchObject({ parsed_ok: true });
    expect(env.return).toEqual({ x: 'a b' });
  });

  it('pipes its value into sed (regression of stdin_type_mismatch)', async () => {
    const env = await runReturn('out = echo "hello world" | sed "s/world/there/"\nexit { out: $out }');
    expect(env.error).toBeUndefined();
    expect(env.return).toEqual({ out: 'hello there' });
  });
});

describe('REQ-065 --scope region selection (read)', () => {
  it('cat defaults to body on a frontmatter doc', async () => {
    const env = await runReturn('b = cat "doc.md"\nexit { b: $b }', { 'doc.md': FM_DOC });
    const b = (env.return as { b: string }).b;
    expect(b).toContain('default_limit: 100');
    expect(b).not.toContain('fq_id'); // frontmatter excluded
  });

  it('cat --scope "both" returns the whole raw file', async () => {
    const env = await runReturn('b = cat --scope "both" "doc.md"\nexit { b: $b }', { 'doc.md': FM_DOC });
    const b = (env.return as { b: string }).b;
    expect(b).toContain('fq_id: doc-123');
    expect(b).toContain('default_limit: 100');
  });

  it('cat --scope "frontmatter" returns the YAML block only', async () => {
    const env = await runReturn('b = cat --scope "frontmatter" "doc.md"\nexit { b: $b }', { 'doc.md': FM_DOC });
    const b = (env.return as { b: string }).b;
    expect(b).toContain('fq_id: doc-123');
    expect(b).not.toContain('default_limit: 100'); // body excluded
  });

  it('frontmatter-less file: body == whole content; frontmatter == empty', async () => {
    const both = await runReturn('b = cat --scope "both" "p.md"\nexit { b: $b }', { 'p.md': PLAIN_DOC });
    const body = await runReturn('b = cat "p.md"\nexit { b: $b }', { 'p.md': PLAIN_DOC });
    expect((both.return as { b: string }).b).toEqual((body.return as { b: string }).b);
    const fm = await runReturn('b = cat --scope "frontmatter" "p.md"\nexit { b: $b }', { 'p.md': PLAIN_DOC });
    expect((fm.return as { b: string }).b).toEqual('');
  });

  it('grep default body does NOT match a frontmatter-only term', async () => {
    const env = await runReturn('m = grep "status:" "doc.md"\nexit { n: count $m }', { 'doc.md': FM_DOC });
    expect((env.return as { n: number }).n).toEqual(0); // "status:" lives in frontmatter
  });

  it('grep --scope frontmatter matches within the YAML', async () => {
    const env = await runReturn('m = grep --scope "frontmatter" "status:" "doc.md"\nexit { n: count $m }', { 'doc.md': FM_DOC });
    expect((env.return as { n: number }).n).toEqual(1);
  });

  it('find rejects --scope', async () => {
    const env = await runReturn('x = find "/" --scope "body"\nexit { x: $x }', { 'doc.md': FM_DOC });
    expect(env.error?.details?.reason).toEqual('invalid_scope');
  });

  it('invalid --scope value is rejected', async () => {
    const env = await runReturn('b = cat --scope "head" "doc.md"\nexit { b: $b }', { 'doc.md': FM_DOC });
    expect(env.error?.details?.reason).toEqual('invalid_scope');
  });
});

describe('REQ-066 sed -i in-place editing', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fqm-sed-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function runInDir(macro: string) {
    return captureSnapshot(macro, {}, {}, surface, { vaultRoot: dir });
  }

  it('default body edit changes the body and preserves frontmatter bytes', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    const env = await runInDir(
      'sed -i "s/default_limit: 100/default_limit: 250/" "doc.md"\n' +
      'sed -i "s/burst_limit: 20/burst_limit: 50/" "doc.md"\nexit { ok: true }',
    );
    expect(env.error).toBeUndefined();
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('default_limit: 250');
    expect(after).toContain('burst_limit: 50');
    expect(after).toContain('keep: me'); // untouched line preserved
    expect(after).toContain('---\nfq_id: doc-123\nstatus: draft\ntitle: Limits\n---'); // frontmatter intact
  });

  it('default body does not touch a matching frontmatter line', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    await runInDir('sed -i "s/draft/review/" "doc.md"\nexit { ok: true }');
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('status: draft'); // frontmatter "draft" untouched (body scope)
  });

  it('--scope both edits the whole file', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    await runInDir('sed --scope "both" -i "s/draft/review/" "doc.md"\nexit { ok: true }');
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('status: review');
  });

  it('--scope frontmatter altering fq_id is rejected; file unchanged', async () => {
    await writeFile(join(dir, 'doc.md'), FM_DOC);
    const env = await runInDir('sed --scope "frontmatter" -i "s/doc-123/HACKED/" "doc.md"\nexit { ok: true }');
    expect(env.error?.details?.reason).toEqual('fq_managed_field_mutation');
    const after = await readFile(join(dir, 'doc.md'), 'utf8');
    expect(after).toContain('fq_id: doc-123'); // unchanged
  });

  it('sed -i on a no-frontmatter file edits the whole content', async () => {
    await writeFile(join(dir, 'p.md'), PLAIN_DOC);
    await runInDir('sed -i "s/default_limit: 100/default_limit: 250/" "p.md"\nexit { ok: true }');
    const after = await readFile(join(dir, 'p.md'), 'utf8');
    expect(after).toContain('default_limit: 250');
  });

  it('sed -i is no longer pre-scan-forbidden', async () => {
    await writeFile(join(dir, 'p.md'), PLAIN_DOC);
    const env = await runInDir('sed -i "s/keep/kept/" "p.md"\nexit { ok: true }');
    // Previously this raised forbidden_shell_flag at pre-scan.
    expect(env.error?.code).not.toEqual('forbidden_shell_flag');
  });
});
