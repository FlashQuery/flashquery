export const TEMPLATE_WARNING_TYPES = [
  'unknown_param_ignored',
  'optional_param_missing_no_default',
  'undeclared_placeholder_left_literal',
] as const;

export type TemplateWarningType = typeof TEMPLATE_WARNING_TYPES[number];

export interface TemplateWarning {
  type: TemplateWarningType;
  param?: string;
  placeholder?: string;
}
