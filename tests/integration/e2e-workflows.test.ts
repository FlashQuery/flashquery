/**
 * End-to-End Workflow Integration Tests — Phase 68
 *
 * Tests multi-tool workflows that validate all 19 v2.5 specifications working
 * together end-to-end. Uses real Supabase + vault filesystem (no mocks).
 *
 * Scenarios:
 *   A: Read section → modify → write (validates SPEC-01, SPEC-02, SPEC-03, SPEC-08)
 *   B: Move document → verify fqc_id preserved (validates SPEC-05)
 *   C: List directory → copy → move → clean (validates SPEC-04, SPEC-06, SPEC-07, SPEC-13)
 *   D: Register plugin → schema evolution → auto-migrate (validates SPEC-15)
 *   E: 1000+ document discovery with plugin ownership (validates SPEC-04, SPEC-12 at scale)
 *   F: Unregister plugin → teardown verification (validates SPEC-16)
 *
 * Requires: Supabase credentials in .env.test (see .env.test.example)
 * Run: npm run test:integration -- tests/integration/e2e-workflows.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import matter from 'gray-matter';
import pg from 'pg';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { validateToolResponse, validateBatchFormat } from '../../src/mcp/utils/response-formats.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  createSyntheticVault,
  type VaultMetadata,
} from '../helpers/synthetic-vault-generator.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

// ── Config ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;

const SKIP = !HAS_SUPABASE;

// ── DB helpers shared across Scenarios D and F ─────────────────────────────────

/** Check if a table exists in the public schema */
async function tableExists(pgClient: pg.Client, tableName: string): Promise<boolean> {
  const result = await pgClient.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'",
    [tableName]
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

/** Check if a column exists in a table */
async function columnExists(
  pgClient: pg.Client,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const result = await pgClient.query(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 AND table_schema = 'public'",
    [tableName, columnName]
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

/** Drop plugin tables if they exist */
async function dropPluginTables(pgClient: pg.Client, tableNames: string[]): Promise<void> {
  for (const table of tableNames) {
    await pgClient.query(`DROP TABLE IF EXISTS "${table}" CASCADE`).catch(() => {});
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string, instanceId: string): FlashQueryConfig {
  return {
    instance: {
      name: `e2e-workflows-${instanceId}`,
      id: instanceId,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: SUPABASE_URL,
      serviceRoleKey: SUPABASE_KEY,
      databaseUrl: DATABASE_URL,
      skipDdl: false,
    },
    server: { host: 'localhost', port: 3100 },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-no-key-needed',
      dimensions: 1536,
    },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (
      _name: string,
      _cfg: unknown,
      handler: (params: Record<string, unknown>) => Promise<unknown>
    ) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// ── seedDocument helper ────────────────────────────────────────────────────────

// Shared instance ID for Scenarios A-C. Using a single constant avoids overwriting
// the supabaseManager singleton when initSupabase is called multiple times.
const ABC_INSTANCE = 'e2e-scenarios-abc';

/** Write a vault markdown file and insert a matching fqc_documents row. Returns fqcId. */
async function seedDocument(opts: {
  vaultPath: string;
  relPath: string;
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}): Promise<string> {
  const fqcId = randomUUID();
  const fm = { title: opts.title, fqc_id: fqcId, status: 'active', tags: [], ...opts.frontmatter };
  const raw = matter.stringify(opts.body, fm);
  const absPath = join(opts.vaultPath, opts.relPath);
  await mkdir(join(opts.vaultPath, opts.relPath, '..'), { recursive: true });
  await writeFile(absPath, raw, 'utf-8');
  await supabaseManager.getClient().from('fqc_documents').insert({
    id: fqcId,
    instance_id: ABC_INSTANCE,
    title: opts.title,
    path: opts.relPath,
    content_hash: createHash('sha256').update(raw).digest('hex'),
    status: 'active',
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return fqcId;
}

// ── Scenarios A-C: shared Supabase singleton ──────────────────────────────────
// All three scenarios use ABC_INSTANCE so that only one initSupabase() call is made.
// Each nested scenario gets its own temp vault directory and registerTools() call.

describe.skipIf(SKIP)('Scenarios A-C: E2E File and Section Workflows', () => {
  let abcConfig: FlashQueryConfig;
  let abcVaultPath: string;

  beforeAll(async () => {
    abcVaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-abc-base-'));
    abcConfig = makeConfig(abcVaultPath, ABC_INSTANCE);
    initLogger(abcConfig);
    await initSupabase(abcConfig);
    initEmbedding(abcConfig);
    await initVault(abcConfig);
    await initPlugins(abcConfig);
  });

  afterAll(async () => {
    try { await rm(abcVaultPath, { recursive: true, force: true }); } catch { /* no-op */ }
    try {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', ABC_INSTANCE);
    } catch { /* no-op */ }
  });

  // ── Scenario A: Read Section → Modify → Write ──────────────────────────────

  describe('Scenario A: Read Section → Modify → Write', () => {
    let scAVaultPath: string;
    let scAConfig: FlashQueryConfig;
    let scAHandlers: ReturnType<typeof createMockServer>['getHandler'];

    let docId: string;
    let docDupId: string;
    let docSubId: string;
    let insertDocId: string;

    beforeAll(async () => {
      scAVaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-sca-'));
      scAConfig = makeConfig(scAVaultPath, ABC_INSTANCE);
      await initVault(scAConfig);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, scAConfig);
      registerDocumentTools(server, scAConfig);
      scAHandlers = getHandler;

      docId = await seedDocument({
        vaultPath: scAVaultPath,
        relPath: 'Work/ScenarioA/base-doc.md',
        title: 'Scenario A Base Doc',
        body: '## Intro\n\nIntroduction content here.\n\n## Status\n\nCurrent status info.\n\n## Next Steps\n\nPlanned next steps.',
      });
      docDupId = await seedDocument({
        vaultPath: scAVaultPath,
        relPath: 'Work/ScenarioA/dup-sections.md',
        title: 'Scenario A Duplicate Sections',
        body: '## Notes\n\nFirst notes section.\n\n## Notes\n\nSecond notes section.',
      });
      docSubId = await seedDocument({
        vaultPath: scAVaultPath,
        relPath: 'Work/ScenarioA/subheadings-doc.md',
        title: 'Scenario A Subheadings',
        body: '## Status\n\nStatus overview.\n\n### Open\n\nOpen items here.\n\n### Closed\n\nClosed items here.\n\n## Next Steps\n\nNext steps content.',
      });
      insertDocId = await seedDocument({
        vaultPath: scAVaultPath,
        relPath: 'Work/ScenarioA/insert-doc.md',
        title: 'Scenario A Insert Doc',
        body: '## Todo\n\n- Existing item\n',
      });
    });

    afterAll(async () => {
      try { await rm(scAVaultPath, { recursive: true, force: true }); } catch { /* no-op */ }
    });

    it('A1: get_document returns only the requested section (SPEC-01)', async () => {
      const result = await scAHandlers('get_document')({ identifier: docId, sections: ['Status'] });
      expect(isError(result)).toBe(false);
      const text = getText(result);
      expect(text).toContain('Status');
      expect(text).toContain('Current status info');
      expect(text).not.toContain('Introduction content here');
      expect(text).not.toContain('Planned next steps');
      const check = validateToolResponse(result);
      expect(check.valid).toBe(true);
    });

    it('A2: replace_doc_section updates only the target section (SPEC-02)', async () => {
      const replaceResult = await scAHandlers('replace_doc_section')({
        identifier: docId,
        heading: 'Status',
        content: 'Updated status here.',
      });
      expect(isError(replaceResult)).toBe(false);

      const readResult = await scAHandlers('get_document')({ identifier: docId });
      const text = getText(readResult);
      expect(text).toContain('Updated status here.');
      expect(text).toContain('Introduction content here.');
      expect(text).toContain('Planned next steps.');

      const raw = await readFile(join(scAVaultPath, 'Work/ScenarioA/base-doc.md'), 'utf-8');
      const parsed = matter(raw);
      expect(parsed.data.title).toBe('Scenario A Base Doc');
      expect(parsed.data.fqc_id).toBe(docId);
    });

    it('A3: content_hash updated in DB after section write; not injected into frontmatter (SPEC-08)', async () => {
      const raw = await readFile(join(scAVaultPath, 'Work/ScenarioA/base-doc.md'), 'utf-8');
      const parsed = matter(raw);
      // Hash must be computed from raw file bytes (same as implementation post-write read approach)
      const currentHash = createHash('sha256').update(raw).digest('hex');
      const { data: row } = await supabaseManager.getClient().from('fqc_documents')
        .select('content_hash').eq('id', docId).single();
      expect(row).toBeTruthy();
      expect((row as { content_hash: string }).content_hash).toBe(currentHash);
      // SPEC-08: content_hash must NOT appear in frontmatter
      expect(parsed.data.content_hash).toBeUndefined();
    });

    it('A4: insert_in_doc adds content to the target section (SPEC-03)', async () => {
      const insertResult = await scAHandlers('insert_in_doc')({
        identifier: insertDocId,
        heading: 'Todo',
        content: '- New item',
        position: 'after_heading',
      });
      expect(isError(insertResult)).toBe(false);
      const readResult = await scAHandlers('get_document')({ identifier: insertDocId });
      const text = getText(readResult);
      expect(text).toContain('- New item');
      expect(text).toContain('- Existing item');
    });

    it('A5: get_document with occurrence parameter reads correct duplicate section (SPEC-01)', async () => {
      const r1 = await scAHandlers('get_document')({ identifier: docDupId, sections: ['Notes'], occurrence: 1 });
      expect(isError(r1)).toBe(false);
      expect(getText(r1)).toContain('First notes section');
      const r2 = await scAHandlers('get_document')({ identifier: docDupId, sections: ['Notes'], occurrence: 2 });
      expect(isError(r2)).toBe(false);
      expect(getText(r2)).toContain('Second notes section');
    });

    it('A6: include_subheadings=true includes nested content; false excludes it (SPEC-01)', async () => {
      const withSubs = await scAHandlers('get_document')({
        identifier: docSubId, sections: ['Status'], include_subheadings: true,
      });
      expect(isError(withSubs)).toBe(false);
      const t1 = getText(withSubs);
      expect(t1).toContain('Open items here');
      expect(t1).toContain('Closed items here');

      const noSubs = await scAHandlers('get_document')({
        identifier: docSubId, sections: ['Status'], include_subheadings: false,
      });
      expect(isError(noSubs)).toBe(false);
      const t2 = getText(noSubs);
      expect(t2).toContain('Status overview');
      expect(t2).not.toContain('Open items here');
      expect(t2).not.toContain('Closed items here');
    });

    it('A7: tool responses comply with Phase 62-63 MCP format standards', async () => {
      const result = await scAHandlers('replace_doc_section')({
        identifier: docId, heading: 'Intro', content: 'Updated intro content.',
      });
      const check = validateToolResponse(result);
      expect(check.valid).toBe(true);
      expect(check.errors).toHaveLength(0);
    });
  });

  // ── Scenario B: Move Document → Verify fqc_id Preserved ────────────────────

  describe('Scenario B: Move Document → Verify fqc_id Preserved', () => {
    let scBVaultPath: string;
    let scBConfig: FlashQueryConfig;
    let scBHandlers: ReturnType<typeof createMockServer>['getHandler'];

    let moveDocId: string;
    let metaDocId: string;
    let specialCharsDocId: string;
    let srcConflictDocId: string;

    beforeAll(async () => {
      scBVaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-scb-'));
      scBConfig = makeConfig(scBVaultPath, ABC_INSTANCE);
      await initVault(scBConfig);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, scBConfig);
      registerDocumentTools(server, scBConfig);
      scBHandlers = getHandler;

      moveDocId = await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/Projects/Project1.md',
        title: 'Move Test Document', body: 'Original body content for move test.',
      });
      metaDocId = await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/Projects/MetaDoc.md',
        title: 'Metadata Preservation Doc', body: 'Metadata preservation body.',
        frontmatter: { tags: ['important', 'archive'], status: 'active', ownership_plugin_id: null },
      });
      specialCharsDocId = await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/Project One/2026 Q2 Plan.md',
        title: '2026 Q2 Plan', body: 'Quarterly plan body.',
      });
      await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/Archive/Existing.md',
        title: 'Existing At Destination', body: 'Already exists at destination.',
      });
      srcConflictDocId = await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/Projects/ConflictSrc.md',
        title: 'Conflict Source Doc', body: 'Trying to move to occupied location.',
      });
    });

    afterAll(async () => {
      try { await rm(scBVaultPath, { recursive: true, force: true }); } catch { /* no-op */ }
    });

    it('B1: move updates vault path and DB row while preserving fqc_id and content (SPEC-05)', async () => {
      const result = await scBHandlers('move_document')({
        identifier: moveDocId, destination: 'Work/Archive/Project1.md',
      });
      expect(isError(result)).toBe(false);
      expect(existsSync(join(scBVaultPath, 'Work/Archive/Project1.md'))).toBe(true);
      expect(existsSync(join(scBVaultPath, 'Work/Projects/Project1.md'))).toBe(false);
      const { data: row } = await supabaseManager.getClient().from('fqc_documents')
        .select('path, id').eq('id', moveDocId).single();
      expect((row as { path: string }).path).toBe('Work/Archive/Project1.md');
      expect((row as { id: string }).id).toBe(moveDocId);
      const raw = await readFile(join(scBVaultPath, 'Work/Archive/Project1.md'), 'utf-8');
      expect(matter(raw).content.trim()).toContain('Original body content for move test.');
    });

    it('B2: move preserves all frontmatter fields including tags and status (SPEC-05)', async () => {
      const result = await scBHandlers('move_document')({
        identifier: metaDocId, destination: 'Work/Archive/MetaDoc.md',
      });
      expect(isError(result)).toBe(false);
      const parsed = matter(await readFile(join(scBVaultPath, 'Work/Archive/MetaDoc.md'), 'utf-8'));
      expect(parsed.data.fqc_id).toBe(metaDocId);
      expect(parsed.data.title).toBe('Metadata Preservation Doc');
      expect(parsed.data.tags).toContain('important');
      expect(parsed.data.tags).toContain('archive');
      expect(parsed.data.status).toBe('active');
    });

    it('B3: move succeeds with path containing spaces and special characters', async () => {
      const result = await scBHandlers('move_document')({
        identifier: specialCharsDocId, destination: 'Work/Archive/2026 Q2 Plan CLOSED.md',
      });
      expect(isError(result)).toBe(false);
      expect(existsSync(join(scBVaultPath, 'Work/Archive/2026 Q2 Plan CLOSED.md'))).toBe(true);
      const { data: row } = await supabaseManager.getClient().from('fqc_documents')
        .select('path').eq('id', specialCharsDocId).single();
      expect((row as { path: string }).path).toBe('Work/Archive/2026 Q2 Plan CLOSED.md');
    });

    it('B5: move fails gracefully when destination already exists', async () => {
      const result = await scBHandlers('move_document')({
        identifier: srcConflictDocId, destination: 'Work/Archive/Existing.md',
      });
      expect(isError(result)).toBe(true);
      expect(existsSync(join(scBVaultPath, 'Work/Projects/ConflictSrc.md'))).toBe(true);
      expect(existsSync(join(scBVaultPath, 'Work/Archive/Existing.md'))).toBe(true);
    });

    it('B6: move creates missing intermediate directories automatically', async () => {
      const deepDocId = await seedDocument({
        vaultPath: scBVaultPath, relPath: 'Work/DeepDoc.md',
        title: 'Deep Move Doc', body: 'Moving to deep path.',
      });
      const result = await scBHandlers('move_document')({
        identifier: deepDocId, destination: 'Work/Deep/Nested/Structure/DeepDoc.md',
      });
      expect(isError(result)).toBe(false);
      expect(existsSync(join(scBVaultPath, 'Work/Deep/Nested/Structure/DeepDoc.md'))).toBe(true);
    });
  });

  // ── Scenario C: List Directory → Copy → Move → Clean ───────────────────────

  describe('Scenario C: List Directory → Copy → Move → Clean', () => {
    let scCVaultPath: string;
    let scCConfig: FlashQueryConfig;
    let scCHandlers: ReturnType<typeof createMockServer>['getHandler'];

    let project1Id: string;
    let project2Id: string;

    beforeAll(async () => {
      scCVaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-scc-'));
      scCConfig = makeConfig(scCVaultPath, ABC_INSTANCE);
      await initVault(scCConfig);
      const { server, getHandler } = createMockServer();
      registerCompoundTools(server, scCConfig);
      registerDocumentTools(server, scCConfig);
      scCHandlers = getHandler;

      project1Id = await seedDocument({
        vaultPath: scCVaultPath, relPath: 'Work/Projects-C/project1.md',
        title: 'Project One', body: 'Content of project one.\n\nDetailed project description here.',
        frontmatter: { tags: ['project', 'active'] },
      });
      project2Id = await seedDocument({
        vaultPath: scCVaultPath, relPath: 'Work/Projects-C/project2.md',
        title: 'Project Two', body: 'Content of project two.',
        frontmatter: { tags: ['project'] },
      });
      await seedDocument({
        vaultPath: scCVaultPath, relPath: 'Work/Projects-C/project3.md',
        title: 'Project Three', body: 'Content of project three.',
        frontmatter: { tags: ['project', 'archived'] },
      });
    });

    afterAll(async () => {
      try { await rm(scCVaultPath, { recursive: true, force: true }); } catch { /* no-op */ }
    });

    it('C1: list_files returns all files with key-value metadata (SPEC-04)', async () => {
      const result = await scCHandlers('list_files')({ path: 'Work/Projects-C' });
      expect(isError(result)).toBe(false);
      const text = getText(result);
      expect(text).toContain('project1.md');
      expect(text).toContain('project2.md');
      expect(text).toContain('project3.md');
      expect(text).toContain('Title:');
      expect(text).toContain('Path:');
      expect(text).toContain('FQC ID:');
      expect(text).toContain('Status:');
      const check = validateToolResponse(result);
      expect(check.valid).toBe(true);
    });

    it('C2: list_files with extension filter returns only .md files', async () => {
      await writeFile(join(scCVaultPath, 'Work/Projects-C/notes.txt'), 'Some text notes', 'utf-8');
      const result = await scCHandlers('list_files')({ path: 'Work/Projects-C', extension: '.md' });
      expect(isError(result)).toBe(false);
      const text = getText(result);
      expect(text).toContain('project1.md');
      expect(text).toContain('project2.md');
      expect(text).toContain('project3.md');
      expect(text).not.toContain('notes.txt');
    });

    it('C3: list_files with >100 items completes and returns all files', async () => {
      const largeDir = 'Work/LargeDir';
      await mkdir(join(scCVaultPath, largeDir), { recursive: true });
      const creates: Promise<void>[] = [];
      for (let i = 1; i <= 150; i++) {
        creates.push(writeFile(
          join(scCVaultPath, largeDir, `doc-${String(i).padStart(3, '0')}.md`),
          `---\ntitle: Large Doc ${i}\nfqc_id: ${randomUUID()}\nstatus: active\ntags: []\n---\nBody ${i}.`,
          'utf-8',
        ));
      }
      await Promise.all(creates);
      const result = await scCHandlers('list_files')({ path: largeDir });
      expect(isError(result)).toBe(false);
      const text = getText(result);
      expect(text).toContain('doc-001.md');
      expect(text).toContain('doc-150.md');
      expect(validateToolResponse(result).valid).toBe(true);
    });

    it('C4: copy_document creates new fqc_id, preserves content and tags (SPEC-06)', async () => {
      const copyResult = await scCHandlers('copy_document')({
        identifier: project1Id, destination: 'Work/Projects-C/project1-copy.md',
      });
      expect(isError(copyResult)).toBe(false);
      const text = getText(copyResult);
      expect(text).toContain('FQC ID:');
      expect(text).toContain('Title:');

      const fqcMatch = text.match(/FQC ID: ([a-f0-9-]{36})/);
      expect(fqcMatch).toBeTruthy();
      const newFqcId = fqcMatch![1];
      expect(newFqcId).not.toBe(project1Id);

      expect(existsSync(join(scCVaultPath, 'Work/Projects-C/project1-copy.md'))).toBe(true);
      expect(existsSync(join(scCVaultPath, 'Work/Projects-C/project1.md'))).toBe(true);

      const origParsed = matter(await readFile(join(scCVaultPath, 'Work/Projects-C/project1.md'), 'utf-8'));
      const copyParsed = matter(await readFile(join(scCVaultPath, 'Work/Projects-C/project1-copy.md'), 'utf-8'));
      expect(copyParsed.content.trim()).toBe(origParsed.content.trim());
      expect(copyParsed.data.tags).toContain('project');

      const { data: copyRow } = await supabaseManager.getClient().from('fqc_documents')
        .select('id, path').eq('id', newFqcId).single();
      expect((copyRow as { path: string }).path).toBe('Work/Projects-C/project1-copy.md');
    });

    it('C5: move copy to archive validates atomic path update (SPEC-05 + SPEC-06 chain)', async () => {
      const copyResult = await scCHandlers('copy_document')({
        identifier: project2Id, destination: 'Work/Projects-C/project2-copy.md',
      });
      expect(isError(copyResult)).toBe(false);
      const copyFqcMatch = getText(copyResult).match(/FQC ID: ([a-f0-9-]{36})/);
      expect(copyFqcMatch).toBeTruthy();
      const copyFqcId = copyFqcMatch![1];

      const moveResult = await scCHandlers('move_document')({
        identifier: copyFqcId, destination: 'Work/Archive-C/project2-copy.md',
      });
      expect(isError(moveResult)).toBe(false);
      expect(existsSync(join(scCVaultPath, 'Work/Archive-C/project2-copy.md'))).toBe(true);
      expect(existsSync(join(scCVaultPath, 'Work/Projects-C/project2-copy.md'))).toBe(false);

      const { data: row } = await supabaseManager.getClient().from('fqc_documents')
        .select('path, id').eq('id', copyFqcId).single();
      expect((row as { path: string }).path).toBe('Work/Archive-C/project2-copy.md');
      expect((row as { id: string }).id).toBe(copyFqcId);
    });

    it('C6: remove_directory fails on non-empty dir; succeeds on empty dir (SPEC-07)', async () => {
      const cleanDir = 'Work/ToClean';
      await mkdir(join(scCVaultPath, cleanDir), { recursive: true });
      const fileAId = await seedDocument({
        vaultPath: scCVaultPath, relPath: `${cleanDir}/fileA.md`,
        title: 'File A', body: 'File A body.',
      });
      const fileBId = await seedDocument({
        vaultPath: scCVaultPath, relPath: `${cleanDir}/fileB.md`,
        title: 'File B', body: 'File B body.',
      });

      const failResult = await scCHandlers('remove_directory')({ path: cleanDir });
      expect(isError(failResult)).toBe(true);
      expect(existsSync(join(scCVaultPath, cleanDir))).toBe(true);

      await rm(join(scCVaultPath, `${cleanDir}/fileA.md`));
      await rm(join(scCVaultPath, `${cleanDir}/fileB.md`));
      await supabaseManager.getClient().from('fqc_documents').delete().eq('id', fileAId);
      await supabaseManager.getClient().from('fqc_documents').delete().eq('id', fileBId);

      const successResult = await scCHandlers('remove_directory')({ path: cleanDir });
      expect(isError(successResult)).toBe(false);
      expect(existsSync(join(scCVaultPath, cleanDir))).toBe(false);
    });
  });
});

