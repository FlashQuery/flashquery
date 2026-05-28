import { z } from 'zod';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pluginManager, resolveTableName } from '../../plugins/manager.js';
import type { PluginTableSpec, RegistryEntry } from '../../plugins/manager.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import {
  recordEmbeddingTarget,
  scheduleBackgroundEmbedding,
  type EmbeddingWarning,
} from '../../embedding/background-embed.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { withPluginCoordinationLock } from '../../services/plugin-coordination-lock.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { queryPgPool } from '../../utils/pg-client.js';
import {
  reconcilePluginDocuments,
  executeReconciliationActions,
  markPluginReconciled,
} from '../../services/plugin-reconciliation.js';
import type { ReconciliationActionSummary } from '../../services/plugin-reconciliation.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  withWarnings,
} from '../utils/response-formats.js';
import { validateWriteRecordInput } from '../utils/record-validation.js';
import {
  addPendingReviewPayload,
  addReconciliationPayload,
  buildPendingReviewPayload,
  buildRecordResult,
  parseRecordInclude,
  type PendingReviewPublicRow,
  type RecordRow,
  type RecordResult,
  type RecordInclude,
} from '../utils/record-output.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveAndValidateTable(
  pluginId: string,
  instanceName: string,
  tableName: string
): { fullTableName: string; tableSpec: PluginTableSpec; entry: RegistryEntry } {
  const result = pluginManager.getTableSpec(pluginId, instanceName, tableName);
  if (!result) {
    throw new Error(
      `Plugin '${pluginId}' instance '${instanceName}' table '${tableName}' not found`
    );
  }
  const fullTableName = resolveTableName(pluginId, instanceName, tableName);
  // Pitfall 7 guard: ensure table name has fqcp_ prefix
  if (!fullTableName.startsWith('fqcp_')) {
    throw new Error('Invalid table name — must start with fqcp_');
  }
  return { fullTableName, ...result };
}

function buildRecordEmbedText(
  fields: Record<string, unknown>,
  embedFields: string[]
): string {
  return embedFields
    .map((f) => {
      const val = fields[f];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint')
        return String(val);
      return JSON.stringify(val);
    })
    .join('\n');
}

function formatElapsedMs(start: number): string {
  return (performance.now() - start).toFixed(1);
}

function logSearchRecordsTiming(input: {
  path: 'filters-only' | 'semantic';
  table: string;
  elapsedMs: string;
  rowCount?: number;
  error?: string;
}): void {
  const rowText = input.rowCount === undefined ? '' : ` rows=${input.rowCount}`;
  const message = `search_records timing: path=${input.path} table=${input.table}${rowText} elapsed_ms=${input.elapsedMs}`;
  if (input.error === undefined) {
    logger.info(message);
  } else {
    logger.warn(message);
  }
}

async function scheduleRecordEmbedding(input: {
  fullTableName: string,
  recordId: string,
  instanceId: string,
  fields: Record<string, unknown>,
  embedFields: string[],
  supabase: ReturnType<typeof supabaseManager.getClient>,
  databaseUrl: string
}): Promise<EmbeddingWarning[]> {
  const embedText = buildRecordEmbedText(input.fields, input.embedFields);
  if (!embedText.trim()) return [];

  const result = await scheduleBackgroundEmbedding({
    target: recordEmbeddingTarget({
      instanceId: input.instanceId,
      targetTable: input.fullTableName,
      id: input.recordId,
      label: input.fullTableName,
    }),
    embedText,
    provider: embeddingProvider,
    supabase: input.supabase,
    databaseUrl: input.databaseUrl,
  });
  return result.warnings;
}

async function queryPendingReview(
  pluginId: string,
  _instanceName: string,
  fqcInstanceId: string
): Promise<PendingReviewPublicRow[]> {
  const supabase = supabaseManager.getClient();
  const { data } = await supabase
    .from('fqc_pending_plugin_review')
    .select('id, fqc_id, plugin_id, table_name, review_type, context')
    .eq('plugin_id', pluginId)
    .eq('instance_id', fqcInstanceId);
  return data ?? [];
}

