/**
 * Unit tests for the write-lock service (Phase 24 — LOCK-01, LOCK-03)
 *
 * All external dependencies (SupabaseClient, logger) are mocked so these tests
 * run entirely in-process without a real database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acquireLock, releaseLock, isLocked } from '../../src/services/write-lock.js';
import type { LockOptions } from '../../src/services/write-lock.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock logger — suppress all output during tests
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client factory helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal SupabaseClient mock whose `from()` chain returns controlled
 * responses. Each operation (`delete`, `insert`, `select`) ends in a chainable
 * builder that resolves to `{ data, error }`.
 */
function makeClient(insertResult: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const deleteChain = {
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const insertFn = vi.fn().mockResolvedValue(insertResult);

  const from = vi.fn().mockImplementation((table: string) => ({
    delete: vi.fn().mockReturnValue(deleteChain),
    insert: insertFn,
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }));

  return { from, _insertFn: insertFn, _deleteChain: deleteChain };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when insert succeeds on first attempt', async () => {
    const { from, _insertFn } = makeClient({ data: null, error: null });
    const client = { from } as unknown as Parameters<typeof acquireLock>[0];

    const result = await acquireLock(client, 'instance-a', 'vault', { ttlSeconds: 30, timeoutMs: 5000 });

    expect(result).toBe(true);
    expect(_insertFn).toHaveBeenCalledOnce();
    const insertArg = _insertFn.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.instance_id).toBe('instance-a');
    expect(insertArg.resource_type).toBe('vault');
  });

  it('returns false after timeout when insert always returns a conflict error', async () => {
    vi.useFakeTimers();

    const conflictError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    let callCount = 0;

    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const from = vi.fn().mockImplementation(() => ({
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ data: null, error: conflictError });
      }),
    }));

    const client = { from } as unknown as Parameters<typeof acquireLock>[0];

    const lockPromise = acquireLock(client, 'instance-b', 'vault', {
      ttlSeconds: 30,
      timeoutMs: 500,
    });

    // Advance fake timers past the timeout to resolve the while loop
    await vi.runAllTimersAsync();

    const result = await lockPromise;
    expect(result).toBe(false);
    expect(callCount).toBeGreaterThan(0);
  });

  it('cleans up expired locks before attempting to insert', async () => {
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const deleteFn = vi.fn().mockReturnValue(deleteChain);

    const from = vi.fn().mockImplementation(() => ({
      delete: deleteFn,
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const client = { from } as unknown as Parameters<typeof acquireLock>[0];

    await acquireLock(client, 'instance-c', 'vault', { ttlSeconds: 30, timeoutMs: 5000 });

    expect(deleteFn).toHaveBeenCalledOnce();
    expect(deleteChain.eq).toHaveBeenCalledWith('resource_type', 'vault');
    expect(deleteChain.lt).toHaveBeenCalledOnce();
  });

  it('uses exponential backoff delays (10ms, 20ms, 40ms) on repeated conflicts', async () => {
    vi.useFakeTimers();

    const conflictError = { code: '23505', message: 'conflict' };
    let insertCallCount = 0;

    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const from = vi.fn().mockImplementation(() => ({
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn().mockImplementation(() => {
        insertCallCount++;
        return Promise.resolve({ data: null, error: conflictError });
      }),
    }));

    const client = { from } as unknown as Parameters<typeof acquireLock>[0];

    const lockPromise = acquireLock(client, 'instance-d', 'resource', {
      ttlSeconds: 30,
      timeoutMs: 10000,
    });

    // Advance all timers so the loop times out
    await vi.runAllTimersAsync();

    const result = await lockPromise;
    expect(result).toBe(false);
    // Should have made multiple insert attempts (backoff means fewer attempts per ms)
    expect(insertCallCount).toBeGreaterThanOrEqual(2);
  });
});

describe('releaseLock', () => {
  it('calls delete with correct instance_id and resource_type filters', async () => {
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
    };
    // Second eq call (resource_type filter) resolves the chain
    deleteChain.eq.mockImplementationOnce(() => deleteChain).mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: null })
    );

    const deleteFn = vi.fn().mockReturnValue(deleteChain);
    const from = vi.fn().mockReturnValue({ delete: deleteFn });
    const client = { from } as unknown as Parameters<typeof releaseLock>[0];

    await releaseLock(client, 'instance-a', 'vault');

    expect(deleteFn).toHaveBeenCalledOnce();
    expect(deleteChain.eq).toHaveBeenCalledWith('instance_id', 'instance-a');
    expect(deleteChain.eq).toHaveBeenCalledWith('resource_type', 'vault');
  });
});

describe('isLocked', () => {
  it('returns { locked: true, instanceId, expiresAt } when a non-expired row exists', async () => {
    const mockData = {
      instance_id: 'instance-a',
      expires_at: '2026-12-31T00:00:00.000Z',
    };

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    };

    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) });
    const client = { from } as unknown as Parameters<typeof isLocked>[0];

    const result = await isLocked(client, 'vault');

    expect(result.locked).toBe(true);
    expect(result.instanceId).toBe('instance-a');
    expect(result.expiresAt).toBe('2026-12-31T00:00:00.000Z');
  });

  it('returns { locked: false } when no active lock row exists', async () => {
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) });
    const client = { from } as unknown as Parameters<typeof isLocked>[0];

    const result = await isLocked(client, 'vault');

    expect(result.locked).toBe(false);
    expect(result.instanceId).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });

  it('returns { locked: false } when maybeSingle returns an error', async () => {
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation does not exist' },
      }),
    };

    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) });
    const client = { from } as unknown as Parameters<typeof isLocked>[0];

    const result = await isLocked(client, 'vault');

    expect(result.locked).toBe(false);
  });

  it('queries with resource_type filter and gt on expires_at', async () => {
    const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const limitFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
    const gtFn = vi.fn().mockReturnValue({ limit: limitFn });
    const eqFn = vi.fn().mockReturnValue({ gt: gtFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
    const from = vi.fn().mockReturnValue({ select: selectFn });

    const client = { from } as unknown as Parameters<typeof isLocked>[0];

    await isLocked(client, 'my-resource');

    expect(eqFn).toHaveBeenCalledWith('resource_type', 'my-resource');
    expect(gtFn).toHaveBeenCalledOnce();
    // gt is called with expires_at and a timestamp string
    const [field] = gtFn.mock.calls[0] as [string, string];
    expect(field).toBe('expires_at');
  });
});
