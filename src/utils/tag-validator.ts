// ─────────────────────────────────────────────────────────────────────────────
// Tag Validator Module
//
// Pure functions — no side effects, no imports beyond types.
// All validation functions normalize before operating to prevent Pitfall 5
// (pre-normalization duplicates being missed by dedup checks).
// ─────────────────────────────────────────────────────────────────────────────

export interface TagValidationResult {
  normalized: string[];
  valid: boolean;
  errors: string[];      // Duplicate detection errors (TAGS-02)
  conflicts: string[];   // Always empty array; field retained for API compatibility (TAGS-03 removed)
}

/**
 * Normalize tags: trim whitespace, lowercase, filter empty strings.
 * Hash prefix is preserved; casing within is lowered.
 * Example: [" Status ", "MyTag", "  "] => ["status", "mytag"]
 */
export function normalizeTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

/**
 * Validate that no duplicate tags exist after normalization (TAGS-02).
 * Normalizes internally so callers need not pre-normalize.
 * Error format: "Tag '{tag}' appears multiple times"
 */
export function validateTagUniqueness(tags: string[]): { valid: boolean; errors: string[] } {
  const normalized = normalizeTags(tags);
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const tag of normalized) {
    if (seen.has(tag)) {
      duplicates.add(tag);
    } else {
      seen.add(tag);
    }
  }

  const errors = Array.from(duplicates).map(
    (tag) => `Tag '${tag}' appears multiple times`,
  );

  return { valid: errors.length === 0, errors };
}

/**
 * Compose all tag validation checks into a single TagValidationResult.
 * Normalizes once, then passes the normalized array to uniqueness validator.
 * Status mutual exclusivity check removed (D-06): #status/* tags treated like any other tag.
 */
export function validateAllTags(tags: string[]): TagValidationResult {
  const normalized = normalizeTags(tags);

  const uniqueness = validateTagUniqueness(normalized);
  const valid = uniqueness.valid;

  return {
    normalized,
    valid,
    errors: uniqueness.errors,
    conflicts: [], // Always empty array; field retained for API compatibility
  };
}

/**
 * Deduplicate tags after normalization.
 * Input: tags array (may contain duplicates, mixed case)
 * Output: normalized, deduplicated array with no duplicates (case-insensitive)
 *
 * Uses Set-based deduplication AFTER normalization to catch mixed-case duplicates:
 * ["Status", "status"] → normalize → ["status", "status"] → Set → ["status"]
 *
 * This is a defensive safeguard used before every frontmatter write to guarantee
 * uniqueness even if duplicates somehow bypass validation.
 */
export function deduplicateTags(tags: string[]): string[] {
  const normalized = normalizeTags(tags);
  return Array.from(new Set(normalized));
}
