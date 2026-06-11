import { z } from 'zod';
import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { buildPluginEmbeddingColumnSetDDL } from '../../storage/supabase.js';
import {
  pluginManager,
  parsePluginSchema,
  buildPluginTableDDL,
  resolveTableName,
  validateInstanceName,
  buildGlobalTypeRegistry,
} from '../../plugins/manager.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { createPgClientIPv4 } from '../../utils/pg-client.js';
import { compareSchemaVersions, analyzeSchemaChanges } from '../../utils/schema-migration.js';
import { reloadManifests } from '../../services/manifest-loader.js';
import { withPluginCoordinationLock } from '../../services/plugin-coordination-lock.js';
import { LockTimeoutError } from '../../services/document-lock.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  pluginIdentification,
  withWarnings,
} from '../utils/response-formats.js';

export const registerPluginInputSchema = {
  schema_path: z.string().optional().describe('Path to YAML schema file on disk'),
  schema_yaml: z.string().optional().describe('Inline YAML schema string'),
  plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
  embedding_name: z.string().nullable().optional().describe('Resolved embedding catalog entry override. Omit to use the plugin manifest; null opts out.'),
};

export function validateRegisterPluginEmbeddingOverride(
  embeddingName: string | null | undefined
): { ok: true } | { ok: false; message: string } {
  if (embeddingName === '*') {
    return { ok: false, message: 'register_plugin embedding_name override cannot be "*"; choose a specific catalog entry name or null' };
  }
  return { ok: true };
}

interface CatalogEmbeddingEntry {
  name: string;
  dimensions: number;
  status: 'active' | 'deactivated';
}

type PluginEmbeddingResolution = {
  ok: true;
  embeddingName: string | null;
  entry: CatalogEmbeddingEntry | null;
  warnings: string[];
} | {
  ok: false;
  error: ReturnType<typeof jsonExpectedError>;
};

function activeNames(entries: CatalogEmbeddingEntry[]): string[] {
  return entries.filter((entry) => entry.status === 'active').map((entry) => entry.name).sort();
}

export function resolvePluginEmbeddingChoice(input: {
  manifestEmbedding: string | null;
  overrideEmbeddingName?: string | null;
  catalogEntries: CatalogEmbeddingEntry[];
}): PluginEmbeddingResolution {
  const overrideValidation = validateRegisterPluginEmbeddingOverride(input.overrideEmbeddingName);
  if (!overrideValidation.ok) {
    return {
      ok: false,
      error: jsonExpectedError({
        error: 'invalid_input',
        message: overrideValidation.message,
        identifier: 'embedding_name',
        details: { field: 'embedding_name' },
      }),
    };
  }

  const available = activeNames(input.catalogEntries);
  const target =
    input.overrideEmbeddingName !== undefined
      ? input.overrideEmbeddingName
      : input.manifestEmbedding;

  if (target === null) {
    return { ok: true, embeddingName: null, entry: null, warnings: [] };
  }

  if (target === '*') {
    if (available.length === 0) {
      return {
        ok: true,
        embeddingName: null,
        entry: null,
        warnings: ['plugin_embedding_unavailable'],
      };
    }
    if (available.length === 1) {
      const entry = input.catalogEntries.find((candidate) => candidate.name === available[0]) ?? null;
      return { ok: true, embeddingName: available[0], entry, warnings: [] };
    }
    return {
      ok: false,
      error: jsonExpectedError({
        error: 'ambiguous_identifier',
        message: 'Plugin manifest embedding "*" is ambiguous because multiple active embeddings are configured; re-run register_plugin with embedding_name set to one available entry.',
        identifier: 'embedding_name',
        details: { available_embedding_names: available },
      }),
    };
  }

  const namedEntry = input.catalogEntries.find((entry) => entry.name === target);
  if (!namedEntry) {
    return {
      ok: false,
      error: jsonExpectedError({
        error: 'not_found',
        message: `Embedding entry '${target}' was not found in this instance catalog.`,
        identifier: target,
        details: { available_embedding_names: available },
      }),
    };
  }
  if (namedEntry.status === 'deactivated') {
    return {
      ok: false,
      error: jsonExpectedError({
        error: 'unsupported',
        message: `Embedding entry '${target}' is deactivated; re-add it to flashquery.yml to reactivate or retire it to clean up.`,
        identifier: target,
        details: {
          embedding_name: target,
          available_embedding_names: available,
          remediation: 'Re-add the embedding entry to flashquery.yml to reactivate, or retire it to clean up.',
        },
      }),
    };
  }

  return { ok: true, embeddingName: target, entry: namedEntry, warnings: [] };
}

