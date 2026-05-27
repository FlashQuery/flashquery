import { createHash } from 'node:crypto';
import type { ErrorEnvelope } from './response-formats.js';

export interface ExpectedVersionInput {
  expected_version?: string;
  if_match?: string;
}

export interface VersionMismatchEnvelopeInput {
  identifier: string;
  versionToken: string;
  targetedRegion: Record<string, unknown>;
  message?: string;
}

export function computeVersionToken(raw: string | Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function pickExpectedVersion(input: ExpectedVersionInput): string | undefined {
  return input.expected_version ?? input.if_match;
}

export function buildVersionMismatchEnvelope(
  input: VersionMismatchEnvelopeInput
): ErrorEnvelope {
  return {
    error: 'conflict',
    message:
      input.message ??
      'Document changed since the supplied expected_version.',
    identifier: input.identifier,
    details: { reason: 'version_mismatch' },
    version_token: input.versionToken,
    targeted_region: input.targetedRegion,
  };
}
