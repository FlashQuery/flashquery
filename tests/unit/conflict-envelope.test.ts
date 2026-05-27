import { describe, expect, it } from 'vitest';
import { jsonExpectedError } from '../../src/mcp/utils/response-formats.js';

const VERSION_TOKEN = 'b'.repeat(64);

function parseExpectedError(result: ReturnType<typeof jsonExpectedError>): Record<string, unknown> {
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-015 version mismatch conflict envelope', () => {
  it('T-U-023 returns expected conflict JSON with version_token and targeted_region, not runtime isError', async () => {
    const { buildVersionMismatchEnvelope } = await import(
      '../../src/mcp/utils/document-version.js'
    );

    const envelope = buildVersionMismatchEnvelope({
      identifier: 'Notes/Token.md',
      versionToken: VERSION_TOKEN,
      targetedRegion: {
        kind: 'section',
        heading: 'Decision Log',
        content: 'Current section content',
      },
    });

    const result = jsonExpectedError(envelope);
    const payload = parseExpectedError(result);

    expect(payload).toMatchObject({
      error: 'conflict',
      identifier: 'Notes/Token.md',
      details: { reason: 'version_mismatch' },
      version_token: VERSION_TOKEN,
      targeted_region: {
        kind: 'section',
        heading: 'Decision Log',
        content: 'Current section content',
      },
    });
    expect(payload).not.toHaveProperty('content_hash');
    expect(payload).not.toHaveProperty('contentHash');
    expect(payload).not.toHaveProperty('section_hash');
    expect(payload).not.toHaveProperty('section_version_token');
  });
});
