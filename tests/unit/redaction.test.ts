import { describe, it, expect } from 'vitest';
import { redactToken } from '../../src/mcp/redaction.js';

describe('redactToken()', () => {
  it('should redact JWT token to first 8 chars + ***', () => {
    const input =
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3N1ZWRfYXQ6MTY2OTk0NTU3NX0.signature';
    const result = redactToken(input);
    expect(result).toBe('eyJ0eXAi***');
    expect(result).not.toContain(input);
    expect(result).toMatch(/^eyJ0eXAi\*\*\*$/);
  });

  it('should redact sk- prefixed secret to prefix + 8 chars + ***', () => {
    const input = 'sk-abc123def456xyz789';
    const result = redactToken(input);
    // 'sk-' prefix + first 8 chars after prefix = 'abc123de' + '***'
    expect(result).toBe('sk-abc123de***');
    expect(result).toContain('sk-');
    expect(result).not.toContain('def456xyz789');
  });

  it('should redact malformed token (no dots, no sk- prefix) to first 8 chars + ***', () => {
    const input = 'just-a-plain-string-token';
    const result = redactToken(input);
    expect(result).toBe('just-a-p***');
    expect(result).not.toContain(input);
  });

  it('should return null unchanged', () => {
    const result = redactToken(null);
    expect(result).toEqual(null);
  });

  it('should return empty string unchanged', () => {
    const result = redactToken('');
    expect(result).toEqual('');
  });

  it('should return whitespace-only string unchanged', () => {
    const input = '   ';
    const result = redactToken(input);
    expect(result).toEqual(input);
  });

  it('should handle very short sk- token gracefully (less than 8 chars after prefix)', () => {
    const input = 'sk-ab';
    const result = redactToken(input);
    expect(result).toBe('sk-ab***');
    expect(result).toContain('sk-');
    expect(result).toContain('***');
  });

  it('should not include full plaintext token in output (negative test)', () => {
    const input = 'my-secret-token-12345';
    const result = redactToken(input);
    expect(result).not.toBe(input);
    // Full plaintext token should not appear verbatim in output
    expect(result).not.toContain('my-secret-token-12345');
    // Should still contain *** to indicate redaction
    expect(result).toContain('***');
  });

  it('should handle undefined unchanged', () => {
    const result = redactToken(undefined);
    expect(result).toEqual(undefined);
  });

  it('should handle JWT token with minimal content (short parts)', () => {
    // JWT with 2 dots = 3 parts, should use JWT redaction path
    const input = 'abc.def.ghi';
    const result = redactToken(input);
    expect(result).toBe('abc.def.***');
    expect(result).toContain('***');
  });
});
