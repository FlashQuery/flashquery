import type { PluginTableSpec } from '../../plugins/manager.js';
import {
  recordIdentification,
  type RecordIdentificationInput,
} from './response-formats.js';
import { GENERATED_RECORD_FIELDS } from './record-validation.js';

export type RecordInclude = 'data' | 'schema_metadata';
export type RecordResultScope = 'write' | 'get' | 'archive' | 'search';

export interface RecordRow {
  id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface RecordScope {
  plugin_id: string;
  table: string;
  tableSpec?: PluginTableSpec;
}

export interface RecordSchemaMetadata {
  required_fields: string[];
}

export type RecordResult = RecordIdentificationInput & {
  data?: Record<string, unknown>;
  schema_metadata?: RecordSchemaMetadata;
  reconciliation?: Record<string, unknown>;
  pending_review?: Record<string, unknown>;
};

export interface PendingReviewPublicRow {
  id: string;
  fqc_id?: string | null;
  plugin_id: string;
  table_name: string;
  review_type: string;
  context?: Record<string, unknown> | null;
}

export function parseRecordInclude(
  include: RecordInclude[] | undefined,
  scope: RecordResultScope
): RecordInclude[] {
  return include ?? (scope === 'get' ? ['data'] : []);
}

export function stripGeneratedRecordData(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!GENERATED_RECORD_FIELDS.has(key)) {
      data[key] = value;
    }
  }
  return data;
}

export function buildRecordSchemaMetadata(tableSpec: PluginTableSpec): RecordSchemaMetadata {
  return {
    required_fields: tableSpec.columns
      .filter((column) => column.required === true)
      .map((column) => column.name),
  };
}

export function addReconciliationPayload<T extends object>(
  payload: T,
  reconciliation: Record<string, unknown> | undefined
): T & { reconciliation?: Record<string, unknown> } {
  if (reconciliation === undefined || Object.keys(reconciliation).length === 0) {
    return payload;
  }
  return { ...payload, reconciliation };
}

export function addPendingReviewPayload<T extends object>(
  payload: T,
  pendingReview: Record<string, unknown> | undefined
): T & { pending_review?: Record<string, unknown> } {
  if (pendingReview === undefined || Object.keys(pendingReview).length === 0) {
    return payload;
  }
  return { ...payload, pending_review: pendingReview };
}

export function buildPendingReviewPayload(
  pendingItems: PendingReviewPublicRow[]
): Record<string, unknown> | undefined {
  if (pendingItems.length === 0) return undefined;
  return {
    count: pendingItems.length,
    items: pendingItems.map((item) => ({
      id: item.id,
      fqc_id: item.fqc_id ?? null,
      type: item.review_type,
      plugin_id: item.plugin_id,
      table: item.table_name,
      path: typeof item.context?.path === 'string' ? item.context.path : null,
      context: item.context ?? {},
    })),
  };
}

export function buildRecordResult(
  row: RecordRow,
  scope: RecordScope,
  include: RecordInclude[] = []
): RecordResult {
  const result: RecordResult = {
    ...recordIdentification({
      id: row.id,
      plugin_id: scope.plugin_id,
      table: scope.table,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  };

  if (include.includes('data')) {
    result.data = stripGeneratedRecordData(row);
  }

  if (include.includes('schema_metadata') && scope.tableSpec) {
    result.schema_metadata = buildRecordSchemaMetadata(scope.tableSpec);
  }

  return result;
}
