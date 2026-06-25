/**
 * Integration test setup: Build production bundle before tests run
 *
 * The integration tests spawn the CLI via `node dist/index.js`.
 * This setup file ensures the production bundle is built and current
 * before any test attempts to spawn the process.
 *
 * Unconditional rebuild: always runs tsup regardless of whether dist/index.js
 * already exists, so a stale dist from a prior commit cannot leak into an E2E run.
 */

import { execSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..', '..');
const distDir = join(projectRoot, 'dist');
const lockPath = join(projectRoot, 'dist', '.e2e-build.lock');
const buildCompletePath = join(projectRoot, 'dist', `.e2e-build.${process.ppid}.complete`);
const staleLockMs = 5 * 60 * 1000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireBuildLock(): () => void {
  mkdirSync(distDir, { recursive: true });
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // Another process may have removed a stale lock; nothing to release.
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() - statSync(lockPath).mtimeMs;
        if (ageMs > staleLockMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      sleep(250);
    }
  }
}

console.log('[integration-setup] Waiting for production bundle build lock...');
const releaseBuildLock = acquireBuildLock();
try {
  if (existsSync(buildCompletePath)) {
    console.log('[integration-setup] Production bundle already built for this Vitest run');
  } else {
    console.log('[integration-setup] Building production bundle (unconditional per Vitest run)...');
    execSync('npm run build', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    writeFileSync(buildCompletePath, `${process.pid}\n${new Date().toISOString()}\n`);
    console.log('[integration-setup] Built production bundle');
  }
} catch (err) {
  throw new Error(`Failed to build production bundle: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (existsSync(lockPath)) releaseBuildLock();
}
