import { FM } from '../../constants/frontmatter-fields.js';

/**
 * Frontmatter Sanitizer (SPEC-18)
 *
 * Removes database-only fields before persisting frontmatter to the vault.
 * Ensures that internal implementation details (content hashes, instance IDs, etc.)
 * don't leak into user-visible markdown files.
 *
 * Fields removed: content_hash, ownership_plugin_id, embedding, instance_id,
 *   fq_owner, fq_type, fq_instance (FQ-managed — placed at end via preserveOrder)
 * Fields preserved: fq_id, fq_instance, fq_status, fq_title, fq_tags, fq_created,
 *   fq_updated, and user-provided fields
 *
 * This enables lazy cleanup — any file written through the normal write paths will have
 * DB metadata automatically stripped on next write, with no need for an explicit cleanup command.
 */

/**
 * Remove database-only fields before persisting to vault.
 * User-defined fields appear FIRST; FQ-managed fields appear AFTER in established order.
 * Removes: content_hash, ownership_plugin_id, embedding, instance_id, and other internal fields.
 *
 * @param fullFrontmatter - Raw frontmatter object (may contain DB-only fields)
 * @returns New object with internal fields removed and key order: user fields first, FQ fields after
 */
export function serializeOrderedFrontmatter(
  fullFrontmatter: Record<string, unknown>
): Record<string, unknown> {
  // Define fields that should never be persisted to user files
  // FM.OWNER, FM.TYPE, FM.INSTANCE must be here AND in preserveOrder to prevent
  // them appearing in the user-fields loop (double-output guard)
  const internalFields = new Set([
    'content_hash',
    'ownership_plugin_id',
    'embedding',
    'instance_id',
    FM.OWNER,
    FM.TYPE,
    FM.INSTANCE,
  ]);

  // FQ-managed fields: placed at the end of the output in established order
  const preserveOrder = [
    FM.TITLE, FM.STATUS, FM.TAGS, FM.CREATED, FM.UPDATED,
    FM.OWNER, FM.TYPE, FM.INSTANCE, FM.ID,
  ];

  // Build ordered output: user-defined fields FIRST, FQ-managed fields AFTER
  const ordered: Record<string, unknown> = {};

  // User-defined fields first (not internal, not FQ-managed)
  for (const [key, value] of Object.entries(fullFrontmatter)) {
    if (!internalFields.has(key) && !preserveOrder.includes(key)) {
      ordered[key] = value;
    }
  }

  // FQ-managed fields after, in established order
  for (const key of preserveOrder) {
    if (key in fullFrontmatter) {
      ordered[key] = fullFrontmatter[key];
    }
  }

  return ordered;
}
