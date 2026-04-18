import { validate, version } from 'uuid';

// Nil UUID — all zeros, version 0, never a valid FQC identifier
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Validates whether a value is a well-formed v4 or v5 UUID.
 * Rejects nil UUID (all zeros), non-UUID strings, and non-v4/v5 versions.
 * Case-insensitive. No exceptions thrown.
 *
 * **Requirements:** INF-03, D-07
 * - Accepts: v4 and v5 UUIDs (case-insensitive per RFC 4122)
 * - Rejects: nil UUID, malformed strings, other versions (v1/v3/v6/v7), non-strings
 *
 * @param value - the value to check (any type)
 * @returns true if valid v4 or v5 UUID, false otherwise
 */
export function isValidUuid(value: unknown): boolean {
  // Step 1: Type check — must be a non-empty string
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  // Step 2: Format validation — must pass RFC 4122 format check
  if (!validate(value)) {
    return false;
  }

  // Step 3: Nil UUID rejection — all-zeros UUID is never a valid FQC identifier
  if (value.toLowerCase() === NIL_UUID) {
    return false;
  }

  // Step 4: Version check — only v4 and v5 are accepted
  const ver = version(value);
  if (ver !== 4 && ver !== 5) {
    return false;
  }

  return true;
}
