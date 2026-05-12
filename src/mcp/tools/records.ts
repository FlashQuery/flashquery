import { z } from 'zod';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pluginManager, resolveTableName } from '../../plugins/manager.js';
import type { PluginTableSpec, RegistryEntry } from '../../plugins/manager.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { createPgClientIPv4 } from '../../utils/pg-client.js';
import {
  reconcilePluginDocuments,
  executeReconciliationActions,
} from '../../services/plugin-reconciliation.js';
import type { ReconciliationActionSummary } from '../../services/plugin-reconciliation.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
} from '../utils/response-formats.js';
import { validateWriteRecordInput } from '../utils/record-validation.js';
import {
  addPendingReviewPayload,
  addReconciliationPayload,
  buildRecordResult,
  parseRecordInclude,
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

function fireAndForgetEmbed(
  fullTableName: string,
  recordId: string,
  fields: Record<string, unknown>,
  embedFields: string[],
  databaseUrl: string
): void {
  const embedText = embedFields
    .map((f) => {
      const val = fields[f];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint')
        return String(val);
      return JSON.stringify(val);
    })
    .join('\n');
  if (!embedText.trim()) return; // nothing to embed
  void embeddingProvider
    .embed(embedText)
    .then(async (vector) => {
      // Use raw pg client — PostgREST cannot reliably cast JSON strings to vector type
      // on dynamically-created plugin tables.
      const client = createPgClientIPv4(databaseUrl);
      try {
        await client.connect();
        await client.query(
          `UPDATE ${pg.escapeIdentifier(fullTableName)} SET embedding = $1::vector, embedding_updated_at = now() WHERE id = $2`,
          [`[${vector.join(',')}]`, recordId]
        );
      } finally {
        await client.end().catch(() => {});
      }
    })
    .catch((err) =>
      logger.warn(
        `record embed failed for ${fullTableName}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
}

function formatReconciliationSummary(summary: ReconciliationActionSummary): string {
  const parts: string[] = [];
  if (summary.autoTracked > 0) parts.push(`Auto-tracked ${summary.autoTracked} new document(s)`);
  if (summary.archived > 0) parts.push(`Archived ${summary.archived} record(s) (documents missing or disassociated)`);
  if (summary.resurrected > 0) parts.push(`Resurrected ${summary.resurrected} record(s)`);
  if (summary.pathsUpdated > 0) parts.push(`Updated paths for ${summary.pathsUpdated} moved document(s)`);
  if (summary.fieldsSynced > 0) parts.push(`Synced fields on ${summary.fieldsSynced} modified document(s)`);
  return parts.length > 0 ? `\nReconciliation: ${parts.join('. ')}.` : '';
}

async function queryPendingReview(
  pluginId: string,
  _instanceName: string,
  fqcInstanceId: string
): Promise<Array<{ fqc_id: string; table_name: string; review_type: string; context: unknown }>> {
  const supabase = supabaseManager.getClient();
  const { data } = await supabase
    .from('fqc_pending_plugin_review')
    .select('fqc_id, table_name, review_type, context')
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

function buildPendingReviewPayload(
  pendingItems: Array<{ fqc_id: string; table_name: string; review_type: string; context: unknown }>
): Record<string, unknown> | undefined {
  if (pendingItems.length === 0) return undefined;
  return {
    count: pendingItems.length,
    items: pendingItems.map((item) => ({
      fqc_id: item.fqc_id,
      table: item.table_name,
      type: item.review_type,
      context: item.context,
    })),
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'records',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return jsonRuntimeError('Write lock timeout: another instance is writing to records. Retry in a few seconds.');
        }
      }

      try {
        const instanceName = plugin_instance ?? 'default';
        let resolved: ReturnType<typeof resolveAndValidateTable>;
        try {
          resolved = resolveAndValidateTable(plugin_id, instanceName, table);
        } catch (err) {
          return jsonExpectedError({
            error: 'not_found',
            message: err instanceof Error ? err.message : String(err),
            identifier: `${plugin_id}:${instanceName}:${table}`,
          });
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
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliation = buildReconciliationPayload(actionSummary);
        } catch (err) {
          logger.warn(`[record tool] reconciliation warning: ${err instanceof Error ? err.message : String(err)}`);
        }

        const supabase = supabaseManager.getClient();
        const effectiveInclude = parseRecordInclude(include as RecordInclude[] | undefined, 'write');
        const recordData = data as Record<string, unknown>;
        const now = new Date().toISOString();

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
            fireAndForgetEmbed(
              resolved.fullTableName,
              row.id as string,
              recordData,
              resolved.tableSpec.embed_fields,
              config.supabase.databaseUrl
            );
          }
        } else {
          const updateResult = (await supabase
            .from(resolved.fullTableName)
            .update({ ...recordData, updated_at: now })
            .eq('id', id as string)
            .eq('instance_id', config.instance.id)
            .select('*')
            .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
          if (updateResult.error || !updateResult.data) {
            return jsonExpectedError({
              error: 'not_found',
              message: `Record '${id}' not found in ${resolved.fullTableName}`,
              identifier: id as string,
            });
          }
          row = updateResult.data;

          if (resolved.tableSpec.embed_fields && resolved.tableSpec.embed_fields.length > 0) {
            fireAndForgetEmbed(
              resolved.fullTableName,
              id as string,
              row,
              resolved.tableSpec.embed_fields,
              config.supabase.databaseUrl
            );
          }
        }

        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const payload = addPendingReviewPayload(
          addReconciliationPayload(
            buildRecordResult(
              row as { id: string; created_at: string; updated_at: string; [key: string]: unknown },
              { plugin_id, table, tableSpec: resolved.tableSpec },
              effectiveInclude
            ),
            reconciliation
          ),
          buildPendingReviewPayload(pendingItems)
        );

        logger.info(`write_record: ${mode} ${payload.id} in ${resolved.fullTableName}`);
        return jsonToolResult(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`write_record failed: ${msg}`);
        return jsonRuntimeError(msg);
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'records');
        }
      }
    }
  );

  // ─── Tool 1: create_record (REC-01) ──────────────────────────────────────

  server.registerTool(
    'create_record',
    {
      description: 'Create a new record in a plugin table — e.g. a CRM contact, a task, a log entry. Specify the plugin_id and table name, then pass the record\'s field values. The table must have been created by register_plugin first. Returns the new record\'s ID.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        fields: z.record(z.string(), z.unknown()).describe('Field values as key-value pairs'),
      },
    },
    async ({ plugin_id, plugin_instance, table, fields }) => {
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'records',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to records. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }
      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        let reconciliationSummary = '';
        let reconciliationWarning = '';
        try {
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliationSummary = formatReconciliationSummary(actionSummary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
          reconciliationWarning = `\nReconciliation warning: ${msg}`;
        }

        const { fullTableName, tableSpec } = resolveAndValidateTable(
          plugin_id,
          instanceName,
          table
        );

        const supabase = supabaseManager.getClient();
        const { data, error } = await supabase
          .from(fullTableName)
          .insert({ ...fields, instance_id: config.instance.id })
          .select('id')
          .single();

        if (error || !data) {
          const msg = error?.message ?? 'Insert returned no data';
          logger.error(`create_record failed: ${msg}`);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }

        // Fire-and-forget embedding when table has embed_fields
        if (tableSpec.embed_fields && tableSpec.embed_fields.length > 0) {
          fireAndForgetEmbed(
            fullTableName,
            data.id as string,
            fields,
            tableSpec.embed_fields,
            config.supabase.databaseUrl
          );
        }

        logger.info(`create_record: created ${data.id} in ${fullTableName}`);
        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const pendingNote = pendingItems.length > 0
          ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
          : '';
        return {
          content: [
            { type: 'text' as const, text: `Created record ${data.id} in ${fullTableName}${reconciliationSummary}${reconciliationWarning}${pendingNote}` },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`create_record failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'records');
        }
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
      },
    },
    async ({ plugin_id, plugin_instance, table, id }) => {
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
        let reconciliationSummary = '';
        let reconciliationWarning = '';
        try {
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliationSummary = formatReconciliationSummary(actionSummary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
          reconciliationWarning = `\nReconciliation warning: ${msg}`;
        }

        const { fullTableName } = resolveAndValidateTable(plugin_id, instanceName, table);

        const supabase = supabaseManager.getClient();
        const getResult = (await supabase
          .from(fullTableName)
          .select('*')
          .eq('id', id)
          .eq('instance_id', config.instance.id)
          .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
        const { data, error } = getResult;

        if (error || !data) {
          const msg = `Record '${id}' not found in ${fullTableName}`;
          logger.warn(`get_record: ${msg}`);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }

        logger.info(`get_record: retrieved ${id} from ${fullTableName}`);
        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const pendingNote = pendingItems.length > 0
          ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
          : '';
        return {
          content: [{ type: 'text' as const, text: `${JSON.stringify(data, null, 2)}${reconciliationSummary}${reconciliationWarning}${pendingNote}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_record failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 3: update_record (REC-03) ───────────────────────────────────────

  server.registerTool(
    'update_record',
    {
      description: 'Update specific fields on an existing record in a plugin table. Pass only the fields that need to change — other fields are preserved. Use this when modifying a CRM contact\'s details, updating a task\'s status, or changing any plugin record\'s data.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        id: z.string().describe('Record UUID'),
        fields: z.record(z.string(), z.unknown()).describe('Fields to update'),
      },
    },
    async ({ plugin_id, plugin_instance, table, id, fields }) => {
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'records',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to records. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }
      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        let reconciliationSummary = '';
        let reconciliationWarning = '';
        try {
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliationSummary = formatReconciliationSummary(actionSummary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
          reconciliationWarning = `\nReconciliation warning: ${msg}`;
        }

        const { fullTableName, tableSpec } = resolveAndValidateTable(
          plugin_id,
          instanceName,
          table
        );

        const supabase = supabaseManager.getClient();
        const updateResult = (await supabase
          .from(fullTableName)
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('instance_id', config.instance.id)
          .select('*')
          .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
        const { data, error } = updateResult;

        if (error) {
          const msg = error.message;
          logger.error(`update_record failed: ${msg}`);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }

        // Fire-and-forget re-embedding using merged record data for complete embed text
        if (tableSpec.embed_fields && tableSpec.embed_fields.length > 0 && data) {
          fireAndForgetEmbed(
            fullTableName,
            id,
            { ...data },
            tableSpec.embed_fields,
            config.supabase.databaseUrl
          );
        }

        logger.info(`update_record: updated ${id} in ${fullTableName}`);
        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const pendingNote = pendingItems.length > 0
          ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
          : '';
        return {
          content: [{ type: 'text' as const, text: `Updated record ${id} in ${fullTableName}${reconciliationSummary}${reconciliationWarning}${pendingNote}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`update_record failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'records');
        }
      }
    }
  );

  // ─── Tool 4: archive_record (REC-04) ──────────────────────────────────────

  server.registerTool(
    'archive_record',
    {
      description: 'Soft-delete a record by setting its status to \'archived\'. The record remains in the database but is excluded from search results. Use this when a record is no longer active but should be preserved for history — e.g. closing a deal, archiving a completed task.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        id: z.string().describe('Record UUID'),
      },
    },
    async ({ plugin_id, plugin_instance, table, id }) => {
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'records',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to records. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }
      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        let reconciliationSummary = '';
        let reconciliationWarning = '';
        try {
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliationSummary = formatReconciliationSummary(actionSummary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
          reconciliationWarning = `\nReconciliation warning: ${msg}`;
        }

        const { fullTableName } = resolveAndValidateTable(plugin_id, instanceName, table);

        const supabase = supabaseManager.getClient();
        const { error } = await supabase
          .from(fullTableName)
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('instance_id', config.instance.id);

        if (error) {
          const msg = error.message;
          logger.error(`archive_record failed: ${msg}`);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }

        logger.info(`archive_record: archived ${id} in ${fullTableName}`);
        const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
        const pendingNote = pendingItems.length > 0
          ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
          : '';
        return {
          content: [{ type: 'text' as const, text: `Archived record ${id} in ${fullTableName}${reconciliationSummary}${reconciliationWarning}${pendingNote}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`archive_record failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'records');
        }
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
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        table: z.string().describe('Table name as defined in plugin schema'),
        filters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Key-value field equality filters (AND logic)'),
        query: z
          .string()
          .optional()
          .describe('Text search query (semantic if table has embed_fields, ILIKE otherwise)'),
        limit: z.number().optional().describe('Max results (default: 10)'),
      },
    },
    async ({ plugin_id, plugin_instance, table, filters, query, limit }) => {
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'records',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to records. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }
      try {
        // ── Reconciliation preamble (D-07) ──
        const instanceName = plugin_instance ?? 'default';
        let reconciliationSummary = '';
        let reconciliationWarning = '';
        try {
          const result = await reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl);
          const actionSummary = await executeReconciliationActions(result, plugin_id, instanceName, config.instance.id, config.supabase.databaseUrl);
          reconciliationSummary = formatReconciliationSummary(actionSummary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[record tool] reconciliation warning: ${msg}`);
          reconciliationWarning = `\nReconciliation warning: ${msg}`;
        }

        const { fullTableName, tableSpec } = resolveAndValidateTable(
          plugin_id,
          instanceName,
          table
        );

        const maxResults = limit ?? 10;
        const hasQuery = typeof query === 'string' && query.length > 0;
        const hasEmbedFields = tableSpec.embed_fields && tableSpec.embed_fields.length > 0;

        // ── Filters-only path (no query) ──────────────────────────────────
        if (!hasQuery) {
          const supabase = supabaseManager.getClient();
          // TODO LOG-01: Add timing to record queries (high-value: identifies slow DB operations)
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
            return {
              content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
              isError: true,
            };
          }

          const rows = data ?? [];
          logger.info(
            `search_records: filters-only found ${rows.length} record(s) in ${fullTableName}`
          );
          const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
          const pendingNote = pendingItems.length > 0
            ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
            : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Found ${rows.length} record(s):\n${JSON.stringify(rows, null, 2)}${reconciliationSummary}${reconciliationWarning}${pendingNote}`,
              },
            ],
          };
        }

        // ── Semantic path (query + embed_fields) ──────────────────────────
        if (hasEmbedFields) {
          // TODO LOG-01: Add timing to record queries (high-value: identifies slow DB operations)
          const queryEmbedding = await embeddingProvider.embed(query);
          const escapedTable = pg.escapeIdentifier(fullTableName);
          const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
          try {
            await pgClient.connect();

            // Build filter clauses
            const params: unknown[] = [
              JSON.stringify(queryEmbedding),
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

            const result = await pgClient.query(sql, params);
            const rows = result.rows ?? [];
            logger.info(
              `search_records: semantic found ${rows.length} record(s) in ${fullTableName}`
            );
            const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
            const pendingNote = pendingItems.length > 0
              ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
              : '';
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Found ${rows.length} record(s):\n${JSON.stringify(rows, null, 2)}${reconciliationSummary}${reconciliationWarning}${pendingNote}`,
                },
              ],
            };
          } finally {
            await pgClient.end();
          }
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
            return {
              content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
              isError: true,
            };
          }
          const rows = data ?? [];
          const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
          const pendingNote = pendingItems.length > 0
            ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
            : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Found ${rows.length} record(s):\n${JSON.stringify(rows, null, 2)}${reconciliationSummary}${reconciliationWarning}${pendingNote}`,
              },
            ],
          };
        }

        const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
        try {
          await pgClient.connect();

          const params: unknown[] = [`%${query}%`, config.instance.id, maxResults];
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

          const result = await pgClient.query(sql, params);
          const rows = result.rows ?? [];
          logger.info(`search_records: ILIKE found ${rows.length} record(s) in ${fullTableName}`);
          const pendingItems = await queryPendingReview(plugin_id, instanceName, config.instance.id);
          const pendingNote = pendingItems.length > 0
            ? `\n${pendingItems.length} pending review item(s). Call clear_pending_reviews to process.`
            : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Found ${rows.length} record(s):\n${JSON.stringify(rows, null, 2)}${reconciliationSummary}${reconciliationWarning}${pendingNote}`,
              },
            ],
          };
        } finally {
          await pgClient.end();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`search_records failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'records');
        }
      }
    }
  );
}
