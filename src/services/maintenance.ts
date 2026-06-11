import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  acquireLifecycleJob,
  getLifecycleJobStatus,
  requestLifecycleAbort,
} from '../embedding/lifecycle/jobs.js';
import type { LifecycleAction, LifecycleBaseInput, LifecycleScope } from '../embedding/lifecycle/types.js';
import { isLifecycleAction, validateLifecycleActionParameters } from '../embedding/lifecycle/scope.js';
import { runBackfillEmbeddings } from '../embedding/lifecycle/backfill.js';
import { runRebuildEmbeddings } from '../embedding/lifecycle/rebuild.js';
import { logger } from '../logging/logger.js';
import type {
  ErrorEnvelope,
  HostTemplateRefreshSummary,
  MaintenanceActionResult,
  MaintenanceLegacyActionResult,
} from '../mcp/utils/response-formats.js';
import { maintenanceActionResult } from '../mcp/utils/response-formats.js';
import { getIsShuttingDown } from '../server/shutdown-state.js';
import { invalidateReconciliationCache } from './plugin-reconciliation.js';
import {
  reconcileTrackedDocuments,
  runScanOnce,
  type DocumentReconciliationResult,
  type ScanResult,
} from './scanner.js';

export type MaintenanceAction = 'sync' | 'repair' | 'status' | LifecycleAction;
export type MaintenanceRequestedAction = MaintenanceAction | MaintenanceAction[];
export type MaintenanceJobStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface MaintainVaultInput {
  action: MaintenanceRequestedAction;
  dry_run?: boolean;
  background?: boolean;
  job_id?: string;
  embedding_name?: string;
  scope?: LifecycleScope;
  max_rows?: number;
  confirm?: string;
  stale_only?: boolean;
  mismatched_width_only?: boolean;
  drop_stamping_columns?: boolean;
}

export interface MaintenanceAcceptedPayload {
  accepted: true;
  job_id: string;
  started_at: string;
}

export interface MaintenanceStatusPayload {
  job_id: string;
  status: MaintenanceJobStatus;
  started_at: string;
  finished_at?: string;
  actions: MaintenanceActionResult[];
  error?: ErrorEnvelope;
}

export type MaintenanceSyncPayload = { actions: MaintenanceActionResult[] };

export type MaintenanceResult<T = MaintenanceSyncPayload | MaintenanceAcceptedPayload | MaintenanceStatusPayload> =
  | { ok: true; payload: T }
  | { ok: false; error: ErrorEnvelope };

interface MaintenanceJobRecord extends MaintenanceStatusPayload {
  requestedActions: Array<'sync' | 'repair'>;
  dryRun: boolean;
}

let maintenanceInProgress = false;
const jobs = new Map<string, MaintenanceJobRecord>();
let hostTemplateRefreshHook: ((config: FlashQueryConfig) => Promise<HostTemplateRefreshSummary>) | undefined;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function setHostTemplateRefreshHook(
  hook: ((config: FlashQueryConfig) => Promise<HostTemplateRefreshSummary>) | undefined
): void {
  hostTemplateRefreshHook = hook;
}

export function resetMaintenanceStateForTests(): void {
  maintenanceInProgress = false;
  jobs.clear();
  hostTemplateRefreshHook = undefined;
}

