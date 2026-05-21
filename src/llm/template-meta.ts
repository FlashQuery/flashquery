const TEMPLATE_META_KEYS = [
  'fq_template',
  'fq_expose_as_tool',
  'fq_namespace',
  'fq_desc',
  'fq_params',
] as const;

export type TemplateMeta = Partial<Record<typeof TEMPLATE_META_KEYS[number], unknown>>;

export function extractTemplateMeta(frontmatter: Record<string, unknown>): TemplateMeta | null {
  if (frontmatter.fq_template !== true) return null;

  const templateMeta: TemplateMeta = {};
  for (const key of TEMPLATE_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      templateMeta[key] = frontmatter[key];
    }
  }
  return templateMeta;
}
