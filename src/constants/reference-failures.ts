export const REFERENCE_FAILURE_REASONS = [
  'invalid_reference_syntax',
  'document_not_found',
  'ambiguous_document_identifier',
  'read_error',
  'section_not_found',
  'occurrence_out_of_range',
  'reference_path_not_found',
  'reference_path_not_string',
  'pointer_target_not_found',
  'template_missing_required_param',
  'template_param_invalid_type',
  'template_param_doc_not_found',
  'alias_template_not_found',
  'alias_missing_template_field',
  'alias_key_not_found',
  'multi_ref_invalid_value',
  'multi_ref_item_failed',
  'unknown_reference_error',
] as const;

export type ReferenceFailureReason = typeof REFERENCE_FAILURE_REASONS[number];

export function isReferenceFailureReason(value: string): value is ReferenceFailureReason {
  return (REFERENCE_FAILURE_REASONS as readonly string[]).includes(value);
}
