import { macroInvalidInput, type MacroInvalidInputEnvelope } from './errors.js';
import type { MacroSourceBlock } from './types.js';

export type MacroSourceRefSplitResult =
  | { valid: true; docRef: string; blockName: string | null }
  | { valid: false; error: MacroInvalidInputEnvelope };

export type MacroBlockSelectionResult =
  | { ok: true; block: MacroSourceBlock }
  | { ok: false; error: MacroInvalidInputEnvelope };

export interface AvailableMacroBlocks {
  available_names: string[];
  unnamed_block_count?: number;
}

const BLOCK_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function validateMacroBlockName(name: string): boolean {
  return BLOCK_NAME_RE.test(name);
}

export function splitMacroSourceRef(value: string): MacroSourceRefSplitResult {
  const separatorIndex = value.indexOf('::');
  if (separatorIndex === -1) {
    return { valid: true, docRef: value, blockName: null };
  }

  const docRef = value.slice(0, separatorIndex);
  const blockName = value.slice(separatorIndex + 2);

  if (docRef.length === 0) {
    return {
      valid: false,
      error: macroInvalidInput('invalid_source_ref_format', { source_ref: value }),
    };
  }

  if (blockName.length === 0 || !validateMacroBlockName(blockName)) {
    return {
      valid: false,
      error: macroInvalidInput('invalid_block_name_format', {
        source_ref: value,
        block_name: blockName,
      }),
    };
  }

  return { valid: true, docRef, blockName };
}

export function describeAvailableMacroBlocks(blocks: MacroSourceBlock[]): AvailableMacroBlocks {
  const named = blocks.map((block) => block.name).filter((name): name is string => name !== null);
  const unnamedCount = blocks.filter((block) => block.name === null).length;

  return {
    available_names: unnamedCount > 0 ? [...named, 'unnamed'] : named,
    ...(unnamedCount > 1 ? { unnamed_block_count: unnamedCount } : {}),
  };
}

export function selectMacroSourceBlock(
  blocks: MacroSourceBlock[],
  blockName: string | null,
  identifier?: string
): MacroBlockSelectionResult {
  if (blocks.length === 0) {
    return {
      ok: false,
      error: macroInvalidInput('no_macro_blocks', { source_ref: identifier }),
    };
  }

  if (blockName === null) {
    if (blocks.length === 1) {
      return { ok: true, block: blocks[0] as MacroSourceBlock };
    }

    return {
      ok: false,
      error: macroInvalidInput('ambiguous_macro_block', describeAvailableMacroBlocks(blocks)),
    };
  }

  const matches = blocks.filter((block) => block.name === blockName);
  if (matches.length === 1) {
    return { ok: true, block: matches[0] as MacroSourceBlock };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      error: macroInvalidInput('block_not_found', {
        requested: blockName,
        ...describeAvailableMacroBlocks(blocks),
      }),
    };
  }

  return {
    ok: false,
    error: macroInvalidInput('duplicate_block_name', {
      name: blockName,
      match_count: matches.length,
    }),
  };
}
