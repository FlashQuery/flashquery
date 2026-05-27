import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

type BatchItem = {
  identifier: string;
  status: 'succeeded' | 'conflicted' | 'failed';
  data?: Record<string, unknown>;
  error?: {
    error?: string;
    details?: { reason?: string };
    version_token?: string;
  };
};

async function readToken(harness: Phase155Harness, identifier: string): Promise<string> {
  const payload = parseToolJson<{ version_token?: string }>(
    await harness.handlers.get_document({ identifiers: identifier })
  );
  expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
  return payload.version_token ?? '';
}

function expectMixedBatchStatuses(results: BatchItem[], identifiers: string[]): void {
  expect(results).toHaveLength(3);
  expect(results.map((item) => item.identifier)).toEqual(identifiers);
  expect(results.map((item) => item.status)).toEqual(['succeeded', 'succeeded', 'conflicted']);
  expect(results[0]?.data?.version_token).toMatch(/^[a-f0-9]{64}$/);
  expect(results[1]?.data?.version_token).toMatch(/^[a-f0-9]{64}$/);
  expect(results[2]?.error).toMatchObject({
    error: 'conflict',
    details: { reason: 'version_mismatch' },
  });
  expect(results[2]?.error?.version_token).toMatch(/^[a-f0-9]{64}$/);
}

describe.skipIf(!HAS_SUPABASE)('REQ-019 mixed compound batch input integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-batch-input-shape-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', harness.instanceId);
    await harness?.cleanup();
  });

  it('T-I-038 insert_doc_link processes mixed bare/current/stale source identifiers in input order', async () => {
    const paths = [
      'phase163/link-bare.md',
      'phase163/link-current.md',
      'phase163/link-stale.md',
    ];
    await writeDocument(harness.handlers, 'phase163/link-target.md', 'Link Target', 'target body');
    for (const path of paths) {
      await writeDocument(harness.handlers, path, path, `${path} body`);
    }
    const currentToken = await readToken(harness, paths[1]);

    const results = parseToolJson<BatchItem[]>(await harness.handlers.insert_doc_link({
      identifiers: [
        paths[0],
        { identifier: paths[1], version_token: currentToken },
        { identifier: paths[2], version_token: '0'.repeat(64) },
      ],
      target_identifier: 'phase163/link-target.md',
      property: 'related',
    }));

    expect(Array.isArray(results)).toBe(true);
    expectMixedBatchStatuses(results, paths);
  });

  it('T-I-038 apply_tags processes mixed bare/current/stale document identifiers in input order', async () => {
    const paths = [
      'phase163/tags-bare.md',
      'phase163/tags-current.md',
      'phase163/tags-stale.md',
    ];
    for (const path of paths) {
      await writeDocument(harness.handlers, path, path, `${path} body`);
    }
    const currentToken = await readToken(harness, paths[1]);

    const results = parseToolJson<BatchItem[]>(await harness.handlers.apply_tags({
      identifiers: [
        paths[0],
        { identifier: paths[1], version_token: currentToken },
        { identifier: paths[2], version_token: '1'.repeat(64) },
      ],
      add_tags: ['#topic/phase163'],
    }));

    expectMixedBatchStatuses(results, paths);
  });

  it('T-I-038 apply_tags preserves existing memory target response semantics', async () => {
    const memoryId = randomUUID();
    const { error } = await supabaseManager.getClient().from('fqc_memory').insert({
      id: memoryId,
      instance_id: harness.instanceId,
      content: 'Memory target for mixed batch regression.',
      status: 'active',
      tags: ['#topic/original'],
      plugin_scope: 'global',
      is_latest: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    const results = parseToolJson<Array<Record<string, unknown>>>(await harness.handlers.apply_tags({
      targets: [{ entity_type: 'memory', identifier: memoryId }],
      add_tags: ['#topic/phase163-memory'],
    }));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      entity_type: 'memory',
      memory_id: memoryId,
      plugin_scope: 'global',
    });
    expect(results[0]?.status).toBeUndefined();
    expect(results[0]?.tags).toEqual(expect.arrayContaining(['#topic/original', '#topic/phase163-memory']));
  });

  it('T-I-038 apply_tags wraps a single document result when targets mixes documents and memories', async () => {
    const memoryId = randomUUID();
    const { error } = await supabaseManager.getClient().from('fqc_memory').insert({
      id: memoryId,
      instance_id: harness.instanceId,
      content: 'Memory target paired with a single document target.',
      status: 'active',
      tags: ['#topic/original'],
      plugin_scope: 'global',
      is_latest: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await writeDocument(harness.handlers, 'phase163/tags-one-doc.md', 'Tags One Doc', 'mixed target body');

    const results = parseToolJson<Array<Record<string, unknown>>>(await harness.handlers.apply_tags({
      targets: [
        { entity_type: 'document', identifier: 'phase163/tags-one-doc.md' },
        { entity_type: 'memory', identifier: memoryId },
      ],
      add_tags: ['#topic/phase163-mixed'],
    }));

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      identifier: 'phase163/tags-one-doc.md',
      status: 'succeeded',
      data: {
        entity_type: 'document',
        path: 'phase163/tags-one-doc.md',
      },
    });
    expect((results[0]?.data as Record<string, unknown> | undefined)?.version_token).toMatch(/^[a-f0-9]{64}$/);
    expect(results[1]).toMatchObject({
      entity_type: 'memory',
      memory_id: memoryId,
      plugin_scope: 'global',
    });
    expect(results[1]?.status).toBeUndefined();
  });
});
