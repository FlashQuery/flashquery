/**
 * Human-readable file size formatting for vault directory listing
 * Uses base-1000 thresholds (not base-1024) per SPEC-21 Size formatting spec
 *
 * Pattern (Phase 91):
 * - Thresholds: < 1000 → B, < 1_000_000 → KB, < 1_000_000_000 → MB, else GB
 * - One decimal place for KB/MB/GB
 */

/**
 * Format a byte count as a human-readable size string (base-1000)
 *
 * @example
 * formatFileSize(500) → '500 B'
 * formatFileSize(2340) → '2.3 KB'
 * formatFileSize(14700000) → '14.7 MB'
 * formatFileSize(999999) → '1000.0 KB'  ← note: still KB, not MB
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
