import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { withDocumentLock, withDocumentLocks } from '../../src/services/document-lock.js';

const acquireLock = vi.hoisted(() => vi.fn(async () => true));
const releaseLock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../src/services/write-lock.js', () => ({
  acquireLock,
  releaseLock,
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({ from: vi.fn() })),
  },
}));

function makeConfig(enabled = false): FlashQueryConfig {
  return {
    instance: {
      name: 'document-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    locking: { enabled, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

describe('REQ-001 document-lock Tier 1 registry', () => {
  it('T-U-001 serializes same absolute file path while allowing distinct files to overlap', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      void withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => {
        events.push('same:first-enter');
        resolve();
        await new Promise<void>((release) => {
          releaseFirst = release;
        });
        events.push('same:first-exit');
      });
    });

    await firstEntered;
    const second = withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => {
      events.push('same:second-enter');
    });
    await Promise.resolve();
    expect(events).not.toContain('same:second-enter');
    releaseFirst();
    await second;
    expect(events).toEqual(['same:first-enter', 'same:first-exit', 'same:second-enter']);

    events.length = 0;
    let releaseA!: () => void;
    const aEntered = new Promise<void>((resolve) => {
      void withDocumentLock(makeConfig(), '/tmp/vault/a.md', async () => {
        events.push('distinct:a-enter');
        resolve();
        await new Promise<void>((release) => {
          releaseA = release;
        });
      });
    });
    await aEntered;
    await withDocumentLock(makeConfig(), '/tmp/vault/b.md', async () => {
      events.push('distinct:b-enter');
    });
    releaseA();
    expect(events).toContain('distinct:b-enter');
  });

  it('T-U-002 uses bounded 1024 stripe allocation and Phase-155 basic absolute-path key scaffolding', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/services/document-lock.ts', import.meta.url), 'utf-8')
    );
    expect(source).toContain('TIER1_STRIPE_COUNT = 1024');
    expect(source).toContain('Phase 155');
    expect(source).toMatch(/path\.isAbsolute/);
    expect(source).not.toMatch(/relativePath.*resource/i);
  });

  it('acquires multiple locks in sorted path order', async () => {
    const resources: string[] = [];
    acquireLock.mockImplementation(async (_client, _instanceId, resource: string) => {
      resources.push(resource);
      return true;
    });

    await withDocumentLocks(makeConfig(true), ['/tmp/vault/b.md', '/tmp/vault/a.md'], async () => 'ok');

    expect(resources).toEqual(['document:/tmp/vault/a.md', 'document:/tmp/vault/b.md']);
  });
});
