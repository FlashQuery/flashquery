import pg from 'pg';
import * as yaml from 'js-yaml';
import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginColumnSpec {
  name: string;
  type: 'text' | 'integer' | 'boolean' | 'uuid' | 'timestamptz';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface PluginTableSpec {
  name: string;
  description?: string;
  embed_fields?: string[];
  columns: PluginColumnSpec[];
}

export interface DocumentTypePolicy {
  id: string;
  folder: string;
  description?: string;
  access: 'read-write' | 'read-only';
  on_added: 'auto-track' | 'ignore';
  on_moved: 'keep-tracking' | 'stop-tracking' | 'untrack';
  on_modified: 'sync-fields' | 'ignore';
  track_as?: string;
  template?: string;
  field_map?: Record<string, string>;
}

export interface TypeRegistryEntry {
  pluginId: string;
  instanceId: string;
  policy: DocumentTypePolicy;
}

export interface ParsedPluginSchema {
  plugin: { id: string; name: string; version: string; description?: string };
  tables: PluginTableSpec[];
  documents?: {
    types: DocumentTypePolicy[];
  };
}

export interface RegistryEntry {
  plugin_id: string;
  plugin_instance: string;
  table_prefix: string; // "fqcp_{plugin_id}_{plugin_instance}_"
  schema: ParsedPluginSchema;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['text', 'integer', 'boolean', 'uuid', 'timestamptz']);

const VALID_ON_MOVED = new Set(['keep-tracking', 'stop-tracking', 'untrack']);

const TYPE_MAP: Record<string, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  uuid: 'UUID',
  timestamptz: 'TIMESTAMPTZ',
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9_]+$/;

