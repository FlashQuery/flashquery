import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import { __testing as documentLockTesting } from '../../src/services/document-lock.js';
import { HAS_SESSION_CAPABLE_DATABASE_URL } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

function payload(result: unknown): Record<string, unknown> {
  return parseToolJson<Record<string, unknown>>(result);
}

function isExpectedDestinationConflict(result: unknown): boolean {
  const body = payload(result);
  const details = body.details as { reason?: string } | undefined;
  return (
    body.error === 'conflict' &&
    (details?.reason === 'path_exists' || details?.reason === 'lock_timeout')
  );
}

function expectOneSuccessAndOneConflict(results: unknown[]): void {
  const successes = results.filter(
    (result) => !(result as ToolResult).isError && !payload(result).error
  );
  const conflicts = results.filter(isExpectedDestinationConflict);

  expect(successes).toHaveLength(1);
  expect(conflicts).toHaveLength(1);
}

describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-008 destination-lock integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-destination-lock-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
    harness.config.locking = { enabled: true, lockTimeoutSeconds: 1 };
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-014 copy_document destination race returns exactly one winner and one conflict', async () => {
    await writeDocument(harness.handlers, 'phase161/copy-source.md', 'Copy Source', 'copy body');

    const results = await Promise.all([
      harness.handlers.copy_document({
        identifier: 'phase161/copy-source.md',
        destination: 'phase161/copy-dest.md',
      }),
      harness.handlers.copy_document({
        identifier: 'phase161/copy-source.md',
        destination: 'phase161/copy-dest.md',
      }),
    ]);

    expectOneSuccessAndOneConflict(results);
  }, 40_000);

  it('T-I-015 move_document source and destination locks sort by canonical basic key', async () => {
    await writeDocument(harness.handlers, 'phase161/sort-source.md', 'Sort Source', 'sort body');

    const source = `${harness.vaultPath}/phase161/sort-source.md`;
    const destination = `${harness.vaultPath}/phase161/sort-dest.md`;
    const expectedEntries = await Promise.all([
      documentLockTesting.deriveDocumentLockEntry(harness.config, source),
      documentLockTesting.deriveDocumentLockEntry(harness.config, destination),
    ]);
    const expectedOrder = expectedEntries
      .sort((a, b) => a.basicKey.localeCompare(b.basicKey))
      .map((entry) => documentLockTesting.advisoryKeyForEntry(entry));

    const result = await documentLockTesting.withAdvisoryLockTrace(async (trace) => {
      const moveResult = await harness.handlers.move_document({
        identifier: 'phase161/sort-source.md',
        destination: 'phase161/sort-dest.md',
      });
      expect(
        trace
          .filter((entry) => entry.label === 'document' && entry.mode === 'exclusive')
          .map((entry) => entry.advisoryKey)
      ).toEqual(expectedOrder);
      return moveResult;
    });

    expect((result as ToolResult).isError).toBeFalsy();
    expect(payload(result)).toMatchObject({ path: 'phase161/sort-dest.md' });
  }, 40_000);

  it('T-I-016 move_document destination race returns exactly one winner and one conflict', async () => {
    await writeDocument(harness.handlers, 'phase161/move-a.md', 'Move A', 'move a');
    await writeDocument(harness.handlers, 'phase161/move-b.md', 'Move B', 'move b');

    const results = await Promise.all([
      harness.handlers.move_document({
        identifier: 'phase161/move-a.md',
        destination: 'phase161/move-dest.md',
      }),
      harness.handlers.move_document({
        identifier: 'phase161/move-b.md',
        destination: 'phase161/move-dest.md',
      }),
    ]);

    expectOneSuccessAndOneConflict(results);
  }, 40_000);

  it('T-I-048 write_document create destination race returns exactly one winner and one conflict', async () => {
    const results = await Promise.all([
      harness.handlers.write_document({
        mode: 'create',
        path: 'phase161/create-race.md',
        title: 'Create Race',
        content: 'first',
      }),
      harness.handlers.write_document({
        mode: 'create',
        path: 'phase161/create-race.md',
        title: 'Create Race',
        content: 'second',
      }),
    ]);

    expectOneSuccessAndOneConflict(results);
  }, 40_000);
});
