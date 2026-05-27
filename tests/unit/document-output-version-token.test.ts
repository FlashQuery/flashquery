import { describe, expect, it } from 'vitest';
import { computeVersionToken } from '../../src/mcp/utils/document-version.js';
import {
  buildDocumentWriteResult,
} from '../../src/mcp/utils/document-write.js';
import {
  buildConsolidatedResponse,
  buildMetadataEnvelope,
} from '../../src/mcp/utils/document-output.js';
import {
  documentArchiveResult,
  documentIdentification,
  documentRemovalResult,
} from '../../src/mcp/utils/response-formats.js';

const VERSION_TOKEN = 'a'.repeat(64);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function expectCallerVersionToken(payload: Record<string, unknown>): void {
  expect(payload).toHaveProperty('version_token');
  expect(payload.version_token).toEqual(expect.stringMatching(SHA256_HEX));
  expect(payload).not.toHaveProperty('content_hash');
  expect(payload).not.toHaveProperty('contentHash');
}

describe('REQ-011 response version_token contract', () => {
  it('T-U-020 get_document metadata envelope exposes version_token as lowercase SHA-256, never content_hash', () => {
    const rawBytes = '---\nfq_title: Token\nfq_updated: 2026-05-27T00:00:00.000Z\n---\nbody';
    const rawBytesHash = computeVersionToken(rawBytes);
    const metadata = buildMetadataEnvelope(
      'Notes/Token.md',
      {
        relativePath: 'Notes/Token.md',
        capturedFrontmatter: {
          fqcId: '11111111-1111-4111-8111-111111111111',
          contentHash: rawBytesHash,
        },
      },
      { fq_title: 'Token', fq_updated: '2026-05-27T00:00:00.000Z' },
      'body'
    );

    const envelope = buildConsolidatedResponse(metadata, ['body'], { body: 'body' });

    expectCallerVersionToken(envelope);
    expect(envelope.version_token).toBe(rawBytesHash);
  });

  it('T-U-020 rejects metadata snapshots that omit the raw-byte contentHash', () => {
    expect(() =>
      buildMetadataEnvelope(
        'Notes/Token.md',
        {
          relativePath: 'Notes/Token.md',
          capturedFrontmatter: { fqcId: '11111111-1111-4111-8111-111111111111' },
        },
        { fq_title: 'Token', fq_updated: '2026-05-27T00:00:00.000Z' },
        'body'
      )
    ).toThrow('contentHash is required');
  });

  it('T-U-021 write_document success payload includes version_token and does not leak content_hash names', () => {
    const payload = buildDocumentWriteResult({
      mode: 'update',
      identifier: 'Notes/Token.md',
      title: 'Token',
      path: 'Notes/Token.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-27T00:00:00.000Z',
      chars: 4,
      version_token: VERSION_TOKEN,
    } as Parameters<typeof buildDocumentWriteResult>[0] & { version_token: string });

    expectCallerVersionToken(payload);
  });

  it('T-U-021 shared document identification success payloads include version_token and do not expose content_hash aliases', () => {
    const payload = documentIdentification({
      identifier: 'Notes/Token.md',
      title: 'Token',
      path: 'Notes/Token.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-27T00:00:00.000Z',
      chars: 4,
      version_token: VERSION_TOKEN,
    } as Parameters<typeof documentIdentification>[0] & { version_token: string });

    expectCallerVersionToken(payload);
  });

  it('T-U-021 archive_document success payload includes version_token and does not expose content_hash aliases', () => {
    const payload = documentArchiveResult({
      identifier: 'Notes/Token.md',
      title: 'Token',
      path: 'Notes/Token.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-27T00:00:00.000Z',
      chars: 4,
      archived_at: '2026-05-27T00:01:00.000Z',
      version_token: VERSION_TOKEN,
    } as Parameters<typeof documentArchiveResult>[0] & { version_token: string });

    expectCallerVersionToken(payload);
  });

  it('T-U-021 remove_document success omits version_token because the source file no longer exists', () => {
    const payload = documentRemovalResult({
      identifier: 'Notes/Token.md',
      title: 'Token',
      path: 'Notes/Token.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-27T00:00:00.000Z',
      chars: 4,
      archived_at: '2026-05-27T00:01:00.000Z',
      moved_to: null,
      version_token: VERSION_TOKEN,
    } as Parameters<typeof documentRemovalResult>[0] & { version_token: string });

    expect(payload).not.toHaveProperty('version_token');
    expect(payload).not.toHaveProperty('content_hash');
    expect(payload).not.toHaveProperty('contentHash');
  });
});
