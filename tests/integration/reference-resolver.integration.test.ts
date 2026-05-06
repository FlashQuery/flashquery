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
import { parseReferences, resolveReferences, hydrateMessages, buildInjectedReferences } from '../../src/llm/reference-resolver.js';
import type { FailedRef, ParsedRef, ResolvedRef } from '../../src/llm/reference-resolver.js';
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

  it('[I-TMPL-01] renders fq_template true documents with path-keyed string template_params', async () => {
    await seedDocument(vaultPath, 'Templates/greeting.md', 'Greeting Template', 'Hello {{name}}.', {
      fq_template: true,
      fq_params: {
        name: { type: 'string', required: true },
      },
    });

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:Templates/greeting.md}}',
        ref: '{{ref:Templates/greeting.md}}',
        identifierType: 'ref',
        identifier: 'Templates/greeting.md',
        messageIndex: 0,
      },
    ];

    const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger, {
      'Templates/greeting.md': { name: 'Ada' },
    });
    const successes = resolved.filter((entry): entry is ResolvedRef => entry.kind === 'resolved');
    expect(successes).toHaveLength(1);
    expect(successes[0].content).toBe('Hello Ada.\n');

    const hydrated = hydrateMessages([
      { role: 'user', content: 'Render {{ref:Templates/greeting.md}}' },
    ], successes);
    expect(hydrated[0].content).toBe('Render Hello Ada.\n');

    const metadata = buildInjectedReferences(successes);
    expect(metadata[0]).toMatchObject({
      ref: '{{ref:Templates/greeting.md}}',
      chars: 'Hello Ada.\n'.length,
      template: true,
      template_path: 'Templates/greeting.md',
      template_params_used: {
        name: { type: 'string', chars: 3 },
      },
    });
  });

  it('[I-TMPL-02] ignores template_params for real plain documents', async () => {
    await seedDocument(vaultPath, 'Docs/plain-template-looking.md', 'Plain Doc', 'Hello {{name}}.');

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:Docs/plain-template-looking.md}}',
        ref: '{{ref:Docs/plain-template-looking.md}}',
        identifierType: 'ref',
        identifier: 'Docs/plain-template-looking.md',
        messageIndex: 0,
      },
    ];

    const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger, {
      'Docs/plain-template-looking.md': { name: 'Ada' },
    });
    const successes = resolved.filter((entry): entry is ResolvedRef => entry.kind === 'resolved');
    expect(successes).toHaveLength(1);
    expect(successes[0].content).toBe('Hello {{name}}.\n');

    const metadata = buildInjectedReferences(successes);
    expect(metadata[0]).not.toHaveProperty('template');
    expect(metadata[0]).not.toHaveProperty('template_params_used');
  });

  it('[I-TMPL-03] resolves real document template params by path and fq_id', async () => {
    const sourceId = await seedDocument(vaultPath, 'Sources/source.md', 'Source Doc', 'SOURCE BODY');
    await seedDocument(vaultPath, 'Templates/with-source.md', 'Source Template', 'Name: {{name}}\nSource:\n{{source}}', {
      fq_template: true,
      fq_params: {
        name: { type: 'string', required: true },
        source: { type: 'document', required: true },
      },
    });

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:Templates/with-source.md}}',
        ref: '{{ref:Templates/with-source.md}}',
        identifierType: 'ref',
        identifier: 'Templates/with-source.md',
        messageIndex: 0,
      },
      {
        placeholder: '{{ref:Templates/with-source.md}}',
        ref: '{{ref:Templates/with-source.md}}',
        identifierType: 'ref',
        identifier: 'Templates/with-source.md',
        messageIndex: 0,
      },
    ];

    const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger, {
      'Templates/with-source.md': { name: 'Ada', source: 'Sources/source.md' },
    });
    const byPath = resolved[0] as ResolvedRef;
    expect(byPath.kind).toBe('resolved');
    expect(byPath.content).toBe('Name: Ada\nSource:\nSOURCE BODY\n\n');
    expect(buildInjectedReferences([byPath])[0].template_params_used).toEqual({
      name: { type: 'string', chars: 3 },
      source: { type: 'document', input: 'Sources/source.md', chars: 12, resolved_to: 'Sources/source.md' },
    });

    const byId = await resolveReferences([parsed[0]], config, supabaseManager, embeddingProvider, logger, {
      'Templates/with-source.md': { name: 'Grace', source: sourceId },
    });
    const resolvedById = byId[0] as ResolvedRef;
    expect(resolvedById.kind).toBe('resolved');
    expect(resolvedById.content).toBe('Name: Grace\nSource:\nSOURCE BODY\n\n');
    expect(buildInjectedReferences([resolvedById])[0].template_params_used?.source).toEqual({
      type: 'document',
      input: sourceId,
      chars: 12,
      resolved_to: 'Sources/source.md',
    });
  });

  it('[I-TMPL-04] returns template_param_doc_not_found for missing real document params', async () => {
    await seedDocument(vaultPath, 'Templates/missing-source.md', 'Missing Source Template', 'Source:\n{{source}}', {
      fq_template: true,
      fq_params: {
        source: { type: 'document', required: true },
      },
    });

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:Templates/missing-source.md}}',
        ref: '{{ref:Templates/missing-source.md}}',
        identifierType: 'ref',
        identifier: 'Templates/missing-source.md',
        messageIndex: 0,
      },
    ];

    const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger, {
      'Templates/missing-source.md': { source: 'Sources/missing.md' },
    });
    const failed = resolved[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('template_param_doc_not_found');
    expect(failed.detail).toContain('source');
    expect(failed.detail).toContain('Sources/missing.md');
  });

  it('[I-TMPL-05] renders two aliases through the same real _template with different values', async () => {
    await seedDocument(vaultPath, 'Templates/review.md', 'Review Template', 'Criteria: {{criteria}}', {
      fq_template: true,
      fq_params: {
        criteria: { type: 'string', required: true },
      },
    });
    const message = 'First {{ref:@first}}\nSecond {{ref:@second}}';
    const parsed = parseReferences([{ role: 'user', content: message }]);
    expect(Array.isArray(parsed)).toBe(true);

    const resolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      first: { _template: 'Templates/review.md', criteria: 'completeness' },
      second: { _template: 'Templates/review.md', criteria: 'consistency' },
    });
    const successes = resolved.filter((entry): entry is ResolvedRef => entry.kind === 'resolved');
    expect(successes).toHaveLength(2);

    const hydrated = hydrateMessages([{ role: 'user', content: message }], successes);
    expect(hydrated[0].content).toBe('First Criteria: completeness\n\nSecond Criteria: consistency\n');

    const metadata = buildInjectedReferences(successes);
    expect(metadata).toEqual([
      expect.objectContaining({
        ref: '{{ref:@first}}',
        resolved_to: 'Templates/review.md',
        template: true,
        template_path: 'Templates/review.md',
        template_params_used: { criteria: { type: 'string', chars: 12 } },
      }),
      expect.objectContaining({
        ref: '{{ref:@second}}',
        resolved_to: 'Templates/review.md',
        template: true,
        template_path: 'Templates/review.md',
        template_params_used: { criteria: { type: 'string', chars: 11 } },
      }),
    ]);
  });

  it('[I-TMPL-06] renders alias _items in caller order with _separator and ordered metadata', async () => {
    await seedDocument(vaultPath, 'List/a.md', 'List A', 'ALPHA');
    await seedDocument(vaultPath, 'Templates/item.md', 'Item Template', 'Item: {{label}}', {
      fq_template: true,
      fq_params: {
        label: { type: 'string', required: true },
      },
    });
    const message = 'Background:\n{{ref:@background}}';
    const parsed = parseReferences([{ role: 'user', content: message }]);
    expect(Array.isArray(parsed)).toBe(true);

    const resolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      background: {
        _items: [
          'List/a.md',
          { _template: 'Templates/item.md', label: 'Beta' },
        ],
        _separator: '\n---\n',
      },
    });
    const successes = resolved.filter((entry): entry is ResolvedRef => entry.kind === 'resolved');
    expect(successes).toHaveLength(1);
    expect(successes[0].content).toBe('ALPHA\n\n---\nItem: Beta\n');

    const hydrated = hydrateMessages([{ role: 'user', content: message }], successes);
    expect(hydrated[0].content).toBe('Background:\nALPHA\n\n---\nItem: Beta\n');

    const metadata = buildInjectedReferences(successes);
    expect(metadata[0]).toMatchObject({
      ref: '{{ref:@background}}',
      chars: 'ALPHA\n\n---\nItem: Beta\n'.length,
      resolved_to_count: 2,
      template_params_used: {},
      items: [
        { input: 'List/a.md', resolved_to: 'List/a.md', chars: 6 },
        {
          input: 'Templates/item.md',
          resolved_to: 'Templates/item.md',
          chars: 11,
          template: true,
          template_path: 'Templates/item.md',
          template_params_used: { label: { type: 'string', chars: 4 } },
        },
      ],
    });

    const defaultSeparatorResolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      background: {
        _items: ['List/a.md', { _template: 'Templates/item.md', label: 'Beta' }],
      },
    });
    const defaultSeparatorSuccess = defaultSeparatorResolved[0] as ResolvedRef;
    expect(defaultSeparatorSuccess.kind).toBe('resolved');
    expect(defaultSeparatorSuccess.content).toBe('ALPHA\n\n\nItem: Beta\n');

    const invalidSeparatorResolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      background: {
        _items: ['List/a.md'],
        _separator: 42,
      },
    });
    const invalidSeparatorFailed = invalidSeparatorResolved[0] as FailedRef;
    expect(invalidSeparatorFailed.kind).toBe('failed');
    expect(invalidSeparatorFailed.reason).toBe('multi_ref_invalid_value');
    expect(invalidSeparatorFailed.detail).toContain('_separator');
  });

  it('[I-TMPL-07] returns multi_ref_item_failed with alias and zero-based index detail', async () => {
    await seedDocument(vaultPath, 'Docs/plain.md', 'Plain', 'Plain {{label}} body');
    const parsed = parseReferences([{ role: 'user', content: '{{ref:@background}}' }]);
    expect(Array.isArray(parsed)).toBe(true);

    const resolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      background: {
        _items: ['List/missing.md'],
        _separator: '\n\n',
      },
    });
    const failed = resolved[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('multi_ref_item_failed');
    expect(failed.detail).toContain('alias=background');
    expect(failed.detail).toContain('index=0');
    expect(failed.detail).toContain('item 0');
    expect(failed.detail).toContain('document_not_found');

    const plainTemplateResolved = await resolveReferences(parsed as ParsedRef[], config, supabaseManager, embeddingProvider, logger, {
      background: {
        _items: [{ _template: 'Docs/plain.md', label: 'Ada' }],
      },
    });
    const plainTemplateSuccess = plainTemplateResolved[0] as ResolvedRef;
    expect(plainTemplateSuccess.kind).toBe('resolved');
    expect(plainTemplateSuccess.content).toBe('Plain {{label}} body\n');
    expect(buildInjectedReferences([plainTemplateSuccess])[0].items).toEqual([
      { input: 'Docs/plain.md', resolved_to: 'Docs/plain.md', chars: 'Plain {{label}} body\n'.length },
    ]);
  });
});