function buildReconciliationPayload(summary: ReconciliationActionSummary): Record<string, unknown> | undefined {
  const payload = {
    auto_tracked: summary.autoTracked,
    archived: summary.archived,
    resurrected: summary.resurrected,
    paths_updated: summary.pathsUpdated,
    fields_synced: summary.fieldsSynced,
    pending_reviews_created: summary.pendingReviewsCreated,
    pending_reviews_cleared: summary.pendingReviewsCleared,
  };
  return Object.values(payload).some((value) => value > 0) ? payload : undefined;
}

async function runScopedReconciliation(
  config: FlashQueryConfig,
  pluginId: string,
  instanceName: string
): Promise<Record<string, unknown> | undefined> {
  // REQ-023 / 157-RECONCILIATION-AUDIT.md: scope the non-idempotent
  // reconciliation preamble by plugin instead of guarding all records globally.
  return withPluginCoordinationLock(
    config,
    { pluginId, pluginInstance: instanceName },
    async () => {
      const result = await reconcilePluginDocuments(
        pluginId,
        instanceName,
        config.supabase.databaseUrl,
        { markFresh: false }
      );
      const actionSummary = await executeReconciliationActions(
        result,
        pluginId,
        instanceName,
        config.instance.id,
        config.supabase.databaseUrl,
        config
      );
      markPluginReconciled(pluginId, instanceName);
      return buildReconciliationPayload(actionSummary);
    }
  );
}

function recordNotFoundEnvelope(
  id: string,
  pluginId: string,
  table: string
): { error: 'not_found'; message: string; identifier: string; details: { plugin_id: string; table: string } } {
  return {
    error: 'not_found',
    message: `No record matches id '${id}'`,
    identifier: id,
    details: { plugin_id: pluginId, table },
  };
}

function tableNotFoundEnvelope(
  err: unknown,
  pluginId: string,
  instanceName: string,
  table: string
): { error: 'not_found'; message: string; identifier: string; details: { plugin_instance: string } } {
  return {
    error: 'not_found',
    message: err instanceof Error ? err.message : String(err),
    identifier: `${pluginId}.${table}`,
    details: { plugin_instance: instanceName },
  };
}

function isNotFoundDbError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST116') return true;
  const message = error.message?.toLowerCase() ?? '';
  return message.includes('no rows') || message.includes('0 rows') || message.includes('not found');
}

function asRecordRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> =>
    row !== null && typeof row === 'object' && !Array.isArray(row)
  );
}

