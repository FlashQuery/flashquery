/**
 * Token redaction utility for safe logging.
 *
 * Provides a single function `redactToken()` that redacts token values before they
 * are written to logs. Applied at call sites (not in the logger itself) so the
 * redaction points are explicit and auditable.
 *
 * Redaction strategy (D-03):
 * - JWT (3 parts separated by dots): first 8 chars + ***
 * - sk- prefixed secrets: prefix + first 8 chars after prefix + ***
 * - Other strings: first 8 chars + ***
 * - null/undefined/empty/whitespace: returned unchanged
 */

/**
 * Redacts a token or secret value for safe inclusion in log messages.
 *
 * @param token - The token or secret to redact
 * @returns Redacted version showing only identifying prefix/characters, or the
 *          original value if it is null, undefined, empty, or whitespace-only
 *
 * @example
 * redactToken('eyJ0eXAi...header.payload.sig') // → 'eyJ0eXAi***'
 * redactToken('sk-abc123def456xyz789')          // → 'sk-abc12345***'
 * redactToken('plain-token-value')              // → 'plain-to***'
 * redactToken(null)                             // → null
 * redactToken('')                               // → ''
 */
export function redactToken(token: string | null | undefined): string | null | undefined {
  // Pass through null/undefined unchanged
  if (token === null || token === undefined) {
    return token;
  }

  // Pass through empty or whitespace-only strings unchanged
  if (token.trim() === '') {
    return token;
  }

  // JWT format: exactly 2 dots separating header.payload.signature
  const parts = token.split('.');
  if (parts.length === 3) {
    return token.slice(0, 8) + '***';
  }

  // sk- prefixed secret (e.g., OpenAI-style API keys)
  if (token.startsWith('sk-')) {
    // Take first 8 characters after the 'sk-' prefix (positions 3-10)
    const afterPrefix = token.slice(3, 11); // up to 8 chars after sk-
    return `sk-${afterPrefix}***`;
  }

  // All other token-like strings: first 8 characters + ***
  return token.slice(0, 8) + '***';
}
