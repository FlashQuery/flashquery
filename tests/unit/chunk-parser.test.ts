import { describe, expect, it } from 'vitest';

import { parseDocumentChunks } from '../../src/embedding/chunks/parser.js';
import { DEFAULT_CHUNK_PARSER_PARAMS } from '../../src/embedding/chunks/types.js';

const parserBase = {
  instanceId: 'inst-parser',
  documentId: '9bd19d22-3d6c-473f-94cc-068f52de2528',
  title: 'Parser Doc',
};

describe('heading-aware chunk parser', () => {
  it('pins the v1 parser parameter contract defaults', () => {
    expect(DEFAULT_CHUNK_PARSER_PARAMS).toEqual({
      minChunkTokens: 100,
      maxChunkTokens: 800,
      overlapRatio: 0.12,
    });
  });

  it('T-U-004 H1-H6 headings produce document-order sections with expected heading paths', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: [
        '# H1',
        'one',
        '## H2',
        'two',
        '### H3',
        'three',
        '#### H4',
        'four',
        '##### H5',
        'five',
        '###### H6',
        'six',
      ].join('\n\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });

    expect(chunks.map((chunk) => chunk.heading_path)).toEqual([
      'H1',
      'H1 > H2',
      'H1 > H2 > H3',
      'H1 > H2 > H3 > H4',
      'H1 > H2 > H3 > H4 > H5',
      'H1 > H2 > H3 > H4 > H5 > H6',
    ]);
  });

  it('T-U-005 broken H1-to-H3 hierarchy parses without warning and preserves actual path', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: '# Root\n\nroot body\n\n### Deep\n\ndeep body',
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });

    expect(chunks.map((chunk) => chunk.heading_path)).toEqual(['Root', 'Root > Deep']);
    expect(chunks[1]?.heading_level).toBe(3);
  });

  it('T-U-006 heading-less document uses synthetic level 0 section and title breadcrumb', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      title: 'Untitled Knowledge',
      body: 'Loose notes with no markdown heading.',
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_level).toBe(0);
    expect(chunks[0]?.heading_path).toBe('Untitled Knowledge');
    expect(chunks[0]?.breadcrumb).toBe('Untitled Knowledge');
  });

  it('T-U-007 horizontal rules, bold standalone text, and blockquotes do not create boundaries', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: ['# Real', 'alpha', '---', '**Looks Important**', '> quoted heading-ish text', 'omega'].join('\n\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 50 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_path).toBe('Real');
    expect(chunks[0]?.content).toContain('---');
    expect(chunks[0]?.content).toContain('**Looks Important**');
    expect(chunks[0]?.content).toContain('> quoted heading-ish text');
  });

  it('T-U-008 headings inside fenced code are ignored', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: ['# Real', '```md', '# Not a heading', '```', 'after'].join('\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 50 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_path).toBe('Real');
    expect(chunks[0]?.content).toContain('# Not a heading');
  });

  it('T-U-009 tiny parent section merges into first child and retains merged metadata', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: '# Parent\n\nintro\n\n## Child\n\nchild has enough words for the chunk',
      params: { minChunkTokens: 4, maxChunkTokens: 50 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_path).toBe('Parent > Child');
    expect(chunks[0]?.content.startsWith('intro\n\nchild has enough')).toBe(true);
    expect(chunks[0]?.merged_heading_paths).toEqual(['Parent']);
  });

  it('T-U-010 tiny leaf section merges forward within parent scope only', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: [
        '# Parent',
        '## Tiny',
        'small',
        '## Sibling',
        'sibling has enough words here',
        '# Next Parent',
        'next parent has enough words here',
      ].join('\n\n'),
      params: { minChunkTokens: 4, maxChunkTokens: 50 },
    });

    expect(chunks.map((chunk) => chunk.heading_path)).toEqual(['Parent > Sibling', 'Next Parent']);
    expect(chunks[0]?.content.startsWith('small\n\nsibling has enough')).toBe(true);
  });

  it('T-U-011 empty section emits no chunk but remains in descendant breadcrumb', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: '# Empty Parent\n\n## Child\n\nchild body',
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading_path).toBe('Empty Parent > Child');
    expect(chunks[0]?.breadcrumb).toBe('Empty Parent > Child');
  });

  it('T-U-012 oversized prose section splits by paragraph, sentence, then token fallback', () => {
    const paragraphChunks = parseDocumentChunks({
      ...parserBase,
      body: '# Big\n\nAlpha beta gamma delta.\n\nEpsilon zeta eta theta.',
      params: { minChunkTokens: 1, maxChunkTokens: 5, overlapRatio: 0 },
    });
    const sentenceChunks = parseDocumentChunks({
      ...parserBase,
      body: '# Sentences\n\nOne two three. Four five six. Seven eight nine.',
      params: { minChunkTokens: 1, maxChunkTokens: 4, overlapRatio: 0 },
    });
    const tokenChunks = parseDocumentChunks({
      ...parserBase,
      body: '# Tokens\n\nsuperlongtoken anotherlongtoken thirdlongtoken',
      params: { minChunkTokens: 1, maxChunkTokens: 2, overlapRatio: 0 },
    });

    expect(paragraphChunks).toHaveLength(2);
    expect(sentenceChunks.map((chunk) => chunk.content)).toEqual([
      'One two three.',
      'Four five six.',
      'Seven eight nine.',
    ]);
    expect(tokenChunks).toHaveLength(3);
    expect(tokenChunks.map((chunk) => chunk.content)).toEqual([
      'superlongtoken',
      'anotherlongtoken',
      'thirdlongtoken',
    ]);
  });

  it('T-U-013 prose overlap defaults to 12 percent and never crosses heading boundaries', () => {
    const chunks = parseDocumentChunks({
      ...parserBase,
      body: [
        '# First',
        'a1 a2 a3 a4 a5 a6 a7 a8 a9 a10',
        '# Second',
        'b1 b2 b3 b4 b5 b6 b7 b8 b9 b10',
      ].join('\n\n'),
      params: { minChunkTokens: 1, maxChunkTokens: 7 },
    });

    expect(chunks.map((chunk) => chunk.heading_path)).toEqual(['First', 'First', 'Second', 'Second']);
    expect(chunks[1]?.content.startsWith('a6')).toBe(true);
    expect(chunks[2]?.content.includes('a')).toBe(false);
  });

  it('T-U-014 section growth and shrink preserve first-sibling id and delete orphan sibling ids', () => {
    const short = parseDocumentChunks({
      ...parserBase,
      body: '# Stable\n\none two three',
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });
    const grown = parseDocumentChunks({
      ...parserBase,
      body: '# Stable\n\none two three four five six seven eight nine ten',
      params: { minChunkTokens: 1, maxChunkTokens: 5, overlapRatio: 0 },
    });
    const shrunk = parseDocumentChunks({
      ...parserBase,
      body: '# Stable\n\none two three again',
      params: { minChunkTokens: 1, maxChunkTokens: 20 },
    });

    expect(grown[0]?.id).toBe(short[0]?.id);
    expect(shrunk[0]?.id).toBe(short[0]?.id);
    expect(grown.slice(1).map((chunk) => chunk.id).filter((id) => !shrunk.map((chunk) => chunk.id).includes(id))).toEqual(
      grown.slice(1).map((chunk) => chunk.id)
    );
  });
});