export function validatePluginId(id: string): void {
  if (!id || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid plugin_id '${id}'. Must match /^[a-z0-9_]+$/`);
  }
}

export function validateInstanceName(name: string): void {
  if (!name || !ID_PATTERN.test(name)) {
    throw new Error(`Invalid plugin_instance '${name}'. Must match /^[a-z0-9_]+$/`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTableName
// ─────────────────────────────────────────────────────────────────────────────

export function resolveTableName(
  pluginId: string,
  instanceName: string,
  tableName: string
): string {
  return `fqcp_${pluginId}_${instanceName}_${tableName}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// parsePluginSchema
// ─────────────────────────────────────────────────────────────────────────────

export function parsePluginSchema(yamlString: string): ParsedPluginSchema {
  const raw = yaml.load(yamlString) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid plugin YAML: must be an object');
  }

  // D-01: Accept both formats:
  // Format A (nested): { plugin: { id, name, version }, tables: [...] }
  // Format B (flat): { id, name, version, tables: [...] }
  let plugin: Record<string, unknown>;
  let tablesSource: Record<string, unknown>;

  if (raw.plugin && typeof raw.plugin === 'object') {
    // Format A: nested under plugin block
    plugin = raw.plugin as Record<string, unknown>;
    tablesSource = raw; // tables at root level
  } else if (raw.id && typeof raw.id === 'string') {
    // Format B: flat structure with id at root
    plugin = raw; // treat entire root as plugin config
    tablesSource = raw; // tables also at root level
  } else {
    throw new Error('Invalid plugin YAML: missing "id" field. Expected either plugin.id or root-level id field.');
  }

  const pluginId =
    typeof plugin.id === 'string'
      ? plugin.id
      : ((plugin.id as string | number | boolean | null | undefined) ?? '') + '';
  validatePluginId(pluginId);

  const pluginName =
    typeof plugin.name === 'string'
      ? plugin.name
      : ((plugin.name as string | number | boolean | null | undefined) ?? '') + '';

  // D-02: Parse version as string first, fall back to Number if already numeric
  const versionValue = plugin.version ?? '1.0.0';
  const pluginVersion = typeof versionValue === 'string' ? versionValue : String(versionValue);

  const pluginDescription =
    plugin.description !== undefined
      ? `${plugin.description as string | number | boolean}`
      : undefined;

  const rawTables = (tablesSource.tables ?? []) as Array<Record<string, unknown>>;
  const tables: PluginTableSpec[] = rawTables.map((t) => {
    const tableName =
      typeof t.name === 'string'
        ? t.name
        : ((t.name as string | number | boolean | null | undefined) ?? '') + '';
    const tableDescription =
      t.description !== undefined ? `${t.description as string | number | boolean}` : undefined;
    const embedFields = t.embed_fields as string[] | undefined;

    const rawColumns = (t.columns ?? []) as Array<Record<string, unknown>>;
    const columns: PluginColumnSpec[] = rawColumns.map((col) => {
      const colName =
        typeof col.name === 'string'
          ? col.name
          : ((col.name as string | number | boolean | null | undefined) ?? '') + '';
      const colType =
        typeof col.type === 'string'
          ? col.type
          : ((col.type as string | number | boolean | null | undefined) ?? '') + '';

      if (!VALID_TYPES.has(colType)) {
        throw new Error(
          `Invalid column type '${colType}' for column '${colName}' in table '${tableName}'. ` +
            `Supported types: ${Array.from(VALID_TYPES).join(', ')}`
        );
      }

      return {
        name: colName,
        type: colType as PluginColumnSpec['type'],
        required: col.required === true,
        default: col.default,
        description:
          col.description !== undefined
            ? `${col.description as string | number | boolean}`
            : undefined,
      };
    });

    // Validate embed_fields reference known column names
    if (embedFields && embedFields.length > 0) {
      const colNames = new Set(columns.map((c) => c.name));
      for (const field of embedFields) {
        if (!colNames.has(field)) {
          throw new Error(
            `embed_fields references unknown column '${field}' in table '${tableName}'`
          );
        }
      }
    }

    return {
      name: tableName,
      description: tableDescription,
      embed_fields: embedFields,
      columns,
    };
  });

  // Extract documents section (Phase 54 plugin folder claims)
  const rawDocuments = (tablesSource.documents ?? {}) as Record<string, unknown>;
  const rawTypes = (rawDocuments.types ?? []) as Array<Record<string, unknown>>;
  const tableNames = new Set(tables.map((t) => t.name));
  const documentTypes = rawTypes.map((t) => {
    const typeId = typeof t.id === 'string' ? t.id : '';
    const folder = typeof t.folder === 'string' ? t.folder : '';
    const desc = typeof t.description === 'string' ? t.description : undefined;
    if (!typeId || !folder) {
      logger.warn(
        `Plugin ${pluginId}: documents.types entry missing id or folder (id='${typeId}', folder='${folder}') — skipping`
      );
    }

    // Extract 7 policy fields with conservative defaults (D-08)
    const access = (typeof t.access === 'string' ? t.access : undefined) ?? 'read-write';
    const on_added = (typeof t.on_added === 'string' ? t.on_added : undefined) ?? 'ignore';
    const rawOnMoved = typeof t.on_moved === 'string' ? t.on_moved : undefined;
    if (rawOnMoved !== undefined && !VALID_ON_MOVED.has(rawOnMoved)) {
      throw new Error(
        `Plugin ${pluginId}: document type '${typeId}' has invalid on_moved value '${rawOnMoved}'. ` +
        `Valid values: ${Array.from(VALID_ON_MOVED).join(', ')}`,
      );
    }
    const on_moved = rawOnMoved ?? 'keep-tracking';
    const on_modified = (typeof t.on_modified === 'string' ? t.on_modified : undefined) ?? 'ignore';
    const track_as = typeof t.track_as === 'string' && t.track_as ? t.track_as : undefined;
    const template = typeof t.template === 'string' && t.template ? t.template : undefined;
    const field_map =
      t.field_map && typeof t.field_map === 'object'
        ? (t.field_map as Record<string, string>)
        : undefined;

    // D-05: on_added: auto-track requires track_as (check first)
    if (on_added === 'auto-track' && !track_as) {
      throw new Error(
        `Plugin ${pluginId}: document type '${typeId}' has on_added: auto-track but no track_as — add track_as pointing to a table in this schema`
      );
    }
    // D-06: track_as must match a table name in this schema (check second)
    if (track_as && !tableNames.has(track_as)) {
      throw new Error(
        `Plugin ${pluginId}: document type '${typeId}' has track_as: '${track_as}' but no table with that name exists in this schema`
      );
    }
    // D-07: field_map column targets that don't exist log warning only — deferred to runtime
    if (field_map && track_as) {
      const trackAsSpec = tables.find((tbl) => tbl.name === track_as);
      if (trackAsSpec) {
        const colNames = new Set(trackAsSpec.columns.map((c) => c.name));
        for (const [, colName] of Object.entries(field_map)) {
          if (!colNames.has(colName)) {
            logger.warn(
              `Plugin ${pluginId}: document type '${typeId}' field_map target column '${colName}' not found in table '${track_as}' — will be skipped at runtime`
            );
          }
        }
      }
    }

    return {
      id: typeId,
      folder,
      description: desc,
      access: access as DocumentTypePolicy['access'],
      on_added: on_added as DocumentTypePolicy['on_added'],
      on_moved: on_moved as DocumentTypePolicy['on_moved'],
      on_modified: on_modified as DocumentTypePolicy['on_modified'],
      track_as,
      template,
      field_map,
    };
  });

  const documents = documentTypes.length > 0 ? { types: documentTypes } : undefined;

  return {
    plugin: {
      id: pluginId,
      name: pluginName,
      version: pluginVersion,
      description: pluginDescription,
    },
    tables,
    documents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// formatDefault — render DEFAULT value safely
// ─────────────────────────────────────────────────────────────────────────────

function formatDefault(value: unknown, type: string): string {
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`Invalid integer default value: ${JSON.stringify(value)}`);
    }
    return String(value);
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid boolean default value: ${JSON.stringify(value)}`);
    }
    return value ? 'TRUE' : 'FALSE';
  }
  // text, uuid, timestamptz — use pg.escapeLiteral
  return pg.escapeLiteral(String(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPluginTableDDL
// ─────────────────────────────────────────────────────────────────────────────

export function buildPluginTableDDL(
  tableName: string,
  tableSpec: PluginTableSpec,
  dimensions: number
): string {
  const escapedTable = pg.escapeIdentifier(tableName);

  // Implicit columns (D-04)
  // fqc_id and path are required by the reconciliation engine (plugin-reconciliation.ts).
  // Reconciliation INSERTs (fqc_id, status, path, last_seen_updated_at) into plugin tables
  // when auto-tracking documents, and SELECTs these same columns when reading plugin rows.
  const implicitCols = [
    `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
    `fqc_id UUID REFERENCES fqc_documents(id)`,
    `instance_id TEXT NOT NULL`,
    `path TEXT`,
    `status TEXT DEFAULT 'active'`,
    `created_at TIMESTAMPTZ DEFAULT now()`,
    `updated_at TIMESTAMPTZ DEFAULT now()`,
    `last_seen_updated_at TIMESTAMPTZ`,
  ];

  // User-defined columns
  const userCols: string[] = tableSpec.columns.map((col) => {
    const escapedCol = pg.escapeIdentifier(col.name);
    const sqlType = TYPE_MAP[col.type];
    let colDef = `${escapedCol} ${sqlType}`;
    if (col.required) colDef += ' NOT NULL';
    if (col.default !== undefined && col.default !== null) {
      colDef += ` DEFAULT ${formatDefault(col.default, col.type)}`;
    }
    return colDef;
  });

  // PIR-03: De-duplicate implicit columns whose names collide with user-defined columns.
  // Plugin schemas may explicitly declare implicit columns (e.g. fqc_id per §8.4.7).
  // Without de-duplication, buildPluginTableDDL emits the column twice and Postgres
  // rejects the DDL with "column X specified more than once".
  // Strategy: extract the bare column name (first whitespace-separated token) from each
  // implicit column definition, and drop any implicit column whose name appears in the
  // user-defined column set.
  const userColNames = new Set(tableSpec.columns.map((c) => c.name.toLowerCase()));
  const filteredImplicitCols = implicitCols.filter((def) => {
    const bareName = def.split(/\s+/)[0]!.toLowerCase();
    return !userColNames.has(bareName);
  });

  // Embedding columns (D-05) — only when embed_fields present
  const embeddingCols: string[] = [];
  if (tableSpec.embed_fields && tableSpec.embed_fields.length > 0) {
    embeddingCols.push(`embedding vector(${dimensions})`);
    embeddingCols.push(`embedding_updated_at TIMESTAMPTZ`);
  }

  const allCols = [...filteredImplicitCols, ...userCols, ...embeddingCols];

  return `CREATE TABLE IF NOT EXISTS ${escapedTable} (\n  ${allCols.join(',\n  ')}\n);`;
}

