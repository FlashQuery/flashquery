import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildConsolidatedResponse,
  buildMetadataEnvelope,
} from '../../src/mcp/utils/document-output.js';

const SHA256_HEX = /^[a-f0-9]{64}$/;

describe('REQ-016 whole-file version_token shape', () => {
  it('T-U-024 computes version_token as SHA-256 over raw file bytes including frontmatter and body', async () => {
    const { computeVersionToken } = await import('../../src/mcp/utils/document-version.js');
    const rawBytes = Buffer.from(
      [
        '---',
        'fq_title: Raw Token',
        'fq_updated: 2026-05-27T00:00:00.000Z',
        '---',
        '# Heading',
        '',
        'Body',
      ].join('\n'),
      'utf8'
    );
    const expected = createHash('sha256').update(rawBytes).digest('hex');

    expect(computeVersionToken(rawBytes)).toBe(expected);
    expect(computeVersionToken(rawBytes)).toMatch(SHA256_HEX);
  });

  it('T-U-024 changes version_token after a single-byte edit anywhere in the raw file', async () => {
    const { computeVersionToken } = await import('../../src/mcp/utils/document-version.js');
    const before = Buffer.from('---\nfq_title: A\n---\nBody', 'utf8');
    const afterFrontmatterEdit = Buffer.from('---\nfq_title: B\n---\nBody', 'utf8');
    const afterBodyEdit = Buffer.from('---\nfq_title: A\n---\nBodY', 'utf8');

    expect(computeVersionToken(afterFrontmatterEdit)).not.toBe(computeVersionToken(before));
    expect(computeVersionToken(afterBodyEdit)).not.toBe(computeVersionToken(before));
  });

  it('T-U-025 section-only get_document response carries whole-file version_token and no section-scoped token field', () => {
    const metadata = buildMetadataEnvelope(
      'Notes/Token.md',
      {
        relativePath: 'Notes/Token.md',
        capturedFrontmatter: { fqcId: '11111111-1111-4111-8111-111111111111' },
      },
      { fq_title: 'Token', fq_updated: '2026-05-27T00:00:00.000Z' },
      '## A\n\nBody\n\n## B\n\nOther'
    );
    const response = buildConsolidatedResponse(metadata, ['body'], {
      body: '## A\n\nBody',
      extractedSections: [{ heading: 'A', chars: 10 }],
    });

    expect(response.version_token).toEqual(expect.stringMatching(SHA256_HEX));
    expect(response).not.toHaveProperty('section_version_token');
    expect(response).not.toHaveProperty('section_hash');
    expect(response).not.toHaveProperty('content_hash');
    expect(response).not.toHaveProperty('contentHash');
  });
});