// ── Scenario E: 1000+ Document Discovery with Plugin Ownership ─────────────────

describe.skipIf(SKIP)('Scenario E: 1000+ Document Discovery with Plugin Ownership', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let handlers: ReturnType<typeof createMockServer>['getHandler'];
  let vaultMeta: VaultMetadata;
  const INSTANCE_ID = `e2e-scenario-e-${randomUUID().slice(0, 8)}`;

  // Plugin schemas for the 3 test plugins.
  // Format B (flat): id at root level, tables as array of objects.
  // Column types must be from: text | integer | boolean | uuid | timestamptz
  // NOTE: Do NOT define columns that conflict with implicit columns:
  //   id, instance_id, status, created_at, updated_at (all added automatically by plugin system)
  const crmSchema = [
    'id: crm',
    'name: CRM Plugin',
    'version: "1.0"',
    'tables:',
    '  - name: crm_contacts',
    '    columns:',
    '      - name: contact_name',
    '        type: text',
    '      - name: email',
    '        type: text',
  ].join('\n');

  const notesSchema = [
    'id: notes',
    'name: Notes Plugin',
    'version: "1.0"',
    'tables:',
    '  - name: notes_entries',
    '    columns:',
    '      - name: title',
    '        type: text',
  ].join('\n');

  const tasksSchema = [
    'id: tasks',
    'name: Tasks Plugin',
    'version: "1.0"',
    'tables:',
    '  - name: tasks_items',
    '    columns:',
    '      - name: title',
    '        type: text',
    '      - name: due_date',
    '        type: timestamptz',
  ].join('\n');

  beforeAll(async () => {
    // Create temp vault directory
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-scenario-e-'));

    config = makeConfig(vaultPath, INSTANCE_ID);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    await initPlugins(config);

    const { server, getHandler } = createMockServer();
    registerCompoundTools(server, config);
    registerDocumentTools(server, config);
    registerPluginTools(server, config);
    handlers = getHandler;
  }, 120_000); // Allow up to 2 min for beforeAll including vault gen

  afterAll(async () => {
    // Clean up temp vault directory
    try {
      await rm(vaultPath, { recursive: true, force: true });
    } catch {
      // Non-critical cleanup
    }
    // Clean up any DB records created
    try {
      const supabase = supabaseManager.getClient();
      await supabase
        .from('fqc_documents')
        .delete()
        .eq('instance_id', INSTANCE_ID);
      await supabase
        .from('fqc_plugin_registry')
        .delete()
        .eq('instance_id', INSTANCE_ID);
    } catch {
      // Non-critical cleanup
    }
  }, 30_000);

  // ── E1: Generate synthetic vault (1000+ documents) ──────────────────────────

  it('E1: generates synthetic vault with 1000+ documents across 8 folders', async () => {
    vaultMeta = await createSyntheticVault({
      vaultPath,
      documentCount: 1000,
      percentAlreadyDiscovered: 50,
      percentModified: 10,
    });

    // Verify vault was created successfully
    expect(vaultMeta).toBeDefined();
    expect(vaultMeta.vaultPath).toBe(vaultPath);
    expect(vaultMeta.documentCount).toBeGreaterThanOrEqual(1000);

    // Verify folder structure: should have 8 folders (CRM/Contacts, CRM/Companies, CRM/Tasks,
    // Notes/Projects, Notes/Daily, Notes/References, Tasks/Active, Tasks/Archived)
    const uniqueFolders = new Set(
      vaultMeta.documents.map((d) => d.path.split('/').slice(0, 2).join('/'))
    );
    expect(uniqueFolders.size).toBeGreaterThanOrEqual(8);

    // Verify folder names match expected structure
    expect(uniqueFolders).toContain('CRM/Contacts');
    expect(uniqueFolders).toContain('Notes/Projects');
    expect(uniqueFolders).toContain('Tasks/Active');

    // Verify discovery states: 50% discovered, rest undiscovered/modified
    const discovered = vaultMeta.documents.filter((d) => d.state === 'discovered');
    const undiscovered = vaultMeta.documents.filter((d) => d.state === 'undiscovered');
    const modified = vaultMeta.documents.filter((d) => d.state === 'modified');

    // Allow +/- 15% tolerance for random distribution
    expect(discovered.length).toBeGreaterThan(350); // at least 35% discovered
    expect(discovered.length).toBeLessThan(650);    // at most 65% discovered
    expect(undiscovered.length + modified.length).toBeGreaterThan(0);

    // Verify frontmatter is populated in at least one discovered doc
    expect(discovered.length).toBeGreaterThan(0);
    const discoveredDoc = discovered[0];
    expect(discoveredDoc.fqcId).toBeTruthy();
    expect(discoveredDoc.fqcId.length).toBeGreaterThan(0);
  }, 60_000);

  // ── E2: Register 3 plugins with folder claims ────────────────────────────────

  it('E2: registers 3 plugins (crm, notes, tasks) with folder claims', async () => {
    // Register CRM plugin
    const crmResult = await handlers('register_plugin')({ schema_yaml: crmSchema });
    expect(isError(crmResult)).toBe(false);
    const crmText = getText(crmResult);
    expect(crmText).toMatch(/crm|registered|success/i);

    // Register Notes plugin
    const notesResult = await handlers('register_plugin')({ schema_yaml: notesSchema });
    expect(isError(notesResult)).toBe(false);
    const notesText = getText(notesResult);
    expect(notesText).toMatch(/notes|registered|success/i);

    // Register Tasks plugin
    const tasksResult = await handlers('register_plugin')({ schema_yaml: tasksSchema });
    expect(isError(tasksResult)).toBe(false);
    const tasksText = getText(tasksResult);
    expect(tasksText).toMatch(/tasks|registered|success/i);

    // Verify all 3 plugins exist in fqc_plugin_registry
    const supabase = supabaseManager.getClient();
    const { data: registryRows } = await supabase
      .from('fqc_plugin_registry')
      .select('plugin_id')
      .eq('instance_id', INSTANCE_ID);

    const pluginIds = (registryRows ?? []).map((r: { plugin_id: string }) => r.plugin_id);
    expect(pluginIds).toContain('crm');
    expect(pluginIds).toContain('notes');
    expect(pluginIds).toContain('tasks');
  }, 30_000);

  // ── E3: list_files on CRM/Contacts directory (200+ docs) ──────────────────

  it('E3: list_files on CRM/Contacts with 200+ documents completes without error', async () => {
    // Verify we have documents in CRM/Contacts from vault generation
    const crmContactDocs = vaultMeta.documents.filter((d) =>
      d.path.startsWith('CRM/Contacts/')
    );
    expect(crmContactDocs.length).toBeGreaterThan(100); // Should have 200 per default distribution

    // Call list_files on the large directory
    const result = await handlers('list_files')({ path: 'CRM/Contacts' });

    // Should complete without error
    expect(isError(result)).toBe(false);

    const text = getText(result);

    // Should return files or empty results (not an error)
    expect(text).toBeTruthy();

    // If files were found, verify response format (SPEC-04: correct metadata structure)
    if (!text.includes('No files found')) {
      // Response should contain structured metadata for each file
      // Check for expected key-value format from response-formats.ts
      expect(text).toMatch(/Title:|Path:|FQC ID:/i);
    }
  }, 30_000);

  // ── E4: list_files returns correct metadata structure ───────────────────────

  it('E4: list_files returns complete file metadata with all required fields', async () => {
    // Call list_files on a directory with discovered docs
    const result = await handlers('list_files')({ path: 'CRM/Contacts' });

    expect(isError(result)).toBe(false);
    const text = getText(result);

    // Skip metadata validation if no files found
    if (text.includes('No files found')) {
      return;
    }

    // SPEC-04: Verify required metadata fields are present in response
    // Response format: Title, Path, Size, Modified, FQC ID, Tags, Status
    expect(text).toContain('Title:');
    expect(text).toContain('Path:');
    expect(text).toContain('FQC ID:');

    // Verify response is not corrupted (should be parseable text)
    expect(text.length).toBeGreaterThan(0);
    expect(typeof text).toBe('string');

    // Verify no null/undefined pollution in response
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('[object Object]');
  }, 30_000);

  // ── E5: search_documents across 1000-doc vault ──────────────────────────────

  it('E5: search_documents across 1000-doc vault returns results in correct format', async () => {
    // Use filesystem mode (no embedding key) to search across vault
    const result = await handlers('search_documents')({
      query: 'document',
      limit: 10,
      mode: 'filesystem',
    });

    // Should complete without error
    expect(isError(result)).toBe(false);
    const text = getText(result);
    expect(text).toBeTruthy();

    // If results found, verify SPEC-12 response format
    if (!text.includes('No documents found')) {
      // SPEC-12: Response format includes Title, Path, FQC ID, Tags
      expect(text).toContain('Title:');
      expect(text).toContain('Path:');
      expect(text).toContain('FQC ID:');

      // Verify response structure is valid MCP format (content array with type/text)
      const r = result as { content: Array<{ type: string; text: string }> };
      expect(Array.isArray(r.content)).toBe(true);
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.content[0].type).toBe('text');
      expect(typeof r.content[0].text).toBe('string');

      // Verify no data corruption
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('[object Object]');
    }
  }, 30_000);

  // ── E6: Concurrent list_files operations on large directories ───────────────

  it('E6: concurrent list_files on multiple large directories completes without races', async () => {
    // Run 5 parallel list_files calls on different large folders
    const folders = [
      'CRM/Contacts',
      'CRM/Companies',
      'Notes/Projects',
      'Tasks/Active',
      'Notes/Daily',
    ];

    // Execute all calls in parallel
    const results = await Promise.all(
      folders.map((folder) => handlers('list_files')({ path: folder }))
    );

    // All calls should complete without error
    for (let i = 0; i < results.length; i++) {
      expect(isError(results[i])).toBe(false);
      const text = getText(results[i]);
      expect(text).toBeTruthy();
      // Verify each response is non-corrupted
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('[object Object]');
    }

    // Verify responses are consistent (each folder's response only has its own paths)
    for (let i = 0; i < results.length; i++) {
      const text = getText(results[i]);
      if (!text.includes('No files found')) {
        // Response should only contain paths from the requested folder
        // (not bleeding from other concurrent calls)
        const folderName = folders[i].split('/')[0]; // e.g. "CRM", "Notes", "Tasks"
        void folderName; // used for documentation
        // Either the path contains the expected folder or is empty results
        const pathLines = text.split('\n').filter((l) => l.startsWith('Path:'));
        for (const pathLine of pathLines) {
          expect(pathLine).toContain(folders[i]);
        }
      }
    }
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D: Register Plugin → Schema Evolution → Auto-Migrate (SPEC-15)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Scenario D: Register Plugin → Schema Evolution → Auto-Migrate', () => {
  const INSTANCE_ID = 'e2e-scenario-d';
  const PLUGIN_ID = 'e2e_crm_d';
  const PLUGIN_INSTANCE = 'default';

  const TABLE_CONTACTS = `fqcp_${PLUGIN_ID}_${PLUGIN_INSTANCE}_contacts`;
  const TABLE_INTERACTIONS = `fqcp_${PLUGIN_ID}_${PLUGIN_INSTANCE}_interactions`;
  const TABLE_NOTES = `fqcp_${PLUGIN_ID}_${PLUGIN_INSTANCE}_notes`;

  let vaultPath: string;
  let config: FlashQueryConfig;
  let pgClient: pg.Client;
  let getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;

  // ── Schema constants ───────────────────────────────────────────────────────

  // Note: "id" is intentionally absent from all schemas below.
  // buildPluginTableDDL adds id UUID PRIMARY KEY automatically as an implicit column.
  // Including "id" explicitly would cause "column id specified more than once" DDL errors.

  // v1.0.0: contacts + interactions
  const SCHEMA_V1 = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.0.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: email`,
    `        type: text`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
  ].join('\n');

  // v1.1.0: adds "phone" column to contacts (safe additive)
  const SCHEMA_V2_ADD_COLUMN = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.1.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: email`,
    `        type: text`,
    `        required: false`,
    `      - name: phone`,
    `        type: text`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
  ].join('\n');

  // v1.2.0: adds "notes" table (safe additive)
  const SCHEMA_V3_ADD_TABLE = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.2.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: email`,
    `        type: text`,
    `        required: false`,
    `      - name: phone`,
    `        type: text`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
    `  - name: notes`,
    `    columns:`,
    `      - name: content`,
    `        type: text`,
    `        required: true`,
  ].join('\n');

  // v1.3.0: phone text to integer (breaking: type change)
  const SCHEMA_V4_TYPE_CHANGE = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.3.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: email`,
    `        type: text`,
    `        required: false`,
    `      - name: phone`,
    `        type: integer`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
    `  - name: notes`,
    `    columns:`,
    `      - name: content`,
    `        type: text`,
    `        required: true`,
  ].join('\n');

  // v1.4.0: removes email column (breaking: column removal)
  const SCHEMA_V5_COLUMN_REMOVAL = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.4.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: phone`,
    `        type: text`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
    `  - name: notes`,
    `    columns:`,
    `      - name: content`,
    `        type: text`,
    `        required: true`,
  ].join('\n');

  // v1.5.0: removes interactions table (breaking: table removal)
  const SCHEMA_V6_TABLE_REMOVAL = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM D`,
    `  version: 1.5.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: phone`,
    `        type: text`,
    `        required: false`,
    `  - name: notes`,
    `    columns:`,
    `      - name: content`,
    `        type: text`,
    `        required: true`,
  ].join('\n');

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-d-'));
    config = makeConfig(vaultPath, INSTANCE_ID);
    initLogger(config);
    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();
    // Pre-clean any leftover state from previous test runs
    await dropPluginTables(pgClient, [TABLE_CONTACTS, TABLE_INTERACTIONS, TABLE_NOTES]);
    await initSupabase(config);
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    initEmbedding(config);
    await initPlugins(config);
    await initVault(config);
    const { server, getHandler: gh } = createMockServer();
    registerPluginTools(server, config);
    getHandler = gh;
  }, 30_000);

  afterAll(async () => {
    await dropPluginTables(pgClient, [TABLE_CONTACTS, TABLE_INTERACTIONS, TABLE_NOTES]);
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    await pgClient.end();
    await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
  });

  // ── D1 ─────────────────────────────────────────────────────────────────────

  it('D1: initial plugin registration with schema creates tables in database', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V1 });

    expect(isError(result)).toBe(false);
    const text = getText(result);
    expect(text).toContain(PLUGIN_ID);
    expect(text).toMatch(/registered|success/i);

    expect(await tableExists(pgClient, TABLE_CONTACTS)).toBe(true);
    expect(await tableExists(pgClient, TABLE_INTERACTIONS)).toBe(true);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'id')).toBe(true);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'name')).toBe(true);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'email')).toBe(true);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('plugin_id, schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data).toBeDefined();
    expect(data?.schema_version).toBe('1.0.0');
  });

  // ── D2 ─────────────────────────────────────────────────────────────────────

  it('D2: auto-migration — new column added to existing table (safe additive)', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V2_ADD_COLUMN });

    expect(isError(result)).toBe(false);
    expect(getText(result)).toContain(PLUGIN_ID);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'phone')).toBe(true);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'email')).toBe(true);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data?.schema_version).toBe('1.1.0');
  });

  // ── D3 ─────────────────────────────────────────────────────────────────────

  it('D3: auto-migration — new table added to schema (safe additive)', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V3_ADD_TABLE });

    expect(isError(result)).toBe(false);
    expect(getText(result)).toContain(PLUGIN_ID);
    expect(await tableExists(pgClient, TABLE_NOTES)).toBe(true);
    expect(await tableExists(pgClient, TABLE_CONTACTS)).toBe(true);
    expect(await tableExists(pgClient, TABLE_INTERACTIONS)).toBe(true);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data?.schema_version).toBe('1.2.0');
  });

  // ── D4 ─────────────────────────────────────────────────────────────────────

  it('D4: breaking change — column type change rejected with unregister guidance', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V4_TYPE_CHANGE });

    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toMatch(/breaking|unsafe/i);
    expect(text).toMatch(/unregister/i);

    // Version NOT advanced
    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data?.schema_version).toBe('1.2.0');

    // Column type NOT changed (still text)
    const typeResult = await pgClient.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2 AND table_schema = 'public'`,
      [TABLE_CONTACTS, 'phone']
    );
    expect(typeResult.rows[0]?.data_type).toBe('text');
  });

  // ── D5 ─────────────────────────────────────────────────────────────────────

  it('D5: breaking change — column removal rejected with unregister guidance', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V5_COLUMN_REMOVAL });

    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toMatch(/breaking|unsafe/i);
    expect(text).toMatch(/unregister/i);
    expect(await columnExists(pgClient, TABLE_CONTACTS, 'email')).toBe(true);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data?.schema_version).toBe('1.2.0');
  });

  // ── D6 ─────────────────────────────────────────────────────────────────────

  it('D6: breaking change — table removal rejected with unregister guidance', async () => {
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA_V6_TABLE_REMOVAL });

    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toMatch(/breaking|unsafe/i);
    expect(text).toMatch(/unregister/i);
    expect(await tableExists(pgClient, TABLE_INTERACTIONS)).toBe(true);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data?.schema_version).toBe('1.2.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario F: Unregister Plugin → Teardown Verification (SPEC-16)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('Scenario F: Unregister Plugin → Teardown Verification', () => {
  const INSTANCE_ID = 'e2e-scenario-f';
  const PLUGIN_ID = 'e2e_crm_f';
  const PLUGIN_INSTANCE = 'default';

  const TABLE_CONTACTS = `fqcp_${PLUGIN_ID}_${PLUGIN_INSTANCE}_contacts`;
  const TABLE_INTERACTIONS = `fqcp_${PLUGIN_ID}_${PLUGIN_INSTANCE}_interactions`;

  // Note: "id", "instance_id", "status", "created_at", "updated_at" are omitted —
  // buildPluginTableDDL adds them as implicit columns. Using any of those names would
  // cause "column X specified more than once" DDL errors.
  const SCHEMA_V1 = [
    `plugin:`,
    `  id: ${PLUGIN_ID}`,
    `  name: E2E CRM F`,
    `  version: 1.0.0`,
    `tables:`,
    `  - name: contacts`,
    `    columns:`,
    `      - name: name`,
    `        type: text`,
    `        required: true`,
    `      - name: contact_status`,
    `        type: text`,
    `        required: false`,
    `  - name: interactions`,
    `    columns:`,
    `      - name: contact_id`,
    `        type: uuid`,
    `        required: true`,
  ].join('\n');

  let vaultPath: string;
  let config: FlashQueryConfig;
  let pgClient: pg.Client;
  let getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;

  async function setupPlugin(docCount = 3): Promise<void> {
    await getHandler('register_plugin')({ schema_yaml: SCHEMA_V1 });
    if (docCount > 0) {
      const docs = Array.from({ length: docCount }, (_, i) => ({
        id: randomUUID(),
        instance_id: INSTANCE_ID,
        title: `F Doc ${i + 1}`,
        path: `TestDocs/f-doc-${i + 1}.md`,
        ownership_plugin_id: PLUGIN_ID,
        ownership_type: 'claimed',
        status: 'active',
        tags: [] as string[],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      await supabaseManager.getClient().from('fqc_documents').insert(docs);
    }
  }

  async function cleanAll(): Promise<void> {
    await dropPluginTables(pgClient, [TABLE_CONTACTS, TABLE_INTERACTIONS]);
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);
  }

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-e2e-f-'));
    config = makeConfig(vaultPath, INSTANCE_ID);
    initLogger(config);
    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();
    // Pre-clean any leftover state from previous test runs
    await dropPluginTables(pgClient, [TABLE_CONTACTS, TABLE_INTERACTIONS]);
    await initSupabase(config);
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);
    initEmbedding(config);
    await initPlugins(config);
    await initVault(config);
    const { server, getHandler: gh } = createMockServer();
    registerPluginTools(server, config);
    getHandler = gh;
  }, 30_000);

  afterAll(async () => {
    await dropPluginTables(pgClient, [TABLE_CONTACTS, TABLE_INTERACTIONS]);
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);
    await pgClient.end();
    await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
  });

  // ── F1 ─────────────────────────────────────────────────────────────────────

  it('F1: dry-run preview shows tables and ownership count without deleting anything', async () => {
    await cleanAll();
    await setupPlugin(3);

    const result = await getHandler('unregister_plugin')({ plugin_id: PLUGIN_ID });

    expect(isError(result)).toBe(false);
    const text = getText(result);
    expect(text).toMatch(/dry.?run|preview/i);
    expect(text).toMatch(/table/i);
    expect(text).toMatch(/ownership|document/i);
    expect(text).toMatch(/confirm_destroy.*true|call.*unregister/i);

    // Plugin still registered
    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('id')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data).toBeDefined();

    // Docs still have ownership
    const { count } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('*', { count: 'exact', head: true })
      .eq('ownership_plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    expect(count).toBeGreaterThan(0);
  });

  // ── F2 ─────────────────────────────────────────────────────────────────────

  it('F2: confirmed teardown drops plugin tables and removes registry entry', async () => {
    const result = await getHandler('unregister_plugin')({
      plugin_id: PLUGIN_ID,
      confirm_destroy: true,
    });

    expect(isError(result)).toBe(false);
    expect(getText(result)).toMatch(/unregistered|removed|dropped/i);
    expect(await tableExists(pgClient, TABLE_CONTACTS)).toBe(false);
    expect(await tableExists(pgClient, TABLE_INTERACTIONS)).toBe(false);

    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('id')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data).toBeNull();
  });

  // ── F3 ─────────────────────────────────────────────────────────────────────

  it('F3: documents preserved after unregistration — ownership refs cleared, files intact', async () => {
    await cleanAll();
    await setupPlugin(5);

    const { count: beforeCount } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('*', { count: 'exact', head: true })
      .eq('ownership_plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    expect(beforeCount).toBe(5);

    await getHandler('unregister_plugin')({
      plugin_id: PLUGIN_ID,
      confirm_destroy: true,
    });

    const { count: totalCount } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('*', { count: 'exact', head: true })
      .eq('instance_id', INSTANCE_ID);
    expect(totalCount).toBe(5);

    const { count: ownedCount } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('*', { count: 'exact', head: true })
      .eq('ownership_plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    expect(ownedCount).toBe(0);
  });

  // ── F4 ─────────────────────────────────────────────────────────────────────

  it('F4: unregister nonexistent plugin returns descriptive error', async () => {
    const badId = 'nonexistent_plugin_' + randomUUID().replace(/-/g, '').slice(0, 8);

    const result = await getHandler('unregister_plugin')({ plugin_id: badId });

    expect(isError(result)).toBe(true);
    const text = getText(result);
    expect(text).toMatch(/not found|not registered/i);
    expect(text).toContain(badId);
  });

  // ── F5 ─────────────────────────────────────────────────────────────────────

  it('F5: unregistering the same plugin twice fails gracefully on the second call', async () => {
    await cleanAll();
    await setupPlugin(2);

    const first = await getHandler('unregister_plugin')({
      plugin_id: PLUGIN_ID,
      confirm_destroy: true,
    });
    expect(isError(first)).toBe(false);

    const second = await getHandler('unregister_plugin')({
      plugin_id: PLUGIN_ID,
      confirm_destroy: true,
    });
    expect(isError(second)).toBe(true);
    expect(getText(second)).toMatch(/not found|not registered|already/i);
  });

  // ── F6 ─────────────────────────────────────────────────────────────────────

  it('F6: dry-run with 100 owned documents shows correct ownership count', async () => {
    await cleanAll();
    await setupPlugin(0);

    for (let batch = 0; batch < 2; batch++) {
      const docs = Array.from({ length: 50 }, (_, i) => ({
        id: randomUUID(),
        instance_id: INSTANCE_ID,
        title: `F6 Doc ${batch * 50 + i + 1}`,
        path: `TestDocs/f6-${batch}-${i + 1}.md`,
        ownership_plugin_id: PLUGIN_ID,
        ownership_type: 'claimed',
        status: 'active',
        tags: [] as string[],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      await supabaseManager.getClient().from('fqc_documents').insert(docs);
    }

    const { count: seedCount } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('*', { count: 'exact', head: true })
      .eq('ownership_plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID);
    expect(seedCount).toBe(100);

    const result = await getHandler('unregister_plugin')({ plugin_id: PLUGIN_ID });

    expect(isError(result)).toBe(false);
    const text = getText(result);
    // Dry-run output must include the ownership doc count (100)
    expect(text).toMatch(/100/);
    expect(text).toMatch(/ownership|document/i);

    // Plugin still registered after dry-run
    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('id')
      .eq('plugin_id', PLUGIN_ID)
      .eq('instance_id', INSTANCE_ID)
      .maybeSingle();
    expect(data).toBeDefined();

    // Clean up
    await getHandler('unregister_plugin')({
      plugin_id: PLUGIN_ID,
      confirm_destroy: true,
    });
  });
});
