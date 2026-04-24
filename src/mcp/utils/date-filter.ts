/**
 * Date filter parsing utility for vault listing operations
 * Extracted from compound.ts (parseDateFilter) with NaN bug fix
 *
 * Pattern (Phase 91):
 * - Supports relative format: "7d", "24h", "1w" → returns timestamp ms
 * - Supports ISO format: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SSZ" → returns timestamp ms
 * - Invalid strings return null (not NaN — the bug fix)
 *
 * NOTE: compound.ts keeps its own copy of this function until Phase 94 removes list_files.
 * Do NOT update compound.ts imports in Phase 91. (D-02)
 */

/**
 * Parse a date filter string into a Unix timestamp (ms).
 * Returns null for invalid or unrecognized input.
 *
 * @example
 * parseDateFilter('7d') → timestamp 7 days ago
 * parseDateFilter('2026-04-01') → 1743465600000
 * parseDateFilter('garbage') → null (not NaN)
 */
export function parseDateFilter(dateStr: string): number | null {
  // Relative format: "7d", "24h", "1w"
  const relMatch = /^(\d+)([dwh])$/.exec(dateStr);
  if (relMatch) {
    const num = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const now = Date.now();
    if (unit === 'd') return now - num * 24 * 60 * 60 * 1000;
    if (unit === 'w') return now - num * 7 * 24 * 60 * 60 * 1000;
    if (unit === 'h') return now - num * 60 * 60 * 1000;
  }
  // ISO format: fix the NaN bug — new Date('garbage').getTime() returns NaN (does NOT throw)
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return null; // THE FIX: was missing from compound.ts
  return ts;
}
