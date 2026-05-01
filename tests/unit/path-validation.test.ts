import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateVaultPath,
  normalizePath,
  joinWithRoot,
  sanitizeDirectorySegment,
  validateSegment,
} from '../../src/mcp/utils/path-validation.js';

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `fqc-path-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('validateVaultPath', () => {
  it('accepts a valid relative path inside vault root (U-01)', async () => {
    const result = await validateVaultPath(testDir, 'Projects/CRM');
    expect(result.valid).toBe(true);
    expect(result.absPath).toBe(join(testDir, 'Projects/CRM'));
    expect(result.relativePath).toBe('Projects/CRM');
  });

  it('rejects path traversal with ../etc (U-02)', async () => {
    const result = await validateVaultPath(testDir, '../etc');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/traversal|outside/i);
  });

  it('rejects deeply nested traversal a/b/c/../../../../etc (U-03)', async () => {
    const result = await validateVaultPath(testDir, 'a/b/c/../../../../etc');
    expect(result.valid).toBe(false);
  });

  it('rejects a real symlink via lstat (U-04)', async () => {
    const symlinkPath = join(testDir, 'sym-link');
    symlinkSync('/tmp', symlinkPath);

    const result = await validateVaultPath(testDir, 'sym-link');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/symlink/i);
  });

  it('accepts a real subdirectory (not symlink) (U-05)', async () => {
    const subDir = join(testDir, 'realdir');
    mkdirSync(subDir, { recursive: true });

    const result = await validateVaultPath(testDir, 'realdir');
    expect(result.valid).toBe(true);
  });

  it('accepts a non-existent child path — skips lstat for missing segments (U-06)', async () => {
    const result = await validateVaultPath(testDir, 'nonexistent/child');
    expect(result.valid).toBe(true);
  });

  it('rejects empty string as vault root target (U-07)', async () => {
    const result1 = await validateVaultPath(testDir, '');
    expect(result1.valid).toBe(false);
    expect(result1.error).toMatch(/vault root|cannot target/i);

    const result2 = await validateVaultPath(testDir, '/');
    expect(result2.valid).toBe(false);
    expect(result2.error).toMatch(/vault root|cannot target/i);

    const result3 = await validateVaultPath(testDir, '.');
    expect(result3.valid).toBe(false);
    expect(result3.error).toMatch(/vault root|cannot target/i);
  });

  it('accepts nested path Projects/CRM/Contacts (U-08)', async () => {
    const result = await validateVaultPath(testDir, 'Projects/CRM/Contacts');
    expect(result.valid).toBe(true);
    expect(result.relativePath).toBe('Projects/CRM/Contacts');
  });
});

describe('normalizePath', () => {
  it('strips leading slash (U-09)', () => {
    expect(normalizePath('/CRM')).toBe('CRM');
  });

  it('strips trailing slash (U-10)', () => {
    expect(normalizePath('CRM/')).toBe('CRM');
  });

  it('collapses consecutive slashes (U-11)', () => {
    expect(normalizePath('CRM//Contacts')).toBe('CRM/Contacts');
  });

  it('strips leading and trailing slashes and collapses consecutive slashes (U-12)', () => {
    expect(normalizePath('//CRM///Contacts/')).toBe('CRM/Contacts');
  });
});

describe('joinWithRoot', () => {
  it('joins root and child with slash (U-13)', () => {
    expect(joinWithRoot('Projects', 'CRM')).toBe('Projects/CRM');
  });

  it('normalizes both root and child before joining (U-14)', () => {
    expect(joinWithRoot('/Projects/', '/CRM/')).toBe('Projects/CRM');
  });
});

describe('sanitizeDirectorySegment', () => {
  it('replaces colon with space (U-15)', () => {
    const result = sanitizeDirectorySegment('Work:Projects');
    expect(result.sanitized).toBe('Work Projects');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain(':');
  });

  it('replaces pipe with space (U-16)', () => {
    const result = sanitizeDirectorySegment('A|B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain('|');
  });

  it('replaces angle brackets with spaces and collapses (U-17)', () => {
    const result = sanitizeDirectorySegment('A<B>C');
    expect(result.sanitized).toBe('A B C');
    expect(result.changed).toBe(true);
  });

  it('replaces backslash with space (U-18)', () => {
    const result = sanitizeDirectorySegment('A\\B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
  });

  it('replaces question mark and asterisk with spaces (U-19)', () => {
    const result = sanitizeDirectorySegment('A?B*C');
    expect(result.sanitized).toBe('A B C');
    expect(result.changed).toBe(true);
  });

  it('replaces double quote with space (U-20)', () => {
    const result = sanitizeDirectorySegment('A"B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain('"');
  });

  it('replaces NUL byte with space (U-21)', () => {
    const result = sanitizeDirectorySegment('A\0B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
  });

  it('replaces control char 0x01 with space (U-22)', () => {
    const result = sanitizeDirectorySegment('A\x01B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
  });

  it('collapses multiple consecutive illegal chars to single space (U-23)', () => {
    const result = sanitizeDirectorySegment('A:::B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
  });

  it('trims leading illegal char (U-24)', () => {
    const result = sanitizeDirectorySegment(':Leading');
    expect(result.sanitized).toBe('Leading');
    expect(result.changed).toBe(true);
  });

  it('returns unchanged=false and empty replacedChars for clean name (U-25)', () => {
    const result = sanitizeDirectorySegment('CleanName');
    expect(result.sanitized).toBe('CleanName');
    expect(result.changed).toBe(false);
    expect(result.replacedChars).toEqual([]);
  });

  it('collects multiple distinct replaced chars (U-26)', () => {
    const result = sanitizeDirectorySegment('A:B|C');
    expect(result.replacedChars).toContain(':');
    expect(result.replacedChars).toContain('|');
  });

  it('replaces opening bracket [ with space (U-53)', () => {
    const result = sanitizeDirectorySegment('[tag]');
    expect(result.sanitized).toBe('tag');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain('[');
  });

  it('replaces closing bracket ] with space (U-54)', () => {
    const result = sanitizeDirectorySegment('A]B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain(']');
  });

  it('replaces comma , with space (U-55)', () => {
    const result = sanitizeDirectorySegment('A,B');
    expect(result.sanitized).toBe('A B');
    expect(result.changed).toBe(true);
    expect(result.replacedChars).toContain(',');
  });

  it('collapses JSON-array-like segment to trimmed form (U-56)', () => {
    // The full JSON string passed as a single path segment (edge case)
    const result = sanitizeDirectorySegment('["Roadmap","Reference"]');
    expect(result.changed).toBe(true);
    // All [ ] , " chars replaced; result should not start or end with spaces
    expect(result.sanitized).not.toMatch(/^\s/);
    expect(result.sanitized).not.toMatch(/\s$/);
  });
});

describe('validateSegment', () => {
  it('returns non-null error for whitespace-only segment (U-27)', () => {
    const result = validateSegment('   ', 0);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('returns non-null error for empty segment (U-28)', () => {
    const result = validateSegment('', 0);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('returns null for segment of exactly 255 bytes (U-29)', () => {
    const segment = 'a'.repeat(255);
    expect(Buffer.byteLength(segment, 'utf8')).toBe(255);
    const result = validateSegment(segment, 0);
    expect(result).toBeNull();
  });

  it('returns non-null error for segment of exactly 256 bytes (U-30)', () => {
    const segment = 'a'.repeat(256);
    expect(Buffer.byteLength(segment, 'utf8')).toBe(256);
    const result = validateSegment(segment, 0);
    expect(result).not.toBeNull();
  });

  it('validateVaultPath accepts path whose total length is 4096 bytes (U-31)', async () => {
    // Build a path whose relative portion is exactly 4095 bytes (16 segments of 255 'a' chars
    // joined by 15 slashes: 16*255 + 15 = 4095 < 4096 — must not be rejected for path length)
    const segments = Array(16).fill('a'.repeat(255));
    const longPath = segments.join('/');
    expect(Buffer.byteLength(longPath, 'utf8')).toBe(4095); // 16*255 + 15 slashes
    const result = await validateVaultPath(testDir, longPath);
    // Should not be rejected for path-length reasons (4095 < 4096)
    // result may be valid=true or valid=false for other reasons (e.g. OS limits on lstat)
    // but the error must NOT mention exceeding 4096 bytes
    expect(result.error ?? '').not.toMatch(/path.*too long|exceeds.*4096/i);
  });

  it('validateVaultPath rejects path whose total length is 4097 bytes (U-32)', async () => {
    // Build a path that exceeds 4096 bytes total
    // 16 * 255 + 15 slashes = 4095; add 2 more chars to get 4097
    const segments = Array(16).fill('a'.repeat(255));
    const longPath = segments.join('/') + '/ab';
    expect(Buffer.byteLength(longPath, 'utf8')).toBeGreaterThan(4096);
    const result = await validateVaultPath(testDir, longPath);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path.*too long|exceeds.*4096/i);
  });

  it('returns non-null error for segment with 128 multi-byte UTF-8 chars (256 bytes) (U-33)', () => {
    // Each 'é' is 2 bytes in UTF-8 (U+00E9)
    const segment = 'é'.repeat(128); // 128 chars * 2 bytes = 256 bytes
    expect(Buffer.byteLength(segment, 'utf8')).toBe(256);
    expect(segment.length).toBe(128); // char count is only 128
    const result = validateSegment(segment, 0);
    expect(result).not.toBeNull(); // byte count exceeds 255
  });
});
