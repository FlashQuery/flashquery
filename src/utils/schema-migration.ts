/**
 * Schema migration utilities for plugin version comparison and safe/unsafe change detection.
 *
 * Handles semantic versioning comparison and analyzes schema differences to categorize
 * changes as safe (can be applied automatically) or unsafe (require explicit unregistration).
 */

import type { ParsedPluginSchema, PluginTableSpec, PluginColumnSpec } from '../plugins/manager.js';

/**
 * Represents a single schema change (addition, removal, or modification).
 * Used in migration analysis to categorize changes as safe or unsafe.
 */
export interface SchemaChange {
  /** Type of schema change detected */
  type: 'table_added' | 'column_added' | 'table_removed' | 'column_removed' | 'type_changed' | 'nullability_changed';
  /** Table name affected by this change */
  table: string;
  /** Column name (when applicable, e.g., for column changes) */
  column?: string;
  /** Previous value (for type/nullability changes) */
  oldValue?: string;
  /** New value (for type/nullability changes) */
  newValue?: string;
}

/**
 * Compares two semantic versions and returns their relationship.
 *
 * Parses versions in major.minor.patch format, comparing each component as integers.
 * Handles missing patch versions (e.g., "1.0" is equivalent to "1.0.0").
 *
 * @param oldVersion - The old version string (e.g., "1.0.0")
 * @param newVersion - The new version string (e.g., "1.1.0")
 * @returns -1 if old < new, 0 if equal, 1 if old > new
 *
 * @example
 * compareSchemaVersions("1.0.0", "1.1.0") // -1 (old < new)
 * compareSchemaVersions("1.10.0", "1.2.0") // 1 (old > new, integer comparison)
 * compareSchemaVersions("1.0", "1.0.0") // 0 (equivalent)
 */
export function compareSchemaVersions(oldVersion: string, newVersion: string): -1 | 0 | 1 {
  const parseVersion = (v: string): [number, number, number] => {
    const parts = v.split('.');
    const major = Number(parts[0]) || 0;
    const minor = Number(parts[1]) || 0;
    const patch = Number(parts[2]) || 0;
    return [major, minor, patch];
  };

  const [oldMaj, oldMin, oldPat] = parseVersion(oldVersion);
  const [newMaj, newMin, newPat] = parseVersion(newVersion);

  // Compare major version
  if (newMaj !== oldMaj) {
    return newMaj > oldMaj ? -1 : 1;
  }

  // Compare minor version
  if (newMin !== oldMin) {
    return newMin > oldMin ? -1 : 1;
  }

  // Compare patch version
  if (newPat !== oldPat) {
    return newPat > oldPat ? -1 : 1;
  }

  // All equal
  return 0;
}

/**
 * Analyzes schema changes between two plugin schema versions.
 *
 * Categorizes changes into safe (can be applied automatically) and unsafe (require
 * explicit unregistration and re-registration):
 *
 * **Safe changes:**
 * - New tables (safe to add without data migration)
 * - New columns that are nullable (no existing data affected)
 * - New columns with a default value (existing rows get the default)
 *
 * **Unsafe changes:**
 * - Removed tables (data loss risk)
 * - Removed columns (data loss)
 * - Column type changes (existing data may be incompatible)
 * - Column nullability changes (existing NOT NULL columns can't become nullable if NULL values exist)
 *
 * @param oldSchema - The previous plugin schema
 * @param newSchema - The new plugin schema
 * @returns Object with safe and unsafe change arrays
 */
export function analyzeSchemaChanges(
  oldSchema: ParsedPluginSchema,
  newSchema: ParsedPluginSchema
): { safe: SchemaChange[]; unsafe: SchemaChange[] } {
  const safe: SchemaChange[] = [];
  const unsafe: SchemaChange[] = [];

  // Build lookup maps for quick access
  const oldTableMap = new Map<string, PluginTableSpec>();
  const newTableMap = new Map<string, PluginTableSpec>();

  for (const table of oldSchema.tables) {
    oldTableMap.set(table.name, table);
  }

  for (const table of newSchema.tables) {
    newTableMap.set(table.name, table);
  }

  // Analyze new and modified tables
  for (const newTable of newSchema.tables) {
    const oldTable = oldTableMap.get(newTable.name);

    if (!oldTable) {
      // New table — always safe
      safe.push({ type: 'table_added', table: newTable.name });
      continue;
    }

    // Table exists in both versions — check columns
    const oldColMap = new Map<string, PluginColumnSpec>();
    const newColMap = new Map<string, PluginColumnSpec>();

    for (const col of oldTable.columns) {
      oldColMap.set(col.name, col);
    }

    for (const col of newTable.columns) {
      newColMap.set(col.name, col);
    }

    // Check for new and modified columns
    for (const newCol of newTable.columns) {
      const oldCol = oldColMap.get(newCol.name);

      if (!oldCol) {
        // New column — safe if nullable OR has a default value
        if (newCol.default !== undefined) {
          // Has a default value
          safe.push({ type: 'column_added', table: newTable.name, column: newCol.name });
        } else if (!newCol.required) {
          // Nullable (not required)
          safe.push({ type: 'column_added', table: newTable.name, column: newCol.name });
        } else {
          // NOT NULL without default — unsafe
          unsafe.push({ type: 'column_added', table: newTable.name, column: newCol.name });
        }
      } else {
        // Column exists in both versions — check for breaking changes

        // Type change
        if (oldCol.type !== newCol.type) {
          unsafe.push({
            type: 'type_changed',
            table: newTable.name,
            column: newCol.name,
            oldValue: oldCol.type,
            newValue: newCol.type,
          });
        }

        // Nullability change
        if (oldCol.required !== newCol.required) {
          unsafe.push({
            type: 'nullability_changed',
            table: newTable.name,
            column: newCol.name,
            oldValue: `required=${oldCol.required ?? false}`,
            newValue: `required=${newCol.required ?? false}`,
          });
        }
      }
    }

    // Check for removed columns
    for (const oldCol of oldTable.columns) {
      if (!newColMap.has(oldCol.name)) {
        unsafe.push({ type: 'column_removed', table: newTable.name, column: oldCol.name });
      }
    }
  }

  // Check for removed tables
  for (const oldTable of oldSchema.tables) {
    if (!newTableMap.has(oldTable.name)) {
      unsafe.push({ type: 'table_removed', table: oldTable.name });
    }
  }

  return { safe, unsafe };
}
