import { describe, it, expect } from 'vitest';
import {
  compareSchemaVersions,
  analyzeSchemaChanges,
  type ParsedPluginSchema,
} from '../../src/utils/schema-migration.js';

/**
 * Test suite for schema migration utilities (SPEC-15)
 */

describe('compareSchemaVersions', () => {
  // Equality tests
  it('returns 0 for identical versions', () => {
    expect(compareSchemaVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareSchemaVersions('2.5.3', '2.5.3')).toBe(0);
  });

  it('handles missing patch versions (e.g., "1.0" == "1.0.0")', () => {
    expect(compareSchemaVersions('1.0', '1.0.0')).toBe(0);
    expect(compareSchemaVersions('1.0.0', '1.0')).toBe(0);
  });

  it('handles missing minor and patch (e.g., "1" == "1.0.0")', () => {
    expect(compareSchemaVersions('1', '1.0.0')).toBe(0);
    expect(compareSchemaVersions('1.0.0', '1')).toBe(0);
  });

  // Less than tests
  it('returns -1 when old < new (major version)', () => {
    expect(compareSchemaVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSchemaVersions('0.5.0', '1.0.0')).toBe(-1);
  });

  it('returns -1 when old < new (minor version)', () => {
    expect(compareSchemaVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSchemaVersions('1.5.0', '1.6.0')).toBe(-1);
  });

  it('returns -1 when old < new (patch version)', () => {
    expect(compareSchemaVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSchemaVersions('1.0.5', '1.0.10')).toBe(-1);
  });

  // Greater than tests
  it('returns 1 when old > new (major version)', () => {
    expect(compareSchemaVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareSchemaVersions('1.0.0', '0.5.0')).toBe(1);
  });

  it('returns 1 when old > new (minor version)', () => {
    expect(compareSchemaVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareSchemaVersions('1.6.0', '1.5.0')).toBe(1);
  });

  it('returns 1 when old > new (patch version)', () => {
    expect(compareSchemaVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareSchemaVersions('1.0.10', '1.0.5')).toBe(1);
  });

  // Integer comparison test (critical for semver)
  it('uses integer comparison, not string comparison (1.10 > 1.2)', () => {
    expect(compareSchemaVersions('1.2.0', '1.10.0')).toBe(-1); // 1.2 < 1.10
    expect(compareSchemaVersions('1.10.0', '1.2.0')).toBe(1); // 1.10 > 1.2
    expect(compareSchemaVersions('2.0.0', '2.0.10')).toBe(-1);
    expect(compareSchemaVersions('2.0.10', '2.0.0')).toBe(1);
  });

  // Edge cases
  it('handles zero versions', () => {
    expect(compareSchemaVersions('0.0.0', '0.0.0')).toBe(0);
    expect(compareSchemaVersions('0.0.0', '0.0.1')).toBe(-1);
    expect(compareSchemaVersions('0.0.1', '0.0.0')).toBe(1);
  });

  it('handles large version numbers', () => {
    expect(compareSchemaVersions('10.10.10', '10.10.10')).toBe(0);
    expect(compareSchemaVersions('10.10.10', '10.10.11')).toBe(-1);
    expect(compareSchemaVersions('100.0.0', '99.9.9')).toBe(1);
  });
});

