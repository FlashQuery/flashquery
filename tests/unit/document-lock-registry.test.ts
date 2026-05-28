import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { __testing, withDocumentLock } from '../../src/services/document-lock.js';

function makeConfig(enabled = false): FlashQueryConfig {
  return {
    instance: {
      name: 'document-lock-test',
      id: 'instance-1',
      vault: { path: '/tmp/vault', markdownExtensions: ['.md'] },
    },
    locking: { enabled },
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

  it('T-U-002 maps many canonical lock keys into a bounded 1024-stripe Tier 1 registry', async () => {
    const config = makeConfig();
    const stripeIndices = new Set<number>();

    for (let index = 0; index < 5000; index += 1) {
      const entry = await __testing.deriveDocumentLockEntry(
        config,
        `/tmp/vault/generated/doc-${index}.md`
      );
      stripeIndices.add(entry.stripeIndex);
      expect(entry.stripeIndex).toBeGreaterThanOrEqual(0);
      expect(entry.stripeIndex).toBeLessThan(1024);
      expect(entry.resource).toMatch(/^file:/);
      expect(entry.resource).toContain('/tmp/vault/generated/doc-');
      expect(entry.resource).not.toBe(`generated/doc-${index}.md`);
    }

    expect(stripeIndices.size).toBeLessThanOrEqual(1024);
  }, 15_000);

});
