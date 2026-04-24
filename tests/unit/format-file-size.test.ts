import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../../src/mcp/utils/format-file-size.js';

describe('formatFileSize', () => {
  it('formats 0 bytes (U-44)', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats 500 bytes (U-45)', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats 999 bytes (U-46)', () => {
    expect(formatFileSize(999)).toBe('999 B');
  });

  it('formats 1000 bytes as 1.0 KB (U-47)', () => {
    expect(formatFileSize(1000)).toBe('1.0 KB');
  });

  it('formats 2340 bytes as 2.3 KB (U-48)', () => {
    expect(formatFileSize(2340)).toBe('2.3 KB');
  });

  it('formats 999_999 bytes as 1000.0 KB — not MB (U-49)', () => {
    expect(formatFileSize(999_999)).toBe('1000.0 KB');
  });

  it('formats 1_000_000 bytes as 1.0 MB (U-50)', () => {
    expect(formatFileSize(1_000_000)).toBe('1.0 MB');
  });

  it('formats 14_700_000 bytes as 14.7 MB (U-51)', () => {
    expect(formatFileSize(14_700_000)).toBe('14.7 MB');
  });

  it('formats 1_000_000_000 bytes as 1.0 GB (U-52)', () => {
    expect(formatFileSize(1_000_000_000)).toBe('1.0 GB');
  });

  it('formats 1_200_000_000 bytes as 1.2 GB (U-53)', () => {
    expect(formatFileSize(1_200_000_000)).toBe('1.2 GB');
  });
});