function buildSearchEnvelope(input: {
  plugin_id?: string;
  table?: string;
  query?: string;
  tag?: string;
  rows: Array<Record<string, unknown>>;
  include: RecordInclude[];
  tableSpec: PluginTableSpec;
  semantic?: boolean;
  warnings?: string[];
  reconciliation?: Record<string, unknown>;
}): Record<string, unknown> {
  const results = input.rows.map((row) => {
    const result = buildRecordResult(
      row as RecordRow,
      { plugin_id: typeof row.plugin_id === 'string' ? row.plugin_id : input.plugin_id ?? '', table: typeof row.table === 'string' ? row.table : input.table ?? '', tableSpec: input.tableSpec },
      input.include
    ) as RecordResult & { score?: number };
    if (input.semantic && typeof row.similarity === 'number') {
      result.score = row.similarity;
    }
    return result;
  });
  return {
    ...(input.plugin_id === undefined ? {} : { plugin_id: input.plugin_id }),
    ...(input.table === undefined ? {} : { table: input.table }),
    query: input.query ?? '',
    ...(input.tag === undefined ? {} : { tag: input.tag }),
    total: results.length,
    results,
    ...(input.reconciliation === undefined ? {} : { reconciliation: input.reconciliation }),
    ...(input.warnings && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerRecordTools — registers all 5 record CRUD MCP tools
// ─────────────────────────────────────────────────────────────────────────────

export function registerRecordTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool 0: write_record (REC-04, REC-05) ───────────────────────────────

  server.registerTool(
    'write_record',
    {
      description: 'Create or update one structured plugin record. Use this when a plugin table owns the data and you need schema-validated record writes rather than markdown document edits.',
      inputSchema: {
        mode: z.enum(['create', 'update']).describe('Write mode. Use "create" for a new record or "update" for an existing record.'),
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        id: z.string().optional().describe('Record UUID. Required when mode is "update"; not allowed when mode is "create".'),
        data: z.record(z.string(), z.unknown()).describe('Schema-validated record fields to create or update'),
        include: z.array(z.enum(['data', 'schema_metadata'])).optional().describe('Optional payload sections. Defaults to identification-only for writes.'),
      },
    },
    async ({ mode, plugin_id, plugin_instance, table, id, data, include }) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      try {
        const instanceName = plugin_instance ?? 'default';
        let resolved: ReturnType<typeof resolveAndValidateTable>;
        try {
          resolved = resolveAndValidateTable(plugin_id, instanceName, table);
        } catch (err) {
          return jsonExpectedError(tableNotFoundEnvelope(err, plugin_id, instanceName, table));
        }

        const validationError = validateWriteRecordInput(
          { mode, plugin_id, table, id, data },
          resolved.tableSpec
        );
        if (validationError) {
          return jsonExpectedError(validationError);
        }

        let reconciliation: Record<string, unknown> | undefined;
        try {
          // REQ-023 / 157-RECONCILIATION-AUDIT.md: scoped per-plugin advisory guard.
          reconciliation = await runScopedReconciliation(config, plugin_id, instanceName);
        } catch (err) {
          logger.warn(`[record tool] reconciliation warning: ${err instanceof Error ? err.message : String(err)}`);
        }

        const supabase = supabaseManager.getClient();
        const effectiveInclude = parseRecordInclude(include, 'write');
        const recordData = data;
        const now = new Date().toISOString();
        let embeddingWarnings: EmbeddingWarning[] = [];

        let row: Record<string, unknown> | null;
        if (mode === 'create') {
          const insertResult = (await supabase
            .from(resolved.fullTableName)
            .insert({ ...recordData, instance_id: config.instance.id })
            .select('*')
            .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
          if (insertResult.error || !insertResult.data) {
            return jsonRuntimeError(insertResult.error?.message ?? 'Insert returned no data');
          }
          row = insertResult.data;

          if (resolved.tableSpec.embed_fields && resolved.tableSpec.embed_fields.length > 0) {
            embeddingWarnings = await scheduleRecordEmbedding({
              fullTableName: resolved.fullTableName,
              recordId: row.id as string,
              instanceId: config.instance.id,
              fields: recordData,
              embedFields: resolved.tableSpec.embed_fields,
              supabase,
              databaseUrl: config.supabase.databaseUrl,
            });
          }
        } else {
          const updateId = id ?? '';
          const updateResult = (await supabase
            .from(resolved.fullTableName)
            .update({ ...recordData, updated_at: now })
            .eq('id', updateId)
            .eq('instance_id', config.instance.id)
            .select('*')
            .single()) as { data: Record<string, unknown> | null; error: { message: string; code?: string } | null };
          if (updateResult.error || !updateResult.data) {
            if (!isNotFoundDbError(updateResult.error)) {
              return jsonRuntimeError(updateResult.error?.message ?? 'Update returned no data');
            }
            return jsonExpectedError(recordNotFoundEnvelope(updateId, plugin_id, table));
          }
          row = updateResult.data;

          if (resolved.tableSpec.embed_fields && resolved.tableSpec.embed_fields.length > 0) {
            embeddingWarnings = await scheduleRecordEmbedding({
              fullTableName: resolved.fullTableName,
              recordId: updateId,
              instanceId: config.instance.id,
              fields: row,
              embedFields: resolved.tableSpec.embed_fields,
              supabase,
              databaseUrl: config.supabase.databaseUrl,
            });
          }
        }

        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const payload = addPendingReviewPayload(
          addReconciliationPayload(
            buildRecordResult(
              row as RecordRow,
              { plugin_id, table, tableSpec: resolved.tableSpec },
              effectiveInclude
            ),
            reconciliation
          ),
          buildPendingReviewPayload(pendingItems)
        );

        logger.info(`write_record: ${mode} ${String(payload.id)} in ${resolved.fullTableName}`);
        return jsonToolResult(withWarnings(payload, embeddingWarnings));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`write_record failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 2: get_record (REC-02) ──────────────────────────────────────────

  server.registerTool(
    'get_record',
    {
      description: 'Retrieve a single record by its ID from a plugin table. Returns all fields for that record. Use this when you know the exact record ID and need its full details.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        id: z.string().describe('Record UUID'),
        include: z.array(z.enum(['data', 'schema_metadata'])).optional().describe('Optional payload sections. Defaults to ["data"].'),
      },
    },
    async ({ plugin_id, plugin_instance, table, id, include }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        let reconciliation: Record<string, unknown> | undefined;
        try {
          // REQ-023 / 157-RECONCILIATION-AUDIT.md: scoped per-plugin advisory guard.
          reconciliation = await runScopedReconciliation(config, plugin_id, instanceName);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
        }

        const { fullTableName, tableSpec } = resolveAndValidateTable(plugin_id, instanceName, table);

        const supabase = supabaseManager.getClient();
        const getResult = (await supabase
          .from(fullTableName)
          .select('*')
          .eq('id', id)
          .eq('instance_id', config.instance.id)
          .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
        const { data, error } = getResult;

        if (error || !data) {
          const msg = `No record matches id '${id}'`;
          logger.warn(`get_record: ${msg}`);
          return jsonExpectedError(recordNotFoundEnvelope(id, plugin_id, table));
        }

        logger.info(`get_record: retrieved ${id} from ${fullTableName}`);
        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const payload = addPendingReviewPayload(
          addReconciliationPayload(
            buildRecordResult(
              data as { id: string; created_at: string; updated_at: string; [key: string]: unknown },
              { plugin_id, table, tableSpec },
              parseRecordInclude(include, 'get')
            ),
            reconciliation
          ),
          buildPendingReviewPayload(pendingItems)
        );
        return jsonToolResult(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_record failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 4: archive_record (REC-04) ──────────────────────────────────────

  server.registerTool(
    'archive_record',
    {
      description: 'Soft-delete a record by setting its status to \'archived\'. The record remains in the database but is excluded from search results. Use this when a record is no longer active but should be preserved for history — e.g. closing a deal, archiving a completed task.',
      inputSchema: {
        targets: z.array(z.object({
          plugin_id: z.string().describe('Plugin identifier'),
          plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
          table: z.string().describe('Table name as defined in plugin schema'),
          id: z.string().describe('Record UUID'),
        })).describe('Ordered archive targets'),
      },
    },
    async ({ targets }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      if (!Array.isArray(targets)) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'archive_record requires targets: [{ plugin_id, table, id }]',
          details: { field: 'targets' },
        });
      }

      try {
        const supabase = supabaseManager.getClient();
        const results: Array<Record<string, unknown>> = [];

        for (const target of targets as Array<{ plugin_id: string; plugin_instance?: string; table: string; id: string }>) {
          const instanceName = target.plugin_instance ?? 'default';
          try {
            let reconciliation: Record<string, unknown> | undefined;
            try {
              // REQ-023 / 157-RECONCILIATION-AUDIT.md: scoped per-plugin advisory guard.
              reconciliation = await runScopedReconciliation(config, target.plugin_id, instanceName);
            } catch (err) {
              logger.warn(`[record tool] reconciliation warning: ${err instanceof Error ? err.message : String(err)}`);
            }

            let resolved: ReturnType<typeof resolveAndValidateTable>;
            try {
              resolved = resolveAndValidateTable(target.plugin_id, instanceName, target.table);
            } catch (err) {
              results.push(tableNotFoundEnvelope(err, target.plugin_id, instanceName, target.table));
              continue;
            }
            const { fullTableName, tableSpec } = resolved;
            const supportsArchivedAt = tableSpec.columns.some((column) => column.name === 'archived_at');
            const archivedAt = new Date().toISOString();
            const updatePayload = {
              status: 'archived',
              updated_at: archivedAt,
              ...(supportsArchivedAt ? { archived_at: archivedAt } : {}),
            };
            const updateResult = (await supabase
              .from(fullTableName)
              .update(updatePayload)
              .eq('id', target.id)
              .eq('instance_id', config.instance.id)
              .select('*')
              .single()) as { data: Record<string, unknown> | null; error: { message: string; code?: string } | null };

            if (updateResult.error || !updateResult.data) {
              if (!isNotFoundDbError(updateResult.error)) {
                return jsonRuntimeError({
                  message: updateResult.error?.message ?? 'Archive returned no data',
                  identifier: target.id,
                  details: { plugin_id: target.plugin_id, table: target.table },
                });
              }
              results.push(recordNotFoundEnvelope(target.id, target.plugin_id, target.table));
              continue;
            }

            const payload = addReconciliationPayload(
              buildRecordResult(
                updateResult.data as RecordRow,
                { plugin_id: target.plugin_id, table: target.table, tableSpec },
                []
              ),
              reconciliation
            );
            results.push({
              ...payload,
              ...(supportsArchivedAt ? { archived_at: archivedAt } : {}),
              ...(supportsArchivedAt ? {} : { warnings: ['archived_at_unavailable'] }),
            });
          } catch (err) {
            return jsonRuntimeError({
              message: err instanceof Error ? err.message : String(err),
              identifier: target.id,
              details: { plugin_id: target.plugin_id, table: target.table },
            });
          }
        }

        return jsonToolResult(results);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`archive_record failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 5: search_records (REC-05, D-10, D-11) ─────────────────────────

  server.registerTool(
    'search_records',
    {
      description:
        'Search records in a plugin table by field filters, text query, or semantic similarity. Automatically uses vector search (pgvector) for tables with embedding fields, or text matching otherwise. Use this when the user wants to find, filter, or query plugin data — e.g. "find contacts tagged VIP" or "search opportunities mentioning renewal".',
      inputSchema: {
        plugin_id: z.string().optional().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().optional().describe('Table name as defined in plugin schema'),
        filters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Key-value field equality filters (AND logic)'),
        query: z
          .string()
          .optional()
          .describe('Text search query (semantic if table has embed_fields, ILIKE otherwise)'),
        tag: z.string().optional().describe('Tag to search in taggable plugin tables'),
        taggable_tables_only: z.boolean().optional().describe('When true, search all registered tables with a tags/tag column'),
        include: z.array(z.enum(['data', 'schema_metadata'])).optional().describe('Optional payload sections for results'),
        limit: z.number().optional().describe('Max results (default: 10)'),
      },
    },
    async ({ plugin_id, plugin_instance, table, filters, query, tag, taggable_tables_only, include, limit }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        const effectiveInclude = parseRecordInclude(include, 'search');
        const maxResults = limit ?? 10;

        if (taggable_tables_only === true) {
          const entries = pluginManager.getAllEntries();
          const taggable = entries.flatMap((entry) =>
            entry.schema.tables
              .filter((candidate) => candidate.columns.some((column) => column.name === 'tags' || column.name === 'tag'))
              .map((candidate) => ({ entry, tableSpec: candidate }))
          );
          if (taggable.length === 0) {
            return jsonToolResult({
              query: query ?? '',
              ...(tag === undefined ? {} : { tag }),
              total: 0,
              results: [],
              warnings: ['plugin_no_taggable_tables'],
            });
          }

          const reconciliationPayloads: Record<string, unknown>[] = [];
          const reconciledPlugins = new Set<string>();
          for (const item of taggable) {
            const key = `${item.entry.plugin_id}:${item.entry.plugin_instance}`;
            if (reconciledPlugins.has(key)) continue;
            reconciledPlugins.add(key);
            try {
              const payload = await runScopedReconciliation(
                config,
                item.entry.plugin_id,
                item.entry.plugin_instance
              );
              if (payload !== undefined) {
                reconciliationPayloads.push({
                  plugin_id: item.entry.plugin_id,
                  plugin_instance: item.entry.plugin_instance,
                  ...payload,
                });
              }
            } catch (err) {
              logger.warn(`[record tool] taggable reconciliation warning: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          const rows: Array<Record<string, unknown>> = [];
          for (const item of taggable) {
            const fullTableName = resolveTableName(item.entry.plugin_id, item.entry.plugin_instance, item.tableSpec.name);
            const tagColumn = item.tableSpec.columns.find((column) => column.name === 'tags' || column.name === 'tag');
            if (tagColumn === undefined) continue;

            let qb = supabaseManager.getClient()
              .from(fullTableName)
              .select('*')
              .eq('instance_id', config.instance.id)
              .eq('status', 'active');

            if (tag !== undefined) {
              qb = qb.eq(tagColumn.name, tag);
            }

            const { data, error } = await qb.limit(maxResults);
            if (error) {
              logger.warn(`search_records taggable query failed for ${fullTableName}: ${error.message}`);
              continue;
            }
            rows.push(...asRecordRows(data).map((row) => ({
              ...row,
              plugin_id: item.entry.plugin_id,
              table: item.tableSpec.name,
            })));
          }

          return jsonToolResult(buildSearchEnvelope({
            query,
            tag,
            rows: rows.slice(0, maxResults),
            include: effectiveInclude,
            tableSpec: taggable[0].tableSpec,
            reconciliation: reconciliationPayloads.length > 0
              ? { taggable_tables: reconciliationPayloads }
              : undefined,
          }));
        }

        if (typeof plugin_id !== 'string' || typeof table !== 'string') {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'plugin_id and table are required unless taggable_tables_only is true',
            details: { fields: ['plugin_id', 'table'] },
          });
        }

        let reconciliation: Record<string, unknown> | undefined;
        try {
          // REQ-023 / 157-RECONCILIATION-AUDIT.md: scoped per-plugin advisory guard.
          reconciliation = await runScopedReconciliation(config, plugin_id, instanceName);
        } catch (err) {
          logger.warn(`[record tool] reconciliation warning: ${err instanceof Error ? err.message : String(err)}`);
        }

        const { fullTableName, tableSpec } = resolveAndValidateTable(
          plugin_id,
          instanceName,
          table
        );

        const hasQuery = typeof query === 'string' && query.length > 0;
        const queryText = typeof query === 'string' ? query : '';
        const hasEmbedFields = tableSpec.embed_fields && tableSpec.embed_fields.length > 0;

        // ── Filters-only path (no query) ──────────────────────────────────
        if (!hasQuery) {
          const supabase = supabaseManager.getClient();
          let qb = supabase
            .from(fullTableName)
            .select('*')
            .eq('instance_id', config.instance.id)
            .eq('status', 'active');

          if (filters) {
            for (const [key, value] of Object.entries(filters)) {
              qb = qb.eq(key, value);
            }
          }

          const queryStart = performance.now();
          let data: unknown;
          let error: { message: string } | null;
          try {
            ({ data, error } = await qb.limit(maxResults));
          } catch (err) {
            logSearchRecordsTiming({
              path: 'filters-only',
              table: fullTableName,
              elapsedMs: formatElapsedMs(queryStart),
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
          const rows = asRecordRows(data);
          if (error) {
            logSearchRecordsTiming({
              path: 'filters-only',
              table: fullTableName,
              elapsedMs: formatElapsedMs(queryStart),
              rowCount: rows.length,
              error: error.message,
            });
            return jsonRuntimeError(error.message);
          }

          logSearchRecordsTiming({
            path: 'filters-only',
            table: fullTableName,
            elapsedMs: formatElapsedMs(queryStart),
            rowCount: rows.length,
          });
          return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, reconciliation }));
        }

        // ── Semantic path (query + embed_fields) ──────────────────────────
        if (hasEmbedFields) {
          const queryEmbedding = await embeddingProvider.embed(queryText);
          const escapedTable = pg.escapeIdentifier(fullTableName);

          // Build filter clauses
          const params: unknown[] = [
            `[${queryEmbedding.join(',')}]`,
            config.instance.id,
            maxResults,
          ];
          let filterSql = '';
          if (filters) {
            for (const [key, value] of Object.entries(filters)) {
              params.push(value);
              filterSql += ` AND ${pg.escapeIdentifier(key)} = $${params.length}`;
            }
          }

          const sql = `
            SELECT *, 1 - (embedding <=> $1::vector) AS similarity
            FROM ${escapedTable}
            WHERE instance_id = $2
              AND status = 'active'
              AND embedding IS NOT NULL
              ${filterSql}
            ORDER BY embedding <=> $1::vector
            LIMIT $3
          `;

          const queryStart = performance.now();
          let result: Awaited<ReturnType<typeof queryPgPool>>;
          try {
            result = await queryPgPool(config.supabase.databaseUrl, sql, params);
          } catch (err) {
            logSearchRecordsTiming({
              path: 'semantic',
              table: fullTableName,
              elapsedMs: formatElapsedMs(queryStart),
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
          const rows = asRecordRows(result.rows);
          logSearchRecordsTiming({
            path: 'semantic',
            table: fullTableName,
            elapsedMs: formatElapsedMs(queryStart),
            rowCount: rows.length,
          });
          return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, semantic: true, reconciliation }));
        }

        // ── ILIKE path (query + no embed_fields) ──────────────────────────
        const textColumns = tableSpec.columns.filter((c) => c.type === 'text').map((c) => c.name);

        if (textColumns.length === 0) {
          // No text columns to search — fall back to filters-only with no text filter
          const supabase = supabaseManager.getClient();
          let qb = supabase
            .from(fullTableName)
            .select('*')
            .eq('instance_id', config.instance.id)
            .eq('status', 'active');
          if (filters) {
            for (const [key, value] of Object.entries(filters)) {
              qb = qb.eq(key, value);
            }
          }
          const { data, error } = await qb.limit(maxResults);
          if (error) {
            return jsonRuntimeError(error.message);
          }
          const rows = asRecordRows(data);
          return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, reconciliation }));
        }

        const params: unknown[] = [`%${queryText}%`, config.instance.id, maxResults];
        const ilikeConditions = textColumns
          .map((col) => `${pg.escapeIdentifier(col)} ILIKE $1`)
          .join(' OR ');

        let filterSql = '';
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            params.push(value);
            filterSql += ` AND ${pg.escapeIdentifier(key)} = $${params.length}`;
          }
        }

        const sql = `
          SELECT *
          FROM ${pg.escapeIdentifier(fullTableName)}
          WHERE instance_id = $2
            AND status = 'active'
            AND (${ilikeConditions})
            ${filterSql}
          ORDER BY created_at DESC
          LIMIT $3
        `;

        const result = await queryPgPool(config.supabase.databaseUrl, sql, params);
        const rows = asRecordRows(result.rows);
        logger.info(`search_records: ILIKE found ${rows.length} record(s) in ${fullTableName}`);
        return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, reconciliation }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`search_records failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );
}
