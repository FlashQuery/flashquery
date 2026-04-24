import { describe, it, expect } from 'vitest';
import { parseDateFilter } from '../../src/mcp/utils/date-filter.js';

describe('parseDateFilter', () => {
  describe('relative formats', () => {
    it('parses "7d" as timestamp 7 days ago', () => {
      const before = Date.now();
      const result = parseDateFilter('7d');
      const after = Date.now();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      // Result should be approximately 7 days before now
      const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(result).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000);
      expect(result).toBeLessThanOrEqual(after - 7 * 24 * 60 * 60 * 1000 + 1000);
    });

    it('parses "24h" as timestamp 24 hours ago', () => {
      const before = Date.now();
      const result = parseDateFilter('24h');
      const after = Date.now();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      expect(result).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000);
      expect(result).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
    });

    it('parses "1w" as timestamp 7 days ago (same as 7d)', () => {
      const result7d = parseDateFilter('7d');
      const result1w = parseDateFilter('1w');
      expect(typeof result1w).toBe('number');
      expect(result1w).toBeGreaterThan(0);
      // Should be within a few ms of the 7d result
      expect(Math.abs((result1w as number) - (result7d as number))).toBeLessThan(100);
    });
  });

  describe('ISO date formats', () => {
    it('parses ISO date "2026-04-01" as correct timestamp', () => {
      const result = parseDateFilter('2026-04-01');
      expect(result).toBe(new Date('2026-04-01').getTime());
    });
  });

  describe('NaN bug fix', () => {
    it('returns null for "garbage" input — not NaN (NaN bug fix)', () => {
      const result = parseDateFilter('garbage');
      expect(result).toBeNull();
      // Explicit NaN check — toBeFalsy() would also pass for NaN, so use Number.isNaN
      expect(Number.isNaN(result)).toBe(false);
    });

    it('returns null for empty string', () => {
      const result = parseDateFilter('');
      expect(result).toBeNull();
    });

    it('returns null for invalid ISO string "not-a-date"', () => {
      const result = parseDateFilter('not-a-date');
      expect(result).toBeNull();
    });
  });
});
