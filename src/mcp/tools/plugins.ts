import { z } from 'zod';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
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
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { formatKeyValueEntry } from '../utils/response-formats.js';

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
        schema_path: z.string().optional().describe('Path to YAML schema file on disk'),
        schema_yaml: z.string().optional().describe('Inline YAML schema string'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
      },
    },
    async ({ schema_path, schema_yaml, plugin_instance }) => {
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
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Either schema_path or schema_yaml must be provided.',
              },
            ],
            isError: true,
          };
        }

        // Step 3: parse schema
        const schema = parsePluginSchema(rawYaml);
        const tablePrefix = `fqcp_${schema.plugin.id}_${instanceName}_`;

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
          return {
            content: [
              { type: 'text' as const, text: `Error checking registry: ${selectError.message}` },
            ],
            isError: true,
          };
        }

        // Step 5: handle version mismatch with auto-migration logic (SPEC-15)
        if (existing && existing.schema_version !== schema.plugin.version) {
          const versionComparison = compareSchemaVersions(existing.schema_version, schema.plugin.version);
          let safeChangeCount = 0;

          // Identical versions (should not happen, but idempotent check)
          if (versionComparison === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Plugin '${schema.plugin.id}' already registered with schema version ${schema.plugin.version}. No changes applied.`,
                },
              ],
            };
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
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Error fetching old schema for migration analysis: ${registryError?.message || 'Schema not found'}`,
                  },
                ],
                isError: true,
              };
            }

            // Parse old schema for comparison
            let oldSchema;
            try {
              oldSchema = parsePluginSchema(registryData.schema_yaml);
            } catch (err) {
              logger.warn(`register_plugin: failed to parse old schema for migration: ${err instanceof Error ? err.message : String(err)}`);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Error analyzing schema migration: could not parse old schema. ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                isError: true,
              };
            }

            // Analyze schema changes
            const { safe, unsafe } = analyzeSchemaChanges(oldSchema, schema);

            // Check for unsafe changes
            if (unsafe.length > 0) {
              const unsafeList = unsafe
                .map((c) => `- Table "${c.table}"${c.column ? `, column "${c.column}"` : ''}: ${c.type}`)
                .join('\n');

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Schema migration failed: plugin "${schema.plugin.id}" version ${existing.schema_version} → ${schema.plugin.version} contains breaking changes.\n\nUnsafe changes detected:\n${unsafeList}\n\nTo apply breaking changes, use:\n1. unregister_plugin({ plugin_id: "${schema.plugin.id}", confirm_destroy: true })\n2. Then register_plugin again with the new schema.`,
                  },
                ],
                isError: true,
              };
            }

            // Apply safe changes via DDL
            if (safe.length > 0) {
              const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
              try {
                await pgClient.connect();

                for (const change of safe) {
                  if (change.type === 'table_added') {
                    const newTable = schema.tables.find((t) => t.name === change.table);
                    if (newTable) {
                      const fullTableName = resolveTableName(schema.plugin.id, instanceName, newTable.name);
                      const ddl = buildPluginTableDDL(fullTableName, newTable, config.embedding.dimensions);
                      await pgClient.query(ddl);
                    }
                  } else if (change.type === 'column_added') {
                    const table = schema.tables.find((t) => t.name === change.table);
                    if (table) {
                      const col = table.columns.find((c) => c.name === change.column);
                      if (col) {
                        const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
                        const nullabilityClause = col.required ? ' NOT NULL' : '';
                        const defaultClause = col.default !== undefined ? ` DEFAULT '${col.default}'` : '';
                        const alterDDL = `ALTER TABLE "${fullTableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${defaultClause}${nullabilityClause}`;
                        await pgClient.query(alterDDL);
                      }
                    }
                  }
                }

                // Notify PostgREST to reload schema cache
                await pgClient.query(`SELECT pg_notify('pgrst', 'reload schema')`);
                await new Promise((resolve) => setTimeout(resolve, 300));
              } catch (err) {
                logger.error(`Failed to apply safe schema changes: ${err instanceof Error ? err.message : String(err)}`);
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Error applying safe schema changes: ${err instanceof Error ? err.message : String(err)}`,
                    },
                  ],
                  isError: true,
                };
              } finally {
                await pgClient.end();
              }

              safeChangeCount = safe.length;
              logger.info(`register_plugin: applied ${safe.length} safe schema change(s) for '${schema.plugin.id}'`);
            }
          } else {
            // Version downgrade (new < old) — not supported
            logger.warn(
              `register_plugin: plugin '${schema.plugin.id}' instance '${instanceName}' version downgrade detected (${existing.schema_version} → ${schema.plugin.version}). No DDL changes applied.`
            );
          }

          // Update registry with new version (after safe changes applied)
          await supabase
            .from('fqc_plugin_registry')
            .update({
              schema_version: schema.plugin.version,
              schema_yaml: rawYaml,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          // Update in-memory entry
          pluginManager.loadEntry({
            plugin_id: schema.plugin.id,
            plugin_instance: instanceName,
            table_prefix: tablePrefix,
            schema,
          });

          // Phase 84: Rebuild global type registry after re-registration
          buildGlobalTypeRegistry();

          return {
            content: [
              {
                type: 'text' as const,
                text: `Plugin '${schema.plugin.id}' schema updated from ${existing.schema_version} to ${schema.plugin.version}. Applied ${safeChangeCount} safe change(s).`,
              },
            ],
          };
        }

        // Step 6: execute DDL for new plugin or same-version re-registration
        const createdTables: string[] = [];
        const pgClient = createPgClientIPv4(config.supabase.databaseUrl);
        try {
          await pgClient.connect();
          for (const table of schema.tables) {
            const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
            const ddl = buildPluginTableDDL(fullTableName, table, config.embedding.dimensions);
            await pgClient.query(ddl);
            createdTables.push(fullTableName);
          }
          // Notify PostgREST to reload schema cache so new tables are immediately accessible.
          // Brief wait for PostgREST to process the async reload notification.
          await pgClient.query(`SELECT pg_notify('pgrst', 'reload schema')`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
          await pgClient.end();
        }

        // Step 7: upsert registry row
        if (existing) {
          // Same version re-registration — update timestamp
          await supabase
            .from('fqc_plugin_registry')
            .update({
              schema_yaml: rawYaml,
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

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Plugin '${schema.plugin.id}' (${schema.plugin.name}) registered successfully. Manifest mappings updated.`,
                `Instance: ${instanceName}`,
                `Version: ${schema.plugin.version}`,
                `Tables created: ${createdTables.join(', ')}`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`register_plugin failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
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
      },
    },
    ({ plugin_id, plugin_instance }) => {
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
        const instanceName = plugin_instance ?? 'default';
        const entry = pluginManager.getEntry(plugin_id, instanceName);

        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Plugin '${plugin_id}' instance '${instanceName}' not found. Register it first with register_plugin.`,
              },
            ],
            isError: true,
          };
        }

        const tableLines = entry.schema.tables.map((t) => {
          const fullTable = `${entry.table_prefix}${t.name}`;
          const cols = t.columns
            .map(
              (c) =>
                `    - ${c.name} (${c.type})${c.required ? ' NOT NULL' : ''}${c.default !== undefined ? ` DEFAULT ${JSON.stringify(c.default)}` : ''}${c.description ? ` — ${c.description}` : ''}`
            )
            .join('\n');
          const embedInfo =
            t.embed_fields && t.embed_fields.length > 0
              ? `\n  embed_fields: ${t.embed_fields.join(', ')}`
              : '';
          return `- ${fullTable}${embedInfo}\n  columns:\n${cols}`;
        });

        const responseText = [
          `Plugin: ${entry.schema.plugin.name} (${entry.schema.plugin.id})`,
          `Version: ${entry.schema.plugin.version}`,
          `Instance: ${entry.plugin_instance}`,
          `Table prefix: ${entry.table_prefix}`,
          ``,
          `Tables:`,
          tableLines.join('\n'),
        ].join('\n');

        return { content: [{ type: 'text' as const, text: responseText }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_plugin_info failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 3: unregister_plugin (SPEC-16) ────────────────────────────────────

  server.registerTool(
    'unregister_plugin',
    {
      description:
        'Unregister a plugin and tear down its database resources. Call without confirm_destroy to preview what will be removed (dry run showing table record counts, document ownership, and memory counts). Call with confirm_destroy: true to execute the teardown: drops plugin tables, clears document ownership claims, deletes plugin-scoped memories, and removes the registry entry. Vault files are never deleted. Use this when removing a plugin, resetting plugin data for testing, or before re-registering a plugin after breaking schema changes.' +
        'dry-run (always shows what will happen) and confirmed teardown (only with confirm_destroy: true). ' +
        'Plugin tables are dropped, document ownership is cleared, and watcher claims are removed. ' +
        'Vault files are not deleted.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().describe('Plugin instance identifier. Omit for single-instance plugins.'),
        confirm_destroy: z.boolean().optional().describe('Must be true to execute teardown. Omit or false for dry-run only.'),
      },
    },
    async ({ plugin_id, plugin_instance, confirm_destroy = false }) => {
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
          'plugins',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is managing plugins. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }

      try {
        const instanceName = plugin_instance ?? 'default';
        validateInstanceName(instanceName);

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
          return {
            content: [{ type: 'text' as const, text: `Error checking registry: ${selectError.message}` }],
            isError: true,
          };
        }

        if (!registryRow) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Plugin '${plugin_id}' instance '${instanceName}' is not registered.`,
              },
            ],
            isError: true,
          };
        }

        // Parse schema to get table names
        let tablesToDrop: string[] = [];
        try {
          const schema = parsePluginSchema(registryRow.schema_yaml);
          tablesToDrop = schema.tables.map((t) => resolveTableName(plugin_id, instanceName, t.name));
        } catch (err) {
          logger.warn(`unregister_plugin: failed to parse schema for ${plugin_id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Count affected records
        let tableStats: Array<{ table: string; count: number }> = [];
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
              const tableExists = (result.rows[0]?.count ?? 0) > 0;
              if (tableExists) {
                const countResult = await pgClient.query(
                  `SELECT COUNT(*) as count FROM "${table}" WHERE status = 'active'`
                );
                tableStats.push({
                  table,
                  count: Number(countResult.rows[0]?.count ?? 0),
                });
              }
            } catch (err) {
              logger.debug(`Failed to check table ${table}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } finally {
          await pgClient.end();
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

        // Count watcher claims (JSONB ? operator)
        const { count: claimsCount } = await supabase
          .from('fqc_documents')
          .select('*', { count: 'exact', head: true })
          .filter('watcher_claims', 'cs', `{"${plugin_id}":`)
          .eq('instance_id', config.instance.id);

        // Build dry-run response
        const dryRunLines: string[] = [
          `Unregister plugin '${plugin_id}' instance '${instanceName}' — DRY RUN`,
          '',
          'Tables to drop:',
        ];

        for (const stat of tableStats) {
          dryRunLines.push(`  ${stat.table} — ${stat.count} active records`);
        }

        dryRunLines.push('', 'Other changes:');
        dryRunLines.push(`  ${docCount ?? 0} documents will have ownership cleared (files remain in vault)`);
        dryRunLines.push(`  ${memCount ?? 0} plugin-scoped memories will be deleted`);
        dryRunLines.push(`  ${claimsCount ?? 0} documents will have watcher claims for this plugin removed`);
        dryRunLines.push('', 'Registry entry will be deleted.');
        dryRunLines.push('In-memory plugin entry will be unloaded.');
        dryRunLines.push('Manifest folder mappings will be cleared.');

        if (!confirm_destroy) {
          dryRunLines.push('', 'To execute: call unregister_plugin with confirm_destroy: true');
          return { content: [{ type: 'text' as const, text: dryRunLines.join('\n') }] };
        }

        // Phase 2: Teardown (only if confirm_destroy: true)
        const pgClient2 = createPgClientIPv4(config.supabase.databaseUrl);
        const teardownLines: string[] = [
          `Plugin '${plugin_id}' instance '${instanceName}' has been unregistered.`,
          '',
          'Tables dropped:',
        ];

        try {
          await pgClient2.connect();

          // Drop tables
          for (const table of tablesToDrop) {
            try {
              await pgClient2.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
              const stat = tableStats.find((s) => s.table === table);
              if (stat) {
                teardownLines.push(`  ${table} — ${stat.count} records removed`);
              } else {
                teardownLines.push(`  ${table} — already dropped or not found`);
              }
            } catch (err) {
              logger.error(`Failed to drop table ${table}: ${err instanceof Error ? err.message : String(err)}`);
              teardownLines.push(`  ${table} — ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // Notify PostgREST to reload schema cache
          await pgClient2.query(`SELECT pg_notify('pgrst', 'reload schema')`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
          await pgClient2.end();
        }

        // Clear document ownership
        try {
          await supabase
            .from('fqc_documents')
            .update({
              ownership_plugin_id: null,
              ownership_type: null,
              discovery_status: 'pending',
              needs_discovery: true,
              updated_at: new Date().toISOString(),
            })
            .eq('ownership_plugin_id', plugin_id)
            .eq('instance_id', config.instance.id);
        } catch (err) {
          logger.error(`Failed to clear document ownership: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Clear watcher claims (JSONB minus operator)
        try {
          await supabase.rpc('clear_plugin_watcher_claims', {
            plugin_id_param: plugin_id,
            instance_id_param: config.instance.id,
          });
        } catch (err) {
          logger.warn(`Failed to clear watcher claims via RPC, attempting direct update: ${err instanceof Error ? err.message : String(err)}`);
          // Fallback: manual update
          try {
            const { data: rows } = await supabase
              .from('fqc_documents')
              .select('id, watcher_claims')
              .filter('watcher_claims', 'cs', `{"${plugin_id}":`)
              .eq('instance_id', config.instance.id);

            if (rows) {
              for (const row of rows) {
                const claims = row.watcher_claims as Record<string, unknown>;
                if (claims && plugin_id in claims) {
                  delete claims[plugin_id];
                  await supabase
                    .from('fqc_documents')
                    .update({ watcher_claims: claims, updated_at: new Date().toISOString() })
                    .eq('id', row.id);
                }
              }
            }
          } catch (fallbackErr) {
            logger.error(`Watcher claims cleanup failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
          }
        }

        // Delete plugin-scoped memories
        try {
          await supabase
            .from('fqc_memory')
            .delete()
            .eq('plugin_scope', plugin_id)
            .eq('instance_id', config.instance.id);
        } catch (err) {
          logger.error(`Failed to delete plugin-scoped memories: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Delete pending plugin reviews before removing registry entry (D-10, RECTOOLS-08)
        try {
          await supabase
            .from('fqc_pending_plugin_review')
            .delete()
            .eq('plugin_id', plugin_id)
            .eq('instance_id', instanceName);
        } catch (err) {
          logger.error(`Failed to delete pending plugin reviews: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Delete registry entry
        try {
          await supabase
            .from('fqc_plugin_registry')
            .delete()
            .eq('plugin_id', plugin_id)
            .eq('plugin_instance', instanceName)
            .eq('instance_id', config.instance.id);
        } catch (err) {
          logger.error(`Failed to delete registry entry: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Unload from PluginManager
        pluginManager.removeEntry(plugin_id, instanceName);

        // Phase 84: Rebuild global type registry after unregistration
        buildGlobalTypeRegistry();

        // Reload manifests
        try {
          await reloadManifests(config);
        } catch (err) {
          logger.error(`Failed to reload manifests: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Build final response
        teardownLines.push('', 'Other changes:');
        teardownLines.push(`  ${docCount ?? 0} documents — ownership cleared (files remain in vault, marked for re-discovery)`);
        teardownLines.push(`  ${memCount ?? 0} plugin-scoped memories deleted`);
        teardownLines.push(`  ${claimsCount ?? 0} documents — watcher claims for this plugin removed`);
        teardownLines.push('  Registry entry deleted');
        teardownLines.push('  In-memory plugin entry unloaded');
        teardownLines.push('  Manifest folder mappings cleared');

        return { content: [{ type: 'text' as const, text: teardownLines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`unregister_plugin failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'plugins');
        }
      }
    }
  );
}
