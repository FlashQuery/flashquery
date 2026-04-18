import { describe, it, expect } from 'vitest';
import {
  normalizeTags,
  validateTagUniqueness,
  validateAllTags,
  deduplicateTags,
} from '../../src/utils/tag-validator.js';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeTags
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeTags', () => {
  it('trims whitespace and lowercases tags, filters empty strings', () => {
    expect(normalizeTags([' Status ', 'MyTag', '  '])).toEqual(['status', 'mytag']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it('preserves hash prefix and lowercases casing', () => {
    expect(normalizeTags(['#status/Draft'])).toEqual(['#status/draft']);
  });

  it('trims tab and newline whitespace variants', () => {
    expect(normalizeTags(['\t tab \n'])).toEqual(['tab']);
  });

  it('passes through already-clean tags unchanged', () => {
    expect(normalizeTags(['already-clean'])).toEqual(['already-clean']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateTagUniqueness
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTagUniqueness', () => {
  it('reports duplicate tags with actionable error message', () => {
    const result = validateTagUniqueness(['status', 'status', 'mytag']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Tag 'status' appears multiple times");
  });

  it('returns valid for unique tags', () => {
    const result = validateTagUniqueness(['a', 'b', 'c']);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid for empty array', () => {
    const result = validateTagUniqueness([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('catches pre-normalization duplicates (Pitfall 5 — Status vs status)', () => {
    // validateTagUniqueness normalizes internally before dedup check
    const result = validateTagUniqueness(['Status', 'status']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Tag 'status' appears multiple times");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAllTags
// Note: validateStatusMutualExclusivity removed (D-06). #status/* tags are
// treated like any other tag — no special conflict validation.
// ─────────────────────────────────────────────────────────────────────────────

describe('validateAllTags', () => {
  it('composes normalization and validation — clean tags produce valid result', () => {
    const result = validateAllTags([' Status ', 'MyTag']);
    expect(result.normalized).toEqual(['status', 'mytag']);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('allows multiple #status/* tags — no conflict rejection after D-06 removal', () => {
    const result = validateAllTags(['#status/draft', '#status/published']);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports uniqueness errors when duplicate tags present after normalization', () => {
    const result = validateAllTags(['tag', 'Tag']);
    expect(result.normalized).toEqual(['tag', 'tag']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Tag 'tag' appears multiple times");
    expect(result.conflicts).toEqual([]);
  });

  it('reports uniqueness errors with duplicate #status/* tags; conflicts always empty', () => {
    const result = validateAllTags(['#status/active', '#status/active', 'dup', 'dup']);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.conflicts).toEqual([]);
  });

  it('accepts multiple non-duplicate #status/* variants (D-06)', () => {
    const result = validateAllTags(['#status/draft', '#status/in-review']);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deduplicateTags
// ─────────────────────────────────────────────────────────────────────────────

describe('deduplicateTags', () => {
  it('removes exact duplicates', () => {
    expect(deduplicateTags(['tag', 'tag', 'other'])).toEqual(['tag', 'other']);
  });

  it('removes case-insensitive duplicates', () => {
    expect(deduplicateTags(['Status', 'status', 'STATUS'])).toEqual(['status']);
  });

  it('handles empty input', () => {
    expect(deduplicateTags([])).toEqual([]);
  });

  it('returns single tag unchanged', () => {
    expect(deduplicateTags(['mytag'])).toEqual(['mytag']);
  });

  it('preserves hash prefix and lowercases', () => {
    expect(deduplicateTags(['#crm/contact', '#CRM/CONTACT'])).toEqual(['#crm/contact']);
  });

  it('handles mixed case with whitespace', () => {
    expect(deduplicateTags([' Tag ', 'tag', ' TAG '])).toEqual(['tag']);
  });

  it('handles special characters in tag names', () => {
    expect(deduplicateTags(['crm/contact', 'crm/contact', 'status/active'])).toEqual(['crm/contact', 'status/active']);
  });

  it('is idempotent: deduplicating clean tags is a no-op', () => {
    const clean = ['tag1', 'tag2', 'tag3'];
    expect(deduplicateTags(clean)).toEqual(clean);
  });
});
