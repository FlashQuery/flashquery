import { randomUUID, createHash } from 'node:crypto';
import { open, rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface VaultWriteResult {
  contentHash: string;
}

export interface SyncableHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface VaultWriteOperations {
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  open?: (path: string, flags: string) => Promise<SyncableHandle>;
  rename?: typeof rename;
  unlink?: typeof unlink;
}

export interface DurableFileSyncContext {
  platform: NodeJS.Platform;
}

export interface WriteVaultFileOptions {
  operations?: VaultWriteOperations;
  durableFileSync?: (handle: SyncableHandle, context: DurableFileSyncContext) => Promise<void>;
  platform?: NodeJS.Platform;
}

let tempCounter = 0;

function toBuffer(content: Buffer | string): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

function nextTempPath(absPath: string): string {
  tempCounter += 1;
  return `${absPath}.fqc-tmp-${process.pid}-${tempCounter}-${randomUUID()}`;
}

async function defaultDurableFileSync(
  handle: SyncableHandle,
  _context: DurableFileSyncContext
): Promise<void> {
  // Node currently exposes FileHandle.sync() across Linux and macOS, but not a
  // direct F_FULLFSYNC API. Keep the platform branch injectable so a native
  // implementation can be supplied later without changing caller code.
  await handle.sync();
}

export async function writeVaultFile(
  absPath: string,
  content: Buffer | string,
  options: WriteVaultFileOptions = {}
): Promise<VaultWriteResult> {
  const bytes = toBuffer(content);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const tempPath = nextTempPath(absPath);
  const dirPath = dirname(absPath);
  const ops = {
    mkdir,
    writeFile,
    open,
    rename,
    unlink,
    ...options.operations,
  };
  const durableFileSync = options.durableFileSync ?? defaultDurableFileSync;
  const platform = options.platform ?? process.platform;

  let originalError: unknown;

  try {
    await ops.mkdir(dirPath, { recursive: true });
    await ops.writeFile(tempPath, bytes);

    const fileHandle = await ops.open(tempPath, 'r');
    try {
      await durableFileSync(fileHandle, { platform });
    } finally {
      await fileHandle.close();
    }

    await ops.rename(tempPath, absPath);

    const dirHandle = await ops.open(dirPath, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }

    return { contentHash };
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    if (originalError) {
      try {
        await ops.unlink(tempPath);
      } catch {
        // Best-effort cleanup only; preserve the original filesystem error.
      }
    }
  }
}

export function isVaultTempFileName(name: string): boolean {
  return name.endsWith('.fqc-tmp') || /\.fqc-tmp-\d+-\d+-[0-9a-f-]+$/i.test(name);
}
