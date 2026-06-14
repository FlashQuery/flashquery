import { describe, expect, it } from 'vitest';

import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';

const atomicBase = {
  instanceId: 'inst-atomic',
  documentId: 'c2fdbdd5-1a7d-55e5-89b4-203d2c0d78e8',
  title: 'Atomic Doc',
};

describe('CommonMark and GFM atomic chunk blocks', () => {
  it('T-U-015 keeps fenced code, GFM tables, and top-level lists atomic inside fitting sections', () => {
    const chunks = parseDocumentChunks({
      ...atomicBase,
      body: [
        '# Mixed',
        'Intro paragraph.',
        '',
        '```ts',
        'const value = 1;',
        '```',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- item one',
        '- item two',
      ].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 80 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('```ts\nconst value = 1;\n```');
    expect(chunks[0]?.content).toContain('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(chunks[0]?.content).toContain('- item one\n- item two');
  });

  it('T-U-016 splits oversized tables by row group with header and separator repeated', () => {
    const chunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# Table', '| Name | Value |', '| - | - |', '| Alpha | one two three |', '| Beta | four five six |'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 20, overlapRatio: 0 },
    });

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\| Name \| Value \|\n\| - \| - \|\n\|/);
    }
    expect(chunks[0]?.content).toContain('| Alpha | one two three |');
    expect(chunks[1]?.content).toContain('| Beta | four five six |');
  });

  it('T-U-017 splits oversized fenced code by line with opening and closing fences repeated', () => {
    const chunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# Code', '````python', 'alpha beta gamma', 'delta epsilon zeta', '````'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 6, overlapRatio: 0 },
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe('````python\nalpha beta gamma\n````');
    expect(chunks[1]?.content).toBe('````python\ndelta epsilon zeta\n````');
  });

  it('T-U-018 splits oversized top-level lists only between top-level items and preserves nested indentation', () => {
    const chunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# List', '- alpha one two', '  - nested must stay', '- beta three four', '  - nested must also stay'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 10, overlapRatio: 0 },
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe('- alpha one two\n  - nested must stay');
    expect(chunks[1]?.content).toBe('- beta three four\n  - nested must also stay');
  });

  it('T-U-019 parses variable-length fences, indented fences, and Docling-style GFM without FlashQuery conventions', () => {
    const chunks = parseDocumentChunks({
      ...atomicBase,
      body: [
        '# Docling',
        '   ~~~~json',
        '   { "#not": "heading" }',
        '   ~~~~',
        '',
        '| Field | Description |',
        '| --- | --- |',
        '| title | Generated table |',
        '',
        '1. ordered item',
        '   - nested bullet',
      ].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 80 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_path).toBe('Docling');
    expect(chunks[0]?.content).toContain('~~~~json');
    expect(chunks[0]?.content).toContain('| Field | Description |');
    expect(chunks[0]?.content).toContain('1. ordered item\n   - nested bullet');
  });

  it('T-U-020 falls back to documented token split for oversized single row, line, or item', () => {
    const rowChunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# Row', '| Name | Value |', '| - | - |', '| Alpha | one two three four five six seven |'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 6, overlapRatio: 0 },
    });
    const codeChunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# Line', '```', 'one two three four five six seven', '```'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 6, overlapRatio: 0 },
    });
    const listChunks = parseDocumentChunks({
      ...atomicBase,
      body: ['# Item', '- one two three four five six seven'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 6, overlapRatio: 0 },
    });

    expect(rowChunks.length).toBeGreaterThan(1);
    expect(codeChunks.length).toBeGreaterThan(1);
    expect(listChunks.length).toBeGreaterThan(1);
  });
});
