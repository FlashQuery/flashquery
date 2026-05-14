import { macroParseError, type MacroParseErrorEnvelope } from './errors.js';
import type { MacroSourceBlock } from './types.js';

export type MacroFenceExtractionResult =
  | { ok: true; blocks: MacroSourceBlock[] }
  | { ok: false; error: MacroParseErrorEnvelope };

const FENCE_OPEN_RE = /^ {0,3}(`{3,})(.*)$/;
const BLOCK_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function extractMacroFences(
  markdown: string,
  identifier?: string
): MacroFenceExtractionResult {
  const lines = markdown.split(/\r?\n/);
  const blocks: MacroSourceBlock[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const open = FENCE_OPEN_RE.exec(line);
    if (!open) {
      continue;
    }

    const fence = open[1] ?? '```';
    const infoString = (open[2] ?? '').trim();
    if (!isMacroFence(infoString)) {
      index = skipFence(lines, index + 1, fence);
      continue;
    }

    const openingLine = index + 1;
    const parsed = parseFenceInfo(infoString);
    if (!parsed.ok) {
      return {
        ok: false,
        error: macroParseError(
          {
            reason: 'malformed_fence_attributes',
            at_line: openingLine,
            near_token: infoString,
          },
          'Macro fence attributes are malformed.',
          identifier
        ),
      };
    }

    const bodyStart = index + 1;
    const closingIndex = findClosingFence(lines, bodyStart, fence);
    const bodyEnd = closingIndex === -1 ? lines.length : closingIndex;
    blocks.push({
      name: parsed.name,
      source: lines.slice(bodyStart, bodyEnd).join('\n'),
      openingLine,
    });

    index = closingIndex === -1 ? lines.length : closingIndex;
  }

  return { ok: true, blocks };
}

function isMacroFence(infoString: string): boolean {
  return infoString === 'fqm' || /^fqm\s+/.test(infoString);
}

function parseFenceInfo(infoString: string): { ok: true; name: string | null } | { ok: false } {
  if (infoString === 'fqm') {
    return { ok: true, name: null };
  }

  const match = /^fqm\s+(.+)$/.exec(infoString);
  if (!match) {
    return { ok: false };
  }

  const attrs = match[1]?.trim() ?? '';
  const parts = attrs.split(/\s+/);
  if (parts.length !== 1) {
    return { ok: false };
  }

  const attr = parts[0] ?? '';
  const equalsIndex = attr.indexOf('=');
  if (equalsIndex === -1 || attr.indexOf('=', equalsIndex + 1) !== -1) {
    return { ok: false };
  }

  const key = attr.slice(0, equalsIndex);
  const value = attr.slice(equalsIndex + 1);
  if (key !== 'name' || value.length === 0 || value.includes('"') || value.includes("'")) {
    return { ok: false };
  }

  if (!BLOCK_NAME_RE.test(value)) {
    return { ok: false };
  }

  return { ok: true, name: value };
}

function skipFence(lines: string[], startIndex: number, fence: string): number {
  const closingIndex = findClosingFence(lines, startIndex, fence);
  return closingIndex === -1 ? lines.length : closingIndex;
}

function findClosingFence(lines: string[], startIndex: number, fence: string): number {
  const minLength = fence.length;
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = /^ {0,3}(`{3,})[ \t]*$/.exec(line);
    if (match && (match[1]?.length ?? 0) >= minLength) {
      return index;
    }
  }
  return -1;
}
