import type {
  LifecycleAction,
  LifecycleBaseInput,
  LifecycleScope,
  LifecycleValidationResult,
  MaxRowsValidationSuccess,
  RebuildConfirmResolution,
  ResolvedRebuildConfirmInput,
} from './types.js';

const LIFECYCLE_ACTION_SET = new Set<LifecycleAction>([
  'backfill_embeddings',
  'rebuild_embeddings',
  'retire_embedding',
  'abort',
]);

const RECORDS_EMBEDDING_CHOICE_MESSAGE =
  'plugin embedding choice is per-registration, not per-action; use register_plugin to change the choice';

export function isLifecycleAction(action: unknown): action is LifecycleAction {
  return typeof action === 'string' && LIFECYCLE_ACTION_SET.has(action as LifecycleAction);
}

export function validateMaxRows(
  action: 'backfill_embeddings' | 'rebuild_embeddings',
  rowsInScope: number,
  maxRows: number | undefined
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  if (maxRows === undefined) {
    if (action === 'rebuild_embeddings') {
      return invalidInput('max_rows is required for rebuild_embeddings', 'max_rows', {
        action,
        parameter: 'max_rows',
      });
    }
    return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
  }

  if (!Number.isInteger(maxRows)) {
    return invalidInput('max_rows must be an integer. Use max_rows: 0 for unlimited.', 'max_rows', {
      max_rows: maxRows,
    });
  }

  if (maxRows < 0) {
    return invalidInput('max_rows cannot be negative. Use max_rows: 0 for unlimited.', 'max_rows', {
      max_rows: maxRows,
    });
  }

  if (maxRows === 0) {
    return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
  }

  if (rowsInScope > maxRows) {
    return invalidInput(
      `max_rows exceeded: ${rowsInScope} rows are in scope but max_rows is ${maxRows}`,
      'max_rows',
      {
        rows_in_scope: rowsInScope,
        max_rows: maxRows,
      }
    );
  }

  return { ok: true, payload: { effective_max_rows: maxRows, unlimited: false } };
}

export function validateLifecycleActionParameters(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  switch (input.action) {
    case 'backfill_embeddings':
      return validateBackfillParameters(input);
    case 'rebuild_embeddings':
      return validateRebuildParameters(input);
    case 'retire_embedding':
      return validateRetireParameters(input);
    case 'abort':
      return validateAbortParameters(input);
  }
}

export function resolveRebuildConfirmFromResolvedWorkUnits(
  input: ResolvedRebuildConfirmInput
): LifecycleValidationResult<RebuildConfirmResolution> {
  const distinctNames = [...new Set(input.resolved_embedding_names.filter(isNonEmptyString))].sort();

  if (distinctNames.length > 1) {
    return invalidInput(
      'records scope resolves to multiple embedding names; narrow scope.plugin or scope.records.targets before rebuilding',
      'scope',
      { resolved_embedding_names: distinctNames }
    );
  }

  const expected = distinctNames[0] ?? null;
  if (expected !== null && input.confirm !== expected) {
    return invalidInput('confirm must match the resolved embedding_name for records rebuild', 'confirm', {
      expected_confirm: expected,
      received_confirm: input.confirm,
    });
  }

  return { ok: true, payload: { expected_confirm: expected } };
}

export function isPureRecordsScope(scope: LifecycleScope | undefined): boolean {
  return scope?.entity_types?.length === 1 && scope.entity_types[0] === 'records';
}

function validateBackfillParameters(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  const invalid = rejectUnsupportedParameters(input, [
    'confirm',
    'stale_only',
    'mismatched_width_only',
    'drop_stamping_columns',
    'job_id',
  ]);
  if (!invalid.ok) return invalid;

  if (input.scope === undefined) {
    return invalidInput('scope is required for backfill_embeddings', 'scope', {
      action: input.action,
      parameter: 'scope',
    });
  }

  const recordsScope = validateRecordsEmbeddingNameRule(input);
  if (!recordsScope.ok) return recordsScope;

  return validateMaxRows('backfill_embeddings', 0, input.max_rows);
}

