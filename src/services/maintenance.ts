import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  getLifecycleJobStatus,
  acquireLifecycleJob,
  requestLifecycleAbort,
} from '../embedding/lifecycle/jobs.js';
import type {
  LifecycleAction,
  LifecycleBaseInput,
  LifecycleScope,
} from '../embedding/lifecycle/types.js';
import {
  hasRecordsScope,
  isLifecycleAction,
  isPureRecordsScope,
  validateLifecycleActionParameters,
  validateMaxRows,
  withoutRecordsScope,
} from '../embedding/lifecycle/scope.js';
import { runBackfillEmbeddings } from '../embedding/lifecycle/backfill.js';
import { runRebuildEmbeddings } from '../embedding/lifecycle/rebuild.js';
import { runRetireEmbedding } from '../embedding/lifecycle/retire.js';
import {
  prepareCoreLifecycleJob,
  resolveCoreLifecycleWorkPlan,
} from '../embedding/lifecycle/core-processor.js';
import {
  resolveRecordLifecycleWorkUnits,
  resolveSingleRecordLifecycleEmbeddingName,
} from '../embedding/lifecycle/records-scope.js';
import { logger } from '../logging/logger.js';
import type {
  ErrorEnvelope,
  HostTemplateRefreshSummary,
  MaintenanceActionResult,
  MaintenanceLegacyActionResult,
} from '../mcp/utils/response-formats.js';
import { maintenanceActionResult } from '../mcp/utils/response-formats.js';
import { getIsShuttingDown } from '../server/shutdown-state.js';
import type { GraphLintListPayload, GraphLintPayload } from '../graph/lint-categories.js';
import { invalidateReconciliationCache } from './plugin-reconciliation.js';
import {
  reconcileTrackedDocuments,
  runScanOnce,
  type DocumentReconciliationResult,
  type ScanResult,
} from './scanner.js';

export type MaintenanceGraphWorkerAction = 'graph_worker';
export type MaintenanceGraphLintAction = 'graph_lint' | 'graph_lint_status' | 'graph_lint_prune';
export type MaintenanceAction = 'sync' | 'repair' | 'status' | MaintenanceGraphWorkerAction | MaintenanceGraphLintAction | LifecycleAction;
type MaintenanceExecutableAction = 'sync' | 'repair' | MaintenanceGraphWorkerAction | 'graph_lint';
export type MaintenanceRequestedAction = MaintenanceAction | MaintenanceAction[];
export type MaintenanceJobStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface MaintainVaultInput {
  action: MaintenanceRequestedAction;
  dry_run?: boolean;
  background?: boolean;
  job_id?: string;
  embedding_name?: string;
  scope?: LifecycleScope;
  rules?: string[];
  run_id?: string;
  limit?: number;
  keep_last?: number;
  older_than?: string;
  max_findings?: number;
  max_rows?: number;
  max_documents_in_response?: number;
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
  actions: LocalMaintenanceActionResult[];
  error?: ErrorEnvelope;
}

interface MaintenanceGraphWorkerActionResult {
  action: 'graph_worker';
  started_at: string;
  finished_at: string;
  dry_run: false;
  counts: {
    selected: number;
    processed: number;
    succeeded: number;
    failed: number;
    dead_letter: number;
    skipped: number;
  };
  warnings?: string[];
}

interface MaintenanceGraphLintActionResult {
  action: 'graph_lint';
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  payload: GraphLintPayload;
}

interface MaintenanceGraphLintPrunePayload {
  deleted: number;
  keep_last?: number;
  older_than?: string;
}

type LocalMaintenanceActionResult =
  | MaintenanceActionResult
  | MaintenanceGraphWorkerActionResult
  | MaintenanceGraphLintActionResult;

export type MaintenanceSyncPayload = { actions: LocalMaintenanceActionResult[] };

export type MaintenanceResult<
  T =
    | MaintenanceSyncPayload
    | MaintenanceAcceptedPayload
    | MaintenanceStatusPayload
    | GraphLintPayload
    | GraphLintListPayload
    | MaintenanceGraphLintPrunePayload,
> = { ok: true; payload: T } | { ok: false; error: ErrorEnvelope };

interface MaintenanceJobRecord extends MaintenanceStatusPayload {
  requestedActions: Array<'sync' | 'repair' | 'graph_lint'>;
  dryRun: boolean;
  graphLintInput?: MaintainVaultInput;
}

