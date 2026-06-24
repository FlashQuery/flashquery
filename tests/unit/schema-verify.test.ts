import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getActiveEmbeddingDimensionDrift,
  tableExists,
  verifyEmbeddingDimensions,
  verifySchema,
} from '../../src/storage/schema-verify.js';
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
    expect(callArgs[0]).toContain("to_regclass(format('public.%I', $1::text))");
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

  function mockAllRequiredSchemaExists(sql: string) {
    if (sql.includes('is_nullable')) {
      return Promise.resolve({ rows: [{ is_nullable: 'YES' }] });
    }
    if (sql.includes('pg_constraint')) {
      return Promise.resolve({ rows: [{ exists: true }] });
    }
    if (sql.includes('information_schema.columns')) {
      return Promise.resolve({ rows: [{ exists: true }] });
    }
    return Promise.resolve({ rows: [{ '?column?': true }] });
  }

  it('verifies all required tables and columns exist without the retired legacy write-lock table', async () => {
    // All tables exist
    mockQuery.mockImplementation(mockAllRequiredSchemaExists);

    // Should not throw
    await expect(verifySchema(mockClient)).resolves.toBeUndefined();

    // Verify that tableExists was called 16 times, plus required-column and graph-contract checks.
    expect(mockQuery).toHaveBeenCalledTimes(70);
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

  it('throws error when ATL-I-01 fqc_purpose_templates is missing', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      // fqc_purpose_templates is checked after fqc_llm_usage.
      const exists = callCount !== 10;
      callCount++;
      return Promise.resolve({
        rows: [{ '?column?': exists }],
      });
    });

    await expect(verifySchema(mockClient)).rejects.toThrow(
      'Missing required tables after DDL: [fqc_purpose_templates]'
    );
  });

  it('throws error with all tables missing (fresh database)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ '?column?': false }],
    });

    await expect(verifySchema(mockClient)).rejects.toThrow(
      'Missing required tables after DDL: [fqc_memory, fqc_vault, fqc_documents, fqc_chunks, fqc_plugin_registry, fqc_llm_providers, fqc_llm_models, fqc_llm_purposes, fqc_llm_purpose_models, fqc_llm_usage, fqc_purpose_templates, fqc_pending_embeds, fqc_graph_nodes, fqc_graph_edges, fqc_pending_edges, fqc_graph_maintenance_state]'
    );

    // All 16 tables should be checked
    expect(mockQuery).toHaveBeenCalledTimes(16);
  });

  it('checks tables in the correct order', async () => {
    mockQuery.mockImplementation(mockAllRequiredSchemaExists);

    await verifySchema(mockClient);

    const expectedTables = [
      'fqc_memory',
      'fqc_vault',
      'fqc_documents',
      'fqc_chunks',
      'fqc_plugin_registry',
      'fqc_llm_providers',
      'fqc_llm_models',
      'fqc_llm_purposes',
      'fqc_llm_purpose_models',
      'fqc_llm_usage',
      'fqc_purpose_templates',
      'fqc_pending_embeds',
      'fqc_graph_nodes',
      'fqc_graph_edges',
      'fqc_pending_edges',
      'fqc_graph_maintenance_state',
    ];

    // Table name is passed as a parameterized argument (callArgs[1]), not in the SQL string
    expectedTables.forEach((table, index) => {
      const callArgs = mockQuery.mock.calls[index];
      expect(callArgs[1]).toEqual([table]);
    });
  });

  it('throws when embedding columns use a different vector dimension than configured', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('format_type')) {
        return Promise.resolve({
          rows: [
            { table_name: 'fqc_documents', formatted_type: 'vector(1536)' },
            { table_name: 'fqc_memory', formatted_type: 'vector(1536)' },
          ],
        });
      }
      return mockAllRequiredSchemaExists(sql);
    });

    await expect(verifySchema(mockClient, 768)).rejects.toThrow(
      'Embedding dimension mismatch: config expects vector(768), but existing schema has fqc_documents.embedding is vector(1536), fqc_memory.embedding is vector(1536)'
    );
  });
});

describe('getActiveEmbeddingDimensionDrift', () => {
  let mockClient: pg.Client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { query: mockQuery } as unknown as pg.Client;
  });

  it('checks active catalog entries against chunks and memory, not documents', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ name: 'primary', dimensions: 96 }],
      })
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'fqc_chunks', formatted_type: 'vector(64)' },
          { table_name: 'fqc_memory', formatted_type: 'vector(96)' },
        ],
      });

    const drifts = await getActiveEmbeddingDimensionDrift(mockClient, 'verify-instance');

    expect(mockQuery.mock.calls[1][1]).toEqual([
      ['fqc_chunks', 'fqc_memory'],
      'embedding_primary',
    ]);
    expect(drifts).toEqual([
      {
        entry: 'primary',
        table: 'fqc_chunks',
        column: 'embedding_primary',
        configuredWidth: 96,
        actualWidth: 64,
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for verifyEmbeddingDimensions()
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyEmbeddingDimensions', () => {
  let mockClient: pg.Client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { query: mockQuery } as unknown as pg.Client;
  });

  function mockAllRequiredSchemaExists(sql: string) {
    if (sql.includes('is_nullable')) {
      return Promise.resolve({ rows: [{ is_nullable: 'YES' }] });
    }
    if (sql.includes('pg_constraint')) {
      return Promise.resolve({ rows: [{ exists: true }] });
    }
    if (sql.includes('information_schema.columns')) {
      return Promise.resolve({ rows: [{ exists: true }] });
    }
    return Promise.resolve({ rows: [{ '?column?': true }] });
  }

  it('passes when document and memory embedding columns match configured dimensions', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { table_name: 'fqc_documents', formatted_type: 'vector(768)' },
        { table_name: 'fqc_memory', formatted_type: 'vector(768)' },
      ],
    });

    await expect(verifyEmbeddingDimensions(mockClient, 768)).resolves.toBeUndefined();
  });

  it('throws an actionable error when existing vector dimensions differ from config', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { table_name: 'fqc_documents', formatted_type: 'vector(1536)' },
        { table_name: 'fqc_memory', formatted_type: 'vector(1536)' },
      ],
    });

    await expect(verifyEmbeddingDimensions(mockClient, 768)).rejects.toThrow(
      'Embedding dimension mismatch: config expects vector(768), but existing schema has fqc_documents.embedding is vector(1536), fqc_memory.embedding is vector(1536)'
    );
  });

  it('verifySchema checks embedding dimensions when expected dimensions are supplied', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('format_type')) {
        return Promise.resolve({
          rows: [
            { table_name: 'fqc_documents', formatted_type: 'vector(1536)' },
            { table_name: 'fqc_memory', formatted_type: 'vector(1536)' },
          ],
        });
      }
      return mockAllRequiredSchemaExists(sql);
    });

    await expect(verifySchema(mockClient, 768)).rejects.toThrow(
      'Embedding dimension mismatch'
    );
  });
});
