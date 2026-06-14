import { describe, expect, it } from 'vitest';

import { chunkContentHash, chunkEmbedText, normalizeChunkContent } from '../../src/embedding/chunks/normalize.js';

describe('chunk normalization', () => {
  it('T-U-001 normalizes whitespace rules and is idempotent', () => {
    const input = ' \tAlpha\t\tbeta  \r\nGamma   delta\t\r\r\n\r\n\n  Epsilon  \t\n\n\nZeta  ';

    const normalized = normalizeChunkContent(input);

    expect(normalized).toBe('Alpha beta\nGamma delta\n\nEpsilon\n\nZeta');
    expect(normalizeChunkContent(normalized)).toBe(normalized);
  });

  it('T-U-002 preserves content_hash across trivial whitespace and CRLF edits', () => {
    const first = 'Alpha   beta\r\n\r\nGamma\t delta';
    const second = ' Alpha beta\n\n\nGamma delta ';

    expect(chunkContentHash(first)).toBe(chunkContentHash(second));
  });

  it('T-U-003 omits breadcrumb from stored content and hash but includes it in embed-time text', () => {
    const body = '  Important\tcontent  ';
    const breadcrumb = 'Project Plan > Risks';
    const normalized = normalizeChunkContent(body);

    expect(normalized).toBe('Important content');
    expect(chunkContentHash(body)).toBe(chunkContentHash(normalized));
    expect(chunkContentHash(chunkEmbedText(breadcrumb, normalized))).not.toBe(chunkContentHash(normalized));
    expect(chunkEmbedText(breadcrumb, normalized)).toBe('Project Plan > Risks\n\nImportant content');
  });
});
