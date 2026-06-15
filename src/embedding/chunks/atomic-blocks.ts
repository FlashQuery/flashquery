import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

import { normalizeChunkContent } from './normalize.js';
import type { ChunkParserParams } from './types.js';

interface PositionedNode {
  type: string;
  children?: PositionedNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
}

interface MarkdownUnit {
  text: string;
  atomic: boolean;
  nodeType: string;
  startLine?: number;
  children?: PositionedNode[];
}

export function splitContentPreservingAtomicBlocks(
  content: string,
  breadcrumb: string,
  params: ChunkParserParams
): string[] {
  const bodyBudget = Math.max(1, params.maxChunkTokens - countTokens(breadcrumb));
  if (countTokens(content) <= bodyBudget) {
    return [normalizeChunkContent(content)];
  }

  const units = extractMarkdownUnits(content).flatMap((unit) => splitOversizedUnit(unit, bodyBudget));
  const overlapTokens = Math.ceil(params.maxChunkTokens * params.overlapRatio);
  return packMarkdownUnits(units, bodyBudget, overlapTokens);
}

function extractMarkdownUnits(content: string): MarkdownUnit[] {
  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as PositionedNode;
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const children = tree.children ?? [];
  const units: MarkdownUnit[] = [];

  for (const child of children) {
    if (!child.position) {
      continue;
    }

    const text = sliceLines(lines, child.position.start.line, child.position.end.line);
    if (!text.trim()) {
      continue;
    }

    units.push({
      text: normalizeChunkContent(text),
      atomic: child.type === 'code' || child.type === 'table' || child.type === 'list',
      nodeType: child.type,
      startLine: child.position.start.line,
      children: child.children,
    });
  }

  return units.length > 0 ? units : [{ text: normalizeChunkContent(content), atomic: false, nodeType: 'text', startLine: 1 }];
}

function splitOversizedUnit(unit: MarkdownUnit, bodyBudget: number): MarkdownUnit[] {
  if (countTokens(unit.text) <= bodyBudget) {
    return [unit];
  }

  if (unit.atomic && unit.nodeType === 'table') {
    return splitTable(unit.text, bodyBudget).map((text) => ({ text, atomic: true, nodeType: 'table' }));
  }

  if (unit.atomic && unit.nodeType === 'code') {
    return splitFencedCode(unit.text, bodyBudget).map((text) => ({ text, atomic: true, nodeType: 'code' }));
  }

  if (unit.atomic && unit.nodeType === 'list') {
    return splitTopLevelList(unit, bodyBudget).map((text) => ({ text, atomic: true, nodeType: 'list' }));
  }

  return splitSentences(unit.text, bodyBudget).map((text) => ({ text, atomic: false, nodeType: 'text' }));
}

function splitTable(table: string, bodyBudget: number): string[] {
  const lines = table.split('\n');
  const header = lines.slice(0, 2);
  const rows = lines.slice(2);
  const chunks: string[] = [];
  let currentRows: string[] = [];

  for (const row of rows) {
    const candidate = [...header, ...currentRows, row].join('\n');
    if (currentRows.length > 0 && countTokens(candidate) > bodyBudget) {
      chunks.push(normalizeChunkContent([...header, ...currentRows].join('\n')));
      currentRows = [];
    }

    const singleRowCandidate = [...header, row].join('\n');
    if (countTokens(singleRowCandidate) > bodyBudget) {
      chunks.push(...splitTokens(singleRowCandidate, bodyBudget, 0));
    } else {
      currentRows.push(row);
    }
  }

  if (currentRows.length > 0) {
    chunks.push(normalizeChunkContent([...header, ...currentRows].join('\n')));
  }

  return chunks;
}

