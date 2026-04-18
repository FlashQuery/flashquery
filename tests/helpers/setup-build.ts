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
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..', '..');

console.log('[integration-setup] Building production bundle (unconditional)...');
try {
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  console.log('[integration-setup] Built production bundle');
} catch (err) {
  throw new Error(`Failed to build production bundle: ${err instanceof Error ? err.message : String(err)}`);
}
