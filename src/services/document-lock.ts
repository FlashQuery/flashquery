import path from 'node:path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { access, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Mutex } from 'async-mutex';
import type { FlashQueryConfig } from '../config/types.js';
import { withPgClient } from '../utils/pg-client.js';

const TIER1_STRIPE_COUNT = 1024;
const TIER2_RETRY_DELAY_MS = 25;
const tier1Stripes = Array.from({ length: TIER1_STRIPE_COUNT }, () => new Mutex());
const heldDocumentLocks = new AsyncLocalStorage<Set<string>>();
const vaultCaseSensitivity = new Map<string, Promise<boolean>>();

export class LockTimeoutError extends Error {
  readonly reason = 'lock_timeout';
  readonly resource: string;
  readonly timeoutSeconds: number;

  constructor(resource: string, timeoutSeconds = 10) {
    super(
      `Write lock timeout: another instance is writing to ${resource}. Retry in a few seconds.`
    );
    this.name = 'LockTimeoutError';
    this.resource = resource;
    this.timeoutSeconds = timeoutSeconds;
  }
}

interface DocumentLockEntry {
  basicKey: string;
  resource: string;
  stripeIndex: number;
}

interface DocumentLockKeyConfig {
  instance: {
    vault?: {
      path: string;
    };
  };
}

interface BurstRequest<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timer?: NodeJS.Timeout;
}

interface BurstState {
  entries: DocumentLockEntry[];
  stripeIndices: number[];
  queue: BurstRequest<unknown>[];
}