function validateRebuildParameters(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  const invalid = rejectUnsupportedParameters(input, ['drop_stamping_columns', 'job_id']);
  if (!invalid.ok) return invalid;

  if (input.scope === undefined) {
    return invalidInput('scope is required for rebuild_embeddings', 'scope', {
      action: input.action,
      parameter: 'scope',
    });
  }

  const recordsScope = validateRecordsEmbeddingNameRule(input);
  if (!recordsScope.ok) return recordsScope;

  const maxRows = validateMaxRows('rebuild_embeddings', 0, input.max_rows);
  if (!maxRows.ok) return maxRows;

  if (!isPureRecordsScope(input.scope) && input.embedding_name !== undefined && input.confirm !== input.embedding_name) {
    return invalidInput('confirm must match embedding_name for rebuild_embeddings', 'confirm', {
      expected_confirm: input.embedding_name,
      received_confirm: input.confirm,
    });
  }

  if (!isPureRecordsScope(input.scope) && input.embedding_name !== undefined && input.confirm === undefined) {
    return invalidInput('confirm is required for rebuild_embeddings', 'confirm', {
      expected_confirm: input.embedding_name,
      received_confirm: input.confirm,
    });
  }

  return maxRows;
}

function validateRetireParameters(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  const invalid = rejectUnsupportedParameters(input, [
    'scope',
    'max_rows',
    'dry_run',
    'background',
    'stale_only',
    'mismatched_width_only',
    'job_id',
  ]);
  if (!invalid.ok) return invalid;

  if (input.embedding_name === undefined || input.embedding_name.length === 0) {
    return invalidInput('embedding_name is required for retire_embedding', 'embedding_name', {
      action: input.action,
      parameter: 'embedding_name',
    });
  }

  if (input.confirm !== input.embedding_name) {
    return invalidInput('confirm must match embedding_name for retire_embedding', 'confirm', {
      expected_confirm: input.embedding_name,
      received_confirm: input.confirm,
    });
  }

  return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
}

function validateAbortParameters(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  const invalid = rejectUnsupportedParameters(input, [
    'embedding_name',
    'scope',
    'max_rows',
    'confirm',
    'stale_only',
    'mismatched_width_only',
    'drop_stamping_columns',
    'dry_run',
    'background',
  ]);
  if (!invalid.ok) return invalid;

  if (input.job_id === undefined || input.job_id.length === 0) {
    return invalidInput('job_id is required for abort', 'job_id', {
      action: input.action,
      parameter: 'job_id',
    });
  }

  return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
}

function validateRecordsEmbeddingNameRule(
  input: LifecycleBaseInput
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  if (isPureRecordsScope(input.scope) && input.embedding_name !== undefined) {
    return invalidInput(RECORDS_EMBEDDING_CHOICE_MESSAGE, 'embedding_name', {
      action: input.action,
      parameter: 'embedding_name',
    });
  }

  return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
}

function rejectUnsupportedParameters(
  input: LifecycleBaseInput,
  parameters: Array<keyof LifecycleBaseInput>
): LifecycleValidationResult<MaxRowsValidationSuccess> {
  for (const parameter of parameters) {
    if (input[parameter] !== undefined) {
      const message =
        parameter === 'max_rows' && input.action === 'retire_embedding'
          ? 'max_rows is not supported for retire_embedding'
          : `${String(parameter)} is not supported for ${input.action}`;
      return invalidInput(message, String(parameter), {
        action: input.action,
        parameter,
      });
    }
  }

  return { ok: true, payload: { effective_max_rows: 0, unlimited: true } };
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalidInput(
  message: string,
  identifier: string,
  details: Record<string, unknown>
): LifecycleValidationResult<never> {
  return {
    ok: false,
    error: {
      error: 'invalid_input',
      message,
      identifier,
      details,
    },
  };
}
