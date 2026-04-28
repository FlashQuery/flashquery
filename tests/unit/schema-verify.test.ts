import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tableExists, verifySchema } from '../../src/storage/schema-verify.js';
import type pg from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — pg.Client
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('pg', () => {
  // pg is a CJS module; default export is an object with Client constructor.
  // Must use class expression (not arrow function) for `new` to work.
  class MockClient {
    query = mockQuery;
  }

  return {
    default: {
      Client: MockClient,
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for tableExists()
// ─────────────────────────────────────────────────────────────────────────────

describe('tableExists', () => {
  let mockClient: pg.Client;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a mock client instance with the query method
    mockClient = { query: mockQuery } as unknown as pg.Client;
  });

  it('returns true when to_regclass returns non-null (table exists)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': true }],
    });

    const result = await tableExists(mockClient, 'fqc_memory');
    expect(result).toBe(true);
  });

  it('returns false when to_regclass returns null (table does not exist)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': false }],
    });

    const result = await tableExists(mockClient, 'fqc_memory');
    expect(result).toBe(false);
  });

  it('correctly escapes table name in SQL query', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': true }],
    });

    await tableExists(mockClient, 'fqc_vault');

    // Table name is passed as a parameterized argument, not interpolated into SQL
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toContain("to_regclass(format('public.%I', $1))");
    expect(callArgs[0]).toContain('IS NOT NULL');
    expect(callArgs[1]).toEqual(['fqc_vault']);
  });

  it('throws error if query fails', async () => {
    const queryError = new Error('connection failed');
    mockQuery.mockRejectedValue(queryError);

    await expect(tableExists(mockClient, 'fqc_memory')).rejects.toThrow('connection failed');
  });

  it('handles different table names correctly', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': true }],
    });

    // Table name is passed as a parameterized argument (callArgs[1]), not in the SQL string
    await tableExists(mockClient, 'fqc_documents');
    let callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toEqual(['fqc_documents']);

    mockQuery.mockClear();
    await tableExists(mockClient, 'fqc_plugin_registry');
    callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toEqual(['fqc_plugin_registry']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for verifySchema()
// ─────────────────────────────────────────────────────────────────────────────

describe('verifySchema', () => {
  let mockClient: pg.Client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { query: mockQuery } as unknown as pg.Client;
  });

  it('verifies all 10 required tables exist', async () => {
    // All tables exist
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': true }],
    });

    // Should not throw
    await expect(verifySchema(mockClient)).resolves.toBeUndefined();

    // Verify that tableExists was called 10 times (once per table)
    expect(mockQuery).toHaveBeenCalledTimes(10);
  });

  it('throws error listing missing tables when one table is missing', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      // fqc_vault (second call) returns false, others return true
      const exists = callCount !== 1;
      callCount++;
      return Promise.resolve({
        rows: [{ '?column?': exists }],
      });
    });

    await expect(verifySchema(mockClient)).rejects.toThrow(
      'Missing required tables after DDL: [fqc_vault]'
    );
  });

  it('throws error listing multiple missing tables', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      // fqc_memory (0) and fqc_vault (1) are missing; others exist
      const exists = ![0, 1].includes(callCount);
      callCount++;
      return Promise.resolve({
        rows: [{ '?column?': exists }],
      });
    });

    await expect(verifySchema(mockClient)).rejects.toThrow(
      'Missing required tables after DDL: [fqc_memory, fqc_vault]'
    );
  });

  it('throws error with all tables missing (fresh database)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': false }],
    });

    await expect(verifySchema(mockClient)).rejects.toThrow(
      'Missing required tables after DDL: [fqc_memory, fqc_vault, fqc_documents, fqc_plugin_registry, fqc_write_locks, fqc_llm_providers, fqc_llm_models, fqc_llm_purposes, fqc_llm_purpose_models, fqc_llm_usage]'
    );

    // All 10 tables should be checked
    expect(mockQuery).toHaveBeenCalledTimes(10);
  });

  it('checks tables in the correct order', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': true }],
    });

    await verifySchema(mockClient);

    const expectedTables = [
      'fqc_memory',
      'fqc_vault',
      'fqc_documents',
      'fqc_plugin_registry',
      'fqc_write_locks',
      'fqc_llm_providers',
      'fqc_llm_models',
      'fqc_llm_purposes',
      'fqc_llm_purpose_models',
      'fqc_llm_usage',
    ];

    // Table name is passed as a parameterized argument (callArgs[1]), not in the SQL string
    expectedTables.forEach((table, index) => {
      const callArgs = mockQuery.mock.calls[index];
      expect(callArgs[1]).toEqual([table]);
    });
  });
});