let maintenanceInProgress = false;
const jobs = new Map<string, MaintenanceJobRecord>();
let hostTemplateRefreshHook:
  | ((config: FlashQueryConfig) => Promise<HostTemplateRefreshSummary>)
  | undefined;
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
): Promise<
  MaintenanceResult<
    | MaintenanceSyncPayload
    | MaintenanceAcceptedPayload
    | MaintenanceStatusPayload
    | GraphLintPayload
    | GraphLintListPayload
    | MaintenanceGraphLintPrunePayload
  >
> {
  if (input.action === 'graph_lint_status') {
    const validation = validateGraphLintStatusParameters(input);
    if (!validation.ok) return validation;
    if (config.graph?.enabled !== true) return graphUnsupported('graph_lint_status');
    if (input.job_id) return getMaintenanceJobStatus(input.job_id);
    return await dispatchGraphLintStatus(config, input);
  }

  if (input.action === 'graph_lint_prune') {
    const validation = validateGraphLintPruneParameters(input);
    if (!validation.ok) return validation;
    if (config.graph?.enabled !== true) return graphUnsupported('graph_lint_prune');
    return await dispatchGraphLintPrune(config, input);
  }

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

  if (normalized.payload.includes('graph_lint') && config.graph?.enabled !== true) {
    return graphUnsupported('graph_lint');
  }

  if (getIsShuttingDown()) {
    return shutdownRejection();
  }

  if (maintenanceInProgress) {
    return maintenanceConflict();
  }

  if (input.background) {
    const job = createJob(normalized.payload as Array<'sync' | 'repair' | 'graph_lint'>, false, input);
    void runBackgroundJob(config, job.job_id);
    return {
      ok: true,
      payload: { accepted: true, job_id: job.job_id, started_at: job.started_at },
    };
  }

  maintenanceInProgress = true;
  try {
    const actions = await executeActions(config, normalized.payload, input);
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

export function getMaintenanceJobStatus(
  jobId: string
): MaintenanceResult<MaintenanceStatusPayload> {
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
): MaintenanceResult<MaintenanceExecutableAction[]> {
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
  if (action === 'graph_worker') {
    return { ok: true, payload: [action] };
  }
  if (action === 'graph_lint') {
    return { ok: true, payload: [action] };
  }

  return invalidInput(
    'action must be sync, repair, graph_worker, graph_lint, graph_lint_status, graph_lint_prune, status, or ["repair","sync"]',
    'maintain_vault',
    {
      parameter: 'action',
    }
  );
}

async function validateLifecycleDispatch(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<
  MaintenanceResult<MaintenanceSyncPayload | MaintenanceAcceptedPayload | MaintenanceStatusPayload>
> {
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
    return await dispatchBackfillEmbeddings(
      config,
      input as LifecycleBaseInput & { action: 'backfill_embeddings' }
    );
  }

  if (input.action === 'rebuild_embeddings') {
    return await dispatchRebuildEmbeddings(
      config,
      input as LifecycleBaseInput & { action: 'rebuild_embeddings' }
    );
  }

  return await dispatchRetireEmbedding(
    config,
    input as LifecycleBaseInput & { action: 'retire_embedding' }
  );
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
  const acquired = isPureRecordsScope(input.scope)
    ? await prepareRecordsLifecycleJob(config, input)
    : hasRecordsScope(input.scope)
      ? await prepareMixedLifecycleJob(config, input)
      : await prepareCoreLifecycleJob({ config, input, mode: input.action });
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

async function prepareMixedLifecycleJob(
  config: FlashQueryConfig,
  input:
    | (LifecycleBaseInput & { action: 'backfill_embeddings' })
    | (LifecycleBaseInput & { action: 'rebuild_embeddings' })
): Promise<Awaited<ReturnType<typeof prepareCoreLifecycleJob>>> {
  const coreInput = { ...input, scope: withoutRecordsScope(input.scope) };
  const corePlan = await resolveCoreLifecycleWorkPlan(config, coreInput, input.action);
  if (!corePlan.ok) return corePlan;

  const resolved = await resolveRecordLifecycleWorkUnits(config, input, input.action);
  if (!resolved.ok) return resolved;

  const cap = validateMaxRows(
    input.action,
    corePlan.payload.rows.length + resolved.payload.rows_in_scope,
    input.max_rows
  );
  if (!cap.ok) return { ok: false, error: cap.error };

  return await prepareCoreLifecycleJob({ config, input: coreInput, mode: input.action });
}

async function prepareRecordsLifecycleJob(
  config: FlashQueryConfig,
  input:
    | (LifecycleBaseInput & { action: 'backfill_embeddings' })
    | (LifecycleBaseInput & { action: 'rebuild_embeddings' })
): Promise<Awaited<ReturnType<typeof acquireLifecycleJob>>> {
  const resolved = await resolveRecordLifecycleWorkUnits(config, input, input.action);
  if (!resolved.ok) return resolved;
  const jobName = resolveSingleRecordLifecycleEmbeddingName(resolved.payload, input.action);
  if (!jobName.ok) return jobName;
  if (jobName.payload === null) {
    return {
      ok: false,
      error: {
        error: 'invalid_input',
        message:
          'background records lifecycle actions require at least one registered plugin with an embedding entry',
        identifier: 'scope',
        details: { reason: 'no_record_embedding_entries' },
      },
    };
  }

  return await acquireLifecycleJob(config, {
    action: input.action,
    embedding_name: jobName.payload,
    counts:
      input.action === 'backfill_embeddings'
        ? {
            rows_examined: resolved.payload.rows_in_scope,
            rows_embedded: 0,
            rows_failed: 0,
            rows_skipped_already_present: 0,
            rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
          }
        : {
            rows_examined: resolved.payload.rows_in_scope,
            rows_embedded: 0,
            rows_failed: 0,
            rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
          },
    metadata: { dry_run: false, background: true, scope: 'records' },
  });
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

async function dispatchRetireEmbedding(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'retire_embedding' }
): Promise<MaintenanceResult<MaintenanceSyncPayload>> {
  const result = await runRetireEmbedding(config, input);
  if (!result.ok) return result;
  return { ok: true, payload: { actions: [result.payload] } };
}

function validateModeOptions(
  actions: MaintenanceExecutableAction[],
  input: MaintainVaultInput
): MaintenanceResult<null> {
  const identifier = actions.join(',');
  if (actions[0] === 'graph_lint') {
    return validateGraphLintParameters(input);
  }

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
  actions: MaintenanceExecutableAction[],
  input: MaintainVaultInput
): Promise<LocalMaintenanceActionResult[]> {
  const results: LocalMaintenanceActionResult[] = [];
  const dryRun = input.dry_run === true;
  for (const action of actions) {
    if (getIsShuttingDown()) {
      throw new Error('maintenance aborted during shutdown');
    }

    const startedAt = new Date().toISOString();
    if (action === 'graph_lint') {
      const result = await runGraphLintAction(config, input);
      const finishedAt = new Date().toISOString();
      results.push({
        action: 'graph_lint',
        started_at: startedAt,
        finished_at: finishedAt,
        dry_run: dryRun,
        payload: result,
      });
      continue;
    }

    if (action === 'graph_worker') {
      const result = await runGraphWorkerOnce(config);
      const finishedAt = new Date().toISOString();
      results.push({
        action: 'graph_worker',
        started_at: startedAt,
        finished_at: finishedAt,
        dry_run: false,
        counts: {
          selected: result.selected,
          processed: result.processed,
          succeeded: result.succeeded,
          failed: result.failed,
          dead_letter: result.dead_letter,
          skipped: result.skipped,
        },
        ...(result.warnings.length === 0 ? {} : { warnings: result.warnings }),
      });
      continue;
    }

    if (action === 'repair') {
      const result = await reconcileTrackedDocuments(config, { dryRun });
      const finishedAt = new Date().toISOString();
      results.push(
        maintenanceActionResult({
          action: 'repair',
          started_at: startedAt,
          finished_at: finishedAt,
          dry_run: dryRun,
          counts: repairCounts(result),
        })
      );
      continue;
    }

    const result = await runScanOnce(config);
    invalidateReconciliationCache();
    const hostTemplateRefresh = await refreshHostTemplatesAfterSync(config);
    const finishedAt = new Date().toISOString();
    results.push(
      maintenanceActionResult({
        action: 'sync',
        started_at: startedAt,
        finished_at: finishedAt,
        dry_run: false,
        counts: scanCounts(result),
        warnings: scanWarnings(result),
        ...(hostTemplateRefresh === undefined
          ? {}
          : { host_template_refresh: hostTemplateRefresh }),
      })
    );
  }
  return results;
}

async function runGraphWorkerOnce(config: FlashQueryConfig): Promise<{
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
  dead_letter: number;
  skipped: number;
  warnings: string[];
}> {
  const { supabaseManager } = await import('../storage/supabase.js');
  const { processPendingGraphEdgesForConfig } = await import('../graph/pending-worker.js');
  return await processPendingGraphEdgesForConfig({
    config,
    supabase: supabaseManager.getClient(),
    logger,
    limit: config.graph?.maxClassificationJobsPerSave ?? 25,
  });
}

async function refreshHostTemplatesAfterSync(
  config: FlashQueryConfig
): Promise<HostTemplateRefreshSummary | undefined> {
  if (hostTemplateRefreshHook === undefined) return undefined;
  return await hostTemplateRefreshHook(config);
}

function createJob(
  actions: Array<'sync' | 'repair' | 'graph_lint'>,
  dryRun: boolean,
  graphLintInput?: MaintainVaultInput
): MaintenanceJobRecord {
  const job: MaintenanceJobRecord = {
    job_id: randomUUID(),
    status: 'running',
    started_at: new Date().toISOString(),
    actions: [],
    requestedActions: actions,
    dryRun,
    ...(graphLintInput === undefined ? {} : { graphLintInput }),
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
    if (job.requestedActions.length === 1 && job.requestedActions[0] === 'graph_lint') {
      const input = job.graphLintInput ?? { action: 'graph_lint' };
      const startedAt = new Date().toISOString();
      const payload = await runGraphLintAction(config, input);
      job.actions = [{
        action: 'graph_lint',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        dry_run: input.dry_run === true,
        payload,
      }];
    } else {
      job.actions = await executeActions(config, job.requestedActions, { action: job.requestedActions, dry_run: job.dryRun });
    }
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
  if (result.graphWorker) {
    warnings.push(...result.graphWorker.warnings);
    if (result.graphWorker.failed > 0) {
      warnings.push('graph_worker_failed');
    }
    if (result.graphWorker.dead_letter > 0) {
      warnings.push('graph_worker_dead_letter');
    }
  }
  if (getIsShuttingDown()) {
    warnings.push('maintenance_aborted');
  }
  return warnings.length > 0 ? warnings : undefined;
}

async function runGraphLintAction(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<GraphLintPayload> {
  if (!config.supabase.databaseUrl) {
    throw new Error('graph_lint requires config.supabase.databaseUrl for run-history storage');
  }
  const { runGraphLint } = await import('../graph/lint.js');
  const { llmClient } = await import('../llm/client.js');
  const { createEmbeddingProviderForCatalogEntry } = await import('../embedding/provider.js');
  const embeddingEntry = config.embeddings?.find((entry) => entry.name === config.graph?.embeddingName);
  return await runGraphLint({
    databaseUrl: config.supabase.databaseUrl,
    instanceId: config.instance.id,
    graphConfig: config.graph,
    llmClient,
    ...(embeddingEntry
      ? { resolutionEmbeddingProvider: createEmbeddingProviderForCatalogEntry(config, embeddingEntry) }
      : {}),
    rules: input.rules,
    scope: input.scope,
    dryRun: input.dry_run === true,
    maxFindings: input.max_findings,
    promptVersion: config.graph?.resolvedPrompts?.find((prompt) => prompt.id === 'analyze_node')?.version,
  });
}

async function dispatchGraphLintStatus(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<MaintenanceResult<GraphLintPayload | GraphLintListPayload>> {
  if (!config.supabase.databaseUrl) {
    return invalidInput('graph_lint_status requires config.supabase.databaseUrl', 'graph_lint_status', {
      parameter: 'databaseUrl',
    });
  }
  try {
    const { getGraphLintStatus } = await import('../graph/lint.js');
    return {
      ok: true,
      payload: await getGraphLintStatus({
        databaseUrl: config.supabase.databaseUrl,
        instanceId: config.instance.id,
        runId: input.run_id,
        limit: input.limit,
        maxFindings: input.max_findings,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        error: 'not_found',
        message: err instanceof Error ? err.message : String(err),
        identifier: input.run_id ?? 'latest',
      },
    };
  }
}

async function dispatchGraphLintPrune(
  config: FlashQueryConfig,
  input: MaintainVaultInput
): Promise<MaintenanceResult<MaintenanceGraphLintPrunePayload>> {
  if (!config.supabase.databaseUrl) {
    return invalidInput('graph_lint_prune requires config.supabase.databaseUrl', 'graph_lint_prune', {
      parameter: 'databaseUrl',
    });
  }
  try {
    const { pruneGraphLintRuns } = await import('../graph/lint.js');
    return {
      ok: true,
      payload: await pruneGraphLintRuns({
        databaseUrl: config.supabase.databaseUrl,
        instanceId: config.instance.id,
        keepLast: input.keep_last,
        olderThan: input.older_than,
      }),
    };
  } catch (err) {
    return invalidInput(err instanceof Error ? err.message : String(err), 'graph_lint_prune', {
      parameter: 'keep_last,older_than',
    });
  }
}

function validateGraphLintParameters(input: MaintainVaultInput): MaintenanceResult<null> {
  const invalid = disallowedParameters(input, [
    'job_id',
    'run_id',
    'limit',
    'keep_last',
    'older_than',
    'max_rows',
    'embedding_name',
    'confirm',
    'stale_only',
    'mismatched_width_only',
    'drop_stamping_columns',
  ]);
  if (invalid) return invalidInput(`${invalid} is not supported for action: graph_lint`, 'graph_lint', { parameter: invalid });
  if (input.rules !== undefined && (!Array.isArray(input.rules) || input.rules.some((rule) => typeof rule !== 'string'))) {
    return invalidInput('rules must be an array of rule IDs', 'graph_lint', { parameter: 'rules' });
  }
  if (input.max_findings !== undefined && !isNonNegativeInteger(input.max_findings)) {
    return invalidInput('max_findings must be a non-negative integer', 'graph_lint', { parameter: 'max_findings' });
  }
  return { ok: true, payload: null };
}

function validateGraphLintStatusParameters(input: MaintainVaultInput): MaintenanceResult<null> {
  const invalid = disallowedParameters(input, [
    'rules',
    'scope',
    'dry_run',
    'background',
    'keep_last',
    'older_than',
    'max_rows',
    'embedding_name',
    'confirm',
    'stale_only',
    'mismatched_width_only',
    'drop_stamping_columns',
  ]);
  if (invalid) return invalidInput(`${invalid} is not supported for action: graph_lint_status`, 'graph_lint_status', { parameter: invalid });
  if (input.run_id !== undefined && input.limit !== undefined) {
    return invalidInput('run_id and limit are mutually exclusive for action: graph_lint_status', 'graph_lint_status', {
      parameter: 'run_id,limit',
    });
  }
  if (input.limit !== undefined && !isPositiveInteger(input.limit)) {
    return invalidInput('limit must be a positive integer', 'graph_lint_status', { parameter: 'limit' });
  }
  if (input.max_findings !== undefined && !isNonNegativeInteger(input.max_findings)) {
    return invalidInput('max_findings must be a non-negative integer', 'graph_lint_status', { parameter: 'max_findings' });
  }
  return { ok: true, payload: null };
}

function validateGraphLintPruneParameters(input: MaintainVaultInput): MaintenanceResult<null> {
  const invalid = disallowedParameters(input, [
    'rules',
    'scope',
    'dry_run',
    'background',
    'job_id',
    'run_id',
    'limit',
    'max_findings',
    'max_rows',
    'embedding_name',
    'confirm',
    'stale_only',
    'mismatched_width_only',
    'drop_stamping_columns',
  ]);
  if (invalid) return invalidInput(`${invalid} is not supported for action: graph_lint_prune`, 'graph_lint_prune', { parameter: invalid });
  if (input.keep_last === undefined && input.older_than === undefined) {
    return invalidInput('graph_lint_prune requires keep_last or older_than', 'graph_lint_prune', {
      parameter: 'keep_last,older_than',
    });
  }
  if (input.keep_last !== undefined && !isNonNegativeInteger(input.keep_last)) {
    return invalidInput('keep_last must be a non-negative integer', 'graph_lint_prune', { parameter: 'keep_last' });
  }
  if (input.older_than !== undefined && Number.isNaN(Date.parse(input.older_than))) {
    return invalidInput('older_than must be an ISO-8601 timestamp', 'graph_lint_prune', { parameter: 'older_than' });
  }
  return { ok: true, payload: null };
}

function disallowedParameters(input: MaintainVaultInput, params: Array<keyof MaintainVaultInput>): string | null {
  for (const param of params) {
    if (input[param] !== undefined) return param;
  }
  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0;
}

function repairCounts(
  result: DocumentReconciliationResult
): MaintenanceLegacyActionResult['counts'] {
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

function graphUnsupported(action: MaintenanceGraphLintAction): MaintenanceResult<never> {
  return {
    ok: false,
    error: {
      error: 'unsupported',
      message: 'Graph intelligence is disabled. Set graph.enabled: true to use graph maintenance actions.',
      identifier: action,
      details: { code: 'graph_disabled', action },
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