function splitFencedCode(code: string, bodyBudget: number): string[] {
  const lines = code.split('\n');
  const opening = lines[0] ?? '```';
  const closing = lines[lines.length - 1] ?? opening.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] ?? '```';
  const bodyLines = lines.slice(1, -1);
  const chunks: string[] = [];
  let currentLines: string[] = [];

  for (const line of bodyLines) {
    const candidate = [opening, ...currentLines, line, closing].join('\n');
    if (currentLines.length > 0 && countTokens(candidate) > bodyBudget) {
      chunks.push(normalizeChunkContent([opening, ...currentLines, closing].join('\n')));
      currentLines = [];
    }

    const singleLineCandidate = [opening, line, closing].join('\n');
    if (countTokens(singleLineCandidate) > bodyBudget) {
      chunks.push(...splitTokens(singleLineCandidate, bodyBudget, 0));
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    chunks.push(normalizeChunkContent([opening, ...currentLines, closing].join('\n')));
  }

  return chunks;
}

function splitTopLevelList(unit: MarkdownUnit, bodyBudget: number): string[] {
  const lines = unit.text.split('\n');
  const baseLine = unit.startLine ?? 1;
  const itemTexts = (unit.children ?? [])
    .map((child) => {
      if (!child.position) {
        return '';
      }
      const start = child.position.start.line - baseLine;
      const end = child.position.end.line - baseLine;
      return normalizeChunkContent(lines.slice(start, end + 1).join('\n'));
    })
    .filter(Boolean);
  const chunks: string[] = [];
  let currentItems: string[] = [];

  for (const item of itemTexts) {
    const candidate = [...currentItems, item].join('\n');
    if (currentItems.length > 0 && countTokens(candidate) > bodyBudget) {
      chunks.push(normalizeChunkContent(currentItems.join('\n')));
      currentItems = [];
    }

    if (countTokens(item) > bodyBudget) {
      chunks.push(...splitTokens(item, bodyBudget, 0));
    } else {
      currentItems.push(item);
    }
  }

  if (currentItems.length > 0) {
    chunks.push(normalizeChunkContent(currentItems.join('\n')));
  }

  return chunks.length > 0 ? chunks : splitTokens(unit.text, bodyBudget, 0);
}

function splitSentences(content: string, bodyBudget: number): string[] {
  const sentences = content
    .match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)
    ?.map((sentence) => normalizeChunkContent(sentence))
    .filter(Boolean) ?? [];

  if (sentences.length <= 1) {
    return splitTokens(content, bodyBudget, 0);
  }

  const chunks: string[] = [];
  let current: string[] = [];

  for (const sentence of sentences) {
    if (countTokens(sentence) > bodyBudget) {
      if (current.length > 0) {
        chunks.push(normalizeChunkContent(current.join(' ')));
        current = [];
      }
      chunks.push(...splitTokens(sentence, bodyBudget, 0));
      continue;
    }

    const candidate = [...current, sentence].join(' ');
    if (current.length > 0 && countTokens(candidate) > bodyBudget) {
      chunks.push(normalizeChunkContent(current.join(' ')));
      current = [];
    }
    current.push(sentence);
  }

  if (current.length > 0) {
    chunks.push(normalizeChunkContent(current.join(' ')));
  }

  return chunks;
}

function packMarkdownUnits(units: MarkdownUnit[], bodyBudget: number, overlapTokens: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const unit of units) {
    const candidate = [...current, unit.text].join('\n\n');
    if (current.length > 0 && countTokens(candidate) > bodyBudget) {
      const previous = normalizeChunkContent(current.join('\n\n'));
      chunks.push(previous);
      current = unit.atomic ? [] : overlapPrefix(previous, overlapTokens);
    }
    current.push(unit.text);
  }

  if (current.length > 0) {
    chunks.push(normalizeChunkContent(current.join('\n\n')));
  }

  return chunks;
}

function splitTokens(content: string, bodyBudget: number, overlapTokens: number): string[] {
  const tokens = content.split(/\s+/).filter(Boolean);
  const step = Math.max(1, bodyBudget - overlapTokens);
  const chunks: string[] = [];

  for (let start = 0; start < tokens.length; start += step) {
    chunks.push(tokens.slice(start, start + bodyBudget).join(' '));
    if (start + bodyBudget >= tokens.length) {
      break;
    }
  }

  return chunks;
}

function overlapPrefix(previousChunk: string, overlapTokens: number): string[] {
  if (overlapTokens <= 0) {
    return [];
  }
  return previousChunk.split(/\s+/).filter(Boolean).slice(-overlapTokens);
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join('\n');
}

function countTokens(content: string): number {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}