describe('analyzeSchemaChanges', () => {
  // Test data
  const oldSchemaV1: ParsedPluginSchema = {
    plugin: { id: 'crm', name: 'CRM', version: '1.0.0' },
    tables: [
      {
        name: 'contacts',
        columns: [
          { name: 'id', type: 'uuid', required: true },
          { name: 'name', type: 'text', required: true },
          { name: 'email', type: 'text', required: false },
        ],
      },
    ],
  };

  it('detects new table as safe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        ...oldSchemaV1.tables,
        {
          name: 'interactions',
          columns: [{ name: 'id', type: 'uuid', required: true }],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(safe).toContainEqual(expect.objectContaining({ type: 'table_added', table: 'interactions' }));
    expect(unsafe).toHaveLength(0);
  });

  it('detects removed table as unsafe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [], // contacts table removed
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(unsafe).toContainEqual(expect.objectContaining({ type: 'table_removed', table: 'contacts' }));
    expect(safe).toHaveLength(0);
  });

  it('detects new nullable column as safe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            ...oldSchemaV1.tables[0].columns,
            { name: 'phone', type: 'text', required: false }, // NEW nullable column
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'phone' })
    );
    expect(unsafe).toHaveLength(0);
  });

  it('detects new NOT NULL column with default as safe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            ...oldSchemaV1.tables[0].columns,
            { name: 'status', type: 'text', required: true, default: 'active' }, // NEW NOT NULL with default
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'status' })
    );
    expect(unsafe).toHaveLength(0);
  });

  it('detects new NOT NULL column without default as unsafe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            ...oldSchemaV1.tables[0].columns,
            { name: 'status', type: 'text', required: true }, // NEW NOT NULL without default
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(unsafe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'status' })
    );
  });

  it('detects removed column as unsafe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [{ name: 'id', type: 'uuid', required: true }], // name and email removed
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(unsafe).toContainEqual(
      expect.objectContaining({ type: 'column_removed', table: 'contacts', column: 'name' })
    );
    expect(unsafe).toContainEqual(
      expect.objectContaining({ type: 'column_removed', table: 'contacts', column: 'email' })
    );
  });

  it('detects column type change as unsafe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            { name: 'id', type: 'uuid', required: true },
            { name: 'name', type: 'text', required: true },
            { name: 'email', type: 'integer', required: false }, // TYPE CHANGED from text to integer
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(unsafe).toContainEqual(
      expect.objectContaining({
        type: 'type_changed',
        table: 'contacts',
        column: 'email',
        oldValue: 'text',
        newValue: 'integer',
      })
    );
  });

  it('detects column nullability change as unsafe change', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            { name: 'id', type: 'uuid', required: true },
            { name: 'name', type: 'text', required: true },
            { name: 'email', type: 'text', required: true }, // NULLABILITY CHANGED from nullable to NOT NULL
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(unsafe).toContainEqual(
      expect.objectContaining({
        type: 'nullability_changed',
        table: 'contacts',
        column: 'email',
      })
    );
  });

  it('returns empty arrays for identical schemas', () => {
    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, oldSchemaV1);
    expect(safe).toHaveLength(0);
    expect(unsafe).toHaveLength(0);
  });

  it('handles multiple tables with mixed changes', () => {
    const newSchema: ParsedPluginSchema = {
      plugin: { id: 'crm', name: 'CRM', version: '2.0.0' },
      tables: [
        // contacts: safe new column
        {
          name: 'contacts',
          columns: [
            { name: 'id', type: 'uuid', required: true },
            { name: 'name', type: 'text', required: true },
            { name: 'email', type: 'text', required: false },
            { name: 'phone', type: 'text', required: false }, // NEW
          ],
        },
        // interactions: new table (safe)
        {
          name: 'interactions',
          columns: [{ name: 'id', type: 'uuid', required: true }],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(safe).toContainEqual(expect.objectContaining({ type: 'table_added', table: 'interactions' }));
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'phone' })
    );
    expect(unsafe).toHaveLength(0);
  });

  it('handles complex scenario: safe and unsafe changes in same upgrade', () => {
    const newSchema: ParsedPluginSchema = {
      ...oldSchemaV1,
      tables: [
        {
          ...oldSchemaV1.tables[0],
          columns: [
            { name: 'id', type: 'uuid', required: true },
            { name: 'name', type: 'text', required: true },
            // email removed (UNSAFE)
            { name: 'phone', type: 'text', required: false }, // NEW nullable (SAFE)
            { name: 'status', type: 'text', required: true, default: 'active' }, // NEW with default (SAFE)
          ],
        },
      ],
    };

    const { safe, unsafe } = analyzeSchemaChanges(oldSchemaV1, newSchema);
    expect(safe).toHaveLength(2);
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'phone' })
    );
    expect(safe).toContainEqual(
      expect.objectContaining({ type: 'column_added', table: 'contacts', column: 'status' })
    );
    expect(unsafe).toHaveLength(1);
    expect(unsafe).toContainEqual(
      expect.objectContaining({ type: 'column_removed', table: 'contacts', column: 'email' })
    );
  });
});