export async function maintainVault(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<MaintenanceResult<MaintenanceSyncPayload | MaintenanceAcceptedPayload | MaintenanceStatusPayload>> {
  if (input.action === 'status') {
    if (input.dry_run === true) {
      return invalidInput('dry_run is not supported for action: status', 'status', {
        parameter: 'dry_run',
      });
    }
    if (input.background === true) {
      return invalidInput('background is not supported for action: status', 'status', {
        parameter: 'background',
      });
    }
    return await getMaintenanceJobStatusForInput(config, input.job_id ?? '');
  }

  if (isLifecycleAction(input.action)) {
    return await validateLifecycleDispatch(config, input);
  }

  const normalized = normalizeMaintenanceActions(input.action);
  if (!normalized.ok) {
    return normalized;
  }

  const validation = validateModeOptions(normalized.payload, input);
  if (!validation.ok) {
    return validation;
  }

  if (getIsShuttingDown()) {
    return shutdownRejection();
  }

  if (maintenanceInProgress) {
    return maintenanceConflict();
  }

  if (input.background) {
    const job = createJob(normalized.payload, false);
    void runBackgroundJob(config, job.job_id);
    return {
      ok: true,
      payload: { accepted: true, job_id: job.job_id, started_at: job.started_at },
    };
  }

  maintenanceInProgress = true;
  try {
    const actions = await executeActions(config, normalized.payload, input.dry_run === true);
    return { ok: true, payload: { actions } };
  } catch (err: unknown) {
    logger.warn(`maintain_vault failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      error: {
        error: 'runtime_error',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    maintenanceInProgress = false;
  }
}

export function getMaintenanceJobStatus(jobId: string): MaintenanceResult<MaintenanceStatusPayload> {
  const job = jobs.get(jobId);
  if (!job) {
    return {
      ok: false,
      error: {
        error: 'not_found',
        message: `No maintenance job found for job_id '${jobId}'`,
        identifier: jobId,
      },
    };
  }

  return {
    ok: true,
    payload: {
      job_id: job.job_id,
      status: job.status,
      started_at: job.started_at,
      ...(job.finished_at === undefined ? {} : { finished_at: job.finished_at }),
      actions: job.actions,
      ...(job.error === undefined ? {} : { error: job.error }),
    },
  };
}

async function getMaintenanceJobStatusForInput(
  config: FlashQueryConfig,
  jobId: string
): Promise<MaintenanceResult<MaintenanceStatusPayload>> {
  if (
    UUID_PATTERN.test(jobId) &&
    config.supabase.databaseUrl !== undefined &&
    config.supabase.databaseUrl.length > 0
  ) {
    const lifecycleStatus = await getLifecycleJobStatus(config, jobId);
    if (lifecycleStatus.ok) return lifecycleStatus;
    if (lifecycleStatus.error.error !== 'not_found') return lifecycleStatus;
  }

  return getMaintenanceJobStatus(jobId);
}

function normalizeMaintenanceActions(
  action: MaintenanceRequestedAction
): MaintenanceResult<Array<'sync' | 'repair'>> {
  if (Array.isArray(action)) {
    const unique = new Set(action);
    if (unique.size !== action.length || unique.size === 0) {
      return invalidInput('action array must contain sync and/or repair once', 'maintain_vault', {
        parameter: 'action',
      });
    }
    if ([...unique].some((item) => isLifecycleAction(item))) {
      return invalidInput(
        'Lifecycle actions cannot be combined in action arrays; use one of backfill_embeddings, rebuild_embeddings, retire_embedding, or abort as a single action',
        'maintain_vault',
        {
          parameter: 'action',
          action,
        }
      );
    }

    for (const item of unique) {
      if (item !== 'sync' && item !== 'repair') {
        return invalidInput(
          'action must be sync, repair, status, backfill_embeddings, rebuild_embeddings, retire_embedding, abort, or ["repair","sync"]',
          'maintain_vault',
          {
            parameter: 'action',
          }
        );
      }
    }
    const ordered: Array<'sync' | 'repair'> = [];
    if (unique.has('repair')) ordered.push('repair');
    if (unique.has('sync')) ordered.push('sync');
    return { ok: true, payload: ordered };
  }

  if (action === 'sync' || action === 'repair') {
    return { ok: true, payload: [action] };
  }

  return invalidInput('action must be sync, repair, status, or ["repair","sync"]', 'maintain_vault', {
    parameter: 'action',
  });
}

async function validateLifecycleDispatch(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<MaintenanceResult<MaintenanceSyncPayload | MaintenanceAcceptedPayload | MaintenanceStatusPayload>> {
  const validation = validateLifecycleActionParameters(input as LifecycleBaseInput);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  if (input.action === 'abort') {
    return await requestLifecycleAbort(config, input.job_id ?? '');
  }

  if (getIsShuttingDown()) {
    return shutdownRejection();
  }

  if (input.action === 'backfill_embeddings') {
    return await dispatchBackfillEmbeddings(config, input as LifecycleBaseInput & { action: 'backfill_embeddings' });
  }

  if (input.action === 'rebuild_embeddings') {
    return await dispatchRebuildEmbeddings(config, input as LifecycleBaseInput & { action: 'rebuild_embeddings' });
  }

  return {
    ok: false,
    error: {
      error: 'unsupported',
      message: `${input.action} validation is available, but execution is not implemented until the lifecycle processor plans`,
      identifier: String(input.action),
      details: {
        action: input.action,
        reason: 'lifecycle_processor_not_implemented',
      },
    },
  };
}

async function dispatchBackfillEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'backfill_embeddings' }
): Promise<MaintenanceResult<MaintenanceSyncPayload | MaintenanceAcceptedPayload>> {
  if (input.background === true) {
    return await dispatchBackgroundLifecycle(config, input);
  }
  const result = await runBackfillEmbeddings(config, input);
  if (!result.ok) return result;
  return { ok: true, payload: { actions: [result.payload] } };
}

async function dispatchBackgroundLifecycle(
  config: FlashQueryConfig,
  input:
    | (LifecycleBaseInput & { action: 'backfill_embeddings' })
    | (LifecycleBaseInput & { action: 'rebuild_embeddings' })
): Promise<MaintenanceResult<MaintenanceAcceptedPayload>> {
  if (!input.embedding_name) {
    return invalidInput('embedding_name is required for background lifecycle actions', 'embedding_name', {
      action: input.action,
    });
  }
  const acquired = await acquireLifecycleJob(config, {
    action: input.action,
    embedding_name: input.embedding_name,
    metadata: { dry_run: false, background: true },
  });
  if (!acquired.ok) return acquired;

  if (input.action === 'backfill_embeddings') {
    void runBackfillEmbeddings(config, input, acquired.payload);
  } else {
    void runRebuildEmbeddings(config, input, acquired.payload);
  }

  return {
    ok: true,
    payload: {
      accepted: true,
      job_id: acquired.payload.job_id,
      started_at: acquired.payload.started_at,
    },
  };
}

async function dispatchRebuildEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'rebuild_embeddings' }
): Promise<MaintenanceResult<MaintenanceSyncPayload | MaintenanceAcceptedPayload>> {
  if (input.background === true) {
    return await dispatchBackgroundLifecycle(config, input);
  }
  const result = await runRebuildEmbeddings(config, input);
  if (!result.ok) return result;
  return { ok: true, payload: { actions: [result.payload] } };
}

function validateModeOptions(actions: Array<'sync' | 'repair'>, input: MaintainVaultInput): MaintenanceResult<null> {
  const identifier = actions.join(',');
  if (input.dry_run === true && (actions.length !== 1 || actions[0] !== 'repair')) {
    return invalidInput('dry_run is only supported for action: repair', identifier, {
      parameter: 'dry_run',
    });
  }

  if (input.background === true && (actions.length !== 1 || actions[0] !== 'sync')) {
    return invalidInput('background is only supported for action: sync', identifier, {
      parameter: 'background',
    });
  }

  return { ok: true, payload: null };
}

async function executeActions(
  config: FlashQueryConfig,
  actions: Array<'sync' | 'repair'>,
  dryRun: boolean
): Promise<MaintenanceActionResult[]> {
  const results: MaintenanceActionResult[] = [];
  for (const action of actions) {
    if (getIsShuttingDown()) {
      throw new Error('maintenance aborted during shutdown');
    }

    const startedAt = new Date().toISOString();
    if (action === 'repair') {
      const result = await reconcileTrackedDocuments(config, { dryRun });
      const finishedAt = new Date().toISOString();
      results.push(maintenanceActionResult({
        action: 'repair',
        started_at: startedAt,
        finished_at: finishedAt,
        dry_run: dryRun,
        counts: repairCounts(result),
      }));
      continue;
    }

    const result = await runScanOnce(config);
    invalidateReconciliationCache();
    const hostTemplateRefresh = await refreshHostTemplatesAfterSync(config);
    const finishedAt = new Date().toISOString();
    results.push(maintenanceActionResult({
      action: 'sync',
      started_at: startedAt,
      finished_at: finishedAt,
      dry_run: false,
      counts: scanCounts(result),
      warnings: scanWarnings(result),
      ...(hostTemplateRefresh === undefined ? {} : { host_template_refresh: hostTemplateRefresh }),
    }));
  }
  return results;
}

async function refreshHostTemplatesAfterSync(
  config: FlashQueryConfig
): Promise<HostTemplateRefreshSummary | undefined> {
  if (hostTemplateRefreshHook === undefined) return undefined;
  return await hostTemplateRefreshHook(config);
}

function createJob(actions: Array<'sync' | 'repair'>, dryRun: boolean): MaintenanceJobRecord {
  const job: MaintenanceJobRecord = {
    job_id: randomUUID(),
    status: 'running',
    started_at: new Date().toISOString(),
    actions: [],
    requestedActions: actions,
    dryRun,
  };
  jobs.set(job.job_id, job);
  return job;
}

async function runBackgroundJob(config: FlashQueryConfig, jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  if (maintenanceInProgress) {
    job.status = 'failed';
    job.finished_at = new Date().toISOString();
    job.error = {
      error: 'conflict',
      message: 'A vault maintenance operation is already running',
      identifier: 'maintain_vault',
      details: { reason: 'maintenance_in_progress' },
    };
    return;
  }

  maintenanceInProgress = true;
  try {
    job.actions = await executeActions(config, job.requestedActions, job.dryRun);
    job.status = getIsShuttingDown() ? 'aborted' : 'completed';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = getIsShuttingDown() ? 'aborted' : 'failed';
    job.error = {
      error: 'runtime_error',
      message,
      details: getIsShuttingDown() ? { reason: 'shutdown' } : undefined,
    };
    logger.warn(`maintain_vault background job failed: ${message}`);
  } finally {
    job.finished_at = new Date().toISOString();
    maintenanceInProgress = false;
  }
}

function scanCounts(result: ScanResult): MaintenanceLegacyActionResult['counts'] {
  return {
    scanned:
      result.hashMismatches +
      result.statusMismatches +
      result.newFiles +
      result.movedFiles +
      result.deletedFiles,
    added: result.newFiles,
    updated: result.hashMismatches + result.movedFiles,
    repaired: 0,
    archived: result.deletedFiles,
  };
}

function scanWarnings(result: ScanResult): MaintenanceActionResult['warnings'] {
  const warnings: NonNullable<MaintenanceActionResult['warnings']> = [];
  if (result.embeddingStatus === 'drain_query_failed') {
    warnings.push('embedding_drain_query_failed');
  }
  if (getIsShuttingDown()) {
    warnings.push('maintenance_aborted');
  }
  return warnings.length > 0 ? warnings : undefined;
}

function repairCounts(result: DocumentReconciliationResult): MaintenanceLegacyActionResult['counts'] {
  return {
    scanned: result.scanned,
    added: 0,
    updated: result.updated,
    repaired: result.updated,
    archived: result.archived,
  };
}

function maintenanceConflict(): MaintenanceResult<never> {
  return {
    ok: false,
    error: {
      error: 'conflict',
      message: 'A vault maintenance operation is already running',
      identifier: 'maintain_vault',
      details: { reason: 'maintenance_in_progress' },
    },
  };
}

function invalidInput(
  message: string,
  identifier: string,
  details: Record<string, unknown>
): MaintenanceResult<never> {
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

function shutdownRejection(): MaintenanceResult<never> {
  return {
    ok: false,
    error: {
      error: 'runtime_error',
      message: 'Server is shutting down; new requests cannot be processed',
      details: { reason: 'shutdown' },
    },
  };
}
