import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initProjects } from '../../src/projects/seeder.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — pg is used directly (bypasses Kong REST API)
// The seeder imports pg as: import pg from 'pg'; new pg.Client(...)
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockEnd = vi.fn();
const mockConnect = vi.fn();

vi.mock('pg', () => {
  // pg is a CJS module; default export is an object with Client constructor.
  // mockImplementation with arrow function won't work with `new` (arrow functions
  // are not constructors). Use a class expression instead.
  class MockClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
  }

  return {
    default: {
      Client: MockClient,
    },
  };
});

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock pg-client utility so seeder uses the mock pg client regardless of module resolution
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked singletons
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(areas: FlashQueryConfig['projects']['areas'] = []): FlashQueryConfig {
  return {
    instance: { name: 'test-instance', id: 'test-instance-id' },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
    },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    defaults: { project: 'General' },
    projects: { areas },
  } as unknown as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('initProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockEnd.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);
  });

  it('inserts correct rows for 2 areas with 3 total projects via pg', async () => {
    const areas: FlashQueryConfig['projects']['areas'] = [
      {
        name: 'Work',
        description: 'Work projects',
        projects: [
          { name: 'Engineering', description: 'Engineering stuff' },
          { name: 'Marketing', description: 'Marketing stuff' },
        ],
      },
      {
        name: 'Personal',
        description: 'Personal projects',
        projects: [
          { name: 'Fitness', description: 'Health goals' },
        ],
      },
    ];

    const config = makeConfig(areas);
    await initProjects(config);

    // pg.query called once per project row (3 upsert calls)
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // Check each upsert call has correct params
    const call0 = mockQuery.mock.calls[0];
    expect(call0[1]).toEqual(['test-instance-id', 'Work', 'Engineering', 'Engineering stuff']);

    const call1 = mockQuery.mock.calls[1];
    expect(call1[1]).toEqual(['test-instance-id', 'Work', 'Marketing', 'Marketing stuff']);

    const call2 = mockQuery.mock.calls[2];
    expect(call2[1]).toEqual(['test-instance-id', 'Personal', 'Fitness', 'Health goals']);

    // Connection opened and closed
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('logs info and skips upsert when no projects configured', async () => {
    const config = makeConfig([]);
    await initProjects(config);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('skipping seed'));
    // No pg connection opened when nothing to seed
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws and closes pg connection when query fails', async () => {
    const areas: FlashQueryConfig['projects']['areas'] = [
      {
        name: 'Work',
        projects: [{ name: 'Engineering' }],
      },
    ];
    const config = makeConfig(areas);
    mockQuery.mockRejectedValue(new Error('constraint violation'));

    await expect(initProjects(config)).rejects.toThrow('constraint violation');

    // pg.end() must still be called even on error (finally block)
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('area projects without description defaults to null', async () => {
    const areas: FlashQueryConfig['projects']['areas'] = [
      {
        name: 'Work',
        projects: [{ name: 'Engineering' }],
      },
    ];
    const config = makeConfig(areas);
    await initProjects(config);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['test-instance-id', 'Work', 'Engineering', null]);
  });
});