const activeBursts = new Map<string, BurstState>();

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function timeoutMs(config: FlashQueryConfig): number {
  return (config.locking.lockTimeoutSeconds ?? 10) * 1000;
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireTier1StripeWithTimeout(
  stripeIndex: number,
  entry: DocumentLockEntry,
  deadline: number,
  timeoutSeconds: number
): Promise<() => void> {
  let timeout: NodeJS.Timeout | undefined;
  let acquired = false;
  const acquire = tier1Stripes[stripeIndex].acquire();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new LockTimeoutError(entry.resource, timeoutSeconds)),
      remainingMs(deadline)
    );
    timeout.unref?.();
  });

  try {
    const release = await Promise.race([acquire, timeoutPromise]);
    acquired = true;
    return release;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!acquired) {
      acquire.then((release) => release()).catch(() => undefined);
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeRealpath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function isCaseInsensitiveVault(vaultRoot: string): Promise<boolean> {
  const resolvedVault = await safeRealpath(vaultRoot);
  const cached = vaultCaseSensitivity.get(resolvedVault);
  if (cached) return cached;
  if (!(await pathExists(resolvedVault))) return false;

  const probe = (async () => {
    const probeDir = await mkdtemp(path.join(resolvedVault, '.flashquery-case-probe-'));
    const probeFile = path.join(probeDir, 'CaseProbe');
    try {
      const handle = await open(probeFile, 'w');
      await handle.close();
      return pathExists(path.join(probeDir, 'caseprobe'));
    } finally {
      await rm(probeDir, { recursive: true, force: true });
    }
  })();

  vaultCaseSensitivity.set(resolvedVault, probe);
  return probe;
}

async function canonicalPathFor(
  vaultRoot: string,
  filePath: string,
  kind: 'file' | 'dir'
): Promise<string> {
  const resolvedVault = await safeRealpath(vaultRoot);
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(resolvedVault, filePath);
  const normalizedPath = path.normalize(absolutePath);
  let canonicalPath: string;

  if (kind === 'dir') {
    canonicalPath = await safeRealpath(normalizedPath);
  } else if (await pathExists(normalizedPath)) {
    canonicalPath = await safeRealpath(normalizedPath);
  } else {
    const parent = await safeRealpath(path.dirname(normalizedPath));
    canonicalPath = path.join(parent, path.basename(normalizedPath));
  }

  return (await isCaseInsensitiveVault(resolvedVault))
    ? canonicalPath.toLocaleLowerCase('en-US')
    : canonicalPath;
}

async function toEntry(
  config: DocumentLockKeyConfig,
  filePath: string,
  kind: 'file' | 'dir' = 'file'
): Promise<DocumentLockEntry> {
  const vaultRoot = config.instance.vault?.path ?? path.dirname(path.resolve(filePath));
  const canonicalPath = await canonicalPathFor(vaultRoot, filePath, kind);
  const basicKey = `${kind}:${canonicalPath}`;
  return {
    basicKey,
    resource: basicKey,
    stripeIndex: hashString(basicKey) % TIER1_STRIPE_COUNT,
  };
}

async function uniqueSortedEntries(
  config: FlashQueryConfig,
  filePaths: string[]
): Promise<DocumentLockEntry[]> {
  const byKey = new Map<string, DocumentLockEntry>();
  for (const filePath of filePaths) {
    const entry = await toEntry(config, filePath);
    byKey.set(entry.basicKey, entry);
  }
  return [...byKey.values()].sort((a, b) => a.basicKey.localeCompare(b.basicKey));
}

async function uniqueSortedDirectoryEntries(
  config: FlashQueryConfig,
  dirPaths: string[]
): Promise<DocumentLockEntry[]> {
  const byKey = new Map<string, DocumentLockEntry>();
  for (const dirPath of dirPaths) {
    const entry = await toEntry(config, dirPath, 'dir');
    byKey.set(entry.basicKey, entry);
  }
  return [...byKey.values()].sort((a, b) => a.basicKey.localeCompare(b.basicKey));
}

async function ancestorDirectoryEntries(
  config: FlashQueryConfig,
  filePath: string
): Promise<DocumentLockEntry[]> {
  const vaultRoot = config.instance.vault?.path ?? path.dirname(path.resolve(filePath));
  const resolvedVault = path.normalize(await canonicalPathFor(vaultRoot, vaultRoot, 'dir'));
  const absolutePath = await canonicalPathFor(resolvedVault, filePath, 'file');
  let current = path.dirname(path.normalize(absolutePath));
  const directories: string[] = [];

  while (true) {
    const relative = path.relative(resolvedVault, current);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      directories.push(current);
      if (current === resolvedVault) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
      continue;
    }
    break;
  }

  if (directories.length === 0 || directories[directories.length - 1] !== resolvedVault) {
    throw new Error(`Directory lock path escapes vault root: ${filePath}`);
  }

  const byKey = new Map<string, DocumentLockEntry>();
  for (const directory of directories) {
    const entry = await toEntry(config, directory, 'dir');
    byKey.set(entry.basicKey, entry);
  }
  return [...byKey.values()].sort((a, b) => a.basicKey.localeCompare(b.basicKey));
}

function toBurstKey(entries: DocumentLockEntry[]): string {
  return entries.map((entry) => entry.basicKey).join('\n');
}

function toAdvisoryKey(entry: DocumentLockEntry): string {
  const digest = createHash('sha256').update(entry.resource).digest();
  return digest.readBigInt64BE(0).toString();
}

export async function isDocumentLockHeldForPath(
  config: DocumentLockKeyConfig,
  filePath: string
): Promise<boolean> {
  const held = heldDocumentLocks.getStore();
  if (!held) return false;
  const entry = await toEntry(config, filePath, 'file');
  return held.has(entry.basicKey);
}

async function runWithTier2<T>(
  config: FlashQueryConfig,
  entries: DocumentLockEntry[],
  deadline: number,
  fn: () => Promise<T>
): Promise<T> {
  return runWithAdvisoryLocks(config, entries, deadline, 'exclusive', 'document', fn);
}

