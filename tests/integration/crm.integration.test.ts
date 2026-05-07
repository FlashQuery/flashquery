/**
 * CRM E2E Integration Test — Phase 15 Plan 03 (CRM-06)
 *
 * Validates the complete CRM stack end-to-end:
 * plugin registration, business + contact creation with linked vault documents,
 * interaction logging with timeline append, relationship traversal via wikilinks,
 * record search, and archive lifecycle.
 *
 * Requires: Supabase credentials in .env.test (see .env.test.example)
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initVault } from '../../src/storage/vault.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ── Config ──────────────────────────────────────────────────────────────────

import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, TEST_OPENAI_API_KEY } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const EMBEDDING_API_KEY = TEST_OPENAI_API_KEY || 'sk-no-key-needed';

const SKIP_DB = !SUPABASE_KEY;

const INSTANCE_ID = 'crm-e2e-test';
// Plugin instance identifier must match /^[a-z0-9_]+$/ — no hyphens allowed
const PLUGIN_INSTANCE = 'crm_e2e_test';

// ── CRM Schema YAML (inlined from plugins/crm/schema.yaml, minus memory section) ──

const CRM_SCHEMA = `
plugin:
  id: crm
  name: FlashQuery CRM
  version: 1
  description: >
    A dissolved CRM — contact management through conversation.
    Tracks contacts, businesses, and interactions using FQC's
    three-layer storage model (documents + records + memories).

tables:
  - name: contacts
    description: >
      Contact records for structured queries. Rich narrative content
      (email, role, relationship context, interaction history) lives
      in the linked vault document. The record enables fast lookups
      by name, status filtering, date-range queries on last_interaction,
      and tag-based pipeline/relationship categorization.
    embed_fields:
      - name
    columns:
      - name: name
        type: text
        required: true
        description: "Full name of the contact — primary search and display field"
      - name: last_interaction
        type: timestamptz
        description: "Timestamp of most recent interaction — enables 'who haven't I spoken to in N days?' queries"
      - name: tags
        type: text
        description: "Comma-separated tags for pipeline stage (#stage/qualified), relationship type (#relationship/warm), etc."
      - name: fqc_id
        type: uuid
        description: "UUID linking this record to its vault contact document"

  - name: businesses
    description: >
      Business records for structured queries. Company details (domain,
      industry description, overview) live in the linked vault document.
      The record enables fast name lookups, status filtering, and
      tag-based industry/pipeline categorization.
    embed_fields:
      - name
    columns:
      - name: name
        type: text
        required: true
        description: "Business name — primary search and display field"
      - name: tags
        type: text
        description: "Comma-separated tags for industry (#industry/energy), pipeline stage, etc."
      - name: fqc_id
        type: uuid
        description: "UUID linking this record to its vault company document"

  - name: interactions
    description: >
      Interaction records for structured date and relationship queries.
      The full interaction narrative is appended to the contact's vault
      document Interaction Timeline section via append_to_doc. The record
      enables 'all interactions with Sarah', 'interactions this month',
      and interaction-type filtering via tags.
    columns:
      - name: contact_id
        type: uuid
        required: true
        description: "UUID of the contact involved — enables cross-table relationship queries"
      - name: business_id
        type: uuid
        description: "UUID of the business context — enables 'all interactions with Acme Corp' queries"
      - name: date
        type: timestamptz
        required: true
        description: "When the interaction occurred — enables date-range queries and chronological ordering"
      - name: tags
        type: text
        description: "Comma-separated interaction type tags (#interaction/meeting, #interaction/call, #interaction/email)"
`.trim();

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'crm-e2e-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3100 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: EMBEDDING_API_KEY, dimensions: 1536 },
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

// ── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_DB)('CRM E2E Integration', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;
  let getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;

  // Shared state across sequential test steps
  let businessFqcId: string;
  let businessRecordId: string;
  let contactFqcId: string;
  let contactRecordId: string;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-crm-e2e-'));
    config = makeConfig(vaultPath);
    initLogger(config);

    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    await initSupabase(config);
    // Always init embedding so fire-and-forget embed calls don't throw on undefined provider.
    // Embedding failures are silently logged (fire-and-forget). No test asserts on embeddings.
    initEmbedding(config);
    await initPlugins(config);
    await initVault(config);

    // Register all four tool sets on a single mock server
    const { server, getHandler: gh } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);
    getHandler = gh;
  });

  afterAll(async () => {
    // Drop all CRM plugin tables created during test
    // Table prefix: fqcp_{plugin_id}_{plugin_instance}_ → fqcp_crm_crm_e2e_test_
    const tables = [
      'fqcp_crm_crm_e2e_test_contacts',
      'fqcp_crm_crm_e2e_test_businesses',
      'fqcp_crm_crm_e2e_test_interactions',
    ];
    for (const table of tables) {
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(table)}`).catch(() => {});
    }

    // Clean plugin registry rows for this test instance
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    // Clean fqc_documents rows created during test
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await pgClient.end();
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  // ── Step 1: Register CRM Plugin ───────────────────────────────────────────

  it('registers CRM plugin and creates three tables', async () => {
    const result = await getHandler('register_plugin')({
      schema_yaml: CRM_SCHEMA,
      plugin_instance: PLUGIN_INSTANCE,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (result.isError) {
      console.error('register_plugin error:', result.content[0].text);
    }
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('fqcp_crm_crm_e2e_test_contacts');
    expect(result.content[0].text).toContain('fqcp_crm_crm_e2e_test_businesses');
    expect(result.content[0].text).toContain('fqcp_crm_crm_e2e_test_interactions');
  });

  // ── Step 2: Create Business with Linked Vault Document ───────────────────

  it('creates business with vault document and linked record', async () => {
    // 2a: create_document for company profile (document-first, D-08)
    const docResult = await getHandler('create_document')({
      title: 'Acme Corp',
      content: '# Company Information\n\n## Website\nhttps://acme.example.com\n\n## Industry\nTechnology\n\n---\n\n# What They Do\n\nEnterprise software solutions.\n\n---\n\n# Key Contacts\n\n---\n\n# Opportunities\n\n---\n\n# Notes\n',
      path: 'CRM-E2E-Test/Acme Corp.md',
      tags: ['#status/active', '#industry/technology'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (docResult.isError) {
      console.error('create_document (business) error:', docResult.content[0].text);
    }
    expect(docResult.isError).toBeUndefined();

    // Parse fqc_id from response text: "Document created: ...\nfqc_id: <uuid>\n..."
    const fqcIdMatch = docResult.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    expect(fqcIdMatch).not.toBeNull();
    businessFqcId = fqcIdMatch![1];

    // 2b: create_record on businesses table, linking via fqc_id
    const recResult = await getHandler('create_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'businesses',
      fields: { name: 'Acme Corp', fqc_id: businessFqcId, tags: '#industry/technology' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (recResult.isError) {
      console.error('create_record (business) error:', recResult.content[0].text);
    }
    expect(recResult.isError).toBeUndefined();

    const recIdMatch = recResult.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    expect(recIdMatch).not.toBeNull();
    businessRecordId = recIdMatch![1];
  });

  // ── Step 3: Create Contact with Linked Vault Document + Bidirectional Wikilinks ──

  it('creates contact with vault document, linked record, and bidirectional business link', async () => {
    // 3a: create_document for contact note (document-first, D-08)
    const docResult = await getHandler('create_document')({
      title: 'Sarah Chen',
      content: '# Contact Information\n\n## Email Addresses\n- **Primary:** sarah@acme.example.com\n\n## Company\nAcme Corp\n\n## Role / Title\nVP Engineering\n\n---\n\n# Relationship Context\n\n---\n\n# Communication\n\n---\n\n# Opportunities\n\n---\n\n# Next Steps\n\n---\n\n# Interaction Timeline\n',
      path: 'CRM-E2E-Test/Sarah Chen.md',
      tags: ['#status/active'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (docResult.isError) {
      console.error('create_document (contact) error:', docResult.content[0].text);
    }
    expect(docResult.isError).toBeUndefined();

    const fqcIdMatch = docResult.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    expect(fqcIdMatch).not.toBeNull();
    contactFqcId = fqcIdMatch![1];

    // 3b: create_record on contacts table, linking via fqc_id
    const recResult = await getHandler('create_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'contacts',
      fields: { name: 'Sarah Chen', fqc_id: contactFqcId, tags: '#stage/qualified' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (recResult.isError) {
      console.error('create_record (contact) error:', recResult.content[0].text);
    }
    expect(recResult.isError).toBeUndefined();

    const recIdMatch = recResult.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    expect(recIdMatch).not.toBeNull();
    contactRecordId = recIdMatch![1];

    // 3c: insert_doc_link — add contact wikilink to business doc 'links' property (P-03)
    // insert_doc_link adds wikilinks to frontmatter property arrays; get_document with
    // include: ['frontmatter'] returns frontmatter including wikilinks (Phase 107).
    const businessDocPath = 'CRM-E2E-Test/Acme Corp.md';
    const contactDocPath = 'CRM-E2E-Test/Sarah Chen.md';
    const linkResult1 = await getHandler('insert_doc_link')({
      identifier: businessDocPath,
      target: contactDocPath,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (linkResult1.isError) {
      console.error('insert_doc_link (business→contact) error:', linkResult1.content[0].text);
    }
    expect(linkResult1.isError).toBeUndefined();

    // 3d: insert_doc_link — add business wikilink back to contact doc (bidirectional, D-09)
    const linkResult2 = await getHandler('insert_doc_link')({
      identifier: contactDocPath,
      target: businessDocPath,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (linkResult2.isError) {
      console.error('insert_doc_link (contact→business) error:', linkResult2.content[0].text);
    }
    expect(linkResult2.isError).toBeUndefined();
  });

  // ── Step 4: Log Interaction ───────────────────────────────────────────────

  it('logs interaction: creates record, appends to contact timeline, updates last_interaction', async () => {
    const interactionDate = new Date().toISOString();
    const interactionDateShort = interactionDate.split('T')[0];

    // 4a: create interaction record (Pattern 2 — Supabase record only, D-07)
    const intResult = await getHandler('create_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'interactions',
      fields: {
        contact_id: contactRecordId,
        business_id: businessRecordId,
        date: interactionDate,
        tags: '#interaction/meeting',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (intResult.isError) {
      console.error('create_record (interaction) error:', intResult.content[0].text);
    }
    expect(intResult.isError).toBeUndefined();

    // 4b: append interaction narrative to contact document Interaction Timeline (D-07)
    const contactDocPath = 'CRM-E2E-Test/Sarah Chen.md';
    const appendResult = await getHandler('append_to_doc')({
      identifier: contactDocPath,
      content: `## ${interactionDateShort}\n\n**Type:** Meeting\n**Summary:** Discussed Q3 roadmap and rebrand timeline.\n**Action Items:** Send proposal by Friday.`,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (appendResult.isError) {
      console.error('append_to_doc error:', appendResult.content[0].text);
    }
    expect(appendResult.isError).toBeUndefined();

    // 4c: update contact last_interaction timestamp
    const updateResult = await getHandler('update_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'contacts',
      id: contactRecordId,
      fields: { last_interaction: interactionDate },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (updateResult.isError) {
      console.error('update_record (last_interaction) error:', updateResult.content[0].text);
    }
    expect(updateResult.isError).toBeUndefined();
  });

  // ── Step 5: Relationship Traversal via get_document ─────────────────────
  // Phase 107: get_doc_outline was hard-deleted; use get_document with include: ['frontmatter']

  it('traverses business-contact relationship via get_document frontmatter wikilinks', async () => {
    const businessDocPath = 'CRM-E2E-Test/Acme Corp.md';

    const docResult = await getHandler('get_document')({
      identifiers: businessDocPath,
      include: ['frontmatter'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (docResult.isError) {
      console.error('get_document error:', docResult.content[0].text);
    }
    expect(docResult.isError).toBeUndefined();
    // The frontmatter envelope should contain the wikilink to Sarah Chen
    const env = JSON.parse(docResult.content[0].text);
    // frontmatter field contains the raw frontmatter including the links array with Sarah Chen
    const frontmatterStr = JSON.stringify(env.frontmatter || '');
    expect(frontmatterStr).toContain('Sarah Chen');
  });

  // ── Step 6: Search Records ────────────────────────────────────────────────

  it('search_records finds contact by name filter', async () => {
    const searchResult = await getHandler('search_records')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'contacts',
      filters: { name: 'Sarah Chen' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (searchResult.isError) {
      console.error('search_records error:', searchResult.content[0].text);
    }
    expect(searchResult.isError).toBeUndefined();
    expect(searchResult.content[0].text).toContain('Sarah Chen');
  });

  // ── Step 7: Archive Contact (Record + Document) ───────────────────────────

  it('archives contact record and document, verifies status change', async () => {
    // Archive the Supabase record (soft-delete)
    const archRecResult = await getHandler('archive_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'contacts',
      id: contactRecordId,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (archRecResult.isError) {
      console.error('archive_record error:', archRecResult.content[0].text);
    }
    expect(archRecResult.isError).toBeUndefined();

    // Archive the vault document (sets status: archived in frontmatter + DB)
    const contactDocPath = 'CRM-E2E-Test/Sarah Chen.md';
    const archDocResult = await getHandler('archive_document')({
      identifiers: contactDocPath,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (archDocResult.isError) {
      console.error('archive_document error:', archDocResult.content[0].text);
    }
    expect(archDocResult.isError).toBeUndefined();
    expect(archDocResult.content[0].text).toContain('archived');
  });

  // ── Step 8: Verify Interaction Timeline in Contact Document ──────────────

  it('contact document contains the interaction timeline entry', async () => {
    const contactDocPath = 'CRM-E2E-Test/Sarah Chen.md';

    // Phase 107: get_document uses 'identifiers' parameter and returns JSON envelope
    const docResult = await getHandler('get_document')({
      identifiers: contactDocPath,
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // archive_document does not move the file — it stays at original path
    expect(docResult.isError).toBeUndefined();
    const env = JSON.parse(docResult.content[0].text);
    expect(env.body).toContain('Discussed Q3 roadmap');
  });

  // ── Step 9: Tag Deduplication in CRM Plugin (Phase 48, TAG-05) ──────────────

  it('create_document via CRM plugin ensures no duplicate tags in vault and Supabase', async () => {
    // Create a contact document with standard valid tags
    const tagTestDocResult = await getHandler('create_document')({
      title: 'Tag Dedup Test Contact',
      content: '# Test Contact\n\nThis is a test contact for tag deduplication.',
      path: 'CRM-E2E-Test/Tag-Dedup-Test.md',
      tags: ['#status/active', 'prospect', 'important'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(tagTestDocResult.isError).toBeUndefined();
    const fqcIdMatch = tagTestDocResult.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    expect(fqcIdMatch).not.toBeNull();
    const tagTestFqcId = fqcIdMatch![1];

    // Create a contact record via CRM plugin with the linked fqc_id
    const recResult = await getHandler('create_record')({
      plugin_id: 'crm',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'contacts',
      fields: {
        name: 'Tag Dedup Test Contact',
        fqc_id: tagTestFqcId,
        tags: '#relation/prospect',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(recResult.isError).toBeUndefined();

    // Verify via Supabase fqc_documents table
    const { data: docRow } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('tags')
      .eq('id', tagTestFqcId)
      .single();

    const row = docRow as { tags: string[] } | null;
    expect(row).not.toBeNull();
    if (row) {
      // Check that tags are deduplicated: no tag appears more than once
      expect(new Set(row.tags).size).toBe(row.tags.length);  // No duplicates
      // Should have the tags we created with
      expect(row.tags).toContain('#status/active');
      expect(row.tags).toContain('prospect');
      expect(row.tags).toContain('important');
      expect(row.tags.length).toBe(3);
    }
  });
});
