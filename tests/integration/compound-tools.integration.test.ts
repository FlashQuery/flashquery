/**
 * Integration tests for Phase 13 — Tier 2 Compound Tools.
 *
 * Tests the cross-system behaviors that unit tests (with mocked I/O) cannot verify:
 *   - Real vault file read-modify-write via gray-matter
 *   - Real Supabase TEXT[] array round-trips in fqc_documents and fqc_memory
 *   - Real ilike() title resolution queries for insert_doc_link
 *   - content_hash synchronous update in fqc_documents after append_to_doc
 *   - get_briefing 5-query chain with live data
 *   - get_doc_outline extraction from real vault files
 *
 * Requires: Supabase credentials in .env.test (see .env.test.example)
 * Does NOT require an embedding API key — embedding is fire-and-forget and
 * failures are silently logged; no compound tool test asserts on embeddings.
 *
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';

// ── Config ────────────────────────────────────────────────────────────────────

import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = 'compound-integration-test';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'compound-integration-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3100 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-no-key-needed', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

/** Write a vault markdown file and insert a matching fqc_documents row. Returns fqcId. */
async function seedDocument(opts: {
  vaultPath: string;
  relPath: string;      // e.g. '_global/my-doc.md'
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}): Promise<string> {
  const fqcId = randomUUID();
  const fm = { [FM.TITLE]: opts.title, [FM.ID]: fqcId, [FM.STATUS]: 'active', [FM.TAGS]: [], ...opts.frontmatter };
  const raw = matter.stringify(opts.body, fm);
  const absPath = join(opts.vaultPath, opts.relPath);
  await mkdir(join(opts.vaultPath, opts.relPath, '..'), { recursive: true });
  await writeFile(absPath, raw, 'utf-8');

  await supabaseManager.getClient().from('fqc_documents').insert({
    id: fqcId,
    instance_id: INSTANCE_ID,
    title: opts.title,
    path: opts.relPath,
    content_hash: computeHash(raw),
    status: 'active',
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return fqcId;
}

/** Insert a fqc_memory row directly (no vault file). Returns the memory id. */
async function seedMemory(opts: { content: string; tags?: string[] }): Promise<string> {
  const id = randomUUID();
  await supabaseManager.getClient().from('fqc_memory').insert({
    id,
    instance_id: INSTANCE_ID,
    content: opts.content,
    status: 'active',
    tags: opts.tags ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Compound Tools Integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let handlers: ReturnType<typeof createMockServer>['getHandler'];

  // Seeded document paths / IDs reused across describe blocks
  let appendDocPath: string;
  let appendDocFqcId: string;
  let headerDocPath: string;
  let headerDocFqcId: string;
  let linkSourcePath: string;
  let linkTargetFqcId: string;
  let linkTargetTitle: string;
  let linkTargetPath: string;
  let ambigDoc1FqcId: string;
  let ambigDoc2FqcId: string;
  const ambigTitle = 'Compound Ambiguous Title Doc';
  let tagsDocPath: string;
  let tagsDocFqcId: string;
  let tagsMemoryId: string;
  let briefingMemoryId: string;
  let briefingDocFqcId: string;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-compound-integration-'));
    config = makeConfig(vaultPath);

    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);  // needed for append_to_doc fire-and-forget (fails silently with fake key)
    await initVault(config);
    await initPlugins(config);

    const { server, getHandler } = createMockServer();
    registerCompoundTools(server, config);
    registerMemoryTools(server, config);
    handlers = getHandler;

    // ── Seed: append_to_doc test doc ────────────────────────────────────────
    appendDocPath = '_global/append-test.md';
    appendDocFqcId = await seedDocument({
      vaultPath,
      relPath: appendDocPath,
      title: 'Append Test Document',
      body: 'Original body content here.',
    });

    // ── Seed: update_doc_header test doc ────────────────────────────────────
    headerDocPath = '_global/header-test.md';
    headerDocFqcId = await seedDocument({
      vaultPath,
      relPath: headerDocPath,
      title: 'Header Test Document',
      body: 'Body text that must never change.',
      frontmatter: { custom_field: 'to-be-deleted', tags: [] },
    });

    // ── Seed: insert_doc_link — source doc (has a vault file) ───────────────
    linkSourcePath = '_global/link-source.md';
    await seedDocument({
      vaultPath,
      relPath: linkSourcePath,
      title: 'Link Source Document',
      body: 'Source document body.',
    });

    // ── Seed: insert_doc_link — target doc (DB row + vault file for resolver) ──
    linkTargetTitle = 'Compound Integration Link Target';
    linkTargetPath = '_global/link-target.md';
    linkTargetFqcId = randomUUID();
    await supabaseManager.getClient().from('fqc_documents').insert({
      id: linkTargetFqcId,
      instance_id: INSTANCE_ID,
      title: linkTargetTitle,
      path: linkTargetPath,
      content_hash: 'placeholder',
      status: 'active',
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    // Create vault file so resolveDocumentIdentifier can read it
    await mkdir(join(vaultPath, '_global'), { recursive: true });
    await writeFile(
      join(vaultPath, linkTargetPath),
      matter.stringify('Link target content.', {
        [FM.TITLE]: linkTargetTitle,
        [FM.ID]: linkTargetFqcId,
        [FM.STATUS]: 'active',
      })
    );

    // ── Seed: insert_doc_link — two docs with same ambiguous title ───────────
    ambigDoc1FqcId = randomUUID();
    ambigDoc2FqcId = randomUUID();
    await supabaseManager.getClient().from('fqc_documents').insert([
      {
        id: ambigDoc1FqcId,
        instance_id: INSTANCE_ID,
        title: ambigTitle,
        path: '_global/ambig-1.md',
        content_hash: 'placeholder',
        status: 'active',
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: ambigDoc2FqcId,
        instance_id: INSTANCE_ID,
        title: ambigTitle,
        path: '_global/ambig-2.md',
        content_hash: 'placeholder',
        status: 'active',
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // ── Seed: apply_tags — doc with initial tags ─────────────────────────────
    tagsDocPath = '_global/tags-test.md';
    tagsDocFqcId = await seedDocument({
      vaultPath,
      relPath: tagsDocPath,
      title: 'Tags Test Document',
      body: 'Document for tag sync testing.',
      frontmatter: { [FM.TAGS]: ['existing-tag'] },
    });

    // ── Seed: apply_tags — memory ────────────────────────────────────────────
    tagsMemoryId = await seedMemory({ content: 'Memory for tag testing.', tags: ['old-tag'] });

    // ── Seed: get_briefing — a memory ────────────────────────────────────────
    briefingMemoryId = await seedMemory({ content: 'Briefing test memory fact.', tags: ['#briefing-test'] });

    // ── Seed: get_briefing — a document with #briefing-test tag ─────────────
    briefingDocFqcId = await seedDocument({
      vaultPath,
      relPath: '_global/briefing-doc.md',
      title: 'Briefing Test Document',
      body: 'Briefing doc body.',
      frontmatter: { [FM.TAGS]: ['#briefing-test', '#extra-tag'] },
    });
    await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ tags: ['#briefing-test', '#extra-tag'] })
      .eq('id', briefingDocFqcId);
  }, 30000);

  afterAll(async () => {
    // Clean up all rows seeded under our INSTANCE_ID
    const sb = supabaseManager.getClient();
    await sb.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    await sb.from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
    await sb.from('fqc_vault').delete().eq('instance_id', INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  // ── append_to_doc ─────────────────────────────────────────────────────────

  describe('append_to_doc', () => {
    it('T2-01a: appends a new section to the vault file without altering existing body', async () => {
      const result = await handlers('append_to_doc')({
        identifier: appendDocPath,
        content: '## New Section\n\nIntegration-appended content.',
      });

      expect(isError(result)).toBe(false);
      expect(getText(result)).toContain('Appended content to');

      const raw = await readFile(join(vaultPath, appendDocPath), 'utf-8');
      const parsed = matter(raw);

      // Original body preserved
      expect(parsed.content).toContain('Original body content here.');
      // New section appended after
      expect(parsed.content).toContain('## New Section');
      expect(parsed.content).toContain('Integration-appended content.');
      // New section comes after original body
      expect(parsed.content.indexOf('## New Section'))
        .toBeGreaterThan(parsed.content.indexOf('Original body content here.'));
      // fqc_id not mangled by gray-matter round-trip
      expect(parsed.data.fq_id).toBe(appendDocFqcId);
    });

    it('T2-01b: synchronously updates content_hash in fqc_documents after write', async () => {
      // Read hash before
      const { data: before } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('content_hash')
        .eq('id', appendDocFqcId)
        .single();
      const hashBefore = (before as { content_hash: string }).content_hash;

      await handlers('append_to_doc')({
        identifier: appendDocPath,
        content: '## Second Append\n\nMore content added.',
      });

      // Read hash after — must differ from before (content changed)
      const { data: after } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('content_hash')
        .eq('id', appendDocFqcId)
        .single();
      const hashAfter = (after as { content_hash: string }).content_hash;

      expect(hashAfter).not.toBe(hashBefore);

      // Hash must match actual file on disk
      const raw = await readFile(join(vaultPath, appendDocPath), 'utf-8');
      expect(hashAfter).toBe(computeHash(raw));
    });
  });

  // ── update_doc_header ─────────────────────────────────────────────────────

  describe('update_doc_header', () => {
    it('T2-02a: updates a frontmatter field without modifying body content', async () => {
      const result = await handlers('update_doc_header')({
        identifier: headerDocPath,
        updates: { status: 'reviewed' },
      });

      expect(isError(result)).toBe(false);

      const raw = await readFile(join(vaultPath, headerDocPath), 'utf-8');
      const parsed = matter(raw);

      expect(parsed.data.status).toBe('reviewed');
      expect(parsed.content.trim()).toBe('Body text that must never change.');
    });

    it('T2-02b: null value removes the field from vault frontmatter (no YAML null written)', async () => {
      const result = await handlers('update_doc_header')({
        identifier: headerDocPath,
        updates: { custom_field: null },
      });

      expect(isError(result)).toBe(false);

      const raw = await readFile(join(vaultPath, headerDocPath), 'utf-8');
      const parsed = matter(raw);

      expect(parsed.data.custom_field).toBeUndefined();
      // Must not write "null" as a YAML value
      expect(raw).not.toMatch(/custom_field:\s*null/);
    });

    it('T2-02c: tags key syncs TEXT[] array to fqc_documents Supabase column', async () => {
      const newTags = ['typescript', 'mcp', 'integration'];

      await handlers('update_doc_header')({
        identifier: headerDocPath,
        updates: { [FM.TAGS]: newTags },
      });

      // Verify vault frontmatter
      const raw = await readFile(join(vaultPath, headerDocPath), 'utf-8');
      const parsed = matter(raw);
      expect(parsed.data[FM.TAGS]).toEqual(newTags);

      // Verify fqc_documents.tags TEXT[] column in Supabase
      const { data, error } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('tags')
        .eq('id', headerDocFqcId)
        .single();

      expect(error).toBeNull();
      const row = data as { tags: string[] };
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags).toEqual(newTags);
    });
  });

  // ── insert_doc_link ───────────────────────────────────────────────────────

  describe('insert_doc_link', () => {
    it('T2-03a: resolves target by fqc_id and inserts document link', async () => {
      const result = await handlers('insert_doc_link')({
        identifier: linkSourcePath,
        target: linkTargetFqcId,
      });

      expect(isError(result)).toBe(false);
      expect(getText(result)).toContain(`[[${linkTargetTitle}]]`);

      const raw = await readFile(join(vaultPath, linkSourcePath), 'utf-8');
      const parsed = matter(raw);
      const links = parsed.data.links as string[];
      expect(links).toContain(`[[${linkTargetTitle}]]`);
    });

    it('T2-03b: second insert of the same link is idempotent — no duplicate in array', async () => {
      await handlers('insert_doc_link')({
        identifier: linkSourcePath,
        target: linkTargetFqcId,
      });

      const raw = await readFile(join(vaultPath, linkSourcePath), 'utf-8');
      const parsed = matter(raw);
      const links = parsed.data.links as string[];
      const dupes = links.filter(l => l === `[[${linkTargetTitle}]]`);
      expect(dupes).toHaveLength(1);
    });

    it('T2-03c: returns error when target identifier cannot be resolved', async () => {
      const result = await handlers('insert_doc_link')({
        identifier: linkSourcePath,
        target: 'nonexistent-path/does-not-exist.md',
      });

      expect(isError(result)).toBe(true);
    });

    it('T2-03d: inserts link into custom property via fqc_id target', async () => {
      const result = await handlers('insert_doc_link')({
        identifier: linkSourcePath,
        target: linkTargetFqcId,
        property: 'related',
      });

      expect(isError(result)).toBe(false);

      const raw = await readFile(join(vaultPath, linkSourcePath), 'utf-8');
      const parsed = matter(raw);
      expect((parsed.data.related as string[]))
        .toContain(`[[${linkTargetTitle}]]`);
    });
  });

  // ── apply_tags ────────────────────────────────────────────────────────────

  describe('apply_tags', () => {
    it('T2-04a: adds tags to vault frontmatter AND fqc_documents TEXT[] in one call', async () => {
      const result = await handlers('apply_tags')({
        identifiers: tagsDocPath,
        add_tags: ['new-tag-a', 'new-tag-b'],
      });

      expect(isError(result)).toBe(false);

      // Vault frontmatter
      const raw = await readFile(join(vaultPath, tagsDocPath), 'utf-8');
      const parsed = matter(raw);
      const frontmatterTags = parsed.data[FM.TAGS] as string[];
      expect(frontmatterTags).toContain('existing-tag');
      expect(frontmatterTags).toContain('new-tag-a');
      expect(frontmatterTags).toContain('new-tag-b');

      // Supabase fqc_documents.tags TEXT[] column
      const { data, error } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('tags')
        .eq('id', tagsDocFqcId)
        .single();

      expect(error).toBeNull();
      const row = data as { tags: string[] };
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags).toContain('existing-tag');
      expect(row.tags).toContain('new-tag-a');
      expect(row.tags).toContain('new-tag-b');
    });

    it('T2-04b: add is idempotent — calling twice does not duplicate tags', async () => {
      await handlers('apply_tags')({
        identifiers: tagsDocPath,
        add_tags: ['idempotent-tag'],
      });
      await handlers('apply_tags')({
        identifiers: tagsDocPath,
        add_tags: ['idempotent-tag'],
      });

      const raw = await readFile(join(vaultPath, tagsDocPath), 'utf-8');
      const parsed = matter(raw);
      const tags = parsed.data[FM.TAGS] as string[];
      const dupes = tags.filter(t => t === 'idempotent-tag');
      expect(dupes).toHaveLength(1);
    });

    it('T2-04c: remove of non-existing tag is a silent no-op — no error, no crash', async () => {
      const result = await handlers('apply_tags')({
        identifiers: tagsDocPath,
        remove_tags: ['tag-that-does-not-exist'],
      });

      expect(isError(result)).toBe(false);
    });

    it('T2-04d: updates fqc_memory.tags TEXT[] for a memory target', async () => {
      const result = await handlers('apply_tags')({
        memory_id: tagsMemoryId,
        add_tags: ['memory-tag-x', 'memory-tag-y'],
        remove_tags: ['old-tag'],
      });

      expect(isError(result)).toBe(false);

      const { data, error } = await supabaseManager.getClient()
        .from('fqc_memory')
        .select('tags')
        .eq('id', tagsMemoryId)
        .single();

      expect(error).toBeNull();
      const row = data as { tags: string[] };
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags).toContain('memory-tag-x');
      expect(row.tags).toContain('memory-tag-y');
      // old-tag was removed
      expect(row.tags).not.toContain('old-tag');
    });

    // ── Tag Deduplication Tests (Phase 48) ──────────────────────────────────

    it('T2-04e: apply_tags is idempotent — adding same tag twice produces single tag', async () => {
      // Create fresh document for this test
      const deduplicationDocPath = '_global/dedup-test.md';
      const deduplicationDocFqcId = await seedDocument({
        vaultPath,
        relPath: deduplicationDocPath,
        title: 'Deduplication Test Document',
        body: 'Content for deduplication testing.',
        frontmatter: { [FM.TAGS]: ['initial'] },
      });

      // Apply same tag twice
      await handlers('apply_tags')({
        identifiers: deduplicationDocPath,
        add_tags: ['newtag'],
      });
      await handlers('apply_tags')({
        identifiers: deduplicationDocPath,
        add_tags: ['newtag'],
      });

      // Verify: document contains 'newtag' only once
      const raw = await readFile(join(vaultPath, deduplicationDocPath), 'utf-8');
      const parsed = matter(raw);
      const docTags = parsed.data[FM.TAGS] as string[];
      const newtagCount = docTags.filter(t => t === 'newtag').length;
      expect(newtagCount).toBe(1);

      // Also verify in Supabase
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('tags')
        .eq('id', deduplicationDocFqcId)
        .single();
      const row = data as { tags: string[] };
      const supabaseNewtagCount = row.tags.filter(t => t === 'newtag').length;
      expect(supabaseNewtagCount).toBe(1);
    });

    it('T2-04f: apply_tags deduplicates mixed-case tags', async () => {
      // Create fresh document for this test
      const mixedCaseDocPath = '_global/mixed-case-test.md';
      const mixedCaseDocFqcId = await seedDocument({
        vaultPath,
        relPath: mixedCaseDocPath,
        title: 'Mixed Case Status Test',
        body: 'Content for mixed case testing.',
        frontmatter: { [FM.TAGS]: ['status'] },  // Start with normalized tag
      });

      // Apply same tag with different casing
      await handlers('apply_tags')({
        identifiers: mixedCaseDocPath,
        add_tags: ['Status'],  // Different casing
      });

      // Verify: document contains deduplicated normalized tag only once
      const raw = await readFile(join(vaultPath, mixedCaseDocPath), 'utf-8');
      const parsed = matter(raw);
      const docTags = parsed.data[FM.TAGS] as string[];
      // Should have only one 'status' tag (normalized and deduplicated)
      expect(docTags.filter(t => t.toLowerCase() === 'status')).toHaveLength(1);
    });

    it('T2-04g: update_doc_header ensures no duplicate tags reach vault file', async () => {
      // Create fresh document for this test
      const headerDeduplicationDocPath = '_global/header-dedup-test.md';
      const headerDeduplicationDocFqcId = await seedDocument({
        vaultPath,
        relPath: headerDeduplicationDocPath,
        title: 'Header Update Deduplication Test',
        body: 'Content for header tag deduplication.',
        frontmatter: { [FM.TAGS]: ['existing'] },
      });

      // Update header with different tags
      const result = await handlers('update_doc_header')({
        identifier: headerDeduplicationDocPath,
        updates: { [FM.TAGS]: ['new1', 'new2'] },
      });

      expect(isError(result)).toBe(false);

      // Verify: document contains exactly the tags specified (no duplicates)
      const raw = await readFile(join(vaultPath, headerDeduplicationDocPath), 'utf-8');
      const parsed = matter(raw);
      const docTags = parsed.data[FM.TAGS] as string[];

      // Should have exactly 2 unique tags
      expect(docTags).toHaveLength(2);
      expect(new Set(docTags).size).toBe(docTags.length);  // No duplicates
      expect(docTags).toContain('new1');
      expect(docTags).toContain('new2');

      // Also verify in Supabase
      const { data } = await supabaseManager.getClient()
        .from('fqc_documents')
        .select('tags')
        .eq('id', headerDeduplicationDocFqcId)
        .single();
      const row = data as { tags: string[] };
      expect(row.tags).toEqual(docTags);
    });
  });

  // ── get_briefing ──────────────────────────────────────────────────────────

  describe('get_briefing', () => {
    it('T2-05a: returns matching memories and documents for tag filter', async () => {
      const result = await handlers('get_briefing')({ tags: ['#briefing-test'] });

      expect(isError(result)).toBe(false);
      const text = getText(result);

      // Header with tag present
      // Header: response starts with ## Documents section
      expect(text).toContain('#briefing-test');

      // Memory section present with seeded memory
      expect(text).toContain('## Memories');
      expect(text).toContain('Briefing test memory fact.');
    });

    it('T2-05b: omits Plugin Records section when plugin_id not provided', async () => {
      const result = await handlers('get_briefing')({ tags: ['#briefing-test'] });

      expect(isError(result)).toBe(false);
      // No plugin section when plugin_id not provided
      expect(getText(result)).not.toContain('Plugin Records');
    });

    it('T2-05c: briefing documents section uses batch outline format with === path === delimiters', async () => {
      const result = await handlers('get_briefing')({ tags: ['#briefing-test'] });

      expect(isError(result)).toBe(false);
      const text = getText(result);

      expect(text).toContain('## Documents');
      expect(text).toContain('Path: _global/briefing-doc.md');
      expect(text).toContain('Title: Briefing Test Document');
      expect(text).toContain('FQC ID:');
      expect(text).toContain('Status: active');
    });

    it('T2-05d: tag_match=all with multiple tags narrows results correctly', async () => {
      const result = await handlers('get_briefing')({
        tags: ['#briefing-test', '#extra-tag'],
        tag_match: 'all',
      });

      expect(isError(result)).toBe(false);
      const text = getText(result);

      // briefing-doc.md has BOTH tags — should appear
      expect(text).toContain('Briefing Test Document');
      // briefingMemoryId was seeded with only ['#briefing-test'] — should NOT appear when tag_match=all with both tags
      expect(text).not.toContain('Briefing test memory fact.');
    });
  });

  // Note: get_doc_outline describe block removed in Phase 107.
  // The get_doc_outline tool was hard-deleted; its tests are no longer applicable.
  // get_document with include: ['frontmatter', 'headings'] covers equivalent functionality.

  // ── get_memory ────────────────────────────────────────────────────────────

  describe('get_memory', () => {
    it('T2-07a: save_memory then get_memory round-trip returns content and fields', async () => {
      const saveResult = await handlers('save_memory')({
        content: 'Integration test memory for get_memory round-trip.',
        tags: ['#get-memory-test'],
      });
      expect(isError(saveResult)).toBe(false);
      const saveText = getText(saveResult);

      // save_memory returns: "Memory saved (id: <uuid>). Tags: ..."
      const idMatch = saveText.match(/Memory saved \(id: ([0-9a-f-]{36})\)/i);
      expect(idMatch).not.toBeNull();
      const memoryId = idMatch![1];

      const getResult = await handlers('get_memory')({ memory_ids: memoryId });
      expect(isError(getResult)).toBe(false);
      const text = getText(getResult);

      expect(text).toContain('Integration test memory for get_memory round-trip.');
      expect(text).toContain(memoryId);
      expect(text).toContain('#get-memory-test');
      expect(text).toContain('Created:');
      expect(text).toContain('Updated:');
    });
  });

  // Validate seeded IDs are tracked (prevents unused-var lint errors in cleanup)
  it('seeded data IDs recorded', () => {
    expect(appendDocFqcId).toBeTruthy();
    expect(headerDocFqcId).toBeTruthy();
    expect(linkTargetFqcId).toBeTruthy();
    expect(ambigDoc1FqcId).toBeTruthy();
    expect(ambigDoc2FqcId).toBeTruthy();
    expect(tagsDocFqcId).toBeTruthy();
    expect(tagsMemoryId).toBeTruthy();
    expect(briefingMemoryId).toBeTruthy();
    expect(briefingDocFqcId).toBeTruthy();
  });
});
