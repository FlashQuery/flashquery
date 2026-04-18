import { describe, it, expect } from 'vitest';
import { isValidUuid } from '../../src/utils/uuid.js';

// ─────────────────────────────────────────────────────────────────────────────
// isValidUuid — unit tests
// Requirements: INF-03, D-07
// ─────────────────────────────────────────────────────────────────────────────

describe('isValidUuid', () => {
  // ── Valid UUIDs ─────────────────────────────────────────────────────────────

  describe('valid v4 UUIDs', () => {
    it('accepts lowercase v4 UUID', () => {
      expect(isValidUuid('12345678-1234-4234-b234-567812345678')).toBe(true);
    });

    it('accepts uppercase v4 UUID', () => {
      expect(isValidUuid('FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF')).toBe(true);
    });

    it('accepts mixed-case v4 UUID', () => {
      expect(isValidUuid('12345678-1234-4abc-Bdef-567812345678')).toBe(true);
    });

    it('accepts another valid v4 UUID', () => {
      // The 13th char (0-indexed) must be '4' for v4
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });
  });

  describe('valid v5 UUIDs', () => {
    it('accepts lowercase v5 UUID', () => {
      // v5: version nibble = 5
      expect(isValidUuid('886313e1-3b8a-5372-9b90-0c9aee199e5d')).toBe(true);
    });

    it('accepts another v5 UUID', () => {
      expect(isValidUuid('74738ff5-5367-5958-9aee-98fffdcd1876')).toBe(true);
    });
  });

  // ── Nil UUID rejection ──────────────────────────────────────────────────────

  describe('nil UUID rejection', () => {
    it('rejects nil UUID (all zeros)', () => {
      expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(false);
    });
  });

  // ── Malformed format rejection ──────────────────────────────────────────────

  describe('malformed format rejection', () => {
    it('rejects UUID without hyphens', () => {
      expect(isValidUuid('12345678123456781234567812345678')).toBe(false);
    });

    it('rejects UUID with wrong segment lengths', () => {
      expect(isValidUuid('12345-1234-4234-b234-567812345678')).toBe(false);
    });

    it('rejects UUID with non-hex characters', () => {
      expect(isValidUuid('gggggggg-1234-4234-b234-567812345678')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidUuid('')).toBe(false);
    });

    it('rejects UUID with extra characters', () => {
      expect(isValidUuid('12345678-1234-4234-b234-567812345678-extra')).toBe(false);
    });

    it('rejects partial UUID', () => {
      expect(isValidUuid('12345678-1234-4234-b234')).toBe(false);
    });
  });

  // ── Non-string input rejection ──────────────────────────────────────────────

  describe('non-string input rejection', () => {
    it('rejects null', () => {
      expect(isValidUuid(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidUuid(undefined)).toBe(false);
    });

    it('rejects number', () => {
      expect(isValidUuid(123)).toBe(false);
    });

    it('rejects object', () => {
      expect(isValidUuid({})).toBe(false);
    });

    it('rejects array', () => {
      expect(isValidUuid([])).toBe(false);
    });

    it('rejects boolean', () => {
      expect(isValidUuid(true)).toBe(false);
    });
  });

  // ── Non-v4/v5 version rejection ─────────────────────────────────────────────

  describe('non-v4/v5 version rejection', () => {
    it('rejects v1 UUID', () => {
      // v1: version nibble = 1
      expect(isValidUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
    });

    it('rejects v3 UUID', () => {
      // v3: version nibble = 3
      expect(isValidUuid('6fa459ea-ee8a-3ca4-894e-db77e160355e')).toBe(false);
    });

    it('rejects v6 UUID', () => {
      // v6: version nibble = 6
      expect(isValidUuid('1ec9414c-232a-6b00-b3c8-9e6bdeced846')).toBe(false);
    });

    it('rejects v7 UUID', () => {
      // v7: version nibble = 7
      expect(isValidUuid('018c0658-4c94-77e3-8a1d-e65b4c8e8a7f')).toBe(false);
    });
  });
});
