import { describe, expect, it } from 'vitest';
import { extractMacroFences } from '../../src/macro/fence-extractor.js';

function expectBlocks(markdown: string) {
  const result = extractMacroFences(markdown, 'fixture.md');
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.blocks;
}

function expectMalformed(markdown: string, nearToken: string) {
  const result = extractMacroFences(markdown, 'fixture.md');
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected malformed fence attributes');
  }
  expect(result.error.error).toBe('parse_error');
  expect(result.error.details.reason).toBe('malformed_fence_attributes');
  expect(result.error.details.at_line).toBe(1);
  expect(result.error.details.near_token).toBe(nearToken);
}

describe('macro fence extraction', () => {
  it('T-U-001 extracts a single unnamed fqm block', () => {
    const blocks = expectBlocks(['# Doc', '', '```fqm', 'echo "hi"', '```'].join('\n'));

    expect(blocks).toEqual([{ name: null, source: 'echo "hi"', openingLine: 3 }]);
  });

  it('T-U-002 extracts a single named fqm block', () => {
    const blocks = expectBlocks(['```fqm name=archive-drafts', 'echo "hi"', '```'].join('\n'));

    expect(blocks).toEqual([{ name: 'archive-drafts', source: 'echo "hi"', openingLine: 1 }]);
  });

  it('extracts valid Markdown macro fences indented up to three spaces', () => {
    const blocks = expectBlocks(['   ```fqm name=indented', 'echo "hi"', '```'].join('\n'));

    expect(blocks).toEqual([{ name: 'indented', source: 'echo "hi"', openingLine: 1 }]);
  });

  it('T-U-003 extracts multiple named blocks and ignores non-fqm fences', () => {
    const blocks = expectBlocks(
      [
        '```ts',
        'const nope = true;',
        '```',
        '```fqml',
        'not a macro',
        '```',
        '```fqm-template',
        'also not a macro',
        '```',
        '```fqm name=add',
        'echo "add"',
        '```',
        '```fqm name=remove',
        'echo "remove"',
        '```',
      ].join('\n')
    );

    expect(blocks.map((block) => block.name)).toEqual(['add', 'remove']);
    expect(blocks.map((block) => block.openingLine)).toEqual([10, 13]);
  });

  it('T-U-004 rejects invalid block names including leading underscore', () => {
    expectMalformed(['```fqm name=_hidden', 'echo "x"', '```'].join('\n'), 'fqm name=_hidden');
    expectMalformed(['```fqm name=bad name', 'echo "x"', '```'].join('\n'), 'fqm name=bad name');
  });

  it('T-U-005 rejects block names over 64 characters', () => {
    expectMalformed(
      ['```fqm name=A'.concat('a'.repeat(64)), 'echo "x"', '```'].join('\n'),
      `fqm name=A${'a'.repeat(64)}`
    );
  });

  it('T-U-006 rejects empty name attributes', () => {
    expectMalformed(['```fqm name=', 'echo "x"', '```'].join('\n'), 'fqm name=');
  });

  it('rejects name attributes with multiple equals signs', () => {
    expectMalformed(['```fqm name=foo=bar', 'echo "x"', '```'].join('\n'), 'fqm name=foo=bar');
  });

  it('T-U-007 rejects duplicate name attributes', () => {
    expectMalformed(
      ['```fqm name=foo name=bar', 'echo "x"', '```'].join('\n'),
      'fqm name=foo name=bar'
    );
  });

  it('T-U-008 rejects quoted name attributes', () => {
    expectMalformed(['```fqm name="quoted"', 'echo "x"', '```'].join('\n'), 'fqm name="quoted"');
  });

  it('T-U-009 does not parse body comments as block names', () => {
    const blocks = expectBlocks(['```fqm', '# Macro: foo', 'echo "x"', '```'].join('\n'));

    expect(blocks).toEqual([{ name: null, source: '# Macro: foo\necho "x"', openingLine: 1 }]);
  });

  it('keeps body lines that begin with the fence marker and non-whitespace text', () => {
    const blocks = expectBlocks(
      ['```fqm', 'echo "before"', '```not a close', 'echo "after"', '```'].join('\n')
    );

    expect(blocks).toEqual([
      { name: null, source: 'echo "before"\n```not a close\necho "after"', openingLine: 1 },
    ]);
  });

  it('recognizes indented and longer valid Markdown closing fences', () => {
    const blocks = expectBlocks(
      [
        '```fqm name=short',
        'echo "short"',
        '````',
        'middle text',
        '````fqm name=long',
        'echo "long"',
        '   ````',
      ].join('\n')
    );

    expect(blocks).toEqual([
      { name: 'short', source: 'echo "short"', openingLine: 1 },
      { name: 'long', source: 'echo "long"', openingLine: 5 },
    ]);
  });
});
