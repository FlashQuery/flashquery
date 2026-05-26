import { describe, expect, it, vi } from 'vitest';
import { writeVaultFile } from '../../src/storage/vault-write.js';

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
      writeVaultFile('/vault/note.md', 'first', { operations }),
      writeVaultFile('/vault/note.md', 'second', { operations }),
    ]);

    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).toMatch(/\/vault\/note\.md\.fqc-tmp-\d+-\d+-[a-f0-9-]+$/);
    expect(tempPaths[1]).toMatch(/\/vault\/note\.md\.fqc-tmp-\d+-\d+-[a-f0-9-]+$/);
    expect(new Set(tempPaths).size).toBe(2);
  });

  it('T-U-033 keeps macOS durable sync behind the same adapter path used by Linux', async () => {
    const durableFileSync = vi.fn(async (handle: { sync(): Promise<void> }) => {
      await handle.sync();
    });

    await writeVaultFile('/vault/darwin.md', 'body', {
      platform: 'darwin',
      durableFileSync,
      operations: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
        open: vi.fn(async () => makeHandle('file', [])),
        rename: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
      },
    });

    expect(durableFileSync).toHaveBeenCalledTimes(1);
    expect(durableFileSync.mock.calls[0]?.[1]).toEqual({ platform: 'darwin' });
  });

  it('T-U-031 surfaces temp fsync failures', async () => {
    const syncError = new Error('fsync failed');

    await expect(
      writeVaultFile('/vault/fail.md', 'body', {
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
