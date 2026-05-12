/**
 * MCP Protocol E2E Tests
 *
 * Spawns FlashQuery Core as a subprocess using StdioClientTransport and exercises
 * the full MCP protocol pipeline: tool discovery, memory save/search, document
 * create/get, project listing, and error handling.
 *
 * Prerequisites:
 *   - Supabase credentials in .env.test (see .env.test.example)
 *   - Live Ollama with nomic-embed-text model
 *
 * Run: npm run test:e2e
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { startMcpServerFixture, stopMcpServerFixture } from '../helpers/mcp-server-fixture.js';
import { cleanupTestRows, setupTestSupabase } from '../helpers/supabase.js';
import { TEST_DATABASE_URL } from '../helpers/test-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = resolve(__dirname, '../fixtures/flashquery.e2e.yaml');
const HOST_FILTERED_FIXTURE_PATH = resolve(__dirname, '../fixtures/flashquery.e2e.host-filtered.yaml');
const ENTRY_POINT = resolve(__dirname, '../../src/index.ts');
const VAULT_E2E = resolve(__dirname, '../fixtures/vault-e2e');
const E2E_INSTANCE_ID = 'e2e-shutdown-test';
const WRITE_RECORD_PLUGIN_ID = 'e2e_write_record';
const WRITE_RECORD_TABLE = `fqcp_${WRITE_RECORD_PLUGIN_ID}_default_contacts`;

// ─────────────────────────────────────────────────────────────────────────────
// Shared client — single FQC subprocess for all tests
// ─────────────────────────────────────────────────────────────────────────────

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  try {
    if (TEST_DATABASE_URL) {
      const pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await pgClient.connect();
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(WRITE_RECORD_TABLE)}`).catch(() => {});
      await pgClient.end();
    }
    await rm(VAULT_E2E, { recursive: true, force: true });
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID);
    const fixture = await startMcpServerFixture();
    client = fixture.client;
    transport = fixture.transport;
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    throw err;  // Vitest will skip all tests in this suite
  }
}, 60000);

afterAll(async () => {
  if (client && transport) {
    await stopMcpServerFixture(client, transport);
  }
  // Clean up the E2E test vault
  try {
    await rm(VAULT_E2E, { recursive: true, force: true });
    await cleanupTestRows(await setupTestSupabase(), E2E_INSTANCE_ID);
    if (TEST_DATABASE_URL) {
      const pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await pgClient.connect();
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(WRITE_RECORD_TABLE)}`).catch(() => {});
      await pgClient.end();
    }
  } catch (err) {
    console.warn(`Failed to clean up E2E test state for ${VAULT_E2E}:`, err);
    // Don't throw — cleanup failure shouldn't fail the test suite
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract text from first content item
// ─────────────────────────────────────────────────────────────────────────────

function getText(result: { content: Array<{ type: string; text: string }>; isError?: boolean }): string {
  if (!result.content || result.content.length === 0) {
    throw new Error(`Expected content array, got: ${JSON.stringify(result)}`);
  }
  const first = result.content[0];
  if (first.type !== 'text') {
    throw new Error(
      `Expected text content, got ${first.type}: ${JSON.stringify(first)}`
    );
  }
  return first.text;
}

function extractField(text: string, field: string): string {
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — run sequentially (shared subprocess state)
// ─────────────────────────────────────────────────────────────────────────────

describe.sequential('MCP protocol E2E', () => {

  // ── T-01: Tool discovery ───────────────────────────────────────────────────

  it('lists all registered tools including final search and memory tools', async () => {
    const { tools } = await client.listTools();

    const expectedTools = [
      'save_memory',
      'search_memory',
      'list_memories',
      'get_memory',
      'write_memory',
      'archive_memory',
      'create_document',
      'get_document',
      'search_documents',
      'search_all',
      'search',
      'write_record',
      'remove_document',
      'manage_directory',
      'maintain_vault',
    ];

    // At least the core tools must be present (compound/plugin tools may also be registered)
    expect(tools.length).toBeGreaterThanOrEqual(expectedTools.length);

    const toolNames = tools.map((t: { name: string }) => t.name);
    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected);
    }
    // Phase 107: get_doc_outline was removed — must not appear in the tool list
    expect(toolNames).not.toContain('get_doc_outline');
    // Phase 127 local merged surfaces must use the final tool names.
    expect(toolNames).not.toContain('create_directory');
    expect(toolNames).not.toContain('remove_directory');
    expect(toolNames).not.toContain('force_file_scan');
    expect(toolNames).not.toContain('reconcile_documents');
  }, 30000);

  it('listTools reflects host_mcp_tools filtered registration', async () => {
    let filteredClient: Client | undefined;
    let filteredTransport: StdioClientTransport | undefined;

    try {
      const fixture = await startMcpServerFixture({ configPath: HOST_FILTERED_FIXTURE_PATH });
      filteredClient = fixture.client;
      filteredTransport = fixture.transport;

      const { tools } = await filteredClient.listTools();
      const toolNames = tools.map((tool: { name: string }) => tool.name);

      expect(toolNames).toEqual(expect.arrayContaining([
        'get_document',
        'list_vault',
        'search_documents',
        'search_all',
        'search',
        'call_model',
      ]));
      expect(toolNames).not.toContain('save_memory');
      expect(toolNames).not.toContain('create_document');
      expect(toolNames).not.toContain('archive_document');
      expect(toolNames).not.toContain('force_file_scan');
      expect(toolNames).not.toContain('get_briefing');
    } finally {
      if (filteredClient && filteredTransport) {
        await stopMcpServerFixture(filteredClient, filteredTransport);
      }
    }
  }, 30000);

  // ── T-02: save_memory + search_memory round-trip ──────────────────────────

  it('save_memory stores a memory and search_memory retrieves it', async () => {
    // Save
    const saveResult = await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'The capital of France is Paris',
        tags: ['geography', 'e2e-france'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(saveResult.isError).toBeFalsy();
    const saveText = getText(saveResult);
    expect(saveText).toMatch(/Memory saved/i);

    // Use list_memories with tag filter (more reliable than semantic search without embedding)
    const listResult = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['e2e-france'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(listResult.isError).toBeFalsy();
    const listText = getText(listResult);
    expect(listText).toContain('Paris');
  }, 30000);

  it('write_memory, search, get_memory, and archive_memory round-trip with JSON envelopes', async () => {
    const createResult = await client.callTool({
      name: 'write_memory',
      arguments: {
        mode: 'create',
        content: 'Phase 125 protocol memory about durable JSON search.',
        tags: ['phase125-e2e'],
        include: ['content'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(getText(createResult));
    expect(created).toMatchObject({
      memory_id: expect.any(String),
      content: 'Phase 125 protocol memory about durable JSON search.',
      is_latest: true,
    });

    const searchResult = await client.callTool({
      name: 'search',
      arguments: {
        query: '',
        tags: ['phase125-e2e'],
        entity_types: ['memories'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(searchResult.isError).toBeFalsy();
    const searchPayload = JSON.parse(getText(searchResult));
    expect(searchPayload).toMatchObject({ mode: 'list', entity_types: ['memories'] });
    expect(searchPayload.results).toEqual([
      expect.objectContaining({ memory_id: created.memory_id }),
    ]);

    const updateResult = await client.callTool({
      name: 'write_memory',
      arguments: {
        mode: 'update',
        memory_id: created.memory_id,
        content: 'Phase 125 protocol memory updated.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(getText(updateResult));
    expect(updated).toMatchObject({
      memory_id: expect.any(String),
      previous_version_id: created.memory_id,
      is_latest: true,
    });

    const getResult = await client.callTool({
      name: 'get_memory',
      arguments: {
        memory_ids: updated.memory_id,
        include: ['content'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(getResult.isError).toBeFalsy();
    expect(JSON.parse(getText(getResult))).toMatchObject({
      memory_id: updated.memory_id,
      content: 'Phase 125 protocol memory updated.',
    });

    const archiveResult = await client.callTool({
      name: 'archive_memory',
      arguments: { memory_ids: updated.memory_id },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(archiveResult.isError).toBeFalsy();
    expect(JSON.parse(getText(archiveResult))).toMatchObject({
      memory_id: updated.memory_id,
      archived_at: expect.any(String),
    });
  }, 30000);

  it('write_record create/update round-trips with JSON envelopes', async () => {
    const schema = [
      'plugin:',
      `  id: ${WRITE_RECORD_PLUGIN_ID}`,
      '  name: E2E Write Record',
      '  version: 1',
      'tables:',
      '  - name: contacts',
      '    columns:',
      '      - name: name',
      '        type: text',
      '        required: true',
      '      - name: email',
      '        type: text',
    ].join('\n');

    const registerResult = await client.callTool({
      name: 'register_plugin',
      arguments: { schema_yaml: schema },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(registerResult.isError).toBeFalsy();

    const createResult = await client.callTool({
      name: 'write_record',
      arguments: {
        mode: 'create',
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        data: { name: 'Protocol Ada', email: 'ada@example.test' },
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(getText(createResult));
    expect(created).toMatchObject({
      id: expect.any(String),
      plugin_id: WRITE_RECORD_PLUGIN_ID,
      table: 'contacts',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(created.data).toBeUndefined();

    const updateResult = await client.callTool({
      name: 'write_record',
      arguments: {
        mode: 'update',
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        id: created.id,
        data: { email: 'ada-protocol@example.test' },
        include: ['data'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(getText(updateResult));
    expect(updated).toMatchObject({
      id: created.id,
      plugin_id: WRITE_RECORD_PLUGIN_ID,
      table: 'contacts',
      data: {
        name: 'Protocol Ada',
        email: 'ada-protocol@example.test',
      },
    });

    const getRecordResult = await client.callTool({
      name: 'get_record',
      arguments: {
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        id: created.id,
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(getRecordResult.isError).toBeFalsy();
    const gotRecord = JSON.parse(getText(getRecordResult));
    expect(gotRecord).toMatchObject({
      id: created.id,
      plugin_id: WRITE_RECORD_PLUGIN_ID,
      table: 'contacts',
      data: {
        email: 'ada-protocol@example.test',
      },
    });

    const searchResult = await client.callTool({
      name: 'search_records',
      arguments: {
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        query: 'Protocol Ada',
        include: ['data'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(searchResult.isError).toBeFalsy();
    const searchPayload = JSON.parse(getText(searchResult));
    expect(searchPayload).toMatchObject({
      plugin_id: WRITE_RECORD_PLUGIN_ID,
      table: 'contacts',
      total: 1,
      results: [
        expect.objectContaining({
          id: created.id,
          data: expect.objectContaining({ name: 'Protocol Ada' }),
        }),
      ],
    });

    const archiveResult = await client.callTool({
      name: 'archive_record',
      arguments: {
        targets: [{ plugin_id: WRITE_RECORD_PLUGIN_ID, table: 'contacts', id: created.id }],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(archiveResult.isError).toBeFalsy();
    // The fixture `contacts` table has no `archived_at` column, so the success element
    // carries the warning and omits `archived_at`/`status` (Phase 126 Gap 6).
    const archivePayload = JSON.parse(getText(archiveResult)) as Array<Record<string, unknown>>;
    expect(archivePayload).toEqual([
      expect.objectContaining({
        id: created.id,
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        warnings: ['archived_at_unavailable'],
      }),
    ]);
    expect(archivePayload[0]).not.toHaveProperty('status');
    expect(archivePayload[0]).not.toHaveProperty('archived_at');

    const postArchiveSearch = await client.callTool({
      name: 'search_records',
      arguments: {
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        query: 'Protocol Ada',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(postArchiveSearch.isError).toBeFalsy();
    expect(JSON.parse(getText(postArchiveSearch))).toMatchObject({ total: 0, results: [] });

    const pendingList = await client.callTool({
      name: 'clear_pending_reviews',
      arguments: { action: 'list', plugin_id: WRITE_RECORD_PLUGIN_ID },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(pendingList.isError).toBeFalsy();
    expect(JSON.parse(getText(pendingList))).toMatchObject({ pending: expect.any(Number), items: expect.any(Array) });

    const pendingNoMatch = await client.callTool({
      name: 'clear_pending_reviews',
      arguments: { action: 'clear', plugin_id: WRITE_RECORD_PLUGIN_ID, ids: ['00000000-0000-0000-0000-000000000000'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(pendingNoMatch.isError).toBeFalsy();
    expect(JSON.parse(getText(pendingNoMatch))).toMatchObject({
      cleared: 0,
      items: [],
      warnings: ['no_matching_items'],
    });

    const invalidResult = await client.callTool({
      name: 'write_record',
      arguments: {
        mode: 'create',
        plugin_id: WRITE_RECORD_PLUGIN_ID,
        table: 'contacts',
        data: { email: 'missing-name@example.test' },
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(invalidResult.isError).toBe(false);
    expect(JSON.parse(getText(invalidResult))).toMatchObject({
      error: 'invalid_input',
      details: { missing_fields: ['name'] },
    });
  }, 30000);

  // ── T-03: create_document + get_document round-trip ───────────────────────

  let createdDocPath: string;
  let createdDocFqId: string;

  it('create_document writes a file and get_document reads it back', async () => {
    // Create
    const createResult = await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'E2E Test Document',
        content: 'This is an E2E test.',
        tags: ['e2e-test'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();
    const createText = getText(createResult);
    // v2.5 response format uses key-value pairs
    expect(createText).toMatch(/Title:|Path:|FQC ID:/);

    // Extract vault-relative path from "Path: <path>" line (v2.5 format)
    const match = createText.match(/^Path:\s*(.+)$/m);
    if (!match || !match[1]) {
      throw new Error(
        `Expected "Path: <path>" in response, got: ${createText}`
      );
    }
    createdDocPath = match[1].trim();
    expect(createdDocPath).toMatch(/\.md$/);

    // Get the document back
    const getResult = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: createdDocPath },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(getResult.isError).toBeFalsy();
    const getDocumentText = getText(getResult);
    // Phase 107: get_document returns a JSON envelope
    const getEnv = JSON.parse(getDocumentText);
    expect(getEnv).toMatchObject({
      identifier: createdDocPath,
      path: createdDocPath,
      title: 'E2E Test Document',
      size: { chars: expect.any(Number) },
    });
    createdDocFqId = getEnv.fq_id;
    expect(createdDocFqId).toEqual(expect.any(String));
    expect(getEnv.body).toContain('E2E test');
    // Note: get_document returns JSON envelope — tags are in frontmatter field
  }, 30000);

  it('copy_document returns JSON identification and the copy is independently retrievable', async () => {
    const copyResult = await client.callTool({
      name: 'copy_document',
      arguments: {
        identifier: createdDocPath,
        destination: 'e2e-json/copy-document-copy.md',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(copyResult.isError).toBeFalsy();
    const copyPayload = JSON.parse(getText(copyResult));
    expect(copyPayload).toMatchObject({
      identifier: 'e2e-json/copy-document-copy.md',
      path: 'e2e-json/copy-document-copy.md',
      title: 'E2E Test Document',
      size: { chars: expect.any(Number) },
    });
    expect(copyPayload.fq_id).toEqual(expect.any(String));
    expect(copyPayload.fq_id).not.toBe(createdDocFqId);

    const getCopyResult = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: copyPayload.fq_id },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const getCopyPayload = JSON.parse(getText(getCopyResult));
    expect(getCopyPayload).toMatchObject({
      path: copyPayload.path,
      fq_id: copyPayload.fq_id,
    });
  }, 30000);

  it('write_document create/update round-trips through get_document', async () => {
    const createResult = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'e2e-json/write-document.md',
        title: 'E2E Write Document',
        content: 'Initial write_document body.',
        tags: ['e2e-write'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(getText(createResult));
    expect(created).toMatchObject({
      path: 'e2e-json/write-document.md',
      mode: 'create',
      size: { chars: expect.any(Number) },
    });

    const updateResult = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'update',
        identifier: created.fq_id,
        content: 'Updated write_document body.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(getText(updateResult));
    expect(updated).toMatchObject({ path: created.path, fq_id: created.fq_id, mode: 'update' });

    const getResult = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: created.path },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const doc = JSON.parse(getText(getResult));
    expect(doc.body).toContain('Updated write_document body.');
  }, 30000);

  it('insert_in_doc and replace_doc_section mutate sections with JSON envelopes', async () => {
    await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'e2e-json/section-edit.md',
        title: 'E2E Section Edit',
        content: ['# E2E Section Edit', '## Tasks', 'First task.', '## Done', 'Old done.'].join('\n'),
      },
    });

    const insertResult = await client.callTool({
      name: 'insert_in_doc',
      arguments: {
        identifier: 'e2e-json/section-edit.md',
        position: 'end_of_section',
        heading: 'Tasks',
        heading_match: 'exact',
        content: 'Inserted task.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(insertResult.isError).toBeFalsy();
    const inserted = JSON.parse(getText(insertResult));
    expect(inserted.inserted_at).toMatchObject({ heading: 'Tasks', heading_match: 'exact' });

    const replaceResult = await client.callTool({
      name: 'replace_doc_section',
      arguments: {
        identifier: 'e2e-json/section-edit.md',
        heading: 'Done',
        heading_match: 'exact',
        content: 'Replacement done.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(replaceResult.isError).toBeFalsy();
    const replaced = JSON.parse(getText(replaceResult));
    expect(replaced.extracted_section).toMatchObject({ heading: 'Done', heading_removed: false });

    const getResult = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: 'e2e-json/section-edit.md' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const doc = JSON.parse(getText(getResult));
    expect(doc.body).toContain('Inserted task.');
    expect(doc.body).toContain('Replacement done.');
  }, 30000);

  it('move_document returns JSON identification with stable fq_id and normalized destination path', async () => {
    const moveResult = await client.callTool({
      name: 'move_document',
      arguments: {
        identifier: createdDocFqId,
        destination: 'e2e-json/moved-document',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(moveResult.isError).toBeFalsy();
    const movePayload = JSON.parse(getText(moveResult));
    expect(movePayload).toMatchObject({
      identifier: 'e2e-json/moved-document.md',
      path: 'e2e-json/moved-document.md',
      fq_id: createdDocFqId,
      size: { chars: expect.any(Number) },
    });

    const getMovedResult = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: createdDocFqId },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const getMovedPayload = JSON.parse(getText(getMovedResult));
    expect(getMovedPayload).toMatchObject({
      path: 'e2e-json/moved-document.md',
      fq_id: createdDocFqId,
    });
  }, 30000);

  it('list_vault returns parseable JSON entries over the MCP protocol', async () => {
    const result = await client.callTool({
      name: 'list_vault',
      arguments: {
        path: 'e2e-json',
        show: 'all',
        include: ['metadata', 'tracking'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(false);
    const payload = JSON.parse(getText(result));
    expect(payload).toMatchObject({
      path: 'e2e-json',
      entries: expect.any(Array),
    });
    expect(payload.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'e2e-json/copy-document-copy.md',
        type: 'file',
        fq_id: expect.any(String),
      }),
      expect.objectContaining({
        path: 'e2e-json/moved-document.md',
        type: 'file',
        fq_id: createdDocFqId,
      }),
    ]));
  }, 30000);

  it('archive_document returns JSON identification and batch partial errors over the MCP protocol', async () => {
    const createResult = await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'E2E Archive Document',
        content: 'E2E archive body.',
        path: 'e2e-json/archive-document.md',
        tags: ['e2e-json'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(createResult.isError).toBeFalsy();
    const archivePath = extractField(getText(createResult), 'Path');
    const archiveFqId = extractField(getText(createResult), 'FQC ID');

    const singleArchive = await client.callTool({
      name: 'archive_document',
      arguments: { identifiers: archiveFqId || archivePath },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(singleArchive.isError).toBeFalsy();
    const archivePayload = JSON.parse(getText(singleArchive));
    expect(archivePayload).toMatchObject({
      identifier: archiveFqId || archivePath,
      path: archivePath,
      fq_id: archiveFqId,
      status: 'archived',
      archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const batchArchive = await client.callTool({
      name: 'archive_document',
      arguments: { identifiers: [archiveFqId || archivePath, 'e2e-json/missing-archive.md'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(batchArchive.isError).toBeFalsy();
    const batchPayload = JSON.parse(getText(batchArchive));
    expect(batchPayload).toHaveLength(2);
    expect(batchPayload[0]).toMatchObject({
      fq_id: archiveFqId,
      status: 'archived',
      archived_at: archivePayload.archived_at,
    });
    expect(batchPayload[1]).toMatchObject({
      error: 'not_found',
      identifier: 'e2e-json/missing-archive.md',
    });
  }, 30000);

  it('manage_directory create/remove returns ordered JSON results and non-empty conflicts', async () => {
    const createResult = await client.callTool({
      name: 'manage_directory',
      arguments: {
        action: 'create',
        paths: ['e2e-phase127/empty-dir', 'e2e-phase127/non-empty-dir'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBe(false);
    const createPayload = JSON.parse(getText(createResult));
    expect(createPayload.results).toEqual([
      expect.objectContaining({
        path: 'e2e-phase127/empty-dir',
        action: 'create',
        status: 'created',
      }),
      expect.objectContaining({
        path: 'e2e-phase127/non-empty-dir',
        action: 'create',
        status: 'created',
      }),
    ]);

    await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'e2e-phase127/non-empty-dir/kept.md',
        title: 'E2E Phase 127 Kept',
        content: 'This document keeps the directory non-empty.',
      },
    });

    const nonEmptyRemove = await client.callTool({
      name: 'manage_directory',
      arguments: { action: 'remove', paths: ['e2e-phase127/non-empty-dir'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(nonEmptyRemove.isError).toBe(false);
    const nonEmptyPayload = JSON.parse(getText(nonEmptyRemove));
    expect(nonEmptyPayload.results).toEqual([
      expect.objectContaining({
        error: 'conflict',
        identifier: 'e2e-phase127/non-empty-dir',
        details: expect.objectContaining({ reason: 'directory_not_empty' }),
      }),
    ]);

    const removeResult = await client.callTool({
      name: 'manage_directory',
      arguments: { action: 'remove', paths: ['e2e-phase127/empty-dir'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(removeResult.isError).toBe(false);
    const removePayload = JSON.parse(getText(removeResult));
    expect(removePayload.results).toEqual([
      expect.objectContaining({
        path: 'e2e-phase127/empty-dir',
        action: 'remove',
        status: 'removed',
      }),
    ]);
  }, 30000);

  it('maintain_vault returns JSON sync counts and expected option errors', async () => {
    await writeFile(
      resolve(VAULT_E2E, 'e2e-phase127/external-sync.md'),
      [
        '---',
        'title: E2E Phase 127 External Sync',
        'tags:',
        '  - e2e-phase127',
        '---',
        '',
        'External file written outside MCP.',
      ].join('\n'),
      'utf-8'
    );

    const syncResult = await client.callTool({
      name: 'maintain_vault',
      arguments: { action: 'sync' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(syncResult.isError).toBe(false);
    const syncPayload = JSON.parse(getText(syncResult));
    expect(syncPayload.actions).toEqual([
      expect.objectContaining({
        action: 'sync',
        counts: expect.objectContaining({
          scanned: expect.any(Number),
          added: expect.any(Number),
          updated: expect.any(Number),
          repaired: expect.any(Number),
          archived: expect.any(Number),
        }),
      }),
    ]);

    const invalidRepairBackground = await client.callTool({
      name: 'maintain_vault',
      arguments: { action: 'repair', background: true },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(invalidRepairBackground.isError).toBe(false);
    expect(JSON.parse(getText(invalidRepairBackground))).toMatchObject({
      error: 'invalid_input',
      details: expect.objectContaining({ field: 'background' }),
    });

    const missingStatus = await client.callTool({
      name: 'maintain_vault',
      arguments: { action: 'status', job_id: 'missing' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(missingStatus.isError).toBe(false);
    expect(JSON.parse(getText(missingStatus))).toMatchObject({
      error: 'not_found',
      details: expect.objectContaining({ job_id: 'missing' }),
    });
  }, 30000);

  it('remove_document returns JSON archived removal results, mixed batch errors, and bulk warnings', async () => {
    const singleCreate = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'e2e-phase127/remove-single.md',
        title: 'E2E Phase 127 Remove Single',
        content: 'Remove this document through remove_document.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(singleCreate.isError).toBeFalsy();
    const singleCreated = JSON.parse(getText(singleCreate));

    const singleRemove = await client.callTool({
      name: 'remove_document',
      arguments: { identifiers: singleCreated.fq_id },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(singleRemove.isError).toBeFalsy();
    const singlePayload = JSON.parse(getText(singleRemove));
    expect(singlePayload).toMatchObject({
      identifier: singleCreated.fq_id,
      path: 'e2e-phase127/remove-single.md',
      fq_id: singleCreated.fq_id,
      status: 'archived',
      archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      removed: true,
    });

    const batchCreate = await client.callTool({
      name: 'write_document',
      arguments: {
        mode: 'create',
        path: 'e2e-phase127/remove-batch-success.md',
        title: 'E2E Phase 127 Remove Batch Success',
        content: 'Remove this document in a mixed batch.',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const batchCreated = JSON.parse(getText(batchCreate));

    const mixedBatch = await client.callTool({
      name: 'remove_document',
      arguments: {
        identifiers: [batchCreated.path, 'e2e-phase127/missing-remove.md'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(mixedBatch.isError).toBeFalsy();
    const mixedPayload = JSON.parse(getText(mixedBatch));
    expect(mixedPayload.results).toEqual([
      expect.objectContaining({
        identifier: batchCreated.path,
        path: batchCreated.path,
        status: 'archived',
        archived_at: expect.any(String),
      }),
      expect.objectContaining({
        error: 'not_found',
        identifier: 'e2e-phase127/missing-remove.md',
      }),
    ]);

    const bulkPaths = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const created = await client.callTool({
          name: 'write_document',
          arguments: {
            mode: 'create',
            path: `e2e-phase127/bulk-${index}.md`,
            title: `E2E Phase 127 Bulk ${index}`,
            content: 'Bulk removal warning coverage.',
          },
        }) as { content: Array<{ type: string; text: string }>; isError?: boolean };
        return JSON.parse(getText(created)).path as string;
      })
    );

    const bulkRemove = await client.callTool({
      name: 'remove_document',
      arguments: { identifiers: bulkPaths },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(bulkRemove.isError).toBeFalsy();
    const bulkPayload = JSON.parse(getText(bulkRemove));
    expect(bulkPayload.results).toHaveLength(6);
    expect(bulkPayload.warnings).toEqual(['bulk_removal: 6 items']);
  }, 30000);

  // ── T-04: Error handling — missing required param ─────────────────────────

  it('get_document with missing path param returns error', async () => {
    // The MCP SDK validates input schemas on the server side and returns isError:true
    // or throws a McpError for validation failures. Handle both.
    try {
      const result = await client.callTool({
        name: 'get_document',
        arguments: {},
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // If the SDK returns a result instead of throwing, it must be an error
      expect(result.isError).toBe(true);
    } catch (err) {
      // McpError thrown for schema validation failure — this is also acceptable
      expect(err).toBeDefined();
    }
  }, 30000);

  // ── T-07: Error handling — nonexistent document ───────────────────────────

  it('get_document with nonexistent path returns an expected JSON error', async () => {
    const result = await client.callTool({
      name: 'get_document',
      arguments: { identifiers: 'nonexistent/file.md' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(false);
    const errorPayload = JSON.parse(getText(result));
    expect(errorPayload).toMatchObject({
      error: 'not_found',
      identifier: 'nonexistent/file.md',
    });
  }, 30000);

  // ── T-08: Multi-memory search relevance ranking ───────────────────────────

  it('multi-memory search returns TypeScript memories before French cuisine', async () => {
    // Save 3 memories covering distinct topics
    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'TypeScript generics enable type-safe reusable functions and classes',
        tags: ['typescript', 'e2e-ts-multi'],
      },
    });

    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'French cuisine is famous for croissants, baguettes, and coq au vin',
        tags: ['food', 'france', 'e2e-ts-multi'],
      },
    });

    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'TypeScript async/await patterns simplify Promise-based code in Node.js',
        tags: ['typescript', 'nodejs', 'e2e-ts-multi'],
      },
    });

    // Use tag-based search to find TypeScript memories with the multi tag
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['typescript', 'e2e-ts-multi'],
        tag_match: 'all',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);

    // Both TypeScript memories should appear when filtering by typescript tag
    expect(text).toContain('TypeScript');
    // French cuisine has the multi tag but not typescript tag — should not appear with tag_match: all
    expect(text).not.toContain('croissants');
  }, 30000);

  // ── T-09: list_memories basic round-trip ─────────────────────────────────

  it('list_memories returns memories saved in earlier tests', async () => {
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {},
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // T-02 saved a memory about France/Paris — it must appear in the listing
    expect(text).toContain('Paris');
  }, 30000);

  // ── T-10: search_documents by project filter ──────────────────────────────

  it('search_documents returns only documents from the specified project', async () => {
    // Create a document with a unique tag to distinguish it
    const createResult = await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'Alt Project Document',
        content: 'This document belongs to the alternate project.',
        tags: ['alt-project-test'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();

    // Search for documents with e2e-test tag using filesystem mode (no embedding needed)
    const searchResult = await client.callTool({
      name: 'search_documents',
      arguments: { tags: ['e2e-test'], mode: 'filesystem' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(searchResult.isError).toBeFalsy();
    const text = getText(searchResult);
    // T-03 created "E2E Test Document" with e2e-test tag — should appear
    expect(text).toContain('E2E Test Document');
    // Alt Project Document has alt-project-test tag, not e2e-test — should not appear
    expect(text).not.toContain('Alt Project Document');
  }, 30000);

  // ── T-11: search_documents by tag filter ──────────────────────────────────

  it('search_documents returns only documents matching the specified tag', async () => {
    // Create a document with a unique tag
    await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'Tagged Filter Document',
        content: 'This document has a unique tag for filter testing.',
        tags: ['e2e-tag-filter'],
      },
    });

    // Search by the unique tag using filesystem mode
    const result = await client.callTool({
      name: 'search_documents',
      arguments: { tags: ['e2e-tag-filter'], mode: 'filesystem' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Tagged Filter Document');
    // Documents without e2e-tag-filter tag should not appear
    expect(text).not.toContain('Alt Project Document');
  }, 30000);

  // ── T-12: search_memory with project filter ───────────────────────────────

  it('search_memory scopes results to the specified project', async () => {
    // Save a geography memory with unique tags
    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'The Eiffel Tower is a landmark in Paris, France',
        tags: ['landmark-unique-eiffel'],
      },
    });

    // List memories with typescript tag (no semantic search needed)
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['typescript'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Should find TypeScript memories with the typescript tag
    expect(text).toContain('TypeScript');
    // Should not find Eiffel Tower (different tag)
    expect(text).not.toContain('Eiffel Tower');
  }, 30000);

  // ── T-14: list_memories with project filter ───────────────────────────────

  it('list_memories scopes results to the specified project', async () => {
    const result = await client.callTool({
      name: 'list_memories',
      arguments: { tags: ['geography'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Should list memories with geography tag (from T-02: Paris memory)
    expect(text).toContain('Paris');
  }, 30000);

  // ── T-15: search_memory with no matching results ──────────────────────────

  it('search_memory returns a graceful response when no results match', async () => {
    // Search for a non-existent tag
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['nonexistent-tag-xyz'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Should not be an error — empty results are not failures
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Should indicate no results found gracefully
    const lc = text.toLowerCase();
    expect(lc.includes('no') || lc.includes('empty') || lc.includes('found')).toBe(true);
  }, 30000);

  // ── T-16: save_memory without project uses config default ─────────────────

  it('save_memory uses config defaults.project when project param is omitted', async () => {
    const result = await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'Testing default project fallback behavior in save_memory',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // In v2.5, memories use global scope by default (no project concept)
    expect(text).toMatch(/Memory saved/i);
    expect(text).toMatch(/Scope: Global/i);
  }, 30000);

});
