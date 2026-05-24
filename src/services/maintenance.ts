import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import type { ErrorEnvelope, MaintenanceActionResult } from '../mcp/utils/response-formats.js';
import { maintenanceActionResult } from '../mcp/utils/response-formats.js';
import { getIsShuttingDown } from '../server/shutdown-state.js';
import { invalidateReconciliationCache } from './plugin-reconciliation.js';
import {
  reconcileTrackedDocuments,
  runScanOnce,
  type DocumentReconciliationResult,
  type ScanResult,
} from './scanner.js';

export type MaintenanceAction = 'sync' | 'repair' | 'status';
export type MaintenanceRequestedAction = MaintenanceAction | Array<'sync' | 'repair'>;
export type MaintenanceJobStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface MaintainVaultInput {
  action: MaintenanceRequestedAction;
  dry_run?: boolean;
  background?: boolean;
  job_id?: string;
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

export function resetMaintenanceStateForTests(): void {
  maintenanceInProgress = false;
  jobs.clear();
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
    return getMaintenanceJobStatus(input.job_id ?? '');
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
    for (const item of unique) {
      if (item !== 'sync' && item !== 'repair') {
        return invalidInput('action must be sync, repair, status, or ["repair","sync"]', 'maintain_vault', {
          parameter: 'action',
        });
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
    const finishedAt = new Date().toISOString();
    results.push(maintenanceActionResult({
      action: 'sync',
      started_at: startedAt,
      finished_at: finishedAt,
      dry_run: false,
      counts: scanCounts(result),
      warnings: scanWarnings(result),
    }));
  }
  return results;
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

function scanCounts(result: ScanResult): MaintenanceActionResult['counts'] {
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

function repairCounts(result: DocumentReconciliationResult): MaintenanceActionResult['counts'] {
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
