import { describe, expect, it } from 'vitest';
import {
  describeAvailableMacroBlocks,
  selectMacroSourceBlock,
  splitMacroSourceRef,
  validateMacroBlockName,
} from '../../src/macro/source-ref.js';
import type { MacroSourceBlock } from '../../src/macro/types.js';

const block = (name: string | null, source = 'echo "x"'): MacroSourceBlock => ({
  name,
  source,
  openingLine: 1,
});

function expectInvalidSource(result: ReturnType<typeof splitMacroSourceRef>, reason: string) {
  expect(result.valid).toBe(false);
  if (result.valid) {
    throw new Error('Expected invalid source ref');
  }
  expect(result.error.error).toBe('invalid_input');
  expect(result.error.details.reason).toBe(reason);
}

function expectSelectionError(result: ReturnType<typeof selectMacroSourceBlock>, reason: string) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected selection error');
  }
  expect(result.error.error).toBe('invalid_input');
  expect(result.error.details.reason).toBe(reason);
}

describe('macro source_ref selector utilities', () => {
  it('T-U-010 splits source_ref::name into docRef and blockName', () => {
    expect(splitMacroSourceRef('Macros/foo.md::add_projections')).toEqual({
      valid: true,
      docRef: 'Macros/foo.md',
      blockName: 'add_projections',
    });
    expect(validateMacroBlockName('archive-drafts')).toBe(true);
    expect(validateMacroBlockName('_hidden')).toBe(false);
  });

  it('T-U-011 returns no_macro_blocks for zero-block docs', () => {
    expectSelectionError(selectMacroSourceBlock([], null, 'Macros/empty.md'), 'no_macro_blocks');
  });

  it('T-U-012 selects the only block when no selector is provided', () => {
    const only = block('single');
    expect(selectMacroSourceBlock([only], null)).toEqual({ ok: true, block: only });
  });

  it('T-U-013 returns ambiguous_macro_block for multiple blocks without a selector', () => {
    const result = selectMacroSourceBlock([block('add'), block('remove')], null);
    expectSelectionError(result, 'ambiguous_macro_block');
    if (!result.ok) {
      expect(result.error.details.available_names).toEqual(['add', 'remove']);
    }
  });

  it('T-U-014 selects one matching named block from a multi-block doc', () => {
    const selected = block('add');
    expect(selectMacroSourceBlock([selected, block('remove')], 'add')).toEqual({
      ok: true,
      block: selected,
    });
  });

  it('T-U-015 returns block_not_found with availability data', () => {
    const result = selectMacroSourceBlock([block('add'), block(null)], 'missing');
    expectSelectionError(result, 'block_not_found');
    if (!result.ok) {
      expect(result.error.details.requested).toBe('missing');
      expect(result.error.details.available_names).toEqual(['add', 'unnamed']);
    }
  });

  it('T-U-016 returns duplicate_block_name with match_count', () => {
    const result = selectMacroSourceBlock([block('same'), block('same')], 'same');
    expectSelectionError(result, 'duplicate_block_name');
    if (!result.ok) {
      expect(result.error.details.match_count).toBe(2);
    }
  });

  it('T-U-017 describes named and unnamed block availability', () => {
    expect(describeAvailableMacroBlocks([block('add'), block(null), block(null)])).toEqual({
      available_names: ['add', 'unnamed'],
      unnamed_block_count: 2,
    });
  });

  it('T-U-018 leaves heading anchors in docRef and validates only :: selectors', () => {
    expect(splitMacroSourceRef('Macros/foo.md#heading')).toEqual({
      valid: true,
      docRef: 'Macros/foo.md#heading',
      blockName: null,
    });
    expectInvalidSource(splitMacroSourceRef('::foo'), 'invalid_source_ref_format');
    expectInvalidSource(splitMacroSourceRef('Macros/foo.md::_hidden'), 'invalid_block_name_format');
  });
});