async function runWithAdvisoryLocks<T>(
  config: FlashQueryConfig,
  entries: DocumentLockEntry[],
  deadline: number,
  mode: 'exclusive' | 'shared',
  label: 'document' | 'directory',
  fn: () => Promise<T>
): Promise<T> {
  if (!config.locking.enabled) return fn();

  const advisoryKeys = entries.map(toAdvisoryKey);
  const configuredTimeoutSeconds = config.locking.lockTimeoutSeconds ?? 10;
  const acquireSql =
    mode === 'shared'
      ? 'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired'
      : 'SELECT pg_try_advisory_lock($1::bigint) AS acquired';
  const releaseSql =
    mode === 'shared'
      ? 'SELECT pg_advisory_unlock_shared($1::bigint) AS released'
      : 'SELECT pg_advisory_unlock($1::bigint) AS released';

  return withPgClient(config.supabase.databaseUrl, async (client) => {
    const acquiredKeys: string[] = [];
    let callbackResult: T | undefined;
    let callbackError: unknown;
    let releaseError: Error | undefined;

    try {
      for (const [index, advisoryKey] of advisoryKeys.entries()) {
        while (true) {
          if (remainingMs(deadline) <= 0) {
            throw new LockTimeoutError(
              entries[index]?.resource ?? entries[0]?.resource ?? `${label} lock`,
              configuredTimeoutSeconds
            );
          }
          const result = await client.query<{ acquired: boolean }>(acquireSql, [advisoryKey]);
          if (result.rows[0]?.acquired === true) {
            acquiredKeys.push(advisoryKey);
            break;
          }
          await sleep(Math.min(TIER2_RETRY_DELAY_MS, remainingMs(deadline)));
        }
      }

      try {
        callbackResult = await fn();
      } catch (err) {
        callbackError = err;
      }
    } finally {
      for (const advisoryKey of [...acquiredKeys].reverse()) {
        try {
          const result = await client.query<{ released: boolean }>(
            releaseSql,
            [advisoryKey]
          );
          if (result.rows[0]?.released !== true) {
            releaseError = new Error(`Failed to release advisory ${label} lock ${advisoryKey}`);
          }
        } catch (err) {
          releaseError =
            err instanceof Error
              ? err
              : new Error(`Failed to release advisory ${label} lock ${advisoryKey}`);
        }
      }
    }

    if (!callbackError && releaseError) throw releaseError;
    if (callbackError) {
      if (callbackError instanceof Error) throw callbackError;
      throw new Error('Document lock callback threw a non-Error value.');
    }
    return callbackResult as T;
  });
}

async function runWithDirectoryLocks<T>(
  config: FlashQueryConfig,
  entries: DocumentLockEntry[],
  mode: 'exclusive' | 'shared',
  fn: () => Promise<T>
): Promise<T> {
  if (entries.length === 0) return fn();
  const deadline = Date.now() + timeoutMs(config);
  return runWithAdvisoryLocks(config, entries, deadline, mode, 'directory', fn);
}

export async function withAncestorDirectoryLocksShared<T>(
  config: FlashQueryConfig,
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const entries = await ancestorDirectoryEntries(config, filePath);
  return runWithDirectoryLocks(config, entries, 'shared', fn);
}

export async function withDirectoryLockExclusive<T>(
  config: FlashQueryConfig,
  dirPath: string,
  fn: () => Promise<T>
): Promise<T> {
  return withDirectoryLocksExclusive(config, [dirPath], fn);
}

export async function withDirectoryLocksExclusive<T>(
  config: FlashQueryConfig,
  dirPaths: string[],
  fn: () => Promise<T>
): Promise<T> {
  const entries = await uniqueSortedDirectoryEntries(config, dirPaths);
  return runWithDirectoryLocks(config, entries, 'exclusive', fn);
}

export async function withDocumentLock<T>(
  config: FlashQueryConfig,
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  return withDocumentLocks(config, [filePath], fn);
}

