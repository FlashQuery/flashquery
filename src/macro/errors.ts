import type { ErrorEnvelope } from '../mcp/utils/response-formats.js';

export type MacroParseErrorReason =
  | 'unexpected_token'
  | 'missing_do'
  | 'missing_done'
  | 'missing_then'
  | 'missing_fi'
  | 'malformed_fence_attributes'
  | 'reserved_keyword_assignment'
  | 'builtin_name_shadowing'
  | 'invalid_literal'
  | 'input_var_key_must_be_literal';

export interface MacroParseErrorDetails {
  reason: MacroParseErrorReason;
  at_line: number;
  near_token?: string;
}

export type MacroParseErrorEnvelope = ErrorEnvelope & {
  error: 'parse_error';
  details: MacroParseErrorDetails;
};

export type MacroInvalidInputReason =
  | 'exactly_one_required'
  | 'empty_source'
  | 'empty_source_ref'
  | 'invalid_source_ref_format'
  | 'invalid_block_name_format'
  | 'no_macro_blocks'
  | 'ambiguous_macro_block'
  | 'block_not_found'
  | 'duplicate_block_name';

export type MacroInvalidInputEnvelope = ErrorEnvelope & {
  error: 'invalid_input';
  details: { reason: MacroInvalidInputReason } & Record<string, unknown>;
};

export function macroParseError(
  details: MacroParseErrorDetails,
  message = 'Macro source could not be parsed.',
  identifier?: string
): MacroParseErrorEnvelope {
  return {
    error: 'parse_error',
    message,
    ...(identifier === undefined ? {} : { identifier }),
    details: {
      reason: details.reason,
      at_line: details.at_line,
      ...(details.near_token === undefined ? {} : { near_token: details.near_token }),
    },
  };
}

export function macroInvalidInput(
  reason: MacroInvalidInputReason,
  details: Record<string, unknown> = {},
  message = 'Macro input is invalid.',
  identifier?: string
): MacroInvalidInputEnvelope {
  return {
    error: 'invalid_input',
    message,
    ...(identifier === undefined ? {} : { identifier }),
    details: { reason, ...details },
  };
}
