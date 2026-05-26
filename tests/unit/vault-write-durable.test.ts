import { describe, expect, it, vi } from 'vitest';
import { withDocumentLock } from '../../src/services/document-lock.js';
import { writeVaultFile } from '../../src/storage/vault-write.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

function makeHandle(name: string, events: string[]) {
  return {
    async sync() {
      events.push(`${name}.sync`);
    },
    async close() {
      events.push(`${name}.close`);
    },
  };
}

describe('writeVaultFile durable sequence', () => {
  it('T-U-031 writes temp, syncs temp, renames, syncs directory, and closes handles in order', async () => {
    const events: string[] = [];

    await writeVaultFile('/vault/project/note.md', 'body', {
      platform: 'linux',
      operations: {
        mkdir: async (path) => {
          events.push(`mkdir:${path}`);
        },
        writeFile: async (path) => {
          events.push(`writeFile:${path}`);
        },
        open: async (path) => {
          events.push(`open:${path}`);
          return makeHandle(path === '/vault/project' ? 'dir' : 'file', events);
        },
        rename: async (from, to) => {
          events.push(`rename:${from}->${to}`);
        },
        unlink: async (path) => {
          events.push(`unlink:${path}`);
        },
      },
    });

    const writeIndex = events.findIndex((event) => event.startsWith('writeFile:/vault/project/note.md.fqc-tmp-'));
    const fileOpenIndex = events.findIndex((event) => event.startsWith('open:/vault/project/note.md.fqc-tmp-'));
    const renameIndex = events.findIndex((event) => event.startsWith('rename:/vault/project/note.md.fqc-tmp-') && event.endsWith('->/vault/project/note.md'));
    const dirOpenIndex = events.indexOf('open:/vault/project');

    expect(events[0]).toBe('mkdir:/vault/project');
    expect(writeIndex).toBeGreaterThan(-1);
    expect(fileOpenIndex).toBeGreaterThan(writeIndex);
    expect(events[fileOpenIndex + 1]).toBe('file.sync');
    expect(events[fileOpenIndex + 2]).toBe('file.close');
    expect(renameIndex).toBeGreaterThan(fileOpenIndex);
    expect(dirOpenIndex).toBeGreaterThan(renameIndex);
    expect(events[dirOpenIndex + 1]).toBe('dir.sync');
    expect(events[dirOpenIndex + 2]).toBe('dir.close');
  });

  it('T-U-032 uses a unique temp name for each write to the same destination', async () => {
    const tempPaths: string[] = [];

    const operations = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string) => {
        tempPaths.push(path);
      }),
      open: vi.fn(async () => makeHandle('handle', [])),
      rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };

    await Promise.all([
      writeVaultFile('/vault/note.md', 'first', { operations, platform: 'linux' }),
      writeVaultFile('/vault/note.md', 'second', { operations, platform: 'linux' }),
    ]);

    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).toMatch(/\/vault\/note\.md\.fqc-tmp-\d+-\d+-[a-f0-9-]+$/);
    expect(tempPaths[1]).toMatch(/\/vault\/note\.md\.fqc-tmp-\d+-\d+-[a-f0-9-]+$/);
    expect(new Set(tempPaths).size).toBe(2);
  });

  it('T-U-033 uses a Darwin F_FULLFSYNC adapter instead of plain handle.sync on macOS', async () => {
    const events: string[] = [];
    const darwinFullFsync = vi.fn(async (path: string) => {
      events.push(`fullfsync:${path}`);
    });

    await writeVaultFile('/vault/darwin.md', 'body', {
      platform: 'darwin',
      darwinFullFsync,
      operations: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
        open: vi.fn(async (path: string) =>
          makeHandle(path.includes('.fqc-tmp-') ? 'temp' : 'dir', events)
        ),
        rename: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
      },
    });

    expect(darwinFullFsync).toHaveBeenCalledTimes(1);
    expect(darwinFullFsync.mock.calls[0]?.[0]).toMatch(
      /^\/vault\/darwin\.md\.fqc-tmp-\d+-\d+-[a-f0-9-]+$/
    );
    expect(events).not.toContain('temp.sync');
  });

  it('REQ-020 AC #4 asserts the ambient document lock when enabled', async () => {
    const previous = process.env.FQC_LOCK_ASSERT;
    process.env.FQC_LOCK_ASSERT = 'true';

    const operations = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      open: vi.fn(async () => makeHandle('file', [])),
      rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };

    try {
      await expect(
        writeVaultFile('/vault/asserted.md', 'body', { operations, platform: 'linux' })
      ).rejects.toThrow(/without holding withDocumentLock/);

      const config = {
        locking: { enabled: false, ttlSeconds: 30 },
        instance: { id: 'lock-assert-test' },
      } as FlashQueryConfig;

      await expect(
        withDocumentLock(config, '/vault/asserted.md', () =>
          writeVaultFile('/vault/asserted.md', 'body', { operations, platform: 'linux' })
        )
      ).resolves.toEqual({ contentHash: expect.any(String) });
    } finally {
      if (previous === undefined) {
        delete process.env.FQC_LOCK_ASSERT;
      } else {
        process.env.FQC_LOCK_ASSERT = previous;
      }
    }
  });

  it('T-U-031 surfaces temp fsync failures', async () => {
    const syncError = new Error('fsync failed');

    await expect(
      writeVaultFile('/vault/fail.md', 'body', {
        platform: 'linux',
        durableFileSync: async () => {
          throw syncError;
        },
        operations: {
          mkdir: vi.fn(async () => undefined),
          writeFile: vi.fn(async () => undefined),
          open: vi.fn(async () => makeHandle('file', [])),
          rename: vi.fn(async () => undefined),
          unlink: vi.fn(async () => undefined),
        },
      })
    ).rejects.toThrow(syncError);
  });

  it('T-U-031 surfaces directory sync failures', async () => {
    const dirError = new Error('directory sync failed');

    await expect(
      writeVaultFile('/vault/fail-dir.md', 'body', {
        platform: 'linux',
        operations: {
          mkdir: vi.fn(async () => undefined),
          writeFile: vi.fn(async () => undefined),
          open: vi.fn(async (path: string) => {
            if (path === '/vault') {
              return {
                async sync() {
                  throw dirError;
                },
                async close() {},
              };
            }
            return makeHandle('file', []);
          }),
          rename: vi.fn(async () => undefined),
          unlink: vi.fn(async () => undefined),
        },
      })
    ).rejects.toThrow(dirError);
  });
});
