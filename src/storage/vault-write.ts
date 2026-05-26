import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { open, rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { isDocumentLockHeldForPath } from '../services/document-lock.js';

const execFileAsync = promisify(execFile);

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
  path: string;
}

export interface WriteVaultFileOptions {
  operations?: VaultWriteOperations;
  durableFileSync?: (handle: SyncableHandle, context: DurableFileSyncContext) => Promise<void>;
  darwinFullFsync?: (path: string) => Promise<void>;
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
  context: DurableFileSyncContext
): Promise<void> {
  if (context.platform === 'darwin') {
    await defaultDarwinFullFsync(context.path);
    return;
  }
  await handle.sync();
}

async function defaultDarwinFullFsync(filePath: string): Promise<void> {
  const script = [
    'import fcntl, os, sys',
    'fd = os.open(sys.argv[1], os.O_RDONLY)',
    'try:',
    '    fcntl.fcntl(fd, 51)',
    'finally:',
    '    os.close(fd)',
  ].join('\n');

  await execFileAsync('/usr/bin/python3', ['-c', script, filePath]);
}

/**
 * Durable atomic vault-file write primitive.
 *
 * Callers MUST hold `withDocumentLock(config, absPath)` (or equivalent) before
 * invoking this primitive; see REQ-020 AC #4 / INV-10. The primitive does not
 * take the lock internally. Set `FQC_LOCK_ASSERT=true` in dev/test processes to
 * make missing ambient document locks fail fast.
 */
export async function writeVaultFile(
  absPath: string,
  content: Buffer | string,
  options: WriteVaultFileOptions = {}
): Promise<VaultWriteResult> {
  if (process.env.FQC_LOCK_ASSERT === 'true' && !isDocumentLockHeldForPath(absPath)) {
    throw new Error(
      `writeVaultFile(${absPath}) called without holding withDocumentLock for that path`
    );
  }

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
  const durableFileSync =
    options.durableFileSync ??
    ((handle, context) =>
      context.platform === 'darwin' && options.darwinFullFsync
        ? options.darwinFullFsync(context.path)
        : defaultDurableFileSync(handle, context));
  const platform = options.platform ?? process.platform;

  let originalError: unknown;

  try {
    await ops.mkdir(dirPath, { recursive: true });
    await ops.writeFile(tempPath, bytes);

    const fileHandle = await ops.open(tempPath, 'r');
    try {
      await durableFileSync(fileHandle, { platform, path: tempPath });
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
