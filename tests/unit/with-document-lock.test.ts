import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { LockTimeoutError, withDocumentLock, withDocumentLocks } from '../../src/services/document-lock.js';

const acquireLock = vi.hoisted(() => vi.fn(async () => true));
const releaseLock = vi.hoisted(() => vi.fn(async () => undefined));
const getClient = vi.hoisted(() => vi.fn(() => ({ from: vi.fn() })));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock,
  releaseLock,
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient },
}));

function makeConfig(enabled = true): FlashQueryConfig {
  return {
    instance: {
      name: 'with-document-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    locking: { enabled, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

describe('REQ-009 withDocumentLock facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue(true);
    releaseLock.mockResolvedValue(undefined);
  });

  it('T-U-016 acquires Tier 1 plus temporary legacy Tier 2 and releases on success', async () => {
    const result = await withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => 'done');

    expect(result).toBe('done');
    expect(acquireLock).toHaveBeenCalledWith(
      expect.anything(),
      'instance-1',
      'document:/tmp/vault/a.md',
      { ttlSeconds: 30 }
    );
    expect(releaseLock).toHaveBeenCalledWith(expect.anything(), 'instance-1', 'document:/tmp/vault/a.md');
  });

  it('T-U-016 releases temporary Tier 2 when the callback throws', async () => {
    await expect(
      withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(releaseLock).toHaveBeenCalledWith(expect.anything(), 'instance-1', 'document:/tmp/vault/a.md');
  });

  it('T-U-017 withDocumentLocks acquires locks in sorted basic-key order and releases reverse order', async () => {
    const calls: string[] = [];
    acquireLock.mockImplementation(async (_client, _instanceId, resource: string) => {
      calls.push(`acquire:${resource}`);
      return true;
    });
    releaseLock.mockImplementation(async (_client, _instanceId, resource: string) => {
      calls.push(`release:${resource}`);
    });

    await withDocumentLocks(makeConfig(), ['/tmp/vault/b.md', '/tmp/vault/a.md'], async () => undefined);

    expect(calls).toEqual([
      'acquire:document:/tmp/vault/a.md',
      'acquire:document:/tmp/vault/b.md',
      'release:document:/tmp/vault/b.md',
      'release:document:/tmp/vault/a.md',
    ]);
  });

  it('T-U-018 throws LockTimeoutError and releases Tier 1 when temporary Tier 2 cannot be acquired', async () => {
    let secondEntered = false;
    acquireLock.mockResolvedValueOnce(false);

    await expect(withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => undefined)).rejects.toBeInstanceOf(
      LockTimeoutError
    );

    await withDocumentLock(makeConfig(false), '/tmp/vault/a.md', async () => {
      secondEntered = true;
    });
    expect(secondEntered).toBe(true);
    expect(releaseLock).not.toHaveBeenCalled();
  });
});
