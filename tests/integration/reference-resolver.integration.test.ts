import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding, embeddingProvider } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { logger } from '../../src/logging/logger.js';
import { resolveReferences, hydrateMessages, buildInjectedReferences } from '../../src/llm/reference-resolver.js';
import { TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const INSTANCE_ID = `reference-resolver-${Date.now()}`;

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'reference-resolver-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none' as never, model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function seedDocument(vaultPath: string, relPath: string, title: string, body: string, extra: Record<string, unknown> = {}): Promise<string> {
  const fqcId = randomUUID();
  const frontmatter = { [FM.ID]: fqcId, [FM.TITLE]: title, [FM.STATUS]: 'active', [FM.TAGS]: [], ...extra };
  const raw = matter.stringify(body, frontmatter);
  await mkdir(dirname(join(vaultPath, relPath)), { recursive: true });
  await writeFile(join(vaultPath, relPath), raw, 'utf-8');
  const { error } = await supabaseManager.getClient().from('fqc_documents').insert({
    id: fqcId,
    instance_id: INSTANCE_ID,
    path: relPath,
    title,
    status: 'active',
    tags: [],
    content_hash: hash(raw),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  expect(error).toBeNull();
  return fqcId;
}

describe.skipIf(!HAS_SUPABASE)('reference resolver integration (ATL-I-04)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let supabaseReady = false;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-reference-resolver-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    supabaseReady = true;
    initEmbedding(config);
    await initVault(config);
  }, 30000);

  afterAll(async () => {
    if (supabaseReady) {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    }
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('hydrates path, fq_id, section, pointer, ambiguity, and non-recursive metadata against real vault files', async () => {
    const targetId = await seedDocument(vaultPath, 'Refs/target.md', 'Target', 'TARGET BODY\n\n## Details\n\nSECTION BODY\n');
    await seedDocument(vaultPath, 'Refs/source.md', 'Source', 'SOURCE BODY', { pointer: 'Refs/target.md' });
    await seedDocument(vaultPath, 'Dup/a/shared.md', 'Shared A', 'A');
    await seedDocument(vaultPath, 'Dup/b/shared.md', 'Shared B', 'B');
    await seedDocument(vaultPath, 'Refs/nested.md', 'Nested', 'NESTED BODY');
    await seedDocument(vaultPath, 'Refs/injects-nested.md', 'Injects Nested', 'literal {{ref:Refs/nested.md}} remains');

    const parsed = [
      { placeholder: '{{ref:Refs/target.md}}', ref: '{{ref:Refs/target.md}}', identifierType: 'ref' as const, identifier: 'Refs/target.md', messageIndex: 0 },
      { placeholder: `{{ref:${targetId}}}`, ref: `{{ref:${targetId}}}`, identifierType: 'ref' as const, identifier: targetId, messageIndex: 0 },
      { placeholder: '{{ref:target}}', ref: '{{ref:target}}', identifierType: 'ref' as const, identifier: 'target', messageIndex: 0 },
      { placeholder: '{{ref:Refs/target.md#Details}}', ref: '{{ref:Refs/target.md#Details}}', identifierType: 'ref' as const, identifier: 'Refs/target.md', section: 'Details', messageIndex: 0 },
      { placeholder: '{{ref:Refs/source.md->pointer}}', ref: '{{ref:Refs/source.md->pointer}}', identifierType: 'ref' as const, identifier: 'Refs/source.md', pointer: 'pointer', messageIndex: 0 },
      { placeholder: '{{ref:shared}}', ref: '{{ref:shared}}', identifierType: 'ref' as const, identifier: 'shared', messageIndex: 0 },
      { placeholder: '{{ref:Refs/injects-nested.md}}', ref: '{{ref:Refs/injects-nested.md}}', identifierType: 'ref' as const, identifier: 'Refs/injects-nested.md', messageIndex: 0 },
    ];

    const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger);
    const failures = resolved.filter((entry) => entry.kind === 'failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      reason: 'ambiguous_document_identifier',
    });
    expect(failures[0].detail).toContain('Use a vault-relative path or fq_id');

    const successes = resolved.filter((entry) => entry.kind === 'resolved');
    expect(successes).toHaveLength(6);
    const metadata = buildInjectedReferences(successes);
    expect(metadata).toContainEqual({ ref: `{{ref:${targetId}}}`, chars: expect.any(Number), resolved_to: 'Refs/target.md' });
    expect(metadata).toContainEqual({ ref: '{{ref:target}}', chars: expect.any(Number), resolved_to: 'Refs/target.md' });
    expect(metadata).toContainEqual({ ref: '{{ref:Refs/source.md->pointer}}', chars: expect.any(Number), resolved_to: 'Refs/target.md' });
    expect(metadata.find((entry) => entry.ref === '{{ref:Refs/target.md}}')).not.toHaveProperty('resolved_to');

    const hydrated = hydrateMessages([
      { role: 'user', content: successes.map((entry) => entry.placeholder).join('\n') },
    ], successes);
    expect(hydrated[0].content).toContain('TARGET BODY');
    expect(hydrated[0].content).toContain('SECTION BODY');
    expect(hydrated[0].content).toContain('literal {{ref:Refs/nested.md}} remains');
  });
});