async function fetchCatalogEmbeddingEntries(instanceId: string): Promise<CatalogEmbeddingEntry[]> {
  const { data, error } = await supabaseManager.getClient()
    .from('fqc_embeddings')
    .select('name, dimensions, status')
    .eq('instance_id', instanceId);
  if (error) {
    throw new Error(`Error loading embedding catalog: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    name: String((row as { name: unknown }).name),
    dimensions: Number((row as { dimensions: unknown }).dimensions),
    status: ((row as { status: unknown }).status === 'deactivated' ? 'deactivated' : 'active') as 'active' | 'deactivated',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// registerPluginTools — registers register_plugin and get_plugin_info
// ─────────────────────────────────────────────────────────────────────────────

export function registerPluginTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool 1: register_plugin (PLUG-01, PLUG-03, PLUG-04) ─────────────────

  server.registerTool(
    'register_plugin',
    {
      description: 'Register or update a plugin from a YAML schema definition. Creates plugin tables in the database on first registration. On re-registration with a new schema version, automatically applies safe additive changes (new tables, new columns) and rejects unsafe changes (removed tables, removed columns, type changes) with specific guidance. Use this when setting up a new plugin or when a plugin\'s schema has been updated.',
      inputSchema: {
        ...registerPluginInputSchema,
      },
    },
    async ({ schema_path, schema_yaml, plugin_instance, embedding_name }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      try {
        // Step 1: resolve plugin_instance
        const instanceName = plugin_instance ?? 'default';
        validateInstanceName(instanceName);

        // Step 2: resolve YAML (D-06: schema_path takes precedence)
        let rawYaml: string;
        if (schema_path) {
          rawYaml = readFileSync(schema_path, 'utf-8');
        } else if (schema_yaml) {
          rawYaml = schema_yaml;
        } else {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'Either schema_path or schema_yaml must be provided',
            details: { field: 'schema_path|schema_yaml' },
          });
        }

        // Step 3: parse schema
        const schema = parsePluginSchema(rawYaml);
        const tablePrefix = `fqcp_${schema.plugin.id}_${instanceName}_`;
        const catalogEntries = await fetchCatalogEmbeddingEntries(config.instance.id);
        const embeddingResolution = resolvePluginEmbeddingChoice({
          manifestEmbedding: schema.embedding,
          overrideEmbeddingName: embedding_name,
          catalogEntries,
        });
        if (!embeddingResolution.ok) {
          return embeddingResolution.error;
        }
        const resolvedEmbedding = embeddingResolution.entry;

        // Step 4: check for existing registry entry
        const supabase = supabaseManager.getClient();
        const { data: existing, error: selectError } = await supabase
          .from('fqc_plugin_registry')
          .select('id, schema_version')
          .eq('plugin_id', schema.plugin.id)
          .eq('plugin_instance', instanceName)
          .eq('instance_id', config.instance.id)
          .maybeSingle();

        if (selectError) {
          return jsonRuntimeError(`Error checking registry: ${selectError.message}`);
        }

        // Step 5: handle version mismatch with auto-migration logic (SPEC-15)
        const existingSchemaVersion = typeof existing?.schema_version === 'string'
          ? existing.schema_version
          : undefined;

        if (existing && existingSchemaVersion !== undefined && existingSchemaVersion !== schema.plugin.version) {
          const versionComparison = compareSchemaVersions(existingSchemaVersion, schema.plugin.version);
          let safeChangeCount = 0;

          // Identical versions (should not happen, but idempotent check)
          if (versionComparison === 0) {
            return jsonToolResult({
              ...pluginIdentification({
                plugin_id: schema.plugin.id,
                name: schema.plugin.name,
                status: 'registered',
                table_count: schema.tables.length,
              }),
              registered_at: new Date().toISOString(),
              was_new: false,
              plugin_instance: instanceName,
              schema_version: schema.plugin.version,
            });
          }

          // Version upgrade (new > old) — attempt safe migration
          if (versionComparison < 0) {
            // Fetch old schema from registry for comparison
            const { data: registryData, error: registryError } = await supabase
              .from('fqc_plugin_registry')
              .select('schema_yaml')
              .eq('id', existing.id)
              .maybeSingle();

            if (registryError || !registryData) {
              return jsonRuntimeError(`Error fetching old schema for migration analysis: ${registryError?.message || 'Schema not found'}`);
            }

            // Parse old schema for comparison
            let oldSchema;
            try {
              oldSchema = parsePluginSchema(registryData.schema_yaml as string);
            } catch (err) {
              logger.warn(`register_plugin: failed to parse old schema for migration: ${err instanceof Error ? err.message : String(err)}`);
              return jsonRuntimeError(`Error analyzing schema migration: could not parse old schema. ${err instanceof Error ? err.message : String(err)}`);
            }

            // Analyze schema changes
            const { safe, unsafe } = analyzeSchemaChanges(oldSchema, schema);

            // Check for unsafe changes
            if (unsafe.length > 0) {
              const unsafeList = unsafe
                .map((c) => `- Table "${c.table}"${c.column ? `, column "${c.column}"` : ''}: ${c.type}`)
                .join('\n');

              return jsonExpectedError({
                error: 'conflict',
                message: `Schema migration failed: plugin "${schema.plugin.id}" contains breaking changes`,
                identifier: schema.plugin.id,
                details: {
                  from_version: existingSchemaVersion,
                  to_version: schema.plugin.version,
                  unsafe_changes: unsafe,
                  guidance: [
                    `unregister_plugin({ plugin_id: "${schema.plugin.id}", force: true })`,
                    'register_plugin again with the new schema',
                  ],
                  unsafe_summary: unsafeList,
                },
              });
            }

            // Apply safe changes and embedding DDL together. The registry must not
            // point at a resolved embedding before existing plugin tables can store it.
            if (safe.length > 0 || resolvedEmbedding) {
              const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
              let committed = false;
              try {
                await pgClient.connect();
                await pgClient.query('BEGIN');

                for (const change of safe) {
                  if (change.type === 'table_added') {
                    const newTable = schema.tables.find((t) => t.name === change.table);
                    if (newTable) {
                      const fullTableName = resolveTableName(schema.plugin.id, instanceName, newTable.name);
                      const ddl = buildPluginTableDDL(fullTableName, newTable, resolvedEmbedding);
                      await pgClient.query(ddl);
                      if (resolvedEmbedding && newTable.embed_fields && newTable.embed_fields.length > 0) {
                        await pgClient.query(buildPluginEmbeddingColumnSetDDL(fullTableName, resolvedEmbedding));
                      }
                    }
                  } else if (change.type === 'column_added') {
                    const table = schema.tables.find((t) => t.name === change.table);
                    if (table) {
                      const col = table.columns.find((c) => c.name === change.column);
                      if (col) {
                        const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
                        const nullabilityClause = col.required ? ' NOT NULL' : '';
                        // eslint-disable-next-line @typescript-eslint/no-base-to-string
                        const defaultClause = col.default !== undefined ? ` DEFAULT '${String(col.default)}'` : '';
                        const alterDDL = `ALTER TABLE "${fullTableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${defaultClause}${nullabilityClause}`;
                        await pgClient.query(alterDDL);
                      }
                    }
                  }
                }

                if (resolvedEmbedding) {
                  for (const table of schema.tables) {
                    if (!table.embed_fields || table.embed_fields.length === 0) continue;
                    const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
                    await pgClient.query(buildPluginEmbeddingColumnSetDDL(fullTableName, resolvedEmbedding));
                  }
                }

                await pgClient.query('COMMIT');
                committed = true;
                // Notify PostgREST to reload schema cache
                await pgClient.query(`SELECT pg_notify('pgrst', 'reload schema')`);
                await new Promise((resolve) => setTimeout(resolve, 300));
              } catch (err) {
                if (!committed) {
                  await pgClient.query('ROLLBACK').catch(() => undefined);
                }
                logger.error(`Failed to apply safe schema changes: ${err instanceof Error ? err.message : String(err)}`);
                return jsonRuntimeError(`Error applying safe schema changes: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                await pgClient.end();
              }

              safeChangeCount = safe.length;
              logger.info(`register_plugin: applied ${safe.length} safe schema change(s) for '${schema.plugin.id}'`);
            }
          } else {
            // Version downgrade (new < old) — not supported
            logger.warn(
              `register_plugin: plugin '${schema.plugin.id}' instance '${instanceName}' version downgrade detected (${existingSchemaVersion} → ${schema.plugin.version}). No DDL changes applied.`
            );
          }

          // Update registry with new version (after safe changes applied)
          await supabase
            .from('fqc_plugin_registry')
            .update({
              schema_version: schema.plugin.version,
              schema_yaml: rawYaml,
              embedding_name: embeddingResolution.embeddingName,
              embedding_resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          // Update in-memory entry
          pluginManager.loadEntry({
            plugin_id: schema.plugin.id,
            plugin_instance: instanceName,
            table_prefix: tablePrefix,
            schema,
            embedding_name: embeddingResolution.embeddingName,
          });

          // Phase 84: Rebuild global type registry after re-registration
          buildGlobalTypeRegistry();

          return jsonToolResult({
            ...pluginIdentification({
              plugin_id: schema.plugin.id,
              name: schema.plugin.name,
              status: 'registered',
              table_count: schema.tables.length,
            }),
            registered_at: new Date().toISOString(),
            was_new: false,
            schema_version: schema.plugin.version,
            safe_change_count: safeChangeCount,
            embedding_name: embeddingResolution.embeddingName,
          });
        }

        // Step 6: execute DDL for new plugin or same-version re-registration
        const createdTables: string[] = [];
        const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
        try {
          await pgClient.connect();
          await pgClient.query('BEGIN');
          for (const table of schema.tables) {
            const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
            const ddl = buildPluginTableDDL(fullTableName, table, resolvedEmbedding);
            await pgClient.query(ddl);
            if (resolvedEmbedding && table.embed_fields && table.embed_fields.length > 0) {
              await pgClient.query(buildPluginEmbeddingColumnSetDDL(fullTableName, resolvedEmbedding));
            }
            createdTables.push(table.name);
          }
          await pgClient.query('COMMIT');
          // Notify PostgREST to reload schema cache so new tables are immediately accessible.
          // Brief wait for PostgREST to process the async reload notification.
          await pgClient.query(`SELECT pg_notify('pgrst', 'reload schema')`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
          try {
            await pgClient.query('ROLLBACK');
          } catch {
            // no active transaction
          }
          await pgClient.end();
        }

        // Step 7: upsert registry row
        if (existing) {
          // Same version re-registration — update timestamp
          await supabase
            .from('fqc_plugin_registry')
            .update({
              schema_yaml: rawYaml,
              embedding_name: embeddingResolution.embeddingName,
              embedding_resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else {
          // New plugin — insert
          const { error: insertError } = await supabase.from('fqc_plugin_registry').insert({
            instance_id: config.instance.id,
            plugin_id: schema.plugin.id,
            plugin_instance: instanceName,
            schema_version: schema.plugin.version,
            schema_yaml: rawYaml,
            table_prefix: tablePrefix,
            embedding_name: embeddingResolution.embeddingName,
            embedding_resolved_at: new Date().toISOString(),
            status: 'active',
          });
          if (insertError) {
            logger.warn(`register_plugin: registry insert failed: ${insertError.message}`);
          }
        }

        // Step 8: load into pluginManager
        pluginManager.loadEntry({
          plugin_id: schema.plugin.id,
          plugin_instance: instanceName,
          table_prefix: tablePrefix,
          schema,
          embedding_name: embeddingResolution.embeddingName,
        });

        // Phase 84: Rebuild global type registry after registration
        buildGlobalTypeRegistry();

        // Phase 55: Rebuild manifest mappings after registration
        try {
          await reloadManifests(config);
        } catch (err: unknown) {
          logger.error(`Failed to reload manifests after registration: ${err instanceof Error ? err.message : String(err)}`);
          // Registration succeeded; manifest reload failure is non-blocking
        }

        logger.info(
          `register_plugin: registered '${schema.plugin.id}' instance '${instanceName}' — ${createdTables.length} table(s)`
        );

        return jsonToolResult(withWarnings({
          ...pluginIdentification({
            plugin_id: schema.plugin.id,
            name: schema.plugin.name,
            status: 'registered',
            table_count: schema.tables.length,
          }),
          registered_at: new Date().toISOString(),
          was_new: !existing,
          plugin_instance: instanceName,
          schema_version: schema.plugin.version,
          embedding_name: embeddingResolution.embeddingName,
        }, embeddingResolution.warnings));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`register_plugin failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 2: get_plugin_info (PLUG-02) ────────────────────────────────────

  server.registerTool(
    'get_plugin_info',
    {
      description: 'Get the schema definition, table status, version, and registration details for an installed plugin. Use this to check if a plugin is registered, inspect its table structure, or verify its current schema version.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        include: z.array(z.enum(['schema', 'tables', 'status_detail'])).optional().describe('Payload sections to include. Defaults to ["tables"].'),
      },
    },
    ({ plugin_id, plugin_instance, include }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      try {
        const instanceName = plugin_instance ?? 'default';
        const entry = pluginManager.getEntry(plugin_id, instanceName);

        if (!entry) {
          return jsonExpectedError({
            error: 'not_found',
            message: `Plugin '${plugin_id}' instance '${instanceName}' not found. Register it first with register_plugin.`,
            identifier: plugin_id,
            details: { plugin_instance: instanceName },
          });
        }

        const effectiveInclude = include ?? ['tables'];
        const payload: Record<string, unknown> = {
          ...pluginIdentification({
            plugin_id: entry.schema.plugin.id,
            name: entry.schema.plugin.name,
            status: 'registered',
            table_count: entry.schema.tables.length,
          }),
        };

        if (effectiveInclude.includes('tables')) {
          payload.tables = entry.schema.tables.map((table) => table.name);
        }
        if (effectiveInclude.includes('schema')) {
          payload.schema = entry.schema;
        }
        if (effectiveInclude.includes('status_detail')) {
          payload.status_detail = {
            plugin_instance: entry.plugin_instance,
            table_prefix: entry.table_prefix,
            version: entry.schema.plugin.version,
          };
        }

        return jsonToolResult(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_plugin_info failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 3: unregister_plugin (SPEC-16) ────────────────────────────────────

  server.registerTool(
    'unregister_plugin',
    {
      description:
        'Unregister a plugin registry entry. Without force, live records return a structured conflict. With force:true, plugin registry and pending-review state are removed while existing plugin table rows are left orphaned.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        force: z.boolean().optional().describe('When true, unregister even when live records exist; existing plugin table records are left orphaned.'),
      },
    },
    async ({ plugin_id, plugin_instance, force = false }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      try {
        const instanceName = plugin_instance ?? 'default';
        validateInstanceName(instanceName);

        // REQ-023 AC #5 / 157-RECONCILIATION-AUDIT.md: this per-plugin guard
        // serializes unregister calls but is not transactional; a mid-sequence
        // cleanup failure returns runtime_error and the caller should retry.
        return await withPluginCoordinationLock(config, { pluginId: plugin_id, pluginInstance: instanceName }, async () => {
        const supabase = supabaseManager.getClient();

        // Phase 1: Inventory (always runs)
        const { data: registryRow, error: selectError } = await supabase
          .from('fqc_plugin_registry')
          .select('id, schema_yaml')
          .eq('plugin_id', plugin_id)
          .eq('plugin_instance', instanceName)
          .eq('instance_id', config.instance.id)
          .maybeSingle();

        if (selectError) {
          return jsonRuntimeError(`Error checking registry: ${selectError.message}`);
        }

        if (!registryRow) {
          return jsonExpectedError({
            error: 'not_found',
            message: `Plugin '${plugin_id}' instance '${instanceName}' is not registered.`,
            identifier: plugin_id,
            details: { plugin_instance: instanceName },
          });
        }

        // Parse schema to get table names
        let tablesToDrop: string[] = [];
        let pluginName = plugin_id;
        try {
          const schema = parsePluginSchema(registryRow.schema_yaml as string);
          tablesToDrop = schema.tables.map((t) => resolveTableName(plugin_id, instanceName, t.name));
          pluginName = schema.plugin.name;
        } catch (err) {
          logger.warn(`unregister_plugin: failed to parse schema for ${plugin_id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Count affected records
        const tableStats: Array<{ table: string; count: number }> = [];
        const pgClient = createPgClientIPv4(config.supabase.databaseUrl);

        try {
          await pgClient.connect();

          // Check which tables exist and count rows
          for (const table of tablesToDrop) {
            try {
              const result = await pgClient.query(
                `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
                [table]
              );
              const tableExists = Number((result.rows[0] as { count?: unknown })?.count ?? 0) > 0;
              if (tableExists) {
                const countResult = await pgClient.query(`SELECT COUNT(*) as count FROM "${table}" WHERE instance_id = $1 AND status = 'active'`, [config.instance.id]);
                tableStats.push({
                  table,
                  count: Number((countResult.rows[0] as { count?: unknown })?.count ?? 0),
                });
              }
            } catch (err) {
              logger.debug(`Failed to check table ${table}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } finally {
          await pgClient.end();
        }

        const liveRecordCount = tableStats.reduce((sum, stat) => sum + stat.count, 0);
        if (liveRecordCount > 0 && !force) {
          return jsonExpectedError({
            error: 'conflict',
            message: `Plugin '${plugin_id}' has ${liveRecordCount} live record(s); pass force:true to unregister and leave records orphaned.`,
            identifier: plugin_id,
            details: { live_record_count: liveRecordCount },
          });
        }

        // Count affected documents
        const { count: docCount } = await supabase
          .from('fqc_documents')
          .select('*', { count: 'exact', head: true })
          .eq('ownership_plugin_id', plugin_id)
          .eq('instance_id', config.instance.id);

        // Count affected memories
        const { count: memCount } = await supabase
          .from('fqc_memory')
          .select('*', { count: 'exact', head: true })
          .eq('plugin_scope', plugin_id)
          .eq('instance_id', config.instance.id);

        // Clear document ownership
        const clearDocuments = await supabase
          .from('fqc_documents')
          .update({
            ownership_plugin_id: null,
            ownership_type: null,
            updated_at: new Date().toISOString(),
          })
          .eq('ownership_plugin_id', plugin_id)
          .eq('instance_id', config.instance.id) as { error: { message: string } | null };
        if (clearDocuments.error) {
          return jsonRuntimeError(`Failed to clear document ownership: ${clearDocuments.error.message}`);
        }

        // Delete plugin-scoped memories
        const deleteMemories = await supabase
          .from('fqc_memory')
          .delete()
          .eq('plugin_scope', plugin_id)
          .eq('instance_id', config.instance.id) as { error: { message: string } | null };
        if (deleteMemories.error) {
          return jsonRuntimeError(`Failed to delete plugin-scoped memories: ${deleteMemories.error.message}`);
        }

        // Delete pending plugin reviews before removing registry entry (D-10, RECTOOLS-08)
        const deleteReviews = await supabase
          .from('fqc_pending_plugin_review')
          .delete()
          .eq('plugin_id', plugin_id)
          .eq('instance_id', config.instance.id) as { error: { message: string } | null };
        if (deleteReviews.error) {
          return jsonRuntimeError(`Failed to delete pending plugin reviews: ${deleteReviews.error.message}`);
        }

        // Delete registry entry
        const deleteRegistry = await supabase
          .from('fqc_plugin_registry')
          .delete()
          .eq('plugin_id', plugin_id)
          .eq('plugin_instance', instanceName)
          .eq('instance_id', config.instance.id) as { error: { message: string } | null };
        if (deleteRegistry.error) {
          return jsonRuntimeError(`Failed to delete registry entry: ${deleteRegistry.error.message}`);
        }

        // Unload from PluginManager
        pluginManager.removeEntry(plugin_id, instanceName);

        // Phase 84: Rebuild global type registry after unregistration
        buildGlobalTypeRegistry();

        // Reload manifests
        try {
          await reloadManifests(config);
        } catch (err) {
          return jsonRuntimeError(`Failed to reload manifests: ${err instanceof Error ? err.message : String(err)}`);
        }

        return jsonToolResult(
          withWarnings(
            {
              ...pluginIdentification({
                plugin_id,
                name: pluginName,
                status: 'unregistered',
                table_count: tablesToDrop.length,
              }),
              plugin_instance: instanceName,
              unregistered_at: new Date().toISOString(),
              documents_ownership_cleared: docCount ?? 0,
              plugin_scoped_memories_deleted: memCount ?? 0,
            },
            liveRecordCount > 0 ? [`orphaned_records: ${liveRecordCount}`] : []
          )
        );
        });
      } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError({
            error: 'conflict',
            message: err.message,
            identifier: plugin_id,
            details: {
              reason: 'lock_timeout',
              timeout_seconds: err.timeoutSeconds,
              plugin_instance: plugin_instance ?? 'default',
            },
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`unregister_plugin failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );
}
