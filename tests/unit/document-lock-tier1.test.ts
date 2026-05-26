import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { withDocumentLock } from '../../src/services/document-lock.js';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'document-lock-tier1-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    supabase: { url: '', serviceRoleKey: '', databaseUrl: '', skipDdl: true },
    locking: { enabled: false, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('REQ-002 advisory-lock two-tier document lock Tier 1', () => {
  it('T-U-003 advisory-lock Tier 1 same-key loser cannot enter until winner releases', async () => {
    const events: string[] = [];
    const firstEntered = createGate();
    const releaseFirst = createGate();

    const first = withDocumentLock(makeConfig(), '/tmp/vault/tier1.md', async () => {
      events.push('first-enter');
      firstEntered.release();
      await releaseFirst.promise;
      events.push('first-exit');
    });

    await firstEntered.promise;

    const second = withDocumentLock(makeConfig(), '/tmp/vault/tier1.md', async () => {
      events.push('second-enter');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-enter']);

    releaseFirst.release();
    await Promise.all([first, second]);

    expect(events).toEqual(['first-enter', 'first-exit', 'second-enter']);
  });
});
