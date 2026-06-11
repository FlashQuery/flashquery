import type { ErrorEnvelope } from '../../mcp/utils/response-formats.js';

export const LIFECYCLE_ACTIONS = [
  'backfill_embeddings',
  'rebuild_embeddings',
  'retire_embedding',
  'abort',
] as const;

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];
export type LifecycleEmbeddingAction = Exclude<LifecycleAction, 'abort'>;
export type LifecycleRunnableAction = 'backfill_embeddings' | 'rebuild_embeddings' | 'retire_embedding';

export type LifecycleEntityType = 'documents' | 'memory' | 'records';

export interface LifecycleRecordsScope {
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

export interface LifecycleCountResult {
  rows_in_scope: number;
  max_rows: number;
}

export interface LifecycleFailure {
  entity_type: LifecycleEntityType;
  identifier: string;
  message: string;
}

export interface LifecycleEstimate {
  input_tokens?: number;
  cost_usd?: number;
  wall_time_seconds?: number;
}

export interface LifecycleJobRef {
  job_id: string;
  action: LifecycleAction;
  embedding_name?: string;
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

export type LifecycleCounts = BackfillLifecycleCounts | RebuildLifecycleCounts | RetireLifecycleCounts;

export interface LifecycleActionResultBase {
  action: LifecycleAction;
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  embedding_name?: string;
  counts: LifecycleCounts;
  failures?: LifecycleFailure[];
  would_process?: number;
  estimated?: LifecycleEstimate;
  error?: ErrorEnvelope;
}

export interface MaxRowsValidationSuccess {
  effective_max_rows: number;
  unlimited: boolean;
}

export type LifecycleValidationResult<T> = { ok: true; payload: T } | { ok: false; error: ErrorEnvelope };

export interface ResolvedRebuildConfirmInput {
  action: 'rebuild_embeddings';
  confirm?: string;
  scope?: LifecycleScope;
  resolved_embedding_names: Array<string | null | undefined>;
}

export interface RebuildConfirmResolution {
  expected_confirm: string | null;
}