// ─────────────────────────────────────────────────────────────────────────────
// getFolderClaimsMap — build map of folder paths to plugin claims
// ─────────────────────────────────────────────────────────────────────────────

export function getFolderClaimsMap(
  config: FlashQueryConfig
): Map<string, { pluginId: string; typeId: string }> {
  try {
    // Get all plugin entries from the global singleton
    const entries = pluginManager?.getAllEntries() ?? [];
    const folderMap = new Map<string, { pluginId: string; typeId: string }>();

    for (const entry of entries) {
      const schema = entry.schema;
      if (!schema.documents?.types) continue;

      for (const docType of schema.documents.types) {
        // Normalize folder path to lowercase for case-insensitive matching
        const normalizedFolder = docType.folder.toLowerCase();
        folderMap.set(normalizedFolder, {
          pluginId: entry.plugin_id,
          typeId: docType.id,
        });
      }
    }

    return folderMap;
  } catch (err: unknown) {
    // Graceful degradation: return empty map if anything fails
    logger.warn(
      `getFolderClaimsMap: failed to build map — ${err instanceof Error ? err.message : String(err)}`
    );
    return new Map();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PluginManager class
// ─────────────────────────────────────────────────────────────────────────────

export class PluginManager {
  private registry: Map<string, RegistryEntry> = new Map();

  getEntry(pluginId: string, instanceName: string): RegistryEntry | undefined {
    return this.registry.get(`${pluginId}::${instanceName}`);
  }

  loadEntry(entry: RegistryEntry): void {
    this.registry.set(`${entry.plugin_id}::${entry.plugin_instance}`, entry);
  }

  getAllEntries(): RegistryEntry[] {
    return Array.from(this.registry.values());
  }

  getTableSpec(
    pluginId: string,
    instanceName: string,
    tableName: string
  ): { tableSpec: PluginTableSpec; entry: RegistryEntry } | undefined {
    const entry = this.getEntry(pluginId, instanceName);
    if (!entry) return undefined;
    const tableSpec = entry.schema.tables.find((t) => t.name === tableName);
    if (!tableSpec) return undefined;
    return { tableSpec, entry };
  }

  removeEntry(pluginId: string, instanceName: string): boolean {
    return this.registry.delete(`${pluginId}::${instanceName}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton
// ─────────────────────────────────────────────────────────────────────────────

export let pluginManager: PluginManager = new PluginManager();

export let globalTypeRegistry: Map<string, TypeRegistryEntry> = new Map();

/**
 * Returns the live global type registry map.
 * Callers should invoke this at the time of use — do not cache the reference
 * across buildGlobalTypeRegistry() calls, as the map reference is replaced on rebuild.
 */
export function getTypeRegistryMap(): Map<string, TypeRegistryEntry> {
  return globalTypeRegistry;
}

/**
 * Rebuilds the global type registry from all currently loaded plugin entries.
 * Full rebuild on every call (not incremental). Collision on same type ID: first
 * registration wins; subsequent registrations log a warning and are skipped.
 */
export function buildGlobalTypeRegistry(): void {
  const newMap = new Map<string, TypeRegistryEntry>();
  for (const entry of pluginManager.getAllEntries()) {
    if (!entry.schema.documents?.types) continue;
    for (const policy of entry.schema.documents.types) {
      if (newMap.has(policy.id)) {
        logger.warn(
          `Plugin ${entry.plugin_id}: document type '${policy.id}' already registered by another plugin — first registration wins, skipping`
        );
        continue;
      }
      newMap.set(policy.id, {
        pluginId: entry.plugin_id,
        instanceId: entry.plugin_instance,
        policy,
      });
    }
  }
  globalTypeRegistry = newMap;
}

export async function initPlugins(config: FlashQueryConfig): Promise<void> {
  const manager = new PluginManager();
  const supabase = supabaseManager.getClient();

  const registryResult = (await supabase
    .from('fqc_plugin_registry')
    .select('plugin_id, plugin_instance, table_prefix, schema_yaml')
    .eq('status', 'active')
    .eq('instance_id', config.instance.id)) as {
    data: Array<{
      plugin_id: string;
      plugin_instance: string;
      table_prefix: string;
      schema_yaml: string;
    }> | null;
    error: { message: string } | null;
  };
  const { data, error } = registryResult;

  if (error) {
    logger.warn(
      `initPlugins: registry load failed (${error.message}) — starting with empty registry`
    );
    pluginManager = manager;
    buildGlobalTypeRegistry();
    return;
  }

  for (const row of data ?? []) {
    const schema = parsePluginSchema(row.schema_yaml);
    manager.loadEntry({
      plugin_id: row.plugin_id,
      plugin_instance: row.plugin_instance ?? 'default',
      table_prefix: row.table_prefix,
      schema,
    });
  }

  pluginManager = manager;
  buildGlobalTypeRegistry();
  logger.info(`Plugins: loaded ${data?.length ?? 0} active plugin instance(s)`);
}
