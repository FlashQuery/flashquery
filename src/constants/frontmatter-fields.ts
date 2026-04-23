/**
 * Single source of truth for all FlashQuery-managed frontmatter field names.
 *
 * Key ordering mirrors the preferred write order for frontmatter fields.
 * FM.ID (fq_id) is last — a deliberate choice; document identity is appended
 * after human-readable metadata.
 *
 * Use `as const` (NOT Object.freeze) so TypeScript infers narrow string literal
 * types — required for `typeof FM.ID` type references in resolve-document.ts.
 */
export const FM = {
  TITLE:    'fq_title',
  STATUS:   'fq_status',
  TAGS:     'fq_tags',
  CREATED:  'fq_created',
  UPDATED:  'fq_updated',
  OWNER:    'fq_owner',
  TYPE:     'fq_type',
  INSTANCE: 'fq_instance',
  ID:       'fq_id',
} as const;

export type FrontmatterFieldName = typeof FM[keyof typeof FM];
