/**
 * Frontmatter Sanitizer (SPEC-18)
 *
 * Removes database-only fields before persisting frontmatter to the vault.
 * Ensures that internal implementation details (content hashes, instance IDs, etc.)
 * don't leak into user-visible markdown files.
 *
 * Fields removed: content_hash, ownership_plugin_id, discovery_status, embedding, instance_id
 * Fields preserved: fqc_id, fqc_instance, status, title, tags, created, updated, and user-provided fields
 *
 * This enables lazy cleanup — any file written through the normal write paths will have
 * DB metadata automatically stripped on next write, with no need for an explicit cleanup command.
 */

/**
 * Remove database-only fields before persisting to vault.
 * Preserves: fqc_id, fqc_instance, status, title, tags, created, updated, and user-provided fields.
 * Removes: content_hash, ownership_plugin_id, discovery_status, embedding, instance_id, and other internal fields.
 *
 * @param fullFrontmatter - Raw frontmatter object (may contain DB-only fields)
 * @returns New object with internal fields removed and key order preserved
 */
export function serializeOrderedFrontmatter(
  fullFrontmatter: Record<string, unknown>
): Record<string, unknown> {
  // Define fields that should never be persisted to user files
  const internalFields = new Set([
    'content_hash',
    'ownership_plugin_id',
    'discovery_status',
    'embedding',
    'instance_id',
    // Note: fqc_instance is allowed (per schema) and should be preserved
  ]);

  // Define preserve-order fields: these appear first in the output for YAML stability
  const preserveOrder = ['fqc_id', 'status', 'title', 'tags', 'created', 'updated'];

  // Build ordered output: preserve-order fields first
  const ordered: Record<string, unknown> = {};

  for (const key of preserveOrder) {
    if (key in fullFrontmatter) {
      ordered[key] = fullFrontmatter[key];
    }
  }

  // Add remaining user-provided fields (not internal, not already added)
  for (const [key, value] of Object.entries(fullFrontmatter)) {
    if (!internalFields.has(key) && !preserveOrder.includes(key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}
