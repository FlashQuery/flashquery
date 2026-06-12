import type { ErrorEnvelope } from '../../mcp/utils/response-formats.js';

export type LifecycleAction =
  | 'backfill_embeddings'
  | 'rebuild_embeddings'
  | 'retire_embedding'
  | 'abort';
export type LifecycleRunnableAction =
  | 'backfill_embeddings'
  | 'rebuild_embeddings'
  | 'retire_embedding';

type LifecycleEntityType = 'documents' | 'memory' | 'records';

interface LifecycleRecordsScope {
  plugin?: string | string[];
  targets?: string[];
}

export interface LifecycleScope {
  entity_types?: LifecycleEntityType[];
  project?: string;
  path_prefix?: string;
  records?: LifecycleRecordsScope;
}

export interface LifecycleBaseInput {
  action: LifecycleAction;
  embedding_name?: string;
  scope?: LifecycleScope;
  max_rows?: number;
  confirm?: string;
  stale_only?: boolean;
  mismatched_width_only?: boolean;
  drop_stamping_columns?: boolean;
  dry_run?: boolean;
  background?: boolean;
  job_id?: string;
}

export interface LifecycleFailure {
  entity_type: LifecycleEntityType;
  identifier: string;
  message: string;
  error?: string;
}

export interface LifecycleEstimate {
  input_tokens?: number;
  cost_usd?: number | null;
  wall_time_seconds?: number;
  cost_basis?: string;
}

export interface BackfillLifecycleCounts {
  rows_examined: number;
  rows_embedded: number;
  rows_failed: number;
  rows_skipped_already_present: number;
  rows_skipped_no_embedding?: number;
}

export interface RebuildLifecycleCounts {
  rows_examined: number;
  rows_embedded: number;
  rows_failed: number;
  rows_skipped_no_embedding?: number;
}

export interface RetireLifecycleCounts {
  tables_affected: number;
  columns_dropped: number;
  indexes_dropped: number;
  catalog_rows_deleted: number;
}

export interface MaxRowsValidationSuccess {
  effective_max_rows: number;
  unlimited: boolean;
}

export type LifecycleValidationResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: ErrorEnvelope };

export interface ResolvedRebuildConfirmInput {
  action: 'rebuild_embeddings';
  confirm?: string;
  scope?: LifecycleScope;
  resolved_embedding_names: Array<string | null | undefined>;
}

export interface RebuildConfirmResolution {
  expected_confirm: string | null;
}