export async function withDocumentLocks<T>(
  config: FlashQueryConfig,
  filePaths: string[],
  fn: () => Promise<T>
): Promise<T> {
  const entries = await uniqueSortedEntries(config, filePaths);
  if (entries.length === 0) return fn();
  const deadline = Date.now() + timeoutMs(config);
  const configuredTimeoutSeconds = config.locking.lockTimeoutSeconds ?? 10;
  const stripeIndices = [...new Set(entries.map((entry) => entry.stripeIndex))].sort(
    (a, b) => a - b
  );
  const burstKey = toBurstKey(entries);
  const activeBurst = activeBursts.get(burstKey);

  if (activeBurst) {
    return new Promise<T>((resolve, reject) => {
      const request: BurstRequest<unknown> = {
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      request.timer = setTimeout(() => {
        const index = activeBurst.queue.indexOf(request);
        if (index >= 0) activeBurst.queue.splice(index, 1);
        reject(new LockTimeoutError(entries[0].resource, configuredTimeoutSeconds));
      }, remainingMs(deadline));
      activeBurst.queue.push(request);
    });
  }

  const burstState: BurstState = {
    entries,
    stripeIndices,
    queue: [],
  };

  activeBursts.set(burstKey, burstState);

  const initialPromise = new Promise<T>((resolve, reject) => {
    burstState.queue.push({ fn, resolve: resolve as (value: unknown) => void, reject });
  });

  const tier1Releases: Array<() => void> = [];

  void (async () => {
    const outcomes: Array<
      | { request: BurstRequest<unknown>; status: 'fulfilled'; value: unknown }
      | { request: BurstRequest<unknown>; status: 'rejected'; reason: unknown }
    > = [];

    try {
      for (const stripeIndex of stripeIndices) {
        const entry =
          entries.find((candidate) => candidate.stripeIndex === stripeIndex) ?? entries[0];
        const releaseTier1 = await acquireTier1StripeWithTimeout(
          stripeIndex,
          entry,
          deadline,
          configuredTimeoutSeconds
        );
        tier1Releases.push(releaseTier1);
      }

      await runWithTier2(config, entries, deadline, async () => {
        while (burstState.queue.length > 0) {
          const request = burstState.queue.shift();
          if (!request) continue;
          if (request.timer) clearTimeout(request.timer);
          const inheritedLocks = heldDocumentLocks.getStore();
          const activeLocks = new Set(inheritedLocks ?? []);
          for (const entry of entries) {
            activeLocks.add(entry.basicKey);
          }

          try {
            const result = await heldDocumentLocks.run(activeLocks, request.fn);
            outcomes.push({ request, status: 'fulfilled', value: result });
          } catch (err) {
            outcomes.push({ request, status: 'rejected', reason: err });
          }
        }
      });

      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') {
          outcome.request.resolve(outcome.value);
        } else {
          outcome.request.reject(outcome.reason);
        }
      }
    } catch (err) {
      for (const outcome of outcomes) {
        outcome.request.reject(outcome.status === 'rejected' ? outcome.reason : err);
      }
      for (const request of burstState.queue.splice(0)) {
        if (request.timer) clearTimeout(request.timer);
        request.reject(err);
      }
    } finally {
      activeBursts.delete(burstKey);
      for (const releaseTier1 of [...tier1Releases].reverse()) {
        releaseTier1();
      }
    }
  })();

  return initialPromise;
}

export const __testing = {
  deriveDocumentLockEntry: toEntry,
  deriveAdvisoryKey: async (
    config: DocumentLockKeyConfig,
    resourcePath: string,
    kind: 'file' | 'dir' = 'file'
  ) => toAdvisoryKey(await toEntry(config, resourcePath, kind)),
  clearCaseSensitivityCache: () => vaultCaseSensitivity.clear(),
  setCaseInsensitiveForVault: async (vaultRoot: string, isInsensitive: boolean) => {
    vaultCaseSensitivity.set(await safeRealpath(vaultRoot), Promise.resolve(isInsensitive));
  },
};
